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
      mistakeText: null, // SMG ile koşarak sıkmak hata değildir
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
  phase: "idle", // idle | warmup | live | freezetime | over
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
  },
  player: {
    name: "",
    steamid: "",
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
    totalMoney: 0,
    totalUtility: { smoke: 0, flash: 0, molly: 0, he: 0 },
  },
  bomb: {
    state: "carried", // carried | planted | defused | exploded
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

// Internal tracking state for live event delta detection
let prevPlayerState = null;
let prevRoundNumber = -1;
let prevRoundPhase = "";
let prevWeaponClip = -1;
let prevWeaponName = "";
let roundStartTime = 0;
let roundMistakesAccumulator = [];

export function getLiveState() {
  const isStale = Date.now() - liveSession.lastPacketTime > 7000;
  return {
    ...liveSession,
    connected: liveSession.packetCount > 0 && !isStale,
  };
}

export function processGsiPacket(payload) {
  if (!payload || typeof payload !== "object") return;

  const now = Date.now();
  liveSession.lastPacketTime = now;
  liveSession.packetCount++;

  // 1. Parse Map & Match State
  if (payload.map) {
    liveSession.map.name = String(payload.map.name || "").replace(/^de_/, "");
    liveSession.map.mode = String(payload.map.mode || "");
    liveSession.map.phase = String(payload.map.phase || "live");
    liveSession.map.round = Number(payload.map.round || 0);
    liveSession.map.scoreCT = Number(payload.map.team_ct?.score || 0);
    liveSession.map.scoreT = Number(payload.map.team_t?.score || 0);
  }

  // 2. Parse Round State
  if (payload.round) {
    liveSession.round.phase = String(payload.round.phase || "live");
    liveSession.round.winTeam = String(payload.round.win_team || "");
    liveSession.round.bomb = String(payload.round.bomb || "");
  }

  // 3. Parse Local Player State
  const playerRaw = payload.player;
  if (playerRaw) {
    const pState = playerRaw.state || {};
    const pMatch = playerRaw.match_stats || {};

    liveSession.player.name = String(playerRaw.name || liveSession.player.name || "Oyuncu");
    liveSession.player.steamid = String(playerRaw.steamid || liveSession.player.steamid || "");
    liveSession.player.team = Number(playerRaw.team) === 3 || String(playerRaw.team).toUpperCase() === "CT" ? "CT" : "T";
    liveSession.player.health = Number(pState.health ?? 100);
    liveSession.player.armor = Number(pState.armor ?? 0);
    liveSession.player.helmet = Boolean(pState.helmet);
    liveSession.player.flashed = Number(pState.flashed ?? 0);
    liveSession.player.smoked = Number(pState.smoked ?? 0);
    liveSession.player.money = Number(pState.money ?? 800);
    liveSession.player.roundKills = Number(pState.round_kills ?? 0);
    liveSession.player.roundDamage = Number(pState.round_totaldmg ?? 0);
    liveSession.player.hasDefuser = Boolean(pState.defusekit);

    liveSession.player.kills = Number(pMatch.kills ?? liveSession.player.kills);
    liveSession.player.deaths = Number(pMatch.deaths ?? liveSession.player.deaths);
    liveSession.player.assists = Number(pMatch.assists ?? liveSession.player.assists);
    liveSession.player.mvps = Number(pMatch.mvps ?? liveSession.player.mvps);
    liveSession.player.score = Number(pMatch.score ?? liveSession.player.score);

    // Weapons & Active Weapon
    if (playerRaw.weapons && typeof playerRaw.weapons === "object") {
      const weaponList = Object.values(playerRaw.weapons);
      const parsedWeapons = [];
      const parsedGrenades = [];
      let activeWp = null;

      for (const w of weaponList) {
        const name = String(w.name || "").replace(/^weapon_/, "");
        const type = String(w.type || "").toLowerCase();
        const clip = Number(w.ammo_clip ?? -1);
        const reserve = Number(w.ammo_reserve ?? 0);
        const isCurrent = w.state === "active" || w.state === "reloading" || w.state === "firing";

        if (type === "c4") parsedWeapons.push({ name: "C4", type: "c4", isCurrent });
        else if (type === "grenade") {
          parsedGrenades.push({ name, type: "grenade", count: 1 });
        } else if (type !== "knife") {
          parsedWeapons.push({ name, type, clip, reserve, isCurrent, state: w.state });
        }

        if (isCurrent) {
          activeWp = { name, type, clip, reserve, state: w.state };
        }
      }

      liveSession.player.weapons = parsedWeapons;
      liveSession.player.grenades = parsedGrenades;

      if (activeWp) {
        liveSession.player.activeWeapon = activeWp.name;
        liveSession.player.activeWeaponType = activeWp.type;
        liveSession.player.clip = activeWp.clip;
        liveSession.player.reserve = activeWp.reserve;

        // BEHAVIOR DIAGNOSIS 1: Reload addiction in danger (reloading with > 16 bullets)
        if (activeWp.state === "reloading" && prevWeaponName === activeWp.name && prevWeaponClip > 16) {
          liveSession.diagnostics.reloadsInDanger++;
          const mistake = {
            round: liveSession.map.round,
            type: "reload",
            text: `Şarjöründe ${prevWeaponClip} mermi varken açıkta reload yaptın.`,
          };
          roundMistakesAccumulator.push(mistake);
          liveSession.roundMistakes = [...roundMistakesAccumulator];
        }

        // BEHAVIOR DIAGNOSIS 2: Weapon-Aware Counter-Strafe & Movement Penalty
        if (prevWeaponClip > 0 && activeWp.clip < prevWeaponClip && activeWp.type !== "knife" && activeWp.type !== "grenade") {
          const profile = getWeaponMovementProfile(activeWp.name, activeWp.type);
          const currentSpeed = liveSession.player.speed || 0;

          if (profile.isRunAndGun) {
            // SMG / Shotgun / Mobil Tabancalarda koşmak geçerli ve beklenen bir mekaniktir
            liveSession.diagnostics.stationaryShots++;
          } else {
            // Tüfekler (AK/M4), Keskin Nişancılar (AWP), Ağır Tabancalar (Deagle)
            if (currentSpeed > profile.thresholdSpeed) {
              liveSession.diagnostics.movingShots++;
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
              liveSession.diagnostics.stationaryShots++;
            }
          }

          const totalShots = liveSession.diagnostics.movingShots + liveSession.diagnostics.stationaryShots;
          liveSession.diagnostics.counterStrafePercent = totalShots > 0
            ? Math.round((liveSession.diagnostics.stationaryShots / totalShots) * 100)
            : null;
        }

        prevWeaponClip = activeWp.clip;
        prevWeaponName = activeWp.name;
      }
    }

    // Position / Velocity if provided in allplayers
    if (payload.allplayers && typeof payload.allplayers === "object") {
      const myId = liveSession.player.steamid;
      const myAllplayer = payload.allplayers[myId];
      if (myAllplayer?.position) {
        const [x, y, z] = String(myAllplayer.position).split(",").map(Number);
        if (!isNaN(x) && !isNaN(y)) {
          if (liveSession.player.position.x !== 0 && prevPlayerState?.time) {
            const dt = Math.max(0.1, (now - prevPlayerState.time) / 1000);
            const dist = Math.hypot(x - liveSession.player.position.x, y - liveSession.player.position.y);
            liveSession.player.speed = Math.min(300, Math.round(dist / dt));
          }
          liveSession.player.position = { x, y, z: z || 0 };
        }
      }

      // Parse Team Allies
      const allies = [];
      let totalAlliedMoney = 0;
      const utilityCounts = { smoke: 0, flash: 0, molly: 0, he: 0 };

      for (const [steamId, pData] of Object.entries(payload.allplayers)) {
        const pTeam = Number(pData.team) === 3 || String(pData.team).toUpperCase() === "CT" ? "CT" : "T";
        if (pTeam === liveSession.player.team) {
          const money = Number(pData.state?.money || 0);
          totalAlliedMoney += money;

          // Utility count
          if (pData.weapons) {
            for (const w of Object.values(pData.weapons)) {
              const wName = String(w.name || "").toLowerCase();
              if (wName.includes("smokegrenade")) utilityCounts.smoke++;
              else if (wName.includes("flashbang")) utilityCounts.flash++;
              else if (wName.includes("molotov") || wName.includes("incgrenade")) utilityCounts.molly++;
              else if (wName.includes("hegrenade")) utilityCounts.he++;
            }
          }

          if (steamId !== myId) {
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
      liveSession.team.totalMoney = totalAlliedMoney;
      liveSession.team.totalUtility = utilityCounts;
    }
  }

  // 4. Parse Bomb State
  if (payload.bomb) {
    liveSession.bomb.state = String(payload.bomb.state || "carried");
    liveSession.bomb.countdown = payload.bomb.countdown ? Number(payload.bomb.countdown) : null;
    liveSession.bomb.defusing = Boolean(payload.bomb.defusing);
  }

  // 5. Round Transitions & Golden Focus Card Generation
  const currentRoundNum = liveSession.map.round;
  const currentRoundPhase = liveSession.round.phase;

  if (currentRoundPhase === "freezetime" && prevRoundPhase !== "freezetime") {
    // A new round has started! Generate Golden Advice based on previous round mistakes.
    const advice = generateGoldenAdvice(currentRoundNum, roundMistakesAccumulator, liveSession);
    liveSession.goldenAdvice = advice;
    liveSession.roundMistakes = [];
    roundMistakesAccumulator = [];
    roundStartTime = now;
  }

  prevPlayerState = { time: now };
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
