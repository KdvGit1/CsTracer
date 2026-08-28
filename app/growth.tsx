"use client";

import { useMemo, useState } from "react";
import "./growth.css";
import { IconSparkles, IconExternalLink } from "./components/NavIcons";
import { getAngleTier } from "./lib/format";

export type DimensionKey = "aim" | "movement" | "utility" | "teamwork" | "position" | "roundImpact";
export type AimMetricKey = "headError" | "ttd" | "duelWinrate" | "earlyAccuracy";

export type AimMetrics = {
  headErrorAngle: number | null;
  bodyErrorAngle: number | null;
  averageTTD: number | null;
  medianTTD?: number | null;
  ttdSampleCount?: number;
  ttdMethod?: "spotted-to-first-damage-v2";
  duelWinrate: number | null;
  duelSampleCount?: number;
  duelMethod?: "mutual-spotted-death-v2";
  earlyAccuracy: number | null;
  lateAccuracy: number | null;
};

export type CompactCoachVerdict = {
  title: string;
  priorityArea: string;
  grade: string;
};

export type CompactMatchSummary = {
  overall: number | null;
  dimensions: Record<DimensionKey, number | null>;
  stats: { kills: number; deaths: number; assists: number; adr: number; headshotPercent: number; tradePercent: number | null };
  weapons: Array<{ weapon: string; label: string; score: number | null; kills: number; shots: number }>;
  aimMetrics?: AimMetrics;
  coachVerdict?: CompactCoachVerdict;
  scoreMethod?: "kast-round-contribution-v1";
  scoreSampleCount?: number;
};
export type ProgressMatch = {
  id: string; date: number; fileName: string; map: string; playerSteamId: string; playerName: string; summary: CompactMatchSummary;
};

const DIMENSIONS: Array<{ key: DimensionKey; label: string; color: string }> = [
  { key: "aim", label: "Headshot oranı", color: "#c8f54d" },
  { key: "movement", label: "Atış anı hareket uygunluğu", color: "#68d4ff" },
  { key: "utility", label: "Utility etkili round", color: "#ffb761" },
  { key: "teamwork", label: "Trade oranı", color: "#b99cff" },
  { key: "position", label: "Hayatta kalma", color: "#ff7e85" },
  { key: "roundImpact", label: "KAST", color: "#f4e37a" },
];

export const AIM_METRIC_CONFIG: Array<{ key: AimMetricKey; label: string; unit: string; color: string; lowerIsBetter?: boolean; desc: string }> = [
  { key: "headError", label: "Kill Anı Kafa Sapması", unit: "°", color: "#ff9c4d", lowerIsBetter: true, desc: "Yalnız öldürme tick'indeki nişangah-hedef açısı; pre-aim ölçümü değildir" },
  { key: "ttd", label: "Görünürlükten İlk Hasara Yaklaşık Süre", unit: "ms", color: "#68d4ff", lowerIsBetter: true, desc: "approximate_spotted_by başlangıcından ilk hasara medyan süre; reaksiyon puanı değildir" },
  { key: "duelWinrate", label: "Karşılıklı Düello Kazanma", unit: "%", color: "#b99cff", desc: "İki rakibin birbirini gördüğü ve ölümle sonuçlanan temasların kazanma yüzdesi" },
  { key: "earlyAccuracy", label: "İlk 3 Mermi İsabeti", unit: "%", color: "#f4e37a", desc: "Burst ve ilk mermi isabet başarısı" },
];

function average(values: number[]) {
  return values.length ? roundMetric(values.reduce((sum, value) => sum + value, 0) / values.length) : 0;
}

function roundMetric(value: number, digits = 1) {
  const scale = 10 ** digits;
  return Math.round((Number(value) || 0) * scale) / scale;
}

function metricLabel(value: number, digits = 1) {
  return new Intl.NumberFormat("tr-TR", { maximumFractionDigits: digits }).format(roundMetric(value, digits));
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
  const rounded = roundMetric(value);
  const sign = rounded > 0 ? "+" : "";
  return `${sign}${metricLabel(rounded)}${suffix}`;
}

function compactDelta(value: number | null, suffix = "") {
  return value === null ? "—" : deltaLabel(value, suffix);
}

