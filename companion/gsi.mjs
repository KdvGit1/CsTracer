// CS2 Realtime Game State Integration (GSI) Analyzer & Behavior Coach
import { EventEmitter } from "node:events";

export const gsiEvents = new EventEmitter();

export function getWeaponMovementProfile(weaponName = "", weaponType = "") {
  const name = String(weaponName || "").toLowerCase();
  const type = String(weaponType || "").toLowerCase();

  // 1. KESKİN NİŞANCI (AWP, SSG08, SCAR-20, G3SG1) - Sıfır Tolerans (Harekette sapma ölümcüldür)
  if (name.includes("awp") || name.includes("ssg") || name.includes("scar20") || name.includes("g3sg1") || type === "sniperrifle") {
    return {
      category: "sniper",
      thresholdSpeed: 20,
      isRunAndGun: false,
      label: "Keskin Nişancı",
      mistakeText: (spd) => `AWP / Sniper ile tam durmadan ateş ettin (Hız: ${spd} u/s). Ayakların yere oturmadan tetiğe basma!`,
      goldenAdvice: "AWP / Sniper ile düelloya girerken zıt tuşla sert fren yap; scope netleşmeden asla sıkma.",
    };
  }

  // 2. PİYADE TÜFEĞİ (AK-47, M4A4, M4A1-S, Galil, FAMAS, AUG, SG 553) - Counter-Strafe Şart
  if (name.includes("ak47") || name.includes("m4a") || name.includes("galil") || name.includes("famas") || name.includes("aug") || name.includes("sg553") || type === "rifle") {
    const wpLabel = name.includes("ak47") ? "AK-47" : name.includes("m4a1") ? "M4A1-S" : name.includes("m4a4") ? "M4A4" : "Piyade Tüfeği";
    return {
      category: "rifle",
      thresholdSpeed: 65,
      isRunAndGun: false,
      label: wpLabel,
      mistakeText: (spd) => `${wpLabel} ile koşarak sıktın (Hız: ${spd} u/s). Tüfekle ateş etmeden önce counter-strafe ile dur!`,
      goldenAdvice: "AK/M4 ile koşarak sıkma; düelloda ters yön tuşuna dokunup hızını sıfırlayarak 2-3 mermi burst sık.",
    };
  }

  // 3. AĞIR TABANCA (Desert Eagle, R8 Revolver) - Koşma Cezası Çok Yüksek
  if (name.includes("deagle") || name.includes("revolver")) {
    return {
      category: "heavy_pistol",
      thresholdSpeed: 45,
      isRunAndGun: false,
      label: "Desert Eagle",
      mistakeText: (spd) => `Desert Eagle ile koşarak ateş ettin (Hız: ${spd} u/s). Deagle ile tam durmadan kafayı vuramazsın!`,
      goldenAdvice: "Deagle ile koşarak sıkma; tam durup crosshair'i kafa hizasına koyarak sakin tek tek sık.",
    };
  }

  // 4. HAFİF MAKİNELİ / SMG (MAC-10, MP9, MP7, MP5-SD, P90, PP-Bizon, UMP-45) - Run & Gun Geçerli Taktik
  if (type === "submachinegun" || name.includes("mac10") || name.includes("mp9") || name.includes("mp7") || name.includes("mp5") || name.includes("p90") || name.includes("bizon") || name.includes("ump45")) {
    return {
      category: "smg",
      thresholdSpeed: 230,
      isRunAndGun: true,
      label: "Hafif Makineli (SMG)",
      mistakeText: null,
      goldenAdvice: "SMG ile yakın mesafe hareketli baskı kur; mesafeyi kapatıp rakibin aim'ini boz.",
    };
  }

  // 5. POMPALI TÜFEK (XM1014, MAG-7, Nova, Sawed-Off) - Run & Gun Geçerli
  if (type === "shotgun" || name.includes("xm1014") || name.includes("mag7") || name.includes("nova") || name.includes("sawedoff")) {
    return {
      category: "shotgun",
      thresholdSpeed: 230,
      isRunAndGun: true,
      label: "Pompalı",
      mistakeText: null,
      goldenAdvice: "Pompalı tüfekle köşeleri agresif kapat ve yakın temas ara.",
    };
  }

  // 6. HAFİF MOBİL TABANCALAR (Tec-9, Glock-18, Dual Berettas, Five-SeveN)
  if (name.includes("tec9") || name.includes("glock") || name.includes("elite") || name.includes("fiveseven")) {
    return {
      category: "run_pistol",
      thresholdSpeed: 175,
      isRunAndGun: true,
      label: "Mobil Tabanca",
      mistakeText: null,
      goldenAdvice: "Glock/Tec-9 ile hareketli girişlerde kafaya sprey yap.",
    };
  }

  // 7. HASSAS TABANCALAR (USP-S, P2000, P250)
  return {
    category: "pistol",
    thresholdSpeed: 75,
    isRunAndGun: false,
    label: "Hassas Tabanca",
    mistakeText: (spd) => `USP-S / P250 ile koşarak sıktın (Hız: ${spd} u/s). İlk mermi isabeti için duruş yap!`,
    goldenAdvice: "Pistol roundunda USP-S ile sakin kal, gereksiz hareket etmeden ilk mermiyi kafaya bırak.",
  };
}

