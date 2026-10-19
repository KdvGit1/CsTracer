// Analiz sonucunu botun hafızasına işler: maç kaydı, demodaki her bağlı
// oyuncunun kişisel gelişim satırı ve takım koçu için kompakt maç arşivi.
// Masaüstündeki processDownloadedDemo akışının çok kullanıcılı karşılığıdır.
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { buildCompactSummaryFromReport } from "../../engine/companion/match_automation.mjs";
import { extractSquadMatch, normalizeMapName, normalizeSteamId } from "../../engine/companion/squad/identity.mjs";
import { buildRoundTimeline } from "../../engine/companion/tside.mjs";
import { scoreMatchReport } from "../../engine/shared/scoring.mjs";

export function readAnalysis(path) {
  return JSON.parse(gunzipSync(readFileSync(path)).toString("utf8"));
}

export function firstSide(report) {
  return [...(report?.roundPaths || [])].filter((path) => path?.side === "CT" || path?.side === "T").sort((a, b) => Number(a.round) - Number(b.round))[0]?.side || "";
}

/** Oyuncuları ilk yarıdaki tarafa göre iki takıma ayırır (her maç için çalışır). */
export function teamsFromAnalysis(analysis) {
  const groups = new Map();
  for (const report of analysis?.reports || []) {
    const side = firstSide(report);
    const label = side ? `İlk yarı ${side}` : "Takımı belirsiz";
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label).push({ steamid: normalizeSteamId(report.player?.steamid), name: String(report.player?.name || "Oyuncu").slice(0, 80) });
  }
  return [...groups.entries()].map(([label, players]) => ({ label, players }));
}

export function findReport(analysis, { steamid = "", name = "" } = {}) {
  const reports = analysis?.reports || [];
  const id = normalizeSteamId(steamid);
  if (id) {
    const byId = reports.find((report) => normalizeSteamId(report.player?.steamid) === id);
    if (byId) return byId;
  }
  const wanted = String(name || "").trim().toLocaleLowerCase("tr-TR");
  return wanted ? reports.find((report) => String(report.player?.name || "").trim().toLocaleLowerCase("tr-TR") === wanted) || null : null;
}

/** Bir oyuncunun gözünden skor ve sonuç. FACEIT skoru biliniyorsa o kullanılır. */
export function perspective(analysis, report, { faceit = null } = {}) {
  const side = firstSide(report);
  const teamLabel = side ? `İlk yarı ${side}` : "Takımı belirsiz";
  let userScore;
  let enemyScore;
  if (faceit?.score && Number.isFinite(Number(faceit.score.userScore)) && Number.isFinite(Number(faceit.score.enemyScore))
    && normalizeSteamId(faceit.userStats?.steamid) === normalizeSteamId(report?.player?.steamid)) {
    userScore = Number(faceit.score.userScore);
    enemyScore = Number(faceit.score.enemyScore);
  } else {
    const paths = Array.isArray(report?.roundPaths) ? report.roundPaths : [];
    if (paths.length) {
      userScore = paths.filter((path) => path.won).length;
      enemyScore = paths.filter((path) => !path.won).length;
    } else {
      // Oyuncu hiç round rotası bırakmadıysa takım skoru round olaylarından okunur.
      const rounds = analysis?.roundEvents || [];
      userScore = rounds.filter((round, index) => round.winnerSide === (index < 12 ? side : side === "CT" ? "T" : "CT")).length;
      enemyScore = rounds.length - userScore;
    }
  }
  const result = userScore > enemyScore ? "W" : userScore < enemyScore ? "L" : "T";
  return {
    teamLabel,
    userScore,
    enemyScore,
    result,
    resultText: result === "W" ? "Galibiyet" : result === "L" ? "Mağlubiyet" : "Beraberlik",
    rawScore: `${userScore} - ${enemyScore}`,
  };
}

/** Motorun buildDiscordReportImageModel'inin beklediği maç nesnesi. */
export function reportMatch(storedMatch, analysis, viewer = {}) {
  const report = findReport(analysis, viewer) || analysis?.reports?.[0] || null;
  const view = report ? perspective(analysis, report, { faceit: storedMatch?.meta?.faceit }) : null;
  const players = [];
  for (const team of teamsFromAnalysis(analysis)) for (const player of team.players) players.push({ ...player, team: team.label });
  return {
    id: storedMatch?.id,
    map: storedMatch?.map || normalizeMapName(analysis?.header?.map_name),
    mode: storedMatch?.meta?.mode || "CS2",
    timestamp: storedMatch?.played_at || null,
    players,
    fullAnalysis: analysis,
    userStats: report ? { steamid: normalizeSteamId(report.player?.steamid), name: report.player?.name } : null,
    score: view ? { userTeam: view.teamLabel, userScore: view.userScore, enemyScore: view.enemyScore, result: view.resultText, isWin: view.result === "W", isTie: view.result === "T", rawScore: view.rawScore } : null,
    viewerReport: report,
  };
}

