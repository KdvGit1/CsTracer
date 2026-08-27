import { parseEvents, parseHeader, parseTicks } from "@laihoe/demoparser2";

const CORE_EVENTS = [
  "round_start", "round_end", "round_freeze_end", "player_death", "player_hurt", "weapon_fire",
  "player_blind", "flashbang_detonate", "smokegrenade_detonate",
  "hegrenade_detonate", "molotov_detonate", "inferno_startburn",
  "bomb_planted", "bomb_defused", "bullet_damage", "bullet_impact", "item_pickup",
];

const PLAYER_PROPS = [
  "X", "Y", "Z", "pitch", "yaw", "velocity_X", "velocity_Y", "team_num", "max_speed",
  "duck_amount", "is_airborne", "round_start_equip_value",
  "last_place_name", "active_weapon", "health", "armor_value", "inventory",
  "CCSPlayerPawn.m_iShotsFired",
  "CCSPlayerController.CCSPlayerController_InGameMoneyServices.m_iAccount",
  "CCSPlayerController.CCSPlayerController_InGameMoneyServices.m_iCashSpentThisRound",
  "CCSPlayerController.CCSPlayerController_InGameMoneyServices.m_iStartAccount",
];

const OTHER_PROPS = ["total_rounds_played", "game_time", "is_warmup_period"];

export const TTD_METHOD = "spotted-to-first-damage-v2";
export const DUEL_METHOD = "mutual-spotted-death-v2";
export const ANALYSIS_VERSION = "3.1.0";
const CONTACT_WINDOW_MS = 2000;
const MAX_REACTION_TTD_MS = 1500;
const MIN_REACTION_TTD_MS = 50;
const DUEL_DEATH_GRACE_MS = 250;
const VISIBILITY_GAP_TOLERANCE_TICKS = 2;

function normalizedKey(key) {
  return String(key).toLowerCase().replace(/[^a-z0-9]/g, "");
}

function value(record, candidates, fallback = undefined) {
  if (!record) return fallback;
  for (const candidate of candidates) {
    if (record[candidate] !== undefined && record[candidate] !== null) return record[candidate];
  }
  const lookup = new Map(Object.keys(record).map((key) => [normalizedKey(key), record[key]]));
  for (const candidate of candidates) {
    const found = lookup.get(normalizedKey(candidate));
    if (found !== undefined && found !== null) return found;
  }
  return fallback;
}

function text(record, candidates) {
  const found = value(record, candidates, "");
  return found === null || found === undefined ? "" : String(found);
}

function number(record, candidates, fallback = 0) {
  const found = Number(value(record, candidates, fallback));
  return Number.isFinite(found) ? found : fallback;
}

function finiteNumber(record, candidates) {
  const raw = value(record, candidates, undefined);
  if (raw === undefined || raw === null || raw === "") return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function role(record, prefix, property) {
  return value(record, [
    `${prefix}_${property}`,
    `${prefix}${property}`,
    prefix === "user" ? property : `player_${property}`,
  ]);
}

function eventName(record) {
  return text(record, ["event_name", "eventName", "name"]);
}

function roundNumber(record) {
  return number(record, ["total_rounds_played", "round", "round_num"], 0);
}

function isWarmup(record) {
  const raw = value(record, ["is_warmup_period", "isWarmup"], false);
  return raw === true || raw === 1 || raw === "true";
}

function steamId(record, prefix) {
  const found = role(record, prefix, "steamid") ?? role(record, prefix, "steam_id") ?? role(record, prefix, "xuid");
  return found ? String(found) : "";
}

function playerName(record, prefix) {
  const found = role(record, prefix, "name") ?? role(record, prefix, "player_name");
  return found ? String(found) : "";
}

function translateZone(zone) {
  if (!zone) return "Bilinmeyen bölge";
  const zones = {
    shortstairs: "A Short", catwalk: "A Short", short: "A Short",
    longdoors: "Long Doors", longa: "A Long", long: "A Long", pit: "Pit",
    bombsitea: "A Site", bombsiteb: "B Site", aramp: "A Ramp",
    tunnels: "Tüneller", uppertunnel: "Upper Tunnels", lowertunnel: "Lower Tunnels",
    middledoors: "Mid Doors", mid: "Mid", ctspawn: "CT Spawn", tspawn: "T Spawn",
    topofmid: "Top Mid",
  };
  const key = normalizedKey(zone);
  return zones[key] || String(zone).replace(/([a-z])([A-Z])/g, "$1 $2");
}

function groupEvents(allRows) {
  const grouped = Object.fromEntries(CORE_EVENTS.map((name) => [name, []]));
  for (const record of allRows) {
    const name = eventName(record);
    if (grouped[name]) grouped[name].push(record);
  }
  return grouped;
}

function collectPlayers(events) {
  const players = new Map();
  const add = (name, id) => {
    if (!name || name.toLowerCase() === "world") return;
    const key = id || name;
    if (!players.has(key)) players.set(key, { name, steamid: id || "" });
  };
  for (const record of events) {
    for (const prefix of ["user", "attacker", "assister", "player"]) {
      add(playerName(record, prefix), steamId(record, prefix));
    }
  }
  return Array.from(players.values()).sort((a, b) => a.name.localeCompare(b.name));
}

function matchesPlayer(record, prefix, player) {
  const id = steamId(record, prefix);
  const name = playerName(record, prefix);
  return Boolean((player.steamid && id === player.steamid) || name === player.name);
}

function buildTickIndex(tickRows) {
  const byPlayerTick = new Map();
  const byPlayerList = new Map();
  const byTick = new Map();
  if (Array.isArray(tickRows)) {
    for (const row of tickRows) {
      const tick = number(row, ["tick"]);
      const sid = text(row, ["steamid", "steam_id"]);
      const name = text(row, ["name", "player_name"]);
      if (sid) {
        byPlayerTick.set(`${sid}_${tick}`, row);
        let list = byPlayerList.get(sid);
        if (!list) { list = []; byPlayerList.set(sid, list); }
        list.push(row);
      }
      if (name) {
        byPlayerTick.set(`${name}_${tick}`, row);
        let list = byPlayerList.get(name);
        if (!list) { list = []; byPlayerList.set(name, list); }
        list.push(row);
      }
      let tList = byTick.get(tick);
      if (!tList) { tList = []; byTick.set(tick, tList); }
      tList.push(row);
    }
  }
  return { byPlayerTick, byPlayerList, byTick, raw: Array.isArray(tickRows) ? tickRows : [] };
}

function mergeTickRows(...groups) {
  const merged = new Map();
  for (const rows of groups) {
    if (!Array.isArray(rows)) continue;
    for (const row of rows) {
      const tick = number(row, ["tick"], 0);
      const identity = text(row, ["steamid", "steam_id"]) || text(row, ["name", "player_name"]);
      if (!identity || !tick) continue;
      const key = `${identity}:${tick}`;
      merged.set(key, { ...(merged.get(key) || {}), ...row });
    }
  }
  return [...merged.values()];
}

function rowForPlayerAtTick(ticksOrIndex, tick, player) {
  if (!ticksOrIndex) return undefined;
  if (ticksOrIndex.byPlayerTick) {
    if (player.steamid) {
      const found = ticksOrIndex.byPlayerTick.get(`${player.steamid}_${tick}`);
      if (found) return found;
    }
    if (player.name) {
      const found = ticksOrIndex.byPlayerTick.get(`${player.name}_${tick}`);
      if (found) return found;
    }
    return undefined;
  }
  if (Array.isArray(ticksOrIndex)) {
    return ticksOrIndex.find((record) => number(record, ["tick"]) === tick && (
      text(record, ["steamid", "steam_id"]) === player.steamid ||
      text(record, ["name", "player_name"]) === player.name
    ));
  }
  return undefined;
}

function distance(a, b) {
  return Math.hypot(number(a, ["X", "x"]) - number(b, ["X", "x"]), number(a, ["Y", "y"]) - number(b, ["Y", "y"]));
}

function teamSide(teamNumber) {
  return Number(teamNumber) === 3 ? "CT" : Number(teamNumber) === 2 ? "T" : "Unknown";
}

function eventWeapon(record) {
  return text(record, ["weapon", "weapon_name", "active_weapon"]).toLowerCase().replace(/^weapon_/, "");
}

function weaponLabel(weapon) {
  const labels = {
    ak47: "AK-47", m4a1: "M4A4", m4a1_silencer: "M4A1-S", awp: "AWP", ssg08: "SSG 08",
    galilar: "Galil AR", famas: "FAMAS", aug: "AUG", sg556: "SG 553", mp9: "MP9", mac10: "MAC-10",
    mp7: "MP7", mp5sd: "MP5-SD", ump45: "UMP-45", p90: "P90", bizon: "PP-Bizon",
    deagle: "Desert Eagle", elite: "Dual Berettas", fiveseven: "Five-SeveN", tec9: "Tec-9",
    hkp2000: "P2000", usp_silencer: "USP-S", glock: "Glock-18", p250: "P250", cz75a: "CZ75-Auto",
    revolver: "R8 Revolver", mag7: "MAG-7", nova: "Nova", sawedoff: "Sawed-Off", xm1014: "XM1014",
    m249: "M249", negev: "Negev",
  };
  return labels[weapon] || weapon.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function isGun(weapon) {
  return Boolean(weapon) && !/knife|bayonet|grenade|flash|smoke|molotov|incendiary|inferno|taser|c4|world|decoy/.test(weapon);
}

function percentile(values, ratio) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * ratio))];
}

