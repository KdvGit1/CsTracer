// T tarafı oyun disiplini: "alan al, erken ölme, default oyna, amaçlı utility,
// takas mesafesi, geç execute yapma, rotasyon oku, tempo değiştir, sayı
// üstünlüğünü koru, bomba sonrası oyna" kurallarını demo zaman çizelgesinden
// ölçer. Eski analizlerde yalnız rota noktaları ve ölüm kayıtları bulunduğu
// için zaman çizelgesi bunlardan yeniden kurulur; yeni analizlerdeki kesin
// bomba ve utility olayları varsa onlar tercih edilir.
import { normalizeMapName } from "./squad/identity.mjs";
import { siteOfZone, zoneLane } from "./squad/maps.mjs";

export const T_SIDE_METHOD = "round-timeline-v1";
export const ROUND_SECONDS = 115;
export const EARLY_DEATH_SECONDS = 15;
export const LATE_HIT_SECONDS_LEFT = 25;
export const ISOLATED_DISTANCE = 900;
export const SNAPSHOT_SECONDS = [12, 20, 40];
const POSITION_TOLERANCE_SECONDS = 4;
const POST_PLANT_SNAPSHOT_SECONDS = 8;
const MAX_VISITS = 8;

const round1 = (value) => Math.round(Number(value || 0) * 10) / 10;
const percent = (part, total) => (total > 0 ? Math.round((part / total) * 100) : null);
const int = (value) => Math.round(Number(value || 0));

function playerId(player) {
  return String(player?.steamid || "") || String(player?.name || "");
}

function isSpawnZone(zone) {
  return !zone || /spawn|bilinmeyen/i.test(zone);
}

function nearestPoint(points, tick, toleranceTicks) {
  if (!points?.length) return null;
  let low = 0;
  let high = points.length - 1;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (points[middle].tick < tick) low = middle + 1;
    else high = middle;
  }
  const candidates = [points[low], points[low - 1]].filter(Boolean);
  const best = candidates.sort((a, b) => Math.abs(a.tick - tick) - Math.abs(b.tick - tick))[0];
  return best && Math.abs(best.tick - tick) <= toleranceTicks ? best : null;
}

function utilityType(type) {
  const value = String(type || "").toLowerCase();
  if (value.includes("smoke")) return "smoke";
  if (value.includes("flash")) return "flash";
  if (value.includes("molotov") || value.includes("inferno") || value.includes("incendiary")) return "molotov";
  return "he";
}

/**
 * Tam analiz çıktısından (`fullAnalysis`) round bazlı, koordinatı tamsayıya
 * indirilmiş ve depolanabilir bir zaman çizelgesi üretir. Çıktı yalnız bu
 * modüldeki istatistik fonksiyonlarının ihtiyaç duyduğu alanları taşır.
 */
