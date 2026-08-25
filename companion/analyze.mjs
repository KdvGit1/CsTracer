import { parseEvents, parseHeader, parseTicks } from "@laihoe/demoparser2";

const CORE_EVENTS = [
  "round_start", "round_end", "round_freeze_end", "player_death", "player_hurt", "weapon_fire",
  "player_blind", "flashbang_detonate", "smokegrenade_detonate",
  "hegrenade_detonate", "molotov_detonate", "inferno_startburn",
  "bomb_planted", "bomb_defused", "player_bullet_hit", "item_pickup",
];

const PLAYER_PROPS = [
  "X", "Y", "Z", "pitch", "yaw", "velocity_X", "velocity_Y", "team_num",
  "last_place_name", "active_weapon", "health", "armor_value", "inventory",
  "CCSPlayerPawn.m_iShotsFired",
  "CCSPlayerController.CCSPlayerController_InGameMoneyServices.m_iAccount",
  "CCSPlayerController.CCSPlayerController_InGameMoneyServices.m_iCashSpentThisRound",
  "CCSPlayerController.CCSPlayerController_InGameMoneyServices.m_iStartAccount",
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
  const vx = Number(role(record, "user", "velocity_X") ?? role(record, "player", "velocity_X") ?? value(tickRow, ["velocity_X"], 0));
  const vy = Number(role(record, "user", "velocity_Y") ?? role(record, "player", "velocity_Y") ?? value(tickRow, ["velocity_Y"], 0));
  return Math.hypot(vx, vy);
}

function movingShot(record, tickRow) {
  const speed = shotSpeed(record, tickRow);
  const weapon = eventWeapon(record);
  const cat = weaponCategory(weapon);
  if (cat === "sniper") return speed > 15;
  if (cat === "rifle") return speed > 34;
  if (cat === "pistol") return speed > 75;
  if (cat === "smg") return speed > 130;
  return speed > 50;
}

