/* global wasm_bindgen, importScripts, postMessage */
importScripts("/vendor/demoparser2.js");

const CORE_EVENTS = [
  "round_start",
  "round_end",
  "player_death",
  "player_hurt",
  "weapon_fire",
  "player_blind",
  "flashbang_detonate",
  "smokegrenade_detonate",
  "hegrenade_detonate",
  "molotov_detonate",
  "inferno_startburn",
  "bomb_planted",
  "bomb_defused",
];

const PLAYER_PROPS = [
  "X", "Y", "Z", "velocity_X", "velocity_Y", "team_num",
  "last_place_name", "active_weapon", "health", "armor_value", "inventory",
];

const OTHER_PROPS = ["total_rounds_played", "game_time", "is_warmup_period"];

const ready = wasm_bindgen("/vendor/demoparser2_bg.wasm");

function rows(value) {
  if (!value) return [];
  if (typeof value === "string") {
    try { return rows(JSON.parse(value)); } catch { return []; }
  }
  if (Array.isArray(value)) return value;
  if (Array.isArray(value.rows)) return value.rows;
  const keys = Object.keys(value);
  if (keys.length && keys.every((key) => Array.isArray(value[key]))) {
    const length = Math.max(...keys.map((key) => value[key].length));
    return Array.from({ length }, (_, index) => Object.fromEntries(keys.map((key) => [key, value[key][index]])));
  }
  return [];
}

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
  const map = {
    shortstairs: "A Short", catwalk: "A Short", short: "A Short",
    longdoors: "Long Doors", long: "A Long", pit: "Pit",
    bombsitea: "A Site", bombsiteb: "B Site", aramp: "A Ramp",
    tunnels: "Tüneller", uppertunnel: "Upper Tunnels", lowertunnel: "Lower Tunnels",
    middledoors: "Mid Doors", mid: "Mid", ctspawn: "CT Spawn", tspawn: "T Spawn",
  };
  const key = normalizedKey(zone);
  return map[key] || String(zone).replace(/([a-z])([A-Z])/g, "$1 $2");
}

function distance(a, b) {
  return Math.hypot(number(a, ["X", "x"])-number(b, ["X", "x"]), number(a, ["Y", "y"])-number(b, ["Y", "y"]));
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
  return Boolean((player.steamid && id === player.steamid) || (!id && name === player.name) || name === player.name);
}

function rowForPlayerAtTick(ticks, tick, player) {
  return ticks.find((record) => number(record, ["tick"]) === tick && (
    text(record, ["steamid", "steam_id"]) === player.steamid || text(record, ["name", "player_name"]) === player.name
  ));
}

