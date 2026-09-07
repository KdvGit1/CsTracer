import type { PlayerReport } from "../lib/types";
import { reportCoverage } from "../../shared/experience.mjs";

export function MetricGlossary() {
  return <details className="metric-glossary">
    <summary>Metrikleri nasıl okumalıyım? <span>KAST · ADR · HS · burst · düello</span></summary>
    <dl>
      <div><dt>KAST · Round katkısı</dt><dd>Öldürme (Kill), asist (Assist), hayatta kalma (Survived) veya seni öldüren rakibin kısa süre içinde takım arkadaşın tarafından öldürülmesi (Traded). Bu dört koşuldan en az birini karşılayan roundlarının yüzdesidir. Bir roundda birden fazlasını yapmak ekstra puan getirmez.</dd></div>
      <div><dt>ADR · Round başına hasar</dt><dd>Rakiplere verdiğin toplam hasarın oynadığın round sayısına bölünmesiyle hesaplanır. Rakibi öldürmesen de verdiğin hasar hesaba katılır.</dd></div>
      <div><dt>HS · Kafadan öldürme</dt><dd>Öldürmelerinin yüzde kaçının kafa vuruşuyla gerçekleştiğini gösterir. Kafaya isabet eden tüm mermilerin oranından farklıdır.</dd></div>
      <div><dt>Burst / sprey isabeti</dt><dd>Atış dizisinin ilk 3 mermisi ve 4. mermiden sonrası ayrı incelenir. Yalnız doğrudan atış–hasar eşleşmeleri kullanılır; eşleşme yoksa “ölçülemedi” yazar, %0 yazmaz.</dd></div>
      <div><dt>Düello ve ilk hasar süresi</dt><dd>Demoda iki oyuncunun birbirini gördüğü ve birinin öldüğü karşılaşmalar düello olarak sayılır. Görünürlük kaydı yaklaşık olduğundan, ilk hasara kadar geçen süre doğrudan refleks hızın olarak yorumlanmaz.</dd></div>
      <div><dt>İyi / geliştirilebilir ne demek?</dt><dd>Bu etiketler TRACER’ın değerlendirme aralıklarına göre verilir; resmî CS2 derecesi veya profesyonellik ölçüsü değildir. Örnek sayısını dikkate al ve benzer harita ve silahlardaki maçlarını karşılaştır.</dd></div>
    </dl>
  </details>;
}

export default function AnalysisGuide({ report, onNavigate }: { report: PlayerReport; onNavigate: (target: string) => void }) {
  const items = reportCoverage(report);
  return <section className="analysis-guide" aria-label="Analiz veri kapsamı">
    <header><div><p className="eyebrow">ANALİZİN KAPSAMI</p><h2>Bu maçta neler ölçülebildi?</h2></div><span>{items.length} alanın {items.filter((item) => item.available).length} tanesinde veri var</span></header>
    <div className="coverage-grid">{items.map((item) => <button key={item.key} className={item.available ? "measured" : "missing"} onClick={() => onNavigate(item.target)} title={item.available ? "Ölçümün ayrıntısını aç" : item.reason}>
      <span>{item.available ? "●" : "○"} {item.label}</span><b>{item.available ? `${item.count} ${item.unit}` : "Ölçülemedi"}</b><small>{item.available ? "İncelenen örnekler · ayrıntıları aç →" : item.reason}</small>
    </button>)}</div>
    <MetricGlossary />
  </section>;
}
