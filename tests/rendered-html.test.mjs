import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import test from "node:test";

const distEntry = new URL("../dist/server/index.js", import.meta.url);
const hasBuild = existsSync(distEntry);

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

test("server-renders the real TRACER empty state without fake match data", { skip: !hasBuild && "dist build yok; önce npm run build" }, async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>TRACER — CS2 Performance Lab<\/title>/i);
  assert.match(html, /Demo analizine hazır\./);
  assert.match(html, /Sahte istatistik gösterilmiyor/);
  assert.match(html, /Gerçek demo verisi bekleniyor/);
  assert.match(html, /Qwen3 1\.7B Q4_K_M/);
  assert.match(html, /Kayıtlı oyuncu geri yükleniyor/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape|Building your site/i);
});

test("portable mode keeps progress player-scoped and unloads the embedded coach", async () => {
  const [page, companion, steamDownloader, launcher, packageScript, config, coaching] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../companion/server.mjs", import.meta.url), "utf8"),
    readFile(new URL("../companion/steam_downloader.mjs", import.meta.url), "utf8"),
    readFile(new URL("../launcher/start-tracer.ps1", import.meta.url), "utf8"),
    readFile(new URL("../launcher/package-portable.ps1", import.meta.url), "utf8"),
    readFile(new URL("../app/lib/config.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/lib/coaching.ts", import.meta.url), "utf8"),
  ]);

  assert.match(config, /PROGRESS_URL/);
  assert.match(config, /COMPANION_URL/);
  assert.match(page, /coachEngine.*"embedded"/);
  assert.match(page, /\/coach\/chat/);
  assert.match(coaching, /Basitçe: Her 10 atışın yaklaşık/);
  assert.match(coaching, /sınır üstü atış payıdır/);
  assert.match(coaching, /COACH_THRESHOLDS/);
  assert.match(companion, /process-exit-after-response/);
  assert.match(companion, /await stopCoachProcess\(\)/);
  assert.match(companion, /\/shutdown/);
  assert.match(companion, /runtime.*llama-cuda/);
  assert.match(companion, /spawnSync\(CUDA_LLAMA_SERVER_PATH, \["--list-devices"\]/);
  assert.match(companion, /runtime\.backend === "cuda" \? ("all"|"99") : "0"/);
  assert.match(companion, /cudaDisabledReason/);
  assert.match(companion, /validateCoachContent/);
  assert.match(companion, /mergeCoachWithEvidence/);
  assert.match(companion, /maxItems: 3/);
  assert.match(companion, /generated: false/);
  assert.match(companion, /GET, POST, PUT, DELETE, OPTIONS/);
  assert.match(companion, /JSON\.stringify\(deterministicFallback\)/);
  assert.match(companion, /\.slice\(0, 90\)/);
  assert.match(companion, /Seçili kişisel oyuncu dışında bir oyuncunun maçı kaydedilemez/);
  assert.match(steamDownloader, /process\.env\.TRACER_DATA_DIR/);
  assert.doesNotMatch(steamDownloader, /const DATA_DIR = join\(__dirname, "\.\.", "data"\)/);
  assert.match(launcher, /--app=\$appUrl/);
  assert.match(launcher, /Wait-ForAppBrowser/);
  assert.match(launcher, /Get-AppBrowserProcesses/);
  assert.match(launcher, /--new-window/);
  assert.match(launcher, /runtime\\node\.exe/);
  assert.match(launcher, /TRACER_PORTABLE_LAUNCHER/);
  assert.doesNotMatch(launcher, /chatgpt\.site|https:\/\//i);
  assert.match(packageScript, /dist\\standalone/);
  assert.match(packageScript, /model\\coach\.gguf/);
  assert.match(packageScript, /runtime\\llama-cuda/);
  assert.match(packageScript, /excludedRootPatterns/);
  assert.match(packageScript, /cudart64_\*\.dll/);
  assert.match(packageScript, /steam_session\.json/); // güvenlik doğrulaması: pakette asla bulunmamalı
});

