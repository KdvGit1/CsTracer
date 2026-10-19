// Discord'a bağlanmadan kart tasarımlarını görmek için örnek PNG'ler üretir.
// Kullanım: npm run preview  → preview/ klasörü
import { mkdirSync, writeFileSync } from "node:fs";
import { sampleReportImageModel } from "../engine/companion/discord_reporter.mjs";
import { matchReportSvg, reactionCardSvg } from "../src/render/cards/match-report.mjs";
import { faceitCardSvg, leaderboardCardSvg, profileCardSvg, progressCardSvg, welcomeCardSvg } from "../src/render/cards/player.mjs";
import { renderPng } from "../src/render/png.mjs";
import { fmt } from "../src/render/svg.mjs";

const out = new URL("../preview/", import.meta.url);
mkdirSync(out, { recursive: true });
const now = Date.now();
const matches = Array.from({ length: 12 }, (_, index) => ({ map: ["de_mirage", "de_inferno", "de_ancient", "de_nuke"][index % 4], result: index % 3 ? "W" : "L", kast: 58 + ((index * 7) % 28), adr: 64 + ((index * 13) % 45), hs: 32 + ((index * 11) % 36), kills: 16 + (index % 7), deaths: 12 + (index % 5) }));
const cards = {
  "mac-raporu": matchReportSvg(sampleReportImageModel()),
  tepki: reactionCardSvg(sampleReportImageModel()),
  hosgeldin: welcomeCardSvg({ name: "Örnek Oyuncu" }),
  profil: profileCardSvg({
    user: { name: "Örnek Oyuncu", greeting: "TEKRAR HOŞ GELDİN · 12. ZİYARET", memberSince: "3 ay" },
    steam: { id: "76561197960287930", name: "ornek_cs", verified: true },
    faceit: { nickname: "OrnekTR", level: 8, elo: 1820 },
    progress: { kast: { value: 71.4, count: 5, delta: 4.2 }, adr: { value: 84.6, count: 5, delta: -3.1 }, hs: { value: 46, count: 5, delta: null } },
    totals: { matches: 42, wins: 24, losses: 16, ties: 2, winRate: 57.1 },
    maps: [{ map: "de_mirage", count: 14, winRate: 64 }, { map: "de_inferno", count: 10, winRate: 50 }, { map: "de_ancient", count: 8, winRate: 37.5 }],
    trend: matches.slice(0, 10).map((item) => item.kast),
    trendResults: matches.slice(0, 10).map((item) => (item.result === "W" ? "Galibiyet" : "Mağlubiyet")),
    last: { map: "de_mirage", score: "13 - 9", result: "Galibiyet", date: now - 3_600_000 },
    streak: { type: "W", count: 3 },
  }),
  gelisim: progressCardSvg({ name: "Örnek Oyuncu", matches }),
  liderlik: leaderboardCardSvg({ title: "Örnek Sunucu · KAST", subtitle: "Son 30 gün · en az 3 maç", metricLabel: "KAST ortalaması", rows: [["Kuzey", 74.2], ["Gölge", 71.9], ["Şimşek", 69], ["Poyraz", 66.4], ["Deniz", 62.8]].map(([name, value], index) => ({ name, value, display: `%${fmt.number(value)}`, sub: `${10 - index} maç` })) }),
  faceit: faceitCardSvg({ player: { nickname: "OrnekTR", level: 8, elo: 1820, country: "tr", region: "EU" }, matches: Array.from({ length: 6 }, (_, index) => ({ map: "mirage", statsAvailable: true, timestamp: now - index * 7_200_000, score: { isWin: index % 3 !== 0, isTie: false, rawScore: index % 3 ? "13 - 9" : "8 - 13" }, userStats: { kills: 20, deaths: 15, assists: 4, kd: 1.33, adr: 88.1, hsPercent: 48 } })) }),
};
for (const [name, svg] of Object.entries(cards)) {
  writeFileSync(new URL(`${name}.png`, out), await renderPng(svg));
  console.log(`✓ preview/${name}.png`);
}
