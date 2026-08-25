import assert from "node:assert/strict";
import test from "node:test";
import { rosterFingerprint } from "../companion/squad/identity.mjs";
import { SUPPORTED_SQUAD_MAPS, squadMapConfig } from "../companion/squad/maps.mjs";
import { buildSquadReport } from "../companion/squad/planner.mjs";

const roster = Array.from({ length: 5 }, (_, index) => ({ steamid: `7656119800000020${index}`, name: `P${index + 1}` }));

function match(index) {
  return {
    id: `m${index}`,
    map: "dust2",
    timestamp: index,
    teams: [{
      id: rosterFingerprint(roster),
      players: roster.map((player, p) => ({
        ...player,
        report: {
          rounds: 12,
          kills: 7 + p,
          deaths: 6,
          assists: p === 3 ? 8 : 2,
          adr: 70 + p * 4,
          openingKills: p === 0 ? 4 : 0,
          openingDeaths: p === 0 ? 2 : 1,
          utilityDamage: p === 3 ? 140 : 10,
          flashesThrown: p === 3 ? 8 : 1,
          sideStats: [{ side: "CT", rounds: 6, kills: 4 + p, deaths: 3, assists: 1, damage: 450 + p * 20, shots: 40 }, { side: "T", rounds: 6, kills: 3 + p, deaths: 3, assists: 1, damage: 400 + p * 20, shots: 40 }],
          routeStats: [{ side: "CT", zone: ["A Long", "A Short", "Mid Doors", "B Site", "Lower Tunnels"][p], totalRounds: 4, wins: 3, losses: 1, kills: 4, deaths: 2 }, { side: "T", zone: "A Long", totalRounds: 3, wins: 2, losses: 1, kills: 3, deaths: 2 }],
          weaponStats: [{ weapon: p === 4 ? "awp" : "ak47", label: p === 4 ? "AWP" : "AK-47", category: p === 4 ? "sniper" : "rifle", kills: p === 4 ? 8 : 5, damage: 600, shots: 50, headshots: 2 }],
        },
      })),
    }],
  };
}

test("rol ve CT pozisyonları beş farklı oyuncuya bire bir atanır", () => {
  const report = buildSquadReport([match(1), match(2), match(3)], roster, "dust2");
  assert.equal(new Set(report.assignments.t.map((item) => item.player.steamid)).size, 5);
  assert.equal(new Set(report.assignments.ct.map((item) => item.player.steamid)).size, 5);
  assert.equal(report.assignments.t.find((item) => item.role === "awp").player.name, "P5");
  assert.equal(report.weapons.find((item) => item.status === "primary_awp").player.name, "P5");
  assert.ok(report.playbook.roundPlans.length >= 5);
  const midPlanAwpTask = report.playbook.roundPlans.find((plan) => plan.id === "b_split").tasks.find((task) => task.text.startsWith("AWP"));
  assert.equal(midPlanAwpTask.role, "awp");
  assert.equal(midPlanAwpTask.playerName, "P5");
});

test("desteklenen her harita beş CT pozisyonu ve üç T planı sağlar", () => {
  assert.ok(SUPPORTED_SQUAD_MAPS.length >= 15);
  for (const map of SUPPORTED_SQUAD_MAPS) {
    const config = squadMapConfig(map);
    assert.equal(config.ct.length, 5, map);
    assert.ok(config.t.length >= 3, map);
  }
});

test("bilinmeyen/atölye haritası güvenli genel planla çalışır", () => {
  const config = squadMapConfig("workshop/123/de_custommap");
  assert.equal(config.generic, true);
  assert.equal(config.ct.length, 5);
});

test("dinamik ekip raporu yalnızca seçilen oyuncu sayısı kadar rol, konum, silah ve görev üretir", () => {
  const selected = roster.slice(0, 3);
  const report = buildSquadReport([match(1), match(2), match(3)], selected, "dust2", { ownerSteamId: roster[0].steamid });
  assert.equal(report.playerCards.length, 3);
  assert.equal(report.assignments.t.length, 3);
  assert.equal(report.assignments.ct.length, 3);
  assert.equal(report.weapons.length, 3);
  assert.equal(report.playbook.roundPlans.every((plan) => plan.tasks.length === 3), true);
  assert.equal(report.playbook.roundPlans.flatMap((plan) => plan.tasks).some((task) => task.playerName === "Takım"), false);
});
