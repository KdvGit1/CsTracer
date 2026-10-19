// T tarafı strateji önerisi: kim nereye gider, kim kimi takaslar, kaçıncı
// saniyede siteye girilir, smoke/molotov/flash nereye atılır. Hepsi demo
// verisinden türetilir: oyuncuların kendi T geçmişi ve rakip CT'lerin round
// başında gerçekten durduğu açılar (konum kümeleri).
import { findOwnerTeam, normalizeMapName, normalizeSteamId, selectionSteamIds } from "./identity.mjs";
import { zoneLane } from "./maps.mjs";

const round1 = (value) => Math.round(Number(value || 0) * 10) / 10;
const percent = (part, total) => (total > 0 ? Math.round((part / total) * 100) : 0);
export const PLAYER_COLORS = ["#C8F54D", "#4FD1FF", "#FF9C4D", "#FF6FAE", "#B48CFF"];
const SLOT_ORDER = ["entry", "trader", "support", "second", "lurker"];
const SLOT_LABELS = { entry: "Entry", trader: "Trader", support: "Support", second: "İkinci kol", lurker: "Lurker", faker: "Fake" };
const MIN_SITE_HITS = 3;

const dative = (site) => (site === "A" ? "A'ya" : "B'ye");
const locative = (site) => (site === "A" ? "A'da" : "B'de");

function snapshot(round, second) {
  return round.snapshots?.[second] || round.snapshots?.[String(second)] || null;
}

function isNeutral(zone) {
  return !zone || /bilinmeyen/i.test(zone);
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function ownIds(match, ownerSteamId, roster) {
  const team = findOwnerTeam(match, ownerSteamId, roster);
  return new Set((team?.players || []).map((player) => normalizeSteamId(player?.steamid)).filter(Boolean));
}

function mapMatches(matches, map) {
  const wanted = normalizeMapName(map);
  return (Array.isArray(matches) ? matches : []).filter((match) => normalizeMapName(match?.map) === wanted && match?.timeline?.rounds?.length);
}

/** Her bölgenin ortalama konumu (radar işaretleri ve rota çizgileri için). */
export function zoneCentroids(matches) {
  const sums = new Map();
  const add = (zone, x, y) => {
    if (isNeutral(zone) || !Number.isFinite(x) || !Number.isFinite(y)) return;
    const entry = sums.get(zone) || { x: 0, y: 0, n: 0 };
    entry.x += x;
    entry.y += y;
    entry.n += 1;
    sums.set(zone, entry);
  };
  for (const match of matches) {
    for (const round of match.timeline.rounds) {
      for (const items of Object.values(round.snapshots || {})) for (const item of items) add(item.zone, item.x, item.y);
      for (const kill of round.kills || []) add(kill.zone, kill.x, kill.y);
    }
  }
  return new Map([...sums].filter(([, value]) => value.n >= 3).map(([zone, value]) => [zone, { zone, x: Math.round(value.x / value.n), y: Math.round(value.y / value.n) }]));
}

/** Seçili oyuncuların T geçmişi: koridor alışkanlığı, açılış düelloları, takaslar. */
export function buildPlayerProfiles(matches, roster, map) {
  const players = (Array.isArray(roster) ? roster : []).map((player) => ({ steamid: normalizeSteamId(player?.steamid), name: String(player?.name || "") })).filter((player) => player.steamid);
  const stats = new Map(players.map((player) => [player.steamid, {
    ...player, tRounds: 0, laneCounts: { A: 0, B: 0, mid: 0 }, zoneCounts: new Map(), laneSamples: 0,
    openingKills: 0, openingDeaths: 0, deaths: 0, tradedDeaths: 0, kills: 0, tradeKills: 0, survived: 0,
  }]));
  const mapKey = normalizeMapName(map);
  for (const match of mapMatches(matches, map)) {
    for (const round of match.timeline.rounds) {
      const kills = [...(round.kills || [])].sort((a, b) => a.sec - b.sec);
      const firstKill = kills.find((kill) => kill.killerSide && kill.victimSide && kill.killerSide !== kill.victimSide);
      for (const [id, entry] of stats) {
        if (round.players?.[id]?.side !== "T") continue;
        entry.tRounds += 1;
        const at20 = (snapshot(round, 20) || []).find((item) => item.id === id);
        if (at20 && !isNeutral(at20.zone)) {
          const lane = zoneLane(mapKey, at20.zone);
          if (lane === "A" || lane === "B" || lane === "mid") {
            entry.laneCounts[lane] += 1;
            entry.laneSamples += 1;
          }
          entry.zoneCounts.set(at20.zone, (entry.zoneCounts.get(at20.zone) || 0) + 1);
        }
        if (firstKill?.killer === id) entry.openingKills += 1;
        if (firstKill?.victim === id) entry.openingDeaths += 1;
        const death = kills.find((kill) => kill.victim === id && kill.killerSide === "CT");
        if (death) {
          entry.deaths += 1;
          if (death.traded) entry.tradedDeaths += 1;
        } else {
          entry.survived += 1;
        }
        for (const kill of kills) {
          if (kill.killer !== id || kill.victimSide !== "CT") continue;
          entry.kills += 1;
          // Takas kill: bu CT birkaç saniye önce bir T takım arkadaşını öldürmüştü.
          if (kills.some((other) => other.killer === kill.victim && other.victimSide === "T" && kill.sec - other.sec >= 0 && kill.sec - other.sec <= 5)) entry.tradeKills += 1;
        }
      }
    }
  }
  return [...stats.values()].map((entry) => {
    const lanes = entry.laneSamples || 1;
    const duels = entry.openingKills + entry.openingDeaths;
    return {
      steamid: entry.steamid,
      name: entry.name,
      tRounds: entry.tRounds,
      laneShare: { A: round1(entry.laneCounts.A / lanes), B: round1(entry.laneCounts.B / lanes), mid: round1(entry.laneCounts.mid / lanes) },
      topZones: [...entry.zoneCounts].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([zone, count]) => ({ zone, share: percent(count, entry.laneSamples) })),
      openingKillRate: round1(entry.openingKills / Math.max(1, entry.tRounds)),
      openingDeathRate: round1(entry.openingDeaths / Math.max(1, entry.tRounds)),
      openingDuelWin: duels ? round1(entry.openingKills / duels) : 0.5,
      tradeKillRate: round1(entry.tradeKills / Math.max(1, entry.tRounds)),
      killsPerRound: round1(entry.kills / Math.max(1, entry.tRounds)),
      survivalRate: round1(entry.survived / Math.max(1, entry.tRounds)),
      tradedDeathRate: entry.deaths ? round1(entry.tradedDeaths / entry.deaths) : 0,
    };
  });
}

