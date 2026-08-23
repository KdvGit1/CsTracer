import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the real TRACER empty state without fake match data", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>TRACER — CS2 Performance Lab<\/title>/i);
  assert.match(html, /Demo analizine hazır\./);
  assert.match(html, /Sahte istatistik gösterilmiyor/);
  assert.match(html, /Gerçek demo verisi bekleniyor/);
  assert.match(html, /Qwen3 1\.7B Q4_K_M/);
  assert.match(html, /Başka oyuncu verisi kullanılmaz/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape|Building your site/i);
});

test("portable mode keeps progress player-scoped and unloads the embedded coach", async () => {
  const [page, companion, launcher, packageScript] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../companion/server.mjs", import.meta.url), "utf8"),
    readFile(new URL("../launcher/start-tracer.ps1", import.meta.url), "utf8"),
    readFile(new URL("../launcher/package-portable.ps1", import.meta.url), "utf8"),
  ]);

  assert.match(page, /const PROGRESS_URL = `\$\{COMPANION_URL\}\/progress`/);
  assert.match(page, /coachEngine.*"embedded"/);
  assert.match(page, /\/coach\/chat/);
  assert.match(page, /Basitçe: Her 10 atışın yaklaşık/);
  assert.match(page, /bir başarı notu değil, hareket hatasının ağırlığıdır/);
  assert.match(companion, /process-exit-after-response/);
  assert.match(companion, /await stopCoachProcess\(\)/);
  assert.match(companion, /runtime.*llama-cuda/);
  assert.match(companion, /spawnSync\(CUDA_LLAMA_SERVER_PATH, \["--list-devices"\]/);
  assert.match(companion, /runtime\.backend === "cuda" \? "all" : "0"/);
  assert.match(companion, /cudaDisabledReason/);
  assert.match(companion, /schema: COACH_RESPONSE_SCHEMA/);
  assert.match(companion, /validateCoachContent/);
  assert.match(companion, /mergeCoachWithEvidence/);
  assert.match(companion, /maxItems: 3/);
  assert.match(companion, /generated: false/);
  assert.match(companion, /JSON\.stringify\(deterministicFallback\)/);
  assert.match(companion, /\.slice\(0, 90\)/);
  assert.match(companion, /Seçili kişisel oyuncu dışında bir oyuncunun maçı kaydedilemez/);
  assert.match(launcher, /--app=\$appUrl/);
  assert.match(launcher, /Wait-ForAppBrowser/);
  assert.match(launcher, /Get-AppBrowserProcesses/);
  assert.match(launcher, /--new-window/);
  assert.match(launcher, /runtime\\node\.exe/);
  assert.doesNotMatch(launcher, /chatgpt\.site|https:\/\//i);
  assert.match(packageScript, /dist\\standalone/);
  assert.match(packageScript, /model\\coach\.gguf/);
  assert.match(packageScript, /runtime\\llama-cuda/);
  assert.match(packageScript, /cudart64_\*\.dll/);
});