export function buildRoundTimeline(analysis, mapName = "") {
  const reports = Array.isArray(analysis?.reports) ? analysis.reports : [];
  const tickRate = Number(analysis?.tickRate) > 0 ? Number(analysis.tickRate) : 64;
  const map = normalizeMapName(mapName || analysis?.header?.map_name || reports[0]?.map);
  const tolerance = tickRate * POSITION_TOLERANCE_SECONDS;
  const nameToId = new Map();
  for (const player of analysis?.players || []) if (player?.name) nameToId.set(String(player.name), playerId(player));
  for (const report of reports) if (report?.player?.name) nameToId.set(String(report.player.name), playerId(report.player));

  const rounds = new Map();
  for (const report of reports) {
    const id = playerId(report?.player);
    if (!id) continue;
    for (const path of report?.roundPaths || []) {
      if (path?.side !== "CT" && path?.side !== "T") continue;
      const key = Number(path.round);
      if (!Number.isFinite(key)) continue;
      const points = (Array.isArray(path.points) ? path.points : [])
        .filter((point) => [point?.x, point?.y, point?.tick].every(Number.isFinite))
        .sort((a, b) => a.tick - b.tick);
      if (!rounds.has(key)) {
        rounds.set(key, { round: key, startTick: Infinity, endTick: 0, winnerSide: "", reason: "", sides: new Map(), paths: new Map(), deaths: [] });
      }
      const round = rounds.get(key);
      round.sides.set(id, path.side);
      round.paths.set(id, points);
      if (points.length) {
        round.startTick = Math.min(round.startTick, points[0].tick);
        round.endTick = Math.max(round.endTick, points.at(-1).tick);
      }
      if (!round.winnerSide && path.winnerSide) round.winnerSide = String(path.winnerSide);
      if (!round.reason && path.winReason) round.reason = String(path.winReason);
    }
  }

  const exactEvents = new Map((Array.isArray(analysis?.roundEvents) ? analysis.roundEvents : []).map((event) => [Number(event.round), event]));
  for (const [key, event] of exactEvents) {
    const round = rounds.get(key);
    if (!round) continue;
    if (Number.isFinite(event.startTick) && event.startTick > 0) round.startTick = event.startTick;
    if (Number.isFinite(event.endTick) && event.endTick > 0) round.endTick = Math.max(round.endTick, event.endTick);
    if (event.winnerSide) round.winnerSide = event.winnerSide;
    if (event.reason) round.reason = event.reason;
  }

  const ordered = [...rounds.values()]
    .filter((round) => Number.isFinite(round.startTick) && round.endTick > round.startTick)
    .sort((a, b) => a.startTick - b.startTick);
  const roundForTick = (tick) => {
    let found = null;
    for (const round of ordered) {
      if (round.startTick <= tick + tickRate) found = round;
      else break;
    }
    return found && tick <= found.endTick + tickRate * 8 ? found : null;
  };

  // Saldırgan konumu kill kaydında, kurban konumu ölüm kaydında tutulur.
  const killerPositions = new Map();
  for (const report of reports) {
    for (const kill of report?.killDetails || []) {
      if (!Number.isFinite(kill?.tick)) continue;
      killerPositions.set(`${kill.tick}|${kill.victim}`, { ...kill, killer: playerId(report.player) });
    }
  }
  for (const report of reports) {
    const victim = playerId(report?.player);
    for (const death of report?.deathDetails || []) {
      const tick = Number(death?.tick);
      if (!Number.isFinite(tick)) continue;
      const round = roundForTick(tick);
      if (!round) continue;
      const killerInfo = killerPositions.get(`${tick}|${report.player?.name}`)
        || killerPositions.get(`${tick - 1}|${report.player?.name}`)
        || killerPositions.get(`${tick + 1}|${report.player?.name}`);
      const killer = killerInfo?.killer || nameToId.get(String(death.killer || "")) || "";
      round.deaths.push({
        tick,
        victim,
        killer,
        zone: String(death.zone || ""),
        x: Number(death.x),
        y: Number(death.y),
        kzone: killerInfo ? String(killerInfo.zone || "") : "",
        kx: killerInfo ? Number(killerInfo.x) : NaN,
        ky: killerInfo ? Number(killerInfo.y) : NaN,
        traded: Boolean(death.traded),
        nearestTeammate: Number.isFinite(death.nearestTeammate) ? death.nearestTeammate : null,
        unusedUtility: Number.isFinite(death.unusedUtility) ? death.unusedUtility : null,
      });
    }
  }

  const utilityByPlayer = new Map();
  let utilityAvailable = false;
  for (const report of reports) {
    if (!Array.isArray(report?.utilityThrows)) continue;
    utilityAvailable = true;
    utilityByPlayer.set(playerId(report.player), report.utilityThrows);
  }

  const normalized = ordered.map((round) => {
    const secondsOf = (tick) => round1((tick - round.startTick) / tickRate);
    const deathTick = new Map();
    for (const death of round.deaths.sort((a, b) => a.tick - b.tick)) {
      if (!deathTick.has(death.victim)) deathTick.set(death.victim, death.tick);
    }
    const positionAt = (id, tick) => {
      if (deathTick.has(id) && deathTick.get(id) < tick) return null;
      return nearestPoint(round.paths.get(id), tick, tolerance);
    };
    const alive = (id, tick) => !(deathTick.has(id) && deathTick.get(id) <= tick);
    const ids = [...round.sides.keys()];
    const tIds = ids.filter((id) => round.sides.get(id) === "T");
    const ctIds = ids.filter((id) => round.sides.get(id) === "CT");

    let hit = null;
    for (const id of tIds) {
      for (const point of round.paths.get(id) || []) {
        const site = siteOfZone(point.zone);
        if (site && (!hit || point.tick < hit.tick)) hit = { site, tick: point.tick };
        if (site) break;
      }
    }

    const exact = exactEvents.get(round.round)?.plant;
    let plant = null;
    if (exact && Number.isFinite(exact.tick)) {
      plant = {
        site: exact.site || siteOfZone(exact.zone) || hit?.site || null,
        tick: exact.tick,
        sec: secondsOf(exact.tick),
        x: int(exact.x),
        y: int(exact.y),
        planter: String(exact.planter || ""),
        exact: true,
      };
    } else if (/bomb_exploded|bomb_defused/.test(round.reason)) {
      plant = { site: hit?.site || null, tick: null, sec: null, x: null, y: null, planter: "", exact: false };
    }

    const kills = round.deaths.map((death) => ({
      sec: secondsOf(death.tick),
      victim: death.victim,
      victimSide: round.sides.get(death.victim) || "",
      killer: death.killer,
      killerSide: round.sides.get(death.killer) || "",
      zone: death.zone,
      x: int(death.x),
      y: int(death.y),
      kzone: death.kzone,
      kx: Number.isFinite(death.kx) ? int(death.kx) : null,
      ky: Number.isFinite(death.ky) ? int(death.ky) : null,
      traded: death.traded,
      nearestTeammate: death.nearestTeammate,
      unusedUtility: death.unusedUtility,
    }));
    const firstKill = kills.find((kill) => kill.killerSide && kill.victimSide && kill.killerSide !== kill.victimSide) || null;

    const snapshots = {};
    for (const second of SNAPSHOT_SECONDS) {
      const tick = round.startTick + second * tickRate;
      if (tick > round.endTick) continue;
      snapshots[second] = ids.map((id) => {
        const point = positionAt(id, tick);
        if (!point) return null;
        return { id, side: round.sides.get(id), zone: String(point.zone || ""), x: int(point.x), y: int(point.y) };
      }).filter(Boolean);
    }

    let postPlant = null;
    const postPlantTick = plant?.tick ? plant.tick + POST_PLANT_SNAPSHOT_SECONDS * tickRate : null;
    if (postPlantTick && postPlantTick <= round.endTick) {
      postPlant = ids.map((id) => {
        const point = positionAt(id, postPlantTick);
        return point ? { id, side: round.sides.get(id), zone: String(point.zone || ""), x: int(point.x), y: int(point.y) } : null;
      }).filter(Boolean);
    }

    const ctOnSite = (site, tick) => ctIds.filter((id) => {
      if (!alive(id, tick)) return false;
      const point = positionAt(id, tick);
      return point && zoneLane(map, point.zone) === site;
    }).length;

    const players = {};
    for (const id of ids) {
      const side = round.sides.get(id);
      const points = round.paths.get(id) || [];
      const zones = new Set(points.map((point) => point.zone).filter((zone) => !isSpawnZone(zone)));
      const entry = { side, zones: zones.size };
      if (side === "T") {
        const visits = [];
        const seen = new Set();
        for (const point of points) {
          if (hit && point.tick >= hit.tick) break;
          if (isSpawnZone(point.zone) || seen.has(point.zone)) continue;
          seen.add(point.zone);
          visits.push({ zone: String(point.zone), sec: secondsOf(point.tick) });
          if (visits.length >= MAX_VISITS) break;
        }
        entry.visits = visits;
      }
      if (utilityAvailable) {
        const throws = (utilityByPlayer.get(id) || []).filter((item) => item.tick >= round.startTick && item.tick <= round.endTick);
        const types = { smoke: 0, flash: 0, molotov: 0, he: 0 };
        for (const item of throws) types[utilityType(item.type)] += 1;
        entry.utility = {
          total: throws.length,
          preHit: hit ? throws.filter((item) => item.tick < hit.tick).length : throws.length,
          types,
        };
      }
      players[id] = entry;
    }

    return {
      round: round.round,
      durationSec: secondsOf(round.endTick),
      winnerSide: round.winnerSide,
      reason: round.reason,
      players,
      kills,
      firstKillSide: firstKill?.killerSide || null,
      hit: hit ? { site: hit.site, sec: secondsOf(hit.tick) } : null,
      ctAtHit: hit ? ctOnSite(hit.site, hit.tick) : null,
      ctOnSiteAt20: {
        A: round.startTick + 20 * tickRate <= round.endTick ? ctOnSite("A", round.startTick + 20 * tickRate) : null,
        B: round.startTick + 20 * tickRate <= round.endTick ? ctOnSite("B", round.startTick + 20 * tickRate) : null,
      },
      plant: plant ? { site: plant.site, sec: plant.sec, x: plant.x, y: plant.y, planter: plant.planter, exact: plant.exact } : null,
      snapshots,
      postPlant,
    };
  });

  return {
    schemaVersion: 1,
    method: T_SIDE_METHOD,
    map,
    utilityAvailable,
    exactPlants: exactEvents.size > 0,
    rounds: normalized,
  };
}

