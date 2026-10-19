// Static geometry when available; demo spotted flags are a labelled fallback.
const num = (v) => v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v);
const id = (r, p = "") => String(r?.[`${p}steamid`] || r?.[`${p}steam_id`] || r?.[`${p}name`] || "");
const gun = (w) => Boolean(w) && !/knife|bayonet|grenade|molotov|incendiary|decoy|inferno|flash|smoke|world|c4|taser/i.test(w);
const weapon = (r) => String(r?.weapon || "").replace(/^weapon_/, "");
const round = (r) => Number(r?.total_rounds_played ?? r?.round ?? 0) + 1;
const live = (r) => ![true, 1, "true"].includes(r?.is_warmup_period) && ![true, 1, "true"].includes(r?.is_freeze_period);
const xyz = (r) => {
  const v = [num(r?.X ?? r?.x), num(r?.Y ?? r?.y), num(r?.Z ?? r?.z)];
  return v.every((n) => n !== null) ? v : null;
};
const eye = (r) => { const p = xyz(r); return p && [p[0], p[1], p[2] + 64 - 18 * (num(r?.duck_amount) ?? 0)]; };
const delta = (a, b) => a.map((n, i) => n - b[i]);
const length = (v) => Math.hypot(...v);
const dot = (a, b) => a.reduce((s, n, i) => s + n * b[i], 0);
const median = (v) => { const a = [...v].sort((a, b) => a - b); return a.length ? Math.round((a[Math.floor((a.length - 1) / 2)] + a[Math.floor(a.length / 2)]) / 2) : null; };
const rounded = (v) => v === null ? null : Math.round(v * 10) / 10;

export function viewRay(row) {
  const pitch = num(row?.pitch), yaw = num(row?.yaw);
  if (pitch === null || yaw === null) return null;
  const p = pitch * Math.PI / 180, y = yaw * Math.PI / 180;
  return [Math.cos(p) * Math.cos(y), Math.cos(p) * Math.sin(y), -Math.sin(p)];
}

export function rayAngle(row, point) {
  const origin = eye(row), ray = viewRay(row);
  if (!origin || !point || !ray) return null;
  const d = delta(point, origin), size = length(d);
  return size > 0 ? Math.acos(Math.max(-1, Math.min(1, dot(ray, d) / size))) * 180 / Math.PI : null;
}

function spotted(target, observerId) {
  const raw = target?.approximate_spotted_by;
  if (!Array.isArray(raw)) return null;
  return raw.some((x) => String(x) === observerId);
}

