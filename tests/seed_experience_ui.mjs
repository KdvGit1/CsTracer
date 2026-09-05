// Explicitly synthetic, isolated QA data. Never used by production code.
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
const target = resolve("work/experience-ui-data");
mkdirSync(target, { recursive: true });
const profile = { name: "Deneme Oyuncusu", steamid: "76561198000000001" };
const matches = Array.from({ length: 10 }, (_, i) => {
  const map = ["nuke", "mirage", "anubis", "dust2"][i % 4];
  const rounds = 22;
  const report = {
    analysisVersion: "3.2.0", player: profile, map, rounds, kills: 15 + i, deaths: 12 + i % 3, assists: 4, adr: 81 + i,
    headshotPercent: 42, openingKills: 3, openingDeaths: 2, utilityDamage: 120, enemyBlindSeconds: 8, flashesThrown: 10, shots: 120,
    movingShotPercent: 12, tradePercent: 40, topZone: "", topZoneDeaths: 0, unflashedDeaths: 4, untradedDeaths: 3, impact: 70,
    kastPercent: 72, survivalPercent: 30, utilityImpactRoundPercent: 22, utilityImpactRoundSampleCount: rounds,
    deathDetails: [], killDetails: [], sideStats: [], weaponStats: [], recommendations: [], roundPaths: [], routeStats: [],
    movementProfile: { status: "measured", sampleCount: 120, invalidShotPercent: 12, movingPercent: 12, stablePercent: 88, severityScore: 12, severity: "minor", method: "weapon-max-speed-34pct-v1", averageSpeed: 15, p90Speed: 30, stableShots: 106, microMoveShots: 0, movingShots: 14, fastMoveShots: 0, microPercent: 0, fastPercent: 0, unmeasuredShots: 0 },
    sprayStats: { method: "bullet-damage-event-tick-v2", status: "unavailable", reason: "Deneme senaryosu: bu demoda doğrudan atış–hasar eşleşmesi yok.", totalShots: 120, totalHits: 0, accuracyPercent: null, earlyAccuracy: null, lateAccuracy: null, earlyShots: 0, lateShots: 0, hitboxSampleCount: 0, hitboxCounts: { head: 0, chest: 0, stomach: 0, arms: 0, legs: 0 }, hitboxPercents: { head: 0, chest: 0, stomach: 0, arms: 0, legs: 0 } },
    crosshairStats: { method: "kill-tick-alignment-v2", status: "unavailable", sampleCount: 0, headErrorAngle: null, bodyErrorAngle: null, headLevelRating: "Ölçülemedi" },
    duelStats: { ttdMethod: "spotted-to-first-damage-v2", ttdStatus: "unavailable", duelMethod: "mutual-spotted-death-v2", duelStatus: "unavailable", duelTotal: 0, duelWins: 0, duelWinrate: null, averageTTD: null, medianTTD: null, fastReactions: 0, reactionRating: "Ölçülemedi" },
  };
  return {
    id: `experience-test-${i}`, source: "ui_test", map, mode: "Premier", timestamp: Date.now() - i * 86400000,
    formattedDate: `Deneme maçı ${i + 1}`, fileName: `experience-test-${i}.dem`, demoAvailable: false, isDownloaded: true,
    score: { userTeam: "Team 1", userScore: i % 3 === 1 ? 9 : 13, enemyScore: i % 3 === 1 ? 13 : 9, result: i % 3 === 1 ? "Mağlubiyet" : "Galibiyet", isWin: i % 3 !== 1, isTie: false, rawScore: i % 3 === 1 ? "9 - 13" : "13 - 9" },
    userStats: { ...profile, kills: report.kills, deaths: report.deaths, assists: 4, kd: report.kills / report.deaths, hsPercent: 42, adr: report.adr, score: 40, ping: 20, stars: "1" },
    players: [{ ...profile, team: "Team 1", kills: report.kills, deaths: report.deaths, assists: 4 }],
    fullAnalysis: { analysisVersion: "3.2.0", header: { map_name: map }, reports: [report] },
  };
});
writeFileSync(join(target, "recent_matches.json"), JSON.stringify(matches));
writeFileSync(join(target, "scanned_matches.json"), "[]");
writeFileSync(join(target, "progress.json"), JSON.stringify({ profile, matches: [] }));
console.log(`Yalnız UI deneme verisi: ${target}`);