function emptyStats() {
  return {
    method: T_SIDE_METHOD,
    matches: 0,
    tRounds: 0,
    tWins: 0,
    space: { zonesSum: 0, zonesSamples: 0, teamZonesSum: 0, teamZonesRounds: 0, openingWon: 0, openingRounds: 0 },
    early: { deaths: 0, untraded: 0, openingDeaths: 0 },
    structure: { rush: 0, rushWins: 0, spread: 0, spreadWins: 0, stack: 0, stackWins: 0, passive: 0, passiveWins: 0 },
    utility: { measuredRounds: 0, total: 0, preHit: 0, roundsWithUtility: 0, smoke: 0, flash: 0, molotov: 0, he: 0, deathsMeasured: 0, diedWithUtility: 0, unusedSum: 0 },
    trade: { deaths: 0, traded: 0, isolated: 0, distanceSum: 0, distanceSamples: 0 },
    timing: { hits: 0, hitSecSum: 0, lateHits: 0, timeRanOut: 0, exactPlants: 0, plantSecLeftSum: 0, latePlants: 0 },
    rotation: { fakeHits: 0, fakeWins: 0, directHits: 0, directWins: 0, ctAtHitSum: 0, ctAtHitSamples: 0, ctSetupSum: 0, ctSetupSamples: 0 },
    tempo: { fast: 0, medium: 0, slow: 0, siteA: 0, siteB: 0, switches: 0, sequenceSamples: 0 },
    numbers: { advRounds: 0, advWins: 0, disRounds: 0, disWins: 0, advThrowDeaths: 0 },
    postPlant: { plants: 0, plantWins: 0, exactPlants: 0, deaths: 0, traded: 0, kills: 0 },
  };
}

function aliveCounts(round, sec) {
  const counts = { T: 0, CT: 0 };
  for (const [id, player] of Object.entries(round.players || {})) {
    const death = round.kills.find((kill) => kill.victim === id);
    if (!death || death.sec > sec) counts[player.side] = (counts[player.side] || 0) + 1;
  }
  return counts;
}

/**
 * Seçili oyuncu(lar)ın T roundlarından sayım tabanlı istatistik üretir.
 * Takım düzeyi metrikler round başına bir kez, oyuncu düzeyi metrikler her
 * seçili oyuncu için ayrı sayılır. Sayımlar maçlar arasında toplanabilir.
 */
