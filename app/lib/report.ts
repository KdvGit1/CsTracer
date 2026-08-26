import { evaluateAimMechanics } from "../components/AimCoachCard";
import type { CompactCoachVerdict, CompactMatchSummary } from "../growth";
import type { CoachPacket, FullMatchReport, PlayerReport } from "./types";
import { scoreMatchReport } from "../../shared/scoring.mjs";

export function buildCompactSummary(report: PlayerReport, coachVerdict?: CompactCoachVerdict): CompactMatchSummary {
  const scorecard = scoreMatchReport(report);
  const dimensions = scorecard?.dimensions || { aim: null, movement: null, utility: null, teamwork: null, position: null, roundImpact: null };
  const overall = scorecard?.overall ?? null;

  const aimMetrics = report.crosshairStats && report.duelStats && report.sprayStats ? {
    headErrorAngle: report.crosshairStats.headErrorAngle,
    bodyErrorAngle: report.crosshairStats.bodyErrorAngle,
    averageTTD: report.duelStats.averageTTD,
    medianTTD: report.duelStats.medianTTD,
    ttdSampleCount: report.duelStats.ttdSampleCount || 0,
    ttdMethod: report.duelStats.ttdMethod,
    duelWinrate: report.duelStats.duelWinrate,
    duelSampleCount: report.duelStats.duelTotal,
    duelMethod: report.duelStats.duelMethod,
    earlyAccuracy: report.sprayStats.earlyAccuracy,
    lateAccuracy: report.sprayStats.lateAccuracy,
  } : undefined;

  return {
    overall,
    dimensions,
    stats: {
      kills: report.kills, deaths: report.deaths, assists: report.assists, adr: Math.round(report.adr * 10) / 10,
      headshotPercent: report.headshotPercent, tradePercent: report.tradePercent,
    },
    weapons: (report.weaponStats || []).slice(0, 6).map((weapon) => ({
      weapon: weapon.weapon, label: weapon.label, score: weapon.score, kills: weapon.kills, shots: weapon.shots,
    })),
    aimMetrics,
    coachVerdict: coachVerdict || (report.crosshairStats ? {
      title: report.crosshairStats.status === "measured" ? "Öldürme anı nişangah hizası ölçüldü" : "Nişangah hizası ölçülemedi",
      priorityArea: "Öldürme Anı Nişangah Hizası",
      grade: scorecard?.grade || "Ölçülemedi",
    } : undefined),
    scoreMethod: scorecard?.method,
    scoreSampleCount: scorecard?.sampleCount || 0,
  };
}

export function buildDeterministicFullReport(report: PlayerReport, packet: CoachPacket): FullMatchReport {
  const aimEvaluation = evaluateAimMechanics(report);
  const scorecard = scoreMatchReport(report);

  const ctStats = report.sideStats?.find((s) => s.side === "CT");
  const tStats = report.sideStats?.find((s) => s.side === "T");
  const ctAdr = ctStats?.rounds && ctStats.adr !== null ? ctStats.adr : null;
  const tAdr = tStats?.rounds && tStats.adr !== null ? tStats.adr : null;
  const sideVerdict = ctStats && tStats && ctAdr !== null && tAdr !== null
    ? `CT ${ctStats.rounds} roundda ${ctAdr} ADR, T ${tStats.rounds} roundda ${tAdr} ADR üretti; fark ${Math.round(Math.abs(ctAdr - tAdr) * 10) / 10}. Rol ve round planı bilinmeden iyi/kötü etiketi verilmedi.`
    : "CT/T taraf karşılaştırması için iki tarafta da ölçülebilir round verisi bulunamadı.";

  const strongestWeapon = report.weaponStats?.length ? [...report.weaponStats].sort((a, b) => b.kills - a.kills || b.damage - a.damage)[0] : undefined;
  const developWeapon = report.weaponStats?.length ? [...report.weaponStats].filter((w) => w.shots > 15 && w.efficiency !== null).sort((a, b) => Number(a.efficiency) - Number(b.efficiency))[0] : undefined;

  const priorities = packet.priorities.slice(0, 3).map((item) => ({
    area: item.area,
    title: item.title,
    evidence: item.evidence,
    interpretation: item.interpretation,
    action: item.action,
    severity: item.severity,
  }));

  const strengths = packet.strengths.slice(0, 3).map((item) => item.title).concat(aimEvaluation.strengths.slice(0, 2));

  return {
    generatedAt: Date.now(),
    isAiGenerated: false,
    title: packet.title || "Kapsamlı Maç Analizi",
    summary: packet.summary,
    matchScorecard: {
      overallScore: scorecard?.overall ?? null,
      grade: scorecard?.grade || "Ölçülemedi",
      method: "kast-round-contribution-v1",
      sampleCount: scorecard?.sampleCount || 0,
      impactScore: scorecard?.dimensions.roundImpact ?? null,
      aimScore: scorecard?.dimensions.aim ?? null,
      movementScore: scorecard?.dimensions.movement ?? null,
      utilityScore: scorecard?.dimensions.utility ?? null,
      teamworkScore: scorecard?.dimensions.teamwork ?? null,
      positionScore: scorecard?.dimensions.position ?? null,
    },
    priorities,
    strengths: [...new Set(strengths)].slice(0, 4),
    sessionPlan: packet.priorities[0]
      ? `30-40 dk: ${packet.priorities[0].action} Ardından ilk 10 rounddaki ölüm kanıtlarını izle ve sonraki maçta aynı metriği takip et.`
      : "30-40 dk: Öncelikli pozisyon ve nişangah drill'lerini uygula.",
    routine: aimEvaluation.routine,
    sideReview: {
      ctKills: ctStats?.kills || 0,
      ctDeaths: ctStats?.deaths || 0,
      ctAdr,
      tKills: tStats?.kills || 0,
      tDeaths: tStats?.deaths || 0,
      tAdr,
      verdict: sideVerdict,
    },
    weaponVerdict: {
      strongWeapon: strongestWeapon?.label ? `${strongestWeapon.label} (${strongestWeapon.kills} kill, ${strongestWeapon.damage} hasar; en yüksek kayıtlı katkı)` : "Yeterli silah verisi yok",
      developWeapon: developWeapon?.label ? `${developWeapon.label} (${developWeapon.efficiency} hasar/atış; 15+ atışlı silahlar içinde en düşük)` : "15+ atışlı karşılaştırma örneği yok",
      tip: "Bu karşılaştırma puan değildir; ilgili silah çatışmalarını videoda menzil, satın alma ve rol bağlamıyla doğrula.",
    },
    confidence: packet.confidence,
  };
}

