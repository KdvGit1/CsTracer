import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  extractSquadMatch,
  findPartyCandidates,
  findPartyDiscoveries,
  findSquadCandidates,
  findSquadDiscoveries,
  normalizeMapName,
  normalizeSteamId,
  partyPlayerCoverage,
  rosterFingerprint,
  sameRoster,
  selectionFingerprint,
  selectPartyDiscoveryMatches,
} from "../companion/squad/identity.mjs";
import { SquadStore } from "../companion/squad/store.mjs";

const rosterA = Array.from({ length: 5 }, (_, index) => ({ steamid: `7656119800000000${index}`, name: `A${index}` }));
const rosterB = Array.from({ length: 5 }, (_, index) => ({ steamid: `7656119900000000${index}`, name: `B${index}` }));

function matchFixture(id, map = "de_dust2", roster = rosterA) {
  const players = [
    ...roster.map((player) => ({ ...player, team: "Team 1" })),
    ...rosterB.map((player) => ({ ...player, team: "Team 2" })),
  ];
  const reports = players.map((player) => ({
    player,
    map,
    rounds: 13,
    kills: 10,
    deaths: 8,
    roundPaths: [{ round: 1, side: player.team === "Team 1" ? "CT" : "T", won: true, primaryZone: "Long", points: [{ x: 1, y: 2 }] }],
    routeStats: [{ side: "CT", zone: "Long", totalRounds: 3, wins: 2, losses: 1, winrate: 67, kills: 4, deaths: 2 }],
  }));
  return { id, map, timestamp: Number(id.replace(/\D/g, "")) || 1, players, fullAnalysis: { parserVersion: "test", reports } };
}

test("harita ve roster kimliği format farklarından etkilenmez", () => {
  assert.equal(normalizeMapName("de_Dust II"), "dust2");
  assert.equal(normalizeMapName("workshop/123/de_mirage"), "mirage");
  assert.ok(rosterFingerprint(rosterA));
  assert.equal(rosterFingerprint(rosterA), rosterFingerprint([...rosterA].reverse()));
  assert.equal(sameRoster(rosterA, [...rosterA].reverse()), true);
  assert.equal(sameRoster(rosterA, rosterB), false);
  assert.equal(normalizeSteamId("466268533"), "76561198426534261");
  assert.equal(normalizeSteamId("76561198426534261"), "76561198426534261");
  assert.equal(normalizeSteamId("0"), "");
  assert.ok(selectionFingerprint(rosterA.slice(0, 2)));
  assert.equal(selectionFingerprint(rosterA.slice(0, 2)), selectionFingerprint([...rosterA.slice(0, 2)].reverse()));
});

function mixedPartyMatch(id, selectedPlayer, seed, { replay = false } = {}) {
  const owner = rosterA[0];
  const fillers = Array.from({ length: 3 }, (_, index) => ({
    steamid: String(76561198100000000n + BigInt(seed * 10 + index)),
    name: `Dolgu ${seed}-${index}`,
  }));
  const teamA = [owner, selectedPlayer, ...fillers];
  const players = [
    ...teamA.map((player) => ({ ...player, team: "Team 1" })),
    ...rosterB.map((player) => ({ ...player, team: "Team 2" })),
  ];
  return {
    id,
    map: "dust2",
    timestamp: seed,
    replayUrl: replay ? `https://replay1.valve.net/730/${id}.dem.bz2` : "",
    userStats: owner,
    players,
    fullAnalysis: {
      reports: players.map((player) => ({
        player,
        rounds: 12,
        kills: 8,
        deaths: 7,
        sideStats: [{ side: "CT", rounds: 6, kills: 4, deaths: 3, damage: 400 }],
        roundPaths: [{ round: 1, side: player.team === "Team 1" ? "CT" : "T", won: true, primaryZone: "Long" }],
      })),
    },
  };
}

test("maç iki beşli takım halinde sıkıştırılır ve rota koordinatları arşive alınmaz", () => {
  const compact = extractSquadMatch(matchFixture("m1"));
  assert.equal(compact.map, "dust2");
  assert.equal(compact.teams.length, 2);
  assert.equal(compact.teams[0].players.length, 5);
  assert.equal("points" in compact.teams[0].players[0].report.roundPaths[0], false);
});

test("adaylar tam aynı beşli ve aynı harita ile bulunur", () => {
  const matches = [
    extractSquadMatch(matchFixture("m1")),
    extractSquadMatch(matchFixture("m2", "dust2")),
    extractSquadMatch(matchFixture("m3", "mirage")),
  ];
  assert.deepEqual(findSquadCandidates(matches, rosterA, "de_dust2").map((match) => match.id), ["m2", "m1"]);
  assert.equal(findSquadCandidates(matches, rosterB.slice(0, 4), "dust2").length, 0);
});

