import type { PlayerReport } from "../lib/types";
import { reportCoverage } from "../../shared/experience.mjs";

export function MetricGlossary() {
  return <details className="metric-glossary">
    <summary>Metrikleri nasıl okumalıyım? <span>KAST · ADR · HS · burst · düello</span></summary>
    <dl>
      <div><dt>KAST · Round katkısı</dt><dd>Öldürme (Kill), asist (Assist), hayatta kalma (Survive) veya ölümünün takım arkadaşınca takas edilmesi (Traded). Bunlardan en az birini yaptığın roundların yüzdesi; dört ayrı puanın toplamı değil.</dd></div>
      <div><dt>ADR · Round başına hasar</dt><dd>Rakiplere verdiğin toplam hasar / oynadığın round. Öldürmeden yaptığın hasar da katkıdır.</dd></div>
      <div><dt>HS · Kafadan öldürme</dt><dd>Öldürmelerinin ne kadarının kafadan olduğunu gösterir. İsabetlerin kafa payıyla aynı metrik değildir.</dd></div>
      <div><dt>Burst / sprey isabeti</dt><dd>Atış dizisinin ilk 3 mermisi ve 4. mermiden sonrası ayrı incelenir. Yalnız doğrudan atış–hasar eşleşmeleri kullanılır; eşleşme yoksa “ölçülemedi” yazar, %0 yazmaz.</dd></div>
      <div><dt>Düello / görünürlük</dt><dd>Karşılıklı görünürlükle eşleşen ölüm temasları düello örneğidir. Görünürlükten hasara süre yaklaşık bir demo ölçümüdür; saf refleks testi değildir.</dd></div>
      <div><dt>İyi / geliştirilebilir</dt><dd>Koçluk eşikleri pratik geri bildirimdir, profesyonel CS2 sıralaması değildir. Önce örnek sayısına, sonra benzer harita ve silahlardaki kendi maçlarına bak.</dd></div>
    </dl>
  </details>;
}

export default function AnalysisGuide({ report, onNavigate }: { report: PlayerReport; onNavigate: (target: string) => void }) {
  const items = reportCoverage(report);
  return <section className="analysis-guide" aria-label="Analiz veri kapsamı">
    <header><div><p className="eyebrow">ÖNCE KANIT, SONRA YORUM</p><h2>Bu demo bize ne söylüyor?</h2></div><span>{items.filter((item) => item.available).length} / {items.length} alan ölçüldü</span></header>
    <div className="coverage-grid">{items.map((item) => <button key={item.key} className={item.available ? "measured" : "missing"} onClick={() => onNavigate(item.target)} title={item.available ? "Ölçümün ayrıntısını aç" : item.reason}>
      <span>{item.available ? "●" : "○"} {item.label}</span><b>{item.available ? `${item.count} ${item.unit}` : "Ölçüm eksik"}</b><small>{item.available ? "Gerçek demo örnekleri · ayrıntı →" : item.reason}</small>
    </button>)}</div>
    <MetricGlossary />
  </section>;
}