function spottedByIds(row) {
  const found = value(row, ["approximate_spotted_by", "CCSPlayerPawn.m_bSpottedByMask"], []);
  return new Set(Array.isArray(found) ? found.map(String) : []);
}

function rowGameTime(row, tick, tickRate) {
  return number(row, ["game_time"], Number(tick) / Math.max(1, tickRate));
}

function isVisibleTo(ticks, tick, observer, target, requireMutual = false) {
  if (!observer?.steamid || !target?.steamid) return false;
  const targetRow = rowForPlayerAtTick(ticks, tick, target);
  if (!targetRow || !spottedByIds(targetRow).has(String(observer.steamid))) return false;
  if (!requireMutual) return true;
  const observerRow = rowForPlayerAtTick(ticks, tick, observer);
  return Boolean(observerRow && spottedByIds(observerRow).has(String(target.steamid)));
}

function sameKnownTeam(ticks, tick, first, second) {
  const firstRow = rowForPlayerAtTick(ticks, tick, first);
  const secondRow = rowForPlayerAtTick(ticks, tick, second);
  const firstTeam = number(firstRow, ["team_num"], 0);
  const secondTeam = number(secondRow, ["team_num"], 0);
  return firstTeam > 1 && secondTeam > 1 && firstTeam === secondTeam;
}

function teamForRole(record, prefix, ticks, tick) {
  const fromEvent = finiteNumber({ value: role(record, prefix, "team_num") }, ["value"]);
  if (fromEvent !== null && fromEvent > 1) return fromEvent;
  const identity = { name: playerName(record, prefix), steamid: steamId(record, prefix) };
  return number(rowForPlayerAtTick(ticks, tick, identity), ["team_num"], 0);
}

function isKnownEnemyInteraction(record, attackerPrefix, victimPrefix, ticks) {
  const tick = number(record, ["tick"], 0);
  const attackerTeam = teamForRole(record, attackerPrefix, ticks, tick);
  const victimTeam = teamForRole(record, victimPrefix, ticks, tick);
  return attackerTeam > 1 && victimTeam > 1 && attackerTeam !== victimTeam;
}

function sameRoleIdentity(firstRecord, firstPrefix, secondRecord, secondPrefix) {
  const firstId = steamId(firstRecord, firstPrefix);
  const secondId = steamId(secondRecord, secondPrefix);
  if (firstId && secondId) return firstId === secondId;
  const firstName = playerName(firstRecord, firstPrefix);
  const secondName = playerName(secondRecord, secondPrefix);
  return Boolean(firstName && secondName && firstName === secondName);
}

export function isDeathTraded(death, allDeaths, ticksOrRows, tickRate) {
  const ticks = ticksOrRows?.byPlayerTick ? ticksOrRows : buildTickIndex(ticksOrRows);
  const deathTick = number(death, ["tick"], 0);
  const deathTime = finiteNumber(death, ["game_time"]);
  const deathRound = roundNumber(death);
  const victimTeam = teamForRole(death, "user", ticks, deathTick);
  if (!deathTick || victimTeam <= 1 || !playerName(death, "attacker")) return false;

  return (Array.isArray(allDeaths) ? allDeaths : []).some((later) => {
    const laterTick = number(later, ["tick"], 0);
    if (laterTick <= deathTick || roundNumber(later) !== deathRound) return false;
    const laterTime = finiteNumber(later, ["game_time"]);
    const elapsedSeconds = deathTime !== null && laterTime !== null
      ? laterTime - deathTime
      : Number.isFinite(tickRate) && tickRate > 0 ? (laterTick - deathTick) / tickRate : Number.POSITIVE_INFINITY;
    if (elapsedSeconds <= 0 || elapsedSeconds > 5) return false;
    if (!sameRoleIdentity(death, "attacker", later, "user")) return false;
    if (sameRoleIdentity(death, "user", later, "attacker")) return false;
    const laterAttackerTeam = teamForRole(later, "attacker", ticks, laterTick);
    return laterAttackerTeam === victimTeam && isKnownEnemyInteraction(later, "attacker", "user", ticks);
  });
}

function findVisibilitySegment({ ticks, observer, target, eventRecord, tickRate, requireMutual, endGraceMs }) {
  const endTick = number(eventRecord, ["tick"], 0);
  if (!endTick || !observer?.steamid || !target?.steamid) return null;
  const endRow = rowForPlayerAtTick(ticks, endTick, target) || rowForPlayerAtTick(ticks, endTick, observer);
  const eventTime = number(eventRecord, ["game_time"], rowGameTime(endRow, endTick, tickRate));
  const maxTicks = Math.ceil((CONTACT_WINDOW_MS / 1000) * Math.max(1, tickRate));
  const minTick = Math.max(0, endTick - maxTicks);

  let anchorTick = -1;
  for (let tick = endTick; tick >= minTick; tick--) {
    const row = rowForPlayerAtTick(ticks, tick, target) || rowForPlayerAtTick(ticks, tick, observer);
    const ageMs = Math.max(0, (eventTime - rowGameTime(row, tick, tickRate)) * 1000);
    if (ageMs > CONTACT_WINDOW_MS) break;
    if (isVisibleTo(ticks, tick, observer, target, requireMutual)) {
      if (ageMs > endGraceMs) return null;
      anchorTick = tick;
      break;
    }
  }
  if (anchorTick < 0) return null;

  let onsetTick = anchorTick;
  let missingTicks = 0;
  let reachedWindowLimit = false;
  for (let tick = anchorTick - 1; tick >= minTick; tick--) {
    const row = rowForPlayerAtTick(ticks, tick, target) || rowForPlayerAtTick(ticks, tick, observer);
    const ageMs = Math.max(0, (eventTime - rowGameTime(row, tick, tickRate)) * 1000);
    if (ageMs > CONTACT_WINDOW_MS) {
      reachedWindowLimit = true;
      break;
    }
    if (isVisibleTo(ticks, tick, observer, target, requireMutual)) {
      onsetTick = tick;
      missingTicks = 0;
    } else {
      missingTicks++;
      if (missingTicks > VISIBILITY_GAP_TOLERANCE_TICKS) break;
    }
    if (tick === minTick) reachedWindowLimit = true;
  }

  const onsetRow = rowForPlayerAtTick(ticks, onsetTick, target) || rowForPlayerAtTick(ticks, onsetTick, observer);
  const delayMs = Math.max(0, Math.round((eventTime - rowGameTime(onsetRow, onsetTick, tickRate)) * 1000));
  if (reachedWindowLimit && delayMs >= CONTACT_WINDOW_MS - 25) return { censored: true, onsetTick, delayMs };
  return { censored: false, onsetTick, delayMs };
}

export function estimateDemoTickRate(eventRows, fallback = null) {
  const samples = (Array.isArray(eventRows) ? eventRows : [])
    .map((row) => ({ tick: number(row, ["tick"], 0), time: number(row, ["game_time"], Number.NaN) }))
    .filter((row) => row.tick > 0 && Number.isFinite(row.time))
    .sort((a, b) => a.tick - b.tick);
  const rates = [];
  for (let index = 1; index < samples.length; index++) {
    const tickDelta = samples[index].tick - samples[index - 1].tick;
    const timeDelta = samples[index].time - samples[index - 1].time;
    if (tickDelta > 0 && timeDelta >= 0.1) {
      const rate = tickDelta / timeDelta;
      if (rate >= 16 && rate <= 256) rates.push(rate);
    }
  }
  return rates.length ? Math.round(percentile(rates, 0.5) * 1000) / 1000 : fallback;
}

