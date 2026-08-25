import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { SquadStore } from "../companion/squad/store.mjs";

const target = resolve(process.argv[2] || "TEMP/team-coach-ui-data");
if (!target.toLowerCase().includes("team-coach-ui-data")) throw new Error("Yalnızca takım koçu UI test dizini hazırlanabilir.");
mkdirSync(target, { recursive: true });

const team = ["Atlas", "Bora", "Cem", "Deniz", "Efe"].map((name, index) => ({ steamid: `7656119800000030${index}`, name }));
const opponents = ["Rakip 1", "Rakip 2", "Rakip 3", "Rakip 4", "Rakip 5"].map((name, index) => ({ steamid: `7656119900000030${index}`, name }));
const zones = ["A Long", "A Short", "Mid Doors", "B Site", "Lower Tunnels"];

function report(player, playerIndex, matchIndex, side) {
  const awper = playerIndex === 4;
  return {
    player,
    map: "de_dust2",
    rounds: 12,
    kills: 8 + playerIndex + (matchIndex % 2),
    deaths: 5 + (playerIndex % 2),
    assists: playerIndex === 3 ? 7 : 2,
    adr: 72 + playerIndex * 5,
    headshotPercent: awper ? 22 : 48,
    openingKills: playerIndex === 0 ? 4 : 1,
    openingDeaths: playerIndex === 0 ? 2 : 1,
    utilityDamage: playerIndex === 3 ? 130 : 20,
    flashesThrown: playerIndex === 3 ? 8 : 2,
    tradePercent: playerIndex === 1 ? 68 : 42,
    impact: 65 + playerIndex * 3,
    sideStats: [{ side: "CT", rounds: 6, kills: 4 + playerIndex, deaths: 3, assists: 1, damage: 440 + playerIndex * 25, shots: 48 }, { side: "T", rounds: 6, kills: 4 + playerIndex, deaths: 3, assists: 2, damage: 420 + playerIndex * 25, shots: 45 }],
    routeStats: [{ side: "CT", zone: zones[playerIndex], totalRounds: 4, wins: 3, losses: 1, kills: 4, deaths: 2 }, { side: "T", zone: playerIndex < 2 ? "A Long" : playerIndex === 4 ? "Mid Doors" : "A Short", totalRounds: 3, wins: 2, losses: 1, kills: 3, deaths: 2 }],
    roundPaths: [{ round: 1, side, won: true, winnerSide: side, primaryZone: zones[playerIndex], routeSummary: zones[playerIndex] }],
    weaponStats: [{ weapon: awper ? "awp" : "ak47", label: awper ? "AWP" : "AK-47", category: awper ? "sniper" : "rifle", kills: awper ? 9 : 6, damage: 650, shots: awper ? 34 : 55, headshots: awper ? 1 : 3 }],
    deathDetails: [],
    killDetails: [],
  };
}

function fixture(matchIndex) {
  const players = [...team.map((player) => ({ ...player, team: "Team 1" })), ...opponents.map((player) => ({ ...player, team: "Team 2" }))];
  const reports = [
    ...team.map((player, index) => report(player, index, matchIndex, "CT")),
    ...opponents.map((player, index) => report(player, index, matchIndex, "T")),
  ];
  return {
    id: `ui-dust2-${matchIndex}`,
    source: "ui_test",
    map: "de_dust2",
    timestamp: Date.now() - matchIndex * 86_400_000,
    formattedDate: `UI test maçı ${matchIndex}`,
    score: { rawScore: matchIndex === 2 ? "11 - 13" : "13 - 9", result: matchIndex === 2 ? "Mağlubiyet" : "Galibiyet" },
    userStats: team[0],
    players,
    fullAnalysis: { parserVersion: "ui-test", header: { map_name: "de_dust2" }, reports },
  };
}

const store = new SquadStore(target);
const analyzedMatches = [];
for (let index = 1; index <= 4; index++) {
  const match = fixture(index);
  analyzedMatches.push({ ...match, isDownloaded: true });
  store.ingestMatch(match);
}
const availableMatch = {
  ...fixture(5),
  id: "ui-dust2-discovery",
  replayUrl: "https://replay1.valve.net/730/ui-dust2-discovery.dem.bz2",
  isDownloaded: false,
};
const scannedMatches = [
  availableMatch,
  ...analyzedMatches.map((match) => ({ ...match, replayUrl: `https://replay1.valve.net/730/${match.id}.dem.bz2` })),
];
writeFileSync(join(target, "recent_matches.json"), JSON.stringify(analyzedMatches, null, 2), "utf8");
writeFileSync(join(target, "scanned_matches.json"), JSON.stringify(scannedMatches, null, 2), "utf8");
console.log(`Takım koçu UI test verisi hazır: ${target}`);
