// Uçtan uca deneme (Discord olmadan): bir demoyu kuyruğa verir, analiz eder,
// hafızaya kaydeder ve maç ekranının bütün sekmelerini PNG olarak yazar.
// Kullanım: node scripts/e2e-demo.mjs <demo.dem|.dem.gz|.dem.bz2> [çıktı-klasörü]
import { copyFileSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { AnalysisQueue } from "../src/analysis/queue.mjs";
import { renderMatchTab } from "../src/bot/match-view.mjs";
import { Store } from "../src/db.mjs";
import { Renderer } from "../src/render/renderer.mjs";

const demo = process.argv[2];
if (!demo) {
  console.error("Kullanım: node scripts/e2e-demo.mjs <demo> [çıktı-klasörü]");
  process.exit(1);
}
const out = resolve(process.argv[3] || "e2e-output");
mkdirSync(out, { recursive: true });
const dataDir = mkdtempSync(join(tmpdir(), "tracer-e2e-"));
const config = { dataDir, maxDemoMb: 800, analysisConcurrency: 1, analysisMemoryMb: 6144, analysisTimeoutMin: 15, keepDemos: false };
const store = new Store(dataDir);
store.touchUser("100000000000000001", "Deneme");

const done = new Promise((resolveDone, reject) => {
  const queue = new AnalysisQueue({
    store,
    config,
    hooks: {
      onProgress: (job, stage) => console.log(`  · ${stage}`),
      onDone: (job, result) => { queue.stop(); resolveDone({ job, result }); },
      onFailed: (job, error) => { queue.stop(); reject(new Error(error.message)); },
    },
  });
  const staged = join(dataDir, "tmp", `upload-${basename(demo)}`);
  copyFileSync(demo, staged);
  queue.start();
  queue.enqueue({ userId: "100000000000000001", source: { type: "file", path: staged, fileName: basename(demo) } });
});

const started = Date.now();
const { result } = await done;
console.log(`Analiz ${Math.round((Date.now() - started) / 1000)} sn · maç ${result.match.id} · ${result.analysis.reports.length} oyuncu · seçim gerekli: ${result.needsPlayerChoice}`);
const viewer = { steamid: result.analysis.reports[0].player.steamid };
const renderer = new Renderer({ inProcess: true });
for (const tab of ["o", "r", "d", "w", "t", "k"]) {
  const payload = await renderMatchTab({ renderer, storedMatch: store.getMatch(result.match.id), ownerId: "100000000000000001", viewer, tab, duel: { all: true } });
  for (const file of payload.files || []) writeFileSync(join(out, file.name), file.attachment);
  console.log(`  sekme ${tab}: ${payload.embeds?.[0]?.title} · ${payload.files?.length || 0} görsel · ${payload.components?.length || 0} satır bileşen`);
}
console.log(`Görseller: ${out}`);
store.close();