let liveSession = {
  connected: false,
  lastPacketTime: 0,
  packetCount: 0,
  phase: "idle",
  map: {
    name: "",
    mode: "",
    phase: "warmup",
    round: 0,
    scoreCT: 0,
    scoreT: 0,
  },
  round: {
    phase: "freezetime",
    winTeam: "",
    bomb: "",
    phaseEndsIn: null,
  },
  player: {
    name: "",
    steamid: "",
    activity: "",
    team: "CT",
    health: 100,
    armor: 100,
    helmet: false,
    flashed: 0,
    smoked: 0,
    money: 800,
    roundKills: 0,
    roundDamage: 0,
    kills: 0,
    deaths: 0,
    assists: 0,
    mvps: 0,
    score: 0,
    activeWeapon: "",
    activeWeaponType: "",
    clip: 0,
    reserve: 0,
    weapons: [],
    grenades: [],
    hasDefuser: false,
    speed: 0,
    position: { x: 0, y: 0, z: 0 },
    pitch: 0,
    yaw: 0,
  },
  team: {
    allies: [],
    totalMoney: 800,
    totalUtility: { smoke: 0, flash: 0, molly: 0, he: 0 },
  },
  bomb: {
    state: "carried",
    countdown: null,
    defusing: false,
    plantedTime: 0,
  },
  diagnostics: {
    movingShots: 0,
    stationaryShots: 0,
    counterStrafePercent: null,
    panicSprays: 0,
    reloadsInDanger: 0,
    isolatedDeaths: 0,
    overpeeksInAdvantage: 0,
    wastedUtilityMoney: 0,
  },
  roundMistakes: [],
  goldenAdvice: null,
  history: [],
};

// State trackers for delta analysis
let lastPosData = null;
let lastWeaponState = null;
let prevRoundNumber = -1;
let prevRoundPhase = "";
let prevMapName = "";
let prevMapPhase = "";
let roundMistakesAccumulator = [];
let packetRateWindowStartedAt = Date.now();
let packetRateWindowCount = 0;
let recentPacketRate = 0;

const GSI_STALE_MS = 7000;

