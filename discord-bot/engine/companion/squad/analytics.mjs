import { findOwnerTeam, findPartyCandidates, normalizeMapName, normalizeSteamId, selectionFingerprint, selectionSteamIds } from "./identity.mjs";

const round1 = (value) => Math.round(Number(value || 0) * 10) / 10;
const percent = (part, total) => total > 0 ? Math.round((part / total) * 1000) / 10 : 0;

function adjustedWinRate(wins, rounds) {
  // İki sanal galibiyet + iki sanal mağlubiyet küçük örnekte %0/%100
  // yanılsamasını bastırır; veri büyüdükçe gerçek orana yaklaşır.
  return round1(((Number(wins || 0) + 2) / (Number(rounds || 0) + 4)) * 100);
}

export function evidenceConfidence(matchCount, sampleCount) {
  const matches = Math.max(0, Number(matchCount || 0));
  const samples = Math.max(0, Number(sampleCount || 0));
  if (matches === 0 || samples === 0) return 0;
  return Math.min(96, Math.round(20 + Math.min(35, matches * 8) + Math.min(41, Math.sqrt(samples) * 6)));
}

export function confidenceLabel(value) {
  if (value >= 82) return "yüksek";
  if (value >= 65) return "orta";
  return "sınırlı";
}

function newPlayerAggregate(player) {
  return {
    player: { steamid: normalizeSteamId(player?.steamid), name: String(player?.name || "Bilinmeyen oyuncu") },
    matchIds: new Set(),
    totals: { rounds: 0, kills: 0, deaths: 0, assists: 0, damage: 0, openingKills: 0, openingDeaths: 0, utilityDamage: 0, flashesThrown: 0 },
    sides: new Map(),
    routes: new Map(),
    weapons: new Map(),
  };
}

function addSide(aggregate, side, matchId) {
  if (!side || !["CT", "T"].includes(side.side)) return;
  if (!aggregate.sides.has(side.side)) {
    aggregate.sides.set(side.side, { side: side.side, matchIds: new Set(), rounds: 0, kills: 0, deaths: 0, assists: 0, damage: 0, shots: 0 });
  }
  const target = aggregate.sides.get(side.side);
  target.matchIds.add(matchId);
  for (const field of ["rounds", "kills", "deaths", "assists", "damage", "shots"]) target[field] += Number(side[field] || 0);
}

function addRoute(aggregate, route, matchId) {
  if (!route?.zone || !["CT", "T"].includes(route.side)) return;
  const key = `${route.side}__${route.zone}`;
  if (!aggregate.routes.has(key)) {
    aggregate.routes.set(key, { side: route.side, zone: String(route.zone), matchIds: new Set(), rounds: 0, wins: 0, losses: 0, kills: 0, deaths: 0 });
  }
  const target = aggregate.routes.get(key);
  target.matchIds.add(matchId);
  target.rounds += Number(route.totalRounds || 0);
  target.wins += Number(route.wins || 0);
  target.losses += Number(route.losses || 0);
  target.kills += Number(route.kills || 0);
  target.deaths += Number(route.deaths || 0);
}

function normalizeWeaponCategory(weapon) {
  const category = String(weapon?.category || "").toLowerCase();
  const name = String(weapon?.weapon || weapon?.label || "").toLowerCase();
  if (category.includes("sniper") || /awp|ssg08|scar20|g3sg1/.test(name)) return "sniper";
  if (category.includes("rifle") || /ak47|m4a|famas|galilar|aug|sg556/.test(name)) return "rifle";
  if (category.includes("smg") || /mp9|mac10|mp7|mp5|ump45|p90|bizon/.test(name)) return "smg";
  if (category.includes("shotgun") || /xm1014|mag7|nova|sawedoff/.test(name)) return "shotgun";
  if (category.includes("pistol") || /glock|usp|p2000|p250|deagle|revolver|tec9|fiveseven|cz75|elite/.test(name)) return "pistol";
  if (category.includes("machine") || /m249|negev/.test(name)) return "machinegun";
  return category || "other";
}