// Belirlenimci k-ortalamalar: en uzak noktadan başlatılır, aynı veride aynı sonuç.
export function clusterPoints(points, k) {
  if (!points.length) return [];
  const centers = [{ x: points[0].x, y: points[0].y }];
  while (centers.length < Math.min(k, points.length)) {
    const farthest = points.reduce((best, point) => {
      const nearest = Math.min(...centers.map((center) => distance(center, point)));
      return nearest > best.d ? { point, d: nearest } : best;
    }, { point: null, d: -1 });
    if (!farthest.point || farthest.d < 120) break;
    centers.push({ x: farthest.point.x, y: farthest.point.y });
  }
  let assignment = [];
  for (let iteration = 0; iteration < 12; iteration++) {
    assignment = points.map((point) => centers.reduce((best, center, index) => (distance(center, point) < distance(centers[best], point) ? index : best), 0));
    centers.forEach((center, index) => {
      const members = points.filter((_, pointIndex) => assignment[pointIndex] === index);
      if (members.length) {
        center.x = members.reduce((sum, point) => sum + point.x, 0) / members.length;
        center.y = members.reduce((sum, point) => sum + point.y, 0) / members.length;
      }
    });
  }
  return centers.map((center, index) => ({ x: Math.round(center.x), y: Math.round(center.y), members: points.filter((_, pointIndex) => assignment[pointIndex] === index) }));
}

