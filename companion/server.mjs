import { createServer } from "node:http";
import { createWriteStream, existsSync, statSync } from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { availableParallelism, tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { analyzeDemo, quickDemoMeta } from "./analyze.mjs";
import { processGsiPacket, getLiveState } from "./gsi.mjs";
import { checkGsiStatus, installGsiConfig, findCs2CfgDirectories } from "./integrator.mjs";
import { checkForUpdates, downloadAndApplyPatch, getLocalVersionInfo, saveLocalVersionInfo } from "./updater.mjs";

const HOST = "127.0.0.1";
const PORT = 43119;
const COACH_PORT = 43121;
const MAX_DEMO_BYTES = 800 * 1024 * 1024;
const MAX_COACH_BODY_BYTES = 2 * 1024 * 1024;
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DATA_DIR = process.env.TRACER_DATA_DIR || join(process.env.LOCALAPPDATA || ROOT, "TRACER", "data");
const PROGRESS_PATH = join(DATA_DIR, "progress.json");
const MODEL_PATH = process.env.TRACER_MODEL_PATH || join(ROOT, "model", "coach.gguf");
const CPU_LLAMA_SERVER_PATH = process.env.TRACER_LLAMA_SERVER || [
  join(ROOT, "runtime", "llama", "llama-server.exe"),
  join(ROOT, "runtime", "llama", "llama-server"),
].find(existsSync) || join(ROOT, "runtime", "llama", "llama-server.exe");
const CUDA_LLAMA_SERVER_PATH = process.env.TRACER_LLAMA_CUDA_SERVER || [
  join(ROOT, "runtime", "llama-cuda", "llama-server.exe"),
  join(ROOT, "runtime", "llama-cuda", "llama-server"),
].find(existsSync) || join(ROOT, "runtime", "llama-cuda", "llama-server.exe");
const ALLOWED_ORIGINS = new Set([
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "http://localhost:43118",
  "http://127.0.0.1:43118",
  "https://tracer-cs2-lab.vuraldoan.chatgpt.site",
]);

let coachProcess = null;
let coachBusy = false;
let coachLogTail = "";
let activeCoachBackend = null;
let cudaProbeCache = null;
let cudaDisabledReason = "";
let progressWriteQueue = Promise.resolve();

// --- Live In-Memory Log Buffer for Terminal / Diagnostics ---
const LOG_HISTORY_MAX = 350;
const logHistory = [];

export function recordLog(level, message, meta = null) {
  const entry = {
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    level, // 'info' | 'warn' | 'error' | 'gsi' | 'updater'
    message: typeof message === "string" ? message : JSON.stringify(message),
    meta,
  };
  logHistory.push(entry);
  if (logHistory.length > LOG_HISTORY_MAX) {
    logHistory.shift();
  }
  return entry;
}

const origLog = console.log;
const origWarn = console.warn;
const origError = console.error;

console.log = (...args) => {
  origLog(...args);
  const msg = args.map((a) => (typeof a === "object" ? JSON.stringify(a) : String(a))).join(" ");
  const level = msg.includes("[UPDATER]") ? "updater" : msg.includes("[GSI]") ? "gsi" : "info";
  recordLog(level, msg);
};

console.warn = (...args) => {
  origWarn(...args);
  const msg = args.map((a) => (typeof a === "object" ? JSON.stringify(a) : String(a))).join(" ");
  recordLog("warn", msg);
};

console.error = (...args) => {
  origError(...args);
  const msg = args.map((a) => (typeof a === "object" ? JSON.stringify(a) : String(a))).join(" ");
  recordLog("error", msg);
};

const COACH_RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    title: { type: "string", maxLength: 100 },
    summary: { type: "string", maxLength: 350 },
    priorities: {
      type: "array",
      maxItems: 3,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          area: { type: "string", maxLength: 60 },
          evidence: { type: "string", maxLength: 180 },
          interpretation: { type: "string", maxLength: 220 },
          action: { type: "string", maxLength: 180 },
        },
        required: ["area", "evidence", "interpretation", "action"],
      },
    },
    strengths: { type: "array", maxItems: 3, items: { type: "string", maxLength: 140 } },
    sessionPlan: { type: "string", maxLength: 300 },
    confidence: { type: "number", minimum: 0, maximum: 100 },
  },
  required: ["title", "summary", "priorities", "strengths", "sessionPlan", "confidence"],
};

