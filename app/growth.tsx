"use client";

import { useMemo, useState } from "react";
import "./growth.css";
import { IconSparkles, IconExternalLink } from "./components/NavIcons";

export type DimensionKey = "aim" | "movement" | "utility" | "teamwork" | "position" | "roundImpact";
export type AimMetricKey = "preAim" | "headError" | "ttd" | "duelWinrate" | "earlyAccuracy";

export type AimMetrics = {
  headErrorAngle: number;
  bodyErrorAngle: number;
  preAimScore: number;
  averageTTD: number;
  medianTTD?: number;
  ttdSampleCount?: number;
  ttdMethod?: "spotted-to-first-damage-v1";
  duelWinrate: number;
  duelSampleCount?: number;
  duelMethod?: "mutual-spotted-death-v1";
  earlyAccuracy: number;
  lateAccuracy: number;
};

export type CompactCoachVerdict = {
  title: string;
  priorityArea: string;
  grade: string;
};

export type CompactMatchSummary = {
  overall: number;
  dimensions: Record<DimensionKey, number>;
  stats: { kills: number; deaths: number; assists: number; adr: number; headshotPercent: number; tradePercent: number };
  weapons: Array<{ weapon: string; label: string; score: number; kills: number; shots: number }>;
  aimMetrics?: AimMetrics;
  coachVerdict?: CompactCoachVerdict;
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

export const AIM_METRIC_CONFIG: Array<{ key: AimMetricKey; label: string; unit: string; color: string; lowerIsBetter?: boolean; desc: string }> = [
  { key: "preAim", label: "Pre-Aim Kalitesi", unit: "/100", color: "#c8f54d", desc: "Kafa hizası ve köşe dönme yerleşimi" },
  { key: "headError", label: "Kafa Sapması", unit: "°", color: "#ff9c4d", lowerIsBetter: true, desc: "Düşman kafasından açı sapması (Düşük = İyi)" },
  { key: "ttd", label: "Medyan Time-to-Damage", unit: "ms", color: "#68d4ff", lowerIsBetter: true, desc: "Yaklaşık görünür temastan ilk hasara medyan süre (Düşük = Hızlı)" },
  { key: "duelWinrate", label: "Karşılıklı Düello Kazanma", unit: "%", color: "#b99cff", desc: "İki rakibin birbirini gördüğü ve ölümle sonuçlanan temasların kazanma yüzdesi" },
  { key: "earlyAccuracy", label: "İlk 3 Mermi İsabeti", unit: "%", color: "#f4e37a", desc: "Burst ve ilk mermi isabet başarısı" },
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
  const sign = value > 0 ? "+" : "";
  return `${sign}${value}${suffix}`;
}

function dateLabel(timestamp: number) {
  return new Intl.DateTimeFormat("tr-TR", { day: "2-digit", month: "short", year: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(timestamp));
}

function ScoreChart({
  matches,
  value,
  color,
  label,
  unit = "/100",
  maxVal = 100,
  minVal = 0,
}: {
  matches: ProgressMatch[];
  value: (match: ProgressMatch) => number;
  color: string;
  label: string;
  unit?: string;
  maxVal?: number;
  minVal?: number;
}) {
  const ordered = [...matches].sort((a, b) => a.date - b.date);
  if (ordered.length < 2) return <div className="growth-chart-empty"><b>Grafik için en az 2 maç gerekli</b><span>İlk gerçek maç özeti kaydedildiğinde başlangıç noktası oluşur.</span></div>;
  const values = ordered.map(value);
  const calculatedMax = Math.max(maxVal, ...values) * 1.08;
  const calculatedMin = Math.min(minVal, ...values);
  const range = Math.max(1, calculatedMax - calculatedMin);

  const width = 760;
  const height = 220;
  const paddingX = 28;
  const paddingY = 22;
  const x = (index: number) => paddingX + index * ((width - paddingX * 2) / Math.max(1, ordered.length - 1));
  const y = (score: number) => height - paddingY - ((score - calculatedMin) / range) * (height - paddingY * 2);
  const points = values.map((score, index) => `${x(index)},${y(score)}`).join(" ");
  
  const step = range / 3;
  const ticks = [Math.round(calculatedMin), Math.round(calculatedMin + step), Math.round(calculatedMin + step * 2), Math.round(calculatedMax)];

  return <div className="growth-chart" aria-label={`${label} puan grafiği`}>
    <svg viewBox={`0 0 ${width} ${height}`} role="img">
      {ticks.map((tick) => (
        <g key={tick}>
          <line x1={paddingX} x2={width - paddingX} y1={y(tick)} y2={y(tick)} stroke="#212c27" strokeDasharray="3,3" />
          <text x="2" y={y(tick) + 4} fill="#788680" fontSize="9" fontFamily="monospace">{tick}{unit}</text>
        </g>
      ))}
      <polyline points={points} style={{ stroke: color, strokeWidth: "2.5", fill: "none" }} />
      {values.map((score, index) => (
        <circle key={ordered[index].id} cx={x(index)} cy={y(score)} r="4.5" style={{ fill: color, stroke: "#0d1210", strokeWidth: "2" }}>
          <title>{dateLabel(ordered[index].date)} · {score} {unit}</title>
        </circle>
      ))}
    </svg>
    <div><span>{dateLabel(ordered[0].date)}</span><b>{ordered.length} gerçek maç</b><span>{dateLabel(ordered[ordered.length - 1].date)}</span></div>
  </div>;
}

export function GrowthView({ matches, loading, playerName, onBack }: { matches: ProgressMatch[]; loading: boolean; playerName?: string; onBack: () => void }) {
  const [dimension, setDimension] = useState<DimensionKey>("aim");
  const [aimMetric, setAimMetric] = useState<AimMetricKey>("preAim");
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
  const selectedAimConfig = AIM_METRIC_CONFIG.find((item) => item.key === aimMetric) || AIM_METRIC_CONFIG[0];

  const hasAimMetricValue = (match: ProgressMatch, key: AimMetricKey): boolean => {
    const aim = match.summary.aimMetrics;
    if (!aim) return false;
    if (key === "ttd") return aim.ttdMethod === "spotted-to-first-damage-v1" && (aim.ttdSampleCount || 0) > 0;
    if (key === "duelWinrate") return aim.duelMethod === "mutual-spotted-death-v1" && (aim.duelSampleCount || 0) > 0;
    return true;
  };

  const getAimMetricValue = (match: ProgressMatch, key: AimMetricKey): number => {
    const aim = match.summary.aimMetrics;
    if (!aim) return 0;
    switch (key) {
      case "preAim": return aim.preAimScore;
      case "headError": return aim.headErrorAngle;
      case "ttd": return aim.medianTTD || 0;
      case "duelWinrate": return aim.duelWinrate;
      case "earlyAccuracy": return aim.earlyAccuracy;
      default: return 0;
    }
  };

  if (loading) return <section className="growth-view"><div className="growth-loading">Gelişim hafızası yükleniyor…</div></section>;

  return <section className="growth-view">
    <header className="growth-topbar">
      <div><button onClick={onBack}>← Analize dön</button><p className="eyebrow">GELİŞİM MERKEZİ</p><h1>{playerName ? `${playerName} · uzun dönem formu` : "Kişisel gelişim geçmişi"}</h1><span>Son 90 analiz · yalnızca seçtiğin oyuncunun küçük maç özetleri</span></div>
      <div className="memory-state"><span>KALICI HAFIZA</span><b>{matches.length} / 90 maç</b><small>Yaklaşık {storageKb} KB özet</small></div>
    </header>

    {!matches.length ? <div className="growth-empty"><span><IconExternalLink size={20} /></span><b>Henüz kaydedilmiş maç yok</b><p>Bir demo analiz et ve demodaki kendi oyuncunu seç. Gerçek maç özeti otomatik olarak burada saklanacak; örnek veri gösterilmiyor.</p><button onClick={onBack}>İlk demoyu analiz et</button></div> : <>
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

      {/* NİŞANGAH, DÜELLO & REAKSİYON GELİŞİMİ */}
      <article className="growth-panel aim-growth-panel">
        <header>
          <div>
            <p className="eyebrow">NİŞANGAH & DÜELLO GELİŞİMİ</p>
            <h2>{selectedAimConfig.label} ({selectedAimConfig.unit})</h2>
            <small>{selectedAimConfig.desc}</small>
          </div>
          <select
            aria-label="Grafiği gösterilecek nişangah metriği"
            value={aimMetric}
            onChange={(event) => setAimMetric(event.target.value as AimMetricKey)}
          >
            {AIM_METRIC_CONFIG.map((item) => (
              <option key={item.key} value={item.key}>{item.label}</option>
            ))}
          </select>
        </header>

        <div className="aim-metric-buttons-grid">
          {AIM_METRIC_CONFIG.map((item) => {
            const metricMatches = ordered.filter((match) => hasAimMetricValue(match, item.key));
            const values = metricMatches.map((match) => getAimMetricValue(match, item.key));
            const current = values[values.length - 1];
            const prior = values[values.length - 2];
            const form = momentum(values);
            const isGoodTrend = item.lowerIsBetter
              ? (form.trend !== null && form.trend <= 0)
              : (form.trend !== null && form.trend >= 0);

            return (
              <button
                className={`aim-btn-card ${aimMetric === item.key ? "selected" : ""}`}
                onClick={() => setAimMetric(item.key)}
                key={item.key}
                style={{ "--accent-color": item.color } as React.CSSProperties}
              >
                <span>{item.label}</span>
                <strong>{current === undefined ? "—" : `${current} ${item.unit}`}</strong>
                <em>{current === undefined ? "Geçerli ölçüm yok" : prior === undefined ? "Başlangıç" : `${deltaLabel(Math.round((current - prior) * 10) / 10, item.unit)} son maç`}</em>
                <small className={isGoodTrend ? "trend-good" : "trend-bad"}>
                  {form.trend === null ? "Eğim için 2 maç" : `Eğim ${deltaLabel(form.trend, item.unit)}`}
                </small>
              </button>
            );
          })}
        </div>

        <ScoreChart
          matches={matches.filter((match) => hasAimMetricValue(match, aimMetric))}
          value={(match) => getAimMetricValue(match, aimMetric)}
          color={selectedAimConfig.color}
          label={selectedAimConfig.label}
          unit={selectedAimConfig.unit}
          maxVal={aimMetric === "ttd" ? 450 : aimMetric === "headError" ? 8 : 100}
          minVal={aimMetric === "ttd" ? 180 : aimMetric === "headError" ? 1.5 : 0}
        />
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
        <summary>Puanlar ve aim metrikleri nasıl hesaplanıyor?</summary>
        <p>Pre-Aim & Kafa Sapması (°): Düşmanla temas anındaki 3D açı sapmasıdır. Time-to-Damage (ms): Rakibin approximate spotted verisinde görünmesinden ilk silahlı hasara kadar geçen medyan süredir; örnek yoksa tahmin üretilmez. Karşılıklı düello: iki oyuncunun birbirini gördüğü ve ölümle sonuçlanan temaslardır. Aim: HS, ADR ve K/D; hareket: hız ağırlıklı hata; utility: round başına utility hasarı ve rakip körlük süresi; takım oyunu: trade ve asist; pozisyon: ölüm kümesi ve opening kaybı; round etkisi: maç etki skoru.</p>
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
        <div className="growth-history-head">
          <span>Tarih</span>
          <span>Harita</span>
          <span>Skor</span>
          <span>ADR</span>
          <span>HS</span>
          <span>Pre-Aim</span>
          <span>Kafa Sapması</span>
          <span>TTD</span>
          <span>Puan</span>
        </div>
        {[...matches].sort((a, b) => b.date - a.date).map((match) => (
          <div className="growth-history-row" key={match.id}>
            <span>{dateLabel(match.date)}</span>
            <div>
              <b>{match.map.replace(/^de_/, "")}</b>
              {match.summary.coachVerdict && (
                <small className="growth-coach-tag" title={`${match.summary.coachVerdict.priorityArea}: ${match.summary.coachVerdict.title}`}>
                  <IconSparkles size={11} style={{ marginRight: "4px", display: "inline-block", verticalAlign: "middle" }} />
                  {match.summary.coachVerdict.priorityArea}
                </small>
              )}
            </div>
            <span>{match.summary.stats.kills}/{match.summary.stats.deaths}</span>
            <span>{match.summary.stats.adr}</span>
            <span>%{match.summary.stats.headshotPercent}</span>
            <span>{match.summary.aimMetrics ? `${match.summary.aimMetrics.preAimScore}/100` : "—"}</span>
            <span>{match.summary.aimMetrics ? `${match.summary.aimMetrics.headErrorAngle}°` : "—"}</span>
            <span>{hasAimMetricValue(match, "ttd") ? `${match.summary.aimMetrics?.medianTTD}ms` : "—"}</span>
            <strong>{match.summary.overall}</strong>
          </div>
        ))}
      </article>
    </>}
  </section>;
}
