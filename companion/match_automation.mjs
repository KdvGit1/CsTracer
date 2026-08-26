import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { scoreMatchReport } from "../shared/scoring.mjs";

export const MIN_DEMO_RETENTION = 3;
export const MAX_DEMO_RETENTION = 50;
export const DEFAULT_DEMO_RETENTION = 5;
export const MAX_NOTIFICATIONS = 50;
export const ANALYSIS_HISTORY_LIMIT = 90;
const FALLBACK_DEMO_BYTES = 160 * 1024 * 1024;

export function clampDemoRetention(value) {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed)) return DEFAULT_DEMO_RETENTION;
  return Math.max(MIN_DEMO_RETENTION, Math.min(MAX_DEMO_RETENTION, parsed));
}

export function sanitizeAutomationSettings(value = {}) {
  return {
    demoRetentionCount: clampDemoRetention(value.demoRetentionCount),
    autoDownloadLatestMatch: value.autoDownloadLatestMatch === true,
    desktopNotifications: value.desktopNotifications === true,
  };
}

function atomicWriteJson(filePath, value) {
  const tempPath = `${filePath}.${process.pid}.tmp`;
  writeFileSync(tempPath, JSON.stringify(value, null, 2), "utf8");
  renameSync(tempPath, filePath);
}

function safeTimestamp(value, fallback = Date.now()) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function round(value, decimals = 1) {
  const scale = 10 ** decimals;
  return Math.round((Number(value) || 0) * scale) / scale;
}

function samePlayer(match, identity) {
  if (!identity) return true;
  if (identity.steamid && match?.playerSteamId) return String(match.playerSteamId) === String(identity.steamid);
  return Boolean(identity.name && match?.playerName && String(match.playerName) === String(identity.name));
}

export function buildCompactSummaryFromReport(report) {
  if (!report || typeof report !== "object") return null;
  const kills = Number(report.kills) || 0;
  const deaths = Number(report.deaths) || 0;
  const assists = Number(report.assists) || 0;
  const scorecard = scoreMatchReport(report);

  return {
    overall: scorecard?.overall ?? null,
    dimensions: scorecard?.dimensions || { aim: null, movement: null, utility: null, teamwork: null, position: null, roundImpact: null },
    stats: {
      kills,
      deaths,
      assists,
      adr: round(report.adr),
      headshotPercent: Number(report.headshotPercent) || 0,
      tradePercent: report.tradePercent === null || report.tradePercent === undefined ? null : Number(report.tradePercent),
    },
    weapons: (Array.isArray(report.weaponStats) ? report.weaponStats : []).slice(0, 6).map((weapon) => ({
      weapon: String(weapon.weapon || ""),
      label: String(weapon.label || weapon.weapon || "Silah"),
      score: weapon.score === null || weapon.score === undefined ? null : Number(weapon.score),
      kills: Number(weapon.kills) || 0,
      shots: Number(weapon.shots) || 0,
    })),
    scoreMethod: scorecard?.method,
    scoreSampleCount: scorecard?.sampleCount || 0,
  };
}

export function performanceComparison({ summary = null, livePlayer = null, progressMatches = [], identity = null, currentMatchId = "" } = {}) {
  const history = (Array.isArray(progressMatches) ? progressMatches : [])
    .filter((match) => match?.id !== currentMatchId && samePlayer(match, identity));
  if (summary) {
    const overall = summary.overall === null || summary.overall === undefined ? null : Number(summary.overall);
    if (overall === null || !Number.isFinite(overall)) return null;
    const samples = history.map((match) => {
      const value = match?.summary?.overall;
      if (value === null || value === undefined || value === "") return Number.NaN;
      return Number(value);
    }).filter(Number.isFinite);
    if (samples.length < 3) return { kind: "overall", value: overall, sampleSize: samples.length, sufficient: false };
    const baseline = round(samples.reduce((sum, value) => sum + value, 0) / samples.length);
    return {
      kind: "overall",
      value: overall,
      baseline,
      delta: round(overall - baseline),
      sampleSize: samples.length,
      sufficient: true,
    };
  }

  const kills = Number(livePlayer?.kills) || 0;
  const deaths = Number(livePlayer?.deaths) || 0;
  if (!livePlayer || deaths <= 0) return null;
  const value = round(kills / deaths, 2);
  const samples = history
    .map((match) => {
      const stats = match?.summary?.stats;
      const sampleDeaths = Number(stats?.deaths);
      if (!stats || !Number.isFinite(sampleDeaths) || sampleDeaths <= 0) return Number.NaN;
      return (Number(stats.kills) || 0) / sampleDeaths;
    })
    .filter(Number.isFinite);
  if (samples.length < 3) return { kind: "kd", value, sampleSize: samples.length, sufficient: false };
  const baseline = round(samples.reduce((sum, sample) => sum + sample, 0) / samples.length, 2);
  return { kind: "kd", value, baseline, delta: round(value - baseline, 2), sampleSize: samples.length, sufficient: true };
}