// Yeni maç tespiti: harita değişimi, gameover→yeni maç geçişi veya round sayacının
// gerilemesi. Sıfırlanmazsa ikinci maçın istatistikleri eski maçla karışır.
function resetMatchDiagnostics() {
  liveSession.diagnostics = {
    movingShots: 0,
    stationaryShots: 0,
    counterStrafePercent: null,
    panicSprays: 0,
    reloadsInDanger: 0,
    isolatedDeaths: 0,
    overpeeksInAdvantage: 0,
    wastedUtilityMoney: 0,
  };
  liveSession.roundMistakes = [];
  liveSession.goldenAdvice = null;
  roundMistakesAccumulator = [];
  lastPosData = null;
  lastWeaponState = null;
}

export function getLiveState() {
  const isStale = Date.now() - liveSession.lastPacketTime > GSI_STALE_MS;
  return {
    ...liveSession,
    connected: liveSession.packetCount > 0 && !isStale,
  };
}

export function getGamePerformanceStatus(now = Date.now()) {
  const connected = liveSession.packetCount > 0 && now - liveSession.lastPacketTime <= GSI_STALE_MS;
  const mapPhase = String(liveSession.map.phase || "").toLowerCase();
  const playerActivity = String(liveSession.player.activity || "").toLowerCase();
  const hasActiveMap = Boolean(liveSession.map.name) && mapPhase !== "gameover";
  // CS2 lobide/ana menüde GSI heartbeat göndermeye devam edebilir. Bu sırada
  // son harita adı bellekte kalsa bile `player.activity=menu` canlı maç değildir.
  // `textinput` maç içi sohbet/konsol sırasında görülebildiğinden yalnızca menu
  // kesin olarak performans korumasını kapatır.
  const isLobbyOrMenu = playerActivity === "menu";
  const active = connected && hasActiveMap && !isLobbyOrMenu;
  return {
    active,
    connected,
    map: liveSession.map.name || "",
    mapPhase: liveSession.map.phase || "",
    roundPhase: liveSession.round.phase || "",
    playerActivity,
    packetRate: Math.round(recentPacketRate * 10) / 10,
    lastPacketTime: liveSession.lastPacketTime,
    reason: active
      ? "CS2 canlı harita gönderiyor; ağır arka plan işleri duraklatıldı."
      : connected
        ? isLobbyOrMenu
          ? "CS2 bağlı; oyuncu lobide veya ana menüde, ağır işler çalışabilir."
          : "CS2 bağlı, ancak canlı harita yok."
        : "CS2 canlı bağlantısı bekleniyor.",
  };
}

function parsePositionString(pos) {
  if (!pos) return null;
  if (typeof pos === "object") {
    const x = Number(pos.x ?? pos[0]);
    const y = Number(pos.y ?? pos[1]);
    const z = Number(pos.z ?? pos[2] ?? 0);
    if (!isNaN(x) && !isNaN(y)) return { x, y, z };
  }
  if (typeof pos === "string") {
    const parts = pos.split(",").map((s) => Number(s.trim()));
    if (parts.length >= 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
      return { x: parts[0], y: parts[1], z: parts[2] || 0 };
    }
  }
  return null;
}