function dateLabel(timestamp: number) {
  const date = new Date(Number(timestamp));
  if (!Number.isFinite(date.getTime())) return "Tarih bilinmiyor";
  return new Intl.DateTimeFormat("tr-TR", { day: "2-digit", month: "short", year: "2-digit", hour: "2-digit", minute: "2-digit" }).format(date);
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
  const measured = [...matches]
    .sort((a, b) => a.date - b.date)
    .map((match) => ({ match, score: Number(value(match)) }))
    .filter((item) => Number.isFinite(item.score));
  const ordered = measured.map((item) => item.match);
  if (ordered.length < 2) return <div className="growth-chart-empty"><b>Grafik için en az 2 maç gerekli</b><span>İlk gerçek maç özeti kaydedildiğinde başlangıç noktası oluşur.</span></div>;
  const values = measured.map((item) => item.score);
  const calculatedMax = maxVal === 100 ? 100 : Math.max(maxVal, ...values) * 1.08;
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

  return <div className="growth-chart" aria-label={`${label} metrik grafiği`}>
    <svg viewBox={`0 0 ${width} ${height}`} role="img">
      {ticks.map((tick, index) => (
        <g key={`${tick}-${index}`}>
          <line x1={paddingX} x2={width - paddingX} y1={y(tick)} y2={y(tick)} stroke="#212c27" strokeDasharray="3,3" />
          <text x="2" y={y(tick) + 4} fill="#788680" fontSize="9" fontFamily="monospace">{metricLabel(tick)}{unit}</text>
        </g>
      ))}
      <polyline points={points} style={{ stroke: color, strokeWidth: "2.5", fill: "none" }} />
      {values.map((score, index) => (
        <circle key={ordered[index].id} cx={x(index)} cy={y(score)} r="4.5" style={{ fill: color, stroke: "#0d1210", strokeWidth: "2" }}>
          <title>{dateLabel(ordered[index].date)} · {metricLabel(score)} {unit}</title>
        </circle>
      ))}
    </svg>
    <div><span>{dateLabel(ordered[0].date)}</span><b>{ordered.length} gerçek maç</b><span>{dateLabel(ordered[ordered.length - 1].date)}</span></div>
  </div>;
}