function cleanCoachFallback(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const priorities = Array.isArray(value.priorities) ? value.priorities.slice(0, 3).map((item) => ({
    area: String(item?.area || "Genel oyun").slice(0, 80),
    evidence: String(item?.evidence || "Kural motoru bulgusu").slice(0, 320),
    interpretation: String(item?.interpretation || "Round görüntüsüyle doğrulanmalı.").slice(0, 320),
    action: String(item?.action || "İlgili roundları incele.").slice(0, 320),
  })) : [];
  const fallback = {
    title: String(value.title || "Kanıta dayalı maç raporu").slice(0, 120),
    summary: String(value.summary || "Demo kural motoruyla analiz edildi.").slice(0, 600),
    priorities,
    strengths: Array.isArray(value.strengths) ? value.strengths.slice(0, 3).map((item) => String(item).slice(0, 180)) : [],
    sessionPlan: String(value.sessionPlan || priorities[0]?.action || "Öncelikli roundları izle ve tek davranış hedefi seç.").slice(0, 500),
    confidence: Math.max(0, Math.min(100, Number(value.confidence) || 70)),
  };
  return fallback.priorities.length ? fallback : null;
}

function validateCoachContent(content, finishReason = "unknown") {
  if (!content) return { title: "", summary: "", priorities: [], strengths: [], sessionPlan: "", confidence: 70 };
  if (typeof content !== "string") return content;
  const clean = content
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/^```(?:json)?\s*|\s*```$/g, "")
    .trim();

  let parsed = null;
  try {
    parsed = JSON.parse(clean);
  } catch {
    const firstBrace = clean.indexOf("{");
    const lastBrace = clean.lastIndexOf("}");
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      try {
        parsed = JSON.parse(clean.slice(firstBrace, lastBrace + 1));
      } catch { /* ignore fallback below */ }
    }
  }

  if (!parsed || typeof parsed !== "object") {
    return {
      title: "",
      summary: "",
      priorities: [],
      strengths: [],
      sessionPlan: "",
      confidence: 70,
    };
  }

  return parsed;
}

function usefulGeneratedText(value, fallback, requireSentence = true) {
  const text = typeof value === "string" ? value.trim() : "";
  const lowered = text.toLocaleLowerCase("tr-TR");
  const repeatsInstructions = /tracer|koç editör|kanıta dayalı cs2 koçu|veride olmayan|yalnızca json|istenen json|talimat/.test(lowered);
  if (!text || repeatsInstructions || (requireSentence && !/[.!?]$/.test(text))) return fallback;
  return text;
}

function mergeCoachWithEvidence(generated, deterministicFallback) {
  const priorities = deterministicFallback.priorities.map((fixed, index) => {
    const candidate = generated.priorities[index] || {};
    return {
      area: fixed.area,
      evidence: fixed.evidence,
      interpretation: usefulGeneratedText(candidate.interpretation, fixed.interpretation),
      action: fixed.action,
    };
  });
  return {
    title: usefulGeneratedText(generated.title, deterministicFallback.title, false),
    summary: usefulGeneratedText(generated.summary, deterministicFallback.summary),
    priorities,
    strengths: deterministicFallback.strengths,
    sessionPlan: usefulGeneratedText(generated.sessionPlan, deterministicFallback.sessionPlan),
    confidence: deterministicFallback.confidence,
  };
}

function corsHeaders(origin) {
  const allowedOrigin = ALLOWED_ORIGINS.has(origin) ? origin : "";
  return {
    ...(allowedOrigin ? { "Access-Control-Allow-Origin": allowedOrigin } : {}),
    "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-File-Name",
    "Access-Control-Allow-Private-Network": "true",
    "Access-Control-Max-Age": "600",
    "Cache-Control": "no-store",
    "Vary": "Origin",
  };
}

function sendJson(response, status, payload, origin = "") {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", ...corsHeaders(origin) });
  response.end(JSON.stringify(payload));
}