export function processGsiPacket(payload) {
  if (!payload || typeof payload !== "object") return;

  const now = Date.now();
  liveSession.lastPacketTime = now;
  liveSession.packetCount++;
  packetRateWindowCount++;
  const rateElapsed = now - packetRateWindowStartedAt;
  if (rateElapsed >= 1000) {
    recentPacketRate = (packetRateWindowCount * 1000) / rateElapsed;
    packetRateWindowCount = 0;
    packetRateWindowStartedAt = now;
  }

  // 1. Parse Map & Match State
  if (payload.map) {
    liveSession.map.name = String(payload.map.name || "").replace(/^de_/, "");
    liveSession.map.mode = String(payload.map.mode || "");
    liveSession.map.phase = String(payload.map.phase || "live");
    liveSession.map.round = Number(payload.map.round || 0);
    liveSession.map.scoreCT = Number(payload.map.team_ct?.score || 0);
    liveSession.map.scoreT = Number(payload.map.team_t?.score || 0);
    // Eski/seyirci GSI paketlerinde activity alanı bulunmayabilir. Harita açıkça
    // geldiyse bilinmeyen etkinliği menu diye miras bırakma; map fazı yedeği çalışsın.
    if (!payload.player?.activity) liveSession.player.activity = "";
  }

  // 2. Parse Round & Phase Countdowns
  if (payload.round) {
    liveSession.round.phase = String(payload.round.phase || "live");
    liveSession.round.winTeam = String(payload.round.win_team || "");
    liveSession.round.bomb = String(payload.round.bomb || "");
  }

  if (payload.phase_countdowns) {
    const pPhase = String(payload.phase_countdowns.phase || "");
    if (pPhase) liveSession.round.phase = pPhase;
    liveSession.round.phaseEndsIn = payload.phase_countdowns.phase_ends_in ? Number(payload.phase_countdowns.phase_ends_in) : null;
  }

  // 3. Parse Local Player State
  const playerRaw = payload.player;
  if (playerRaw) {
    const pState = playerRaw.state || {};
    const pMatch = playerRaw.match_stats || {};

    liveSession.player.name = String(playerRaw.name || liveSession.player.name || "Oyuncu");
    liveSession.player.steamid = String(playerRaw.steamid || liveSession.player.steamid || "");
    const activity = String(playerRaw.activity || "").trim().toLowerCase();
    if (activity) liveSession.player.activity = activity;

    // Team detection
    const rawTeam = String(playerRaw.team || "").toUpperCase();
    liveSession.player.team = rawTeam === "CT" || rawTeam === "3" ? "CT" : "T";

    // Player State values
    if (pState.health !== undefined) liveSession.player.health = Number(pState.health);
    if (pState.armor !== undefined) liveSession.player.armor = Number(pState.armor);
    if (pState.helmet !== undefined) liveSession.player.helmet = Boolean(pState.helmet);
    if (pState.flashed !== undefined) liveSession.player.flashed = Number(pState.flashed);
    if (pState.smoked !== undefined) liveSession.player.smoked = Number(pState.smoked);
    if (pState.money !== undefined) liveSession.player.money = Number(pState.money);
    if (pState.round_kills !== undefined) liveSession.player.roundKills = Number(pState.round_kills);
    if (pState.round_killhs !== undefined) liveSession.player.roundKillHs = Number(pState.round_killhs);
    if (pState.round_totaldmg !== undefined) liveSession.player.roundDamage = Number(pState.round_totaldmg);
    if (pState.defusekit !== undefined) liveSession.player.hasDefuser = Boolean(pState.defusekit);

    if (pMatch.kills !== undefined) liveSession.player.kills = Number(pMatch.kills);
    if (pMatch.deaths !== undefined) liveSession.player.deaths = Number(pMatch.deaths);
    if (pMatch.assists !== undefined) liveSession.player.assists = Number(pMatch.assists);
    if (pMatch.mvps !== undefined) liveSession.player.mvps = Number(pMatch.mvps);
    if (pMatch.score !== undefined) liveSession.player.score = Number(pMatch.score);

    if (liveSession.player.kills > 0 && liveSession.player.roundKillHs !== undefined) {
      liveSession.player.hsPercent = Math.round((liveSession.player.roundKillHs / Math.max(1, liveSession.player.roundKills)) * 100);
    }

    // Position & Speed Velocity Calculation
    const myId = liveSession.player.steamid;
    const rawPos = playerRaw.position || (payload.allplayers && myId && payload.allplayers[myId]?.position);
    const parsedPos = parsePositionString(rawPos);

    if (parsedPos) {
      if (lastPosData && lastPosData.time) {
        const dt = (now - lastPosData.time) / 1000;
        if (dt >= 0.03 && dt <= 1.2) {
          const dist2D = Math.hypot(parsedPos.x - lastPosData.x, parsedPos.y - lastPosData.y);
          const instantSpeed = dist2D / dt;
          if (instantSpeed < 3.5) {
            liveSession.player.speed = 0;
          } else {
            const smoothed = (instantSpeed * 0.75) + ((liveSession.player.speed || 0) * 0.25);
            liveSession.player.speed = Math.min(320, Math.round(smoothed));
          }
        }
      }
      liveSession.player.position = parsedPos;
      lastPosData = { x: parsedPos.x, y: parsedPos.y, z: parsedPos.z, time: now };
    }

    // Weapons & Grenades parsing
    const localUtilityCounts = { smoke: 0, flash: 0, molly: 0, he: 0 };
    if (playerRaw.weapons && typeof playerRaw.weapons === "object") {
      const weaponList = Object.values(playerRaw.weapons);
      const parsedWeapons = [];
      const parsedGrenades = [];
      let activeWp = null;

      for (const w of weaponList) {
        const rawName = String(w.name || "");
        const cleanName = rawName.replace(/^weapon_/, "");
        const type = String(w.type || "").toLowerCase();
        const clip = Number(w.ammo_clip ?? -1);
        const reserve = Number(w.ammo_reserve ?? 0);
        const isCurrent = w.state === "active" || w.state === "reloading" || w.state === "firing";

        if (type === "c4") {
          parsedWeapons.push({ name: "C4", type: "c4", isCurrent });
        } else if (type === "grenade" || rawName.includes("grenade") || rawName.includes("molotov") || rawName.includes("flashbang")) {
          const count = Math.max(1, reserve || 1);
          parsedGrenades.push({ name: cleanName, type: "grenade", count });

          const lowerName = cleanName.toLowerCase();
          if (lowerName.includes("smokegrenade")) localUtilityCounts.smoke += count;
          else if (lowerName.includes("flashbang")) localUtilityCounts.flash += count;
          else if (lowerName.includes("molotov") || lowerName.includes("incgrenade")) localUtilityCounts.molly += count;
          else if (lowerName.includes("hegrenade")) localUtilityCounts.he += count;
        } else if (type !== "knife") {
          parsedWeapons.push({ name: cleanName, type, clip, reserve, isCurrent, state: w.state });
        }

        if (isCurrent) {
          activeWp = { name: cleanName, type, clip, reserve, state: w.state };
        }
      }

      liveSession.player.weapons = parsedWeapons;
      liveSession.player.grenades = parsedGrenades;

      if (activeWp) {
        liveSession.player.activeWeapon = activeWp.name;
        liveSession.player.activeWeaponType = activeWp.type;
        liveSession.player.clip = activeWp.clip;
        liveSession.player.reserve = activeWp.reserve;

        // DIAGNOSIS 1: Reload addiction in danger (reloading with > 16 bullets in primary rifle)
        if (
          lastWeaponState &&
          lastWeaponState.name === activeWp.name &&
          activeWp.state === "reloading" &&
          lastWeaponState.state !== "reloading" &&
          lastWeaponState.clip >= 18
        ) {
          liveSession.diagnostics.reloadsInDanger++;
          const mistake = {
            round: liveSession.map.round,
            type: "reload",
            text: `Şarjöründe ${lastWeaponState.clip} mermi varken açık alanda gereksiz reload yaptın.`,
          };
          roundMistakesAccumulator.push(mistake);
          liveSession.roundMistakes = [...roundMistakesAccumulator];
        }

        // DIAGNOSIS 2: Weapon-Aware Counter-Strafe & Moving Shot Penalty
        if (
          lastWeaponState &&
          lastWeaponState.name === activeWp.name &&
          lastWeaponState.clip > 0 &&
          activeWp.clip < lastWeaponState.clip &&
          activeWp.type !== "knife" &&
          activeWp.type !== "grenade"
        ) {
          const deltaShots = lastWeaponState.clip - activeWp.clip;
          const profile = getWeaponMovementProfile(activeWp.name, activeWp.type);
          const currentSpeed = liveSession.player.speed || 0;

          if (profile.isRunAndGun) {
            // SMG / Pompalı / Mobil Tabancalarda koşmak geçerli mekaniktir
            liveSession.diagnostics.stationaryShots += deltaShots;
          } else {
            // Tüfek (AK/M4), Sniper (AWP), Deagle
            if (currentSpeed > profile.thresholdSpeed) {
              liveSession.diagnostics.movingShots += deltaShots;
              if (profile.mistakeText) {
                const mistake = {
                  round: liveSession.map.round,
                  type: "counter_strafe",
                  category: profile.category,
                  text: profile.mistakeText(Math.round(currentSpeed)),
                  advice: profile.goldenAdvice,
                };
                roundMistakesAccumulator.push(mistake);
                liveSession.roundMistakes = [...roundMistakesAccumulator];
              }
            } else {
              liveSession.diagnostics.stationaryShots += deltaShots;
            }
          }

          const totalShots = liveSession.diagnostics.movingShots + liveSession.diagnostics.stationaryShots;
          liveSession.diagnostics.counterStrafePercent = totalShots > 0
            ? Math.round((liveSession.diagnostics.stationaryShots / totalShots) * 100)
            : null;
        }

        lastWeaponState = {
          name: activeWp.name,
          type: activeWp.type,
          clip: activeWp.clip,
          state: activeWp.state,
          time: now,
        };
      }
    }

    // 4. Team Money & Team Utility aggregation
    if (payload.allplayers && typeof payload.allplayers === "object" && Object.keys(payload.allplayers).length > 0) {
      const allies = [];
      let totalMoney = 0;
      const teamUtility = { ...localUtilityCounts };

      for (const [steamId, pData] of Object.entries(payload.allplayers)) {
        const rawPTeam = String(pData.team || "").toUpperCase();
        const pTeam = rawPTeam === "CT" || rawPTeam === "3" ? "CT" : "T";

        if (pTeam === liveSession.player.team) {
          const money = Number(pData.state?.money || 0);
          totalMoney += money;

          // If this is an ally (not local player), add their utility
          if (steamId !== myId) {
            if (pData.weapons) {
              for (const w of Object.values(pData.weapons)) {
                const wName = String(w.name || "").toLowerCase();
                const reserve = Number(w.ammo_reserve || 1);
                if (wName.includes("smokegrenade")) teamUtility.smoke += reserve;
                else if (wName.includes("flashbang")) teamUtility.flash += reserve;
                else if (wName.includes("molotov") || wName.includes("incgrenade")) teamUtility.molly += reserve;
                else if (wName.includes("hegrenade")) teamUtility.he += reserve;
              }
            }

            allies.push({
              name: String(pData.name || "Takım Arkadaşı"),
              health: Number(pData.state?.health || 0),
              armor: Number(pData.state?.armor || 0),
              helmet: Boolean(pData.state?.helmet),
              money,
              hasDefuser: Boolean(pData.state?.defusekit),
            });
          }
        }
      }

      liveSession.team.allies = allies;
      liveSession.team.totalMoney = Math.max(liveSession.player.money, totalMoney);
      liveSession.team.totalUtility = teamUtility;
    } else {
      // Single player context (Competitive Matchmaking client GSI)
      liveSession.team.totalMoney = liveSession.player.money;
      liveSession.team.totalUtility = localUtilityCounts;
    }
  }

  // 5. Parse Bomb State
  if (payload.bomb) {
    liveSession.bomb.state = String(payload.bomb.state || "carried");
    liveSession.bomb.countdown = payload.bomb.countdown ? Number(payload.bomb.countdown) : null;
    liveSession.bomb.defusing = Boolean(payload.bomb.defusing);
  }

  // 6. Round Transitions & Golden Focus Card Generation
  const currentRoundNum = liveSession.map.round;
  const currentRoundPhase = liveSession.round.phase;

  // Yeni maç / harita geçişi: tüm teşhis sayaçlarını sıfırla
  const isNewMatch =
    (prevMapName && liveSession.map.name && liveSession.map.name !== prevMapName) ||
    (prevMapPhase === "gameover" && (liveSession.map.phase === "warmup" || liveSession.map.phase === "live")) ||
    (prevRoundNumber > 2 && currentRoundNum < prevRoundNumber - 1);
  if (isNewMatch) {
    resetMatchDiagnostics();
  }
  prevMapName = liveSession.map.name;
  prevMapPhase = liveSession.map.phase;

  if (currentRoundPhase === "freezetime" && prevRoundPhase !== "freezetime") {
    // New round started! Generate golden focus advice from previous round telemetry
    const advice = generateGoldenAdvice(currentRoundNum, roundMistakesAccumulator, liveSession);
    liveSession.goldenAdvice = advice;
    liveSession.roundMistakes = [];
    roundMistakesAccumulator = [];
  }

  prevRoundNumber = currentRoundNum;
  prevRoundPhase = currentRoundPhase;

  // Emit event to subscribers
  gsiEvents.emit("update", liveSession);
}

