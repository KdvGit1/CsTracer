// Tek bir demoyu ayrı süreçte analiz eder ve sonucu sıkıştırılmış JSON olarak
// yazar. Her analizden sonra süreç kapanır; ayrıştırıcının yerel belleği
// tamamen işletim sistemine döner ve bir çökme botu etkilemez.
import { writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { analyzeDemo } from "../../engine/companion/analyze.mjs";
import { compactAnalysisForStorage } from "../../engine/companion/match_storage.mjs";

function friendly(error) {
  const raw = error instanceof Error ? error.message : String(error);
  if (/magic|header|invalid|corrupt|unexpected end|eof/i.test(raw)) return "Demo dosyası bozuk veya eksik. Maç bittikten sonra oluşan tam .dem dosyasını dene.";
  if (/memory|alloc/i.test(raw)) return "Sunucu belleği bu demo için yetmedi.";
  return raw.slice(0, 400);
}

process.once("message", ({ demoPath, outPath }) => {
  try {
    const started = Date.now();
    const analysis = compactAnalysisForStorage(analyzeDemo(demoPath));
    writeFileSync(outPath, gzipSync(Buffer.from(JSON.stringify(analysis)), { level: 6 }));
    process.send({ ok: true, durationMs: Date.now() - started, players: analysis.players?.length || 0, rounds: analysis.roundEvents?.length || 0 }, () => process.exit(0));
  } catch (error) {
    process.send({ ok: false, error: friendly(error) }, () => process.exit(0));
  }
});
