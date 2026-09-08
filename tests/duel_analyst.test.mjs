import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDuelAnalyst, rayAngle } from '../companion/duel_analyst.mjs';
import { radarPathSegments } from '../shared/radar.mjs';
const A = { steamid: '1', name: 'A' };
function rows({ unseen = false, missing = false, censored = false } = {}) {
  const result = [];
  for (let tick = 0; tick <= 200; tick++) {
    const base = { tick, game_time: tick / 64, X: 0, Y: 0, Z: 0, yaw: 0, pitch: 0, health: 100, total_rounds_played: 0, last_place_name: 'Apartments', active_weapon_name: 'ak47' };
    result.push({ ...base, ...A, team_num: 2, ping: 40, approximate_spotted_by: tick >= 110 ? ['2'] : [] });
    if (!(missing && tick === 80)) result.push({ ...base, steamid: '2', name: 'B', team_num: 3, ping: 60, X: 400, yaw: 180, approximate_spotted_by: !unseen && (censored || tick >= 100) ? ['1'] : [] });
  }
  return result;
}
const event = (tick, attacker = '1', user = '2') => ({ tick, total_rounds_played: 0, weapon: 'ak47', attacker_steamid: attacker, attacker_name: attacker === '1' ? 'A' : 'B', user_steamid: user, user_name: user === '1' ? 'A' : 'B', dmg_health: 30 });
const fixture = () => ({ weapon_fire: [{ ...event(120), user_steamid: '1', user_name: 'A' }, { ...event(124), user_steamid: '2', user_name: 'B' }], player_hurt: [event(122)], player_death: [event(130)], bullet_impact: [{ tick: 120, user_steamid: '1', x: 400, y: 0, z: 64 }] });
test('groups shots/damage/death once, compares reaction and ping separately, measures distance and rays', () => {
  const a = buildDuelAnalyst(A, fixture(), rows(), 64);
  assert.equal(a.encounters.length, 1);
  const d = a.encounters[0];
  assert.equal(d.outcome, 'win'); assert.equal(d.reaction.fireMs, 313); assert.equal(d.reaction.damageMs, 344);
  assert.equal(d.opponentReaction.fireMs, 219); assert.equal(d.ownPingMs, 40); assert.equal(d.opponentPingMs, 60);
  assert.equal(d.distanceM, 10.2); assert.equal(d.shots[0].impacts[0].deviationDeg, 0);
  assert.equal(a.reaction.samples.length, 1); assert.equal(a.distanceProfile[0].recommendation, null);
});
test('unseen death requires complete observed window; missing visibility is not proof of unseen death', () => {
  const g = { player_death: [event(130, '2', '1')] };
  assert.equal(buildDuelAnalyst(A, g, rows({ unseen: true }), 64).encounters[0].unseenDeath, true);
  const a = buildDuelAnalyst(A, g, rows({ unseen: true, missing: true }), 64);
  assert.equal(a.encounters[0].unseenDeath, false); assert.equal(a.encounters[0].ownVisibility.status, 'unknown');
});
test('no fabricated samples with unknown tick rate, left-censored visibility or absent coordinates/ping', () => {
  assert.equal(buildDuelAnalyst(A, fixture(), rows(), null).reaction.samples.length, 0);
  assert.equal(buildDuelAnalyst(A, fixture(), rows({ censored: true }), 64).reaction.samples.length, 0);
  const noPosition = rows().map((r) => { const copy = { ...r }; delete copy.X; delete copy.ping; return copy; });
  const d = buildDuelAnalyst(A, fixture(), noPosition, 64).encounters[0];
  assert.equal(d.distanceM, null); assert.equal(d.ownPingMs, null);
});
test('fire-only events remain visible, unresolved and excluded from measured target reaction', () => {
  const a = buildDuelAnalyst(A, { weapon_fire: fixture().weapon_fire }, rows(), 64);
  assert.equal(a.encounters.length, 1); assert.equal(a.encounters[0].outcome, 'unresolved');
  assert.equal(a.encounters[0].targetEvidence, 'estimated'); assert.equal(a.reaction.samples.length, 0);
});
test('friendly fire and warmup do not count as damage-confirmed duels', () => {
  const r = rows().map((r) => ({ ...r, team_num: 2 }));
  assert.equal(buildDuelAnalyst(A, { player_death: fixture().player_death }, r, 64).encounters.length, 0);
  assert.equal(buildDuelAnalyst(A, { player_death: [{ ...event(130), is_warmup_period: true }] }, rows(), 64).encounters.length, 0);
});
test('ray-angle uses vertical as well as horizontal direction', () => {
  assert.equal(rayAngle({ X: 0, Y: 0, Z: 0, yaw: 0, pitch: 0 }, [100, 0, 64]), 0);
  assert.equal(Math.round(rayAngle({ X: 0, Y: 0, Z: 0, yaw: 0, pitch: 0 }, [0, 100, 64])), 90);
});
test('radar breaks paths at floor changes, missing samples and map exits instead of drawing phantom bridges', () => {
  const map = { posX: 0, posY: 1024, scale: 1, lowerImage: '/lower.png', lowerMaxZ: 0 };
  const points = Array.from({ length: 7 }, (_, i) => ({ x: 100 + i * 10, y: 500, z: i === 2 ? -10 : 10, tick: i * 64 }));
  assert.deepEqual(radarPathSegments(points, map).map((s) => s.length), [2, 4]);
  points[4].x = NaN;
  assert.deepEqual(radarPathSegments(points, map).map((s) => s.length), [2, 2]);
  points[4].x = 2000;
  assert.deepEqual(radarPathSegments(points, map).map((s) => s.length), [2, 2]);
});
