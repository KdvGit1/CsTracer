"use client";

import { useMemo, type ChangeEvent } from "react";
import type { ProgressMatch } from "../growth";
import { summarizeProgress } from "../../shared/experience.mjs";
import { scanTimeLabel, steamStatusLabel, useSteamStatus } from "../lib/useSteamStatus";
import { MetricGlossary } from "./AnalysisGuide";
import { IconArrowRight, IconClock, IconCrosshair, IconGrowth, IconPlan, IconRefresh } from "./NavIcons";

type Destination = "recent" | "analysis" | "growth" | "team" | "live";
const number = (value: number | null) => value === null ? "—" : new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 1 }).format(value);

export default function HomeOverview({ playerName, matches, loading, hasAnalysis, onNavigate, onUpload, onProfile }: {
  playerName?: string; matches: ProgressMatch[]; loading: boolean; hasAnalysis: boolean;
  onNavigate: (view: Destination) => void; onUpload: (event: ChangeEvent<HTMLInputElement>) => void; onProfile: () => void;
}) {
  const summary = useMemo(() => summarizeProgress(matches), [matches]);
  const { snapshot, service, refresh } = useSteamStatus();
  const stats = [
    { label: "ROUND KATKISI", acronym: "KAST", metric: summary.kast, unit: "%", help: "En az bir öldürme, asist, hayatta kalma veya takas katkısı olan roundlar." },
    { label: "ROUND BAŞINA HASAR", acronym: "ADR", metric: summary.adr, unit: "", help: "Bir roundda rakiplere verdiğin ortalama hasar." },
    { label: "KAFADAN ÖLDÜRME", acronym: "HS", metric: summary.hs, unit: "%", help: "Öldürmelerinin içindeki kafadan öldürme payı; isabet oranı değildir." },
  ];
  return <section className="workspace home-overview">
    <header className="home-heading"><div><p className="eyebrow">KİŞİSEL PERFORMANS MERKEZİN</p><h1>{playerName ? `Tekrar hoş geldin, ${playerName}.` : "Oyunu oyna. Farkı gör."}</h1><p>Maçların, gelişimin ve bir sonraki adımın. Hepsi cihazında.</p></div><span className="local-badge"><i /> YEREL & ÖZEL</span></header>
    <section className="home-hero">
      <div><span className="hero-index">TRACER / MAÇ MERKEZİ</span><h2>Her maçtan<br /><em>bir adım ileri.</em></h2><p>{matches.length ? `${matches.length} kişisel maç kaydın hazır. Son maçını incele, tekrar eden alışkanlıklarını bul ve bir sonraki maça tek bir hedefle gir.` : "Steam geçmişini getir veya bir demo yükle. Gerçek verilerle nerede güçlü olduğunu ve neyi geliştirebileceğini birlikte bulalım."}</p>
        <div className="home-primary-actions"><button className="home-primary" onClick={() => onNavigate("recent")}>Maçlarıma git <IconArrowRight size={17} /></button><label className="home-secondary">Demo yükle<input type="file" accept=".dem,.bz2" onChange={onUpload} aria-label="Analiz için demo yükle" /></label>{hasAnalysis && <button className="home-text-action" onClick={() => onNavigate("analysis")}>Açık analize dön →</button>}</div>
      </div>
      <div className="home-workflow" aria-label="Analiz akışı"><div><span>01</span><section><b>Maçını getir</b><p>Steam’den sıraya al veya .dem yükle.</p></section></div><div><span>02</span><section><b>Katkını anla</b><p>Roundlar, düellolar ve atış örnekleri.</p></section></div><div><span>03</span><section><b>Tek bir hedef seç</b><p>Koçun önerisini sonraki maçta dene.</p></section></div></div>
    </section>

    <div className="home-section-heading"><h2>Son 5 maçın nabzı</h2><span>Maç başına ortalama · yalnız ölçülen veriler</span></div>
    <p>Kayıtlı kişisel analizler tarih sırasıyla seçilir: Steam maçlarında maç tarihi, manuel demolarda dosya tarihi kullanılır. Tarihi bilinmeyen kayıtlar bu özete katılmaz.</p>
    <div className="home-stat-grid">{stats.map(({ label, acronym, metric, unit, help }) => <article key={acronym} title={help}><header><span>{label}</span><b>{acronym}</b></header><div className="home-stat-value">{loading ? "…" : number(metric.value)}<small>{metric.value !== null && unit}</small></div><footer><span>{metric.count ? `${metric.count} ölçülen maç` : "Henüz ölçüm yok"}</span><span className={metric.delta === null ? "" : metric.delta >= 0 ? "positive" : "negative"}>{metric.delta === null ? "Karşılaştırma için iki grupta 3’er maç gerekir" : `${metric.delta > 0 ? "+" : ""}${number(metric.delta)}${unit ? " yüzde puan" : " ADR"} · önceki 5’e göre`}</span></footer></article>)}</div>

    <div className="home-bottom-grid"><section className="home-history"><div className="home-section-heading"><h2><IconClock size={17} /> Son kişisel kayıtlar</h2><button onClick={() => onNavigate("growth")}>Gelişimimi aç →</button></div>
      {summary.recent.length ? <div className="home-history-list">{summary.recent.map((match) => <button key={match.id} onClick={() => onNavigate("growth")} title="Kişisel gelişim geçmişini aç"><span className="home-map-mark">{match.map?.replace(/^de_/, "").slice(0, 2).toUpperCase() || "?"}</span><span className="home-match-name"><b>{match.map?.replace(/^de_/, "") || "Bilinmeyen harita"}</b><small>{scanTimeLabel(match.date)}</small></span><span><b>{match.summary.stats.kills} / {match.summary.stats.deaths}</b><small>K / D</small></span><span><b>{number(match.summary.stats.adr)}</b><small>ADR</small></span><IconArrowRight size={14} /></button>)}</div> : <div className="home-empty"><IconCrosshair size={32} /><h3>{loading ? "Kayıtların hazırlanıyor…" : "İlk maçınla başlayalım."}</h3><p>{playerName ? "Analiz ettiğin maçlarda kendi oyuncunu seçtiğinde gelişim kaydın burada görünür." : "Oyuncunu bir kez seç; sonraki demolarda aynı kimlikle eşleştirelim."}</p><button onClick={onProfile}>{playerName ? "Oyuncu profilini aç" : "Kendimi seç"}</button></div>}
    </section><aside className="home-rail"><section className={`home-connection ${service === "offline" ? "offline" : snapshot?.connection.state || ""}`}><header><span className="eyebrow">STEAM & YEREL SERVİS</span><button onClick={() => void refresh()} aria-label="Bağlantı durumunu yenile"><IconRefresh size={14} /></button></header><h3>{service === "offline" ? "Yerel servise ulaşılamıyor" : snapshot?.scan.running ? "Arka planda taranıyor" : steamStatusLabel(snapshot?.connection)}</h3><p>{service === "offline" ? "Steam çerezini değiştirmene gerek yok. Yerel servis yeniden yanıt verdiğinde otomatik bağlanacağız." : snapshot?.scan.running ? snapshot.scan.message : snapshot?.connection.message || "Yerel servis hazırlanıyor. Steam bağlantısını beklemeden gezinmeye başlayabilirsin."}</p><small>Son başarılı tarama: {scanTimeLabel(snapshot?.connection.lastSuccessAt)}</small><button className="home-connection-action" onClick={() => onNavigate("recent")}>Maçlar ve bağlantı →</button></section>
      <button className="home-shortcut" onClick={() => onNavigate("team")}><IconPlan size={20} /><span><b>Takımınla hazırlan</b><small>Ortak maçlar, roller ve takım planı</small></span><IconArrowRight size={15} /></button><button className="home-shortcut" onClick={() => onNavigate("growth")}><IconGrowth size={20} /><span><b>Dünden daha iyi misin?</b><small>Kendi maçlarınla gelişimini izle</small></span><IconArrowRight size={15} /></button>
    </aside></div>
    <MetricGlossary />
  </section>;
}