export function GrowthView({ matches, loading, playerName, onBack }: { matches: ProgressMatch[]; loading: boolean; playerName?: string; onBack: () => void }) {
  const [dimension, setDimension] = useState<DimensionKey>("aim");
  const [aimMetric, setAimMetric] = useState<AimMetricKey>("headError");
  const [weapon, setWeapon] = useState("");
  const ordered = useMemo(() => [...matches].sort((a, b) => a.date - b.date), [matches]);
  const latest = ordered[ordered.length - 1];
  const previous = ordered[ordered.length - 2];
  const scoredMatches = ordered.filter((match) => Number.isFinite(match.summary.overall));
  const overallValues = scoredMatches.map((match) => Number(match.summary.overall));
  const overallMomentum = momentum(overallValues);
  const careerAverage = overallValues.length ? average(overallValues) : null;
  const storageKb = Math.max(0, Math.round(new Blob([JSON.stringify(matches)]).size / 102.4) / 10);
  const weaponNames = useMemo(() => {
    const weapons = new Map<string, { id: string; label: string; observations: number; lastSeen: number }>();
    ordered.forEach((match) => match.summary.weapons.forEach((item) => {
      if (!item.weapon || item.score === null || !Number.isFinite(Number(item.score))) return;
      const current = weapons.get(item.weapon);
      weapons.set(item.weapon, {
        id: item.weapon,
        label: item.label || item.weapon,
        observations: (current?.observations || 0) + 1,
        lastSeen: Math.max(current?.lastSeen || 0, match.date),
      });
    }));
    return [...weapons.values()].sort((left, right) => right.observations - left.observations || right.lastSeen - left.lastSeen || left.label.localeCompare(right.label, "tr"));
  }, [ordered]);
  const selectedWeapon = weaponNames.some((item) => item.id === weapon) ? weapon : weaponNames[0]?.id || "";
  const weaponMatches = ordered.filter((match) => match.summary.weapons.some((item) => item.weapon === selectedWeapon && item.score !== null && Number.isFinite(Number(item.score))));
  const selectedDimension = DIMENSIONS.find((item) => item.key === dimension) || DIMENSIONS[0];
  const selectedAimConfig = AIM_METRIC_CONFIG.find((item) => item.key === aimMetric) || AIM_METRIC_CONFIG[0];

  const hasAimMetricValue = (match: ProgressMatch, key: AimMetricKey): boolean => {
    const aim = match.summary.aimMetrics;
    if (!aim) return false;
    if (key === "ttd") return aim.ttdMethod === "spotted-to-first-damage-v2" && (aim.ttdSampleCount || 0) > 0 && Number.isFinite(aim.medianTTD);
    if (key === "duelWinrate") return aim.duelMethod === "mutual-spotted-death-v2" && (aim.duelSampleCount || 0) > 0 && Number.isFinite(aim.duelWinrate);
    return Number.isFinite(key === "headError" ? aim.headErrorAngle : aim.earlyAccuracy);
  };

  const getAimMetricValue = (match: ProgressMatch, key: AimMetricKey): number => {
    const aim = match.summary.aimMetrics;
    if (!aim) return 0;
    switch (key) {
      case "headError": return Number(aim.headErrorAngle);
      case "ttd": return Number(aim.medianTTD);
      case "duelWinrate": return Number(aim.duelWinrate);
      case "earlyAccuracy": return Number(aim.earlyAccuracy);
      default: return 0;
    }
  };

  if (loading) return <section className="growth-view"><div className="growth-loading">Gelişim hafızası yükleniyor…</div></section>;

  return <section className="growth-view">
    <header className="growth-topbar">
      <div><button onClick={onBack}>← Analize dön</button><p className="eyebrow">GELİŞİM MERKEZİ</p><h1>{playerName ? `${playerName} · uzun dönem formu` : "Kişisel gelişim geçmişi"}</h1><span>Son 90 maç özeti · yalnızca seçtiğin oyuncunun verileri</span></div>
      <div className="memory-state"><span>KALICI HAFIZA</span><b>{matches.length} / 90 maç</b><small>Yaklaşık {storageKb} KB özet</small></div>
    </header>

    {!matches.length ? <div className="growth-empty"><span><IconExternalLink size={20} /></span><b>Henüz kaydedilmiş maç yok</b><p>Bir demo analiz et ve demodaki kendi oyuncunu seç. Gerçek maç özeti otomatik olarak burada saklanacak; örnek veri gösterilmiyor.</p><button onClick={onBack}>İlk demoyu analiz et</button></div> : <>
      <div className="growth-score-grid">
        <article className="overall-score"><span>ORTALAMA KAST</span><strong>{careerAverage === null ? "—" : metricLabel(careerAverage)}</strong><small>% · {overallValues.length} ölçülen maç</small><div><b>Son maç {latest.summary.overall === null ? "—" : `${metricLabel(latest.summary.overall)}%`}</b><em>{previous && latest.summary.overall !== null && previous.summary.overall !== null ? deltaLabel(latest.summary.overall - previous.summary.overall, "%") : "Karşılaştırma yok"}</em></div></article>
        <article><span>SON 5 MAÇ EĞİMİ</span><strong>{deltaLabel(overallMomentum.trend, " yüzde puanı/maç")}</strong><small>Doğrusal KAST yönü</small></article>
        <article><span>İVME DEĞİŞİMİ</span><strong>{deltaLabel(overallMomentum.acceleration, " yüzde puanı/maç")}</strong><small>Son 5 eğim − önceki 5 eğim</small></article>
        <article><span>SON MAÇ</span><strong>{latest.summary.stats.kills} / {latest.summary.stats.deaths}</strong><small>{latest.map} · {dateLabel(latest.date)}</small></article>
      </div>

      <article className="growth-panel">
        <header><div><p className="eyebrow">KAST</p><h2>Maçtan maça round katkısı</h2></div><span>Kill · asist · hayatta kalma · trade</span></header>
        <ScoreChart matches={scoredMatches} value={(match) => Number(match.summary.overall)} color="#c8f54d" label="KAST" unit="%" />
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
            return (
              <button
                className={`aim-btn-card ${aimMetric === item.key ? "selected" : ""}`}
                onClick={() => setAimMetric(item.key)}
                key={item.key}
                style={{ "--accent-color": item.color } as React.CSSProperties}
              >
                <span>{item.label}</span>
                <strong>{current === undefined ? "—" : `${metricLabel(current)} ${item.unit}`}</strong>
                <em>{current === undefined ? "Geçerli ölçüm yok" : prior === undefined ? "Başlangıç" : `${deltaLabel(current - prior, item.unit)} önceki ölçüme göre`}</em>
                <small>
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
          const values = ordered.map((match) => match.summary.dimensions[item.key]).filter((value): value is number => Number.isFinite(value));
          const current = values[values.length - 1];
          const prior = values[values.length - 2];
          const form = momentum(values);
          return <button className={dimension === item.key ? "selected" : ""} onClick={() => setDimension(item.key)} key={item.key} style={{ "--dimension-color": item.color } as React.CSSProperties}>
            <span>{item.label}</span><strong>{current === undefined ? "—" : metricLabel(current)}</strong><em>{current === undefined ? "Ölçüm yok" : prior === undefined ? "Başlangıç" : `${deltaLabel(current - prior)} önceki ölçüme göre`}</em><small>{form.trend === null ? "Eğim için 2 ölçüm gerekli" : `Eğim ${compactDelta(form.trend)} · ivme ${compactDelta(form.acceleration)}`}</small>
          </button>;
        })}
      </section>

      <details className="score-method">
        <summary>Yüzdeler ve aim metrikleri nasıl hesaplanıyor?</summary>
        <p>Genel gösterge KAST’tır: kill, asist, hayatta kalma veya trade edilen ölüm bulunan roundların yüzdesi. Alt boyutlar sırasıyla HS, silahın max hızının %34’ü altında atış, utility etkili round, trade, hayatta kalma ve KAST yüzdeleridir; birbirine ağırlıkla karıştırılmaz. Kafa sapması yalnız kill tick’ini gösterir ve pre-aim diye yorumlanmaz. TTD approximate spotted verisine dayanır; örnek yoksa değer üretilmez.</p>
      </details>

      <article className="growth-panel">
        <header><div><p className="eyebrow">DOĞRUDAN METRİK</p><h2>{selectedDimension.label} yüzdesi</h2></div><select aria-label="Grafiği gösterilecek gelişim alanı" value={dimension} onChange={(event) => setDimension(event.target.value as DimensionKey)}>{DIMENSIONS.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}</select></header>
        <ScoreChart matches={matches.filter((match) => Number.isFinite(match.summary.dimensions[dimension]))} value={(match) => Number(match.summary.dimensions[dimension])} color={selectedDimension.color} label={selectedDimension.label} unit="%" />
      </article>

      <article className="growth-panel weapon-growth">
        <header><div><p className="eyebrow">SİLAH GELİŞİMİ</p><h2>Hasar/atış verimi ve form yönü</h2></div>{weaponNames.length ? <select aria-label="Grafiği gösterilecek silah" value={selectedWeapon} onChange={(event) => setWeapon(event.target.value)}>{weaponNames.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select> : <span>Silah özeti yok</span>}</header>
        {weaponNames.length > 0 && <div className="weapon-form-grid">{weaponNames.slice(0, 6).map((item) => {
          const observations = ordered.map((match) => match.summary.weapons.find((candidate) => candidate.weapon === item.id)?.score).filter((score): score is number => typeof score === "number" && Number.isFinite(score));
          const form = momentum(observations);
          const current = observations[observations.length - 1];
          const prior = observations[observations.length - 2];
          return <button className={selectedWeapon === item.id ? "selected" : ""} onClick={() => setWeapon(item.id)} key={item.id}><span>{item.label}</span><strong>{metricLabel(current)} <small>dmg/atış</small></strong><em>{prior === undefined ? "Başlangıç" : `${deltaLabel(current - prior)} önceki ölçüme göre`}</em><small>{observations.length} maç · eğim {compactDelta(form.trend)} · ivme {compactDelta(form.acceleration)}</small></button>;
        })}</div>}
        {selectedWeapon && weaponMatches.length ? <ScoreChart matches={weaponMatches} value={(match) => Number(match.summary.weapons.find((item) => item.weapon === selectedWeapon)?.score)} color="#ffb761" label={weaponNames.find((item) => item.id === selectedWeapon)?.label || selectedWeapon} unit=" dmg/atış" maxVal={0} /> : <div className="growth-chart-empty"><b>Silah grafiği için veri yok</b><span>Atış ve hasar olayı birlikte çıkarılan maçlar burada görünür.</span></div>}
      </article>

      <article className="growth-history">
        <header><div><p className="eyebrow">MAÇ HAFIZASI</p><h2>Kaydedilen özetler</h2></div><span>En yeni 90 maç otomatik korunur</span></header>
        <div className="growth-history-head">
          <span>Tarih</span>
          <span>Harita</span>
          <span>K/D</span>
          <span>ADR</span>
          <span>HS</span>
          <span>Kill Anı Hizası</span>
          <span>Kafa Sapması</span>
          <span>TTD</span>
          <span>KAST</span>
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
            <span>{metricLabel(match.summary.stats.adr)}</span>
            <span>%{metricLabel(match.summary.stats.headshotPercent)}</span>
            <span>{match.summary.aimMetrics && Number.isFinite(match.summary.aimMetrics.headErrorAngle) ? getAngleTier(match.summary.aimMetrics.headErrorAngle, "head").label : "—"}</span>
            <span>{match.summary.aimMetrics && Number.isFinite(match.summary.aimMetrics.headErrorAngle) ? `${metricLabel(Number(match.summary.aimMetrics.headErrorAngle))}°` : "—"}</span>
            <span>{hasAimMetricValue(match, "ttd") ? `${metricLabel(Number(match.summary.aimMetrics?.medianTTD))}ms` : "—"}</span>
            <strong>{match.summary.overall === null ? "—" : `%${metricLabel(match.summary.overall)}`}</strong>
          </div>
        ))}
      </article>
    </>}
  </section>;
}
