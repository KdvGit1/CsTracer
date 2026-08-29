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
import { Worker } from "node:worker_threads";
import { ANALYSIS_VERSION } from "./analysis_version.mjs";
import { processGsiPacket, getLiveState, getGamePerformanceStatus } from "./gsi.mjs";
import {
  MatchAutomationStore,
  buildCompactSummaryFromReport,
  latestUnanalyzedScannedMatch,
  performanceComparison,
} from "./match_automation.mjs";
import { SquadStore } from "./squad/store.mjs";
import { buildSquadEvidence } from "./squad/analytics.mjs";
import { buildSquadReport } from "./squad/planner.mjs";
import { applyLiveFeedback, reconcileActiveSquadSessions, reconcileLiveSession, startLiveSession } from "./squad/live.mjs";
import {
  findPartyDiscoveries,
  normalizeSteamId,
  partyPlayerCoverage,
  selectPartyDiscoveryMatches,
  selectionSteamIds,
} from "./squad/identity.mjs";
import { checkGsiStatus, installGsiConfig, optimizeInstalledGsiConfig } from "./integrator.mjs";
import { checkForUpdates, downloadAndApplyPatch, getLocalVersionInfo, saveLocalVersionInfo, restartApplication } from "./updater.mjs";
import {
  getSteamSession,
  getSteamConnectionHealth,
  extractSteamIdFromCookie,
  saveSteamSession,
  getRecentMatches,
  getRecentMatchesStorageState,
  prepareRecentMatchesStorage,
  getScannedMatches,
  syncSteamGcpdMatches,
  scanSteamGcpdMatches,
  downloadSingleMatch,
  cancelSingleMatch,
  deleteSteamMatch,
  repairExistingMatchDates,
  applyConfiguredDemoRetention,
  getDemoStorageState,
  processDownloadedDemo,
  setGamePerformanceGuard,
  startAutoScanScheduler,
  steamEvents,
} from "./steam_downloader.mjs";

const HOST = "127.0.0.1";
const configuredPort = Number.parseInt(process.env.TRACER_COMPANION_PORT || "43119", 10);
const PORT = Number.isFinite(configuredPort) && configuredPort >= 0 && configuredPort <= 65535 ? configuredPort : 43119;
const configuredCoachPort = Number.parseInt(process.env.TRACER_COACH_PORT || String(PORT ? PORT + 2 : 43121), 10);
const COACH_PORT = Number.isFinite(configuredCoachPort) && configuredCoachPort > 0 && configuredCoachPort <= 65535 ? configuredCoachPort : 43121;
const MAX_DEMO_BYTES = 800 * 1024 * 1024;
const MAX_COACH_BODY_BYTES = 2 * 1024 * 1024;
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DATA_DIR = process.env.TRACER_DATA_DIR || join(process.env.LOCALAPPDATA || ROOT, "TRACER", "data");
const PROGRESS_PATH = join(DATA_DIR, "progress.json");
const squadStore = new SquadStore(DATA_DIR);
const matchAutomationStore = new MatchAutomationStore(DATA_DIR);
const MODEL_PATH = process.env.TRACER_MODEL_PATH || join(ROOT, "model", "coach.gguf");
const SQUAD_MINIMUM_MATCHES = 3;
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
const activeDemoWorkers = new Set();
const autoDownloadQueue = [];
let autoDownloadWorkerRunning = false;
let autoDownloadActiveMatchId = null;
let autoDownloadRetryTimer = null;
let previousGamePerformanceActive = false;
let matchDownloadQueueRevision = 0;
let matchDownloadActiveStartedAt = 0;
let analyzerRuntimeState = "idle";
let analyzerRuntimeError = "";

setGamePerformanceGuard(() => getGamePerformanceStatus().active);

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

function safeLogArg(value) {
  if (typeof value !== "object" || value === null) return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return "[serialize edilemeyen nesne]";
  }
}

function matchSummaryForClient(match) {
  if (!match || typeof match !== "object") return match;
  const summary = { ...match };
  delete summary.fullAnalysis;
  return summary;
}

function matchSummariesForClient(matches) {
  return Array.isArray(matches) ? matches.map(matchSummaryForClient) : [];
}

function steamResultForClient(result) {
  if (!result || typeof result !== "object") return result;
  return {
    ...result,
    ...(Array.isArray(result.downloadedMatches) ? { downloadedMatches: matchSummariesForClient(result.downloadedMatches) } : {}),
    ...(Array.isArray(result.matches) ? { matches: matchSummariesForClient(result.matches) } : {}),
  };
}

function historyMaintenanceResponse(response, origin) {
  const storage = getRecentMatchesStorageState();
  if (storage.state === "ready") return false;
  sendJson(response, 409, {
    error: storage.state === "error"
      ? storage.message
      : "Eski maç geçmişi bir kez optimize ediliyor. Uygulama açık kalacak; birkaç saniye sonra tekrar deneyin.",
    historyStorage: storage,
  }, origin);
  return true;
}

console.log = (...args) => {
  origLog(...args);
  try {
    const msg = args.map(safeLogArg).join(" ");
    const level = msg.includes("[UPDATER]") ? "updater" : msg.includes("[GSI]") ? "gsi" : "info";
    recordLog(level, msg);
  } catch { /* log kaydı asla çökmeye yol açmamalı */ }
};

console.warn = (...args) => {
  origWarn(...args);
  try {
    recordLog("warn", args.map(safeLogArg).join(" "));
  } catch { /* ignore */ }
};

console.error = (...args) => {
  origError(...args);
  try {
    recordLog("error", args.map(safeLogArg).join(" "));
  } catch { /* ignore */ }
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

function normalizeCoachContent(value) {
  const schema = COACH_RESPONSE_SCHEMA.properties;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { title: "", summary: "", priorities: [], strengths: [], sessionPlan: "", confidence: 70 };
  }
  const priorityProperties = schema.priorities.items.properties;
  const priorities = Array.isArray(value.priorities)
    ? value.priorities.slice(0, schema.priorities.maxItems).map((item) => ({
      area: String(item?.area || "").slice(0, priorityProperties.area.maxLength),
      evidence: String(item?.evidence || "").slice(0, priorityProperties.evidence.maxLength),
      interpretation: String(item?.interpretation || "").slice(0, priorityProperties.interpretation.maxLength),
      action: String(item?.action || "").slice(0, priorityProperties.action.maxLength),
    }))
    : [];
  return {
    title: String(value.title || "").slice(0, schema.title.maxLength),
    summary: String(value.summary || "").slice(0, schema.summary.maxLength),
    priorities,
    strengths: Array.isArray(value.strengths)
      ? value.strengths.slice(0, schema.strengths.maxItems).map((item) => String(item).slice(0, schema.strengths.items.maxLength))
      : [],
    sessionPlan: String(value.sessionPlan || "").slice(0, schema.sessionPlan.maxLength),
    confidence: Math.max(schema.confidence.minimum, Math.min(schema.confidence.maximum, Number(value.confidence) || 70)),
  };
}

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

