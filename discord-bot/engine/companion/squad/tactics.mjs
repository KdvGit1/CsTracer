// Takım koçu için harita taktiği: rakip CT'lerin round başında tuttuğu
// pozisyonlar, takımın gerçekten kullandığı saldırı rotaları ve bunlardan
// türetilen aşamalı T planları ("önce şurayı al, sonra şurayı kontrol et,
// siteye gir, şuraya kur"). Tüm konumlar demo koordinatlarından gelir.
import { buildTSideStats, mergeTSideStats, ROUND_SECONDS, summarizeTSide } from "../tside.mjs";
import { findOwnerTeam, normalizeMapName, normalizeSteamId, selectionSteamIds } from "./identity.mjs";
import { siteOfZone, zoneLane } from "./maps.mjs";

const round1 = (value) => Math.round(Number(value || 0) * 10) / 10;
const percent = (part, total) => (total > 0 ? Math.round((part / total) * 100) : 0);
const SITES = ["A", "B"];
const MIN_SITE_SAMPLES = 3;

function isNeutralZone(zone) {
  return !zone || /spawn|bilinmeyen/i.test(zone);
}

function ownTeamIds(match, ownerSteamId, roster) {
  const team = findOwnerTeam(match, ownerSteamId, roster);
  return new Set((team?.players || []).map((player) => normalizeSteamId(player?.steamid)).filter(Boolean));
}