function probeCudaRuntime() {
  if (cudaProbeCache) return cudaProbeCache;
  if (String(process.env.TRACER_COACH_BACKEND || "").toLowerCase() === "cpu") {
    cudaProbeCache = { available: false, binaryFound: existsSync(CUDA_LLAMA_SERVER_PATH), device: "", reason: "CPU kullanımı ortam ayarıyla zorlandı." };
    return cudaProbeCache;
  }
  if (!existsSync(CUDA_LLAMA_SERVER_PATH)) {
    cudaProbeCache = { available: false, binaryFound: false, device: "", reason: "CUDA çalışma paketi bulunamadı." };
    return cudaProbeCache;
  }
  const cudaDir = dirname(CUDA_LLAMA_SERVER_PATH);
  const probe = spawnSync(CUDA_LLAMA_SERVER_PATH, ["--list-devices"], {
    cwd: cudaDir,
    env: { ...process.env, PATH: `${cudaDir};${process.env.PATH || ""}` },
    encoding: "utf8",
    timeout: 15000,
    windowsHide: true,
  });
  const output = `${probe.stdout || ""}\n${probe.stderr || ""}`;
  const deviceLine = output.split(/\r?\n/).find((line) => /CUDA\d+\s*:|NVIDIA/i.test(line)) || "";
  const device = deviceLine.replace(/^.*?CUDA\d+\s*:\s*/i, "").trim().slice(0, 160);
  const available = probe.status === 0 && /CUDA\d+\s*:/i.test(output);
  cudaProbeCache = {
    available,
    binaryFound: true,
    device: available ? (device || "NVIDIA CUDA GPU") : "",
    reason: available ? "" : (probe.error?.message || output.trim().slice(-500) || `CUDA cihaz taraması ${probe.status ?? "?"} koduyla bitti.`),
  };
  return cudaProbeCache;
}

function preferredCoachRuntime() {
  const cuda = probeCudaRuntime();
  if (cuda.available && !cudaDisabledReason) return { backend: "cuda", path: CUDA_LLAMA_SERVER_PATH, device: cuda.device };
  if (existsSync(CPU_LLAMA_SERVER_PATH)) return { backend: "cpu", path: CPU_LLAMA_SERVER_PATH, device: "CPU" };
  if (cuda.available) return { backend: "cuda", path: CUDA_LLAMA_SERVER_PATH, device: cuda.device };
  return null;
}

function coachStatus() {
  const cuda = probeCudaRuntime();
  const runtime = preferredCoachRuntime();
  const binaryFound = Boolean(runtime);
  const modelFound = existsSync(MODEL_PATH);
  const backend = activeCoachBackend || runtime?.backend || "unavailable";
  return {
    available: binaryFound && modelFound,
    binaryFound,
    cpuBinaryFound: existsSync(CPU_LLAMA_SERVER_PATH),
    cudaBinaryFound: cuda.binaryFound,
    cudaAvailable: cuda.available,
    cudaDevice: cuda.device,
    cudaReason: cudaDisabledReason || cuda.reason,
    backend,
    backendLabel: backend === "cuda" ? `CUDA · ${cuda.device || "NVIDIA GPU"}` : backend === "cpu" ? "CPU" : "Kullanılamıyor",
    modelFound,
    running: Boolean(coachProcess && coachProcess.exitCode === null),
    busy: coachBusy,
    engine: "llama.cpp",
    model: "Qwen3 1.7B Q4_K_M",
    modelBytes: modelFound ? statSync(MODEL_PATH).size : 0,
    loadPolicy: "on-demand",
    releasePolicy: "process-exit-after-response",
  };
}