function personalRow({ userId, match, analysis, report }) {
  const view = perspective(analysis, report, { faceit: match.meta?.faceit });
  const summary = buildCompactSummaryFromReport(report);
  const kast = scoreMatchReport(report)?.overall ?? null;
  return {
    user_id: userId,
    match_id: match.id,
    steam_id: normalizeSteamId(report.player?.steamid) || null,
    player_name: String(report.player?.name || ""),
    played_at: match.played_at ?? null,
    map: match.map,
    source: match.source,
    result: view.result,
    user_score: view.userScore,
    enemy_score: view.enemyScore,
    kills: Number(report.kills) || 0,
    deaths: Number(report.deaths) || 0,
    assists: Number(report.assists) || 0,
    adr: Number.isFinite(Number(report.adr)) ? Number(report.adr) : null,
    hs: Number.isFinite(Number(report.headshotPercent)) ? Number(report.headshotPercent) : null,
    kast: Number.isFinite(Number(kast)) ? Number(kast) : null,
    summary,
  };
}

/**
 * Analizi kaydeder. Demoda SteamID'si bağlı olan her Discord kullanıcısının
 * geçmişine bu maç eklenir; isteyen kişi bulunamazsa oyuncu seçimi istenir.
 */
export function persistAnalysis({ store, matchId, source, analysis, analysisFile, sha256 = null, playedAt = null, meta = {}, requesterId, playerHint = null }) {
  const map = normalizeMapName(analysis?.header?.map_name || meta.map || "unknown");
  const match = store.saveMatch({
    id: matchId,
    source,
    map,
    played_at: playedAt,
    analyzed_at: Date.now(),
    demo_sha256: sha256,
    rounds: Array.isArray(analysis?.roundEvents) ? analysis.roundEvents.length : null,
    meta: {
      ...meta,
      teams: teamsFromAnalysis(analysis),
      tickRate: analysis?.tickRate ?? null,
      parserVersion: analysis?.parserVersion,
      serverName: String(analysis?.header?.server_name || "").slice(0, 120),
    },
    analysis_file: analysisFile,
    analysis_version: analysis?.analysisVersion || null,
    requested_by: requesterId,
  });

  const participants = [];
  for (const report of analysis?.reports || []) {
    const steamid = normalizeSteamId(report.player?.steamid);
    if (!steamid) continue;
    for (const user of store.usersBySteamId(steamid)) {
      store.upsertUserMatch(personalRow({ userId: user.id, match, analysis, report }));
      participants.push({ userId: user.id, steamid, name: report.player?.name, isRequester: user.id === requesterId });
    }
  }

  let requesterReport = null;
  const requester = store.getUser(requesterId);
  if (requester?.steam_id) requesterReport = findReport(analysis, { steamid: requester.steam_id });
  if (!requesterReport && playerHint) {
    requesterReport = findReport(analysis, { steamid: playerHint, name: playerHint });
    if (requesterReport) {
      store.upsertUserMatch(personalRow({ userId: requesterId, match, analysis, report: requesterReport }));
      participants.push({ userId: requesterId, steamid: normalizeSteamId(requesterReport.player?.steamid), name: requesterReport.player?.name, isRequester: true });
    }
  }

  // Takım koçu arşivi: iki doğrulanmış beşli varsa koordinatsız kompakt kayıt.
  let squadArchived = false;
  try {
    const compact = extractSquadMatch({ id: match.id, source, map, timestamp: playedAt || Date.now(), fullAnalysis: analysis, fileName: `${match.id}.dem` });
    if (compact) {
      let timeline = null;
      try { timeline = buildRoundTimeline(analysis, map); } catch { timeline = null; }
      store.saveSquadMatch(timeline?.rounds?.length ? { ...compact, timeline } : compact);
      squadArchived = true;
    }
  } catch {
    squadArchived = false;
  }

  return { match, participants, requesterReport, needsPlayerChoice: !requesterReport, squadArchived };
}

/** Oyuncu seçildikten sonra (bu demoda sen hangisisin?) kişisel satırı ekler. */
export function attachPlayerToUser({ store, match, analysis, userId, steamid }) {
  const report = findReport(analysis, { steamid });
  if (!report) return null;
  store.upsertUserMatch(personalRow({ userId, match, analysis, report }));
  return report;
}