function addWeapon(aggregate, weapon, matchId) {
  if (!weapon?.weapon && !weapon?.label) return;
  const category = normalizeWeaponCategory(weapon);
  const key = `${category}__${String(weapon.weapon || weapon.label).toLowerCase()}`;
  if (!aggregate.weapons.has(key)) {
    aggregate.weapons.set(key, {
      weapon: String(weapon.weapon || weapon.label),
      label: String(weapon.label || weapon.weapon),
      category,
      matchIds: new Set(),
      kills: 0,
      damage: 0,
      shots: 0,
      headshots: 0,
    });
  }
  const target = aggregate.weapons.get(key);
  target.matchIds.add(matchId);
  for (const field of ["kills", "damage", "shots", "headshots"]) target[field] += Number(weapon[field] || 0);
}

function finalizePlayer(aggregate) {
  const matches = aggregate.matchIds.size;
  const totals = aggregate.totals;
  const sides = [...aggregate.sides.values()].map((side) => ({
    side: side.side,
    matches: side.matchIds.size,
    rounds: side.rounds,
    kills: side.kills,
    deaths: side.deaths,
    assists: side.assists,
    adr: round1(side.damage / Math.max(1, side.rounds)),
    kd: round1(side.kills / Math.max(1, side.deaths)),
    confidence: evidenceConfidence(side.matchIds.size, side.rounds),
  }));
  const routes = [...aggregate.routes.values()].map((route) => ({
    side: route.side,
    zone: route.zone,
    matches: route.matchIds.size,
    rounds: route.rounds,
    wins: route.wins,
    losses: route.losses,
    kills: route.kills,
    deaths: route.deaths,
    rawWinRate: percent(route.wins, route.rounds),
    adjustedWinRate: adjustedWinRate(route.wins, route.rounds),
    kd: round1(route.kills / Math.max(1, route.deaths)),
    confidence: evidenceConfidence(route.matchIds.size, route.rounds),
  })).sort((a, b) => b.adjustedWinRate - a.adjustedWinRate || b.rounds - a.rounds);
  const weapons = [...aggregate.weapons.values()].map((weapon) => {
    const score = round1((weapon.kills * 7 + weapon.damage / 35 + Math.min(20, weapon.shots / 5)) / Math.max(1, weapon.matchIds.size));
    return {
      weapon: weapon.weapon,
      label: weapon.label,
      category: weapon.category,
      matches: weapon.matchIds.size,
      kills: weapon.kills,
      damage: weapon.damage,
      shots: weapon.shots,
      headshots: weapon.headshots,
      accuracyProxy: round1((weapon.kills / Math.max(1, weapon.shots)) * 100),
      score,
      confidence: evidenceConfidence(weapon.matchIds.size, weapon.shots),
    };
  }).sort((a, b) => b.score - a.score || b.kills - a.kills);

  const categories = new Map();
  for (const weapon of weapons) {
    if (!categories.has(weapon.category)) categories.set(weapon.category, { category: weapon.category, kills: 0, damage: 0, shots: 0, matches: new Set(), score: 0 });
    const category = categories.get(weapon.category);
    category.kills += weapon.kills;
    category.damage += weapon.damage;
    category.shots += weapon.shots;
    category.score += weapon.score;
    category.matches.add(weapon.matches);
  }

  return {
    player: aggregate.player,
    evidence: { matches, rounds: totals.rounds, confidence: evidenceConfidence(matches, totals.rounds), confidenceLabel: confidenceLabel(evidenceConfidence(matches, totals.rounds)) },
    overall: {
      rounds: totals.rounds,
      kills: totals.kills,
      deaths: totals.deaths,
      assists: totals.assists,
      kd: round1(totals.kills / Math.max(1, totals.deaths)),
      adr: round1(totals.damage / Math.max(1, totals.rounds)),
      openingDelta: totals.openingKills - totals.openingDeaths,
      utilityPerRound: round1(totals.utilityDamage / Math.max(1, totals.rounds)),
      flashesPerMatch: round1(totals.flashesThrown / Math.max(1, matches)),
    },
    sides,
    routes,
    weapons,
    weaponCategories: [...categories.values()].map((category) => ({
      ...category,
      matches: Math.max(...category.matches, 0),
      score: round1(category.score),
      confidence: evidenceConfidence(Math.max(...category.matches, 0), category.shots),
    })).sort((a, b) => b.score - a.score),
  };
}