export function calculateDuelStatsForPlayer(player, grouped, ticksOrRows, tickRate = null) {
  const ticks = ticksOrRows?.byPlayerTick ? ticksOrRows : buildTickIndex(ticksOrRows);
  if (!Number.isFinite(tickRate) || tickRate <= 0) {
    return {
      averageTTD: null, medianTTD: null, ttdSampleCount: 0, preparedContacts: 0, unseenHits: 0,
      censoredContacts: 0, ttdMethod: TTD_METHOD, ttdStatus: "unavailable",
      ttdReason: "Demo tick hızı çıkarılamadı.", duelWinrate: null, duelWins: 0, duelLosses: 0,
      duelTotal: 0, duelMethod: DUEL_METHOD, duelStatus: "unavailable",
      duelReason: "Demo tick hızı çıkarılamadı.", fastReactions: 0, reactionRating: "Ölçülemedi",
    };
  }
  const ttdContacts = new Map();
  let preparedContacts = 0;
  let unseenHits = 0;
  let censoredContacts = 0;

  const hurts = (grouped?.player_hurt || [])
    .filter((record) => !isWarmup(record))
    .filter((record) => matchesPlayer(record, "attacker", player) && !matchesPlayer(record, "user", player))
    .filter((record) => isGun(eventWeapon(record)))
    .sort((a, b) => number(a, ["tick"]) - number(b, ["tick"]));

  for (const hurt of hurts) {
    const observer = { name: playerName(hurt, "attacker"), steamid: steamId(hurt, "attacker") };
    const target = { name: playerName(hurt, "user"), steamid: steamId(hurt, "user") };
    const tick = number(hurt, ["tick"], 0);
    if (!observer.steamid || !target.steamid || sameKnownTeam(ticks, tick, observer, target)) continue;
    const segment = findVisibilitySegment({
      ticks, observer, target, eventRecord: hurt, tickRate, requireMutual: false, endGraceMs: 40,
    });
    if (!segment) {
      unseenHits++;
      continue;
    }
    if (segment.censored) {
      censoredContacts++;
      continue;
    }
    const key = `${observer.steamid}:${target.steamid}:${segment.onsetTick}`;
    if (!ttdContacts.has(key)) ttdContacts.set(key, segment.delayMs);
  }

  const reactionValues = [];
  for (const delayMs of ttdContacts.values()) {
    if (delayMs < MIN_REACTION_TTD_MS) preparedContacts++;
    else if (delayMs <= MAX_REACTION_TTD_MS) reactionValues.push(delayMs);
  }
  const averageTTD = reactionValues.length
    ? Math.round(reactionValues.reduce((sum, delay) => sum + delay, 0) / reactionValues.length)
    : null;
  const medianTTD = reactionValues.length ? percentile(reactionValues, 0.5) : null;

  let duelWins = 0;
  let duelLosses = 0;
  const deaths = (grouped?.player_death || [])
    .filter((record) => !isWarmup(record))
    .filter((record) => isGun(eventWeapon(record)))
    .filter((record) => matchesPlayer(record, "attacker", player) || matchesPlayer(record, "user", player));

  for (const death of deaths) {
    const observer = { name: playerName(death, "attacker"), steamid: steamId(death, "attacker") };
    const target = { name: playerName(death, "user"), steamid: steamId(death, "user") };
    const tick = number(death, ["tick"], 0);
    if (!observer.steamid || !target.steamid || observer.steamid === target.steamid || sameKnownTeam(ticks, tick, observer, target)) continue;
    const segment = findVisibilitySegment({
      ticks, observer, target, eventRecord: death, tickRate, requireMutual: true, endGraceMs: DUEL_DEATH_GRACE_MS,
    });
    if (!segment || segment.censored) continue;
    if (matchesPlayer(death, "attacker", player)) duelWins++;
    else if (matchesPlayer(death, "user", player)) duelLosses++;
  }

  const duelTotal = duelWins + duelLosses;
  const duelWinrate = duelTotal ? Math.round((duelWins / duelTotal) * 100) : null;
  const reactionRating = reactionValues.length ? `${reactionValues.length} temas ölçüldü` : "Ölçülemedi";

  return {
    averageTTD,
    medianTTD,
    ttdSampleCount: reactionValues.length,
    preparedContacts,
    unseenHits,
    censoredContacts,
    ttdMethod: TTD_METHOD,
    ttdStatus: reactionValues.length ? "measured" : "insufficient-sample",
    ttdReason: reactionValues.length ? undefined : "Geçerli görünür temas örneği bulunamadı.",
    duelWinrate,
    duelWins,
    duelLosses,
    duelTotal,
    duelMethod: DUEL_METHOD,
    duelStatus: duelTotal ? "measured" : "insufficient-sample",
    duelReason: duelTotal ? undefined : "Ölümle sonuçlanan karşılıklı görünür düello bulunamadı.",
    fastReactions: reactionValues.filter((delay) => delay <= 250).length,
    reactionRating,
  };
}

function weaponCategory(weapon) {
  const w = (weapon || "").toLowerCase().replace(/^weapon_/, "");
  if (/awp|ssg08|scar20|g3sg1/.test(w)) return "sniper";
  if (/ak47|m4a1|m4a1_silencer|galilar|famas|aug|sg556|deagle/.test(w)) return "rifle";
  if (/glock|usp_silencer|hkp2000|p250|fiveseven|tec9|elite|cz75a|revolver/.test(w)) return "pistol";
  if (/mp9|mac10|mp7|mp5sd|ump45|p90|bizon/.test(w)) return "smg";
  if (/xm1014|mag7|nova|sawedoff|m249|negev/.test(w)) return "heavy";
  return "other";
}

function shotSpeed(record, tickRow) {
  const vx = Number(role(record, "user", "velocity_X") ?? role(record, "player", "velocity_X") ?? value(tickRow, ["velocity_X"], Number.NaN));
  const vy = Number(role(record, "user", "velocity_Y") ?? role(record, "player", "velocity_Y") ?? value(tickRow, ["velocity_Y"], Number.NaN));
  if (!Number.isFinite(vx) || !Number.isFinite(vy)) return null;
  return Math.hypot(vx, vy);
}

function movingShot(record, tickRow) {
  const speed = shotSpeed(record, tickRow);
  const maxSpeed = finiteNumber(tickRow, ["max_speed"]);
  if (speed === null || maxSpeed === null || maxSpeed <= 0) return null;
  const airborneRaw = value(tickRow, ["is_airborne"], false);
  const airborne = airborneRaw === true || airborneRaw === 1 || airborneRaw === "true";
  return airborne || speed > maxSpeed * 0.34;
}

function buildWeaponAwareMovementProfile(shotEntries) {
  const measuredEntries = shotEntries.filter((entry) => Number.isFinite(entry.speed) && Number.isFinite(entry.maxSpeed) && entry.maxSpeed > 0);
  if (!measuredEntries.length) {
    return {
      averageSpeed: 0, p90Speed: 0, stableShots: 0, microMoveShots: 0, movingShots: 0, fastMoveShots: 0,
      stablePercent: 0, microPercent: 0, movingPercent: 0, fastPercent: 0, invalidShotPercent: 0,
      severityScore: 0, severity: "unavailable", status: "unavailable", sampleCount: 0,
      unmeasuredShots: shotEntries.length, method: "weapon-max-speed-34pct-v1",
      reason: "Atış ticklerinde hız veya max_speed verisi bulunamadı.",
      byCategory: { sniper: { shots: 0, movingPercent: 0 }, rifle: { shots: 0, movingPercent: 0 }, pistol: { shots: 0, movingPercent: 0 }, smg: { shots: 0, movingPercent: 0 } },
    };
  }

  const speeds = measuredEntries.map((e) => e.speed).sort((a, b) => a - b);
  const total = speeds.length;
  const count = (minimum, maximum = Infinity) => speeds.filter((speed) => speed > minimum && speed <= maximum).length;
  const stableShots = speeds.filter((speed) => speed <= 15).length;
  const microMoveShots = count(15, 50);
  const movingShots = count(50, 120);
  const fastMoveShots = count(120);
  const percent = (amount) => total ? Math.round((amount / total) * 100) : 0;

  const catStats = {
    sniper: { shots: 0, moving: 0 },
    rifle: { shots: 0, moving: 0 },
    pistol: { shots: 0, moving: 0 },
    smg: { shots: 0, moving: 0 },
    other: { shots: 0, moving: 0 },
  };

  let invalidShots = 0;
  for (const entry of measuredEntries) {
    const { speed, weapon, maxSpeed, airborne } = entry;
    const cat = weaponCategory(weapon);
    if (!catStats[cat]) catStats[cat] = { shots: 0, moving: 0 };
    catStats[cat].shots++;

    if (airborne || speed > maxSpeed * 0.34) {
      invalidShots++;
      catStats[cat].moving++;
    }
  }

  const invalidShotPercent = Math.round((invalidShots / total) * 100);
  const severityScore = invalidShotPercent;
  const severity = severityScore >= 35 ? "severe" : severityScore >= 20 ? "moderate" : severityScore >= 8 ? "minor" : "clean";

  const byCategory = {};
  for (const [key, val] of Object.entries(catStats)) {
    byCategory[key] = {
      shots: val.shots,
      movingPercent: val.shots ? Math.round((val.moving / val.shots) * 100) : 0,
    };
  }

  return {
    averageSpeed: Math.round((speeds.reduce((sum, speed) => sum + speed, 0) / total) * 10) / 10,
    p90Speed: Math.round(speeds[Math.min(total - 1, Math.floor(total * 0.9))] * 10) / 10,
    stableShots, microMoveShots, movingShots, fastMoveShots,
    stablePercent: percent(stableShots), microPercent: percent(microMoveShots),
    movingPercent: percent(movingShots), fastPercent: percent(fastMoveShots),
    invalidShotPercent, severityScore, severity, byCategory,
    status: "measured", sampleCount: total, unmeasuredShots: shotEntries.length - total,
    method: "weapon-max-speed-34pct-v1",
  };
}