async function readJsonBody(request, limit = MAX_COACH_BODY_BYTES) {
  const chunks = [];
  let received = 0;
  for await (const chunk of request) {
    received += chunk.length;
    if (received > limit) throw new Error("Koç isteği 2 MB sınırını aşıyor.");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

function cleanIdentity(value) {
  const steamid = String(value?.steamid || "").trim().slice(0, 32);
  const name = String(value?.name || "").trim().slice(0, 80);
  if (!name) throw new Error("Oyuncu adı eksik.");
  return { steamid, name };
}

function samePlayer(left, right) {
  if (left?.steamid && right?.steamid) return left.steamid === right.steamid;
  return Boolean(left?.name && right?.name && left.name === right.name);
}

async function readProgressStore() {
  try {
    const parsed = JSON.parse(await readFile(PROGRESS_PATH, "utf8"));
    return {
      profile: parsed?.profile || null,
      matches: Array.isArray(parsed?.matches) ? parsed.matches : [],
    };
  } catch (error) {
    if (error?.code === "ENOENT" || error instanceof SyntaxError) return { profile: null, matches: [] };
    throw error;
  }
}

async function writeProgressStore(store) {
  progressWriteQueue = progressWriteQueue.then(async () => {
    await mkdir(DATA_DIR, { recursive: true });
    const tempPath = `${PROGRESS_PATH}.${process.pid}.tmp`;
    await writeFile(tempPath, JSON.stringify(store), "utf8");
    await rm(PROGRESS_PATH, { force: true });
    await rename(tempPath, PROGRESS_PATH);
  });
  return progressWriteQueue;
}

function cleanProgressMatch(body, profile) {
  const player = cleanIdentity(body?.player);
  if (!samePlayer(player, profile)) throw Object.assign(new Error("Seçili kişisel oyuncu dışında bir oyuncunun maçı kaydedilemez."), { statusCode: 409 });
  const summary = body?.summary;
  if (!summary || typeof summary !== "object" || Array.isArray(summary)) throw new Error("Maç özeti eksik.");
  return {
    id: String(body.matchId || "").slice(0, 400),
    date: Number(body.matchDate) || Date.now(),
    fileName: String(body.fileName || "match.dem").slice(0, 260),
    map: String(body.map || "Bilinmeyen harita").slice(0, 80),
    playerSteamId: player.steamid,
    playerName: player.name,
    summary,
  };
}

async function handleProgress(request, response, origin) {
  const store = await readProgressStore();
  if (request.method === "GET") {
    const matches = store.profile
      ? store.matches.filter((item) => samePlayer({ steamid: item.playerSteamId, name: item.playerName }, store.profile)).sort((a, b) => b.date - a.date).slice(0, 90)
      : [];
    sendJson(response, 200, { profile: store.profile, matches }, origin);
    return;
  }
  if (request.method === "PUT") {
    const profile = cleanIdentity(await readJsonBody(request));
    store.profile = profile;
    await writeProgressStore(store);
    sendJson(response, 200, { profile }, origin);
    return;
  }
  if (request.method === "POST") {
    if (!store.profile) throw new Error("Önce demodaki kişisel oyuncunu seç.");
    const match = cleanProgressMatch(await readJsonBody(request), store.profile);
    if (!match.id) throw new Error("Maç kimliği eksik.");
    const otherPlayers = store.matches.filter((item) => !samePlayer({ steamid: item.playerSteamId, name: item.playerName }, store.profile));
    const playerMatches = [match, ...store.matches.filter((item) => samePlayer({ steamid: item.playerSteamId, name: item.playerName }, store.profile) && item.id !== match.id)]
      .sort((a, b) => b.date - a.date)
      .slice(0, 90);
    store.matches = [...playerMatches, ...otherPlayers].slice(0, 450);
    await writeProgressStore(store);
    sendJson(response, 200, { ok: true, count: playerMatches.length }, origin);
    return;
  }
  sendJson(response, 405, { error: "Desteklenmeyen yöntem." }, origin);
}

async function waitForCoachServer(child, backend, timeoutMs = 90000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (child.exitCode !== null) {
      throw new Error(`${backend === "cuda" ? "CUDA" : "CPU"} modeli başlatılamadı.${coachLogTail ? ` ${coachLogTail.slice(-500)}` : ""}`);
    }
    try {
      const response = await fetch(`http://${HOST}:${COACH_PORT}/health`, { signal: AbortSignal.timeout(1500) });
      if (response.ok) return;
    } catch { /* model is still loading */ }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 350));
  }
  throw new Error(`${backend === "cuda" ? "CUDA" : "CPU"} modeli ${Math.round(timeoutMs / 1000)} saniye içinde hazır olmadı.`);
}

async function stopCoachProcess() {
  const child = coachProcess;
  coachProcess = null;
  if (!child || child.exitCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolveExit) => child.once("exit", resolveExit)),
    new Promise((resolveDelay) => setTimeout(resolveDelay, 3500)),
  ]);
  if (child.exitCode === null) child.kill("SIGKILL");
}

