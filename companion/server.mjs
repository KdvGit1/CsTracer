import { createServer } from "node:http";
import { createWriteStream } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { randomUUID } from "node:crypto";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { analyzeDemo } from "./analyze.mjs";

const HOST = "127.0.0.1";
const PORT = 43119;
const MAX_DEMO_BYTES = 800 * 1024 * 1024;
const ALLOWED_ORIGINS = new Set([
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "https://tracer-cs2-lab.vuraldoan.chatgpt.site",
]);

function corsHeaders(origin) {
  const allowedOrigin = ALLOWED_ORIGINS.has(origin) ? origin : "";
  return {
    ...(allowedOrigin ? { "Access-Control-Allow-Origin": allowedOrigin } : {}),
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
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
    sendJson(response, 200, { ok: true, parserVersion: "0.42.0", mode: "local-native" }, origin);
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
  process.on(signal, () => server.close(() => process.exit(0)));
}