function calculateAngleDeviation(attackerPos, targetPos) {
  const dx = targetPos.x - attackerPos.x;
  const dy = targetPos.y - attackerPos.y;
  const dz = targetPos.z - attackerPos.z;
  const dist2D = Math.hypot(dx, dy);
  if (dist2D === 0) return 0;

  const targetYaw = (Math.atan2(dy, dx) * 180) / Math.PI;
  const targetPitch = (-Math.atan2(dz, dist2D) * 180) / Math.PI;

  let deltaYaw = ((attackerPos.yaw - targetYaw + 540) % 360) - 180;
  let deltaPitch = attackerPos.pitch - targetPitch;

  return Math.sqrt(deltaYaw * deltaYaw + deltaPitch * deltaPitch);
}

function buildPlayerReport(player, grouped, ticks, header, tickRate) {
  const deathsAll = grouped.player_death.filter((record) => !isWarmup(record));
  const deaths = deathsAll.filter((record) => matchesPlayer(record, "user", player));
  const combatDeaths = deathsAll.filter((record) => isKnownEnemyInteraction(record, "attacker", "user", ticks));
  const kills = combatDeaths.filter((record) => matchesPlayer(record, "attacker", player) && !matchesPlayer(record, "user", player));
  const assists = deathsAll.filter((record) => matchesPlayer(record, "assister", player));
  const hurts = grouped.player_hurt.filter((record) => matchesPlayer(record, "attacker", player) && !matchesPlayer(record, "user", player) && isKnownEnemyInteraction(record, "attacker", "user", ticks));
  const shots = grouped.weapon_fire.filter((record) => !isWarmup(record) && (matchesPlayer(record, "user", player) || matchesPlayer(record, "player", player)));
  const gunShots = shots.filter((record) => isGun(eventWeapon(record)));
  const blinds = grouped.player_blind.filter((record) => matchesPlayer(record, "attacker", player) && isKnownEnemyInteraction(record, "attacker", "user", ticks));
  const blindedEvents = grouped.player_blind.filter((record) => matchesPlayer(record, "user", player));
  const flashes = grouped.flashbang_detonate.filter((record) => matchesPlayer(record, "user", player) || matchesPlayer(record, "player", player));
  const roundEnds = grouped.round_end.filter((record) => !isWarmup(record));
  const rounds = Math.max(roundEnds.length, ...deathsAll.map(roundNumber), 0);
  const damage = hurts.reduce((sum, record) => sum + number(record, ["dmg_health", "health_damage", "damage"], 0), 0);
  const headshots = kills.filter((record) => value(record, ["headshot"], false) === true || value(record, ["headshot"]) === 1).length;

  const firstDeaths = new Map();
  for (const record of [...combatDeaths].sort((a, b) => number(a, ["tick"]) - number(b, ["tick"]))) {
    const round = roundNumber(record);
    if (!firstDeaths.has(round)) firstDeaths.set(round, record);
  }
  const openingKills = Array.from(firstDeaths.values()).filter((record) => matchesPlayer(record, "attacker", player)).length;
  const openingDeaths = Array.from(firstDeaths.values()).filter((record) => matchesPlayer(record, "user", player)).length;

  // 1. Silaha Duyarlı Hareket Analizi (Weapon-Aware Movement Profile)
  const shotEntries = gunShots.map((record) => {
    const tick = number(record, ["tick"]);
    const tickRow = rowForPlayerAtTick(ticks, tick, player);
    const speed = shotSpeed(record, tickRow);
    const maxSpeed = finiteNumber(tickRow, ["max_speed"]);
    const airborneRaw = value(tickRow, ["is_airborne"], false);
    const airborne = airborneRaw === true || airborneRaw === 1 || airborneRaw === "true";
    const weapon = eventWeapon(record);
    return { speed, maxSpeed, airborne, weapon, tick };
  });
  const movementProfile = buildWeaponAwareMovementProfile(shotEntries);
  const movingShots = movementProfile.status === "measured"
    ? shotEntries.filter((entry) => Number.isFinite(entry.speed) && Number.isFinite(entry.maxSpeed) && entry.maxSpeed > 0 && (entry.airborne || entry.speed > entry.maxSpeed * 0.34)).length
    : 0;

  // 2. Sprey & Hitbox Dağılımı (Hitbox & Spray Stats)
  const gunHurts = hurts.filter((h) => isGun(eventWeapon(h)));
  const totalGunShots = gunShots.length;
  const bulletDamageAvailable = Array.isArray(grouped.bullet_damage) && grouped.bullet_damage.length > 0;
  const playerBulletDamage = bulletDamageAvailable ? grouped.bullet_damage.filter((record) =>
    matchesPlayer(record, "attacker", player) && isKnownEnemyInteraction(record, "attacker", "user", ticks)) : [];
  const hitAttackTicks = new Set(playerBulletDamage.map((record) => number(record, ["attack_tick_count", "attack_tick", "tick"], 0)).filter(Boolean));
  const totalGunHits = hitAttackTicks.size;
  const accuracyPercent = bulletDamageAvailable && totalGunShots
    ? Math.round((totalGunHits / totalGunShots) * 1000) / 10
    : null;

  const hitboxCounts = { head: 0, chest: 0, stomach: 0, arms: 0, legs: 0 };
  gunHurts.forEach((h) => {
    const hg = (text(h, ["hitgroup", "hit_group"]) || "").toLowerCase();
    if (hg === "head" || hg === "1") hitboxCounts.head++;
    else if (hg === "chest" || hg === "2") hitboxCounts.chest++;
    else if (hg === "stomach" || hg === "3") hitboxCounts.stomach++;
    else if (/arm|4|5/.test(hg)) hitboxCounts.arms++;
    else if (/leg|6|7/.test(hg)) hitboxCounts.legs++;
  });

  const hitboxSampleCount = Object.values(hitboxCounts).reduce((sum, count) => sum + count, 0);

  const hitboxPercents = {
    head: hitboxSampleCount ? Math.round((hitboxCounts.head / hitboxSampleCount) * 100) : 0,
    chest: hitboxSampleCount ? Math.round((hitboxCounts.chest / hitboxSampleCount) * 100) : 0,
    stomach: hitboxSampleCount ? Math.round((hitboxCounts.stomach / hitboxSampleCount) * 100) : 0,
    arms: hitboxSampleCount ? Math.round((hitboxCounts.arms / hitboxSampleCount) * 100) : 0,
    legs: hitboxSampleCount ? Math.round((hitboxCounts.legs / hitboxSampleCount) * 100) : 0,
  };

  // Sprey analizi: ilk 3 mermi vs 4+ mermiler
  let earlyShots = 0;
  let earlyHits = 0;
  let lateShots = 0;
  let lateHits = 0;
  gunShots.forEach((s) => {
    const tick = number(s, ["tick"]);
    const tickRow = rowForPlayerAtTick(ticks, tick, player);
    const shotsFired = finiteNumber(tickRow, ["CCSPlayerPawn.m_iShotsFired", "m_iShotsFired"]);
    if (shotsFired === null || !bulletDamageAvailable) return;
    const isHit = hitAttackTicks.has(tick);
    if (shotsFired <= 3) {
      earlyShots++;
      if (isHit) earlyHits++;
    } else {
      lateShots++;
      if (isHit) lateHits++;
    }
  });

  const sprayStats = {
    totalShots: totalGunShots,
    totalHits: totalGunHits,
    accuracyPercent,
    earlyAccuracy: earlyShots ? Math.round((earlyHits / earlyShots) * 100) : null,
    lateAccuracy: lateShots ? Math.round((lateHits / lateShots) * 100) : null,
    earlyShots,
    lateShots,
    status: bulletDamageAvailable ? (totalGunShots ? "measured" : "insufficient-sample") : "unavailable",
    method: "bullet-damage-attack-tick-v1",
    reason: bulletDamageAvailable ? (totalGunShots ? undefined : "Silahlı atış örneği bulunamadı.") : "Demo bullet_damage olayı sağlamadı; player_hurt zaman yakınlığıyla tahmin yapılmadı.",
    hitboxSampleCount,
    hitboxCounts,
    hitboxPercents,
  };

  // 3. Kafa Sapması & Gövde Sapması (Crosshair to Head & Body Precision)
  const headDeviations = [];
  const bodyDeviations = [];

  kills.forEach((record) => {
    const tick = number(record, ["tick"]);
    const attackerRow = rowForPlayerAtTick(ticks, tick, player);
    const victimName = playerName(record, "user");
    const victimRow = rowForPlayerAtTick(ticks, tick, { name: victimName, steamid: steamId(record, "user") });

    if (attackerRow && victimRow) {
      const requiredValues = [
        finiteNumber(attackerRow, ["X", "x"]), finiteNumber(attackerRow, ["Y", "y"]), finiteNumber(attackerRow, ["Z", "z"]),
        finiteNumber(attackerRow, ["pitch"]), finiteNumber(attackerRow, ["yaw"]),
        finiteNumber(victimRow, ["X", "x"]), finiteNumber(victimRow, ["Y", "y"]), finiteNumber(victimRow, ["Z", "z"]),
      ];
      if (requiredValues.some((item) => item === null)) return;
      const attPos = {
        x: requiredValues[0], y: requiredValues[1], z: requiredValues[2] + 64,
        pitch: requiredValues[3], yaw: requiredValues[4],
      };
      const vicX = requiredValues[5];
      const vicY = requiredValues[6];
      const vicZ = requiredValues[7];

      const headPos = { x: vicX, y: vicY, z: vicZ + 62 };
      const bodyPos = { x: vicX, y: vicY, z: vicZ + 40 };

      const headDev = calculateAngleDeviation(attPos, headPos);
      const bodyDev = calculateAngleDeviation(attPos, bodyPos);

      if (headDev < 45) headDeviations.push(headDev);
      if (bodyDev < 45) bodyDeviations.push(bodyDev);
    }
  });

  const avgHeadError = headDeviations.length ? Math.round(percentile(headDeviations, 0.5) * 10) / 10 : null;
  const avgBodyError = bodyDeviations.length ? Math.round(percentile(bodyDeviations, 0.5) * 10) / 10 : null;

  const crosshairStats = {
    headErrorAngle: avgHeadError,
    bodyErrorAngle: avgBodyError,
    headLevelRating: headDeviations.length ? "Kill anı hizası · pre-aim değildir" : "Ölçülemedi",
    status: headDeviations.length ? "measured" : "insufficient-sample",
    sampleCount: headDeviations.length,
    method: "kill-tick-alignment-v2",
    reason: headDeviations.length ? undefined : "Geçerli saldırgan ve hedef tick konumu bulunan kill yok.",
  };

  // 4. Yaklaşık Time-to-Damage (TTD) ve gerçek karşılıklı görünür düello analizi.
  // TTD: hedefin approximate_spotted_by listesine saldırganın girdiği temas başlangıcından
  // ilk silahlı player_hurt olayına kadar. Düello: iki oyuncu birbirini görürken ölümle
  // sonuçlanan temaslar. Ölçüm yoksa sahte bir varsayılan değer üretilmez.
  const duelStats = calculateDuelStatsForPlayer(player, grouped, ticks, tickRate);

  // 5. Ekonomi Analizi (Economy Stats)
  const roundEconomy = [];
  const startMoneyList = [];
  const spentMoneyList = [];
  const freezeEndsForEconomy = (grouped.round_freeze_end || []).filter((record) => !isWarmup(record));

  for (let r = 1; r <= rounds; r++) {
    const freezeEvent = freezeEndsForEconomy[r - 1];
    const sampleTick = freezeEvent ? number(freezeEvent, ["tick"], 0) : 0;
    const row = sampleTick ? rowForPlayerAtTick(ticks, sampleTick, player) : null;
    const startMoney = finiteNumber(row, ["CCSPlayerController.CCSPlayerController_InGameMoneyServices.m_iStartAccount", "m_iStartAccount"]);
    const spentMoney = finiteNumber(row, ["CCSPlayerController.CCSPlayerController_InGameMoneyServices.m_iCashSpentThisRound", "m_iCashSpentThisRound"]);
    const endMoney = finiteNumber(row, ["CCSPlayerController.CCSPlayerController_InGameMoneyServices.m_iAccount", "m_iAccount"]);
    const measured = startMoney !== null && spentMoney !== null && endMoney !== null;

    let buyType = "Veri yok";
    if (measured) {
      buyType = spentMoney <= 1000 ? "Düşük harcama" : spentMoney <= 2800 ? "Orta harcama" : "Yüksek harcama";
      startMoneyList.push(startMoney);
      spentMoneyList.push(spentMoney);
    }

    roundEconomy.push({
      round: r,
      startMoney,
      spentMoney,
      endMoney,
      buyType,
      status: measured ? "measured" : "unavailable",
    });
  }

  const economyStats = {
    averageStartMoney: startMoneyList.length ? Math.round(startMoneyList.reduce((s, v) => s + v, 0) / startMoneyList.length) : null,
    totalCashSpent: spentMoneyList.length ? spentMoneyList.reduce((s, v) => s + v, 0) : null,
    roundEconomy,
    ecoRounds: roundEconomy.filter((e) => e.buyType === "Düşük harcama").length,
    forceRounds: roundEconomy.filter((e) => e.buyType === "Orta harcama").length,
    fullBuyRounds: roundEconomy.filter((e) => e.buyType === "Yüksek harcama").length,
    status: startMoneyList.length ? "measured" : "unavailable",
    sampleCount: startMoneyList.length,
    method: "round-freeze-money-v1",
    reason: startMoneyList.length ? undefined : "Round freeze ticklerinde para alanları bulunamadı.",
  };

  const utilityDamage = hurts.filter((record) => /grenade|inferno|molotov|incendiary/i.test(text(record, ["weapon", "weapon_name"])))
    .reduce((sum, record) => sum + number(record, ["dmg_health", "health_damage", "damage"], 0), 0);
  const enemyBlindSeconds = blinds.reduce((sum, record) => sum + number(record, ["blind_duration", "duration"], 0), 0);

  const deathDetails = deaths.map((record) => {
    const tick = number(record, ["tick"]);
    const tickRow = rowForPlayerAtTick(ticks, tick, player);
    const zoneRaw = role(record, "user", "last_place_name") ?? value(tickRow, ["last_place_name", "place_name"], "");
    const x = Number(role(record, "user", "X") ?? value(tickRow, ["X", "x"], 0));
    const y = Number(role(record, "user", "Y") ?? value(tickRow, ["Y", "y"], 0));
    const z = Number(role(record, "user", "Z") ?? value(tickRow, ["Z", "z"], 0));
    const rawSpeed = shotSpeed(record, tickRow);
    const speed = rawSpeed === null ? undefined : Math.round(rawSpeed * 10) / 10;
    const team = Number(role(record, "user", "team_num") ?? value(tickRow, ["team_num"], 0));
    const sameTick = ticks?.byTick ? (ticks.byTick.get(tick) || []).filter((candidate) => Number(value(candidate, ["team_num"], -1)) === team) : (Array.isArray(ticks) ? ticks.filter((candidate) => number(candidate, ["tick"]) === tick && Number(value(candidate, ["team_num"], -1)) === team) : []);
    const teammateDistances = sameTick
      .filter((candidate) => text(candidate, ["steamid", "steam_id"]) !== player.steamid && text(candidate, ["name"]) !== player.name)
      .map((candidate) => distance({ X: x, Y: y }, candidate));
    const nearestTeammate = teammateDistances.length ? Math.min(...teammateDistances) : null;
    const round = roundNumber(record);
    const recentFlash = flashes.some((flash) => roundNumber(flash) === round && number(flash, ["tick"]) <= tick && Number.isFinite(tickRate) && (tick - number(flash, ["tick"])) / tickRate <= 8);
    const killerName = playerName(record, "attacker");
    const traded = isDeathTraded(record, combatDeaths, ticks, tickRate);
    const wasBlind = blindedEvents.some((blind) => {
      const blindTick = number(blind, ["tick"]);
      const blindDuration = number(blind, ["blind_duration", "duration"], 0);
      return blindTick <= tick && Number.isFinite(tickRate) && tick - blindTick <= Math.max(tickRate, Math.round(blindDuration * tickRate));
    });
    return {
      round, tick, time: number(record, ["game_time"], 0), zone: translateZone(zoneRaw),
      x, y, z, killer: killerName || "Bilinmiyor", weapon: text(record, ["weapon", "weapon_name"]),
      nearestTeammate: nearestTeammate === null ? null : Math.round(nearestTeammate),
      usedRecentFlash: recentFlash, traded, side: teamSide(team), speed,
      openingDeath: firstDeaths.get(round) === record, wasBlind,
    };
  });

  const killDetails = kills.map((record) => {
    const tick = number(record, ["tick"]);
    const tickRow = rowForPlayerAtTick(ticks, tick, player);
    const zoneRaw = role(record, "attacker", "last_place_name") ?? value(tickRow, ["last_place_name", "place_name"], "");
    const x = Number(role(record, "attacker", "X") ?? value(tickRow, ["X", "x"], 0));
    const y = Number(role(record, "attacker", "Y") ?? value(tickRow, ["Y", "y"], 0));
    const z = Number(role(record, "attacker", "Z") ?? value(tickRow, ["Z", "z"], 0));
    const team = Number(role(record, "attacker", "team_num") ?? value(tickRow, ["team_num"], 0));
    const headshot = value(record, ["headshot"], false) === true || value(record, ["headshot"]) === 1;
    return {
      round: roundNumber(record), tick, time: number(record, ["game_time"], 0), zone: translateZone(zoneRaw),
      x, y, z, victim: playerName(record, "user") || "Bilinmiyor", weapon: text(record, ["weapon", "weapon_name"]),
      headshot, side: teamSide(team),
    };
  });

  const roundStartsList = (grouped.round_start || []).filter((r) => !isWarmup(r));
  const freezeEndsList = (grouped.round_freeze_end || []).filter((r) => !isWarmup(r));
  const roundEndsList = (grouped.round_end || []).filter((r) => !isWarmup(r));
  const allPlayerTicks = ticks?.byPlayerList
    ? ((player.steamid ? ticks.byPlayerList.get(player.steamid) : null) || (player.name ? ticks.byPlayerList.get(player.name) : null) || [])
    : (Array.isArray(ticks) ? ticks.filter((t) => (player.steamid && text(t, ["steamid", "steam_id"]) === player.steamid) || text(t, ["name", "player_name"]) === player.name) : []);
  const sideRoundCounts = { CT: 0, T: 0 };
  for (let r = 0; r < roundEndsList.length; r++) {
    const sTick = number(freezeEndsList[r] || roundStartsList[r], ["tick"], 0);
    const eTick = number(roundEndsList[r], ["tick"], 0);
    const row = allPlayerTicks.find((candidate) => {
      const candidateTick = number(candidate, ["tick"], 0);
      return candidateTick >= sTick && candidateTick <= eTick;
    });
    const side = teamSide(number(row, ["team_num"], 0));
    if (side === "CT" || side === "T") sideRoundCounts[side]++;
  }

  const sideStats = ["CT", "T"].map((side) => {
    const sideDeaths = deathDetails.filter((detail) => detail.side === side);
    const sideKills = killDetails.filter((detail) => detail.side === side);
    const sideHurts = hurts.filter((record) => teamSide(role(record, "attacker", "team_num")) === side);
    const sideShots = shots.filter((record) => teamSide(role(record, "user", "team_num") ?? role(record, "player", "team_num")) === side);
    const sideAssists = assists.filter((record) => teamSide(role(record, "assister", "team_num")) === side);
    const observedRounds = sideRoundCounts[side];
    const sideDamage = sideHurts.reduce((sum, record) => sum + number(record, ["dmg_health", "health_damage", "damage"], 0), 0);
    const sideZones = new Map();
    for (const detail of sideDeaths) sideZones.set(detail.zone, (sideZones.get(detail.zone) || 0) + 1);
    const [sideTopZone = null, sideTopZoneDeaths = 0] = [...sideZones.entries()].sort((a, b) => b[1] - a[1])[0] || [];
    const sideUntraded = sideDeaths.filter((detail) => !detail.traded).length;
    return {
      side,
      rounds: observedRounds,
      kills: sideKills.length,
      deaths: sideDeaths.length,
      assists: sideAssists.length,
      damage: sideDamage,
      adr: observedRounds ? Math.round((sideDamage / observedRounds) * 10) / 10 : null,
      shots: sideShots.length,
      ...(() => {
        const samples = sideShots.map((record) => movingShot(record, rowForPlayerAtTick(ticks, number(record, ["tick"]), player))).filter((result) => result !== null);
        return {
          movingShotPercent: samples.length ? Math.round((samples.filter(Boolean).length / samples.length) * 100) : null,
          movementSampleCount: samples.length,
        };
      })(),
      tradePercent: sideDeaths.length ? Math.round(((sideDeaths.length - sideUntraded) / sideDeaths.length) * 100) : null,
      topZone: sideTopZone,
      topZoneDeaths: sideTopZoneDeaths,
    };
  });

  const weaponNames = new Set([
    ...shots.map(eventWeapon),
    ...kills.map(eventWeapon),
    ...hurts.map(eventWeapon),
  ].filter(isGun));
  const weaponStats = [...weaponNames].map((weapon) => {
    const weaponShots = shots.filter((record) => eventWeapon(record) === weapon);
    const weaponKills = kills.filter((record) => eventWeapon(record) === weapon);
    const weaponHurts = hurts.filter((record) => eventWeapon(record) === weapon);
    const weaponDamage = weaponHurts.reduce((sum, record) => sum + number(record, ["dmg_health", "health_damage", "damage"], 0), 0);
    const weaponHeadshots = weaponKills.filter((record) => value(record, ["headshot"], false) === true || value(record, ["headshot"]) === 1).length;
    const efficiency = weaponShots.length ? Math.round((weaponDamage / weaponShots.length) * 10) / 10 : null;
    const score = efficiency;
    const status = weaponShots.length >= 40 ? "large-sample" : weaponShots.length >= 15 ? "measured" : "small-sample";
    const weaponMovementSamples = weaponShots
      .map((record) => movingShot(record, rowForPlayerAtTick(ticks, number(record, ["tick"]), player)))
      .filter((result) => result !== null);
    return {
      weapon,
      label: weaponLabel(weapon),
      category: weaponCategory(weapon),
      kills: weaponKills.length,
      damage: weaponDamage,
      shots: weaponShots.length,
      headshots: weaponHeadshots,
      headshotPercent: weaponKills.length ? Math.round((weaponHeadshots / weaponKills.length) * 100) : 0,
      movingShotPercent: weaponMovementSamples.length ? Math.round((weaponMovementSamples.filter(Boolean).length / weaponMovementSamples.length) * 100) : null,
      movementSampleCount: weaponMovementSamples.length,
      efficiency,
      score,
      status,
    };
  }).sort((a, b) => b.kills - a.kills || b.damage - a.damage || b.shots - a.shots).slice(0, 10);

  const zoneCounts = new Map();
  for (const detail of deathDetails) zoneCounts.set(detail.zone, (zoneCounts.get(detail.zone) || 0) + 1);
  const [topZone = "Bilinmeyen bölge", topZoneDeaths = 0] = [...zoneCounts.entries()].sort((a, b) => b[1] - a[1])[0] || [];
  const topZoneDetails = deathDetails.filter((detail) => detail.zone === topZone);
  const unflashedDeaths = topZoneDetails.filter((detail) => !detail.usedRecentFlash).length;
  const untradedDeaths = deathDetails.filter((detail) => !detail.traded).length;
  const killRounds = new Set(kills.map(roundNumber));
  const assistRounds = new Set(assists.map(roundNumber));
  const deathRounds = new Set(deaths.map(roundNumber));
  const tradedDeathRounds = new Set(deathDetails.filter((detail) => detail.traded).map((detail) => detail.round));
  let kastRounds = Math.max(0, rounds - deathRounds.size);
  for (const round of deathRounds) {
    if (killRounds.has(round) || assistRounds.has(round) || tradedDeathRounds.has(round)) kastRounds++;
  }
  const kastPercent = rounds ? Math.round((kastRounds / rounds) * 1000) / 10 : null;
  const survivalPercent = rounds ? Math.round(((rounds - deathRounds.size) / rounds) * 1000) / 10 : null;
  const utilityImpactRounds = new Set([
    ...hurts.filter((record) => /grenade|inferno|molotov|incendiary/i.test(text(record, ["weapon", "weapon_name"]))).map(roundNumber),
    ...blinds.filter((record) => number(record, ["blind_duration", "duration"], 0) > 0).map(roundNumber),
  ]);
  const utilityImpactRoundPercent = rounds ? Math.round((utilityImpactRounds.size / rounds) * 1000) / 10 : null;
  const impact = kastPercent;

  const recommendations = [];

  if (topZoneDeaths >= 2) recommendations.push({
    id: "position", title: `${topZone} bölgesinde tekrar eden ölüm`,
    body: `${topZoneDeaths} ölümün ${unflashedDeaths} tanesinde yakın zamanda kendi flashını kullanmadın. Aynı açıyı ikinci kez zorlamak yerine geri düşme veya takım flashı planla.`,
    confidence: Math.min(94, 60 + topZoneDeaths * 7),
  });

  if (movementProfile.byCategory.rifle?.shots >= 10 && movementProfile.byCategory.rifle.movingPercent > 0) {
    recommendations.push({
      id: "rifle_movement_observation",
      title: "Tüfek atışlarında hız sınırı gözlemi",
      body: `${movementProfile.byCategory.rifle.shots} ölçülen tüfek atışının %${movementProfile.byCategory.rifle.movingPercent}'i, o tickte silahın max_speed değerinin %34'ünü aştı veya havadayken yapıldı. Bu doğrudan oran puan değildir; aynı yöntemle sonraki maçla karşılaştır.`,
      confidence: Math.min(90, 55 + movementProfile.byCategory.rifle.shots),
    });
  }

  if (movementProfile.byCategory.sniper?.shots >= 10 && movementProfile.byCategory.sniper.movingPercent > 0) {
    recommendations.push({
      id: "sniper_movement_observation",
      title: "Sniper atışlarında hız sınırı gözlemi",
      body: `${movementProfile.byCategory.sniper.shots} ölçülen sniper atışının %${movementProfile.byCategory.sniper.movingPercent}'i, max_speed tabanlı sınırı aştı veya havadayken yapıldı. İsabet sonucu çıkarılmaz; ilgili roundları demoda izle.`,
      confidence: Math.min(90, 55 + movementProfile.byCategory.sniper.shots),
    });
  }

  if (sprayStats.status === "measured" && sprayStats.earlyAccuracy !== null && sprayStats.lateAccuracy !== null
    && sprayStats.earlyShots >= 10 && sprayStats.lateShots >= 10 && sprayStats.lateAccuracy < sprayStats.earlyAccuracy) {
    recommendations.push({
      id: "spray_control",
      title: "4+ mermi isabeti aynı maçtaki ilk üç merminin altında",
      body: `${sprayStats.earlyShots} erken mermide %${sprayStats.earlyAccuracy}, ${sprayStats.lateShots} geç mermide %${sprayStats.lateAccuracy} doğrudan isabet ölçüldü. Sabit bir profesyonel eşik kullanılmadı; farkı ilgili çatışmaların videosuyla doğrula.`,
      confidence: Math.min(90, 55 + Math.min(sprayStats.earlyShots, sprayStats.lateShots)),
    });
  }

  if (sprayStats.hitboxSampleCount >= 10 && sprayStats.hitboxCounts.legs > sprayStats.hitboxCounts.head) {
    recommendations.push({
      id: "leg_hit_observation",
      title: "Bacak isabetleri kafa isabetlerinden fazla",
      body: `${sprayStats.hitboxSampleCount} hitgroup örneğinde ${sprayStats.hitboxCounts.legs} bacak ve ${sprayStats.hitboxCounts.head} kafa isabeti ölçüldü. Nişangah yüksekliğini ilgili çatışmaların videosunda kontrol et.`,
      confidence: Math.min(88, 55 + sprayStats.hitboxSampleCount),
    });
  }

  // 6. Round Bazlı Hareket Rotaları ve Win/Loss Eşleşmesi (Round Movement Paths & Tactical Routes)
  const roundPaths = [];
  for (let r = 0; r < roundEndsList.length; r++) {
    const sTick = number(freezeEndsList[r] || roundStartsList[r], ["tick"], 0);
    const eTick = number(roundEndsList[r], ["tick"], 0);
    if (!sTick || !eTick || sTick >= eTick) continue;

    const winnerVal = value(roundEndsList[r], ["winner", "winner_team"], "");
    const isWinnerCT = String(winnerVal) === "3" || String(winnerVal).toUpperCase() === "CT";
    const isWinnerT = String(winnerVal) === "2" || String(winnerVal).toUpperCase() === "T";
    if (!isWinnerCT && !isWinnerT) continue;
    const winReason = text(roundEndsList[r], ["reason", "legacy_reason", "message"]) || "elimination";

    // Player ticks in this round from cached player ticks
    const playerTicksInRound = allPlayerTicks.filter((t) => {
      const tickNum = number(t, ["tick"], 0);
      return tickNum >= sTick && tickNum <= eTick && number(t, ["health"], 100) > 0;
    });

    if (!playerTicksInRound.length) continue;

    const firstTickRow = playerTicksInRound[0];
    const playerTeamNum = number(firstTickRow, ["team_num"], 0);
    const side = teamSide(playerTeamNum);
    const won = (side === "CT" && isWinnerCT) || (side === "T" && isWinnerT);

    const points = playerTicksInRound.map((pt) => ({
      x: number(pt, ["X", "x"], 0),
      y: number(pt, ["Y", "y"], 0),
      z: number(pt, ["Z", "z"], 0),
      zone: translateZone(value(pt, ["last_place_name", "place_name"], "")),
      tick: number(pt, ["tick"], 0),
    }));

    // Filter meaningful route zones in chronological order (collapse duplicates)
    const zonesVisited = [];
    let lastZ = "";
    for (const pt of points) {
      if (pt.zone && pt.zone !== "Bilinmeyen bölge" && pt.zone !== lastZ) {
        zonesVisited.push(pt.zone);
        lastZ = pt.zone;
      }
    }

    const startZone = zonesVisited[0] || (side === "CT" ? "CT Spawn" : "T Spawn");
    const endZone = zonesVisited[zonesVisited.length - 1] || startZone;
    const tacticalZones = zonesVisited.filter((z) => !/spawn/i.test(z));
    const primaryZone = tacticalZones[tacticalZones.length - 1] || tacticalZones[0] || endZone;
    const routeSummary = zonesVisited.length ? zonesVisited.slice(0, 5).join(" → ") : `${startZone} Sabit`;

    roundPaths.push({
      round: r + 1,
      side,
      won,
      winnerSide: isWinnerCT ? "CT" : "T",
      winReason,
      durationSeconds: Number.isFinite(tickRate) && tickRate > 0 ? Math.max(1, Math.round((eTick - sTick) / tickRate)) : 0,
      startZone,
      endZone,
      primaryZone,
      routeSummary,
      points,
    });
  }

  // Aggregate Route / Tactical Area Winrate Stats
  const routeGroups = new Map();
  for (const p of roundPaths) {
    const key = `${p.side}__${p.primaryZone}`;
    if (!routeGroups.has(key)) {
      routeGroups.set(key, {
        side: p.side,
        zone: p.primaryZone,
        totalRounds: 0,
        wins: 0,
        losses: 0,
        xCoords: [],
        yCoords: [],
      });
    }
    const group = routeGroups.get(key);
    group.totalRounds++;
    if (p.won) group.wins++;
    else group.losses++;
    for (const pt of p.points) {
      if (pt.zone === p.primaryZone && pt.x !== 0 && pt.y !== 0) {
        group.xCoords.push(pt.x);
        group.yCoords.push(pt.y);
      }
    }
  }

  const routeStats = Array.from(routeGroups.values()).map((g) => {
    const winrate = g.totalRounds ? Math.round((g.wins / g.totalRounds) * 100) : 0;
    const avgX = g.xCoords.length ? Math.round(g.xCoords.reduce((a, b) => a + b, 0) / g.xCoords.length) : 0;
    const avgY = g.yCoords.length ? Math.round(g.yCoords.reduce((a, b) => a + b, 0) / g.yCoords.length) : 0;
    const zoneDeaths = deathDetails.filter((d) => d.side === g.side && d.zone === g.zone).length;
    const zoneKills = killDetails.filter((k) => k.side === g.side && k.zone === g.zone).length;
    return {
      side: g.side,
      zone: g.zone,
      totalRounds: g.totalRounds,
      wins: g.wins,
      losses: g.losses,
      winrate,
      kills: zoneKills,
      deaths: zoneDeaths,
      avgX,
      avgY,
      isBestRoute: false,
    };
  }).sort((a, b) => b.totalRounds - a.totalRounds || b.winrate - a.winrate);

  // Mark best route per side and overall
  for (const s of ["CT", "T"]) {
    const sideRoutes = routeStats.filter((r) => r.side === s);
    const qualifying = sideRoutes.filter((r) => r.totalRounds >= 2 && r.winrate >= 50);
    const best = qualifying.sort((a, b) => b.winrate - a.winrate || b.totalRounds - a.totalRounds)[0] || sideRoutes.sort((a, b) => b.winrate - a.winrate)[0];
    if (best && best.winrate >= 50) {
      best.isBestRoute = true;
    }
  }

  if (!recommendations.length) recommendations.push({
    id: "stable", title: "Belirgin tekrar eden hata bulunmadı",
    body: "Bu maçta tek bir güçlü hata kümesi oluşmadı. Daha güvenilir tavsiye için aynı haritada en az üç demo analiz et.", confidence: 55,
  });

  return {
    analysisVersion: ANALYSIS_VERSION,
    player, map: text(header, ["map_name", "map"]), rounds, kills: kills.length, deaths: deaths.length,
    assists: assists.length, adr: rounds ? Math.round((damage / rounds) * 10) / 10 : 0,
    headshotPercent: kills.length ? Math.round((headshots / kills.length) * 100) : 0,
    openingKills, openingDeaths, utilityDamage, enemyBlindSeconds: Math.round(enemyBlindSeconds * 10) / 10,
    flashesThrown: flashes.length, shots: shots.length,
    movingShotPercent: movementProfile.sampleCount ? Math.round((movingShots / movementProfile.sampleCount) * 100) : null,
    tradePercent: deaths.length ? Math.round(((deaths.length - untradedDeaths) / deaths.length) * 100) : null,
    topZone, topZoneDeaths, unflashedDeaths, untradedDeaths, impact,
    kastPercent, survivalPercent, utilityImpactRoundPercent, utilityImpactRoundSampleCount: rounds,
    deathDetails, killDetails, sideStats, weaponStats, movementProfile,
    sprayStats, crosshairStats, duelStats, economyStats, roundPaths, routeStats, recommendations,
  };
}