/** Rakip CT'lerin 20. saniyede sitede tuttuğu açılar (konum kümeleri). */
export function siteAngles(matches, map, site, { ownerSteamId = "", roster = [], excludeZones = [], onlyZones = null, second = 20, maxClusters = 3 } = {}) {
  const excluded = new Set(excludeZones);
  const only = onlyZones ? new Set(onlyZones) : null;
  const mapKey = normalizeMapName(map);
  const points = [];
  let measured = 0;
  for (const match of mapMatches(matches, map)) {
    const own = ownIds(match, ownerSteamId, roster);
    for (const [roundIndex, round] of match.timeline.rounds.entries()) {
      const tIds = Object.keys(round.players || {}).filter((id) => round.players[id].side === "T");
      if (own.size && !tIds.some((id) => own.has(id))) continue;
      if (round.hit && round.hit.sec < second) continue;
      const items = snapshot(round, second);
      if (!items) continue;
      measured += 1;
      for (const item of items) {
        if (item.side !== "CT" || excluded.has(item.zone) || (only && !only.has(item.zone))) continue;
        if (only || zoneLane(mapKey, item.zone) === site) points.push({ x: item.x, y: item.y, zone: item.zone, key: `${match.id}:${roundIndex}` });
      }
    }
  }
  const clusters = clusterPoints(points, maxClusters).filter((cluster) => cluster.members.length >= 2);
  return clusters.map((cluster) => {
    const zones = new Map();
    for (const member of cluster.members) zones.set(member.zone, (zones.get(member.zone) || 0) + 1);
    return {
      x: cluster.x,
      y: cluster.y,
      zone: [...zones].sort((a, b) => b[1] - a[1])[0][0],
      share: percent(new Set(cluster.members.map((member) => member.key)).size, measured),
    };
  }).sort((a, b) => b.share - a.share);
}

/**
 * Siteye giden roundlarda T'lerin uğradığı bölgelerin en sık görülen sırası.
 * `accept` hangi dizilerin aranan rotaya ait olduğunu belirler.
 */
export function commonZonePath(matches, map, site, accept) {
  const counts = new Map();
  for (const match of mapMatches(matches, map)) {
    for (const round of match.timeline.rounds) {
      if (round.hit?.site !== site) continue;
      for (const player of Object.values(round.players || {})) {
        if (player.side !== "T" || !player.visits?.length) continue;
        const zones = player.visits.map((visit) => visit.zone).filter((zone) => !isNeutral(zone));
        const sequence = zones.filter((zone, index) => zones.indexOf(zone) === index).slice(0, 6);
        if (sequence.length < 1 || !accept(sequence)) continue;
        const key = sequence.join(">");
        counts.set(key, (counts.get(key) || 0) + 1);
      }
    }
  }
  const best = [...counts].sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)[0];
  return best ? best[0].split(">") : [];
}

function sideWord(entry, center, point) {
  // Saldırganın girişten siteye bakışına göre sol/sağ (dünya koordinatı: y yukarı).
  const cross = (center.x - entry.x) * (point.y - entry.y) - (center.y - entry.y) * (point.x - entry.x);
  const depth = distance(entry, point) - distance(entry, center);
  if (depth > 350) return "derin";
  return cross > 0 ? "sol" : "sağ";
}

function bestUniqueAssignment(players, slots, scoreFn) {
  let best = null;
  const visit = (slotIndex, used, picks, score) => {
    if (slotIndex >= slots.length) {
      if (!best || score > best.score) best = { score, picks };
      return;
    }
    for (const player of players) {
      if (used.has(player.steamid)) continue;
      const next = new Set(used).add(player.steamid);
      visit(slotIndex + 1, next, [...picks, player], score + scoreFn(player, slots[slotIndex]));
    }
  };
  visit(0, new Set(), [], 0);
  return best?.picks || [];
}

function slotScore(player, slot, site, otherSite) {
  const lane = player.laneShare || {};
  switch (slot) {
    case "entry": return player.openingDuelWin * 60 + player.openingKillRate * 120 + (lane[site] || 0) * 30;
    case "trader": return player.tradeKillRate * 160 + player.killsPerRound * 25 + (lane[site] || 0) * 30;
    case "support": return player.survivalRate * 50 + (lane[site] || 0) * 30 - player.openingDeathRate * 40;
    case "second": return (lane.mid || 0) * 60 + player.killsPerRound * 20;
    case "lurker": return (lane[otherSite] || 0) * 60 + player.survivalRate * 30;
    default: return 0;
  }
}

function point(zoneOrPoint) {
  return zoneOrPoint && Number.isFinite(zoneOrPoint.x) ? { x: zoneOrPoint.x, y: zoneOrPoint.y, zone: zoneOrPoint.zone || "" } : null;
}

function lerp(a, b, t) {
  return { x: Math.round(a.x + (b.x - a.x) * t), y: Math.round(a.y + (b.y - a.y) * t) };
}

/**
 * Site başına (ve bir fake varyantı) önerilen stratejileri üretir. Oyuncu
 * sayısı 3–5 arasında olabilir; az oyuncuda lurker ve ikinci kol düşer.
 */