function buildPlayerReport(player, grouped, ticks, header) {
  const deathsAll = grouped.player_death.filter((record) => !isWarmup(record));
  const deaths = deathsAll.filter((record) => matchesPlayer(record, "user", player));
  const kills = deathsAll.filter((record) => matchesPlayer(record, "attacker", player) && !matchesPlayer(record, "user", player));
  const assists = deathsAll.filter((record) => matchesPlayer(record, "assister", player));
  const hurts = grouped.player_hurt.filter((record) => matchesPlayer(record, "attacker", player) && !matchesPlayer(record, "user", player));
  const shots = grouped.weapon_fire.filter((record) => matchesPlayer(record, "user", player) || matchesPlayer(record, "player", player));
  const blinds = grouped.player_blind.filter((record) => matchesPlayer(record, "attacker", player));
  const flashes = grouped.flashbang_detonate.filter((record) => matchesPlayer(record, "user", player) || matchesPlayer(record, "player", player));
  const roundEnds = grouped.round_end.filter((record) => !isWarmup(record));
  const rounds = Math.max(roundEnds.length, ...deathsAll.map(roundNumber), 1);
  const damage = hurts.reduce((sum, record) => sum + number(record, ["dmg_health", "health_damage", "damage"], 0), 0);
  const headshots = kills.filter((record) => value(record, ["headshot"], false) === true || value(record, ["headshot"]) === 1).length;

  const firstDeaths = new Map();
  for (const record of [...deathsAll].sort((a, b) => number(a, ["tick"])-number(b, ["tick"]))) {
    const round = roundNumber(record);
    if (!firstDeaths.has(round)) firstDeaths.set(round, record);
  }
  const openingKills = Array.from(firstDeaths.values()).filter((record) => matchesPlayer(record, "attacker", player)).length;
  const openingDeaths = Array.from(firstDeaths.values()).filter((record) => matchesPlayer(record, "user", player)).length;

  const movingShots = shots.filter((record) => {
    const vx = Number(role(record, "user", "velocity_X") ?? role(record, "player", "velocity_X") ?? 0);
    const vy = Number(role(record, "user", "velocity_Y") ?? role(record, "player", "velocity_Y") ?? 0);
    return Math.hypot(vx, vy) > 50;
  }).length;

  const utilityDamage = hurts.filter((record) => /grenade|inferno|molotov|incendiary/i.test(text(record, ["weapon", "weapon_name"])))
    .reduce((sum, record) => sum + number(record, ["dmg_health", "health_damage", "damage"], 0), 0);
  const enemyBlindSeconds = blinds.reduce((sum, record) => sum + number(record, ["blind_duration", "duration"], 0), 0);

  const deathDetails = deaths.map((record) => {
    const tick = number(record, ["tick"]);
    const tickRow = rowForPlayerAtTick(ticks, tick, player);
    const zoneRaw = role(record, "user", "last_place_name") ?? value(tickRow, ["last_place_name", "place_name"], "");
    const x = Number(role(record, "user", "X") ?? value(tickRow, ["X", "x"], 0));
    const y = Number(role(record, "user", "Y") ?? value(tickRow, ["Y", "y"], 0));
    const team = Number(role(record, "user", "team_num") ?? value(tickRow, ["team_num"], 0));
    const sameTick = ticks.filter((candidate) => number(candidate, ["tick"]) === tick && Number(value(candidate, ["team_num"], -1)) === team);
    const teammateDistances = sameTick.filter((candidate) => text(candidate, ["steamid", "steam_id"]) !== player.steamid && text(candidate, ["name"]) !== player.name).map((candidate) => distance({ X:x, Y:y }, candidate));
    const nearestTeammate = teammateDistances.length ? Math.min(...teammateDistances) : null;
    const round = roundNumber(record);
    const recentFlash = flashes.some((flash) => roundNumber(flash) === round && number(flash, ["tick"]) <= tick && tick-number(flash, ["tick"]) <= 512);
    const killerName = playerName(record, "attacker");
    const traded = deathsAll.some((later) => number(later, ["tick"]) > tick && number(later, ["tick"])-tick <= 320 && playerName(later, "user") === killerName && !matchesPlayer(later, "attacker", player));
    return {
      round,
      tick,
      time: number(record, ["game_time"], 0),
      zone: translateZone(zoneRaw),
      x,
      y,
      killer: killerName || "Bilinmiyor",
      weapon: text(record, ["weapon", "weapon_name"]),
      nearestTeammate: nearestTeammate === null ? null : Math.round(nearestTeammate),
      usedRecentFlash: recentFlash,
      traded,
    };
  });

  const zoneCounts = new Map();
  for (const detail of deathDetails) zoneCounts.set(detail.zone, (zoneCounts.get(detail.zone) || 0) + 1);
  const [topZone = "Bilinmeyen bölge", topZoneDeaths = 0] = [...zoneCounts.entries()].sort((a, b) => b[1]-a[1])[0] || [];
  const topZoneDetails = deathDetails.filter((detail) => detail.zone === topZone);
  const unflashedDeaths = topZoneDetails.filter((detail) => !detail.usedRecentFlash).length;
  const untradedDeaths = deathDetails.filter((detail) => !detail.traded).length;

  const impact = Math.max(0, Math.min(100, Math.round(50 + (kills-deaths.length)*2.2 + (damage/round-70)*.35 + assists.length*1.2)));
  const recommendations = [];
  if (topZoneDeaths >= 2) recommendations.push({
    id: "position",
    title: `${topZone} bölgesinde tekrar eden ölüm`,
    body: `${topZoneDeaths} ölümün ${unflashedDeaths} tanesinde yakın zamanda kendi flashını kullanmadın. Aynı açıyı ikinci kez zorlamak yerine geri düşme veya takım flashı planla.`,
    confidence: Math.min(94, 60 + topZoneDeaths * 7),
  });
  if (shots.length >= 8 && movingShots/shots.length > .18) recommendations.push({
    id: "movement",
    title: "İlk mermi öncesi tam duruş eksik",
    body: `Atışlarının yaklaşık %${Math.round(movingShots/shots.length*100)} kadarında hızın 50 u/s üzerindeydi. Counter-strafe zamanlamasını kısa burstlerle çalış.`,
    confidence: 84,
  });
  if (deaths.length >= 3 && untradedDeaths/deaths.length > .45) recommendations.push({
    id: "trade",
    title: "Ölümlerin takım tarafından çevrilemiyor",
    body: `${untradedDeaths}/${deaths.length} ölüm beş saniye içinde trade edilmedi. Temastan önce en yakın takım arkadaşının mesafesini ve görüş hattını kontrol et.`,
    confidence: 78,
  });
  if (!recommendations.length) recommendations.push({
    id: "stable",
    title: "Belirgin tekrar eden hata bulunmadı",
    body: "Bu maçta tek bir güçlü hata kümesi oluşmadı. Daha güvenilir tavsiye için aynı haritada en az üç demo analiz et.",
    confidence: 55,
  });

  return {
    player,
    map: text(header, ["map_name", "map"]),
    rounds,
    kills: kills.length,
    deaths: deaths.length,
    assists: assists.length,
    adr: Math.round(damage/rounds*10)/10,
    headshotPercent: kills.length ? Math.round(headshots/kills.length*100) : 0,
    openingKills,
    openingDeaths,
    utilityDamage,
    enemyBlindSeconds: Math.round(enemyBlindSeconds*10)/10,
    flashesThrown: flashes.length,
    shots: shots.length,
    movingShotPercent: shots.length ? Math.round(movingShots/shots.length*100) : 0,
    tradePercent: deaths.length ? Math.round((deaths.length-untradedDeaths)/deaths.length*100) : 0,
    topZone,
    topZoneDeaths,
    unflashedDeaths,
    untradedDeaths,
    impact,
    deathDetails,
    recommendations,
  };
}