export function formatReportAsMarkdown(reportData: FullMatchReport, playerReport: PlayerReport): string {
  const dateStr = new Date(reportData.generatedAt).toLocaleString("tr-TR");
  return `# TRACER CS2 Kapsamlı Maç Koçluk Raporu
**Oyuncu:** ${playerReport.player.name} | **Harita:** ${playerReport.map} | **Round:** ${playerReport.rounds} | **Tarih:** ${dateStr}
**Skor:** ${playerReport.kills} K / ${playerReport.deaths} D / ${playerReport.assists} A (${playerReport.adr.toFixed(1)} ADR)

---

## KAST Round Katkısı: ${reportData.matchScorecard.overallScore ?? "Ölçülemedi"}${reportData.matchScorecard.overallScore === null ? "" : "%"}
- **KAST:** ${reportData.matchScorecard.impactScore ?? "Ölçülemedi"}${reportData.matchScorecard.impactScore === null ? "" : "%"}
- **Headshot Oranı:** ${reportData.matchScorecard.aimScore ?? "Ölçülemedi"}${reportData.matchScorecard.aimScore === null ? "" : "%"}
- **Geçerli Hızda Atış:** ${reportData.matchScorecard.movementScore ?? "Ölçülemedi"}${reportData.matchScorecard.movementScore === null ? "" : "%"}
- **Trade:** ${reportData.matchScorecard.teamworkScore ?? "Ölçülemedi"}${reportData.matchScorecard.teamworkScore === null ? "" : "%"}
- **Utility Etkili Round:** ${reportData.matchScorecard.utilityScore ?? "Ölçülemedi"}${reportData.matchScorecard.utilityScore === null ? "" : "%"}
- **Hayatta Kalma:** ${reportData.matchScorecard.positionScore ?? "Ölçülemedi"}${reportData.matchScorecard.positionScore === null ? "" : "%"}

---

## Koç Değerlendirmesi: ${reportData.title}
${reportData.summary}

---

## Öncelikli 3 Gelişim Alanı
${reportData.priorities.map((item, idx) => `### ${idx + 1}. ${item.area} (${item.title})
- **Kanıt:** ${item.evidence}
- **Koç Yorumu:** ${item.interpretation}
- **Aksiyon / Hedef:** ${item.action}`).join("\n\n")}

---

## Taraf & Silah Özeti
- **CT / T Değerlendirmesi:** ${reportData.sideReview.verdict}
- **En yüksek kayıtlı silah katkısı:** ${reportData.weaponVerdict.strongWeapon}
- **En düşük hasar/atış karşılaştırması:** ${reportData.weaponVerdict.developWeapon} (${reportData.weaponVerdict.tip})

---

## 30-40 Dakikalık Özel Antrenman Reçetesi
**Genel Plan:** ${reportData.sessionPlan}

${reportData.routine.map((r) => `1. **[${r.duration}] ${r.title}:** ${r.drill} *(Hedef: ${r.goal})*`).join("\n")}
${reportData.strengths.length ? `\n**Güçlü Yanlar:** ${reportData.strengths.join(" · ")}` : ""}
`;
}