export function buildStrategies({ matches, roster, map, tactical, ownerSteamId = "" }) {
  const mapKey = normalizeMapName(map);
  const selected = selectionSteamIds(roster);
  const pool = mapMatches(matches, map);
  if (!tactical?.sites || !selected.length || !pool.length) return [];
  const centroids = zoneCentroids(pool);
  const profiles = buildPlayerProfiles(pool, roster, map);
  const tSpawn = centroids.get("T Spawn") || null;
  const ctSpawn = centroids.get("CT Spawn") || null;
  const strategies = [];

  const ready = ["A", "B"].filter((site) => tactical.sites[site]?.samples >= MIN_SITE_HITS && tactical.sites[site].route?.length);
  const weakness = (site) => (tactical.sites[site].adjustedWinRate || 50) - (Number(tactical.sites[site].avgCtSetup) || 1.5) * 10;
  const ordered = [...ready].sort((a, b) => weakness(b) - weakness(a));

  const build = (site, fakeFrom = null) => {
    const otherSite = site === "A" ? "B" : "A";
    const info = tactical.sites[site];
    const siteCenter = point(info.siteCenter) || point(centroids.get(`${site} Site`));
    if (!siteCenter) return null;
    const route = info.route.map((zone) => point(zone)).filter(Boolean);
    const laneRoute = route.filter((zone) => zoneLane(mapKey, zone.zone) === site);
    const midRoute = route.filter((zone) => zoneLane(mapKey, zone.zone) === "mid");
    const entryPoint = laneRoute.at(-1) || route.at(-1) || tSpawn;
    if (!entryPoint) return null;
    // Site açıları T rotası dışındaki CT konumlarıdır; rotadaki CT'ler "agresif" sayılır.
    const routeZoneNames = route.map((zone) => zone.zone);
    let angles = siteAngles(pool, map, site, { ownerSteamId, roster, excludeZones: routeZoneNames });
    if (!angles.length) angles = siteAngles(pool, map, site, { ownerSteamId, roster });
    angles = angles.map((angle) => ({ ...angle, side: sideWord(entryPoint, siteCenter, angle) }));
    const aggression = siteAngles(pool, map, site, { ownerSteamId, roster, onlyZones: routeZoneNames, second: 12, maxClusters: 1 })[0] || null;
    const byDistance = [...angles].sort((a, b) => distance(entryPoint, a) - distance(entryPoint, b));
    const near = byDistance[0] || null;
    const far = byDistance.length > 1 ? byDistance.at(-1) : null;
    const middle = byDistance.length > 2 ? byDistance[1] : null;
    const hit = Math.min(75, Math.max(35, Number(info.hitSecond) || 50));
    const otherFirst = point(tactical.sites[otherSite]?.route?.[0]);

    const slotCount = Math.min(selected.length, 5);
    // İkinci kol için orta/diğer koridor yoksa o rol atlanır, sayı lurker ile tamamlanır.
    const available = SLOT_ORDER.filter((slot) => slot !== "second" || midRoute.length || otherFirst);
    const slots = available.slice(0, slotCount);
    const picks = bestUniqueAssignment(profiles, slots, (player, slot) => slotScore(player, slot, site, otherSite));
    const byslot = Object.fromEntries(slots.map((slot, index) => [slot, picks[index]]));

    // Rotalar oyuncuların gerçekte uğradığı bölgelerin en sık sırasından çizilir.
    const laneOf = (zone) => zoneLane(mapKey, zone);
    const toPoints = (zones) => zones.map((zone) => point(centroids.get(zone))).filter(Boolean);
    const mainZones = commonZonePath(pool, map, site, (sequence) => laneOf(sequence.at(-1)) === site && !sequence.some((zone) => laneOf(zone) === otherSite));
    // İkinci kol, ana grubun kullanmadığı bir orta bölgeden gelir (ör. Top Mid → Arch).
    const midZones = commonZonePath(pool, map, site, (sequence) => sequence.some((zone) => laneOf(zone) === "mid" && !mainZones.includes(zone)) && [site, "mid"].includes(laneOf(sequence.at(-1))) && !sequence.some((zone) => laneOf(zone) === otherSite));
    const lurkZones = commonZonePath(pool, map, site, (sequence) => laneOf(sequence.at(-1)) === otherSite);
    const fallbackBase = route.filter((zone) => laneOf(zone.zone) !== "mid");
    const base = [tSpawn, ...(mainZones.length ? toPoints(mainZones) : fallbackBase)].filter(Boolean);
    const describe = (angle) => (angle ? `${angle.zone} ${angle.side} (CT %${angle.share})` : "ilk açı");
    const players = [];
    const add = (slot, path, task, extra = {}) => {
      const profile = byslot[slot];
      if (!profile) return;
      players.push({
        slot,
        role: SLOT_LABELS[slot],
        steamid: profile.steamid,
        name: profile.name,
        color: PLAYER_COLORS[players.length % PLAYER_COLORS.length],
        path: path.filter(Boolean).map((item) => ({ x: item.x, y: item.y, zone: item.zone || "" })),
        task,
        why: whyText(slot, profile, site),
        ...extra,
      });
    };

    add("entry", [...base, near || siteCenter], `${hit}. saniyede ilk giren. Önce ${describe(near)} köşesini temizle.`, { tradeWith: "trader" });
    add("trader", [...base, lerp(entryPoint, middle || far || siteCenter, 0.8)], `Entry'nin 1–2 adım arkasında kal; entry düşerse aynı açıyı hemen takasla. Sonra ${describe(middle || far)} açısını al.`);
    add("support", [...base, entryPoint], `${hit - 4}. saniyede utility'leri at, sonra entry'nin arkasından siteye gir.`);
    if (byslot.second) {
      const midPoints = midZones.length ? toPoints(midZones) : midRoute;
      const secondPath = midRoute.length ? [tSpawn, ...midPoints, far || siteCenter] : [...base, far || siteCenter];
      add("second", secondPath, midRoute.length
        ? `${(midZones.length ? midZones.filter((zone) => !mainZones.includes(zone)) : midRoute.map((zone) => zone.zone)).join(" → ")} kontrolünü al; execute anında ${describe(far)} tarafından siteyi ikinci koldan sıkıştır.`
        : `Ana grupla 4. kişi olarak gir; ${describe(far)} açısını al ve entry ile trader'ı arkadan koru.`);
    }
    if (byslot.lurker) {
      const lurkPoints = lurkZones.length ? toPoints(lurkZones) : [otherFirst || centroids.get("Middle")];
      const lurkPoint = lurkPoints.at(-1);
      add("lurker", [tSpawn, ...lurkPoints], fakeFrom
        ? `${fakeFrom} tarafında ses ve utility ile fake yap; ${hit - 10}. saniyeye kadar orada kal, sonra rotasyonu çağırıp ${dative(site)} doğru takip et.`
        : `${lurkPoint?.zone || otherSite} tarafında bilgi topla; rotasyon görürsen çağır, CT'ler ${dative(site)} dönerse arkadan kes.`);
    }

    // Utility: uzak/derin açıya smoke, yakın köşeye molotov, girişe flash, CT rotasyon yoluna smoke.
    const support = players.find((player) => player.slot === "support");
    const trader = players.find((player) => player.slot === "trader");
    const second = players.find((player) => player.slot === "second");
    const utility = [];
    const addUtility = (kind, target, label, thrower, time) => {
      if (!target) return;
      utility.push({ kind, x: target.x, y: target.y, label, thrower: thrower?.name || "", throwerColor: thrower?.color || "", time });
    };
    // Rotadaki agresif CT'ye molotovu o bölgeden geçen oyuncu atar.
    const aggressionThrower = aggression ? players.find((player) => player.slot !== "entry" && player.path.some((step) => step.zone === aggression.zone)) || support : null;
    if (aggression) addUtility("molotov", aggression, `${aggression.zone}: agresif CT (CT %${aggression.share})`, aggressionThrower, 10);
    // CT geliş yolu derin açıdan geçiyorsa tek smoke ikisini de kapatır.
    const rotationPoint = ctSpawn ? lerp(siteCenter, ctSpawn, 0.45) : null;
    const rotationCovered = rotationPoint && far && distance(rotationPoint, far) < 450;
    if (rotationPoint && !rotationCovered) addUtility("smoke", rotationPoint, "CT rotasyon yolu", support, hit - 4);
    if (far) addUtility("smoke", far, `${far.zone} ${far.side} açısı${rotationCovered ? " + CT rotasyonu" : ""}`, second || support, hit - 4);
    if (near) addUtility("molotov", near, `${near.zone} ${near.side} köşesi`, trader || support, hit - 4);
    addUtility("flash", lerp(entryPoint, siteCenter, 0.45), "Giriş flash'ı (entry'ye)", support, hit - 1);
    if (fakeFrom) {
      const fakeTarget = point(tactical.sites[fakeFrom]?.route?.at(-1)) || point(tactical.sites[fakeFrom]?.siteCenter);
      const faker = players.find((player) => player.slot === "lurker") || support;
      if (fakeTarget) addUtility("molotov", fakeTarget, `${fakeFrom} fake molotovu`, faker, 15);
    }
    const plant = info.plant ? { x: info.plant.x, y: info.plant.y, exact: info.plant.exact } : siteCenter;

    const evidence = {
      winRate: info.winRate,
      samples: info.samples,
      avgCtSetup: info.avgCtSetup,
      hitSecond: info.hitSecond,
      angles: angles.map((angle) => ({ zone: angle.zone, side: angle.side, share: angle.share })),
    };
    const takeZones = route.filter((zone) => zoneLane(mapKey, zone.zone) !== "mid").map((zone) => zone.zone);
    return {
      id: fakeFrom ? `fake_${fakeFrom}_${site}` : `exec_${site}`,
      site,
      fakeFrom,
      title: fakeFrom ? `${fakeFrom} fake → ${site} execute` : `${takeZones[0] || site} → ${site} execute`,
      summary: fakeFrom
        ? `${locative(fakeFrom)} ses yapıp CT'yi rotate ettir, ${hit}. saniyede ${dative(site)} gir.`
        : `${takeZones.join(" → ") || site} üzerinden alanı al, ${hit}. saniyede ${dative(site)} takaslı gir.`,
      timing: { take: [0, 20], utility: hit - 4, execute: hit, plantBy: Math.min(hit + 18, 90) },
      players,
      utility,
      angles,
      aggression,
      plant,
      evidence,
    };
  };

  for (const site of ordered) {
    const strategy = build(site);
    if (strategy) strategies.push(strategy);
  }
  if (ordered.length === 2) {
    const fake = build(ordered[0], ordered[1]);
    if (fake) strategies.push(fake);
  }
  return strategies.map((strategy, index) => ({ ...strategy, recommended: index === 0 }));
}