function generateGoldenAdvice(roundNum, mistakes, session) {
  if (mistakes.length > 0) {
    const csMistake = mistakes.find((m) => m.type === "counter_strafe");
    if (csMistake) {
      return {
        round: roundNum,
        title: `🛡️ R0${roundNum} Öncelik: ${csMistake.category === "sniper" ? "Sniper Sabitliği" : csMistake.category === "heavy_pistol" ? "Deagle Duruşu" : "Tüfek Counter-Strafe"}`,
        body: csMistake.advice || "Önceki round koşarak sıktığın için mermilerin saçıldı. Düelloya girmeden önce ters tuşa (counter-strafe) basarak hızını sıfırla.",
        type: "aim",
        priority: "critical",
        timestamp: Date.now(),
      };
    }

    const reloadMistake = mistakes.find((m) => m.type === "reload");
    if (reloadMistake) {
      return {
        round: roundNum,
        title: `🛡️ R0${roundNum} Öncelik: Şarjör Disiplini`,
        body: "Şarjöründe bolca mermi varken açık alanda reload yaptın. Düşman yakınındayken güvenli siper almadan şarjör değiştirme.",
        type: "discipline",
        priority: "warning",
        timestamp: Date.now(),
      };
    }
  }

  // Tactical / Economy based Golden Advice
  const teamMoney = session.team.totalMoney;
  const playerMoney = session.player.money;

  if (playerMoney <= 2000 && teamMoney <= 10000) {
    return {
      round: roundNum,
      title: `💰 R0${roundNum} Taktik: Takımla Full Eco Kal`,
      body: "Takım ekonomisi yetersiz. Bu round paranı harcama, sonraki round AWP ve tam zırh/mühimmat ile Full Buy çıkacaksınız.",
      type: "economy",
      priority: "warning",
      timestamp: Date.now(),
    };
  }

  if (session.player.team === "CT") {
    return {
      round: roundNum,
      title: `🎯 R0${roundNum} Savunma: Crossfire & Açı Disiplini`,
      body: "Savunmada rakibin üzerine agresif koşma. Takım arkadaşınla çapraz ateş (crossfire) kur ve rakibin senin crosshair'ine girmesini bekle.",
      type: "position",
      priority: "positive",
      timestamp: Date.now(),
    };
  }

  return {
    round: roundNum,
    title: `⚡ R0${roundNum} Hücum: Takas (Trade) Odaklı Giriş`,
    body: "Site girişinde ilk ölen takım arkadaşının takasını (trade) almak için en fazla 2-3 adım gerisinden koordineli gir.",
    type: "position",
    priority: "positive",
    timestamp: Date.now(),
  };
}
