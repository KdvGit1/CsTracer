import { parseEvents, parseHeader, parseTicks } from "@laihoe/demoparser2";

const CORE_EVENTS = [
  "round_start", "round_end", "player_death", "player_hurt", "weapon_fire",
  "player_blind", "flashbang_detonate", "smokegrenade_detonate",
  "hegrenade_detonate", "molotov_detonate", "inferno_startburn",
  "bomb_planted", "bomb_defused",
];

const PLAYER_PROPS = [
  "X", "Y", "Z", "velocity_X", "velocity_Y", "team_num",
  "last_place_name", "active_weapon", "health", "armor_value", "inventory",
];

const OTHER_PROPS = ["total_rounds_played", "game_time", "is_warmup_period"];

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

function rowForPlayerAtTick(ticks, tick, player) {
  return ticks.find((record) => number(record, ["tick"]) === tick && (
    text(record, ["steamid", "steam_id"]) === player.steamid ||
    text(record, ["name", "player_name"]) === player.name
  ));
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

function shotSpeed(record, tickRow) {
  const vx = Number(role(record, "user", "velocity_X") ?? role(record, "player", "velocity_X") ?? value(tickRow, ["velocity_X"], 0));
  const vy = Number(role(record, "user", "velocity_Y") ?? role(record, "player", "velocity_Y") ?? value(tickRow, ["velocity_Y"], 0));
  return Math.hypot(vx, vy);
}

function movingShot(record, tickRow) {
  return shotSpeed(record, tickRow) > 50;
}

function buildMovementProfile(speeds) {
  const sorted = [...speeds].sort((a, b) => a - b);
  const total = sorted.length;
  const count = (minimum, maximum = Infinity) => sorted.filter((speed) => speed > minimum && speed <= maximum).length;
  const stableShots = sorted.filter((speed) => speed <= 15).length;
  const microMoveShots = count(15, 50);
  const movingShots = count(50, 120);
  const fastMoveShots = count(120);
  const percent = (amount) => total ? Math.round(amount / total * 100) : 0;
  const severityScore = total ? Math.round((microMoveShots * .15 + movingShots * .6 + fastMoveShots) / total * 100) : 0;
  const severity = severityScore >= 35 || percent(fastMoveShots) >= 18 ? "severe"
    : severityScore >= 20 || percent(fastMoveShots) >= 8 ? "moderate"
      : severityScore >= 8 ? "minor" : "clean";
  return {
    averageSpeed: total ? Math.round(sorted.reduce((sum, speed) => sum + speed, 0) / total * 10) / 10 : 0,
    p90Speed: total ? Math.round(sorted[Math.min(total - 1, Math.floor(total * .9))] * 10) / 10 : 0,
    stableShots, microMoveShots, movingShots, fastMoveShots,
    stablePercent: percent(stableShots), microPercent: percent(microMoveShots),
    movingPercent: percent(movingShots), fastPercent: percent(fastMoveShots),
    severityScore, severity,
  };
}

function buildPlayerReport(player, grouped, ticks, header) {
  const deathsAll = grouped.player_death.filter((record) => !isWarmup(record));
  const deaths = deathsAll.filter((record) => matchesPlayer(record, "user", player));
  const kills = deathsAll.filter((record) => matchesPlayer(record, "attacker", player) && !matchesPlayer(record, "user", player));
  const assists = deathsAll.filter((record) => matchesPlayer(record, "assister", player));
  const hurts = grouped.player_hurt.filter((record) => matchesPlayer(record, "attacker", player) && !matchesPlayer(record, "user", player));
  const shots = grouped.weapon_fire.filter((record) => matchesPlayer(record, "user", player) || matchesPlayer(record, "player", player));
  const blinds = grouped.player_blind.filter((record) => matchesPlayer(record, "attacker", player));
  const blindedEvents = grouped.player_blind.filter((record) => matchesPlayer(record, "user", player));
  const flashes = grouped.flashbang_detonate.filter((record) => matchesPlayer(record, "user", player) || matchesPlayer(record, "player", player));
  const roundEnds = grouped.round_end.filter((record) => !isWarmup(record));
  const rounds = Math.max(roundEnds.length, ...deathsAll.map(roundNumber), 1);
  const damage = hurts.reduce((sum, record) => sum + number(record, ["dmg_health", "health_damage", "damage"], 0), 0);
  const headshots = kills.filter((record) => value(record, ["headshot"], false) === true || value(record, ["headshot"]) === 1).length;

  const firstDeaths = new Map();
  for (const record of [...deathsAll].sort((a, b) => number(a, ["tick"]) - number(b, ["tick"]))) {
    const round = roundNumber(record);
    if (!firstDeaths.has(round)) firstDeaths.set(round, record);
  }
  const openingKills = Array.from(firstDeaths.values()).filter((record) => matchesPlayer(record, "attacker", player)).length;
  const openingDeaths = Array.from(firstDeaths.values()).filter((record) => matchesPlayer(record, "user", player)).length;
  const speedForShot = (record) => shotSpeed(record, rowForPlayerAtTick(ticks, number(record, ["tick"]), player));
  const shotSpeeds = shots.map(speedForShot);
  const movementProfile = buildMovementProfile(shotSpeeds);
  const movingShots = movementProfile.movingShots + movementProfile.fastMoveShots;
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
    const speed = Math.round(shotSpeed(record, tickRow) * 10) / 10;
    const team = Number(role(record, "user", "team_num") ?? value(tickRow, ["team_num"], 0));
    const sameTick = ticks.filter((candidate) => number(candidate, ["tick"]) === tick && Number(value(candidate, ["team_num"], -1)) === team);
    const teammateDistances = sameTick
      .filter((candidate) => text(candidate, ["steamid", "steam_id"]) !== player.steamid && text(candidate, ["name"]) !== player.name)
      .map((candidate) => distance({ X: x, Y: y }, candidate));
    const nearestTeammate = teammateDistances.length ? Math.min(...teammateDistances) : null;
    const round = roundNumber(record);
    const recentFlash = flashes.some((flash) => roundNumber(flash) === round && number(flash, ["tick"]) <= tick && tick - number(flash, ["tick"]) <= 512);
    const killerName = playerName(record, "attacker");
    const traded = deathsAll.some((later) => number(later, ["tick"]) > tick && number(later, ["tick"]) - tick <= 320 && playerName(later, "user") === killerName && !matchesPlayer(later, "attacker", player));
    const wasBlind = blindedEvents.some((blind) => {
      const blindTick = number(blind, ["tick"]);
      const blindDuration = number(blind, ["blind_duration", "duration"], 0);
      return blindTick <= tick && tick - blindTick <= Math.max(64, Math.round(blindDuration * 64));
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

  const sideStats = ["CT", "T"].map((side) => {
    const sideDeaths = deathDetails.filter((detail) => detail.side === side);
    const sideKills = killDetails.filter((detail) => detail.side === side);
    const sideHurts = hurts.filter((record) => teamSide(role(record, "attacker", "team_num")) === side);
    const sideShots = shots.filter((record) => teamSide(role(record, "user", "team_num") ?? role(record, "player", "team_num")) === side);
    const sideAssists = assists.filter((record) => teamSide(role(record, "assister", "team_num")) === side);
    const observedRounds = new Set([
      ...sideDeaths.map((detail) => detail.round),
      ...sideKills.map((detail) => detail.round),
      ...sideHurts.map(roundNumber),
      ...sideShots.map(roundNumber),
    ].filter((round) => round >= 0));
    const sideDamage = sideHurts.reduce((sum, record) => sum + number(record, ["dmg_health", "health_damage", "damage"], 0), 0);
    const sideZones = new Map();
    for (const detail of sideDeaths) sideZones.set(detail.zone, (sideZones.get(detail.zone) || 0) + 1);
    const [sideTopZone = "Veri yok", sideTopZoneDeaths = 0] = [...sideZones.entries()].sort((a, b) => b[1] - a[1])[0] || [];
    const sideUntraded = sideDeaths.filter((detail) => !detail.traded).length;
    return {
      side,
      rounds: observedRounds.size,
      kills: sideKills.length,
      deaths: sideDeaths.length,
      assists: sideAssists.length,
      damage: sideDamage,
      adr: observedRounds.size ? Math.round(sideDamage / observedRounds.size * 10) / 10 : 0,
      shots: sideShots.length,
      movingShotPercent: sideShots.length ? Math.round(sideShots.filter((record) => movingShot(record, rowForPlayerAtTick(ticks, number(record, ["tick"]), player))).length / sideShots.length * 100) : 0,
      tradePercent: sideDeaths.length ? Math.round((sideDeaths.length - sideUntraded) / sideDeaths.length * 100) : 0,
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
    const efficiency = weaponShots.length ? Math.round(weaponKills.length / weaponShots.length * 1000) / 10 : 0;
    const score = Math.min(100, Math.round(weaponKills.length * 9 + weaponDamage / 22 + Math.min(25, weaponShots.length / 3)));
    const status = weaponKills.length >= 5 && weaponShots.length >= 35 ? "signature" : weaponKills.length >= 3 ? "strong" : weaponShots.length >= 18 ? "developing" : "sample";
    return {
      weapon,
      label: weaponLabel(weapon),
      kills: weaponKills.length,
      damage: weaponDamage,
      shots: weaponShots.length,
      headshots: weaponHeadshots,
      headshotPercent: weaponKills.length ? Math.round(weaponHeadshots / weaponKills.length * 100) : 0,
      movingShotPercent: weaponShots.length ? Math.round(weaponShots.filter((record) => movingShot(record, rowForPlayerAtTick(ticks, number(record, ["tick"]), player))).length / weaponShots.length * 100) : 0,
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
  const impact = Math.max(0, Math.min(100, Math.round(50 + (kills.length - deaths.length) * 2.2 + (damage / rounds - 70) * .35 + assists.length * 1.2)));
  const recommendations = [];

  if (topZoneDeaths >= 2) recommendations.push({
    id: "position", title: `${topZone} bölgesinde tekrar eden ölüm`,
    body: `${topZoneDeaths} ölümün ${unflashedDeaths} tanesinde yakın zamanda kendi flashını kullanmadın. Aynı açıyı ikinci kez zorlamak yerine geri düşme veya takım flashı planla.`,
    confidence: Math.min(94, 60 + topZoneDeaths * 7),
  });
  if (shots.length >= 8 && movementProfile.severity !== "clean") recommendations.push({
    id: "movement", title: movementProfile.severity === "severe" ? "Yüksek hızda atış öncelikli sorun" : movementProfile.severity === "moderate" ? "Duruş zamanlaması geliştirilebilir" : "Küçük hareket sapmaları var",
    body: `Ortalama atış hızın ${movementProfile.averageSpeed} u/s, P90 hızın ${movementProfile.p90Speed} u/s. Mikro hareketler düşük ağırlıkla, 120 u/s üzeri atışlar ağır değerlendirilerek hata skoru ${movementProfile.severityScore}/100 hesaplandı.`, confidence: shots.length >= 80 ? 88 : 74,
  });
  if (deaths.length >= 3 && untradedDeaths / deaths.length > .45) recommendations.push({
    id: "trade", title: "Ölümlerin takım tarafından çevrilemiyor",
    body: `${untradedDeaths}/${deaths.length} ölüm beş saniye içinde trade edilmedi. Temastan önce en yakın takım arkadaşının mesafesini kontrol et.`, confidence: 78,
  });
  if (!recommendations.length) recommendations.push({
    id: "stable", title: "Belirgin tekrar eden hata bulunmadı",
    body: "Bu maçta tek bir güçlü hata kümesi oluşmadı. Daha güvenilir tavsiye için aynı haritada en az üç demo analiz et.", confidence: 55,
  });

  return {
    player, map: text(header, ["map_name", "map"]), rounds, kills: kills.length, deaths: deaths.length,
    assists: assists.length, adr: Math.round(damage / rounds * 10) / 10,
    headshotPercent: kills.length ? Math.round(headshots / kills.length * 100) : 0,
    openingKills, openingDeaths, utilityDamage, enemyBlindSeconds: Math.round(enemyBlindSeconds * 10) / 10,
    flashesThrown: flashes.length, shots: shots.length,
    movingShotPercent: shots.length ? Math.round(movingShots / shots.length * 100) : 0,
    tradePercent: deaths.length ? Math.round((deaths.length - untradedDeaths) / deaths.length * 100) : 0,
    topZone, topZoneDeaths, unflashedDeaths, untradedDeaths, impact,
    deathDetails, killDetails, sideStats, weaponStats, movementProfile, recommendations,
  };
}

export function analyzeDemo(pathOrBuffer) {
  const header = parseHeader(pathOrBuffer);
  const eventRows = parseEvents(pathOrBuffer, CORE_EVENTS, PLAYER_PROPS, OTHER_PROPS);
  const grouped = groupEvents(eventRows);
  const players = collectPlayers(eventRows);
  const importantTicks = [...new Set([...grouped.player_death, ...grouped.weapon_fire].map((record) => number(record, ["tick"])).filter(Boolean))].sort((a, b) => a - b);
  const tickRows = importantTicks.length
    ? parseTicks(pathOrBuffer, ["X", "Y", "Z", "velocity_X", "velocity_Y", "team_num", "last_place_name"], importantTicks)
    : [];
  const reports = players.map((player) => buildPlayerReport(player, grouped, tickRows, header));
  return { header, players, reports, parserVersion: "0.42.0" };
}
