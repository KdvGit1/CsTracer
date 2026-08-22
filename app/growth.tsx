"use client";

import { useMemo, useState } from "react";
import "./growth.css";

export type DimensionKey = "aim" | "movement" | "utility" | "teamwork" | "position" | "roundImpact";
export type CompactMatchSummary = {
  overall: number;
  dimensions: Record<DimensionKey, number>;
  stats: { kills: number; deaths: number; assists: number; adr: number; headshotPercent: number; tradePercent: number };
  weapons: Array<{ weapon: string; label: string; score: number; kills: number; shots: number }>;
};
export type ProgressMatch = {
  id: string; date: number; fileName: string; map: string; playerSteamId: string; playerName: string; summary: CompactMatchSummary;
};

const DIMENSIONS: Array<{ key: DimensionKey; label: string; color: string }> = [
  { key: "aim", label: "Aim", color: "#c8f54d" },
  { key: "movement", label: "Hareket", color: "#68d4ff" },
  { key: "utility", label: "Utility", color: "#ffb761" },
  { key: "teamwork", label: "Takım oyunu", color: "#b99cff" },
  { key: "position", label: "Pozisyon", color: "#ff7e85" },
  { key: "roundImpact", label: "Round etkisi", color: "#f4e37a" },
];

function average(values: number[]) {
  return values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : 0;
}

function slope(values: number[]) {
  if (values.length < 2) return null;
  const xMean = (values.length - 1) / 2;
  const yMean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const denominator = values.reduce((sum, _, index) => sum + (index - xMean) ** 2, 0);
  if (!denominator) return 0;
  const numerator = values.reduce((sum, value, index) => sum + (index - xMean) * (value - yMean), 0);
  return Math.round(numerator / denominator * 10) / 10;
}

function momentum(values: number[]) {
  const recent = slope(values.slice(-5));
  const previous = slope(values.slice(-10, -5));
  return { trend: recent, acceleration: recent !== null && previous !== null ? Math.round((recent - previous) * 10) / 10 : null };
}

function deltaLabel(value: number | null, suffix = "") {
  if (value === null) return "Yeterli maç yok";
  return `${value > 0 ? "+" : ""}${value}${suffix}`;
}