self.onmessage = async (message) => {
  try {
    await ready;
    const bytes = new Uint8Array(message.data.fileBytes);
    postMessage({ type: "progress", stage: "header", progress: 12, label: "Demo başlığı okunuyor" });
    const header = wasm_bindgen.parseHeader(bytes);
    postMessage({ type: "progress", stage: "events", progress: 28, label: "Round ve çatışmalar çıkarılıyor" });
    const eventRows = rows(wasm_bindgen.parseEvents(bytes, CORE_EVENTS, PLAYER_PROPS, OTHER_PROPS));
    const grouped = groupEvents(eventRows);
    const players = collectPlayers(eventRows);
    const importantTicks = [...new Set(eventRows.filter((record) => ["player_death", "weapon_fire"].includes(eventName(record))).map((record) => number(record, ["tick"])).filter(Boolean))].sort((a,b)=>a-b);
    postMessage({ type: "progress", stage: "positions", progress: 62, label: "Harita konumları eşleştiriliyor" });
    let tickRows = [];
    if (importantTicks.length) {
      try {
        tickRows = rows(wasm_bindgen.parseTicks(bytes, ["X", "Y", "Z", "team_num", "last_place_name", "velocity_X", "velocity_Y", "active_weapon", "inventory"], new Int32Array(importantTicks), false));
      } catch (error) {
        postMessage({ type: "warning", label: `Konum örnekleri sınırlı: ${error instanceof Error ? error.message : String(error)}` });
      }
    }
    postMessage({ type: "progress", stage: "metrics", progress: 86, label: "Kişisel metrikler hesaplanıyor" });
    const reports = players.map((player) => buildPlayerReport(player, grouped, tickRows, header));
    postMessage({ type: "done", progress: 100, header, players, reports });
  } catch (error) {
    postMessage({ type: "error", message: error instanceof Error ? error.message : String(error) });
  }
};