export function buildTSideStats(timeline, playerIds) {
  const stats = emptyStats();
  const ids = new Set((Array.isArray(playerIds) ? playerIds : [playerIds]).map(String).filter(Boolean));
  if (!timeline?.rounds?.length || !ids.size) return stats;
  const map = timeline.map;
  const laneOf = (item) => item.lane ?? zoneLane(map, item.zone);
  let previousSite = null;
  let counted = false;
  for (const round of timeline.rounds) {
    const selected = [...ids].filter((id) => round.players?.[id]?.side === "T");
    if (!selected.length) continue;
    counted = true;
    const won = round.winnerSide === "T";
    stats.tRounds += 1;
    if (won) stats.tWins += 1;
    const hitSec = round.hit?.sec ?? null;
    const plantSec = round.plant?.exact ? round.plant.sec : null;

    // 1 · Alan
    const snapshot20 = round.snapshots?.[20] || round.snapshots?.["20"];
    if (snapshot20) {
      const zones = new Set(snapshot20.filter((item) => item.side === "T" && !isSpawnZone(item.zone)).map((item) => item.zone));
      stats.space.teamZonesSum += zones.size;
      stats.space.teamZonesRounds += 1;
    }
    if (round.firstKillSide) {
      stats.space.openingRounds += 1;
      if (round.firstKillSide === "T") stats.space.openingWon += 1;
    }

    // 3 · Round yapısı (rush / default / stack / pasif)
    if (hitSec !== null && hitSec < 20) {
      stats.structure.rush += 1;
      if (won) stats.structure.rushWins += 1;
    } else if (snapshot20) {
      const lanes = new Set(snapshot20.map((item) => (item.side === "T" ? laneOf(item) : null)).filter((lane) => ["A", "B", "mid"].includes(lane)));
      const key = lanes.size >= 2 ? "spread" : lanes.size === 1 ? "stack" : "passive";
      stats.structure[key] += 1;
      if (won) stats.structure[`${key}Wins`] += 1;
    }

    // 6 · Zamanlama, 8 · Tempo
    if (round.hit) {
      stats.timing.hits += 1;
      stats.timing.hitSecSum += hitSec;
      if (hitSec > ROUND_SECONDS - LATE_HIT_SECONDS_LEFT) stats.timing.lateHits += 1;
      if (hitSec < 30) stats.tempo.fast += 1;
      else if (hitSec <= 65) stats.tempo.medium += 1;
      else stats.tempo.slow += 1;
      if (round.hit.site === "A") stats.tempo.siteA += 1;
      if (round.hit.site === "B") stats.tempo.siteB += 1;
      if (previousSite) {
        stats.tempo.sequenceSamples += 1;
        if (previousSite !== round.hit.site) stats.tempo.switches += 1;
      }
      previousSite = round.hit.site;
    }
    if (round.reason === "time_ran_out") stats.timing.timeRanOut += 1;
    if (plantSec !== null) {
      const left = ROUND_SECONDS - plantSec;
      stats.timing.exactPlants += 1;
      stats.timing.plantSecLeftSum += left;
      if (left < 20) stats.timing.latePlants += 1;
    }

    // 7 · Rotasyon: hedef dışındaki koridorda erken varlık gösterildi mi?
    if (round.hit) {
      const otherSite = round.hit.site === "A" ? "B" : "A";
      const presenceSnapshots = Object.entries(round.snapshots || {})
        .filter(([second]) => Number(second) < hitSec)
        .flatMap(([, items]) => items)
        .some((item) => item.side === "T" && laneOf(item) === otherSite);
      const presenceContact = round.kills.some((kill) => kill.sec < hitSec
        && ((kill.killerSide === "T" && zoneLane(map, kill.kzone || kill.zone) === otherSite)
          || (kill.victimSide === "T" && zoneLane(map, kill.zone) === otherSite)));
      const fake = presenceSnapshots || presenceContact;
      stats.rotation[fake ? "fakeHits" : "directHits"] += 1;
      if (won) stats.rotation[fake ? "fakeWins" : "directWins"] += 1;
      if (Number.isFinite(round.ctAtHit)) {
        stats.rotation.ctAtHitSum += round.ctAtHit;
        stats.rotation.ctAtHitSamples += 1;
      }
      const setup = round.ctOnSiteAt20?.[round.hit.site];
      if (hitSec > 20 && Number.isFinite(setup)) {
        stats.rotation.ctSetupSum += setup;
        stats.rotation.ctSetupSamples += 1;
      }
    }

    // 9 · Sayı üstünlüğü
    if (round.firstKillSide === "T") {
      stats.numbers.advRounds += 1;
      if (won) stats.numbers.advWins += 1;
    } else if (round.firstKillSide === "CT") {
      stats.numbers.disRounds += 1;
      if (won) stats.numbers.disWins += 1;
    }

    // 10 · Bomba sonrası
    if (round.plant) {
      stats.postPlant.plants += 1;
      if (won) stats.postPlant.plantWins += 1;
      if (round.plant.exact) stats.postPlant.exactPlants += 1;
    }

    for (const id of selected) {
      const player = round.players[id];
      stats.space.zonesSum += Number(player.zones || 0);
      stats.space.zonesSamples += 1;
      const death = round.kills.find((kill) => kill.victim === id);
      const enemyDeath = death && death.killerSide === "CT" ? death : null;

      if (player.utility) {
        stats.utility.measuredRounds += 1;
        stats.utility.total += player.utility.total;
        stats.utility.preHit += player.utility.preHit;
        if (player.utility.total > 0) stats.utility.roundsWithUtility += 1;
        for (const type of ["smoke", "flash", "molotov", "he"]) stats.utility[type] += Number(player.utility.types?.[type] || 0);
      }

      if (!death) continue;
      if (Number.isFinite(death.unusedUtility)) {
        stats.utility.deathsMeasured += 1;
        stats.utility.unusedSum += death.unusedUtility;
        if (death.unusedUtility > 0) stats.utility.diedWithUtility += 1;
      }
      if (!enemyDeath) continue;
      // 2 · Erken ölüm
      if (enemyDeath.sec <= EARLY_DEATH_SECONDS) {
        stats.early.deaths += 1;
        if (!enemyDeath.traded) stats.early.untraded += 1;
      }
      const firstKill = round.kills.find((kill) => kill.killerSide && kill.victimSide && kill.killerSide !== kill.victimSide);
      if (firstKill === enemyDeath) stats.early.openingDeaths += 1;
      // 5 · Takas
      stats.trade.deaths += 1;
      if (enemyDeath.traded) stats.trade.traded += 1;
      if (Number.isFinite(enemyDeath.nearestTeammate)) {
        stats.trade.distanceSum += enemyDeath.nearestTeammate;
        stats.trade.distanceSamples += 1;
        if (enemyDeath.nearestTeammate > ISOLATED_DISTANCE && !enemyDeath.traded) stats.trade.isolated += 1;
      }
      // 9 · Üstünlükte gereksiz ölüm
      const beforeExecute = hitSec === null || enemyDeath.sec < hitSec;
      if (beforeExecute && !enemyDeath.traded) {
        const counts = aliveCounts(round, enemyDeath.sec - 0.1);
        if (counts.T > counts.CT) stats.numbers.advThrowDeaths += 1;
      }
      // 10 · Bomba sonrası ölüm
      if (plantSec !== null && enemyDeath.sec > plantSec) {
        stats.postPlant.deaths += 1;
        if (enemyDeath.traded) stats.postPlant.traded += 1;
      }
    }
    if (plantSec !== null) {
      stats.postPlant.kills += round.kills.filter((kill) => selected.includes(kill.killer) && kill.victimSide === "CT" && kill.sec > plantSec).length;
    }
  }
  if (counted) stats.matches = 1;
  return stats;
}