export function buildSquadEvidence(matches, roster, map, { minimumMatches = 3, ownerSteamId = "" } = {}) {
  const fingerprint = selectionFingerprint(roster);
  const selectedSteamIds = selectionSteamIds(roster);
  const selectedIds = new Set(selectedSteamIds);
  const normalizedMap = normalizeMapName(map);
  const normalizedOwnerSteamId = normalizeSteamId(ownerSteamId);
  if (!fingerprint || !Array.isArray(roster) || selectedSteamIds.length !== roster.length) {
    throw new Error("Ekip analizi için 1–5 arasında benzersiz ve geçerli SteamID gerekli.");
  }
  const candidates = findPartyCandidates(matches, roster, normalizedMap, normalizedOwnerSteamId);

  const aggregates = new Map((Array.isArray(roster) ? roster : []).map((player) => {
    const id = normalizeSteamId(player?.steamid);
    return [id, newPlayerAggregate(player)];
  }));
  let totalTeamRounds = 0;
  for (const match of candidates) {
    const team = findOwnerTeam(match, normalizedOwnerSteamId, roster);
    if (!team) continue;
    let matchRounds = 0;
    for (const member of team.players || []) {
      const id = normalizeSteamId(member?.steamid);
      if (!selectedIds.has(id)) continue;
      const aggregate = aggregates.get(id);
      const report = member?.report;
      if (!aggregate || !report) continue;
      aggregate.player.name = String(member.name || report.player?.name || aggregate.player.name);
      aggregate.matchIds.add(match.id);
      aggregate.totals.rounds += Number(report.rounds || 0);
      aggregate.totals.kills += Number(report.kills || 0);
      aggregate.totals.deaths += Number(report.deaths || 0);
      aggregate.totals.assists += Number(report.assists || 0);
      aggregate.totals.openingKills += Number(report.openingKills || 0);
      aggregate.totals.openingDeaths += Number(report.openingDeaths || 0);
      aggregate.totals.utilityDamage += Number(report.utilityDamage || 0);
      aggregate.totals.flashesThrown += Number(report.flashesThrown || 0);
      const sideDamage = (report.sideStats || []).reduce((sum, side) => sum + Number(side.damage || 0), 0);
      aggregate.totals.damage += sideDamage || Number(report.adr || 0) * Number(report.rounds || 0);
      matchRounds = Math.max(matchRounds, Number(report.rounds || 0));
      for (const side of report.sideStats || []) addSide(aggregate, side, match.id);
      for (const route of report.routeStats || []) addRoute(aggregate, route, match.id);
      for (const weapon of report.weaponStats || []) addWeapon(aggregate, weapon, match.id);
    }
    totalTeamRounds += matchRounds;
  }

  const players = [...aggregates.values()].map(finalizePlayer);
  const underSampledPlayers = players.filter((player) => player.evidence.matches < minimumMatches);
  if (underSampledPlayers.length) {
    const summary = underSampledPlayers.map((player) => `${player.player.name}: ${player.evidence.matches}/${minimumMatches}`).join(", ");
    const error = new Error(`Her seçili oyuncu için ${normalizedMap} haritasında en az ${minimumMatches} analiz edilmiş maç gerekli. Eksik: ${summary}.`);
    error.statusCode = 422;
    error.details = {
      required: minimumMatches,
      players: players.map((player) => ({ ...player.player, found: player.evidence.matches, required: minimumMatches })),
    };
    throw error;
  }
  return {
    schemaVersion: 1,
    generatedAt: Date.now(),
    squadFingerprint: fingerprint,
    map: normalizedMap,
    matchIds: candidates.map((match) => match.id),
    evidence: {
      matches: candidates.length,
      teamRounds: totalTeamRounds,
      minimumMatches,
      confidence: evidenceConfidence(candidates.length, totalTeamRounds),
      confidenceLabel: confidenceLabel(evidenceConfidence(candidates.length, totalTeamRounds)),
    },
    playerMatchCounts: players.map((player) => ({ ...player.player, matches: player.evidence.matches })),
    warnings: candidates.length > minimumMatches
      ? ["Seçili oyuncuların kanıtları farklı maç kümelerinden birleştirildi; aynı maçta birlikte bulunmaları gerekmez."]
      : [],
    players,
  };
}