export function latestUnanalyzedScannedMatch(scannedMatches = [], recentMatches = []) {
  const latest = [...(Array.isArray(scannedMatches) ? scannedMatches : [])]
    .filter((match) => match?.id)
    .sort((left, right) => Number(right.timestamp || 0) - Number(left.timestamp || 0))[0];
  if (!latest?.replayUrl) return null;
  const analyzed = (Array.isArray(recentMatches) ? recentMatches : []).some((match) =>
    (match?.id && match.id === latest.id)
    || (match?.fileName && latest.fileName && match.fileName === latest.fileName));
  return analyzed ? null : latest;
}

function isInsideDirectory(filePath, directory) {
  const resolvedFile = resolve(filePath);
  const resolvedDirectory = `${resolve(directory)}\\`;
  return resolvedFile.toLocaleLowerCase().startsWith(resolvedDirectory.toLocaleLowerCase());
}

function demoEntries(demosDir, matches = []) {
  if (!existsSync(demosDir)) return [];
  const matchByPath = new Map(
    matches
      .filter((match) => match?.demoPath)
      .map((match) => [resolve(match.demoPath).toLocaleLowerCase(), match]),
  );
  return readdirSync(demosDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.toLocaleLowerCase().endsWith(".dem"))
    .map((entry) => {
      const path = join(demosDir, entry.name);
      const stats = statSync(path);
      const match = matchByPath.get(resolve(path).toLocaleLowerCase());
      return {
        path,
        name: entry.name,
        bytes: stats.size,
        timestamp: safeTimestamp(match?.timestamp, stats.mtimeMs || stats.birthtimeMs || Date.now()),
      };
    });
}

export function getDemoStorageStats(demosDir, retentionCount, matches = []) {
  const count = clampDemoRetention(retentionCount);
  const entries = demoEntries(demosDir, matches);
  const totalBytes = entries.reduce((sum, item) => sum + item.bytes, 0);
  const averageDemoBytes = entries.length ? Math.round(totalBytes / entries.length) : FALLBACK_DEMO_BYTES;
  return {
    retentionCount: count,
    demoCount: entries.length,
    totalBytes,
    averageDemoBytes,
    estimatedBytes: averageDemoBytes * count,
    estimateSource: entries.length ? "local-average" : "fallback",
  };
}

export function enforceDemoRetention({ demosDir, matches = [], retentionCount, protectedPaths = [] }) {
  const limit = clampDemoRetention(retentionCount);
  const protectedSet = new Set(protectedPaths.filter(Boolean).map((path) => resolve(path).toLocaleLowerCase()));
  const entries = demoEntries(demosDir, matches).sort((left, right) => right.timestamp - left.timestamp);
  const kept = [];
  const deleted = [];
  const protectedEntries = entries.filter((entry) => protectedSet.has(resolve(entry.path).toLocaleLowerCase()));
  const regularSlots = Math.max(0, limit - protectedEntries.length);
  let regularKept = 0;

  for (const entry of entries) {
    const resolvedPath = resolve(entry.path).toLocaleLowerCase();
    if (protectedSet.has(resolvedPath) || regularKept < regularSlots) {
      kept.push(entry);
      if (!protectedSet.has(resolvedPath)) regularKept += 1;
      continue;
    }
    if (!isInsideDirectory(entry.path, demosDir)) continue;
    unlinkSync(entry.path);
    deleted.push(entry);
  }

  const deletedSet = new Set(deleted.map((entry) => resolve(entry.path).toLocaleLowerCase()));
  const updatedMatches = matches.map((match) => {
    if (!match?.demoPath || !deletedSet.has(resolve(match.demoPath).toLocaleLowerCase())) return match;
    return { ...match, demoAvailable: false };
  });

  return {
    matches: updatedMatches,
    deleted,
    kept,
    storage: getDemoStorageStats(demosDir, limit, updatedMatches),
  };
}

function cleanMatchMeta(match) {
  const nullableNumber = (value) => {
    if (value === null || value === undefined || value === "") return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  };
  return {
    id: String(match?.id || "").slice(0, 500),
    map: String(match?.map || "unknown").replace(/^de_/, "").slice(0, 80),
    mode: String(match?.mode || "CS2").slice(0, 80),
    timestamp: safeTimestamp(match?.timestamp),
    formattedDate: String(match?.formattedDate || "").slice(0, 120),
    score: match?.score && typeof match.score === "object" ? {
      userScore: nullableNumber(match.score.userScore),
      enemyScore: nullableNumber(match.score.enemyScore),
      result: String(match.score.result || ""),
      rawScore: String(match.score.rawScore || ""),
    } : null,
  };
}