export function mergeTSideStats(list) {
  const total = emptyStats();
  const add = (target, source) => {
    for (const [key, value] of Object.entries(source || {})) {
      if (typeof value === "number" && typeof target[key] === "number") target[key] += value;
      else if (value && typeof value === "object" && target[key] && typeof target[key] === "object") add(target[key], value);
    }
  };
  for (const stats of Array.isArray(list) ? list : []) add(total, stats);
  return total;
}

function card(id, order, title, videoRule, { status, value, detail, evidence, action, sample }) {
  return { id, order, title, videoRule, status, value, detail, evidence, action, sample };
}

function statusBy(value, good, problem, higherIsBetter = true) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "nodata";
  if (higherIsBetter) return value >= good ? "good" : value < problem ? "problem" : "watch";
  return value <= good ? "good" : value > problem ? "problem" : "watch";
}

const MIN_ROUNDS = 4;

/** Sayım istatistiklerini kurala göre yorumlanmış 10 karta çevirir. */
export function summarizeTSide(stats, { scope = "player" } = {}) {
  const tRounds = stats.tRounds;
  const enough = (sample) => sample >= MIN_ROUNDS;
  const cards = [];

  const teamZones = stats.space.teamZonesRounds ? round1(stats.space.teamZonesSum / stats.space.teamZonesRounds) : null;
  const openingRate = percent(stats.space.openingWon, stats.space.openingRounds);
  cards.push(card("space", 1, "Alan al", "T'nin işi haritayı CT'den adım adım almak; kontrol edilen her bölge CT'nin tahminini zorlaştırır.", {
    status: enough(stats.space.teamZonesRounds) ? statusBy(teamZones, 3, 2) : "nodata",
    value: teamZones === null ? "—" : `${teamZones} bölge`,
    detail: "20. saniyede T'lerin bulunduğu farklı bölge sayısı (ortalama)",
    evidence: stats.space.teamZonesRounds
      ? `${stats.space.teamZonesRounds} T roundunda 20. saniyede ortalama ${teamZones} farklı bölgede bulunuldu; ilk kill %${openingRate ?? "—"} oranında T tarafının.`
      : "Rota noktası olan T roundu bulunamadı.",
    action: teamZones !== null && teamZones < 2.5
      ? "İlk 20 saniyede en az üç bölgeye (iki site koridoru + orta) birer oyuncu gönderin; tek koridorda toplanmak CT'ye bilgi bedava verir."
      : "Alan alma iyi; aldığınız bölgeleri utility ile tutup CT'nin geri almasına izin vermeyin.",
    sample: stats.space.teamZonesRounds,
  }));

  const earlyRate = percent(stats.early.deaths, tRounds);
  cards.push(card("early", 2, "Erken ölme", "İlk 15 saniyede sebepsiz ölmek roundu atmaktır; 'bu düello bana ne kazandırır?' diye sor.", {
    status: enough(tRounds) ? statusBy(earlyRate, 8, 15, false) : "nodata",
    value: earlyRate === null ? "—" : `%${earlyRate}`,
    detail: `T roundlarında ilk ${EARLY_DEATH_SECONDS} saniyede ölüm oranı`,
    evidence: `${tRounds} T roundunda ${stats.early.deaths} erken ölüm; ${stats.early.untraded} tanesi takaslanmadı, ${stats.early.openingDeaths} tanesi roundun ilk ölümüydü.`,
    action: stats.early.deaths > 0
      ? "Round başında AWP'ye veya tutulan açıya kuru peek atma. Alan almak için utility bekle ya da takas edecek arkadaşla birlikte çık."
      : "Round başı disiplinin sağlam; erken bilgiyi canlı kalarak topluyorsun.",
    sample: tRounds,
  }));

  const structured = stats.structure.spread + stats.structure.stack + stats.structure.passive;
  const spreadShare = percent(stats.structure.spread, structured);
  const spreadWin = percent(stats.structure.spreadWins, stats.structure.spread);
  const stackWin = percent(stats.structure.stackWins, stats.structure.stack);
  const rushWin = percent(stats.structure.rushWins, stats.structure.rush);
  cards.push(card("default", 3, "Default oyna", "Default beklemek değil; haritaya yayılıp birden fazla bölgeye baskı yapmak, bilgi toplamak ve CT utility'sini harcatmaktır.", {
    status: enough(structured) ? statusBy(spreadShare, 50, 30) : "nodata",
    value: spreadShare === null ? "—" : `%${spreadShare}`,
    detail: "Rush olmayan roundlarda 20. saniyede en az iki koridora yayılma oranı",
    evidence: `Yayılmış default ${stats.structure.spread} round (kazanma %${spreadWin ?? "—"}), tek koridor ${stats.structure.stack} round (%${stackWin ?? "—"}), pasif ${stats.structure.passive} round, rush ${stats.structure.rush} round (%${rushWin ?? "—"}).`,
    action: spreadShare !== null && spreadShare < 50
      ? "Round başında A, orta ve B'ye en az birer oyuncu dağıtın. CT'nin agresifliğini ve utility kullanımını izleyip hücum yerini sonra seçin."
      : "Default yapınız var; topladığınız bilgiyi (agresif CT, erken utility) not edip sonraki roundlarda cezalandırın.",
    sample: structured,
  }));

  const utilityRounds = stats.utility.measuredRounds;
  const utilityPerRound = utilityRounds ? round1(stats.utility.total / utilityRounds) : null;
  const preHitShare = percent(stats.utility.preHit, stats.utility.total);
  const diedWithUtility = percent(stats.utility.diedWithUtility, stats.utility.deathsMeasured);
  cards.push(card("utility", 4, "Amaçlı utility", "Lineup ezberi yetmez; her bombanın bir problemi çözmesi gerekir. CT'ye utility'sini erken harcatmak da güçlüdür.", {
    status: !enough(utilityRounds) ? "nodata"
      : diedWithUtility !== null && diedWithUtility >= 45 ? "problem"
        : statusBy(utilityPerRound, 1.5, 0.8),
    value: utilityPerRound === null ? "—" : `${utilityPerRound} / round`,
    detail: "T roundu başına atılan utility",
    evidence: utilityRounds
      ? `${utilityRounds} ölçülen T roundunda ${stats.utility.total} utility (${stats.utility.smoke} smoke, ${stats.utility.flash} flash, ${stats.utility.molotov} molotov, ${stats.utility.he} HE); %${preHitShare ?? "—"}'i siteye girmeden önce atıldı.${diedWithUtility !== null ? ` Ölümlerin %${diedWithUtility}'inde elde kullanılmamış utility vardı.` : ""}`
      : "Bu ölçüm yeni analiz sürümüyle gelir; demo yeniden analiz edildiğinde dolar.",
    action: diedWithUtility !== null && diedWithUtility >= 30
      ? "Elinde utility varken ölmek boşa harcanmış paradır. AWP'yi smoke'la kes, yakın köşeye molotov at, arkadaşın peek atarken flash ver."
      : "Utility'yi siteye girmeden önce, bir açıyı çözmek için kullanın; 'TikTok lineup' yerine o roundun problemine göre seçin.",
    sample: utilityRounds,
  }));

  const tradeRate = percent(stats.trade.traded, stats.trade.deaths);
  const isolatedRate = percent(stats.trade.isolated, stats.trade.deaths);
  const avgDistance = stats.trade.distanceSamples ? Math.round(stats.trade.distanceSum / stats.trade.distanceSamples) : null;
  cards.push(card("trade", 5, "Takas mesafesi", "'Bu arkadaşım şimdi ölse onu takaslayabilir miyim?' Cevap hayırsa çok uzaktasın.", {
    status: enough(stats.trade.deaths) ? statusBy(tradeRate, 50, 30) : "nodata",
    value: tradeRate === null ? "—" : `%${tradeRate}`,
    detail: "T tarafında takaslanan ölüm oranı",
    evidence: `${stats.trade.deaths} T ölümünün ${stats.trade.traded} tanesi takaslandı; ${stats.trade.isolated} ölüm (%${isolatedRate ?? "—"}) en yakın takım arkadaşı ${ISOLATED_DISTANCE} birimden uzaktayken ve takassız oldu. Ortalama en yakın arkadaş mesafesi ${avgDistance ?? "—"} birim.`,
    action: tradeRate !== null && tradeRate < 50
      ? "Alan alırken ve site girerken entry ile trader arasında en fazla birkaç adım bırakın. 5v5'in 4v4 olması sorun değil, tek başına ölüp 4v5 olmak sorun."
      : "Takas mesafen iyi; aynı disiplini post-plant pozisyonlarında da koru.",
    sample: stats.trade.deaths,
  }));

  const avgHit = stats.timing.hits ? round1(stats.timing.hitSecSum / stats.timing.hits) : null;
  const lateShare = percent(stats.timing.lateHits + stats.timing.timeRanOut, tRounds);
  const avgPlantLeft = stats.timing.exactPlants ? round1(stats.timing.plantSecLeftSum / stats.timing.exactPlants) : null;
  cards.push(card("timing", 6, "Son saniye execute yapma", "Default bir yere varmalı. Kill aldığınız tarafa hemen yüklenin; 18 saniye kala 'A, A, A' demeyin.", {
    status: enough(tRounds) ? statusBy(lateShare, 8, 15, false) : "nodata",
    value: lateShare === null ? "—" : `%${lateShare}`,
    detail: `Siteye son ${LATE_HIT_SECONDS_LEFT} saniyede girilen veya süre biten T roundları`,
    evidence: `Siteye ortalama ${avgHit ?? "—"}. saniyede girildi; ${stats.timing.lateHits} geç giriş, ${stats.timing.timeRanOut} round süre bitti.${avgPlantLeft !== null ? ` Bomba kurulduğunda ortalama ${avgPlantLeft} saniye kalıyordu (${stats.timing.latePlants} kurulum 20 saniyenin altında).` : ""}`,
    action: lateShare !== null && lateShare > 8
      ? "1:00'a kadar karar verin. İlk kill hangi tarafta alındıysa oraya yüklenin; bilgi toplandıysa beklemeye devam etmek CT'ye zaman kazandırır."
      : "Karar zamanlamanız iyi; geç roundlarda bile siteye yeterli süreyle giriyorsunuz.",
    sample: tRounds,
  }));

  const fakeShare = percent(stats.rotation.fakeHits, stats.rotation.fakeHits + stats.rotation.directHits);
  const fakeWin = percent(stats.rotation.fakeWins, stats.rotation.fakeHits);
  const directWin = percent(stats.rotation.directWins, stats.rotation.directHits);
  const ctAtHit = stats.rotation.ctAtHitSamples ? round1(stats.rotation.ctAtHitSum / stats.rotation.ctAtHitSamples) : null;
  const ctSetup = stats.rotation.ctSetupSamples ? round1(stats.rotation.ctSetupSum / stats.rotation.ctSetupSamples) : null;
  const hits = stats.rotation.fakeHits + stats.rotation.directHits;
  cards.push(card("rotation", 7, "Rotasyonu oku", "Her baskı execute değildir. Bir tarafta ses ve utility ile CT'yi rotate ettirip boşalan tarafı cezalandırın.", {
    status: !enough(hits) ? "nodata"
      : fakeShare !== null && fakeShare < 15 ? "watch"
        : fakeWin !== null && directWin !== null && fakeWin + 5 < directWin ? "watch" : "good",
    value: fakeShare === null ? "—" : `%${fakeShare}`,
    detail: "Diğer koridorda önce varlık gösterilip sonra vurulan site oranı",
    evidence: `${hits} site girişinin ${stats.rotation.fakeHits} tanesi önce diğer koridorda baskıyla başladı (kazanma %${fakeWin ?? "—"}); doğrudan giriş %${directWin ?? "—"}. Girilen sitede 20. saniyede ${ctSetup ?? "—"}, giriş anında ${ctAtHit ?? "—"} CT vardı.`,
    action: fakeShare !== null && fakeShare < 20
      ? "Bir koridorda utility ve ses yapın, bir kill alın, sonra zıt siteye bağlanın. Rotasyon çağrısını duyduğunuz an boşalan tarafa yüklenin."
      : "Baskı-rotasyon oyununu kullanıyorsunuz; CT'nin hangi oyuncusunun rotate ettiğini not edip aynı fake'i tekrar kullanın.",
    sample: hits,
  }));

  const tempoTotal = stats.tempo.fast + stats.tempo.medium + stats.tempo.slow;
  const tempoMax = tempoTotal ? Math.max(stats.tempo.fast, stats.tempo.medium, stats.tempo.slow) : 0;
  const siteMax = Math.max(stats.tempo.siteA, stats.tempo.siteB);
  const tempoShare = percent(tempoMax, tempoTotal);
  const siteShare = percent(siteMax, stats.tempo.siteA + stats.tempo.siteB);
  const predictability = tempoShare === null ? null : Math.max(tempoShare, siteShare ?? 0);
  cards.push(card("tempo", 8, "Tempoyu değiştir", "Hep default, hep rush ya da hep aynı site oynarsanız CT adapte olur. CT her round 'bu sefer ne yapacaklar?' diye düşünmeli.", {
    status: enough(tempoTotal) ? statusBy(predictability, 65, 80, false) : "nodata",
    value: predictability === null ? "—" : `%${predictability}`,
    detail: "Öngörülebilirlik: en sık tempo veya site seçiminin payı",
    evidence: `Hızlı (<30 sn) ${stats.tempo.fast}, orta ${stats.tempo.medium}, yavaş (>65 sn) ${stats.tempo.slow} giriş; A ${stats.tempo.siteA} / B ${stats.tempo.siteB}. Ardışık roundlarda site değiştirme %${percent(stats.tempo.switches, stats.tempo.sequenceSamples) ?? "—"}.`,
    action: predictability !== null && predictability >= 65
      ? "Bir round çok yavaş oynayın, sonraki round mid'e patlayın, sonra B fake A bitirin. Aynı yapıyı üst üste iki kez kullanmayın."
      : "Tempo çeşitliliğiniz iyi; CT'yi tahmin etmeye zorluyorsunuz.",
    sample: tempoTotal,
  }));

  const advWin = percent(stats.numbers.advWins, stats.numbers.advRounds);
  const disWin = percent(stats.numbers.disWins, stats.numbers.disRounds);
  cards.push(card("numbers", 9, "Sayı üstünlüğünü anla", "5v4'te çılgın bir oyun gerekmez: alan alın, toplanın, takaslayın. 4v5'te ise risk alıp açılış yaratmak gerekir.", {
    status: enough(stats.numbers.advRounds) ? statusBy(advWin, 75, 60) : "nodata",
    value: advWin === null ? "—" : `%${advWin}`,
    detail: "İlk kill'i T aldığında round kazanma oranı",
    evidence: `İlk kill T'de: ${stats.numbers.advRounds} round, kazanma %${advWin ?? "—"}. İlk kill CT'de: ${stats.numbers.disRounds} round, kazanma %${disWin ?? "—"}. Üstünlükteyken siteye girmeden takassız ${stats.numbers.advThrowDeaths} ölüm.`,
    action: advWin !== null && advWin < 75
      ? "Sayı üstünlüğünde tek başına avlanmayın. Toplanın, utility ile siteyi alın, birbirinizi takaslayın; zaman CT'nin değil sizin lehinize."
      : "Üstünlüğü iyi değerlendiriyorsunuz; dezavantajda ise grup halinde patlamayı deneyin.",
    sample: stats.numbers.advRounds,
  }));

  const plantWin = percent(stats.postPlant.plantWins, stats.postPlant.plants);
  const postTradeRate = percent(stats.postPlant.traded, stats.postPlant.deaths);
  cards.push(card("postPlant", 10, "Bomba kurulunca round bitmez", "Kurulumdan sonra CT gelmek zorunda. Çapraz pozisyon alın, bomba için oynayın; hayatta kalmak çoğu zaman kill'den değerli.", {
    status: enough(stats.postPlant.plants) ? statusBy(plantWin, 65, 50) : "nodata",
    value: plantWin === null ? "—" : `%${plantWin}`,
    detail: stats.postPlant.exactPlants ? "Bomba kurulan roundlarda kazanma oranı" : "Bomba kurulan roundlarda kazanma oranı (yaklaşık)",
    evidence: `${stats.postPlant.plants} kurulumda %${plantWin ?? "—"} kazanıldı.${stats.postPlant.exactPlants ? ` Kesin kurulum zamanı olan ${stats.postPlant.exactPlants} roundda kurulum sonrası ${stats.postPlant.deaths} ölüm (%${postTradeRate ?? "—"} takaslı), ${stats.postPlant.kills} kill.` : " Eski analizlerde kurulum yalnız patlama/imha sonucundan çıkarıldı."}`,
    action: plantWin !== null && plantWin < 65
      ? "Bomba kurulduktan sonra kill aramaya koşmayın. Bombayı gören, birbirini takaslayan iki pozisyon alın ve CT'yi birden fazla açıyı temizlemeye zorlayın."
      : "Post-plant oyununuz sağlam; kurulum sonrası pozisyonlarınızı aynı şekilde koruyun.",
    sample: stats.postPlant.plants,
  }));

  const scored = cards.filter((item) => item.status !== "nodata");
  const score = scored.length
    ? Math.round(scored.reduce((sum, item) => sum + (item.status === "good" ? 100 : item.status === "watch" ? 60 : 25), 0) / scored.length)
    : null;
  const priorities = cards.filter((item) => item.status === "problem").map((item) => item.id);
  return {
    method: T_SIDE_METHOD,
    scope,
    tRounds,
    tWinRate: percent(stats.tWins, tRounds),
    matches: stats.matches,
    score,
    priorities,
    cards,
  };
}

/** Tek bir maç analizine her oyuncunun T tarafı raporunu ekler (yerinde). */
export function attachTSideReports(analysis, mapName = "") {
  if (!analysis || !Array.isArray(analysis.reports)) return analysis;
  let timeline = null;
  try {
    timeline = buildRoundTimeline(analysis, mapName);
  } catch {
    return analysis;
  }
  for (const report of analysis.reports) {
    const id = playerId(report?.player);
    if (!id) continue;
    const stats = buildTSideStats(timeline, [id]);
    report.tSide = { ...summarizeTSide(stats, { scope: "player" }), stats };
  }
  return analysis;
}