test("recent matches view is rendered inside the toast provider", async () => {
  const [layout, recentMatches, toast] = await Promise.all([
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/RecentMatchesView.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/Toast.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(recentMatches, /const toast = useToast\(\)/);
  assert.match(recentMatches, /HAM DEMO:/);
  assert.match(recentMatches, /ANALİZ HAZIR · HAM DEMO TEMİZLENDİ/);
  assert.match(layout, /import \{ ToastProvider \} from "\.\/components\/Toast"/);
  assert.match(layout, /<ToastProvider>\{children\}<\/ToastProvider>/);
  assert.match(toast, /confirm-modal-backdrop/);
  assert.match(toast, /aria-modal="true"/);
  assert.match(toast, /Evet, sil/);
});

test("maç sonu bildirim merkezi depolama ve otomasyon sözleşmesini gösterir", async () => {
  const [page, notifications, companion, automation] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/NotificationCenter.tsx", import.meta.url), "utf8"),
    readFile(new URL("../companion/server.mjs", import.meta.url), "utf8"),
    readFile(new URL("../companion/match_automation.mjs", import.meta.url), "utf8"),
  ]);

  assert.match(page, /<NotificationCenter/);
  assert.match(notifications, /Ham demo saklama adedi/);
  assert.match(notifications, /Son maçı her zaman otomatik indir/);
  assert.match(notifications, /İndir ve analiz et/);
  assert.match(companion, /\/automation\/settings/);
  assert.match(companion, /notificationActionMatch/);
  assert.match(companion, /queueMatchDownload\(scannedMatch/);
  assert.match(companion, /reconcileLatestAutomaticMatch/);
  assert.match(companion, /steamEvents\.on\("scan-complete"/);
  assert.match(automation, /MIN_DEMO_RETENTION = 3/);
  assert.match(automation, /ANALYSIS_HISTORY_LIMIT = 90/);
});

test("takım koçu değişken oyuncu seçimi, kişi başı kapsam ve otomatik keşif sözleşmesini korur", async () => {
  const [page, teamCoach, recentMatches, companion] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/TeamCoachView.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/RecentMatchesView.tsx", import.meta.url), "utf8"),
    readFile(new URL("../companion/server.mjs", import.meta.url), "utf8"),
  ]);

  assert.match(teamCoach, /\/squads\/discover/);
  assert.match(teamCoach, /\/squads\/download/);
  assert.match(teamCoach, /selectedPlayerIds/);
  assert.match(teamCoach, /selectedCoverage/);
  assert.match(teamCoach, /oyuncuların aynı maçta bulunması gerekmez/i);
  assert.match(teamCoach, /squadNames\(squad\.roster\)/);
  assert.match(teamCoach, /Evet, \$\{discoverableMatches\.length\} maçı indir/);
  assert.match(companion, /findPartyDiscoveries/);
  assert.match(companion, /selectPartyDiscoveryMatches/);
  assert.match(companion, /coverage\.every\(\(item\) => item\.eligible\)/);
  assert.match(recentMatches, /match-rosters/);
  assert.match(recentMatches, /Maçtaki iki takımın oyuncuları/);
  assert.doesNotMatch(page, /showDirectoryPicker|Yerel maçlar|lib\/handles/);
});

test("sayfa yenileme companion servisini kapatmaz", async () => {
  const pageSource = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(pageSource, /addEventListener\(["'](?:beforeunload|pagehide)["']/);
  assert.match(pageSource, /onClick=\{shutdownTracer\}/);
});

test("gelişim hafızası ölçülemeyen yüzdeleri null olarak kabul eder", async () => {
  const progressRoute = await readFile(new URL("../app/api/progress/route.ts", import.meta.url), "utf8");
  assert.match(progressRoute, /overall: number \| null/);
  assert.match(progressRoute, /value === null/);
  assert.doesNotMatch(progressRoute, /!Number\.isFinite\(summary\.overall\)/);
});
