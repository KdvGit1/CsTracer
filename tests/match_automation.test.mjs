import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  MatchAutomationStore,
  buildCompactSummaryFromReport,
  clampDemoRetention,
  enforceDemoRetention,
  getDemoStorageStats,
  latestUnanalyzedScannedMatch,
  performanceComparison,
} from "../companion/match_automation.mjs";

test("demo saklama adedi 3 ile 50 arasında sınırlandırılır", () => {
  assert.equal(clampDemoRetention(1), 3);
  assert.equal(clampDemoRetention(12), 12);
  assert.equal(clampDemoRetention(99), 50);
  assert.equal(clampDemoRetention("bozuk"), 5);
});

test("ham DEM kotası eski dosyayı siler ama analiz kaydını korur", () => {
  const root = mkdtempSync(join(tmpdir(), "tracer-retention-"));
  const demosDir = join(root, "demos");
  mkdirSync(demosDir);
  try {
    const matches = [];
    for (let index = 0; index < 5; index += 1) {
      const path = join(demosDir, `match-${index}.dem`);
      writeFileSync(path, Buffer.alloc((index + 1) * 10));
      matches.push({ id: String(index), timestamp: index + 1, demoPath: path, fullAnalysis: { reports: [] } });
    }
    const result = enforceDemoRetention({ demosDir, matches, retentionCount: 3, protectedPaths: [matches[0].demoPath] });
    assert.equal(result.deleted.length, 2);
    assert.equal(result.kept.length, 3);
    assert.equal(result.matches.length, 5);
    assert.equal(result.matches.every((match) => match.fullAnalysis), true);
    assert.equal(result.matches.find((match) => match.id === "0").demoAvailable, undefined);
    assert.equal(result.storage.demoCount, 3);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("disk tahmini yerel DEM boyutu ortalamasını kullanır", () => {
  const root = mkdtempSync(join(tmpdir(), "tracer-estimate-"));
  try {
    writeFileSync(join(root, "a.dem"), Buffer.alloc(100));
    writeFileSync(join(root, "b.dem"), Buffer.alloc(300));
    const storage = getDemoStorageStats(root, 5);
    assert.equal(storage.averageDemoBytes, 200);
    assert.equal(storage.estimatedBytes, 1000);
    assert.equal(storage.estimateSource, "local-average");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("performans karşılaştırması en az üç geçmiş maç ister ve mevcut maçı dışlar", () => {
  const progressMatches = [50, 60, 70, 99].map((overall, index) => ({
    id: index === 3 ? "current" : String(index),
    playerSteamId: "765",
    summary: { overall, stats: { kills: 10 + index, deaths: 10 } },
  }));
  const result = performanceComparison({
    summary: { overall: 72 },
    progressMatches,
    identity: { steamid: "765" },
    currentMatchId: "current",
  });
  assert.deepEqual(result, { kind: "overall", value: 72, baseline: 60, delta: 12, sampleSize: 3, sufficient: true });
});

test("otomatik telafi yalnızca taramadaki en yeni analiz edilmemiş maçı seçer", () => {
  const scanned = [
    { id: "older", timestamp: 10, replayUrl: "https://replay1.valve.net/730/older.dem.bz2" },
    { id: "latest", timestamp: 20, replayUrl: "https://replay1.valve.net/730/latest.dem.bz2" },
  ];
  assert.equal(latestUnanalyzedScannedMatch(scanned, [])?.id, "latest");
  assert.equal(latestUnanalyzedScannedMatch(scanned, [{ id: "latest" }]), null, "en yeni analizliyse eski maç kendiliğinden indirilmemeli");
});

test("bildirimler maç kimliğiyle tekilleştirilir ve otomatik indirme durumunu taşır", () => {
  const root = mkdtempSync(join(tmpdir(), "tracer-notifications-"));
  try {
    const store = new MatchAutomationStore(root);
    store.saveSettings({ autoDownloadLatestMatch: true, demoRetentionCount: 7 });
    const match = { id: "m1", map: "inferno", mode: "Premier", timestamp: 10 };
    assert.equal(store.discover([match, match]).length, 1);
    assert.equal(store.discover([match]).length, 0);
    const state = store.state(join(root, "missing"));
    assert.equal(state.settings.demoRetentionCount, 7);
    assert.equal(state.notifications[0].status, "queued");
    assert.equal(state.notifications[0].auto, true);
    assert.equal(state.unreadCount, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("companion performans özeti arayüzdeki 0-100 formülüyle uyumludur", () => {
  const summary = buildCompactSummaryFromReport({
    rounds: 20, kills: 22, deaths: 15, assists: 5, adr: 91, headshotPercent: 55,
    movingShotPercent: 9, utilityDamage: 120, enemyBlindSeconds: 18, tradePercent: 52,
    topZoneDeaths: 3, openingDeaths: 2, impact: 82, weaponStats: [],
  });
  assert.ok(summary.overall >= 70 && summary.overall <= 100);
  assert.equal(summary.stats.kills, 22);
});