function whyText(slot, profile, site) {
  const lane = Math.round((profile.laneShare?.[site] || 0) * 100);
  switch (slot) {
    case "entry": return `Açılış düellolarının %${Math.round(profile.openingDuelWin * 100)}'ini kazanıyor; T roundlarının %${lane}'inde ${site} tarafında.`;
    case "trader": return `Round başına ${profile.tradeKillRate} takas kill, ${profile.killsPerRound} kill.`;
    case "support": return `Roundların %${Math.round(profile.survivalRate * 100)}'inde hayatta kalıyor; utility için en güvenli isim.`;
    case "second": return `T roundlarının %${Math.round((profile.laneShare?.mid || 0) * 100)}'inde orta alanda.`;
    case "lurker": return "Diğer koridoru en sık tutan oyuncu.";
    default: return "";
  }
}

/** Arayüzden gelen oyuncu-rol değişikliklerini stratejiye uygular. */
export function applyAssignments(strategy, assignments = {}) {
  if (!strategy || !assignments || typeof assignments !== "object") return strategy;
  const players = strategy.players.map((player) => ({ ...player }));
  for (const [slot, steamid] of Object.entries(assignments)) {
    const target = players.find((player) => player.slot === slot);
    const source = players.find((player) => player.steamid === String(steamid));
    if (!target || !source || target === source) continue;
    // İki rolün oyuncuları yer değiştirir; rota ve görev role bağlı kalır.
    [target.steamid, source.steamid] = [source.steamid, target.steamid];
    [target.name, source.name] = [source.name, target.name];
    target.why = "Rol elle seçildi.";
    source.why = "Rol elle seçildi.";
  }
  const nameOf = (slot) => players.find((player) => player.slot === slot)?.name || "";
  const throwerBySlot = new Map(strategy.players.map((player) => [player.name, player.slot]));
  const utility = strategy.utility.map((item) => {
    const slot = throwerBySlot.get(item.thrower);
    const player = players.find((candidate) => candidate.slot === slot);
    return player ? { ...item, thrower: player.name, throwerColor: player.color } : item;
  });
  return { ...strategy, players, utility, tradePair: [nameOf("entry"), nameOf("trader")] };
}
