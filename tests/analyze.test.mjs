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
  for (const field of ["kills", "deaths", "assists", "adr", "headshotPercent", "tradePercent", "shots", "rounds", "impact"]) {
    assert.ok(Number.isFinite(report[field]), `${field} sayısal olmalı (şu an: ${report[field]})`);
  }
  assert.ok(report.player && typeof report.player.name === "string" && report.player.name.length > 0, "oyuncu adı olmalı");

  // Koçluk motoru alanları
  assert.ok(report.movementProfile && Number.isFinite(report.movementProfile.severityScore), "movementProfile üretilmeli");
  assert.ok(report.crosshairStats && Number.isFinite(report.crosshairStats.headErrorAngle), "crosshairStats üretilmeli");
  assert.ok(report.duelStats && Number.isFinite(report.duelStats.averageTTD), "duelStats üretilmeli");
  assert.ok(Array.isArray(report.recommendations) && report.recommendations.length > 0, "en az bir tavsiye üretilmeli");
  assert.ok(Array.isArray(report.deathDetails), "deathDetails dizisi olmalı");
});
