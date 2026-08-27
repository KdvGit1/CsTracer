// Gerçek CS2 demo dosyasıyla uçtan uca analiz testi.
// data/recent_demos altındaki en küçük .dem kullanılır; klasör yoksa test atlanır.
import assert from "node:assert/strict";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { ANALYSIS_VERSION, SPRAY_METHOD, analyzeDemo, buildPlayerShotRecords, quickDemoMeta } from "../companion/analyze.mjs";

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

test("ShotRecord doğrudan isabeti demo tick'iyle bağlar ve MP5-SD adını korur", () => {
  const player = { name: "Tester", steamid: "111" };
  const grouped = {
    weapon_fire: [{
      tick: 100, weapon: "mp5sd", user_name: "Tester", user_steamid: "111", user_team_num: 2,
    }],
    bullet_damage: [{
      tick: 100, attack_tick_count: 9999,
      attacker_name: "Tester", attacker_steamid: "111", attacker_team_num: 2,
      victim_name: "Enemy", victim_steamid: "222", victim_team_num: 3,
    }],
    player_hurt: [{
      tick: 100, weapon: "mp7", dmg_health: 37, hitgroup: "neck",
      attacker_name: "Tester", attacker_steamid: "111", attacker_team_num: 2,
      user_name: "Enemy", user_steamid: "222", user_team_num: 3,
    }],
  };
  const ticks = [{
    tick: 100, name: "Tester", steamid: "111", team_num: 2, max_speed: 240,
    velocity_X: 0, velocity_Y: 0, "CCSPlayerPawn.m_iShotsFired": 1,
  }];

  const result = buildPlayerShotRecords(player, grouped, ticks);
  assert.equal(result.records.length, 1);
  assert.equal(result.records[0].hit, true, "attack_tick_count farklı olsa bile normal demo tick eşleşmeli");
  assert.equal(result.records[0].damage, 37);
  assert.deepEqual(result.records[0].hitgroups, ["neck"]);
  assert.equal(result.canonicalWeaponForEvent(grouped.player_hurt[0]), "mp5sd", "player_hurt mp7 aliası aynı tickteki MP5-SD atışına bağlanmalı");
  assert.equal(result.inconsistent, false);
});

test("analyzeDemo tam maç raporu üretir", { skip: skipReason, timeout: 300000 }, () => {
  const result = analyzeDemo(demoPath);
  assert.equal(result.analysisVersion, ANALYSIS_VERSION, "kök analiz sürümü güncel olmalı");
  assert.equal(result.analysisVersion, "3.2.0");

  // Header
  assert.ok(result.header, "header olmalı");
  assert.ok(typeof result.header.map_name === "string" && result.header.map_name.length > 0, "harita adı okunmalı");

  // Oyuncular ve raporlar
  assert.ok(Array.isArray(result.players), "players dizisi olmalı");
  assert.ok(result.players.length >= 8, `rekabetçi maçta ~10 oyuncu beklenir (bulunan: ${result.players.length})`);
  assert.ok(Array.isArray(result.reports) && result.reports.length === result.players.length, "her oyuncu için rapor üretilmeli");

  const report = result.reports[0];
  assert.equal(report.analysisVersion, result.analysisVersion, "rapor kendi analiz sürümünü taşımalı");
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
  assert.equal(report.sprayStats.method, SPRAY_METHOD, "sprey isabeti normal demo tick yöntemiyle hesaplanmalı");
  assert.ok(["measured", "insufficient-sample", "unavailable", "inconsistent"].includes(report.sprayStats.status));
  assert.equal(report.sprayStats.hitboxSampleCount, hitboxSamples, "hitbox paydası tüm silahlı player_hurt hitgroup olaylarından oluşmalı");
  if (hitboxSamples > 0) {
    const percentTotal = Object.values(report.sprayStats.hitboxPercents).reduce((sum, percent) => sum + percent, 0);
    assert.ok(percentTotal >= 98 && percentTotal <= 102, `hitbox yüzdeleri yaklaşık 100 etmeli (şu an ${percentTotal})`);
  }
  for (const weapon of report.weaponStats) {
    assert.equal(weapon.efficiency === null, weapon.shots === 0, `${weapon.weapon} için hasar/atış yalnız atış örneği varsa ölçülmeli`);
    assert.equal(weapon.movingShotPercent === null, (weapon.movementSampleCount || 0) === 0, `${weapon.weapon} hareket oranı örneksizken null olmalı`);
  }
  for (const side of report.sideStats) {
    if (side.deaths === 0) {
      assert.equal(side.topZone, null, `${side.side} tarafında ölüm yoksa 'Veri yok · 0' üretilmemeli`);
      assert.equal(side.topZoneDeaths, 0);
    }
  }
  assert.equal(report.duelStats.duelTotal, report.duelStats.duelWins + report.duelStats.duelLosses, "düello toplamı galibiyet ve mağlubiyetlerden oluşmalı");
  assert.ok(Array.isArray(report.recommendations) && report.recommendations.length > 0, "en az bir tavsiye üretilmeli");
  assert.ok(Array.isArray(report.deathDetails), "deathDetails dizisi olmalı");
  assert.equal(report.economyStats?.score, undefined, "ekonomiden puan üretilmemeli");
});