export function quickDemoMeta(pathOrBuffer) {
  try {
    const header = parseHeader(pathOrBuffer) || {};
    let map = header.map_name || "";
    if (map) map = map.replace(/^.*\//, "").replace(/\.vpk$/, "");

    let ctScore = 0;
    let tScore = 0;
    let totalRounds = 0;
    try {
      const roundEnds = parseEvents(pathOrBuffer, ["round_end"]);
      if (Array.isArray(roundEnds) && roundEnds.length) {
        for (const ev of roundEnds) {
          const w = String(ev.winner || "").trim().toUpperCase();
          if (w === "CT" || w === "3") ctScore++;
          else if (w === "T" || w === "2") tScore++;
        }
        totalRounds = ctScore + tScore;
        if (totalRounds === 0) totalRounds = roundEnds.length;
      }
    } catch {
      // ignore
    }

    const scoreFormatted = (ctScore > 0 || tScore > 0) ? `${ctScore} - ${tScore}` : (totalRounds > 0 ? `${totalRounds} Round` : "—");

    return {
      map: map || "",
      ctScore,
      tScore,
      score: scoreFormatted,
      totalRounds,
      serverName: header.server_name || "",
      durationSeconds: Math.round(Number(header.playback_time) || 0),
    };
  } catch {
    // Hata durumunda yanıltıcı varsayılan (de_dust2) DÖNDÜRME: boş map, istemcinin
    // dosya adından tahmine düşmesini veya "bilinmiyor" göstermesini sağlar.
    return {
      map: "",
      ctScore: 0,
      tScore: 0,
      score: "—",
      totalRounds: 0,
      serverName: "",
      durationSeconds: 0,
    };
  }
}

export function analyzeDemo(pathOrBuffer) {
  const header = parseHeader(pathOrBuffer);
  const eventRows = parseEvents(pathOrBuffer, CORE_EVENTS, PLAYER_PROPS, OTHER_PROPS);
  const grouped = groupEvents(eventRows);
  const players = collectPlayers(eventRows);
  const eventTickRate = estimateDemoTickRate(eventRows);
  const playbackTicks = finiteNumber(header, ["playback_ticks", "ticks"]);
  const playbackTime = finiteNumber(header, ["playback_time", "duration"]);
  const headerTickRate = playbackTicks !== null && playbackTime !== null && playbackTime > 0 ? playbackTicks / playbackTime : null;
  const tickRate = eventTickRate || (headerTickRate && headerTickRate >= 16 && headerTickRate <= 256 ? Math.round(headerTickRate * 1000) / 1000 : null);

  const roundStarts = (grouped.round_start || []).filter((r) => !isWarmup(r));
  const freezeEnds = (grouped.round_freeze_end || []).filter((r) => !isWarmup(r));
  const roundEnds = (grouped.round_end || []).filter((r) => !isWarmup(r));

  // Sample movement trajectory ticks across all rounds (every 64 ticks ~1 second)
  const roundPathTicks = [];
  for (let r = 0; r < roundEnds.length; r++) {
    const sTick = number(freezeEnds[r] || roundStarts[r], ["tick"], 0);
    const eTick = number(roundEnds[r], ["tick"], 0);
    if (sTick > 0 && eTick > sTick) {
      const pathStep = Number.isFinite(tickRate) && tickRate > 0 ? Math.max(1, Math.round(tickRate)) : 64;
      for (let t = sTick; t <= eTick; t += pathStep) {
        roundPathTicks.push(t);
      }
    }
  }

  const importantTickSet = new Set([
    ...grouped.player_death.map((record) => number(record, ["tick"])),
    ...grouped.weapon_fire.map((record) => number(record, ["tick"])),
    ...roundPathTicks,
  ].filter(Boolean));

  // Yalnız savaş olaylarının iki saniyelik çevresini parse et. Tüm demoyu her tick
  // okumadan hassas görünürlük başlangıcı elde edilir; pencere demo tick hızına uyar.
  const combatEvents = [
    ...grouped.player_hurt.filter((record) => !isWarmup(record) && isGun(eventWeapon(record))),
    ...grouped.player_death.filter((record) => !isWarmup(record) && isGun(eventWeapon(record))),
  ];
  const combatTickSet = new Set();
  const combatWindowTicks = Number.isFinite(tickRate) && tickRate > 0 ? Math.ceil(tickRate * (CONTACT_WINDOW_MS / 1000)) : 0;
  for (const record of combatEvents) {
    const endTick = number(record, ["tick"], 0);
    if (!endTick) continue;
    if (combatWindowTicks > 0) {
      for (let tick = Math.max(0, endTick - combatWindowTicks); tick <= endTick; tick++) combatTickSet.add(tick);
    }
  }
  const importantTicks = [...importantTickSet].sort((a, b) => a - b);
  const combatTicks = [...combatTickSet].sort((a, b) => a - b);

  const detailTickRows = importantTicks.length
    ? parseTicks(pathOrBuffer, [
        "X", "Y", "Z", "pitch", "yaw", "velocity_X", "velocity_Y", "team_num", "last_place_name",
        "health", "game_time", "max_speed", "duck_amount", "is_airborne", "round_start_equip_value",
        "CCSPlayerPawn.m_iShotsFired",
        "CCSPlayerController.CCSPlayerController_InGameMoneyServices.m_iAccount",
        "CCSPlayerController.CCSPlayerController_InGameMoneyServices.m_iCashSpentThisRound",
        "CCSPlayerController.CCSPlayerController_InGameMoneyServices.m_iStartAccount",
      ], importantTicks)
    : [];
  const combatTickRows = combatTicks.length
    ? parseTicks(pathOrBuffer, ["game_time", "team_num", "health", "approximate_spotted_by"], combatTicks)
    : [];
  const tickIndex = buildTickIndex(mergeTickRows(detailTickRows, combatTickRows));
  const reports = players.map((player) => buildPlayerReport(player, grouped, tickIndex, header, tickRate));
  return { header, players, reports, parserVersion: "0.42.0", analysisVersion: ANALYSIS_VERSION, tickRate };
}
