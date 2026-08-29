import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { parentPort, workerData } from "node:worker_threads";
import { compactRecentMatchesForStorage } from "./match_storage.mjs";

try {
  const startedAt = Date.now();
  const list = JSON.parse(readFileSync(workerData.filePath, "utf8"));
  if (!Array.isArray(list)) throw new Error("Maç geçmişi dosyası liste biçiminde değil.");
  compactRecentMatchesForStorage(list);
  const serialized = JSON.stringify(list);
  const tempPath = `${workerData.filePath}.optimize.tmp`;
  writeFileSync(tempPath, serialized, "utf8");
  renameSync(tempPath, workerData.filePath);
  parentPort.postMessage({
    ok: true,
    matchCount: list.length,
    outputBytes: Buffer.byteLength(serialized),
    durationMs: Date.now() - startedAt,
  });
} catch (error) {
  parentPort.postMessage({
    ok: false,
    error: error instanceof Error ? error.message : String(error),
  });
}
