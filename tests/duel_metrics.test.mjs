import assert from "node:assert/strict";
import test from "node:test";
import {
  DUEL_METHOD,
  TTD_METHOD,
  calculateDuelStatsForPlayer,
  estimateDemoTickRate,
  isDeathTraded,
} from "../companion/analyze.mjs";

const A = { name: "Alpha", steamid: "76561198000000001" };
const B = { name: "Bravo", steamid: "76561198000000002" };
const C = { name: "Charlie", steamid: "76561198000000003" };

function event(name, tick, attacker, victim, weapon = "ak47") {
  return {
    event_name: name,
    tick,
    game_time: tick / 64,
    is_warmup_period: false,
    weapon,
    attacker_name: attacker.name,
    attacker_steamid: attacker.steamid,
    user_name: victim.name,
    user_steamid: victim.steamid,
  };
}

function tickRows() {
  const rows = [];
  for (let tick = 80; tick <= 320; tick++) {
    const alphaSeesBravo = (tick >= 106 && tick <= 130) || (tick >= 294 && tick <= 300);
    const bravoSeesAlpha = (tick >= 120 && tick <= 130) || (tick >= 294 && tick <= 300);
    rows.push({
      tick,
      game_time: tick / 64,
      name: A.name,
      steamid: A.steamid,
      team_num: 2,
      approximate_spotted_by: bravoSeesAlpha ? [B.steamid] : [],
    });
    rows.push({
      tick,
      game_time: tick / 64,
      name: B.name,
      steamid: B.steamid,
      team_num: 3,
      approximate_spotted_by: alphaSeesBravo ? [A.steamid] : [],
    });
    rows.push({
      tick,
      game_time: tick / 64,
      name: C.name,
      steamid: C.steamid,
      team_num: 3,
      approximate_spotted_by: tick === 200 ? [A.steamid] : [],
    });
  }
  return rows;
}

test("TTD görünürlük başlangıcından ilk hasara hesaplanır ve aynı temas tekilleştirilir", () => {
  const grouped = {
    player_hurt: [
      event("player_hurt", 120, A, B),
      event("player_hurt", 122, A, B),
      event("player_hurt", 200, A, C),
      event("player_hurt", 250, A, B),
    ],
    player_death: [
      event("player_death", 130, A, B),
      event("player_death", 300, B, A),
    ],
  };

  const stats = calculateDuelStatsForPlayer(A, grouped, tickRows(), 64);
  assert.equal(stats.ttdMethod, TTD_METHOD);
  assert.equal(stats.averageTTD, 219);
  assert.equal(stats.medianTTD, 219);
  assert.equal(stats.ttdSampleCount, 1);
  assert.equal(stats.preparedContacts, 1, "aynı tick hazır temas reaksiyon ortalamasına girmemeli");
  assert.equal(stats.unseenHits, 1, "görünmeden verilen hasar TTD sayılmamalı");
  assert.equal(stats.fastReactions, 1);
});

test("düello yalnız karşılıklı görünür ve ölümle sonuçlanan temasları sayar", () => {
  const grouped = {
    player_hurt: [event("player_hurt", 120, A, B)],
    player_death: [
      event("player_death", 130, A, B),
      event("player_death", 300, B, A),
      event("player_death", 310, A, C),
    ],
  };

  const stats = calculateDuelStatsForPlayer(A, grouped, tickRows(), 64);
  assert.equal(stats.duelMethod, DUEL_METHOD);
  assert.equal(stats.duelWins, 1);
  assert.equal(stats.duelLosses, 1);
  assert.equal(stats.duelTotal, 2);
  assert.equal(stats.duelWinrate, 50);
});

test("örnek yoksa sahte 340 yerine ölçülemedi sonucu döner", () => {
  const stats = calculateDuelStatsForPlayer(C, { player_hurt: [], player_death: [] }, tickRows(), 64);
  assert.equal(stats.averageTTD, null);
  assert.equal(stats.medianTTD, null);
  assert.equal(stats.ttdSampleCount, 0);
  assert.equal(stats.ttdStatus, "insufficient-sample");
  assert.equal(stats.reactionRating, "Ölçülemedi");
  assert.equal(stats.duelTotal, 0);
  assert.equal(stats.duelWinrate, null);
  assert.equal(stats.duelStatus, "insufficient-sample");
});

function death(tick, round, attacker, victim, attackerTeam, victimTeam) {
  return {
    event_name: "player_death",
    tick,
    game_time: tick / 64,
    total_rounds_played: round,
    weapon: "ak47",
    attacker_name: attacker.name,
    attacker_steamid: attacker.steamid,
    attacker_team_num: attackerTeam,
    user_name: victim.name,
    user_steamid: victim.steamid,
    user_team_num: victimTeam,
  };
}

test("trade aynı roundda doğru killer ve takım ile beş saniye içinde doğrulanır", () => {
  const teammate = { name: "Delta", steamid: "76561198000000004" };
  const first = death(100, 4, B, A, 3, 2);
  const validReply = death(300, 4, teammate, B, 2, 3);
  assert.equal(isDeathTraded(first, [first, validReply], [], 64), true);

  const wrongKiller = death(250, 4, teammate, C, 2, 3);
  const nextRound = death(250, 5, teammate, B, 2, 3);
  const tooLate = death(500, 4, teammate, B, 2, 3);
  assert.equal(isDeathTraded(first, [first, wrongKiller], [], 64), false);
  assert.equal(isDeathTraded(first, [first, nextRound], [], 64), false);
  assert.equal(isDeathTraded(first, [first, tooLate], [], 64), false);
});

test("demo tick hızı game_time alanından çıkarılır", () => {
  assert.equal(estimateDemoTickRate([{ tick: 32, game_time: 1 }, { tick: 64, game_time: 2 }]), 32);
  assert.equal(estimateDemoTickRate([{ tick: 128, game_time: 1 }, { tick: 256, game_time: 2 }]), 128);
});
