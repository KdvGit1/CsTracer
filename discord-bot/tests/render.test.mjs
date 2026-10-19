import assert from "node:assert/strict";
import test from "node:test";
import { sampleReportImageModel } from "../engine/companion/discord_reporter.mjs";
import { duelCardSvg, distanceCardSvg } from "../src/render/cards/duel.mjs";
import { matchReportSvg, reactionCardSvg } from "../src/render/cards/match-report.mjs";
import { compareCardSvg, faceitCardSvg, leaderboardCardSvg, profileCardSvg, progressCardSvg, tsideCardSvg, welcomeCardSvg } from "../src/render/cards/player.mjs";
import { squadReportCardSvg } from "../src/render/cards/team.mjs";
import { fitText, textWidth } from "../src/render/fonts.mjs";
import { renderPng } from "../src/render/png.mjs";
import { Renderer } from "../src/render/renderer.mjs";
import { clipSegment, escapeXml } from "../src/render/svg.mjs";

const isPng = (buffer) => buffer.subarray(0, 8).toString("hex") === "89504e470d0a1a0a";

test("yazı ölçümü gerçek Inter genişliklerini kullanır ve taşmayı keser", () => {
  assert.ok(textWidth("WWWW", 20, 700) > textWidth("iiii", 20, 700) * 2);
  const fitted = fitText("Çok uzun bir oyuncu adı burada yazıyor", 140, 20, 700);
  assert.ok(fitted.endsWith("…"));
  assert.ok(textWidth(fitted, 20, 700) <= 140);
  assert.equal(escapeXml("<a & 'b'>"), "&lt;a &amp; &apos;b&apos;&gt;");
});

test("doğru parçası kutuya kırpılır (resvg çökmesini önler)", () => {
  assert.deepEqual(clipSegment(-100, 50, 200, 50, { x: 0, y: 0, width: 100, height: 100 }), [0, 50, 100, 50]);
  assert.equal(clipSegment(-10, -10, -5, -5, { x: 0, y: 0, width: 100, height: 100 }), null);
});

test("maç raporu ve tepki kartı geçerli PNG üretir", async () => {
  const model = sampleReportImageModel();
  assert.ok(isPng(await renderPng(matchReportSvg(model))));
  assert.ok(isPng(await renderPng(reactionCardSvg(model))));
  const empty = { ...model, ownRows: [], opponentRows: [] };
  assert.ok(isPng(await renderPng(matchReportSvg(empty))), "eksik kadro da çizilir");
});

test("düello kartı uzak atış koordinatlarında çökmez", async () => {
  const camera = { origin: [0, 0, 64], forward: [1, 0, 0], right: [0, -1, 0], up: [0, 0, 1], tanH: 1.333, tanV: 0.75, fov: 90, aspect: 16 / 9 };
  const duel = {
    id: "1", round: 3, side: "T", zone: "Mid", weapon: "ak47", distanceM: 12, outcome: "loss", targetEvidence: "damage", unseenDeath: false,
    opponent: { name: "Rakip", steamid: "" }, ownPingMs: 20, opponentPingMs: 30, damageDealt: 27, damageTaken: 100,
    reaction: { status: "measured", fireMs: 310, damageMs: 390 }, opponentReaction: { status: "measured", fireMs: 250, damageMs: 280 },
    ownVisibility: { status: "spotted" }, opponentVisibility: { status: "spotted" },
    shots: [
      { owner: "self", weapon: "ak47", origin: [0, 0, 64], direction: [0.2, 0.98, 0.1], target: null, impacts: [] },
      { owner: "enemy", weapon: "ak47", origin: [500, 20, 64], direction: [-0.99, 0.01, 0.4], target: null, impacts: [{ point: [10, 0, 60] }] },
      { owner: "self", weapon: "ak47", origin: [0, 0, 64], direction: [0, 0, 0], target: null, impacts: [] },
    ],
    scene: { camera, targetPoints: [[400, 10, 64], [400, 10, 46], [400, 10, 29], [400, 3, 46], [400, 17, 46], [400, 6, 5], [400, 14, 5]], pointVisibility: [true, true, true, true, true, true, true], smokes: [{ center: [200, 100, 0], radius: 144 }], visibility: { visible: true, reason: "visible" } },
  };
  for (const all of [true, false]) assert.ok(isPng(await renderPng(duelCardSvg({ duel, mapName: "de_mirage", playerName: "Sen", index: 0, total: 1, showAllShots: all }))));
  assert.ok(isPng(await renderPng(duelCardSvg({ duel: { ...duel, scene: null }, mapName: "de_unknown", total: 1 }))), "sahne yoksa da çizilir");
  assert.ok(isPng(await renderPng(distanceCardSvg({ analyst: { distanceProfile: [] }, playerName: "x" }))));
});

test("kişisel ve takım kartları geçerli PNG üretir", async () => {
  const metric = { value: 70, count: 5, delta: 2 };
  const cards = [
    profileCardSvg({ user: { name: "Kuzey" }, steam: null, faceit: { nickname: "k", level: 10, elo: 2100 }, progress: { kast: metric, adr: { value: null, count: 0, delta: null }, hs: metric }, totals: { matches: 0, wins: 0, losses: 0, ties: 0, winRate: 0 }, maps: [], trend: [], trendResults: [], last: null, streak: null }),
    progressCardSvg({ name: "Kuzey", matches: [{ map: "de_nuke", result: "W", kast: 70, adr: 80, hs: 40, kills: 20, deaths: 10 }, { map: "de_nuke", result: "L", kast: null, adr: 60, hs: 30, kills: 10, deaths: 0 }] }),
    compareCardSvg({ left: { name: "A" }, right: { name: "B" }, rows: [{ label: "KAST", a: 70, b: null, format: String }] }),
    leaderboardCardSvg({ title: "T", subtitle: "S", metricLabel: "KAST", rows: [] }),
    faceitCardSvg({ player: { nickname: "x", level: 3, elo: 900 }, matches: [] }),
    tsideCardSvg({ name: "x", summary: { cards: [{ title: "Alan al", status: "nodata", value: "—" }], tRounds: 0 } }),
    welcomeCardSvg({ name: "Yeni oyuncu 漢字 😀" }),
    squadReportCardSvg({ assignments: { t: [], ct: [] }, playbook: { rules: [] }, evidence: {} }, "Beşli"),
  ];
  for (const svg of cards) assert.ok(isPng(await renderPng(svg)));
});

test("ayrı süreçteki çizici bozuk SVG'de botu düşürmeden hata verir", async () => {
  const renderer = new Renderer();
  try {
    await assert.rejects(renderer.render("<svg bozuk"), /./);
    assert.ok(isPng(await renderer.render(welcomeCardSvg({ name: "Tekrar" }))), "sonraki istek çalışır");
  } finally {
    renderer.close();
  }
});
