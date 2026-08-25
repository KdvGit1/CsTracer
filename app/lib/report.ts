import { evaluateAimMechanics } from "../components/AimCoachCard";
import type { CompactCoachVerdict, CompactMatchSummary } from "../growth";
import { clampScore } from "./format";
import type { CoachPacket, FullMatchReport, PlayerReport } from "./types";

export function buildCompactSummary(report: PlayerReport, coachVerdict?: CompactCoachVerdict): CompactMatchSummary {
  const rounds = Math.max(1, report.rounds);
  const kd = report.kills / Math.max(1, report.deaths);
  const aim = clampScore(
    Math.min(100, report.headshotPercent / 60 * 100) * .42
    + Math.min(100, report.adr / 90 * 100) * .36
    + Math.min(100, kd / 1.25 * 100) * .22,
  );
  const movement = clampScore(100 - (report.movementProfile?.severityScore ?? Math.min(100, report.movingShotPercent * 2.2)));
  const utility = clampScore(
    Math.min(100, report.utilityDamage / rounds / 6 * 100) * .58
    + Math.min(100, report.enemyBlindSeconds / rounds / 1.5 * 100) * .42,
  );
  const teamwork = clampScore(
    Math.min(100, report.tradePercent / 55 * 100) * .68
    + Math.min(100, report.assists / rounds / .28 * 100) * .32,
  );
  const zoneShare = report.deaths ? report.topZoneDeaths / report.deaths * 100 : 0;
  const openingDeathShare = report.rounds ? report.openingDeaths / report.rounds * 100 : 0;
  const position = clampScore(100 - Math.max(0, zoneShare - 20) * .9 - openingDeathShare * 1.5);
  const roundImpact = clampScore(report.impact);
  const dimensions = { aim, movement, utility, teamwork, position, roundImpact };
  const overall = clampScore(aim * .24 + movement * .16 + utility * .14 + teamwork * .15 + position * .15 + roundImpact * .16);

  const aimMetrics = report.crosshairStats && report.duelStats && report.sprayStats ? {
    headErrorAngle: report.crosshairStats.headErrorAngle,
    bodyErrorAngle: report.crosshairStats.bodyErrorAngle,
    preAimScore: report.crosshairStats.preAimScore,
    averageTTD: report.duelStats.averageTTD,
    duelWinrate: report.duelStats.duelWinrate,
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
      title: report.crosshairStats.headErrorAngle > 4.5 ? "Pre-Aim ve kafa hizası geliştirilmeli" : "Kafa seviyesi ve açı yerleşimi temiz",
      priorityArea: "Pre-Aim & Kafa Hizası",
      grade: overall >= 85 ? "Tier 1 Pro" : overall >= 72 ? "İleri Düzey" : overall >= 58 ? "Gelişime Açık" : "Temel Hata",
    } : undefined),
  };
}

export function buildDeterministicFullReport(report: PlayerReport, packet: CoachPacket): FullMatchReport {
  const aimEvaluation = evaluateAimMechanics(report);
  const rounds = Math.max(1, report.rounds);
  const overallScore = clampScore(
    (aimEvaluation.score * 0.28) +
    (clampScore(report.impact) * 0.22) +
    (clampScore(Math.min(100, report.tradePercent / 50 * 100)) * 0.18) +
    (clampScore(100 - (report.movementProfile?.severityScore ?? 30)) * 0.16) +
    (clampScore(Math.min(100, (report.utilityDamage / rounds / 5) * 100)) * 0.16)
  );

  const grade = overallScore >= 85 ? "Tier 1 Pro Standardı" : overallScore >= 72 ? "İleri Düzey Rekabetçi" : overallScore >= 58 ? "Ortalama / Gelişime Açık" : "Temel Mekanik Hatalar";

  const ctStats = report.sideStats?.find((s) => s.side === "CT");
  const tStats = report.sideStats?.find((s) => s.side === "T");
  const sideVerdict = ctStats && tStats
    ? (ctStats.adr > tStats.adr + 15
        ? "Savunma (CT) tarafında belirgin daha yüksek hasar ve etki üretildi; T tarafında takım açılışları ve trade mesafesi geliştirilmeli."
        : tStats.adr > ctStats.adr + 15
        ? "Hücum (T) tarafında etkili oynandı; CT tarafında anchor pozisyon tutuşları ve rota planı gözden geçirilmeli."
        : "CT ve T tarafları arasında dengeli hasar ve etki sağlandı.")
    : "CT/T taraf performansı incelendi.";

  const strongestWeapon = report.weaponStats?.length ? [...report.weaponStats].sort((a, b) => b.score - a.score)[0] : undefined;
  const developWeapon = report.weaponStats?.length ? [...report.weaponStats].filter((w) => w.shots > 15).sort((a, b) => a.score - b.score)[0] : undefined;

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
      overallScore,
      grade,
      impactScore: clampScore(report.impact),
      aimScore: aimEvaluation.score,
      movementScore: clampScore(100 - (report.movementProfile?.severityScore ?? 30)),
      utilityScore: clampScore(Math.min(100, (report.utilityDamage / rounds / 6) * 100)),
      teamworkScore: clampScore(Math.min(100, (report.tradePercent / 55) * 100)),
      positionScore: clampScore(100 - Math.min(60, (report.topZoneDeaths / Math.max(1, report.deaths)) * 100)),
      economyScore: report.economyStats ? clampScore(100 - (report.economyStats.roundEconomy.filter((r) => r.heroBuy).length * 15)) : 75,
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
      ctAdr: ctStats?.adr || 0,
      tKills: tStats?.kills || 0,
      tDeaths: tStats?.deaths || 0,
      tAdr: tStats?.adr || 0,
      verdict: sideVerdict,
    },
    weaponVerdict: {
      strongWeapon: strongestWeapon?.label ? `${strongestWeapon.label} (${strongestWeapon.kills} kill, %${strongestWeapon.headshotPercent} HS)` : "AK-47 / Tüfek",
      developWeapon: developWeapon?.label ? `${developWeapon.label} (%${developWeapon.movingShotPercent} hareketli atış)` : "İkincil Silah",
      tip: developWeapon?.movingShotPercent && developWeapon.movingShotPercent > 15 ? "Atış öncesi tam duruş (counter-strafe) çalış." : "İlk 3 mermi burst ve recoil reset çalış.",
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

## Maç Karnesi: ${reportData.matchScorecard.overallScore}/100 (${reportData.matchScorecard.grade})
- **Maç Etkisi:** ${reportData.matchScorecard.impactScore}/100
- **Nişangah & İsabet:** ${reportData.matchScorecard.aimScore}/100
- **Duruş & Counter-Strafe:** ${reportData.matchScorecard.movementScore}/100
- **Takım & Trade:** ${reportData.matchScorecard.teamworkScore}/100
- **Utility & Hazırlık:** ${reportData.matchScorecard.utilityScore}/100
- **Pozisyon & Açılış:** ${reportData.matchScorecard.positionScore}/100

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
- **Güçlü Silah:** ${reportData.weaponVerdict.strongWeapon}
- **Geliştirilecek Silah:** ${reportData.weaponVerdict.developWeapon} (${reportData.weaponVerdict.tip})

---

## 30-40 Dakikalık Özel Antrenman Reçetesi
**Genel Plan:** ${reportData.sessionPlan}

${reportData.routine.map((r) => `1. **[${r.duration}] ${r.title}:** ${r.drill} *(Hedef: ${r.goal})*`).join("\n")}
${reportData.strengths.length ? `\n**Güçlü Yanlar:** ${reportData.strengths.join(" · ")}` : ""}
`;
}