function buildWeaponAwareMovementProfile(shotEntries) {
  if (!shotEntries.length) {
    return {
      averageSpeed: 0, p90Speed: 0, stableShots: 0, microMoveShots: 0, movingShots: 0, fastMoveShots: 0,
      stablePercent: 0, microPercent: 0, movingPercent: 0, fastPercent: 0, severityScore: 0, severity: "clean",
      byCategory: { sniper: { shots: 0, movingPercent: 0 }, rifle: { shots: 0, movingPercent: 0 }, pistol: { shots: 0, movingPercent: 0 }, smg: { shots: 0, movingPercent: 0 } },
    };
  }

  const speeds = shotEntries.map((e) => e.speed).sort((a, b) => a - b);
  const total = speeds.length;
  const count = (minimum, maximum = Infinity) => speeds.filter((speed) => speed > minimum && speed <= maximum).length;
  const stableShots = speeds.filter((speed) => speed <= 15).length;
  const microMoveShots = count(15, 50);
  const movingShots = count(50, 120);
  const fastMoveShots = count(120);
  const percent = (amount) => total ? Math.round((amount / total) * 100) : 0;

  let weightedPenalties = 0;
  const catStats = {
    sniper: { shots: 0, moving: 0 },
    rifle: { shots: 0, moving: 0 },
    pistol: { shots: 0, moving: 0 },
    smg: { shots: 0, moving: 0 },
    other: { shots: 0, moving: 0 },
  };

  for (const entry of shotEntries) {
    const { speed, weapon } = entry;
    const cat = weaponCategory(weapon);
    if (!catStats[cat]) catStats[cat] = { shots: 0, moving: 0 };
    catStats[cat].shots++;

    if (cat === "sniper") {
      if (speed > 15 && speed <= 50) { weightedPenalties += 0.8; catStats[cat].moving++; }
      else if (speed > 50) { weightedPenalties += 1.8; catStats[cat].moving++; }
    } else if (cat === "rifle") {
      if (speed > 34 && speed <= 70) { weightedPenalties += 0.4; catStats[cat].moving++; }
      else if (speed > 70) { weightedPenalties += 1.2; catStats[cat].moving++; }
    } else if (cat === "pistol") {
      if (speed > 80 && speed <= 150) { weightedPenalties += 0.15; catStats[cat].moving++; }
      else if (speed > 150) { weightedPenalties += 0.5; catStats[cat].moving++; }
    } else if (cat === "smg") {
      if (speed > 140) { weightedPenalties += 0.2; catStats[cat].moving++; }
    } else {
      if (speed > 50) { weightedPenalties += 0.5; catStats[cat].moving++; }
    }
  }

  const severityScore = Math.min(100, Math.round((weightedPenalties / total) * 100));
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
    severityScore, severity, byCategory,
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

  // 1. Silaha Duyarlı Hareket Analizi (Weapon-Aware Movement Profile)
  const shotEntries = shots.map((record) => {
    const tick = number(record, ["tick"]);
    const tickRow = rowForPlayerAtTick(ticks, tick, player);
    const speed = shotSpeed(record, tickRow);
    const weapon = eventWeapon(record);
    return { speed, weapon, tick };
  });
  const movementProfile = buildWeaponAwareMovementProfile(shotEntries);
  const movingShots = movementProfile.movingShots + movementProfile.fastMoveShots;

  // 2. Sprey & Hitbox Dağılımı (Hitbox & Spray Stats)
  const gunShots = shots.filter((s) => isGun(eventWeapon(s)));
  const gunHurts = hurts.filter((h) => isGun(eventWeapon(h)));
  const totalGunShots = gunShots.length;
  const totalGunHits = gunHurts.length;
  const accuracyPercent = totalGunShots ? Math.round((totalGunHits / totalGunShots) * 1000) / 10 : 0;

  const hitboxCounts = { head: 0, chest: 0, stomach: 0, arms: 0, legs: 0 };
  gunHurts.forEach((h) => {
    const hg = (text(h, ["hitgroup", "hit_group"]) || "").toLowerCase();
    if (hg === "head" || hg === "1") hitboxCounts.head++;
    else if (hg === "chest" || hg === "2") hitboxCounts.chest++;
    else if (hg === "stomach" || hg === "3") hitboxCounts.stomach++;
    else if (/arm|4|5/.test(hg)) hitboxCounts.arms++;
    else if (/leg|6|7/.test(hg)) hitboxCounts.legs++;
    else hitboxCounts.chest++;
  });

  const hitboxPercents = {
    head: totalGunHits ? Math.round((hitboxCounts.head / totalGunHits) * 100) : 0,
    chest: totalGunHits ? Math.round((hitboxCounts.chest / totalGunHits) * 100) : 0,
    stomach: totalGunHits ? Math.round((hitboxCounts.stomach / totalGunHits) * 100) : 0,
    arms: totalGunHits ? Math.round((hitboxCounts.arms / totalGunHits) * 100) : 0,
    legs: totalGunHits ? Math.round((hitboxCounts.legs / totalGunHits) * 100) : 0,
  };

  // Sprey analizi: ilk 3 mermi vs 4+ mermiler
  let earlyShots = 0;
  let earlyHits = 0;
  let lateShots = 0;
  let lateHits = 0;
  gunShots.forEach((s) => {
    const tick = number(s, ["tick"]);
    const tickRow = rowForPlayerAtTick(ticks, tick, player);
    const shotsFired = number(tickRow, ["CCSPlayerPawn.m_iShotsFired", "m_iShotsFired"], 1);
    const isHit = gunHurts.some((h) => Math.abs(number(h, ["tick"]) - tick) <= 4);
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
    earlyAccuracy: earlyShots ? Math.round((earlyHits / earlyShots) * 100) : 0,
    lateAccuracy: lateShots ? Math.round((lateHits / lateShots) * 100) : 0,
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
      const attPos = {
        x: Number(value(attackerRow, ["X", "x"], 0)),
        y: Number(value(attackerRow, ["Y", "y"], 0)),
        z: Number(value(attackerRow, ["Z", "z"], 0)) + 64,
        pitch: Number(value(attackerRow, ["pitch"], 0)),
        yaw: Number(value(attackerRow, ["yaw"], 0)),
      };
      const vicX = Number(value(victimRow, ["X", "x"], 0));
      const vicY = Number(value(victimRow, ["Y", "y"], 0));
      const vicZ = Number(value(victimRow, ["Z", "z"], 0));

      const headPos = { x: vicX, y: vicY, z: vicZ + 62 };
      const bodyPos = { x: vicX, y: vicY, z: vicZ + 40 };

      const headDev = calculateAngleDeviation(attPos, headPos);
      const bodyDev = calculateAngleDeviation(attPos, bodyPos);

      if (headDev < 45) headDeviations.push(headDev);
      if (bodyDev < 45) bodyDeviations.push(bodyDev);
    }
  });

  const avgHeadError = headDeviations.length ? Math.round((headDeviations.reduce((s, v) => s + v, 0) / headDeviations.length) * 10) / 10 : 4.8;
  const avgBodyError = bodyDeviations.length ? Math.round((bodyDeviations.reduce((s, v) => s + v, 0) / bodyDeviations.length) * 10) / 10 : 3.2;
  const preAimScore = Math.max(10, Math.min(100, Math.round(100 - avgHeadError * 9)));

  const crosshairStats = {
    headErrorAngle: avgHeadError,
    bodyErrorAngle: avgBodyError,
    preAimScore,
    headLevelRating: avgHeadError <= 3.5 ? "Mükemmel (Pro Seviye)" : avgHeadError <= 6.0 ? "İyi (Hizalı)" : "Geliştirilmeli (Aşağı/Yukarı Sapma)",
  };

  // 4. Time to Damage (TTD) ve Düello Analizi
  const ttdValues = [];
  let duelWins = 0;
  let duelTotal = 0;

  kills.forEach((k) => {
    const kTick = number(k, ["tick"]);
    const initialShot = gunShots.filter((s) => number(s, ["tick"]) <= kTick && kTick - number(s, ["tick"]) <= 128).sort((a, b) => number(b, ["tick"]) - number(a, ["tick"]))[0];
    if (initialShot) {
      const delayTicks = kTick - number(initialShot, ["tick"]);
      const delayMs = Math.round((delayTicks / 64) * 1000);
      if (delayMs >= 50 && delayMs <= 2000) ttdValues.push(delayMs);
    }
    duelWins++;
    duelTotal++;
  });

  deaths.forEach(() => {
    duelTotal++;
  });

  const avgTTD = ttdValues.length ? Math.round(ttdValues.reduce((s, v) => s + v, 0) / ttdValues.length) : 340;
  const duelWinrate = duelTotal ? Math.round((duelWins / duelTotal) * 100) : 50;

  const duelStats = {
    averageTTD: avgTTD,
    duelWinrate,
    duelWins,
    duelTotal,
    fastReactions: ttdValues.filter((t) => t <= 250).length,
    reactionRating: avgTTD <= 240 ? "Çok Hızlı (<240ms)" : avgTTD <= 360 ? "Normal (240-360ms)" : "Yavaş (>360ms)",
  };

  // 5. Ekonomi Analizi (Economy Stats)
  const roundEconomy = [];
  const startMoneyList = [];
  const spentMoneyList = [];

  for (let r = 1; r <= rounds; r++) {
    const roundDeaths = deathsAll.filter((d) => roundNumber(d) === r);
    const sampleTick = roundDeaths[0] ? number(roundDeaths[0], ["tick"]) : null;
    let startMoney = 800;
    let spentMoney = 0;
    let endMoney = 0;

    if (sampleTick) {
      const row = rowForPlayerAtTick(ticks, sampleTick, player);
      if (row) {
        startMoney = number(row, ["CCSPlayerController.CCSPlayerController_InGameMoneyServices.m_iStartAccount", "m_iStartAccount"], 800);
        spentMoney = number(row, ["CCSPlayerController.CCSPlayerController_InGameMoneyServices.m_iCashSpentThisRound", "m_iCashSpentThisRound"], 0);
        endMoney = number(row, ["CCSPlayerController.CCSPlayerController_InGameMoneyServices.m_iAccount", "m_iAccount"], Math.max(0, startMoney - spentMoney));
      }
    }

    let buyType = "Full Buy";
    if (spentMoney <= 1000 && startMoney <= 2500) buyType = "Eco";
    else if (spentMoney <= 2800) buyType = "Force Buy";

    startMoneyList.push(startMoney);
    spentMoneyList.push(spentMoney);

    // Hero Buy: takım eko/force yaparken oyuncunun tek başına büyük alım yapması.
    // Takım ortalaması demodan round bazında okunamadığı için yaklaşık tespit:
    // kasa tam alıma zor yetiyorken (≤5200) büyük harcama (≥3000) yapılması.
    // (Önceki sürümdeki `r % 3 === 0` koşulu anlamsızdı: sadece round numarasına bakıyordu.)
    const heroBuy = spentMoney >= 3000 && startMoney <= 5200 && startMoney - spentMoney < 1000;

    roundEconomy.push({
      round: r,
      startMoney,
      spentMoney,
      endMoney,
      buyType,
      heroBuy,
    });
  }

  const economyStats = {
    averageStartMoney: startMoneyList.length ? Math.round(startMoneyList.reduce((s, v) => s + v, 0) / startMoneyList.length) : 3200,
    totalCashSpent: spentMoneyList.reduce((s, v) => s + v, 0),
    roundEconomy,
    ecoRounds: roundEconomy.filter((e) => e.buyType === "Eco").length,
    forceRounds: roundEconomy.filter((e) => e.buyType === "Force Buy").length,
    fullBuyRounds: roundEconomy.filter((e) => e.buyType === "Full Buy").length,
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
    const speed = Math.round(shotSpeed(record, tickRow) * 10) / 10;
    const team = Number(role(record, "user", "team_num") ?? value(tickRow, ["team_num"], 0));
    const sameTick = ticks?.byTick ? (ticks.byTick.get(tick) || []).filter((candidate) => Number(value(candidate, ["team_num"], -1)) === team) : (Array.isArray(ticks) ? ticks.filter((candidate) => number(candidate, ["tick"]) === tick && Number(value(candidate, ["team_num"], -1)) === team) : []);
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
      adr: observedRounds.size ? Math.round((sideDamage / observedRounds.size) * 10) / 10 : 0,
      shots: sideShots.length,
      movingShotPercent: sideShots.length ? Math.round((sideShots.filter((record) => movingShot(record, rowForPlayerAtTick(ticks, number(record, ["tick"]), player))).length / sideShots.length) * 100) : 0,
      tradePercent: sideDeaths.length ? Math.round(((sideDeaths.length - sideUntraded) / sideDeaths.length) * 100) : 0,
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
    const efficiency = weaponShots.length ? Math.round((weaponKills.length / weaponShots.length) * 1000) / 10 : 0;
    const score = Math.min(100, Math.round(weaponKills.length * 9 + weaponDamage / 22 + Math.min(25, weaponShots.length / 3)));
    const status = weaponKills.length >= 5 && weaponShots.length >= 35 ? "signature" : weaponKills.length >= 3 ? "strong" : weaponShots.length >= 18 ? "developing" : "sample";
    return {
      weapon,
      label: weaponLabel(weapon),
      category: weaponCategory(weapon),
      kills: weaponKills.length,
      damage: weaponDamage,
      shots: weaponShots.length,
      headshots: weaponHeadshots,
      headshotPercent: weaponKills.length ? Math.round((weaponHeadshots / weaponKills.length) * 100) : 0,
      movingShotPercent: weaponShots.length ? Math.round((weaponShots.filter((record) => movingShot(record, rowForPlayerAtTick(ticks, number(record, ["tick"]), player))).length / weaponShots.length) * 100) : 0,
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
  const impact = Math.max(0, Math.min(100, Math.round(50 + (kills.length - deaths.length) * 2.2 + (damage / rounds - 70) * 0.35 + assists.length * 1.2)));

  const recommendations = [];

  if (topZoneDeaths >= 2) recommendations.push({
    id: "position", title: `${topZone} bölgesinde tekrar eden ölüm`,
    body: `${topZoneDeaths} ölümün ${unflashedDeaths} tanesinde yakın zamanda kendi flashını kullanmadın. Aynı açıyı ikinci kez zorlamak yerine geri düşme veya takım flashı planla.`,
    confidence: Math.min(94, 60 + topZoneDeaths * 7),
  });

  if (movementProfile.byCategory.rifle && movementProfile.byCategory.rifle.movingPercent >= 20) {
    recommendations.push({
      id: "rifle_movement",
      title: "Tüfeklerle (AK-47 / M4) hareketli atış hatası",
      body: `Tüfek atışlarının %${movementProfile.byCategory.rifle.movingPercent}'inde duruş hız sınırını aştın. Tüfekte mermi sapmasını önlemek için tam counter-strafe (karşı tuşa dokunarak durma) şarttır.`,
      confidence: 89,
    });
  }

  if (movementProfile.byCategory.sniper && movementProfile.byCategory.sniper.movingPercent >= 15) {
    recommendations.push({
      id: "sniper_movement",
      title: "AWP / Sniper ile hareket halindeyken atış",
      body: `Sniper atışlarının %${movementProfile.byCategory.sniper.movingPercent}'inde hareket halindeyken tetiğe basıldı. AWP'de en küçük hız dahi mermiyi tamamen saptırır.`,
      confidence: 92,
    });
  }

  if (crosshairStats.headErrorAngle > 4.5) {
    recommendations.push({
      id: "crosshair_placement",
      title: "Nişangah kafa hizasından sapıyor (Pre-aim)",
      body: `Temas anlarında kafa sapması ortalama ${crosshairStats.headErrorAngle}° (Gövde sapması ${crosshairStats.bodyErrorAngle}°). Pre-Aim skoru ${crosshairStats.preAimScore}/100 (${crosshairStats.headLevelRating}). Köşeleri dönerken crosshair'i yere değil, doğrudan kafa hizasına kilitle.`,
      confidence: 86,
    });
  }

  if (sprayStats.lateAccuracy < 18 && sprayStats.totalShots > 40) {
    recommendations.push({
      id: "spray_control",
      title: "4+ mermi sonrası sprey kontrolü dağılıyor",
      body: `İlk 3 mermideki isabet oranın %${sprayStats.earlyAccuracy} iken, 4. mermiden sonra bu oran %${sprayStats.lateAccuracy}'ye geriliyor. Uzun sprey yerine 2-3 mermilik burst atışları tercih et ve recoil reset süresini bekle.`,
      confidence: 84,
    });
  }

  if (duelStats.averageTTD > 360) {
    recommendations.push({
      id: "time_to_damage",
      title: "Time-to-Damage (TTD) ve reaksiyon gecikmesi",
      body: `Düşmanı gördükten sonra hasar verme süren ortalama ${duelStats.averageTTD} ms (${duelStats.reactionRating}). Reaktif aim ve crosshair sabitleme drilleriyle ilk hasar süreni hızlandır.`,
      confidence: 82,
    });
  }

  if (sprayStats.hitboxPercents.legs > 12) {
    recommendations.push({
      id: "low_crosshair",
      title: "Mermiler bacak seviyesine kayıyor",
      body: `İsabet eden mermilerin %${sprayStats.hitboxPercents.legs}'i bacaklara vurdu. Crosshair'i sürekli göğüs/kafa seviyesine kaldırarak hasar çarpanını katla.`,
      confidence: 80,
    });
  }

  // 6. Round Bazlı Hareket Rotaları ve Win/Loss Eşleşmesi (Round Movement Paths & Tactical Routes)
  const roundStartsList = (grouped.round_start || []).filter((r) => !isWarmup(r));
  const freezeEndsList = (grouped.round_freeze_end || []).filter((r) => !isWarmup(r));
  const roundEndsList = (grouped.round_end || []).filter((r) => !isWarmup(r));

  const allPlayerTicks = ticks?.byPlayerList
    ? ((player.steamid ? ticks.byPlayerList.get(player.steamid) : null) || (player.name ? ticks.byPlayerList.get(player.name) : null) || [])
    : (Array.isArray(ticks) ? ticks.filter((t) => (player.steamid && text(t, ["steamid", "steam_id"]) === player.steamid) || text(t, ["name", "player_name"]) === player.name) : []);

  const roundPaths = [];
  for (let r = 0; r < roundEndsList.length; r++) {
    const sTick = number(freezeEndsList[r] || roundStartsList[r], ["tick"], 0);
    const eTick = number(roundEndsList[r], ["tick"], 0);
    if (!sTick || !eTick || sTick >= eTick) continue;

    const winnerVal = value(roundEndsList[r], ["winner", "winner_team"], "");
    const isWinnerCT = String(winnerVal) === "3" || String(winnerVal).toUpperCase() === "CT";
    const isWinnerT = String(winnerVal) === "2" || String(winnerVal).toUpperCase() === "T";
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
      durationSeconds: Math.max(1, Math.round((eTick - sTick) / 64)),
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
    player, map: text(header, ["map_name", "map"]), rounds, kills: kills.length, deaths: deaths.length,
    assists: assists.length, adr: Math.round((damage / rounds) * 10) / 10,
    headshotPercent: kills.length ? Math.round((headshots / kills.length) * 100) : 0,
    openingKills, openingDeaths, utilityDamage, enemyBlindSeconds: Math.round(enemyBlindSeconds * 10) / 10,
    flashesThrown: flashes.length, shots: shots.length,
    movingShotPercent: shots.length ? Math.round((movingShots / shots.length) * 100) : 0,
    tradePercent: deaths.length ? Math.round(((deaths.length - untradedDeaths) / deaths.length) * 100) : 0,
    topZone, topZoneDeaths, unflashedDeaths, untradedDeaths, impact,
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
      map: map || "de_dust2",
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

  const roundStarts = (grouped.round_start || []).filter((r) => !isWarmup(r));
  const freezeEnds = (grouped.round_freeze_end || []).filter((r) => !isWarmup(r));
  const roundEnds = (grouped.round_end || []).filter((r) => !isWarmup(r));

  // Sample movement trajectory ticks across all rounds (every 64 ticks ~1 second)
  const roundPathTicks = [];
  for (let r = 0; r < roundEnds.length; r++) {
    const sTick = number(freezeEnds[r] || roundStarts[r], ["tick"], 0);
    const eTick = number(roundEnds[r], ["tick"], 0);
    if (sTick > 0 && eTick > sTick) {
      for (let t = sTick; t <= eTick; t += 64) {
        roundPathTicks.push(t);
      }
    }
  }

  const importantTicks = [...new Set([
    ...grouped.player_death.map((record) => number(record, ["tick"])),
    ...grouped.weapon_fire.map((record) => number(record, ["tick"])),
    ...roundPathTicks,
  ].filter(Boolean))].sort((a, b) => a - b);

  const tickRows = importantTicks.length
    ? parseTicks(pathOrBuffer, [
        "X", "Y", "Z", "pitch", "yaw", "velocity_X", "velocity_Y", "team_num", "last_place_name",
        "health",
        "CCSPlayerPawn.m_iShotsFired",
        "CCSPlayerController.CCSPlayerController_InGameMoneyServices.m_iAccount",
        "CCSPlayerController.CCSPlayerController_InGameMoneyServices.m_iCashSpentThisRound",
        "CCSPlayerController.CCSPlayerController_InGameMoneyServices.m_iStartAccount",
      ], importantTicks)
    : [];
  const tickIndex = buildTickIndex(tickRows);
  const reports = players.map((player) => buildPlayerReport(player, grouped, tickIndex, header));
  return { header, players, reports, parserVersion: "0.42.0" };
}