function median(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function centroidAccumulator() {
  const zones = new Map();
  return {
    add(zone, x, y) {
      if (!zone || !Number.isFinite(x) || !Number.isFinite(y)) return;
      if (!zones.has(zone)) zones.set(zone, { x: 0, y: 0, n: 0 });
      const item = zones.get(zone);
      item.x += x;
      item.y += y;
      item.n += 1;
    },
    get(zone) {
      const item = zones.get(zone);
      return item?.n ? { x: Math.round(item.x / item.n), y: Math.round(item.y / item.n) } : null;
    },
  };
}

/** Seçili oyuncuların T tarafı kuralları: takım ve oyuncu bazında. */
export function buildTeamTSide(matches, roster, ownerSteamId = "") {
  const ids = selectionSteamIds(roster);
  const timelines = (Array.isArray(matches) ? matches : []).filter((match) => match?.timeline?.rounds?.length);
  const team = mergeTSideStats(timelines.map((match) => buildTSideStats(match.timeline, ids)));
  const players = (Array.isArray(roster) ? roster : []).map((player) => {
    const id = normalizeSteamId(player?.steamid);
    const stats = mergeTSideStats(timelines.map((match) => buildTSideStats(match.timeline, [id])));
    const summary = summarizeTSide(stats, { scope: "player" });
    return {
      player: { steamid: id, name: String(player?.name || "") },
      tRounds: summary.tRounds,
      score: summary.score,
      cards: summary.cards.map(({ id: cardId, status, value }) => ({ id: cardId, status, value })),
    };
  });
  return {
    ...summarizeTSide(team, { scope: "team" }),
    matchesWithTimeline: timelines.length,
    ownerSteamId: normalizeSteamId(ownerSteamId),
    players,
  };
}

/**
 * Haritadaki tüm arşiv maçlarından CT tutuşlarını, site bazında takım
 * rotalarını, kurulum ve post-plant noktalarını çıkarır.
 */
export function buildTacticalMap(matches, map, { ownerSteamId = "", roster = [] } = {}) {
  const normalizedMap = normalizeMapName(map);
  const selected = new Set(selectionSteamIds(roster));
  const mapMatches = (Array.isArray(matches) ? matches : [])
    .filter((match) => normalizeMapName(match?.map) === normalizedMap && match?.timeline?.rounds?.length);
  const centroids = centroidAccumulator();
  const holdZones = new Map();
  const killZones = new Map();
  let holdRounds = 0;
  const sites = Object.fromEntries(SITES.map((site) => [site, {
    site,
    ownHits: 0,
    ownWins: 0,
    hitSecs: [],
    wonHitSecs: [],
    allHits: 0,
    routes: new Map(),
    routeRounds: 0,
    wonRouteRounds: 0,
    ctSetup: [],
    plants: [],
    postPlant: new Map(),
  }]));
  let opponentRounds = 0;

  for (const match of mapMatches) {
    const own = ownTeamIds(match, ownerSteamId, roster);
    for (const round of match.timeline.rounds) {
      const players = round.players || {};
      for (const items of Object.values(round.snapshots || {})) {
        for (const item of items) centroids.add(item.zone, item.x, item.y);
      }
      for (const kill of round.kills || []) {
        centroids.add(kill.zone, kill.x, kill.y);
        if (kill.kzone) centroids.add(kill.kzone, kill.kx, kill.ky);
      }
      const tIds = Object.keys(players).filter((id) => players[id].side === "T");
      const ownIsT = tIds.some((id) => own.has(id) || selected.has(id));
      // CT tutuşları: takımın T olduğu roundlarda rakip CT; sahip bilinmiyorsa tüm CT'ler.
      const opponentCt = own.size ? ownIsT : true;
      if (opponentCt) {
        opponentRounds += 1;
        const snapshot = round.snapshots?.[20] || round.snapshots?.["20"];
        if (snapshot && !(round.hit && round.hit.sec < 20)) {
          holdRounds += 1;
          const seen = new Map();
          for (const item of snapshot.filter((entry) => entry.side === "CT" && !isNeutralZone(entry.zone))) {
            seen.set(item.zone, (seen.get(item.zone) || 0) + 1);
          }
          for (const [zone, count] of seen) {
            if (!holdZones.has(zone)) holdZones.set(zone, { zone, rounds: 0, players: 0, x: 0, y: 0, n: 0 });
            const hold = holdZones.get(zone);
            hold.rounds += 1;
            hold.players += count;
          }
          for (const item of snapshot.filter((entry) => entry.side === "CT" && !isNeutralZone(entry.zone))) {
            const hold = holdZones.get(item.zone);
            hold.x += item.x;
            hold.y += item.y;
            hold.n += 1;
          }
        }
        for (const kill of round.kills || []) {
          if (kill.killerSide !== "CT" || kill.victimSide !== "T") continue;
          const zone = kill.kzone || kill.zone;
          if (isNeutralZone(zone)) continue;
          if (!killZones.has(zone)) killZones.set(zone, { zone, kills: 0, early: 0, x: 0, y: 0, n: 0 });
          const entry = killZones.get(zone);
          entry.kills += 1;
          if (kill.sec <= 30) entry.early += 1;
          if (Number.isFinite(kill.kx) && Number.isFinite(kill.ky)) {
            entry.x += kill.kx;
            entry.y += kill.ky;
            entry.n += 1;
          }
        }
      }

      if (!round.hit || !sites[round.hit.site]) continue;
      const site = sites[round.hit.site];
      const won = round.winnerSide === "T";
      site.allHits += 1;
      if (ownIsT || !own.size) {
        site.ownHits += 1;
        if (won) site.ownWins += 1;
        site.hitSecs.push(round.hit.sec);
        if (won) site.wonHitSecs.push(round.hit.sec);
      }
      const setup = round.ctOnSiteAt20?.[round.hit.site];
      if (round.hit.sec > 20 && Number.isFinite(setup) && opponentCt) site.ctSetup.push(setup);

      // Rota keşfi: siteye girmeden önce T'lerin ilk kez girdiği bölgeler.
      const firstVisit = new Map();
      for (const id of tIds) {
        for (const visit of players[id].visits || []) {
          if (isNeutralZone(visit.zone) || siteOfZone(visit.zone)) continue;
          const current = firstVisit.get(visit.zone);
          if (current === undefined || visit.sec < current) firstVisit.set(visit.zone, visit.sec);
        }
      }
      site.routeRounds += 1;
      if (won) site.wonRouteRounds += 1;
      for (const [zone, sec] of firstVisit) {
        if (!site.routes.has(zone)) site.routes.set(zone, { zone, rounds: 0, wins: 0, secSum: 0, wonSecSum: 0 });
        const route = site.routes.get(zone);
        route.rounds += 1;
        route.secSum += sec;
        if (won) {
          route.wins += 1;
          route.wonSecSum += sec;
        }
      }

      if (round.plant?.site === round.hit.site && Number.isFinite(round.plant.x) && round.plant.x !== null) {
        site.plants.push({ x: round.plant.x, y: round.plant.y, won, sec: round.plant.sec });
      }
      if (won && Array.isArray(round.postPlant)) {
        for (const item of round.postPlant.filter((entry) => entry.side === "T" && !isNeutralZone(entry.zone))) {
          if (!site.postPlant.has(item.zone)) site.postPlant.set(item.zone, { zone: item.zone, count: 0, x: 0, y: 0 });
          const entry = site.postPlant.get(item.zone);
          entry.count += 1;
          entry.x += item.x;
          entry.y += item.y;
        }
      }
    }
  }

  const holds = [...holdZones.values()].map((hold) => ({
    zone: hold.zone,
    lane: zoneLane(normalizedMap, hold.zone),
    share: percent(hold.rounds, holdRounds),
    avgPlayers: round1(hold.players / Math.max(1, hold.rounds)),
    x: Math.round(hold.x / Math.max(1, hold.n)),
    y: Math.round(hold.y / Math.max(1, hold.n)),
    kills: killZones.get(hold.zone)?.kills || 0,
  })).filter((hold) => hold.share >= 8).sort((a, b) => b.share - a.share);

  const dangerSpots = [...killZones.values()].filter((entry) => entry.n > 0).map((entry) => ({
    zone: entry.zone,
    lane: zoneLane(normalizedMap, entry.zone),
    kills: entry.kills,
    early: entry.early,
    x: Math.round(entry.x / entry.n),
    y: Math.round(entry.y / entry.n),
  })).sort((a, b) => b.kills - a.kills).slice(0, 10);

  const siteSummaries = Object.fromEntries(SITES.map((key) => {
    const site = sites[key];
    const useWins = site.wonRouteRounds >= MIN_SITE_SAMPLES;
    const base = useWins ? site.wonRouteRounds : site.routeRounds;
    const otherSite = sites[key === "A" ? "B" : "A"];
    const candidates = [...site.routes.values()]
      .map((item) => {
        const rounds = useWins ? item.wins : item.rounds;
        const secSum = useWins ? item.wonSecSum : item.secSum;
        const otherShare = percent(otherSite.routes.get(item.zone)?.rounds || 0, otherSite.routeRounds);
        const share = percent(rounds, base);
        return {
          zone: item.zone,
          lane: zoneLane(normalizedMap, item.zone),
          share,
          // Diğer siteye giderken de geçilen ortak bölgeler rotayı ayırt etmez.
          lift: round1(percent(item.rounds, site.routeRounds) / Math.max(5, otherShare)),
          avgSec: rounds ? round1(secSum / rounds) : null,
          winRate: percent(item.wins, item.rounds),
          ...(centroids.get(item.zone) || {}),
        };
      })
      .filter((item) => item.share >= 30 && item.avgSec !== null);
    const ownLane = candidates.filter((item) => item.lane === key);
    const sharedMid = candidates
      .filter((item) => item.lane === "mid" && item.lift >= 1.3)
      .sort((a, b) => b.lift - a.lift)
      .slice(0, 2);
    const route = [...ownLane, ...sharedMid]
      .sort((a, b) => a.avgSec - b.avgSec)
      .slice(0, 4);
    const siteZone = [...centroidZones(centroids, holds, key)][0] || null;
    const plantSource = site.plants.filter((plant) => plant.won).length >= 2 ? site.plants.filter((plant) => plant.won) : site.plants;
    const plant = plantSource.length
      ? { x: Math.round(plantSource.reduce((sum, item) => sum + item.x, 0) / plantSource.length), y: Math.round(plantSource.reduce((sum, item) => sum + item.y, 0) / plantSource.length), exact: true, samples: plantSource.length }
      : siteZone ? { x: siteZone.x, y: siteZone.y, exact: false, samples: 0 } : null;
    const postPlant = [...site.postPlant.values()]
      .sort((a, b) => b.count - a.count)
      .slice(0, 3)
      .map((entry) => ({ zone: entry.zone, count: entry.count, x: Math.round(entry.x / entry.count), y: Math.round(entry.y / entry.count) }));
    const siteHolds = holds.filter((hold) => hold.lane === key).slice(0, 4);
    const hitStart = median(site.wonHitSecs.length >= MIN_SITE_SAMPLES ? site.wonHitSecs : site.hitSecs);
    return [key, {
      site: key,
      samples: site.ownHits,
      allHits: site.allHits,
      winRate: site.ownHits ? percent(site.ownWins, site.ownHits) : null,
      adjustedWinRate: round1(((site.ownWins + 2) / (site.ownHits + 4)) * 100),
      avgCtSetup: site.ctSetup.length ? round1(site.ctSetup.reduce((sum, value) => sum + value, 0) / site.ctSetup.length) : null,
      hitSecond: hitStart === null ? null : Math.round(hitStart),
      route,
      holds: siteHolds,
      danger: dangerSpots.filter((spot) => spot.lane === key).slice(0, 3),
      plant,
      postPlant,
      siteCenter: siteZone,
    }];
  }));

  return {
    schemaVersion: 1,
    map: normalizedMap,
    matches: mapMatches.length,
    holdRounds,
    opponentRounds,
    holds,
    dangerSpots,
    sites: siteSummaries,
  };
}

function* centroidZones(centroids, holds, site) {
  for (const hold of holds) {
    if (siteOfZone(hold.zone) === site) yield { zone: hold.zone, x: hold.x, y: hold.y };
  }
  const label = `${site} Site`;
  const center = centroids.get(label) || centroids.get(`Bombsite ${site}`);
  if (center) yield { zone: label, ...center };
}

const ZONE_TIPS = [
  [/banana/i, "Banana'yı molotov ve flash ile alın; car ve sandbags'e utility atıp CT'yi geri itin."],
  [/apartments|balcony/i, "Apartments'ı sessiz alın, balkon çıkışı için flash hazır tutun."],
  [/second mid|top mid|middle|^mid$/i, "Mid'i smoke ile bölüp takas mesafesinde ilerleyin; AWP açısına kuru peek atmayın."],
  [/palace/i, "Palace'tan çıkışı A ramp ile eşzamanlı yapın."],
  [/a ramp|tetris/i, "Ramp/Tetris açısını flash ile temizleyip siteye bağlanın."],
  [/long|pit/i, "Long kapısını flash ile açın; pit ve site köşesi için ikinci oyuncu hemen arkada kalsın."],
  [/tunnel|tüneller/i, "Tünel çıkışını smoke ve flash ile açın, en az iki kişi birlikte çıkın."],
  [/outside|yard/i, "Outside'ı smoke duvarıyla bölüp ilerleyin."],
  [/connector|window|catwalk|short/i, "Bu geçiş rotasyonu keser; burada bir oyuncu bilgi tutsun."],
];

function zoneTip(zone) {
  return ZONE_TIPS.find(([pattern]) => pattern.test(zone))?.[1] || `${zone} bölgesini takas mesafesinde alın; CT agresifliğine karşı flash hazır tutun.`;
}

function holdText(holds) {
  if (!holds?.length) return "CT tutuş verisi yetersiz; site köşelerini sırayla flash ile temizleyin.";
  return holds.slice(0, 3).map((hold) => `${hold.zone} (%${hold.share})`).join(", ");
}

function playerFor(assignments, role) {
  return assignments.find((item) => item.slot?.id === role || item.role === role)?.player?.player?.name
    || assignments.find((item) => item.slot?.id === role || item.role === role)?.player?.name
    || "";
}

function phaseTimes(site) {
  // Takımın gerçek giriş saniyesi; default'a yer bırakmak için en erken 35 sn.
  const hit = Math.min(75, Math.max(35, Number(site.hitSecond) || 50));
  return {
    take: [0, Math.min(20, hit - 10)],
    control: [Math.min(20, hit - 10), hit],
    execute: [hit, Math.min(ROUND_SECONDS - 25, hit + 18)],
    plant: [Math.min(ROUND_SECONDS - 25, hit + 18), ROUND_SECONDS],
  };
}

function uniqueMarkers(markers) {
  const seen = new Set();
  return markers.filter((item) => {
    if (!item || seen.has(item.zone)) return false;
    seen.add(item.zone);
    return true;
  });
}

function marker(zone, fallback) {
  if (zone && Number.isFinite(zone.x) && Number.isFinite(zone.y)) return { zone: zone.zone, x: zone.x, y: zone.y, lane: zone.lane ?? null };
  return fallback ? { zone: fallback.zone, x: fallback.x, y: fallback.y, lane: fallback.lane ?? null } : null;
}

// Türkçe ünlü uyumu: A "a" diye, B "be" diye okunur.
const dative = (site) => (site === "A" ? "A'ya" : "B'ye");
const locative = (site) => (site === "A" ? "A'da" : "B'de");
const accusative = (site) => (site === "A" ? "A'yı" : "B'yi");

function sitePlan(tactical, siteKey, assignments, { fakeFrom = null, buy = "full" } = {}) {
  const site = tactical.sites[siteKey];
  const other = fakeFrom ? tactical.sites[fakeFrom] : null;
  const times = phaseTimes(site);
  const route = site.route;
  const takeZones = route.filter((zone) => zone.avgSec <= times.take[1] + 4);
  const controlZones = route.filter((zone) => !takeZones.includes(zone));
  const firstZone = takeZones[0] || route[0] || null;
  const lastZone = route.at(-1) || firstZone;
  const otherSite = siteKey === "A" ? "B" : "A";
  const infoZone = tactical.sites[otherSite]?.route?.[0] || null;
  const entry = playerFor(assignments, "entry");
  const trader = playerFor(assignments, "trader");
  const support = playerFor(assignments, "support");
  const awp = playerFor(assignments, "awp");
  const lurker = playerFor(assignments, "lurker");
  const holds = site.holds;
  const threats = holds.slice(0, 3);
  const plantMarker = site.plant ? { zone: `${siteKey} kurulum`, x: site.plant.x, y: site.plant.y, exact: site.plant.exact, lane: siteKey } : null;
  const postPlant = site.postPlant.length ? site.postPlant : [];
  const assign = (name, role, text) => (name ? { playerName: name, role, text } : null);

  let phases;
  if (other) {
    const fakeZone = other.route[0] || other.siteCenter;
    phases = [
      {
        id: "take", label: "Alan al · fake", window: times.take,
        markers: [marker(fakeZone)].filter(Boolean),
        text: `${fakeZone?.zone || `${fakeFrom} koridoru`} tarafında ses ve utility ile baskı yapın; CT'yi ${dative(fakeFrom)} çekin.`,
        assignments: [
          assign(support, "support", `${fakeFrom} girişine bir molotov ve flash harca, görünür ol.`),
          assign(lurker, "lurker", `${fakeZone?.zone || fakeFrom} tarafında kal, rotasyon sesini dinle.`),
          assign(entry, "entry", `${firstZone?.zone || `${siteKey} koridoru`} tarafında sessizce hazırlan.`),
          assign(trader, "trader", "Entry oyuncusuyla birlikte bekle."),
          assign(awp, "awp", `${route.find((zone) => zone.lane === "mid")?.zone || "Orta"} açısını tutup rotasyonu kes.`),
        ].filter(Boolean),
      },
      {
        id: "control", label: "Rotasyonu bekle", window: times.control,
        markers: controlZones.length ? controlZones.map((zone) => marker(zone)).filter(Boolean) : [marker(firstZone)].filter(Boolean),
        text: `${locative(fakeFrom)} rotasyon sesi ya da kill gelince ${firstZone?.zone || siteKey} üzerinden ${dative(siteKey)} bağlanın. 20. saniyede ${locative(siteKey)} ortalama ${site.avgCtSetup ?? "—"} CT vardı.`,
        assignments: [assign(lurker, "lurker", "Rotasyonu çağır, sonra arkadan bağlan.")].filter(Boolean),
      },
    ];
  } else {
    phases = [
      {
        id: "take", label: "Alan al", window: times.take,
        markers: (takeZones.length ? takeZones : [firstZone]).map((zone) => marker(zone)).filter(Boolean),
        text: firstZone ? `${(takeZones.length ? takeZones : [firstZone]).map((zone) => zone.zone).join(" + ")} bölgesini alın. ${zoneTip(firstZone.zone)}` : `${siteKey} koridorunu takas mesafesinde alın.`,
        assignments: [
          assign(entry, "entry", `${firstZone?.zone || siteKey} ilk temasını aç.`),
          assign(trader, "trader", `Entry oyuncusunun (${entry || "entry"}) iki adım arkasında kal, takası al.`),
          assign(support, "support", `${firstZone?.zone || siteKey} için açılış utility'sini at.`),
          assign(awp, "awp", `${route.find((zone) => zone.lane === "mid")?.zone || "Orta"} açısını tut.`),
          assign(lurker, "lurker", `Bilgi için ${infoZone?.zone || `${otherSite} koridoru`} tarafında kal, rotasyonu izle.`),
        ].filter(Boolean),
      },
      {
        id: "control", label: "Kontrol et", window: times.control,
        markers: (controlZones.length ? controlZones : [lastZone]).map((zone) => marker(zone)).filter(Boolean),
        text: controlZones.length
          ? `${controlZones.map((zone) => zone.zone).join(" → ")} kontrolünü alın; CT agresifliğini ve harcanan utility'yi not edin. Kill aldığınız tarafa hemen yüklenin.`
          : `${lastZone?.zone || siteKey} bölgesini tutun; CT agresifliğini ve harcanan utility'yi not edin.`,
        assignments: [assign(lurker, "lurker", "Diğer koridorda erken push'u cezalandır, rotasyonu çağır.")].filter(Boolean),
      },
    ];
  }

  const actualHit = Number.isFinite(site.hitSecond) ? site.hitSecond : null;
  const timingText = actualHit !== null && actualHit < times.execute[0]
    ? `Takım bu siteye genelde ${actualHit}. saniyede giriyor; önce bilgi toplamak için yaklaşık ${times.execute[0]}. saniyeyi hedefleyin`
    : `Yaklaşık ${times.execute[0]}. saniyede girin${actualHit !== null ? " (takımın kazandığı girişlerin ortası)" : ""}`;
  phases.push({
    id: "execute", label: `${dative(siteKey)} gir`, window: times.execute,
    markers: [...threats.map((hold) => ({ zone: hold.zone, x: hold.x, y: hold.y, threat: true, share: hold.share })), marker(lastZone)].filter(Boolean),
    text: `${timingText}; son 25 saniyeye bırakmayın. CT'ler genelde ${holdText(threats)} tutuyor; bu açıları sırayla flash ile temizleyin.${site.danger[0] ? ` En çok kayıp ${site.danger[0].zone} açısından geldi.` : ""}`,
    assignments: [
      assign(support, "support", `Siteye giriş flash'ını ${threats[0]?.zone || "ilk açıya"} doğru at.`),
      assign(entry, "entry", `${threats[0]?.zone || "İlk açı"} köşesini temizle.`),
      assign(trader, "trader", `${threats[1]?.zone || "İkinci açı"} köşesini al, entry oyuncusunu takasla.`),
    ].filter(Boolean),
  });
  phases.push({
    id: "plant", label: "Kur ve tut", window: times.plant,
    markers: [plantMarker, ...postPlant.map((item) => ({ zone: item.zone, x: item.x, y: item.y, post: true }))].filter(Boolean),
    text: `${site.plant?.exact ? "Takımın kazandığı kurulumların ortalama noktasına" : "Site merkezindeki güvenli noktaya"} kurun.${postPlant.length ? ` Kazanılan roundlarda post-plant pozisyonları: ${postPlant.map((item) => item.zone).join(", ")}.` : ""} Kill aramayın; bombayı gören, birbirini takaslayan iki çapraz pozisyon alın.`,
    assignments: [assign(lurker, "lurker", "Rotasyon yolunu tut, geç gelen CT'yi yakala.")].filter(Boolean),
  });

  const evidenceScore = site.adjustedWinRate;
  const title = other
    ? `${fakeFrom} fake → ${siteKey} bitir`
    : `${firstZone?.zone || siteKey} kontrolü → ${siteKey} execute`;
  return {
    id: other ? `fake_${fakeFrom}_${siteKey}` : `data_${siteKey}`,
    side: "T",
    buy,
    title,
    lane: [firstZone?.zone, lastZone?.zone, `${siteKey} Site`].filter(Boolean).filter((value, index, list) => list.indexOf(value) === index).join(" → "),
    goal: other
      ? `${locative(fakeFrom)} CT'yi rotate ettirip ${accusative(siteKey)} daha az savunmacıyla almak.`
      : `${route.map((zone) => zone.zone).join(" → ") || siteKey} rotasıyla alanı adım adım alıp ${accusative(siteKey)} takaslı execute etmek.`,
    evidence: {
      historicalScore: evidenceScore,
      confidence: Math.min(90, 30 + site.samples * 4),
      sampleRounds: site.samples,
      winRate: site.winRate,
      avgCtSetup: site.avgCtSetup,
    },
    tasks: phases.flatMap((phase) => phase.assignments.map((item) => ({ role: item.role, playerName: item.playerName, text: `${phase.label}: ${item.text}` }))),
    phases: phases.map((phase) => ({ ...phase, markers: uniqueMarkers(phase.markers) })),
    dataDriven: true,
  };
}

/** Veri yeterliyse site bazında aşamalı planlar üretir; yoksa boş döner. */
export function buildPhasedPlans(tactical, assignments) {
  const ready = ["A", "B"].filter((key) => tactical?.sites?.[key]?.samples >= MIN_SITE_SAMPLES && tactical.sites[key].route.length);
  if (!ready.length) return [];
  // Zayıf site: 20. saniyede daha az CT ve daha iyi takım geçmişi.
  const weakness = (key) => {
    const site = tactical.sites[key];
    return (site.adjustedWinRate || 50) - (Number(site.avgCtSetup) || 1.5) * 10;
  };
  const ordered = [...ready].sort((a, b) => weakness(b) - weakness(a));
  const plans = ordered.map((key, index) => sitePlan(tactical, key, assignments, { buy: index === 0 ? "full" : "force" }));
  if (ready.length === 2) {
    const [weak, strong] = ordered;
    plans.push(sitePlan(tactical, weak, assignments, { fakeFrom: strong, buy: "full" }));
  }
  return plans;
}
