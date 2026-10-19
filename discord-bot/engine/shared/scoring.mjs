export const SCORE_METHOD = "kast-round-contribution-v1";

function finite(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function percent(value) {
  const parsed = finite(value);
  return parsed === null ? null : Math.max(0, Math.min(100, Math.round(parsed * 10) / 10));
}

export function kastContributionGrade(value) {
  const measured = percent(value);
  if (measured === null) return "Ölçülemedi";
  if (measured >= 80) return "Çok yüksek round katkısı";
  if (measured >= 70) return "İyi round katkısı";
  if (measured >= 60) return "Orta round katkısı";
  return "Geliştirilebilir round katkısı";
}

/**
 * TRACER'ın tek maç karnesi. Genel değer bir tahmin veya profesyonel rating
 * değildir: doğrudan KAST (kill, assist, survival veya traded death olan
 * roundların yüzdesi) değeridir. Alt boyutlar da yalnız ölçülebilen doğrudan
 * yüzdeleri taşır; eksik veri sıfıra çevrilmez.
 */
export function scoreMatchReport(report) {
  if (!report || typeof report !== "object") return null;

  const rounds = finite(report.rounds);
  const kills = finite(report.kills) || 0;
  const deaths = finite(report.deaths) || 0;
  const movement = report.movementProfile;
  const invalidShotPercent = finite(movement?.invalidShotPercent);
  const movementMeasured = movement?.status === "measured" && Number(movement.sampleCount) > 0 && invalidShotPercent !== null;

  const dimensions = {
    aim: kills > 0 ? percent(report.headshotPercent) : null,
    movement: movementMeasured ? percent(100 - invalidShotPercent) : null,
    utility: Number(report.utilityImpactRoundSampleCount) > 0 ? percent(report.utilityImpactRoundPercent) : null,
    teamwork: deaths > 0 ? percent(report.tradePercent) : null,
    position: rounds > 0 ? percent(report.survivalPercent) : null,
    roundImpact: rounds > 0 ? percent(report.kastPercent) : null,
  };

  return {
    overall: dimensions.roundImpact,
    grade: kastContributionGrade(dimensions.roundImpact),
    method: SCORE_METHOD,
    sampleCount: rounds && rounds > 0 ? rounds : 0,
    dimensions,
  };
}