test("indirilebilir keşif yalnızca aynı beşli ve haritadaki arşivlenmemiş maçları döndürür", () => {
  const rosterWithAccountIds = rosterA.map((player, index) => index < 2
    ? { ...player, steamid: String(BigInt(player.steamid) - 76561197960265728n) }
    : player);
  const scanned = [
    { ...matchFixture("m1"), replayUrl: "https://replay1.valve.net/730/m1.dem.bz2" },
    { ...matchFixture("m2"), replayUrl: "https://replay1.valve.net/730/m2.dem.bz2" },
    { ...matchFixture("m3", "mirage"), replayUrl: "https://replay1.valve.net/730/m3.dem.bz2" },
    { ...matchFixture("m4", "dust2", rosterB), replayUrl: "https://replay1.valve.net/730/m4.dem.bz2" },
    { ...matchFixture("m5", "dust2", rosterWithAccountIds), replayUrl: "https://replay1.valve.net/730/m5.dem.bz2" },
  ];
  const archived = [extractSquadMatch(matchFixture("m1"))];

  assert.deepEqual(findSquadDiscoveries(scanned, archived, rosterA, "de_dust2").map((match) => match.id), ["m5", "m2"]);
  assert.equal(findSquadDiscoveries(scanned, archived, rosterA.slice(0, 4), "dust2").length, 0);
});

test("değişken ekip adayları oyuncular aynı maçta olmasa da sahip hesabıyla takımdaş olduklarında birleşir", () => {
  const ownerId = rosterA[0].steamid;
  const selected = [rosterA[1], rosterA[2]];
  const rawMatches = [
    ...Array.from({ length: 3 }, (_, index) => mixedPartyMatch(`a-${index}`, selected[0], 10 + index)),
    ...Array.from({ length: 3 }, (_, index) => mixedPartyMatch(`b-${index}`, selected[1], 20 + index)),
  ];
  const archived = rawMatches.map((match) => extractSquadMatch(match));
  const candidates = findPartyCandidates(archived, selected, "de_dust2", ownerId);
  const coverage = partyPlayerCoverage(candidates, selected, ownerId);
  assert.equal(candidates.length, 6);
  assert.deepEqual(coverage.map((item) => item.matchIds.length), [3, 3]);
  assert.equal(candidates.some((match) => match.matchedPlayerIds.length > 1), false);
});

test("değişken ekip keşfi yalnızca kullanıcıyla aynı takımda olan oyuncuyu indirir ve ihtiyacı kadar maç önerir", () => {
  const ownerId = rosterA[0].steamid;
  const selected = [rosterA[1], rosterA[2]];
  const scanned = [
    ...Array.from({ length: 4 }, (_, index) => mixedPartyMatch(`a-${index}`, selected[0], 30 + index, { replay: true })),
    ...Array.from({ length: 3 }, (_, index) => mixedPartyMatch(`b-${index}`, selected[1], 40 + index, { replay: true })),
    { ...mixedPartyMatch("opponent", rosterB[1], 50, { replay: true }), userStats: { steamid: ownerId, name: "Owner" } },
  ];
  const discoveries = findPartyDiscoveries(scanned, [], selected, "dust2", ownerId);
  const coverage = selected.map((player) => ({ player, matchIds: [] }));
  const suggested = selectPartyDiscoveryMatches(discoveries, coverage);
  assert.equal(discoveries.some((match) => match.id === "opponent"), false);
  assert.equal(suggested.length, 6);
  assert.deepEqual(partyPlayerCoverage(suggested, selected, ownerId).map((item) => item.matchIds.length), [3, 3]);
});

test("SquadStore arşivi atomik yazar, günceller ve notları korur", () => {
  const root = mkdtempSync(join(tmpdir(), "tracer-squad-test-"));
  try {
    const store = new SquadStore(root);
    assert.equal(store.ingestMatch(matchFixture("m1")).ok, true);
    assert.equal(store.ingestMatch(matchFixture("m1")).updated, true);
    assert.equal(store.ingestMatch(matchFixture("m2")).ok, true);
    assert.equal(store.candidates(rosterA, "dust2").length, 2);

    assert.equal(store.partyCandidates(rosterA.slice(0, 2), "dust2", rosterA[0].steamid).length, 2);

    const squad = store.saveSquad({ roster: rosterA.slice(0, 2), map: "de_dust2", name: "A0, A1" });
    assert.equal(squad.map, "dust2");
    assert.equal(store.updateNotes(squad.id, "Long smoke unutma").notes, "Long smoke unutma");
    assert.equal(store.saveSquad({ roster: rosterA.slice(0, 2), map: "dust2", name: "A0, A1" }).notes, "Long smoke unutma");
    assert.doesNotThrow(() => JSON.parse(readFileSync(store.matchesPath, "utf8")));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
