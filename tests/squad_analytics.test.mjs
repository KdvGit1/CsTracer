import assert from "node:assert/strict";
import test from "node:test";
import { buildSquadEvidence, evidenceConfidence } from "../companion/squad/analytics.mjs";
import { rosterFingerprint } from "../companion/squad/identity.mjs";

const roster = Array.from({ length: 5 }, (_, index) => ({ steamid: `7656119800000010${index}`, name: `Oyuncu ${index + 1}` }));

function compactMatch(index) {
  const id = rosterFingerprint(roster);
  return {
    id: `match-${index}`,
    map: "dust2",
    timestamp: index,
    teams: [{
      id,
      players: roster.map((player, playerIndex) => ({
        ...player,
        report: {
          player,
          rounds: 12,
          kills: 8 + playerIndex,
          deaths: 6,
          assists: 3,
          adr: 80,
          openingKills: playerIndex === 0 ? 2 : 0,
          openingDeaths: 1,
          utilityDamage: playerIndex === 3 ? 80 : 10,
          flashesThrown: playerIndex === 3 ? 6 : 1,
          sideStats: [
            { side: "CT", rounds: 6, kills: 5, deaths: 3, assists: 1, damage: 500, shots: 50 },
            { side: "T", rounds: 6, kills: 3, deaths: 3, assists: 2, damage: 400, shots: 45 },
          ],
          routeStats: [
            { side: "CT", zone: playerIndex === 0 ? "Long" : "A Site", totalRounds: 3, wins: 2, losses: 1, kills: 3, deaths: 1 },
            { side: "T", zone: "Long", totalRounds: 1, wins: 1, losses: 0, kills: 1, deaths: 0 },
          ],
          weaponStats: [{ weapon: playerIndex === 4 ? "awp" : "ak47", label: playerIndex === 4 ? "AWP" : "AK-47", category: playerIndex === 4 ? "sniper" : "rifle", kills: 5, damage: 500, shots: 40, headshots: 2 }],
        },
      })),
    }],
  };
}

test("çok maçlı kanıt tüm beş oyuncuyu ve iki tarafı toplar", () => {
  const result = buildSquadEvidence([compactMatch(1), compactMatch(2), compactMatch(3)], roster, "de_dust2");
  assert.equal(result.evidence.matches, 3);
  assert.equal(result.evidence.teamRounds, 36);
  assert.equal(result.players.length, 5);
  assert.equal(result.players[0].overall.rounds, 36);
  assert.equal(result.players[0].sides.find((side) => side.side === "CT").rounds, 18);
  assert.equal(result.players[4].weaponCategories[0].category, "sniper");
});

test("küçük rota örneği yüzde yüz diye aşırı iddialı sunulmaz", () => {
  const result = buildSquadEvidence([compactMatch(1), compactMatch(2), compactMatch(3)], roster, "dust2");
  const route = result.players[0].routes.find((item) => item.side === "T" && item.zone === "Long");
  assert.equal(route.rawWinRate, 100);
  assert.ok(route.adjustedWinRate < 100);
  assert.ok(route.confidence < result.players[0].evidence.confidence);
});

test("üçten az maç rapor üretmez ve güven örnekle büyür", () => {
  assert.throws(() => buildSquadEvidence([compactMatch(1), compactMatch(2)], roster, "dust2"), /en az 3/);
  assert.ok(evidenceConfidence(5, 50) > evidenceConfidence(1, 2));
});

function singleSelectedMatch(id, selectedPlayer, seed) {
  const owner = roster[0];
  const fillers = Array.from({ length: 3 }, (_, index) => ({ steamid: String(76561198200000000n + BigInt(seed * 10 + index)), name: `F${seed}-${index}` }));
  const members = [owner, selectedPlayer, ...fillers];
  return {
    id,
    map: "dust2",
    timestamp: seed,
    userStats: owner,
    teams: [{
      id: `dynamic-${seed}`,
      players: members.map((player) => ({
        ...player,
        report: {
          player,
          rounds: 12,
          kills: 9,
          deaths: 7,
          assists: 3,
          sideStats: [{ side: "CT", rounds: 6, kills: 5, deaths: 3, assists: 1, damage: 480 }, { side: "T", rounds: 6, kills: 4, deaths: 4, assists: 2, damage: 420 }],
          routeStats: [{ side: "T", zone: "Long", totalRounds: 3, wins: 2, losses: 1, kills: 3, deaths: 2 }],
          weaponStats: [{ weapon: "ak47", category: "rifle", kills: 5, damage: 500, shots: 40 }],
        },
      })),
    }],
  };
}

test("iki seçili oyuncunun birbirinden farklı üçer maçı tek dinamik ekip raporunda birleşir", () => {
  const selected = [roster[1], roster[2]];
  const matches = [
    ...Array.from({ length: 3 }, (_, index) => singleSelectedMatch(`a${index}`, selected[0], 10 + index)),
    ...Array.from({ length: 3 }, (_, index) => singleSelectedMatch(`b${index}`, selected[1], 20 + index)),
  ];
  const result = buildSquadEvidence(matches, selected, "dust2", { ownerSteamId: roster[0].steamid });
  assert.equal(result.evidence.matches, 6);
  assert.equal(result.players.length, 2);
  assert.deepEqual(result.players.map((player) => player.evidence.matches), [3, 3]);
  assert.equal(result.warnings.length, 1);
});

test("minimum üç maç birleşim toplamına değil her seçili oyuncuya ayrı uygulanır", () => {
  const selected = [roster[1], roster[2]];
  const matches = [
    ...Array.from({ length: 3 }, (_, index) => singleSelectedMatch(`a${index}`, selected[0], 30 + index)),
    ...Array.from({ length: 2 }, (_, index) => singleSelectedMatch(`b${index}`, selected[1], 40 + index)),
  ];
  assert.throws(
    () => buildSquadEvidence(matches, selected, "dust2", { ownerSteamId: roster[0].steamid }),
    /Oyuncu 3: 2\/3/,
  );
});