async function runCoachAttempt(runtime, messages, deterministicFallback) {
  coachLogTail = "";
  activeCoachBackend = runtime.backend;
  const threadCount = Math.max(2, Math.min(8, availableParallelism() - 2));
  const args = [
    "-m", MODEL_PATH,
    "--host", HOST,
    "--port", String(COACH_PORT),
    "-c", "16384",
    "-t", String(threadCount),
    "-ngl", runtime.backend === "cuda" ? "99" : "0",
  ];
  const binDir = dirname(runtime.path);
  const child = spawn(runtime.path, args, {
    cwd: binDir,
    env: { ...process.env, PATH: `${binDir};${process.env.PATH || ""}` },
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  coachProcess = child;
  const rememberLog = (chunk) => { coachLogTail = `${coachLogTail}${chunk.toString("utf8")}`.slice(-4000); };
  child.stdout.on("data", rememberLog);
  child.stderr.on("data", rememberLog);

  try {
    await waitForCoachServer(child, runtime.backend, runtime.backend === "cuda" ? 35000 : 90000);
    const response = await fetch(`http://${HOST}:${COACH_PORT}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(3 * 60 * 1000),
      body: JSON.stringify({
        model: "tracer-coach",
        messages,
        temperature: 0.1,
        seed: 73921,
        max_tokens: 2048,
        response_format: { type: "json_object" },
        chat_template_kwargs: { enable_thinking: false },
        reasoning_effort: "none",
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error?.message || payload.error || `Yerel model ${response.status} döndürdü.`);
    const content = payload.choices?.[0]?.message?.content;
    if (!content) throw new Error("Yerel model boş yanıt döndürdü.");
    return {
      content: JSON.stringify(mergeCoachWithEvidence(
        validateCoachContent(content, payload.choices?.[0]?.finish_reason),
        deterministicFallback,
      )),
      model: "Qwen3 1.7B Q4_K_M",
      backend: runtime.backend,
      backendLabel: runtime.backend === "cuda" ? `CUDA · ${runtime.device}` : "CPU",
      generated: true,
    };
  } finally {
    await stopCoachProcess();
    activeCoachBackend = null;
  }
}

async function runEmbeddedCoach(messages, deterministicFallback) {
  cudaDisabledReason = "";
  cudaProbeCache = null;
  const status = coachStatus();
  if (!status.available) {
    const missing = [!status.binaryFound && "llama-server.exe", !status.modelFound && "model/coach.gguf"].filter(Boolean).join(" ve ");
    throw new Error(`Gömülü koç paketi eksik: ${missing}. PORTABLE.md içindeki paketleme adımını çalıştır.`);
  }
  if (coachBusy) throw new Error("Koç başka bir yanıt hazırlıyor; birkaç saniye sonra yeniden dene.");

  coachBusy = true;
  const runtime = preferredCoachRuntime();
  try {
    try {
      return await runCoachAttempt(runtime, messages, deterministicFallback);
    } catch (cudaError) {
      if (runtime?.backend !== "cuda" || !existsSync(CPU_LLAMA_SERVER_PATH)) throw cudaError;
      cudaDisabledReason = cudaError instanceof Error ? cudaError.message.slice(0, 700) : String(cudaError).slice(0, 700);
      await stopCoachProcess();
      return await runCoachAttempt({ backend: "cpu", path: CPU_LLAMA_SERVER_PATH, device: "CPU" }, messages, deterministicFallback);
    }
  } finally {
    await stopCoachProcess();
    activeCoachBackend = null;
    coachBusy = false;
  }
}

const server = createServer(async (request, response) => {
  const origin = request.headers.origin || "";
  if (origin && !ALLOWED_ORIGINS.has(origin)) {
    sendJson(response, 403, { error: "Bu origin TRACER companion tarafından yetkilendirilmedi." });
    return;
  }
  if (request.method === "OPTIONS") {
    response.writeHead(204, corsHeaders(origin));
    response.end();
    return;
  }
  if (request.method === "GET" && request.url === "/health") {
    sendJson(response, 200, { ok: true, parserVersion: "0.42.0", mode: "local-native", coach: coachStatus() }, origin);
    return;
  }
  if ((request.method === "GET" || request.method === "POST") && request.url === "/heartbeat") {
    sendJson(response, 200, { ok: true, time: Date.now() }, origin);
    return;
  }
  if (request.method === "POST" && request.url === "/shutdown") {
    sendJson(response, 200, { ok: true, message: "TRACER kapatılıyor..." }, origin);
    setTimeout(async () => {
      try {
        await stopCoachProcess();
      } catch { }
      server.close(() => process.exit(0));
      setTimeout(() => process.exit(0), 1000);
    }, 100);
    return;
  }
  if (request.method === "GET" && request.url === "/coach/status") {
    sendJson(response, 200, coachStatus(), origin);
    return;
  }
  if (request.url === "/progress" && ["GET", "PUT", "POST"].includes(request.method || "")) {
    try {
      await handleProgress(request, response, origin);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      sendJson(response, Number(error?.statusCode) || 422, { error: message }, origin);
    }
    return;
  }
  if (request.method === "POST" && request.url === "/coach/chat") {
    let deterministicFallback = null;
    try {
      const body = await readJsonBody(request);
      if (!Array.isArray(body.messages) || body.messages.length < 2) {
        sendJson(response, 400, { error: "Koç mesajları eksik." }, origin);
        return;
      }
      deterministicFallback = cleanCoachFallback(body.deterministic);
      if (!deterministicFallback) {
        sendJson(response, 400, { error: "Kanıta dayalı yedek koç raporu eksik." }, origin);
        return;
      }
      const result = await runEmbeddedCoach(body.messages, deterministicFallback);
      sendJson(response, 200, { ...result, released: true }, origin);
    } catch (error) {
      await stopCoachProcess();
      coachBusy = false;
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("başka bir yanıt")) {
        sendJson(response, 409, { error: message, released: true }, origin);
      } else if (deterministicFallback) {
        const fallbackStatus = coachStatus();
        sendJson(response, 200, {
          content: JSON.stringify(deterministicFallback),
          model: fallbackStatus.model,
          backend: fallbackStatus.backend,
          backendLabel: fallbackStatus.backendLabel,
          generated: false,
          warning: message,
          released: true,
        }, origin);
      } else {
        sendJson(response, 503, { error: message, released: true }, origin);
      }
    }
    return;
  }

  // --- Update & Patch Engine Endpoints ---
  if (request.method === "GET" && request.url === "/update/version") {
    sendJson(response, 200, getLocalVersionInfo(), origin);
    return;
  }

  if (request.method === "GET" && request.url?.startsWith("/update/check")) {
    try {
      const urlObj = new URL(request.url, `http://${HOST}:${PORT}`);
      const repoParam = urlObj.searchParams.get("repo") || undefined;
      const updateData = await checkForUpdates(repoParam);
      sendJson(response, 200, updateData, origin);
    } catch (err) {
      sendJson(response, 500, { error: err instanceof Error ? err.message : String(err) }, origin);
    }
    return;
  }

  if (request.method === "POST" && request.url === "/update/config") {
    try {
      const body = await readJsonBody(request, 16 * 1024);
      const saved = saveLocalVersionInfo(body);
      sendJson(response, 200, { ok: true, config: saved }, origin);
    } catch (err) {
      sendJson(response, 400, { error: err instanceof Error ? err.message : String(err) }, origin);
    }
    return;
  }

  if (request.method === "POST" && request.url === "/update/apply") {
    try {
      const body = await readJsonBody(request, 64 * 1024);
      const res = await downloadAndApplyPatch(body?.patchUrl);
      sendJson(response, 200, res, origin);
    } catch (err) {
      sendJson(response, 500, { error: err instanceof Error ? err.message : String(err) }, origin);
    }
    return;
  }

  // --- Live Terminal & System Diagnostics Endpoints ---
  if (request.method === "GET" && request.url === "/logs") {
    sendJson(response, 200, {
      ok: true,
      logs: logHistory,
      system: {
        uptimeSec: Math.round(process.uptime()),
        memoryMb: Math.round(process.memoryUsage().heapUsed / (1024 * 1024) * 10) / 10,
        version: getLocalVersionInfo().version,
        dataDir: DATA_DIR,
        platform: process.platform,
        nodeVersion: process.version,
      }
    }, origin);
    return;
  }

  if (request.method === "POST" && request.url === "/logs/clear") {
    logHistory.length = 0;
    recordLog("info", "Terminal log geçmişi temizlendi.");
    sendJson(response, 200, { ok: true }, origin);
    return;
  }

  if (request.method === "POST" && request.url === "/system/open-log-dir") {
    const logDir = join(process.env.LOCALAPPDATA || ROOT, "TRACER", "logs");
    try {
      spawn("explorer.exe", [logDir], { detached: true, stdio: "ignore" }).unref();
      sendJson(response, 200, { ok: true, logDir }, origin);
    } catch (err) {
      sendJson(response, 500, { error: err instanceof Error ? err.message : String(err) }, origin);
    }
    return;
  }

  // --- GSI (Game State Integration) & Live Realtime Coach Endpoints ---
  if (request.method === "GET" && request.url === "/gsi/status") {
    sendJson(response, 200, checkGsiStatus(), origin);
    return;
  }

  if (request.method === "POST" && request.url === "/gsi/install") {
    try {
      const body = await readJsonBody(request, 64 * 1024);
      const res = await installGsiConfig(body?.targetDir);
      sendJson(response, 200, res, origin);
    } catch (err) {
      sendJson(response, 400, { error: err instanceof Error ? err.message : String(err) }, origin);
    }
    return;
  }

  if (request.method === "GET" && request.url === "/gsi/state") {
    sendJson(response, 200, getLiveState(), origin);
    return;
  }

  if (request.method === "POST" && request.url === "/gsi") {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => { body += chunk; });
    request.on("end", () => {
      try {
        const json = JSON.parse(body);
        processGsiPacket(json);
        sendJson(response, 200, { ok: true }, origin);
      } catch {
        sendJson(response, 400, { error: "Geçersiz GSI JSON paketi." }, origin);
      }
    });
    return;
  }

  if (request.method === "POST" && request.url === "/quick-meta") {
    const rawName = String(request.headers["x-file-name"] || "match.dem");
    let decodedName = rawName;
    try { decodedName = decodeURIComponent(rawName); } catch { /* ignore */ }
    const safeName = basename(decodedName).replace(/[^a-zA-Z0-9._-]/g, "_");
    const workDir = join(tmpdir(), "tracer-cs2");
    const tempPath = join(workDir, `qm-${randomUUID()}-${safeName}`);
    try {
      await mkdir(workDir, { recursive: true });
      let received = 0;
      const limiter = new Transform({
        transform(chunk, _encoding, callback) {
          received += chunk.length;
          if (received > MAX_DEMO_BYTES) callback(new Error("Demo boyutu sınırı aşıyor."));
          else callback(null, chunk);
        },
      });
      await pipeline(request, limiter, createWriteStream(tempPath, { flags: "wx" }));
      const meta = quickDemoMeta(tempPath);
      sendJson(response, 200, { ok: true, meta }, origin);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      sendJson(response, 422, { error: message }, origin);
    } finally {
      await rm(tempPath, { force: true }).catch(() => {});
    }
    return;
  }
  if (request.method !== "POST" || request.url !== "/analyze") {
    sendJson(response, 404, { error: "Endpoint bulunamadı." }, origin);
    return;
  }

  const announcedSize = Number(request.headers["content-length"] || 0);
  if (announcedSize > MAX_DEMO_BYTES) {
    sendJson(response, 413, { error: "Demo 800 MB sınırını aşıyor." }, origin);
    return;
  }

  const rawName = String(request.headers["x-file-name"] || "match.dem");
  let decodedName = rawName;
  try { decodedName = decodeURIComponent(rawName); } catch { /* basename still sanitizes it */ }
  const safeName = basename(decodedName).replace(/[^a-zA-Z0-9._-]/g, "_");
  if (!safeName.toLowerCase().endsWith(".dem")) {
    sendJson(response, 400, { error: "Yalnızca .dem dosyaları kabul edilir." }, origin);
    return;
  }

  const workDir = join(tmpdir(), "tracer-cs2");
  const tempPath = join(workDir, `${randomUUID()}-${safeName}`);
  try {
    await mkdir(workDir, { recursive: true });
    let received = 0;
    const limiter = new Transform({
      transform(chunk, _encoding, callback) {
        received += chunk.length;
        if (received > MAX_DEMO_BYTES) callback(new Error("Demo 800 MB sınırını aşıyor."));
        else callback(null, chunk);
      },
    });
    await pipeline(request, limiter, createWriteStream(tempPath, { flags: "wx" }));
    const result = analyzeDemo(tempPath);
    sendJson(response, 200, result, origin);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    sendJson(response, 422, { error: message }, origin);
  } finally {
    await rm(tempPath, { force: true }).catch(() => {});
  }
});

server.listen(PORT, HOST, () => {
  console.log(`TRACER yerel parser hazır: http://${HOST}:${PORT}`);
  console.log("Bu pencere açık kaldığı sürece güncel Valve demoları analiz edilebilir.");
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, async () => {
    await stopCoachProcess();
    server.close(() => process.exit(0));
  });
}