function dateLabel(timestamp: number) {
  return new Intl.DateTimeFormat("tr-TR", { day: "2-digit", month: "short", year: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(timestamp));
}

function ScoreChart({ matches, value, color, label }: { matches: ProgressMatch[]; value: (match: ProgressMatch) => number; color: string; label: string }) {
  const ordered = [...matches].sort((a, b) => a.date - b.date);
  if (ordered.length < 2) return <div className="growth-chart-empty"><b>Grafik için en az 2 maç gerekli</b><span>İlk gerçek maç özeti kaydedildiğinde başlangıç noktası oluşur.</span></div>;
  const values = ordered.map(value);
  const width = 760;
  const height = 220;
  const paddingX = 28;
  const paddingY = 18;
  const x = (index: number) => paddingX + index * ((width - paddingX * 2) / Math.max(1, ordered.length - 1));
  const y = (score: number) => height - paddingY - score / 100 * (height - paddingY * 2);
  const points = values.map((score, index) => `${x(index)},${y(score)}`).join(" ");
  return <div className="growth-chart" aria-label={`${label} puan grafiği`}>
    <svg viewBox={`0 0 ${width} ${height}`} role="img">
      {[25, 50, 75, 100].map((tick) => <g key={tick}><line x1={paddingX} x2={width - paddingX} y1={y(tick)} y2={y(tick)} /><text x="2" y={y(tick) + 4}>{tick}</text></g>)}
      <polyline points={points} style={{ stroke: color }} />
      {values.map((score, index) => <circle key={ordered[index].id} cx={x(index)} cy={y(score)} r="4" style={{ fill: color }}><title>{dateLabel(ordered[index].date)} · {score}/100</title></circle>)}
    </svg>
    <div><span>{dateLabel(ordered[0].date)}</span><b>{ordered.length} gerçek maç</b><span>{dateLabel(ordered[ordered.length - 1].date)}</span></div>
  </div>;
}

export function GrowthView({ matches, loading, playerName, onBack }: { matches: ProgressMatch[]; loading: boolean; playerName?: string; onBack: () => void }) {
  const [dimension, setDimension] = useState<DimensionKey>("aim");
  const [weapon, setWeapon] = useState("");
  const ordered = useMemo(() => [...matches].sort((a, b) => a.date - b.date), [matches]);
  const latest = ordered[ordered.length - 1];
  const previous = ordered[ordered.length - 2];
  const overallValues = ordered.map((match) => match.summary.overall);
  const overallMomentum = momentum(overallValues);
  const careerAverage = average(overallValues);
  const storageKb = Math.max(0, Math.round(new Blob([JSON.stringify(matches)]).size / 102.4) / 10);
  const weaponNames = useMemo(() => {
    const labels = new Map<string, string>();
    ordered.forEach((match) => match.summary.weapons.forEach((item) => labels.set(item.weapon, item.label)));
    return [...labels.entries()].map(([id, label]) => ({ id, label }));
  }, [ordered]);
  const selectedWeapon = weapon || weaponNames[0]?.id || "";
  const weaponMatches = ordered.filter((match) => match.summary.weapons.some((item) => item.weapon === selectedWeapon));
  const selectedDimension = DIMENSIONS.find((item) => item.key === dimension) || DIMENSIONS[0];

  if (loading) return <section className="growth-view"><div className="growth-loading">Gelişim hafızası yükleniyor…</div></section>;

  return <section className="growth-view">
    <header className="growth-topbar">
      <div><button onClick={onBack}>← Analize dön</button><p className="eyebrow">GELİŞİM MERKEZİ</p><h1>{playerName ? `${playerName} · uzun dönem formu` : "Kişisel gelişim geçmişi"}</h1><span>Son 90 analiz · yalnızca seçtiğin oyuncunun küçük maç özetleri</span></div>
      <div className="memory-state"><span>KALICI HAFIZA</span><b>{matches.length} / 90 maç</b><small>Yaklaşık {storageKb} KB özet</small></div>
    </header>

    {!matches.length ? <div className="growth-empty"><span>↗</span><b>Henüz kaydedilmiş maç yok</b><p>Bir demo analiz et ve demodaki kendi oyuncunu seç. Gerçek maç özeti otomatik olarak burada saklanacak; örnek veri gösterilmiyor.</p><button onClick={onBack}>İlk demoyu analiz et</button></div> : <>
      <div className="growth-score-grid">
        <article className="overall-score"><span>KARİYER ORTALAMA PUANI</span><strong>{careerAverage}</strong><small>/100 · {matches.length} maç ortalaması</small><div><b>Son maç {latest.summary.overall}</b><em className={(latest.summary.overall - (previous?.summary.overall || latest.summary.overall)) >= 0 ? "up" : "down"}>{previous ? deltaLabel(latest.summary.overall - previous.summary.overall) : "Başlangıç"}</em></div></article>
        <article><span>SON 5 MAÇ EĞİMİ</span><strong>{deltaLabel(overallMomentum.trend, " puan/maç")}</strong><small>Doğrusal form yönü</small></article>
        <article><span>İVME DEĞİŞİMİ</span><strong>{deltaLabel(overallMomentum.acceleration, " puan/maç")}</strong><small>Son 5 eğim − önceki 5 eğim</small></article>
        <article><span>SON MAÇ</span><strong>{latest.summary.stats.kills} / {latest.summary.stats.deaths}</strong><small>{latest.map} · {dateLabel(latest.date)}</small></article>
      </div>

      <article className="growth-panel">
        <header><div><p className="eyebrow">GENEL PUAN</p><h2>Maçtan maça performans çizgisi</h2></div><span>Gerçek özetler · kronolojik</span></header>
        <ScoreChart matches={matches} value={(match) => match.summary.overall} color="#c8f54d" label="Genel" />
      </article>

      <section className="dimension-score-grid">
        {DIMENSIONS.map((item) => {
          const values = ordered.map((match) => match.summary.dimensions[item.key]);
          const current = values[values.length - 1];
          const prior = values[values.length - 2];
          const form = momentum(values);
          return <button className={dimension === item.key ? "selected" : ""} onClick={() => setDimension(item.key)} key={item.key} style={{ "--dimension-color": item.color } as React.CSSProperties}>
            <span>{item.label}</span><strong>{current}</strong><em>{prior === undefined ? "Başlangıç" : `${deltaLabel(current - prior)} son maç`}</em><small>{form.trend === null ? "Eğim için 2 maç gerekli" : `Eğim ${deltaLabel(form.trend)} · ivme ${deltaLabel(form.acceleration)}`}</small>
          </button>;
        })}
      </section>

      <details className="score-method">
        <summary>Puanlar nasıl hesaplanıyor?</summary>
        <p>Aim: HS, ADR ve K/D; hareket: hız ağırlıklı hata; utility: round başına utility hasarı ve rakip körlük süresi; takım oyunu: trade ve asist; pozisyon: ölüm kümesi ve opening kaybı; round etkisi: maç etki skoru. Bunlar karşılaştırma için deterministik koçluk puanlarıdır, Valve rankı veya kesin yetenek hükmü değildir.</p>
      </details>

      <article className="growth-panel">
        <header><div><p className="eyebrow">DAL GELİŞİMİ</p><h2>{selectedDimension.label} puanı</h2></div><select aria-label="Grafiği gösterilecek gelişim alanı" value={dimension} onChange={(event) => setDimension(event.target.value as DimensionKey)}>{DIMENSIONS.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}</select></header>
        <ScoreChart matches={matches} value={(match) => match.summary.dimensions[dimension]} color={selectedDimension.color} label={selectedDimension.label} />
      </article>

      <article className="growth-panel weapon-growth">
        <header><div><p className="eyebrow">SİLAH GELİŞİMİ</p><h2>Silah puanı ve form yönü</h2></div>{weaponNames.length ? <select aria-label="Grafiği gösterilecek silah" value={selectedWeapon} onChange={(event) => setWeapon(event.target.value)}>{weaponNames.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select> : <span>Silah özeti yok</span>}</header>
        {weaponNames.length > 0 && <div className="weapon-form-grid">{weaponNames.slice(0, 6).map((item) => {
          const observations = ordered.map((match) => match.summary.weapons.find((candidate) => candidate.weapon === item.id)?.score).filter((score): score is number => score !== undefined);
          const form = momentum(observations);
          const current = observations[observations.length - 1];
          const prior = observations[observations.length - 2];
          return <button className={selectedWeapon === item.id ? "selected" : ""} onClick={() => setWeapon(item.id)} key={item.id}><span>{item.label}</span><strong>{current}</strong><em>{prior === undefined ? "Başlangıç" : `${deltaLabel(current - prior)} son maç`}</em><small>Eğim {deltaLabel(form.trend)} · ivme {deltaLabel(form.acceleration)}</small></button>;
        })}</div>}
        {selectedWeapon && weaponMatches.length ? <ScoreChart matches={weaponMatches} value={(match) => match.summary.weapons.find((item) => item.weapon === selectedWeapon)?.score || 0} color="#ffb761" label={weaponNames.find((item) => item.id === selectedWeapon)?.label || selectedWeapon} /> : <div className="growth-chart-empty"><b>Silah grafiği için veri yok</b><span>Silah olayı çıkarılan maçlar burada görünür.</span></div>}
      </article>

      <article className="growth-history">
        <header><div><p className="eyebrow">MAÇ HAFIZASI</p><h2>Kaydedilen özetler</h2></div><span>En yeni 90 maç otomatik korunur</span></header>
        <div className="growth-history-head"><span>Tarih</span><span>Harita</span><span>Skor</span><span>ADR</span><span>HS</span><span>Trade</span><span>Puan</span></div>
        {[...matches].sort((a, b) => b.date - a.date).map((match) => <div className="growth-history-row" key={match.id}><span>{dateLabel(match.date)}</span><b>{match.map.replace(/^de_/, "")}</b><span>{match.summary.stats.kills}/{match.summary.stats.deaths}</span><span>{match.summary.stats.adr}</span><span>%{match.summary.stats.headshotPercent}</span><span>%{match.summary.stats.tradePercent}</span><strong>{match.summary.overall}</strong></div>)}
      </article>
    </>}
  </section>;
}
