import { createHash } from "node:crypto";

const UNKNOWN_MAPS = new Set(["", "unknown", "de_unknown", "bilinmeyen"]);
export const STEAM_ID64_ACCOUNT_BASE = 76561197960265728n;

export function normalizeMapName(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/^workshop\/[0-9]+\//, "")
    .replace(/^maps\//, "")
    .replace(/\.vpk$/, "")
    .replace(/^de_/, "")
    .replace(/[\s_-]+/g, "");
  if (normalized === "dustii") return "dust2";
  return UNKNOWN_MAPS.has(normalized) ? "unknown" : normalized;
}

export function normalizeSteamId(value) {
  const steamid = String(value || "").trim();
  if (/^\d{17}$/.test(steamid)) return steamid;
  if (/^\d{1,10}$/.test(steamid)) {
    const accountId = BigInt(steamid);
    if (accountId > 0n && accountId <= 4_294_967_295n) {
      return String(STEAM_ID64_ACCOUNT_BASE + accountId);
    }
  }
  return "";
}

export function cleanPlayer(value = {}) {
  return {
    steamid: normalizeSteamId(value.steamid ?? value.steamId ?? value.id),
    name: String(value.name || value.playerName || "Bilinmeyen oyuncu").trim().slice(0, 80),
  };
}

export function rosterSteamIds(players, { requireFive = true } = {}) {
  const ids = [...new Set((Array.isArray(players) ? players : [])
    .map((player) => normalizeSteamId(typeof player === "object" ? player?.steamid ?? player?.steamId ?? player?.id : player))
    .filter(Boolean))].sort();
  if (requireFive && ids.length !== 5) return [];
  return ids;
}

export function rosterFingerprint(players) {
  const ids = rosterSteamIds(players);
  if (ids.length !== 5) return "";
  return createHash("sha256").update(ids.join("|"), "utf8").digest("hex").slice(0, 20);
}

export function selectionSteamIds(players) {
  const ids = rosterSteamIds(players, { requireFive: false });
  return ids.length >= 1 && ids.length <= 5 ? ids : [];
}

export function selectionFingerprint(players) {
  const ids = selectionSteamIds(players);
  if (!ids.length) return "";
  // Beş kişilik eski kayıtların kimliği değişmesin; değişken ekipler de aynı
  // sıralamadan bağımsız kimlik sözleşmesini kullanır.
  return createHash("sha256").update(ids.join("|"), "utf8").digest("hex").slice(0, 20);
}

export function sameRoster(left, right) {
  const leftIds = rosterSteamIds(left);
  const rightIds = rosterSteamIds(right);
  return leftIds.length === 5 && rightIds.length === 5 && leftIds.every((id, index) => id === rightIds[index]);
}

function reportsBySteamId(record) {
  const reports = Array.isArray(record?.fullAnalysis?.reports)
    ? record.fullAnalysis.reports
    : Array.isArray(record?.reports) ? record.reports : [];
  return new Map(reports.map((report) => [normalizeSteamId(report?.player?.steamid), report]).filter(([id]) => id));
}

function scannedTeams(record) {
  const grouped = new Map();
  for (const rawPlayer of Array.isArray(record?.players) ? record.players : []) {
    const player = cleanPlayer(rawPlayer);
    if (!player.steamid) continue;
    const teamLabel = String(rawPlayer.team || rawPlayer.teamName || "").trim();
    if (!teamLabel) continue;
    if (!grouped.has(teamLabel)) grouped.set(teamLabel, []);
    grouped.get(teamLabel).push(player);
  }
  return [...grouped.entries()]
    .map(([label, players]) => ({ label, players }))
    .filter((team) => rosterSteamIds(team.players).length === 5);
}

function analysisTeams(record) {
  const reports = Array.isArray(record?.fullAnalysis?.reports)
    ? record.fullAnalysis.reports
    : Array.isArray(record?.reports) ? record.reports : [];
  const grouped = new Map();
  for (const report of reports) {
    const player = cleanPlayer(report?.player);
    if (!player.steamid) continue;
    const firstPath = [...(Array.isArray(report?.roundPaths) ? report.roundPaths : [])]
      .filter((path) => path?.side === "CT" || path?.side === "T")
      .sort((a, b) => Number(a.round || 0) - Number(b.round || 0))[0];
    if (!firstPath?.side) continue;
    const key = `İlk yarı ${firstPath.side}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(player);
  }
  return [...grouped.entries()]
    .map(([label, players]) => ({ label, players }))
    .filter((team) => rosterSteamIds(team.players).length === 5);
}

export function extractTeams(record) {
  const reportMap = reportsBySteamId(record);
  const sourceTeams = scannedTeams(record);
  const teams = sourceTeams.length === 2 ? sourceTeams : analysisTeams(record);
  return teams.map((team, index) => {
    const players = team.players.map((player) => ({
      ...player,
      report: reportMap.get(player.steamid) || null,
    }));
    return {
      id: rosterFingerprint(players),
      label: team.label || `Takım ${index + 1}`,
      players,
    };
  });
}

function compactReport(report) {
  if (!report || typeof report !== "object") return null;
  const roundPaths = Array.isArray(report.roundPaths) ? report.roundPaths.map((path) => {
    const compact = { ...path };
    delete compact.points;
    return compact;
  }) : [];
  const withoutCoordinates = (details) => (Array.isArray(details) ? details.map((detail) => {
    const compact = { ...detail };
    delete compact.x;
    delete compact.y;
    delete compact.z;
    return compact;
  }) : []);
  return {
    player: cleanPlayer(report.player),
    map: normalizeMapName(report.map),
    rounds: Number(report.rounds || 0),
    kills: Number(report.kills || 0),
    deaths: Number(report.deaths || 0),
    assists: Number(report.assists || 0),
    adr: Number(report.adr || 0),
    headshotPercent: Number(report.headshotPercent || 0),
    openingKills: Number(report.openingKills || 0),
    openingDeaths: Number(report.openingDeaths || 0),
    utilityDamage: Number(report.utilityDamage || 0),
    flashesThrown: Number(report.flashesThrown || 0),
    tradePercent: Number(report.tradePercent || 0),
    impact: Number(report.impact || 0),
    sideStats: Array.isArray(report.sideStats) ? report.sideStats : [],
    weaponStats: Array.isArray(report.weaponStats) ? report.weaponStats : [],
    routeStats: Array.isArray(report.routeStats) ? report.routeStats : [],
    roundPaths,
    deathDetails: withoutCoordinates(report.deathDetails),
    killDetails: withoutCoordinates(report.killDetails),
  };
}

export function extractSquadMatch(record, metadata = null) {
  if (!record || typeof record !== "object") return null;
  const merged = metadata && typeof metadata === "object"
    ? { ...metadata, ...record, players: record.players || metadata.players }
    : record;
  const teams = extractTeams(merged).map((team) => ({
    id: team.id,
    label: team.label,
    players: team.players.map(({ report, ...player }) => ({ ...player, report: compactReport(report) })),
  }));
  const map = normalizeMapName(record.map || record.fullAnalysis?.header?.map_name);
  const id = String(record.id || record.matchId || record.fileName || "").trim();
  if (!id || map === "unknown" || teams.length !== 2) return null;
  return {
    schemaVersion: 1,
    id,
    source: String(record.source || "local"),
    fileName: String(record.fileName || ""),
    map,
    timestamp: Number(record.timestamp || Date.now()),
    formattedDate: String(record.formattedDate || ""),
    score: record.score || null,
    userStats: record.userStats ? cleanPlayer(record.userStats) : null,
    parserVersion: String(record.fullAnalysis?.parserVersion || record.parserVersion || ""),
    teams,
  };
}

export function findSquadCandidates(matches, roster, map) {
  const wantedMap = normalizeMapName(map);
  const fingerprint = rosterFingerprint(roster);
  if (!fingerprint || wantedMap === "unknown") return [];
  return (Array.isArray(matches) ? matches : [])
    .filter((match) => normalizeMapName(match?.map) === wantedMap)
    .filter((match) => Array.isArray(match?.teams) && match.teams.some((team) => team.id === fingerprint || sameRoster(team.players, roster)))
    .sort((a, b) => Number(b.timestamp || 0) - Number(a.timestamp || 0));
}

export function findSquadDiscoveries(scannedMatches, archivedMatches, roster, map) {
  const wantedMap = normalizeMapName(map);
  const fingerprint = rosterFingerprint(roster);
  if (!fingerprint || wantedMap === "unknown") return [];

  const archivedIds = new Set((Array.isArray(archivedMatches) ? archivedMatches : [])
    .map((match) => String(match?.id || match?.matchId || ""))
    .filter(Boolean));

  return (Array.isArray(scannedMatches) ? scannedMatches : [])
    .filter((match) => !archivedIds.has(String(match?.id || match?.matchId || "")))
    .filter((match) => normalizeMapName(match?.map) === wantedMap)
    .filter((match) => typeof match?.replayUrl === "string" && match.replayUrl.length > 0)
    .filter((match) => extractTeams(match).some((team) => team.id === fingerprint || sameRoster(team.players, roster)))
    .sort((a, b) => Number(b.timestamp || 0) - Number(a.timestamp || 0));
}

function teamPlayerIds(team, { requireReport = false } = {}) {
  return new Set((Array.isArray(team?.players) ? team.players : [])
    .filter((player) => !requireReport || player?.report)
    .map((player) => normalizeSteamId(player?.steamid))
    .filter(Boolean));
}

export function findOwnerTeam(match, ownerSteamId = "", selectedPlayers = []) {
  const teams = Array.isArray(match?.teams) && match.teams.length
    ? match.teams
    : extractTeams(match);
  const ownerId = normalizeSteamId(ownerSteamId || match?.userStats?.steamid);
  if (ownerId) return teams.find((team) => teamPlayerIds(team).has(ownerId)) || null;
  const selectedIds = new Set(selectionSteamIds(selectedPlayers));
  return teams.find((team) => [...teamPlayerIds(team)].some((id) => selectedIds.has(id))) || null;
}

export function matchedSelectionIds(match, selectedPlayers, ownerSteamId = "", { requireReport = false } = {}) {
  const selectedIds = new Set(selectionSteamIds(selectedPlayers));
  if (!selectedIds.size) return [];
  const team = findOwnerTeam(match, ownerSteamId, selectedPlayers);
  if (!team) return [];
  return [...teamPlayerIds(team, { requireReport })].filter((id) => selectedIds.has(id)).sort();
}

export function findPartyCandidates(matches, selectedPlayers, map, ownerSteamId = "") {
  const wantedMap = normalizeMapName(map);
  if (!selectionFingerprint(selectedPlayers) || wantedMap === "unknown") return [];
  return (Array.isArray(matches) ? matches : [])
    .filter((match) => normalizeMapName(match?.map) === wantedMap)
    .map((match) => ({
      match,
      matchedPlayerIds: matchedSelectionIds(match, selectedPlayers, ownerSteamId, { requireReport: true }),
    }))
    .filter((item) => item.matchedPlayerIds.length > 0)
    .map(({ match, matchedPlayerIds }) => ({ ...match, matchedPlayerIds }))
    .sort((a, b) => Number(b.timestamp || 0) - Number(a.timestamp || 0));
}

export function partyPlayerCoverage(matches, selectedPlayers, ownerSteamId = "") {
  const candidates = Array.isArray(matches) ? matches : [];
  return (Array.isArray(selectedPlayers) ? selectedPlayers : []).map(cleanPlayer)
    .filter((player) => player.steamid)
    .map((player) => ({
      player,
      matchIds: [...new Set(candidates
        .filter((match) => {
          const matched = Array.isArray(match?.matchedPlayerIds)
            ? match.matchedPlayerIds.map(normalizeSteamId)
            : matchedSelectionIds(match, [player], ownerSteamId, { requireReport: true });
          return matched.includes(player.steamid);
        })
        .map((match) => String(match?.id || match?.matchId || ""))
        .filter(Boolean))],
    }));
}

export function findPartyDiscoveries(scannedMatches, archivedMatches, selectedPlayers, map, ownerSteamId = "") {
  const wantedMap = normalizeMapName(map);
  if (!selectionFingerprint(selectedPlayers) || wantedMap === "unknown") return [];
  const archivedIds = new Set((Array.isArray(archivedMatches) ? archivedMatches : [])
    .map((match) => String(match?.id || match?.matchId || ""))
    .filter(Boolean));
  return (Array.isArray(scannedMatches) ? scannedMatches : [])
    .filter((match) => !archivedIds.has(String(match?.id || match?.matchId || "")))
    .filter((match) => normalizeMapName(match?.map) === wantedMap)
    .filter((match) => typeof match?.replayUrl === "string" && match.replayUrl.length > 0)
    .map((match) => ({ match, matchedPlayerIds: matchedSelectionIds(match, selectedPlayers, ownerSteamId) }))
    .filter((item) => item.matchedPlayerIds.length > 0)
    .map(({ match, matchedPlayerIds }) => ({ ...match, matchedPlayerIds }))
    .sort((a, b) => Number(b.timestamp || 0) - Number(a.timestamp || 0));
}

export function selectPartyDiscoveryMatches(discoveries, analyzedCoverage, { minimumMatches = 3 } = {}) {
  const remaining = new Map((Array.isArray(analyzedCoverage) ? analyzedCoverage : []).map((item) => [
    normalizeSteamId(item?.player?.steamid),
    Math.max(0, Number(minimumMatches) - (Array.isArray(item?.matchIds) ? item.matchIds.length : Number(item?.matches || 0))),
  ]).filter(([id]) => id));
  const selected = [];
  for (const match of Array.isArray(discoveries) ? discoveries : []) {
    const usefulIds = (Array.isArray(match?.matchedPlayerIds) ? match.matchedPlayerIds : [])
      .map(normalizeSteamId)
      .filter((id) => Number(remaining.get(id) || 0) > 0);
    if (!usefulIds.length) continue;
    selected.push(match);
    for (const id of usefulIds) remaining.set(id, Math.max(0, Number(remaining.get(id) || 0) - 1));
    if ([...remaining.values()].every((value) => value <= 0)) break;
  }
  return selected;
}
