// Gerçek CS2 demo dosyasıyla uçtan uca analiz testi.
// data/recent_demos altındaki en küçük .dem kullanılır; klasör yoksa test atlanır.
import assert from "node:assert/strict";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { analyzeDemo, quickDemoMeta } from "../companion/analyze.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DEMO_DIR = join(ROOT, "data", "recent_demos");

function smallestDemo() {
  if (!existsSync(DEMO_DIR)) return null;
  const demos = readdirSync(DEMO_DIR)
    .filter((f) => f.toLowerCase().endsWith(".dem"))
    .map((f) => ({ name: f, size: statSync(join(DEMO_DIR, f)).size }))
    .sort((a, b) => a.size - b.size);
  return demos.length ? join(DEMO_DIR, demos[0].name) : null;
}

const demoPath = smallestDemo();
const skipReason = !demoPath && "data/recent_demos altında .dem dosyası yok";

test("quickDemoMeta gerçek demodan harita ve skor okur", { skip: skipReason, timeout: 60000 }, () => {
  const meta = quickDemoMeta(demoPath);
  assert.ok(meta && typeof meta === "object", "meta dönmeli");
  assert.ok(typeof meta.map === "string" && meta.map.length > 0, "harita adı okunmalı");
});

test("quickDemoMeta okunamayan demoya sahte harita atamaz", () => {
  const meta = quickDemoMeta(Buffer.from("geçerli demo değil"));
  assert.equal(meta.map, "");
  assert.equal(meta.score, "—");
});

test("analyzeDemo tam maç raporu üretir", { skip: skipReason, timeout: 300000 }, () => {
  const result = analyzeDemo(demoPath);

  // Header
  assert.ok(result.header, "header olmalı");
  assert.ok(typeof result.header.map_name === "string" && result.header.map_name.length > 0, "harita adı okunmalı");

  // Oyuncular ve raporlar
  assert.ok(Array.isArray(result.players), "players dizisi olmalı");
  assert.ok(result.players.length >= 8, `rekabetçi maçta ~10 oyuncu beklenir (bulunan: ${result.players.length})`);
  assert.ok(Array.isArray(result.reports) && result.reports.length === result.players.length, "her oyuncu için rapor üretilmeli");

  const report = result.reports[0];
  // Temel skor alanları
  for (const field of ["kills", "deaths", "assists", "adr", "headshotPercent", "shots", "rounds"]) {
    assert.ok(Number.isFinite(report[field]), `${field} sayısal olmalı (şu an: ${report[field]})`);
  }
  assert.equal(report.impact === null, report.rounds === 0, "round yoksa KAST/impact null olmalı");
  assert.equal(report.tradePercent === null, report.deaths === 0, "ölüm örneği yoksa trade yüzdesi null olmalı");
  assert.ok(report.player && typeof report.player.name === "string" && report.player.name.length > 0, "oyuncu adı olmalı");

  // Koçluk motoru alanları
  assert.ok(report.movementProfile && ["measured", "unavailable"].includes(report.movementProfile.status), "movementProfile veri durumu üretmeli");
  assert.ok(report.crosshairStats && ["measured", "insufficient-sample"].includes(report.crosshairStats.status), "crosshairStats veri durumu üretmeli");
  assert.ok(report.duelStats, "duelStats üretilmeli");
  assert.equal(report.duelStats.ttdMethod, "spotted-to-first-damage-v2", "TTD yeni görünürlük yöntemiyle hesaplanmalı");
  assert.equal(report.duelStats.duelMethod, "mutual-spotted-death-v2", "düello karşılıklı görünür temaslardan hesaplanmalı");
  assert.equal(report.duelStats.averageTTD === null, report.duelStats.ttdStatus !== "measured", "TTD ölçülemediyse sahte sayı dönmemeli");
  assert.equal(report.duelStats.medianTTD === null, report.duelStats.ttdStatus !== "measured", "medyan TTD ölçülemediyse null olmalı");
  assert.equal(report.crosshairStats.headErrorAngle === null, report.crosshairStats.status !== "measured", "kill tick hizası ölçülemediyse null olmalı");
  const hitboxSamples = Object.values(report.sprayStats.hitboxCounts).reduce((sum, count) => sum + count, 0);
  assert.equal(report.sprayStats.hitboxSampleCount, hitboxSamples, "hitbox paydası yalnız tanınan doğrudan hitgroup olaylarından oluşmalı");
  if (hitboxSamples > 0) {
    const percentTotal = Object.values(report.sprayStats.hitboxPercents).reduce((sum, percent) => sum + percent, 0);
    assert.ok(percentTotal >= 98 && percentTotal <= 102, `hitbox yüzdeleri yaklaşık 100 etmeli (şu an ${percentTotal})`);
  }
  for (const weapon of report.weaponStats) {
    assert.equal(weapon.efficiency === null, weapon.shots === 0, `${weapon.weapon} için hasar/atış yalnız atış örneği varsa ölçülmeli`);
    assert.equal(weapon.movingShotPercent === null, (weapon.movementSampleCount || 0) === 0, `${weapon.weapon} hareket oranı örneksizken null olmalı`);
  }
  assert.equal(report.duelStats.duelTotal, report.duelStats.duelWins + report.duelStats.duelLosses, "düello toplamı galibiyet ve mağlubiyetlerden oluşmalı");
  assert.ok(Array.isArray(report.recommendations) && report.recommendations.length > 0, "en az bir tavsiye üretilmeli");
  assert.ok(Array.isArray(report.deathDetails), "deathDetails dizisi olmalı");
  assert.equal(report.economyStats?.score, undefined, "ekonomiden puan üretilmemeli");
});