export class MatchAutomationStore {
  constructor(dataDir) {
    this.dataDir = dataDir;
    this.settingsPath = join(dataDir, "automation_settings.json");
    this.notificationsPath = join(dataDir, "match_notifications.json");
    mkdirSync(dataDir, { recursive: true });
  }

  getSettings() {
    try {
      if (existsSync(this.settingsPath)) return sanitizeAutomationSettings(JSON.parse(readFileSync(this.settingsPath, "utf8")));
    } catch { /* bozuk ayar dosyası varsayılana döner */ }
    return sanitizeAutomationSettings();
  }

  saveSettings(patch = {}) {
    const settings = sanitizeAutomationSettings({ ...this.getSettings(), ...patch });
    atomicWriteJson(this.settingsPath, settings);
    return settings;
  }

  listNotifications() {
    try {
      if (!existsSync(this.notificationsPath)) return [];
      const parsed = JSON.parse(readFileSync(this.notificationsPath, "utf8"));
      if (!Array.isArray(parsed)) return [];
      return parsed.sort((left, right) => Number(right.updatedAt || right.createdAt) - Number(left.updatedAt || left.createdAt)).slice(0, MAX_NOTIFICATIONS);
    } catch {
      return [];
    }
  }

  saveNotifications(items) {
    const clean = (Array.isArray(items) ? items : [])
      .sort((left, right) => Number(right.updatedAt || right.createdAt) - Number(left.updatedAt || left.createdAt))
      .slice(0, MAX_NOTIFICATIONS);
    atomicWriteJson(this.notificationsPath, clean);
    return clean;
  }

  discover(matches, { liveState = null, progressMatches = [], identity = null } = {}) {
    const now = Date.now();
    const settings = this.getSettings();
    const notifications = this.listNotifications();
    const byMatch = new Map(notifications.map((item) => [item.matchId, item]));
    const created = [];

    for (const rawMatch of Array.isArray(matches) ? matches : []) {
      const match = cleanMatchMeta(rawMatch);
      if (!match.id || byMatch.has(match.id)) continue;
      const liveMap = String(liveState?.map?.name || "").replace(/^de_/, "").toLocaleLowerCase();
      const matchMap = match.map.toLocaleLowerCase();
      const canUseLive = liveMap && matchMap && liveMap === matchMap;
      const comparison = performanceComparison({
        livePlayer: canUseLive ? liveState?.player : null,
        progressMatches,
        identity,
        currentMatchId: match.id,
      });
      const item = {
        id: `match:${match.id}`,
        matchId: match.id,
        type: "new-match",
        status: settings.autoDownloadLatestMatch ? "queued" : "detected",
        auto: settings.autoDownloadLatestMatch,
        read: false,
        createdAt: now,
        updatedAt: now,
        match,
        comparison,
        stats: canUseLive ? {
          kills: Number(liveState?.player?.kills) || 0,
          deaths: Number(liveState?.player?.deaths) || 0,
          assists: Number(liveState?.player?.assists) || 0,
        } : null,
        message: settings.autoDownloadLatestMatch
          ? "Otomatik indirme açık: maç indirme ve analiz sırasına alındı."
          : "Tam raporu hazırlamak için bildirime tıkla.",
      };
      notifications.unshift(item);
      byMatch.set(match.id, item);
      created.push(item);
    }
    this.saveNotifications(notifications);
    return created;
  }

  ensure(match, overrides = {}) {
    const existing = this.listNotifications().find((item) => item.matchId === match?.id);
    if (existing) return existing;
    const created = this.discover([match]);
    if (!created[0]) return null;
    return Object.keys(overrides).length ? this.update(match.id, overrides) : created[0];
  }

  update(matchId, patch = {}) {
    const now = Date.now();
    const notifications = this.listNotifications();
    const index = notifications.findIndex((item) => item.matchId === matchId || item.id === matchId);
    if (index < 0) return null;
    notifications[index] = { ...notifications[index], ...patch, updatedAt: now };
    this.saveNotifications(notifications);
    return notifications[index];
  }

  markAllRead() {
    const notifications = this.listNotifications().map((item) => ({ ...item, read: true }));
    this.saveNotifications(notifications);
    return notifications;
  }

  state(demosDir, matches = []) {
    const settings = this.getSettings();
    const notifications = this.listNotifications();
    return {
      settings,
      storage: getDemoStorageStats(demosDir, settings.demoRetentionCount, matches),
      notifications,
      unreadCount: notifications.filter((item) => !item.read).length,
    };
  }
}

export function demoLabelFromPath(path) {
  return basename(path || "");
}
