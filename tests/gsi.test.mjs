// GSI canlı analiz birim testleri: paket işleme, hareketli atış teşhisi ve
// yeni maçta oturum sıfırlanması (regresyon: eski sürümde 2. maç eski veriyle karışıyordu).
import assert from "node:assert/strict";
import test from "node:test";
import { processGsiPacket, getLiveState, getWeaponMovementProfile, getGamePerformanceStatus } from "../companion/gsi.mjs";

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function basePacket(overrides = {}) {
  return {
    map: { name: "de_mirage", mode: "competitive", phase: "live", round: 3, team_ct: { score: 2 }, team_t: { score: 1 } },
    round: { phase: "live" },
    player: {
      name: "TestOyuncu",
      steamid: "76561198000000001",
      activity: "playing",
      team: "CT",
      state: { health: 100, money: 4000 },
      position: "100.0, 200.0, 0.0",
      weapons: {
        weapon_0: { name: "weapon_knife", type: "Knife", state: "holstered" },
        weapon_1: { name: "weapon_ak47", type: "Rifle", state: "active", ammo_clip: 30, ammo_reserve: 90 },
      },
    },
    ...overrides,
  };
}

test("GSI paketi canlı duruma işlenir", () => {
  processGsiPacket(basePacket());
  const state = getLiveState();
  assert.equal(state.map.name, "mirage");
  assert.equal(state.player.name, "TestOyuncu");
  assert.equal(state.player.activeWeapon, "ak47");
  assert.ok(state.packetCount > 0);
});

test("tüfekle hareketli atış teşhis edilir", async () => {
  // İlk konum
  processGsiPacket(basePacket());
  await wait(60);
  // Uzak konum (yüksek hız) + clip azalması = hareketli atış
  const moved = basePacket();
  moved.player.position = "500.0, 200.0, 0.0";
  moved.player.weapons.weapon_1.ammo_clip = 28;
  processGsiPacket(moved);

  const state = getLiveState();
  assert.ok(state.player.speed > 50, `hız hesaplanmalı (şu an ${state.player.speed})`);
  assert.ok(state.diagnostics.movingShots >= 2, "hareketli atış sayılmalı");
});

test("yeni maçta teşhis sayaçları sıfırlanır", async () => {
  // Önce hareketli atış üret
  processGsiPacket(basePacket());
  await wait(60);
  const moved = basePacket();
  moved.player.position = "600.0, 200.0, 0.0";
  moved.player.weapons.weapon_1.ammo_clip = 25;
  processGsiPacket(moved);
  assert.ok(getLiveState().diagnostics.movingShots >= 2, "önkoşul: hareketli atış birikti");

  // Yeni maç: farklı harita + round 0
  const newMatch = basePacket({ map: { name: "de_inferno", mode: "competitive", phase: "warmup", round: 0, team_ct: { score: 0 }, team_t: { score: 0 } } });
  processGsiPacket(newMatch);

  const state = getLiveState();
  assert.equal(state.map.name, "inferno");
  assert.equal(state.diagnostics.movingShots, 0, "yeni maçta sayaç sıfırlanmalı");
  assert.equal(state.diagnostics.stationaryShots, 0);
});

test("silah hareket profilleri doğru kategorize edilir", () => {
  assert.equal(getWeaponMovementProfile("weapon_ak47", "Rifle").category, "rifle");
  assert.equal(getWeaponMovementProfile("weapon_awp", "SniperRifle").category, "sniper");
  assert.equal(getWeaponMovementProfile("weapon_p90", "SubmachineGun").isRunAndGun, true);
  assert.equal(getWeaponMovementProfile("weapon_deagle", "Pistol").category, "heavy_pistol");
});

test("canlı harita otomatik oyun performans modunu etkinleştirir", () => {
  processGsiPacket(basePacket());
  const live = getGamePerformanceStatus();
  assert.equal(live.active, true);
  assert.equal(live.map, "mirage");

  processGsiPacket(basePacket({
    map: { name: "de_mirage", mode: "competitive", phase: "gameover", round: 13, team_ct: { score: 13 }, team_t: { score: 8 } },
  }));
  assert.equal(getGamePerformanceStatus().active, false, "gameover durumunda ağır işler yeniden açılmalı");
});

test("lobi heartbeat'i önceki harita adını taşısa bile performans modunu açık bırakmaz", () => {
  processGsiPacket(basePacket());
  assert.equal(getGamePerformanceStatus().active, true, "önkoşul: canlı maç performans korumasını açmalı");

  processGsiPacket({
    provider: { name: "Counter-Strike 2" },
    player: { steamid: "76561198000000001", activity: "menu" },
  });
  const lobby = getGamePerformanceStatus();
  assert.equal(lobby.map, "mirage", "regresyon senaryosunda eski harita bellekte kalabilir");
  assert.equal(lobby.playerActivity, "menu");
  assert.equal(lobby.active, false, "lobi/ana menüde ağır işler ertelenmemeli");
  assert.match(lobby.reason, /lobide veya ana menüde/i);
});