function validateCoachContent(content) {
  if (!content) return normalizeCoachContent(null);
  if (typeof content !== "string") return normalizeCoachContent(content);
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

  return normalizeCoachContent(parsed);
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
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
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

function resolveSquadOwnerSteamId(body = {}) {
  return normalizeSteamId(body?.ownerSteamId) || normalizeSteamId(getSteamSession().steamId);
}

function validSquadSelection(roster) {
  return Array.isArray(roster)
    && roster.length >= 1
    && roster.length <= 5
    && selectionSteamIds(roster).length === roster.length;
}

function squadPlayerCoverage(candidates, availableMatches, roster, ownerSteamId) {
  const availableByPlayer = new Map();
  for (const match of Array.isArray(availableMatches) ? availableMatches : []) {
    for (const steamid of Array.isArray(match?.matchedPlayerIds) ? match.matchedPlayerIds : []) {
      const normalized = normalizeSteamId(steamid);
      if (!normalized) continue;
      if (!availableByPlayer.has(normalized)) availableByPlayer.set(normalized, new Set());
      availableByPlayer.get(normalized).add(String(match?.id || match?.matchId || ""));
    }
  }
  return partyPlayerCoverage(candidates, roster, ownerSteamId).map((item) => {
    const analyzedMatches = item.matchIds.length;
    const availableMatchesCount = availableByPlayer.get(item.player.steamid)?.size || 0;
    return {
      player: item.player,
      analyzedMatches,
      analyzedMatchIds: item.matchIds,
      availableMatches: availableMatchesCount,
      requiredDownloads: Math.max(0, SQUAD_MINIMUM_MATCHES - analyzedMatches),
      eligible: analyzedMatches >= SQUAD_MINIMUM_MATCHES,
    };
  });
}

function defaultSquadName(roster) {
  return (Array.isArray(roster) ? roster : [])
    .map((player) => String(player?.name || "").trim())
    .filter(Boolean)
    .join(", ") || "Takımım";
}

function pauseHeavyOperation(response, origin, operation) {
  const performance = getGamePerformanceStatus();
  if (!performance.active) return false;
  sendJson(response, 423, {
    ok: false,
    paused: true,
    performanceMode: true,
    error: `CS2 canlı maçta: ${operation} maç sonrasına ertelendi.`,
    performance,
  }, origin);
  return true;
}

function stopActiveDemoWorkers() {
  if (activeDemoWorkers.size === 0) return;
  console.log(`[PERF] CS2 maçı başladı; ${activeDemoWorkers.size} demo analiz worker'ı durduruluyor.`);
  for (const worker of [...activeDemoWorkers]) {
    activeDemoWorkers.delete(worker);
    void worker.terminate();
  }
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

function lightweightCoachStatus() {
  const cpuBinaryFound = existsSync(CPU_LLAMA_SERVER_PATH);
  const cudaBinaryFound = existsSync(CUDA_LLAMA_SERVER_PATH);
  const modelFound = existsSync(MODEL_PATH);
  const backend = activeCoachBackend || "deferred";
  return {
    available: (cpuBinaryFound || cudaBinaryFound) && modelFound,
    binaryFound: cpuBinaryFound || cudaBinaryFound,
    cpuBinaryFound,
    cudaBinaryFound,
    cudaAvailable: null,
    cudaDevice: "",
    cudaReason: "CS2 canlıyken CUDA aygıt taraması ertelendi.",
    backend,
    backendLabel: "Oyun Performans Modu · ertelendi",
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

function coachStatusForCurrentLoad() {
  return getGamePerformanceStatus().active ? lightweightCoachStatus() : coachStatus();
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

async function updateProgressStore(mutator) {
  // Okuma da yazma kuyruğunun içinde yapılır. Böylece arka planda tamamlanan
  // iki maç veya profil seçimi aynı anda gelirse eski bir snapshot son yazılan
  // gelişim kaydını ezemez.
  progressWriteQueue = progressWriteQueue.catch((err) => {
    console.warn("[PROGRESS] Önceki yazma hatası yutuldu:", err instanceof Error ? err.message : err);
  }).then(async () => {
    const current = await readProgressStore();
    const store = await mutator(current) || current;
    await mkdir(DATA_DIR, { recursive: true });
    const tempPath = `${PROGRESS_PATH}.${process.pid}.tmp`;
    await writeFile(tempPath, JSON.stringify(store), "utf8");
    await rm(PROGRESS_PATH, { force: true });
    await rename(tempPath, PROGRESS_PATH);
    return store;
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

function progressMatchFromAnalyzedMatch(match, report, summary = buildCompactSummaryFromReport(report)) {
  if (!match?.id || !report?.player || !summary) return null;
  return {
    id: String(match.id).slice(0, 400),
    date: Number(match.timestamp) || Date.now(),
    fileName: String(match.fileName || `${match.map || "match"}.dem`).slice(0, 260),
    map: String(report.map || match.map || "Bilinmeyen harita").slice(0, 80),
    playerSteamId: String(report.player.steamid || "").slice(0, 32),
    playerName: String(report.player.name || "Bilinmeyen oyuncu").slice(0, 80),
    summary,
  };
}

function upsertPersonalProgressMatch(store, match) {
  if (!store.profile || !match || !samePlayer({ steamid: match.playerSteamId, name: match.playerName }, store.profile)) return false;
  const otherPlayers = store.matches.filter((item) => !samePlayer({ steamid: item.playerSteamId, name: item.playerName }, store.profile));
  const playerMatches = [match, ...store.matches.filter((item) => samePlayer({ steamid: item.playerSteamId, name: item.playerName }, store.profile) && item.id !== match.id)]
    .sort((a, b) => b.date - a.date)
    .slice(0, 90);
  store.matches = [...playerMatches, ...otherPlayers].slice(0, 450);
  return true;
}

async function reconcileProgressWithAnalyzedMatches() {
  return updateProgressStore((store) => {
    if (!store.profile) return store;
    for (const match of getRecentMatches()) {
      const report = findPersonalReport(match, store.profile);
      const progressMatch = progressMatchFromAnalyzedMatch(match, report);
      if (progressMatch) upsertPersonalProgressMatch(store, progressMatch);
    }
    return store;
  });
}

async function handleProgress(request, response, origin) {
  if (request.method === "GET") {
    const store = await reconcileProgressWithAnalyzedMatches();
    const matches = store.profile
      ? store.matches.filter((item) => samePlayer({ steamid: item.playerSteamId, name: item.playerName }, store.profile)).sort((a, b) => b.date - a.date).slice(0, 90)
      : [];
    sendJson(response, 200, { profile: store.profile, matches }, origin);
    return;
  }
  if (request.method === "PUT") {
    const profile = cleanIdentity(await readJsonBody(request));
    await updateProgressStore((store) => ({ ...store, profile }));
    sendJson(response, 200, { profile }, origin);
    return;
  }
  if (request.method === "POST") {
    const body = await readJsonBody(request);
    let count = 0;
    await updateProgressStore((store) => {
      if (!store.profile) throw new Error("Önce demodaki kişisel oyuncunu seç.");
      const match = cleanProgressMatch(body, store.profile);
      if (!match.id) throw new Error("Maç kimliği eksik.");
      upsertPersonalProgressMatch(store, match);
      count = store.matches.filter((item) => samePlayer({ steamid: item.playerSteamId, name: item.playerName }, store.profile)).length;
      return store;
    });
    sendJson(response, 200, { ok: true, count }, origin);
    return;
  }
  sendJson(response, 405, { error: "Desteklenmeyen yöntem." }, origin);
}

function findPersonalReport(match, profile = null) {
  const reports = Array.isArray(match?.fullAnalysis?.reports) ? match.fullAnalysis.reports : [];
  const preferredSteamId = String(profile?.steamid || match?.userStats?.steamid || "");
  const preferredName = String(profile?.name || match?.userStats?.name || "");
  return reports.find((report) => preferredSteamId && String(report?.player?.steamid || "") === preferredSteamId)
    || reports.find((report) => preferredName && String(report?.player?.name || "") === preferredName)
    || null;
}

function comparisonMessage(comparison) {
  if (!comparison) return "Tam analiz hazır. Geçmiş karşılaştırması için yeterli canlı veri yoktu.";
  if (!comparison.sufficient) return comparison.kind === "overall"
    ? `Tam analiz hazır: %${comparison.value} KAST. Gelişim kıyası için en az 3 eski maç gerekli.`
    : `Canlı ön ölçüm: ${comparison.value} K/D. Gelişim kıyası için en az 3 eski maç gerekli.`;
  const sign = comparison.delta > 0 ? "+" : "";
  if (comparison.kind === "kd") return `Canlı ön ölçüm: ${comparison.value} K/D · geçmiş ortalamana göre ${sign}${comparison.delta}.`;
  return `Tam analiz: %${comparison.value} KAST · gelişim ortalamana göre ${sign}${comparison.delta} yüzde puanı.`;
}

async function progressContext() {
  try {
    return await readProgressStore();
  } catch (error) {
    console.warn("[BİLDİRİM] Gelişim hafızası okunamadı:", error instanceof Error ? error.message : String(error));
    return { profile: null, matches: [] };
  }
}

async function handleDiscoveredMatches(matches) {
  const progress = await progressContext();
  const created = matchAutomationStore.discover(matches, {
    liveState: getLiveState(),
    progressMatches: progress.matches,
    identity: progress.profile,
  });
  if (created.length === 0) return;
  console.log(`[BİLDİRİM] ${created.length} yeni maç bildirimi oluşturuldu.`);
  const automatic = created
    .filter((item) => item.auto)
    .sort((left, right) => Number(right.match?.timestamp) - Number(left.match?.timestamp))[0];
  if (automatic) {
    for (const older of created.filter((item) => item.auto && item.matchId !== automatic.matchId)) {
      matchAutomationStore.update(older.matchId, {
        auto: false,
        status: "detected",
        message: "Daha yeni maç otomatik sıraya alındı. Bu maçı istersen tıklayarak analiz edebilirsin.",
      });
    }
    const source = matches.find((match) => match.id === automatic.matchId) || automatic.match;
    queueMatchDownload(source, { automatic: true });
  }
}

async function handleMatchDownloadStatus(event) {
  if (!event?.matchId) return;
  matchDownloadQueueRevision += 1;
  if (event.status !== "ready" || !event.match) {
    const patch = {
      status: event.status,
      message: event.message || "Maç işleniyor.",
    };
    if (event.status === "failed") patch.read = false;
    matchAutomationStore.update(event.matchId, patch);
    return;
  }

  const progress = await progressContext();
  const report = findPersonalReport(event.match, progress.profile);
  const summary = buildCompactSummaryFromReport(report);
  const progressMatch = progressMatchFromAnalyzedMatch(event.match, report, summary);
  if (progressMatch && progress.profile) {
    await updateProgressStore((store) => {
      upsertPersonalProgressMatch(store, progressMatch);
      return store;
    });
  }
  const comparison = summary ? performanceComparison({
    summary,
    progressMatches: progress.matches,
    identity: progress.profile || event.match?.userStats || null,
    currentMatchId: event.matchId,
  }) : null;
  matchAutomationStore.update(event.matchId, {
    status: "ready",
    message: comparisonMessage(comparison),
    comparison,
    stats: summary?.stats || event.match?.userStats || null,
    summary: summary ? { overall: summary.overall, dimensions: summary.dimensions } : null,
    read: false,
    error: "",
  });
}

function scheduleQueueRetry(delayMs = 30_000) {
  if (autoDownloadRetryTimer) return;
  autoDownloadRetryTimer = setTimeout(() => {
    autoDownloadRetryTimer = null;
    void drainMatchDownloadQueue();
  }, delayMs);
}

function queueMatchDownload(match, { automatic = false } = {}) {
  if (getRecentMatchesStorageState().state !== "ready") return false;
  if (!match?.id) return false;
  const alreadyQueued = autoDownloadActiveMatchId === match.id || autoDownloadQueue.some((item) => item.match.id === match.id);
  if (alreadyQueued) return false;
  autoDownloadQueue.push({ match, automatic, attempts: 0 });
  matchDownloadQueueRevision += 1;
  matchAutomationStore.ensure(match, {
    status: "queued",
    auto: automatic,
    message: automatic
      ? "Otomatik indirme açık: maç sıraya alındı."
      : "İndirme ve analiz sırasına alındı.",
  });
  void drainMatchDownloadQueue();
  return true;
}

async function drainMatchDownloadQueue() {
  if (autoDownloadWorkerRunning || autoDownloadQueue.length === 0) return;
  if (getGamePerformanceStatus().active) {
    const pending = autoDownloadQueue[0];
    matchAutomationStore.update(pending.match.id, {
      status: "waiting",
      message: "CS2 canlı: performansı korumak için indirme maç sonrasına ertelendi.",
    });
    scheduleQueueRetry();
    return;
  }

  autoDownloadWorkerRunning = true;
  const queued = autoDownloadQueue.shift();
  autoDownloadActiveMatchId = queued.match.id;
  matchDownloadActiveStartedAt = Date.now();
  matchDownloadQueueRevision += 1;
  try {
    const alreadyDownloaded = getRecentMatches().find((match) => match.id === queued.match.id);
    if (alreadyDownloaded?.fullAnalysis) {
      await handleMatchDownloadStatus({ matchId: queued.match.id, status: "ready", match: alreadyDownloaded });
      return;
    }
    const result = await downloadSingleMatch(queued.match.id, queued.match.replayUrl || "", queued.match);
    if (result.paused) {
      autoDownloadQueue.unshift(queued);
      scheduleQueueRetry();
      return;
    }
    if (!result.ok) {
      if (result.cancelled) {
        matchAutomationStore.update(queued.match.id, {
          status: "cancelled",
          message: "İndirme ve analiz kullanıcı tarafından iptal edildi.",
          error: "",
        });
        return;
      }
      queued.attempts += 1;
      if (queued.attempts < 3) {
        matchAutomationStore.update(queued.match.id, {
          status: "waiting",
          message: `İndirme başarısız; ${queued.attempts + 1}. deneme bir dakika içinde yapılacak.`,
          error: result.message || "İndirme başarısız.",
        });
        autoDownloadQueue.unshift(queued);
        scheduleQueueRetry(60_000);
      } else {
        matchAutomationStore.update(queued.match.id, {
          status: "failed",
          message: "Üç deneme başarısız oldu. Yeniden denemek için bildirime tıkla.",
          error: result.message || "İndirme başarısız.",
          read: false,
        });
      }
    }
  } catch (error) {
    matchAutomationStore.update(queued.match.id, {
      status: "failed",
      message: "Beklenmeyen indirme hatası. Yeniden denemek için bildirime tıkla.",
      error: error instanceof Error ? error.message : String(error),
      read: false,
    });
  } finally {
    autoDownloadActiveMatchId = null;
    matchDownloadActiveStartedAt = 0;
    autoDownloadWorkerRunning = false;
    matchDownloadQueueRevision += 1;
    if (autoDownloadQueue.length > 0 && !autoDownloadRetryTimer) void drainMatchDownloadQueue();
  }
}

function cancelQueuedMatch(matchId) {
  const index = autoDownloadQueue.findIndex((item) => item.match.id === matchId);
  if (index < 0) return false;
  autoDownloadQueue.splice(index, 1);
  matchDownloadQueueRevision += 1;
  matchAutomationStore.update(matchId, {
    status: "cancelled",
    message: "Sıradaki indirme iptal edildi.",
    error: "",
  });
  return true;
}

function matchDownloadQueueState() {
  const queuedMatchIds = autoDownloadQueue.map((item) => item.match.id);
  const relevantIds = new Set([autoDownloadActiveMatchId, ...queuedMatchIds].filter(Boolean));
  const items = matchAutomationStore.listNotifications()
    .filter((item) => relevantIds.has(item.matchId))
    .map((item) => ({ matchId: item.matchId, status: item.status, message: item.message || "" }));
  return {
    activeMatchId: autoDownloadActiveMatchId,
    activeStartedAt: matchDownloadActiveStartedAt,
    queuedMatchIds,
    revision: matchDownloadQueueRevision,
    items,
  };
}

async function reconcileLatestAutomaticMatch(scannedMatches = getScannedMatches()) {
  if (getRecentMatchesStorageState().state !== "ready") return false;
  if (!matchAutomationStore.getSettings().autoDownloadLatestMatch) return false;
  const latest = latestUnanalyzedScannedMatch(scannedMatches, getRecentMatches());
  if (!latest) return false;
  const progress = await progressContext();
  matchAutomationStore.discover([latest], {
    liveState: getLiveState(),
    progressMatches: progress.matches,
    identity: progress.profile,
  });
  const queued = queueMatchDownload(latest, { automatic: true });
  if (queued) console.log(`[BİLDİRİM] Önbellekteki en yeni analiz edilmemiş maç otomatik sıraya alındı: ${latest.id}`);
  return queued;
}

function resumePendingMatchDownloads() {
  const settings = matchAutomationStore.getSettings();
  if (!settings.autoDownloadLatestMatch) return;
  const scanned = getScannedMatches();
  const pending = matchAutomationStore.listNotifications()
    .filter((item) => item.auto && ["queued", "waiting", "downloading", "analyzing"].includes(item.status))
    .sort((left, right) => Number(right.match?.timestamp) - Number(left.match?.timestamp));
  for (const item of pending.slice(0, 1)) {
    const match = scanned.find((candidate) => candidate.id === item.matchId) || item.match;
    queueMatchDownload(match, { automatic: true });
  }
}

steamEvents.on("matches-discovered", (matches) => {
  void handleDiscoveredMatches(matches).catch((error) => console.warn("[BİLDİRİM] Yeni maç işlenemedi:", error.message));
});
steamEvents.on("scan-complete", (matches) => {
  void reconcileLatestAutomaticMatch(matches).catch((error) => console.warn("[BİLDİRİM] Otomatik son maç telafisi başarısız:", error.message));
});
steamEvents.on("download-status", (event) => {
  void handleMatchDownloadStatus(event).catch((error) => console.warn("[BİLDİRİM] Durum güncellenemedi:", error.message));
});

// Ağır demo analizini ayrı worker thread'de çalıştır: büyük demolarda ana sunucu
// (GSI, koç, /health) bloklanmaz, uygulama "donmuş" gibi görünmez.
const ANALYZE_WORKER_TIMEOUT_MS = 5 * 60 * 1000;

async function runDemoWorker(filePath, operation = "analyze") {
  return new Promise((resolvePromise, rejectPromise) => {
    const workerPath = join(dirname(fileURLToPath(import.meta.url)), "analyze-worker.mjs");
    const worker = new Worker(workerPath, { workerData: { filePath, operation } });
    activeDemoWorkers.add(worker);
    analyzerRuntimeState = "loading";
    analyzerRuntimeError = "";
    let settled = false;
    const cleanupWorker = () => activeDemoWorkers.delete(worker);
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      cleanupWorker();
      if (error) {
        analyzerRuntimeState = "unavailable";
        analyzerRuntimeError = "Demo parser çalışma dosyası yüklenemedi veya analiz başarısız oldu.";
        rejectPromise(error);
      } else {
        analyzerRuntimeState = "ready";
        analyzerRuntimeError = "";
        resolvePromise(result);
      }
    };
    const timer = setTimeout(() => {
      void worker.terminate();
      finish(new Error("Demo analizi zaman aşımına uğradı (5 dk)."));
    }, ANALYZE_WORKER_TIMEOUT_MS);
    worker.once("message", (msg) => {
      if (msg?.ok) finish(null, msg.result);
      else finish(new Error(msg?.error || "Demo analizi başarısız oldu."));
    });
    worker.once("error", (err) => finish(err));
    worker.once("exit", (code) => {
      if (!settled && code !== 0) finish(new Error(`Analiz iş parçacığı beklenmedik şekilde kapandı (${code}).`));
    });
  });
}

function analyzeDemoInWorker(filePath) {
  return runDemoWorker(filePath, "analyze");
}

function quickDemoMetaInWorker(filePath) {
  return runDemoWorker(filePath, "quick-meta");
}

async function waitForCoachServer(child, backend, timeoutMs = 90000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (child.spawnError) {
      throw new Error(`${backend === "cuda" ? "CUDA" : "CPU"} koç motoru başlatılamadı: ${child.spawnError.message}`);
    }
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
  // spawn hatası (ENOENT vb.) unhandled 'error' event'i olarak process'i çökertmesin
  child.spawnError = null;
  child.on("error", (err) => {
    child.spawnError = err;
    console.error("[COACH] llama-server başlatma hatası:", err.message);
  });
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
        validateCoachContent(content),
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
  // Tarayıcı dışı istemciler Origin göndermez; yalnızca CS2 oyun istemcisinin GSI
  // POST'u Originsiz kabul edilir. Diğer tüm değiştirici istekler (shutdown, update,
  // steam oturumu, maç silme...) yalnızca yetkili tarayıcı origin'inden gelebilir.
  const isGsiPost = request.method === "POST" && request.url === "/gsi";
  if (!isGsiPost && ["POST", "PUT", "DELETE"].includes(request.method || "") && !ALLOWED_ORIGINS.has(origin)) {
    sendJson(response, 403, { error: "Bu istek yalnızca TRACER arayüzünden gönderilebilir." });
    return;
  }
  if (request.method === "GET" && request.url === "/health") {
    const performance = getGamePerformanceStatus();
    sendJson(response, 200, {
      ok: true,
      parserVersion: "0.42.0",
      parser: {
        state: analyzerRuntimeState,
        ready: analyzerRuntimeState !== "unavailable",
        message: analyzerRuntimeState === "ready"
          ? "Demo parser hazır."
          : analyzerRuntimeState === "idle"
            ? "Demo parser gerektiğinde ayrı iş parçacığında başlatılacak."
          : analyzerRuntimeState === "loading"
            ? "Demo parser ayrı iş parçacığında çalışıyor."
            : analyzerRuntimeError,
      },
      matchHistory: getRecentMatchesStorageState(),
      mode: "local-native",
      performance,
      coach: performance.active ? lightweightCoachStatus() : coachStatus(),
    }, origin);
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
      } catch {
        // Sunucu zaten kapanıyor; koç sürecinin daha önce sonlanmış olması güvenlidir.
      }
      server.close(() => process.exit(0));
      setTimeout(() => process.exit(0), 1000);
    }, 100);
    return;
  }
  if (request.method === "GET" && request.url === "/coach/status") {
    sendJson(response, 200, coachStatusForCurrentLoad(), origin);
    return;
  }
  if (request.method === "GET" && request.url === "/performance/status") {
    sendJson(response, 200, {
      ok: true,
      performance: getGamePerformanceStatus(),
      gsi: checkGsiStatus(),
      heavyJobs: {
        coachRunning: Boolean(coachProcess && coachProcess.exitCode === null),
        coachBusy,
        demoWorkers: activeDemoWorkers.size,
      },
    }, origin);
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
      if (getGamePerformanceStatus().active) {
        const fallbackStatus = lightweightCoachStatus();
        sendJson(response, 200, {
          content: JSON.stringify(deterministicFallback),
          model: fallbackStatus.model,
          backend: "paused",
          backendLabel: "Oyun Performans Modu",
          generated: false,
          warning: "CS2 canlı maçta olduğu için yerel AI çalıştırılmadı; kanıta dayalı hazır rapor kullanıldı.",
          released: true,
          performanceMode: true,
        }, origin);
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
        const fallbackStatus = coachStatusForCurrentLoad();
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
    if (pauseHeavyOperation(response, origin, "güncelleme indirme ve kurma işlemi")) return;
    try {
      const body = await readJsonBody(request, 64 * 1024);
      const res = await downloadAndApplyPatch(body?.patchUrl, { expectedSha256: body?.expectedSha256 });
      sendJson(response, 200, res, origin);
      if (res?.needsRestart) {
        // Yanıtı önce gönder, sonra yeni sürümü başlat ve bu process'i kapat.
        setTimeout(() => {
          const spawned = restartApplication();
          console.log(spawned ? "[UPDATER] Yeni sürüm başlatıldı, eski process kapanıyor." : "[UPDATER] Başlatıcı bulunamadı; lütfen TRACER'ı elle yeniden başlatın.");
          setTimeout(async () => {
            try {
              await stopCoachProcess();
            } catch {
              // Yeniden başlatma sırasında süreç daha önce kapanmış olabilir.
            }
            server.close(() => process.exit(0));
            setTimeout(() => process.exit(0), 1500);
          }, 750);
        }, 400);
      }
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

  if (request.method === "GET" && (request.url === "/gsi/state" || request.url === "/gsi/live")) {
    sendJson(response, 200, getLiveState(), origin);
    return;
  }

  if (request.method === "POST" && request.url === "/gsi") {
    let body = "";
    let gsiBytes = 0;
    const GSI_LIMIT = 256 * 1024; // GSI paketleri birkaç KB'tır; 256 KB fazlasıyla yeterli
    let gsiTooLarge = false;
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      gsiBytes += Buffer.byteLength(chunk);
      if (gsiBytes > GSI_LIMIT) {
        gsiTooLarge = true;
        request.destroy();
        return;
      }
      body += chunk;
    });
    request.on("error", () => { /* soket hatası: yanıt zaten gidemedi, sadece yut */ });
    request.on("end", () => {
      if (gsiTooLarge) {
        sendJson(response, 413, { error: "GSI paketi çok büyük." }, origin);
        return;
      }
      try {
        const json = JSON.parse(body);
        processGsiPacket(json);
        const gamePerformance = getGamePerformanceStatus();
        if (gamePerformance.active) {
          stopActiveDemoWorkers();
          if (coachProcess && coachProcess.exitCode === null) {
            console.log("[PERF] CS2 maçı başladı; yerel AI süreci kapatılıyor.");
            void stopCoachProcess();
          }
        }
        if (previousGamePerformanceActive && !gamePerformance.active) {
          console.log("[BİLDİRİM] Maç sonu algılandı; Steam replay kaydı kısa süre sonra kontrol edilecek.");
          void drainMatchDownloadQueue();
          setTimeout(() => {
            void scanSteamGcpdMatches().catch((error) => console.warn("[BİLDİRİM] Maç sonu taraması başarısız:", error.message));
          }, 20_000);
        }
        previousGamePerformanceActive = gamePerformance.active;
        reconcileActiveSquadSessions(squadStore, getLiveState());
        sendJson(response, 200, { ok: true }, origin);
      } catch {
        sendJson(response, 400, { error: "Geçersiz GSI JSON paketi." }, origin);
      }
    });
    return;
  }

  // --- Maç Sonu Bildirim, Depolama ve Otomasyon Uç Noktaları ---
  if (request.method === "GET" && request.url === "/automation/state") {
    sendJson(response, 200, { ok: true, ...matchAutomationStore.state(join(DATA_DIR, "recent_demos"), getRecentMatches()) }, origin);
    return;
  }

  if (request.method === "PUT" && request.url === "/automation/settings") {
    try {
      const body = await readJsonBody(request, 16 * 1024);
      const settings = matchAutomationStore.saveSettings(body);
      applyConfiguredDemoRetention();
      if (settings.autoDownloadLatestMatch) {
        void reconcileLatestAutomaticMatch().catch((error) => console.warn("[BİLDİRİM] Ayar sonrası otomatik son maç başlatılamadı:", error.message));
      }
      sendJson(response, 200, {
        ok: true,
        settings,
        storage: getDemoStorageState(),
      }, origin);
    } catch (error) {
      sendJson(response, 422, { error: error instanceof Error ? error.message : String(error) }, origin);
    }
    return;
  }

  if (request.method === "POST" && request.url === "/notifications/read-all") {
    const notifications = matchAutomationStore.markAllRead();
    sendJson(response, 200, { ok: true, notifications, unreadCount: 0 }, origin);
    return;
  }

  if (request.method === "DELETE" && request.url === "/notifications") {
    matchAutomationStore.saveNotifications([]);
    sendJson(response, 200, { ok: true, notifications: [], unreadCount: 0 }, origin);
    return;
  }

  const notificationReadMatch = request.url?.match(/^\/notifications\/([^/]+)\/read$/);
  if (notificationReadMatch && request.method === "POST") {
    const notificationId = decodeURIComponent(notificationReadMatch[1]);
    const notification = matchAutomationStore.update(notificationId, { read: true });
    sendJson(response, notification ? 200 : 404, notification ? { ok: true, notification } : { error: "Bildirim bulunamadı." }, origin);
    return;
  }

  const notificationActionMatch = request.url?.match(/^\/notifications\/([^/]+)\/action$/);
  if (notificationActionMatch && request.method === "POST") {
    const notificationId = decodeURIComponent(notificationActionMatch[1]);
    const notification = matchAutomationStore.listNotifications().find((item) => item.id === notificationId || item.matchId === notificationId);
    if (!notification) {
      sendJson(response, 404, { error: "Bildirim bulunamadı." }, origin);
      return;
    }
    matchAutomationStore.update(notification.matchId, { read: true });
    if (notification.status === "ready") {
      const match = getRecentMatches().find((item) => item.id === notification.matchId);
      if (match?.fullAnalysis) {
        sendJson(response, 200, { ok: true, ready: true, match: matchSummaryForClient(match), analysis: match.fullAnalysis }, origin);
      } else {
        sendJson(response, 404, { error: "Analiz kaydı bulunamadı; bildirimi yeniden deneyin." }, origin);
      }
      return;
    }
    if (["queued", "waiting", "downloading", "analyzing", "cancelling"].includes(notification.status)) {
      sendJson(response, 202, { ok: true, queued: true, notification: matchAutomationStore.update(notification.matchId, { read: true }) }, origin);
      return;
    }
    const scannedMatch = getScannedMatches().find((item) => item.id === notification.matchId);
    if (!scannedMatch?.replayUrl) {
      sendJson(response, 409, { error: "Replay henüz Steam geçmişinde hazır değil. Bir sonraki taramada tekrar deneyin." }, origin);
      return;
    }
    matchAutomationStore.update(notification.matchId, {
      status: "queued",
      message: "İndirme ve analiz sırasına alındı.",
      error: "",
    });
    queueMatchDownload(scannedMatch, { automatic: false });
    sendJson(response, 202, { ok: true, queued: true, notification: matchAutomationStore.listNotifications().find((item) => item.matchId === notification.matchId) }, origin);
    return;
  }

  // --- Steam GCPD Replay Otomatik Tarayıcı, İndirici & Analiz Uç Noktaları ---
  if (request.method === "GET" && request.url === "/steam/status") {
    const session = getSteamSession();
    const connection = getSteamConnectionHealth(session);
    const matches = getRecentMatches();
    const scanned = getScannedMatches();
    sendJson(response, 200, {
      ok: true,
      hasSession: Boolean(session.steamLoginSecure),
      connection,
      session: {
        steamLoginSecureMasked: session.steamLoginSecure ? `${session.steamLoginSecure.substring(0, 8)}...` : "",
        sessionid: session.sessionid || "",
        lastSyncTime: session.lastSyncTime || 0,
        lastScanTime: session.lastScanTime || 0,
        matchLimit: session.matchLimit || 5,
        autoScanEnabled: session.autoScanEnabled !== false,
        autoScanIntervalMinutes: session.autoScanIntervalMinutes || 5,
      },
      matchesCount: matches.length,
      scannedCount: scanned.length,
    }, origin);
    return;
  }

  if (request.method === "POST" && request.url === "/steam/session") {
    try {
      const body = await readJsonBody(request, 16 * 1024);
      if (Object.hasOwn(body || {}, "steamLoginSecure") && body.steamLoginSecure && !extractSteamIdFromCookie(body.steamLoginSecure)) {
        sendJson(response, 400, {
          error: "steamLoginSecure değeri okunamadı. Yalnız çerez değerini veya 'steamLoginSecure=...' biçimini yapıştırın; Steam Web API key bu alanda çalışmaz.",
        }, origin);
        return;
      }
      const updated = saveSteamSession(body);
      sendJson(response, 200, {
        ok: true,
        session: {
          steamId: updated.steamId || "",
          hasSession: Boolean(updated.steamLoginSecure),
          sessionid: updated.sessionid || "",
          autoScanEnabled: updated.autoScanEnabled !== false,
        },
      }, origin);
    } catch (err) {
      sendJson(response, 400, { error: err.message }, origin);
    }
    return;
  }

  if (request.method === "GET" && request.url === "/steam/scanned") {
    const session = getSteamSession();
    const scanned = getScannedMatches();
    const matches = getRecentMatches();
    sendJson(response, 200, {
      ok: true,
      hasSession: Boolean(session.steamLoginSecure),
      scannedMatches: scanned,
      matches: matchSummariesForClient(matches),
      lastScanTime: session.lastScanTime || 0,
      autoScanEnabled: session.autoScanEnabled !== false,
    }, origin);
    return;
  }

  if (request.method === "POST" && request.url === "/steam/scan-now") {
    try {
      const result = await scanSteamGcpdMatches(true);
      repairExistingMatchDates();
      sendJson(response, 200, steamResultForClient(result), origin);
    } catch (err) {
      sendJson(response, 500, { error: err.message }, origin);
    }
    return;
  }

  if (request.method === "GET" && request.url === "/steam/download-queue") {
    sendJson(response, 200, { ok: true, ...matchDownloadQueueState() }, origin);
    return;
  }

  if (request.method === "POST" && request.url === "/steam/download-queue") {
    try {
      const body = await readJsonBody(request, 64 * 1024);
      const matchId = String(body?.matchId || "");
      if (!matchId) {
        sendJson(response, 400, { error: "matchId parametresi gerekli." }, origin);
        return;
      }

      if (autoDownloadActiveMatchId === matchId) {
        const cancelled = cancelSingleMatch(matchId);
        if (cancelled) {
          matchAutomationStore.update(matchId, { status: "cancelling", message: "Etkin indirme ve analiz durduruluyor." });
          matchDownloadQueueRevision += 1;
        }
        sendJson(response, 200, { ok: true, action: cancelled ? "cancelling" : "unchanged", ...matchDownloadQueueState() }, origin);
        return;
      }

      if (cancelQueuedMatch(matchId)) {
        sendJson(response, 200, { ok: true, action: "cancelled", ...matchDownloadQueueState() }, origin);
        return;
      }

      if (historyMaintenanceResponse(response, origin)) return;

      const match = getScannedMatches().find((item) => item.id === matchId) || body.matchMeta;
      if (!match?.id || !match?.replayUrl) {
        sendJson(response, 404, { error: "Maçın replay bilgisi bulunamadı." }, origin);
        return;
      }
      const queued = queueMatchDownload(match, { automatic: false });
      sendJson(response, queued ? 202 : 200, { ok: true, action: queued ? "queued" : "unchanged", ...matchDownloadQueueState() }, origin);
    } catch (error) {
      sendJson(response, 422, { error: error instanceof Error ? error.message : String(error) }, origin);
    }
    return;
  }

  if (request.method === "POST" && request.url === "/steam/download-match") {
    if (historyMaintenanceResponse(response, origin)) return;
    if (pauseHeavyOperation(response, origin, "replay indirme ve demo analizi")) return;
    try {
      const body = await readJsonBody(request, 64 * 1024);
      if (!body?.matchId) {
        sendJson(response, 400, { error: "matchId parametresi gerekli." }, origin);
        return;
      }
      const result = await downloadSingleMatch(body.matchId, body.replayUrl || "", body.matchMeta || {});
      sendJson(response, result.ok ? 200 : 400, steamResultForClient(result), origin);
    } catch (err) {
      sendJson(response, 500, { error: err.message }, origin);
    }
    return;
  }

  if (request.method === "POST" && request.url === "/steam/sync-now") {
    if (pauseHeavyOperation(response, origin, "Steam eşitleme ve replay indirme")) return;
    try {
      const result = await syncSteamGcpdMatches();
      sendJson(response, 200, steamResultForClient(result), origin);
    } catch (err) {
      sendJson(response, 500, { error: err.message }, origin);
    }
    return;
  }

  if (request.method === "GET" && request.url === "/matches/recent") {
    const matches = getRecentMatches();
    const scanned = getScannedMatches();
    const session = getSteamSession();
    const connection = getSteamConnectionHealth(session);
    const automationSettings = matchAutomationStore.getSettings();
    sendJson(response, 200, {
      ok: true,
      matches: matchSummariesForClient(matches),
      scannedMatches: scanned,
      hasSession: Boolean(session.steamLoginSecure),
      connection,
      downloadQueue: matchDownloadQueueState(),
      demoStorage: getDemoStorageState(),
      demoRetentionCount: automationSettings.demoRetentionCount,
      historyStorage: getRecentMatchesStorageState(),
      session: {
        sessionid: session.sessionid || "",
        lastSyncTime: session.lastSyncTime || 0,
        lastScanTime: session.lastScanTime || 0,
        matchLimit: session.matchLimit || 5,
        autoScanEnabled: session.autoScanEnabled !== false,
      },
    }, origin);
    return;
  }

  // --- Değişken Oyunculu Takım Koçu Arşivi ---
  if (request.method === "GET" && request.url === "/squads/matches") {
    const imported = squadStore.ingestMatches(getRecentMatches(), getScannedMatches());
    sendJson(response, 200, { ok: true, imported: imported.imported, matches: imported.matches }, origin);
    return;
  }

  if (request.method === "GET" && request.url === "/squads") {
    sendJson(response, 200, { ok: true, squads: squadStore.listSquads() }, origin);
    return;
  }

  if (request.method === "POST" && request.url === "/squads/ingest") {
    const imported = squadStore.ingestMatches(getRecentMatches(), getScannedMatches());
    sendJson(response, 200, imported, origin);
    return;
  }

  if (request.method === "POST" && request.url === "/squads/discover") {
    try {
      const body = await readJsonBody(request, 128 * 1024);
      const roster = Array.isArray(body?.roster) ? body.roster : [];
      const map = String(body?.map || "");
      if (!validSquadSelection(roster) || !map) {
        sendJson(response, 400, { error: "Keşif için 1–5 arasında benzersiz oyuncu ve harita gerekli." }, origin);
        return;
      }
      const ownerSteamId = resolveSquadOwnerSteamId(body);

      const scan = body?.refresh === false
        ? { ok: true, cached: true, message: "Kayıtlı Steam taraması kullanıldı.", scannedMatches: getScannedMatches() }
        : await scanSteamGcpdMatches();
      const scannedMatches = Array.isArray(scan?.scannedMatches) ? scan.scannedMatches : getScannedMatches();
      squadStore.ingestMatches(getRecentMatches(), scannedMatches);
      const archivedMatches = squadStore.listMatches();
      const candidates = squadStore.partyCandidates(roster, map, ownerSteamId);
      const analyzedCoverage = partyPlayerCoverage(candidates, roster, ownerSteamId);
      const allAvailableMatches = findPartyDiscoveries(scannedMatches, archivedMatches, roster, map, ownerSteamId);
      const availableMatches = selectPartyDiscoveryMatches(allAvailableMatches, analyzedCoverage, {
        minimumMatches: SQUAD_MINIMUM_MATCHES,
      });
      const coverage = squadPlayerCoverage(candidates, availableMatches, roster, ownerSteamId);

      sendJson(response, 200, {
        ok: true,
        ownerSteamId,
        scan: {
          ok: Boolean(scan?.ok),
          busy: Boolean(scan?.busy),
          cached: Boolean(scan?.cached),
          requiresLogin: Boolean(scan?.requiresLogin),
          message: String(scan?.message || ""),
        },
        candidates,
        availableMatches,
        allAvailableMatches,
        coverage,
        eligible: coverage.length > 0 && coverage.every((item) => item.eligible),
        minimumMatches: SQUAD_MINIMUM_MATCHES,
      }, origin);
    } catch (err) {
      sendJson(response, 400, { error: err instanceof Error ? err.message : String(err) }, origin);
    }
    return;
  }

  if (request.method === "POST" && request.url === "/squads/download") {
    try {
      const body = await readJsonBody(request, 256 * 1024);
      const roster = Array.isArray(body?.roster) ? body.roster : [];
      const map = String(body?.map || "");
      const requestedIds = new Set(Array.isArray(body?.matchIds) ? body.matchIds.map(String) : []);
      if (!validSquadSelection(roster) || !map || requestedIds.size === 0) {
        sendJson(response, 400, { error: "İndirme için 1–5 benzersiz oyuncu, harita ve en az bir maç gerekli." }, origin);
        return;
      }
      const ownerSteamId = resolveSquadOwnerSteamId(body);
      if (pauseHeavyOperation(response, origin, "takım replay'lerini indirme ve analiz etme")) return;

      squadStore.ingestMatches(getRecentMatches(), getScannedMatches());
      const availableMatches = findPartyDiscoveries(getScannedMatches(), squadStore.listMatches(), roster, map, ownerSteamId)
        .filter((match) => requestedIds.has(String(match.id)));
      const results = [];
      for (const match of availableMatches) {
        const result = await downloadSingleMatch(match.id, match.replayUrl, match);
        results.push({ id: match.id, ok: Boolean(result?.ok), message: String(result?.message || "") });
      }

      squadStore.ingestMatches(getRecentMatches(), getScannedMatches());
      const candidates = squadStore.partyCandidates(roster, map, ownerSteamId);
      const coverage = squadPlayerCoverage(candidates, [], roster, ownerSteamId);
      const downloaded = results.filter((result) => result.ok);
      const failed = results.filter((result) => !result.ok);
      sendJson(response, 200, {
        ok: true,
        complete: failed.length === 0 && downloaded.length === requestedIds.size,
        requested: requestedIds.size,
        downloaded,
        failed,
        candidates,
        coverage,
        eligible: coverage.length > 0 && coverage.every((item) => item.eligible),
      }, origin);
    } catch (err) {
      sendJson(response, 422, { error: err instanceof Error ? err.message : String(err) }, origin);
    }
    return;
  }

  if (request.method === "POST" && request.url === "/squads/candidates") {
    try {
      const body = await readJsonBody(request, 128 * 1024);
      squadStore.ingestMatches(getRecentMatches(), getScannedMatches());
      const seedMatch = body?.seedMatchId ? squadStore.getMatch(body.seedMatchId) : null;
      const roster = Array.isArray(body?.roster) ? body.roster : [];
      const map = body?.map || seedMatch?.map || "";
      const ownerSteamId = resolveSquadOwnerSteamId(body) || normalizeSteamId(seedMatch?.userStats?.steamid);
      const candidates = validSquadSelection(roster) ? squadStore.partyCandidates(roster, map, ownerSteamId) : [];
      const coverage = validSquadSelection(roster) ? squadPlayerCoverage(candidates, [], roster, ownerSteamId) : [];
      sendJson(response, 200, {
        ok: true,
        ownerSteamId,
        seedMatch,
        teams: seedMatch?.teams || [],
        candidates,
        coverage,
        eligible: coverage.length > 0 && coverage.every((item) => item.eligible),
        minimumMatches: SQUAD_MINIMUM_MATCHES,
      }, origin);
    } catch (err) {
      sendJson(response, 400, { error: err instanceof Error ? err.message : String(err) }, origin);
    }
    return;
  }

  if (request.method === "POST" && request.url === "/squads/evidence") {
    try {
      const body = await readJsonBody(request, 256 * 1024);
      squadStore.ingestMatches(getRecentMatches(), getScannedMatches());
      const selectedIds = new Set(Array.isArray(body?.selectedMatchIds) ? body.selectedMatchIds.map(String) : []);
      const sourceMatches = selectedIds.size
        ? squadStore.listMatches().filter((match) => selectedIds.has(match.id))
        : squadStore.listMatches();
      const evidence = buildSquadEvidence(sourceMatches, body?.roster, body?.map, {
        ownerSteamId: resolveSquadOwnerSteamId(body),
      });
      sendJson(response, 200, { ok: true, evidence }, origin);
    } catch (err) {
      sendJson(response, Number(err?.statusCode) || 422, {
        error: err instanceof Error ? err.message : String(err),
        details: err?.details || null,
      }, origin);
    }
    return;
  }

  if (request.method === "POST" && request.url === "/squads/report") {
    try {
      const body = await readJsonBody(request, 512 * 1024);
      squadStore.ingestMatches(getRecentMatches(), getScannedMatches());
      const selectedIds = new Set(Array.isArray(body?.selectedMatchIds) ? body.selectedMatchIds.map(String) : []);
      const sourceMatches = selectedIds.size
        ? squadStore.listMatches().filter((match) => selectedIds.has(match.id))
        : squadStore.listMatches();
      const ownerSteamId = resolveSquadOwnerSteamId(body);
      const report = buildSquadReport(sourceMatches, body?.roster, body?.map, { ownerSteamId });
      const squad = squadStore.saveSquad({
        roster: body?.roster,
        map: body?.map,
        ownerSteamId,
        name: body?.name || defaultSquadName(body?.roster),
        selectedMatchIds: report.evidence.matchIds,
        report,
      });
      sendJson(response, 200, { ok: true, squad, report }, origin);
    } catch (err) {
      sendJson(response, Number(err?.statusCode) || 422, {
        error: err instanceof Error ? err.message : String(err),
        details: err?.details || null,
      }, origin);
    }
    return;
  }

  const squadLiveMatch = request.url?.match(/^\/squads\/([^/]+)\/live(?:\/(start|feedback|stop))?$/);
  if (squadLiveMatch) {
    try {
      const squadId = decodeURIComponent(squadLiveMatch[1]);
      const action = squadLiveMatch[2] || "state";
      const squad = squadStore.getSquad(squadId);
      if (!squad) {
        sendJson(response, 404, { error: "Takım raporu bulunamadı." }, origin);
        return;
      }
      if (request.method === "POST" && action === "start") {
        const session = reconcileLiveSession(startLiveSession(squad), squad.report, getLiveState());
        squadStore.saveLiveSession(squadId, session);
        sendJson(response, 200, { ok: true, session, squad }, origin);
        return;
      }
      if (request.method === "POST" && action === "feedback") {
        const body = await readJsonBody(request, 64 * 1024);
        const current = squadStore.getLiveSession(squadId) || startLiveSession(squad);
        const session = applyLiveFeedback(current, squad.report, body);
        squadStore.saveLiveSession(squadId, session);
        if (body?.notes !== undefined) squadStore.updateNotes(squadId, body.notes);
        sendJson(response, 200, { ok: true, session }, origin);
        return;
      }
      if (request.method === "POST" && action === "stop") {
        const current = squadStore.getLiveSession(squadId) || startLiveSession(squad);
        const session = { ...current, active: false, currentPlan: null, updatedAt: Date.now() };
        squadStore.saveLiveSession(squadId, session);
        sendJson(response, 200, { ok: true, session }, origin);
        return;
      }
      if (request.method === "GET" && action === "state") {
        const current = squadStore.getLiveSession(squadId);
        if (!current) {
          sendJson(response, 404, { error: "Canlı takım oturumu başlatılmadı." }, origin);
          return;
        }
        const session = reconcileLiveSession(current, squad.report, getLiveState());
        squadStore.saveLiveSession(squadId, session);
        sendJson(response, 200, { ok: true, session, squad }, origin);
        return;
      }
      sendJson(response, 405, { error: "Desteklenmeyen canlı takım işlemi." }, origin);
    } catch (err) {
      sendJson(response, 422, { error: err instanceof Error ? err.message : String(err) }, origin);
    }
    return;
  }

  const squadNotesMatch = request.url?.match(/^\/squads\/([^/]+)\/notes$/);
  if (squadNotesMatch && request.method === "PUT") {
    try {
      const squadId = decodeURIComponent(squadNotesMatch[1]);
      const body = await readJsonBody(request, 32 * 1024);
      const squad = squadStore.updateNotes(squadId, body?.notes);
      if (!squad) sendJson(response, 404, { error: "Takım raporu bulunamadı." }, origin);
      else sendJson(response, 200, { ok: true, squad }, origin);
    } catch (err) {
      sendJson(response, 422, { error: err instanceof Error ? err.message : String(err) }, origin);
    }
    return;
  }

  if (request.method === "GET" && request.url?.startsWith("/matches/detail/")) {
    const matchId = request.url.replace("/matches/detail/", "");
    const matches = getRecentMatches();
    let found = matches.find((m) => m.id === matchId);
    if (found && found.fullAnalysis) {
      const sprayCurrent = found.fullAnalysis.analysisVersion === ANALYSIS_VERSION
        && (found.fullAnalysis.reports || []).every((report) => report.sprayStats?.method === "bullet-damage-event-tick-v2");
      let reanalyzed = false;
      let reanalysisError = "";
      if (!sprayCurrent && found.demoPath && existsSync(found.demoPath)) {
        try {
          found = await processDownloadedDemo(
            found.demoPath,
            found.source || "steam_gcpd",
            found.id,
            found.timestamp || null,
            found.formattedDate || null,
            found.map || null
          );
          reanalyzed = true;
        } catch (error) {
          reanalysisError = error instanceof Error ? error.message : String(error);
        }
      } else if (!sprayCurrent) {
        reanalysisError = "Ham .dem dosyası saklama kotasında artık bulunmuyor; eski sprey sıfırları gösterilmeyecek.";
      }
      const needsReanalysis = found.fullAnalysis.analysisVersion !== ANALYSIS_VERSION
        || (found.fullAnalysis.reports || []).some((report) => report.sprayStats?.method !== "bullet-damage-event-tick-v2");
      sendJson(response, 200, {
        ok: true,
        match: matchSummaryForClient(found),
        analysis: found.fullAnalysis,
        reanalyzed,
        needsReanalysis,
        reanalysisError: reanalysisError || undefined,
      }, origin);
    } else {
      sendJson(response, 404, { error: "Maç analizi bulunamadı." }, origin);
    }
    return;
  }

  if (request.method === "DELETE" && request.url?.startsWith("/matches/")) {
    const matchId = request.url.replace("/matches/", "");
    const ok = await deleteSteamMatch(matchId);
    sendJson(response, ok ? 200 : 404, {
      ok,
      message: ok ? "Maç silindi" : "Maç bulunamadı",
      matches: matchSummariesForClient(getRecentMatches()),
      scannedMatches: getScannedMatches(),
      demoStorage: getDemoStorageState(),
    }, origin);
    return;
  }

  if (request.method === "POST" && request.url === "/quick-meta") {
    if (pauseHeavyOperation(response, origin, "demo bilgisi okuma")) return;
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
      console.log(`[PARSER] Hızlı demo bilgisi okunuyor: ${safeName}`);
      const meta = await quickDemoMetaInWorker(tempPath);
      console.log(`[PARSER] Hızlı demo bilgisi hazır: ${meta.map || "Bilinmeyen harita"}`);
      sendJson(response, 200, { ok: true, meta }, origin);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[PARSER] Hızlı demo hatası (${safeName}):`, message);
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

  if (pauseHeavyOperation(response, origin, "demo analizi")) return;

  const announcedSize = Number(request.headers["content-length"] || 0);
  if (announcedSize > MAX_DEMO_BYTES) {
    console.warn(`[PARSER] Demo boyutu reddedildi (800MB sınırı): ${announcedSize} bytes`);
    sendJson(response, 413, { error: "Demo 800 MB sınırını aşıyor." }, origin);
    return;
  }

  const rawName = String(request.headers["x-file-name"] || "match.dem");
  let decodedName = rawName;
  try { decodedName = decodeURIComponent(rawName); } catch { /* basename still sanitizes it */ }
  const safeName = basename(decodedName).replace(/[^a-zA-Z0-9._-]/g, "_");
  if (!safeName.toLowerCase().endsWith(".dem")) {
    console.warn(`[PARSER] Geçersiz dosya uzantısı: ${safeName}`);
    sendJson(response, 400, { error: "Yalnızca .dem dosyaları kabul edilir." }, origin);
    return;
  }

  const workDir = join(tmpdir(), "tracer-cs2");
  const tempPath = join(workDir, `${randomUUID()}-${safeName}`);
  console.log(`[PARSER] Demo sunucuya yükleniyor: ${safeName}`);

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
    console.log(`[PARSER] Demo parse ediliyor (worker thread, Valve CS2 Native Engine)... ${safeName}`);
    const result = await analyzeDemoInWorker(tempPath);
    console.log(`[PARSER] Analiz tamamlandı! (${result.players?.length || 0} oyuncu tespit edildi, harita: ${result.header?.map_name || "N/A"})`);
    sendJson(response, 200, result, origin);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[PARSER] Demo analizi sırasında hata (${safeName}):`, message);
    sendJson(response, 422, { error: message }, origin);
  } finally {
    await rm(tempPath, { force: true }).catch(() => {});
  }
});

server.listen(PORT, HOST, () => {
  console.log(`TRACER yerel parser hazır: http://${HOST}:${PORT}`);
  console.log("Bu pencere açık kaldığı sürece güncel Valve demoları analiz edilebilir.");
  // Büyük eski geçmişler ayrı iş parçacığında küçültülür. HTTP/GSI servisi bu
  // sırada hazır kalır; bakım ve otomatik indirme ancak kayıt güvenle açılınca başlar.
  void prepareRecentMatchesStorage()
    .then(() => {
      repairExistingMatchDates();
      applyConfiguredDemoRetention();
      resumePendingMatchDownloads();
      return reconcileLatestAutomaticMatch();
    })
    .catch((error) => console.warn("[STEAM-GCPD] Başlangıç veri bakımı uyarısı:", error.message));
  if (process.env.TRACER_SKIP_GSI_AUTO_OPTIMIZE !== "1") {
    void optimizeInstalledGsiConfig()
      .then((result) => {
        if (result.updated) console.log("[PERF] Eski TRACER GSI dosyası performans-v2 profiline yükseltildi; CS2 yeniden başlatılmalı.");
      })
      .catch((error) => console.warn("[PERF] GSI performans profili otomatik güncellenemedi:", error.message));
  }
  startAutoScanScheduler(5 * 60 * 1000);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, async () => {
    await stopCoachProcess();
    server.close(() => process.exit(0));
  });
}