export function buildDuelAnalyst(player, grouped, tickIndex, tickRate) {
  const self = String(player.steamid || player.name);
  const geometry = tickIndex?.duelGeometry;
  const rows = tickIndex?.raw || tickIndex || [];
  const byTick = new Map();
  for (const row of rows) {
    const key = id(row);
    if (!key || !Number.isFinite(row.tick)) continue;
    if (!byTick.has(row.tick)) byTick.set(row.tick, new Map());
    byTick.get(row.tick).set(key, row);
  }
  const at = (key, tick) => byTick.get(tick)?.get(key);
  const hz = num(tickRate);
  const validRate = hz !== null && hz > 0;
  const window = validRate ? Math.ceil(hz * 2) : 0;
  const fires = (grouped.weapon_fire || []).filter((e) => live(e) && gun(weapon(e))).sort((a, b) => a.tick - b.tick);
  const impacts = new Map();
  for (const e of grouped.bullet_impact || []) {
    const key = `${id(e, "user_")}:${e.tick}`;
    if (!impacts.has(key)) impacts.set(key, []);
    impacts.get(key).push(e);
  }
  const events = [];
  for (const kind of ["player_hurt", "player_death"]) {
    for (const e of grouped[kind] || []) {
      const a = id(e, "attacker_"), b = id(e, "user_");
      if (!live(e) || !gun(weapon(e)) || !a || !b || a === b || (a !== self && b !== self)) continue;
      const other = a === self ? b : a;
      const ownTeam = num(at(self, e.tick)?.team_num ?? e[a === self ? "attacker_team_num" : "user_team_num"]);
      const otherTeam = num(at(other, e.tick)?.team_num ?? e[a === self ? "user_team_num" : "attacker_team_num"]);
      if (ownTeam === null || otherTeam === null || ownTeam < 2 || otherTeam < 2 || ownTeam === otherTeam) continue;
      events.push({ ...e, kind, other, targetEvidence: "damage" });
    }
  }
  // Fire-only contacts retain misses. A target is only suggested when visible and
  // within 15 degrees; ambiguous shots remain explicitly unassigned.
  for (const e of fires) {
    const shooter = id(e, "user_");
    const me = at(shooter, e.tick);
    const candidates = [...(byTick.get(e.tick)?.values() || [])].filter((r) => id(r) !== shooter && r.team_num >= 2 && me?.team_num >= 2 && r.team_num !== me.team_num && r.health > 0 && (geometry?.available || spotted(r, shooter) === true))
      .map((r) => ({ r, angle: rayAngle(me, eye(r)) })).filter((r) => r.angle !== null && r.angle <= 15)
      .filter(({ r }) => !geometry?.available || geometry.check(shooter, id(r), e.tick).visible === true).sort((a, b) => a.angle - b.angle);
    const related = events.filter((x) => x.kind !== "weapon_fire" && round(x) === round(e) && Math.abs(x.tick - e.tick) <= window);
    const targets = [...new Set(related.map((x) => x.other))];
    if (shooter !== self && !related.some((x) => x.other === shooter && x.targetEvidence === "damage") && !(candidates.length === 1 && id(candidates[0].r) === self)) continue;
    const other = shooter !== self ? shooter : targets.length === 1 ? targets[0] : candidates.length === 1 ? id(candidates[0].r) : "";
    events.push({ ...e, kind: "weapon_fire", other, targetEvidence: other ? "estimated" : "unknown" });
  }
  const order = { weapon_fire: 0, player_hurt: 1, player_death: 2 };
  events.sort((a, b) => a.tick - b.tick || order[a.kind] - order[b.kind]);
  const groups = [], current = new Map();
  for (const e of events) {
    const key = `${round(e)}:${e.other}`;
    let g = current.get(key);
    if (!g || g.closed || e.tick - g.endTick > window) {
      g = { other: e.other, round: round(e), startTick: e.tick, endTick: e.tick, events: [], closed: false };
      current.set(key, g); groups.push(g);
    }
    g.events.push(e); g.endTick = e.tick;
    if (e.kind === "player_death") g.closed = true;
  }
  function visibility(observer, target, start, end, roundNo) {
    let observed = 0, seen = 0, previous = null, segment = null;
    const segments = [];
    const reasons = {};
    const min = Math.max(0, start - window);
    for (let t = min; t <= end; t++) {
      const a = at(observer, t), b = at(target, t);
      if (!a || !b || !live(a) || (a.total_rounds_played !== undefined && round(a) !== roundNo)) { previous = null; continue; }
      const ray = geometry?.available ? geometry.check(observer, target, t) : null;
      const s = ray ? ray.visible : spotted(b, observer);
      if (ray) reasons[ray.reason] = (reasons[ray.reason] || 0) + 1;
      if (s === null) { previous = null; continue; }
      observed++;
      if (s) {
        seen++;
        if (previous !== true) { segment = { start: t, end: t, censored: previous !== false }; segments.push(segment); }
        segment.end = t;
      }
      previous = s;
    }
    const contact = segments.filter((s) => s.start <= start && s.end >= start - (hz || 0) * .25).at(-1) || segments.find((s) => s.start > start);
    return { onsetTick: contact?.start ?? null, status: seen ? "spotted" : observed === end - min + 1 ? "not-spotted" : "unknown", coverage: rounded(observed / Math.max(1, end - min + 1) * 100), censored: contact?.censored ?? false,
      method: geometry?.available ? 'collision-fov-smoke-v1' : 'approximate-spotted-by', reasons };
  }
  function reaction(observer, target, g, vis) {
    const ownFires = fires.filter((e) => id(e, "user_") === observer && round(e) === g.round && e.tick >= g.startTick - window && e.tick <= g.endTick);
    const shot = ownFires.find((e) => vis.onsetTick !== null && e.tick >= vis.onsetTick);
    const hurt = g.events.find((e) => e.kind === "player_hurt" && id(e, "attacker_") === observer && id(e, "user_") === target && e.tick >= (vis.onsetTick ?? Infinity));
    const ms = validRate && shot && vis.onsetTick !== null ? Math.round((shot.tick - vis.onsetTick) * 1000 / hz) : null;
    const prefire = ownFires.some((e) => vis.onsetTick !== null && e.tick < vis.onsetTick && e.tick >= vis.onsetTick - hz * 0.25);
    const status = !validRate || vis.onsetTick === null ? "unavailable" : vis.censored ? "censored" : prefire || (ms !== null && ms < 50) ? "prefire" : ms === null ? "no-shot" : ms > 1500 ? "late" : "measured";
    return { fireMs: ms, damageMs: validRate && hurt ? Math.round((hurt.tick - vis.onsetTick) * 1000 / hz) : null, status };
  }
  const encounters = groups.map((g, index) => {
    const me = at(self, g.startTick), other = at(g.other, g.startTick);
    const death = g.events.find((e) => e.kind === "player_death");
    const ownVis = visibility(self, g.other, g.startTick, g.endTick, g.round);
    const otherVis = visibility(g.other, self, g.startTick, g.endTick, g.round);
    const mePos = xyz(me), otherPos = xyz(other);
    const distanceM = mePos && otherPos ? rounded(length(delta(mePos, otherPos)) * 0.0254) : null;
    const ownShots = fires.filter((e) => id(e, "user_") === self && round(e) === g.round && e.tick >= g.startTick && e.tick <= g.endTick);
    const contactShots = fires.filter((e) => [self, g.other].includes(id(e, "user_")) && round(e) === g.round && e.tick >= g.startTick && e.tick <= g.endTick);
    const shots = contactShots.map((e) => {
      const shooter = id(e, "user_"), target = shooter === self ? g.other : self;
      const row = at(shooter, e.tick), origin = eye(row);
      const found = impacts.get(`${shooter}:${e.tick}`) || [];
      return { tick: e.tick, owner: shooter === self ? "self" : "opponent", weapon: weapon(e), origin, direction: viewRay(row), target: eye(at(target, e.tick)),
        aimErrorDeg: rounded(rayAngle(row, eye(at(target, e.tick)))),
        impacts: found.map((hit) => ({ point: xyz(hit), deviationDeg: rounded(rayAngle(row, xyz(hit))) })).filter((x) => x.point),
      };
    });
    const ownWeapon = weapon(ownShots[0]) || weapon(g.events.find((e) => id(e, "attacker_") === self)) || String(me?.active_weapon_name || "Bilinmiyor");
    return { id: `${g.round}-${g.startTick}-${index}`, round: g.round, startTick: g.startTick, endTick: g.endTick,
      opponent: { steamid: g.other, name: other?.name || g.events.find((e) => e.kind !== "weapon_fire")?.[id(g.events.find((e) => e.kind !== "weapon_fire"), "attacker_") === self ? "user_name" : "attacker_name"] || "Hedef belirlenemedi" },
      outcome: death ? id(death, "attacker_") === self ? "win" : "loss" : "unresolved",
      targetEvidence: g.events.some((e) => e.targetEvidence === "damage") ? "damage" : g.other ? "estimated" : "unknown",
      side: me?.team_num === 2 ? "T" : me?.team_num === 3 ? "CT" : "Unknown", zone: me?.last_place_name || "Bilinmiyor",
      weapon: ownWeapon, distanceM, ownPingMs: num(me?.ping), opponentPingMs: num(other?.ping),
      ownVisibility: ownVis, opponentVisibility: otherVis,
      reaction: reaction(self, g.other, g, ownVis), opponentReaction: reaction(g.other, self, g, otherVis),
      unseenDeath: Boolean(death && id(death, "user_") === self && ownVis.status === "not-spotted"),
      damageDealt: g.events.filter((e) => e.kind === "player_hurt" && id(e, "attacker_") === self).reduce((n, e) => n + (num(e.dmg_health) ?? 0), 0),
      damageTaken: g.events.filter((e) => e.kind === "player_hurt" && id(e, "user_") === self).reduce((n, e) => n + (num(e.dmg_health) ?? 0), 0), shots,
      scene: geometry?.scene(self, g.other, g.endTick, g.startTick) || null };
  }).sort((a, b) => a.startTick - b.startTick);
  const samples = encounters.filter((e) => e.reaction.status === "measured" && e.targetEvidence === "damage").map((e) => ({ id: e.id, round: e.round, ms: e.reaction.fireMs, damageMs: e.reaction.damageMs, opponentMs: e.opponentReaction.status === "measured" ? e.opponentReaction.fireMs : null }));
  const buckets = new Map();
  for (const e of encounters) {
    if (e.distanceM === null || e.targetEvidence !== "damage" || e.weapon === "Bilinmiyor") continue;
    const range = e.distanceM < 10 ? "0–10 m" : e.distanceM < 20 ? "10–20 m" : e.distanceM < 30 ? "20–30 m" : "30+ m";
    const key = `${e.side}:${e.weapon}:${range}`;
    if (!buckets.has(key)) buckets.set(key, { side: e.side, weapon: e.weapon, range, contacts: 0, wins: 0, losses: 0, damage: 0, zones: {} });
    const b = buckets.get(key); b.contacts++; b.wins += e.outcome === "win" ? 1 : 0; b.losses += e.outcome === "loss" ? 1 : 0; b.damage += e.damageDealt;
    if (e.zone !== "Bilinmiyor") {
      b.zones[e.zone] ??= { contacts: 0, wins: 0, losses: 0 };
      b.zones[e.zone].contacts++; b.zones[e.zone].wins += e.outcome === "win" ? 1 : 0; b.zones[e.zone].losses += e.outcome === "loss" ? 1 : 0;
    }
  }
  const distanceProfile = [...buckets.values()].map((b) => ({ ...b, winrate: b.wins + b.losses ? Math.round(100 * b.wins / (b.wins + b.losses)) : null,
    recommendation: Object.entries(b.zones).filter(([, z]) => z.wins + z.losses >= 5 && z.wins > z.losses).sort((a, b) => b[1].wins / (b[1].wins + b[1].losses) - a[1].wins / (a[1].wins + a[1].losses))[0]?.[0] || null,
  })).sort((a, b) => (b.winrate ?? -1) - (a.winrate ?? -1) || b.contacts - a.contacts);
  return { method: "demo-contact-evidence-v1", tickRate: validRate ? hz : null, precisionMs: validRate ? rounded(1000 / hz) : null,
    visibilityMethod: geometry?.available ? 'collision-fov-smoke-v1' : 'approximate-spotted-by', raycastStatus: geometry?.available ? 'available' : 'unavailable-no-map-geometry', geometry: geometry?.metadata || null, encounters, distanceProfile,
    reaction: { samples, medianMs: median(samples.map((s) => s.ms)), p90Ms: samples.length ? [...samples].sort((a, b) => a.ms - b.ms)[Math.ceil(samples.length * 0.9) - 1].ms : null,
      excluded: encounters.length - samples.length, histogram: [0, 150, 250, 400, 700].map((min, i, bins) => ({ label: `${min}–${bins[i + 1] ?? 1500} ms`, count: samples.filter((s) => s.ms >= min && (i === bins.length - 1 ? s.ms <= 1500 : s.ms < bins[i + 1])).length })) } };
}
