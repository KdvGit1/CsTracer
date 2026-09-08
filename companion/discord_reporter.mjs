import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { kastContributionGrade, scoreMatchReport } from "../shared/scoring.mjs";

const CONFIG_FILE = "discord_config.json";
const STATE_FILE = "discord_outbox.json";
const MAX_OUTBOX = 30;
const MAX_SENT_IDS = 200;
const REQUEST_TIMEOUT_MS = 8_000;
const MAX_RETRY_MS = 6 * 60 * 60 * 1_000;
const DISCORD_API_VERSION = "10";
const REPORT_IMAGE_NAME = "tracer-match.png";
const RENDER_SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "render_discord_report.ps1");
const execFileAsync = promisify(execFile);

export const DEFAULT_DISCORD_SETTINGS = Object.freeze({
  enabled: false,
  mode: "webhook",
  channelId: "",
  threadId: "",
  notifyRoleId: "",
});

function atomicWriteJson(path, value) {
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, JSON.stringify(value, null, 2), "utf8");
  renameSync(temporary, path);
}

function readJson(path, fallback) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
}

function text(value, maximum = 1024) {
  const cleaned = [...String(value ?? "")]
    .filter((character) => {
      const code = character.codePointAt(0) || 0;
      return code === 9 || code === 10 || code === 13 || (code >= 32 && code !== 127);
    })
    .join("")
    .trim();
  if (cleaned.length <= maximum) return cleaned;
  return `${cleaned.slice(0, Math.max(0, maximum - 1)).trimEnd()}…`;
}

function finite(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatNumber(value, digits = 1) {
  const parsed = finite(value);
  if (parsed === null) return "—";
  return new Intl.NumberFormat("tr-TR", { maximumFractionDigits: digits }).format(parsed);
}

function formatPercent(value) {
  const parsed = finite(value);
  return parsed === null ? "Ölçülemedi" : `%${formatNumber(parsed)}`;
}

function normalizeSnowflake(value) {
  const candidate = String(value || "").trim();
  return /^\d{16,22}$/.test(candidate) ? candidate : "";
}

export function normalizeWebhookUrl(value) {
  const candidate = String(value || "").trim();
  if (!candidate) return "";
  let parsed;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new Error("Discord webhook adresi geçerli bir URL değil.");
  }
  if (parsed.protocol !== "https:" || !["discord.com", "discordapp.com"].includes(parsed.hostname) || parsed.port || parsed.username || parsed.password) {
    throw new Error("Yalnız Discord'un HTTPS webhook adresleri kabul edilir.");
  }
  const match = parsed.pathname.match(/^\/api(?:\/v\d+)?\/webhooks\/(\d{16,22})\/([A-Za-z0-9._-]{20,})\/?$/);
  if (!match) throw new Error("Webhook adresinin /api/webhooks/KIMLIK/ANAHTAR biçiminde olması gerekir.");
  return `https://discord.com/api/webhooks/${match[1]}/${match[2]}`;
}

function sanitizeStoredConfig(value = {}) {
  return {
    ...DEFAULT_DISCORD_SETTINGS,
    enabled: value.enabled === true,
    mode: value.mode === "bot" ? "bot" : "webhook",
    webhookUrl: typeof value.webhookUrl === "string" ? value.webhookUrl : "",
    botToken: typeof value.botToken === "string" ? value.botToken : "",
    channelId: normalizeSnowflake(value.channelId),
    threadId: normalizeSnowflake(value.threadId),
    notifyRoleId: normalizeSnowflake(value.notifyRoleId),
  };
}

function validateEnabledConfig(config) {
  if (!config.enabled) return;
  if (config.mode === "webhook") {
    if (!config.webhookUrl) throw new Error("Discord gönderimini açmak için webhook adresi gerekli.");
    normalizeWebhookUrl(config.webhookUrl);
    return;
  }
  if (!config.botToken || /\s/.test(config.botToken) || config.botToken.length < 30 || config.botToken.length > 220) {
    throw new Error("Geçerli Discord bot tokenı gerekli.");
  }
  if (!normalizeSnowflake(config.channelId)) throw new Error("Bot modu için kanal kimliği gerekli.");
}

function maskSecret(value, visibleStart = 8) {
  const candidate = String(value || "");
  if (!candidate) return "";
  return `${candidate.slice(0, visibleStart)}…${candidate.slice(-4)}`;
}

function mapTitle(value) {
  const cleaned = String(value || "Bilinmeyen harita").replace(/^de_/, "");
  return cleaned ? cleaned.charAt(0).toLocaleUpperCase("tr-TR") + cleaned.slice(1) : "Bilinmeyen harita";
}

function teamKey(value) {
  const source = String(value || "");
  const numeric = source.match(/(?:team|takım)\s*(\d+)/i)?.[1];
  return numeric ? `team-${numeric}` : source.toLocaleLowerCase("tr-TR").trim();
}

function resultColor(result) {
  if (/galibiyet/i.test(String(result))) return 0xc8f54d;
  if (/mağlubiyet/i.test(String(result))) return 0xff6f77;
  return 0xf4c95d;
}

function samePlayer(left, right) {
  const leftSteamId = String(left?.steamid || "");
  const rightSteamId = String(right?.steamid || "");
  if (leftSteamId && rightSteamId) return leftSteamId === rightSteamId;
  const leftName = String(left?.name || "").toLocaleLowerCase("tr-TR").trim();
  const rightName = String(right?.name || "").toLocaleLowerCase("tr-TR").trim();
  return Boolean(leftName && rightName && leftName === rightName);
}

function ownTeamGroup(match, reports, profile) {
  const roster = Array.isArray(match?.players) ? match.players : [];
  const identity = profile || match?.userStats || null;
  const personalReport = reports.find((report) => samePlayer(report?.player, identity)) || null;
  const personalRoster = roster.find((player) => samePlayer(player, identity || personalReport?.player)) || null;
  const ownTeamKey = teamKey(personalRoster?.team || personalRoster?.teamName || match?.score?.userTeam);

  if (ownTeamKey) {
    const ownRoster = roster.filter((player) => teamKey(player.team || player.teamName) === ownTeamKey);
    const ownReports = reports.filter((report) => ownRoster.some((player) => samePlayer(player, report?.player)));
    if (personalReport && !ownReports.includes(personalReport)) ownReports.push(personalReport);
    if (ownReports.length) return { key: ownTeamKey, label: "Senin takımın", reports: ownReports.slice(0, 5) };
  }

  // Eski analizlerde takım etiketi bulunmayabilir. Rakip bilgisini yanlışlıkla
  // göndermek yerine yalnız doğrulanabilen kişisel satırı kullan.
  if (personalReport) return { key: ownTeamKey || "personal", label: "Senin takımın", reports: [personalReport] };
  if (reports.length <= 5) return { key: ownTeamKey || "single-team", label: "Senin takımın", reports: reports.slice(0, 5) };
  throw new Error("Kendi takımın doğrulanamadı; rakip oyuncu bilgisi gönderilmedi. Önce kişisel oyuncunu seçip maçı yeniden aç.");
}

function opponentTeamGroup(match, reports, ownGroup) {
  const roster = Array.isArray(match?.players) ? match.players : [];
  const ownTeamIsKnown = roster.some((player) => teamKey(player.team || player.teamName) === ownGroup.key);
  if (ownTeamIsKnown) {
    const candidates = new Map();
    for (const player of roster) {
      const key = teamKey(player.team || player.teamName);
      if (!key || key === ownGroup.key) continue;
      if (!candidates.has(key)) candidates.set(key, []);
      const report = reports.find((item) => samePlayer(item?.player, player));
      if (report && !candidates.get(key).includes(report)) candidates.get(key).push(report);
    }
    const best = [...candidates.entries()].sort((left, right) => right[1].length - left[1].length)[0];
    if (best?.[1]?.length) return { key: best[0], label: "Rakip takım", reports: best[1].slice(0, 5) };
  }

  // Tam beşli kendi takım kesin olarak ayrıldıysa geriye kalan raporlar rakiptir.
  if (ownGroup.reports.length === 5) {
    const remaining = reports.filter((report) => !ownGroup.reports.some((ownReport) => samePlayer(ownReport?.player, report?.player)));
    if (remaining.length > 0 && remaining.length <= 5) return { key: "opponent", label: "Rakip takım", reports: remaining };
  }
  return { key: "opponent-unavailable", label: "Rakip takım", reports: [] };
}

function metricColor(value) {
  const measured = finite(value);
  if (measured === null) return "#96A39C";
  if (measured >= 80) return "#C8F54D";
  if (measured >= 70) return "#66D98A";
  if (measured >= 60) return "#F4C95D";
  return "#FF6F77";
}

function detailedImageRow(report, identity) {
  const scorecard = scoreMatchReport(report);
  const kast = scorecard?.overall ?? null;
  const movement = report?.movementProfile;
  const spray = report?.sprayStats;
  const duel = report?.duelStats;
  const recommendation = Array.isArray(report?.recommendations) ? report.recommendations[0] : null;
  return {
    name: text(report?.player?.name || "Bilinmeyen oyuncu", 70),
    highlighted: samePlayer(report?.player, identity),
    kda: `${formatNumber(report?.kills, 0)}/${formatNumber(report?.deaths, 0)}/${formatNumber(report?.assists, 0)}`,
    adr: formatNumber(report?.adr),
    hs: formatPercent(report?.headshotPercent),
    kast: formatPercent(kast),
    kastColor: metricColor(kast),
    survival: formatPercent(report?.survivalPercent),
    opening: `${formatNumber(report?.openingKills, 0)}-${formatNumber(report?.openingDeaths, 0)}`,
    trade: formatPercent(report?.tradePercent),
    utility: formatNumber(report?.utilityDamage, 0),
    flash: finite(report?.enemyBlindSeconds) === null ? "—" : `${formatNumber(report.enemyBlindSeconds)} sn`,
    movement: movement?.status === "measured" && finite(movement.invalidShotPercent) !== null
      ? formatPercent(100 - Number(movement.invalidShotPercent)) : "—",
    spray: spray?.status === "measured" ? `${formatPercent(spray.earlyAccuracy)}/${formatPercent(spray.lateAccuracy)}` : "—",
    duel: duel?.duelStatus === "measured" ? `${formatPercent(duel.duelWinrate)} (n${Number(duel.duelTotal) || 0})` : "—",
    reaction: report?.duelAnalyst?.reaction ? {
      medianMs: report.duelAnalyst.reaction.medianMs,
      sampleCount: report.duelAnalyst.reaction.samples.length,
      samples: report.duelAnalyst.reaction.samples.map((s) => ({ round: s.round, ms: s.ms })),
      histogram: report.duelAnalyst.reaction.histogram,
    } : null,
    note: text(recommendation?.title || (scorecard?.grade ?? "Ölçülemedi"), 100),
  };
}

function compactImageRow(report) {
  const scorecard = scoreMatchReport(report);
  const kast = scorecard?.overall ?? null;
  return {
    name: text(report?.player?.name || "Bilinmeyen oyuncu", 70),
    kda: `${formatNumber(report?.kills, 0)}/${formatNumber(report?.deaths, 0)}/${formatNumber(report?.assists, 0)}`,
    adr: formatNumber(report?.adr),
    kast: formatPercent(kast),
    kastColor: metricColor(kast),
    grade: scorecard?.grade || kastContributionGrade(kast),
  };
}

export function buildDiscordReportImageModel(match, profile = null) {
  const reports = Array.isArray(match?.fullAnalysis?.reports) ? match.fullAnalysis.reports.filter(Boolean).slice(0, 10) : [];
  if (!reports.length) throw new Error("Discord raporu için oyuncu analizleri bulunamadı.");
  const ownGroup = ownTeamGroup(match, reports, profile);
  const opponentGroup = opponentTeamGroup(match, reports, ownGroup);
  const identity = profile || match?.userStats || null;
  const result = String(match?.score?.result || "Sonuç bilinmiyor");
  const scoreText = match?.score?.rawScore
    || (finite(match?.score?.userScore) !== null && finite(match?.score?.enemyScore) !== null
      ? `${match.score.userScore} - ${match.score.enemyScore}` : "—");
  const ownKast = averageMeasured(ownGroup.reports, (report) => scoreMatchReport(report)?.overall);
  const ownAdr = averageMeasured(ownGroup.reports, (report) => report?.adr);
  const opponentKast = averageMeasured(opponentGroup.reports, (report) => scoreMatchReport(report)?.overall);
  const opponentAdr = averageMeasured(opponentGroup.reports, (report) => report?.adr);
  const timestamp = finite(match?.timestamp);
  const dateLabel = timestamp !== null && timestamp > 1 && Number.isFinite(new Date(timestamp).getTime())
    ? new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(timestamp)) : "Tarih bilinmiyor";
  return {
    title: `${mapTitle(match?.map || match?.fullAnalysis?.header?.map_name)} · ${scoreText} · ${result}`,
    mapName: mapTitle(match?.map || match?.fullAnalysis?.header?.map_name),
    scoreText,
    subtitle: `${dateLabel} · ${text(match?.mode || "CS2", 80)}`,
    result,
    ownSummary: `Skor ${formatNumber(match?.score?.userScore, 0)} · Ortalama ${formatPercent(ownKast)} KAST · ${formatNumber(ownAdr)} ADR`,
    opponentSummary: `Skor ${formatNumber(match?.score?.enemyScore, 0)} · Ortalama ${formatPercent(opponentKast)} KAST · ${formatNumber(opponentAdr)} ADR`,
    ownRows: ownGroup.reports.map((report) => detailedImageRow(report, identity)),
    opponentRows: opponentGroup.reports.map(compactImageRow),
  };
}

export function sampleReportImageModel() {
  const ownRows = [
    ["Deneme", "21/14/6", "94,2", "%52", "%81", "%65", "4-2", "%71", "142", "8,4 sn", "%91", "%31/%22", "%63 (n8)", "Round katkısını koru"],
    ["Kuzey", "18/16/5", "82,6", "%48", "%74", "%55", "2-2", "%60", "98", "5,1 sn", "%87", "%27/%18", "%50 (n6)", "İlk mermi disiplinini geliştir"],
    ["Gölge", "16/15/8", "79,4", "%41", "%72", "%50", "1-2", "%67", "176", "11,2 sn", "%89", "%25/%17", "%57 (n7)", "Bomba zamanlamasına dikkat et"],
    ["Şimşek", "14/17/4", "68,7", "%55", "%63", "%45", "2-4", "%47", "84", "3,7 sn", "%82", "%22/%14", "%40 (n5)", "İlk düellolarda daha güvenli açı seç"],
    ["Poyraz", "12/16/7", "65,3", "%38", "%61", "%40", "1-3", "%56", "121", "6,8 sn", "%85", "%24/%16", "%43 (n7)", "Takas için takımına yakın oyna"],
  ].map((values, index) => ({
    name: values[0], highlighted: index === 0, kda: values[1], adr: values[2], hs: values[3], kast: values[4],
    survival: values[5], opening: values[6], trade: values[7], utility: values[8], flash: values[9], movement: values[10],
    spray: values[11], duel: values[12], note: values[13], kastColor: metricColor(Number(String(values[4]).replace("%", ""))),
  }));
  const opponentRows = [
    ["Rakip 1", "19/17/3", "84,1", "%76"], ["Rakip 2", "16/18/4", "73,8", "%68"],
    ["Rakip 3", "15/17/6", "71,2", "%66"], ["Rakip 4", "13/19/5", "64,5", "%61"], ["Rakip 5", "10/19/7", "58,9", "%57"],
  ].map((values) => ({ name: values[0], kda: values[1], adr: values[2], kast: values[3], kastColor: metricColor(Number(values[3].slice(1))), grade: kastContributionGrade(Number(values[3].slice(1))) }));
  return {
    title: "Anubis · 13 - 8 · Galibiyet",
    mapName: "Anubis",
    scoreText: "13 - 8",
    subtitle: "TRACER örnek raporu · Test görseli",
    result: "Galibiyet",
    ownSummary: "Skor 13 · Ortalama %70,2 KAST · 78 ADR",
    opponentSummary: "Skor 8 · Ortalama %65,6 KAST · 70,5 ADR",
    ownRows: ownRows.map((row, i) => ({ ...row, reaction: { medianMs: 250 + i * 20, sampleCount: 5,
      samples: [180, 250, 320, 210, 460].map((ms, n) => ({ round: n + 1, ms: ms + i * 20 })),
      histogram: [{ count: 0 }, { count: 2 }, { count: 2 }, { count: 1 }, { count: 0 }],
    } })),
    opponentRows,
  };
}

export async function renderDiscordReportPng(model, dataDir) {
  const renderDir = join(dataDir, `discord-render-${randomUUID()}`);
  const inputPath = join(renderDir, "report.json");
  const outputPath = join(renderDir, REPORT_IMAGE_NAME);
  mkdirSync(renderDir, { recursive: true });
  try {
    writeFileSync(inputPath, JSON.stringify(model), "utf8");
    await execFileAsync("powershell.exe", [
      "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
      "-File", RENDER_SCRIPT, "-InputJson", inputPath, "-OutputPng", outputPath,
    ], { windowsHide: true, timeout: 20_000, maxBuffer: 512 * 1024 });
    const image = readFileSync(outputPath);
    if (image.length < 100 || image.length > 8 * 1024 * 1024 || image.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") {
      throw new Error("Oluşturulan Discord rapor görseli geçerli PNG değil.");
    }
    return image;
  } catch (error) {
    throw new Error(`Discord tablo görseli oluşturulamadı: ${text(error instanceof Error ? error.message : String(error), 300)}`);
  } finally {
    rmSync(renderDir, { recursive: true, force: true });
  }
}

function averageMeasured(reports, selector) {
  const values = reports.map(selector).map(finite).filter((value) => value !== null);
  if (!values.length) return null;
  return Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 10) / 10;
}

function mentionEnvelope(config) {
  const roleId = normalizeSnowflake(config.notifyRoleId);
  return {
    content: roleId ? `<@&${roleId}> Yeni TRACER maç raporu hazır.` : "",
    allowed_mentions: { parse: [], roles: roleId ? [roleId] : [], users: [] },
  };
}

export function buildDiscordMatchMessages(match, settings = {}, profile = null) {
  const config = sanitizeStoredConfig(settings);
  const model = buildDiscordReportImageModel(match, profile);
  const messages = [{
    content: "",
    username: "TRACER CS2",
    allowed_mentions: { parse: [], roles: [], users: [] },
    attachments: [{ id: 0, filename: REPORT_IMAGE_NAME, description: "TRACER maç sonu takım tablosu" }],
    embeds: [{
      author: { name: "TRACER · CS2 MAÇ SONU" },
      title: text(model.title, 256),
      description: "Bizim takım ayrıntılı, rakip takım kısa özet halinde tek görselde.",
      color: resultColor(model.result),
      image: { url: `attachment://${REPORT_IMAGE_NAME}` },
      footer: { text: "KAST profesyonel rating değildir; round katkısıdır." },
    }],
  }];
  Object.assign(messages[0], mentionEnvelope(config));
  return messages;
}

function imageMessageForModel(model, config, test = false) {
  const message = {
    content: "",
    allowed_mentions: { parse: [], roles: [], users: [] },
    username: "TRACER CS2",
    attachments: [{ id: 0, filename: REPORT_IMAGE_NAME, description: test ? "TRACER Discord tablo testi" : "TRACER maç sonu takım tablosu" }],
    embeds: [{
      author: { name: test ? "TRACER · TABLO GÖRSELİ TESTİ" : "TRACER · CS2 MAÇ SONU" },
      title: text(model.title, 256),
      description: test ? "Bu görsel Discord bağlantısı ve tablo görünümü testi için gönderildi." : "Bizim takım ayrıntılı, rakip takım kısa özet halinde tek görselde.",
      color: resultColor(model.result),
      image: { url: `attachment://${REPORT_IMAGE_NAME}` },
      footer: { text: "KAST profesyonel rating değildir; round katkısıdır." },
    }],
  };
  if (!test) Object.assign(message, mentionEnvelope(config));
  return message;
}

function retryDelay(attempts) {
  return Math.min(MAX_RETRY_MS, Math.max(15_000, 15_000 * (2 ** Math.min(8, attempts))));
}

function defaultRuntimeState() {
  return {
    outbox: [],
    sentMatchIds: [],
    lastAttemptAt: 0,
    lastSuccessAt: 0,
    lastFailureAt: 0,
    lastMatchId: "",
    lastError: "",
  };
}

export class DiscordReporter {
  constructor(dataDir, { fetchImpl = globalThis.fetch, now = () => Date.now(), schedule = setTimeout, imageRenderer = null } = {}) {
    this.dataDir = dataDir;
    this.configPath = join(dataDir, CONFIG_FILE);
    this.statePath = join(dataDir, STATE_FILE);
    this.fetchImpl = fetchImpl;
    this.imageRenderer = imageRenderer || ((model) => renderDiscordReportPng(model, this.dataDir));
    this.now = now;
    this.scheduleImpl = schedule;
    this.processing = false;
    this.timer = null;
    mkdirSync(dataDir, { recursive: true });
    this.config = sanitizeStoredConfig(readJson(this.configPath, {}));
    const storedState = readJson(this.statePath, defaultRuntimeState());
    this.runtime = {
      ...defaultRuntimeState(),
      ...storedState,
      outbox: Array.isArray(storedState?.outbox) ? storedState.outbox.slice(0, MAX_OUTBOX) : [],
      sentMatchIds: Array.isArray(storedState?.sentMatchIds) ? storedState.sentMatchIds.slice(0, MAX_SENT_IDS) : [],
    };
  }

  start() {
    if (this.config.enabled && this.runtime.outbox.length) this.schedule(50);
  }

  stop() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  publicState() {
    return {
      settings: {
        ...DEFAULT_DISCORD_SETTINGS,
        enabled: this.config.enabled,
        mode: this.config.mode,
        channelId: this.config.channelId,
        threadId: this.config.threadId,
        notifyRoleId: this.config.notifyRoleId,
        hasWebhookUrl: Boolean(this.config.webhookUrl),
        webhookMasked: this.config.webhookUrl ? maskSecret(this.config.webhookUrl, 34) : "",
        hasBotToken: Boolean(this.config.botToken),
        botTokenMasked: maskSecret(this.config.botToken, 5),
      },
      connection: {
        status: !this.config.enabled ? "disabled" : this.processing ? "sending" : this.runtime.lastError ? "error" : this.runtime.lastSuccessAt ? "connected" : "unverified",
        pendingCount: this.runtime.outbox.length,
        lastAttemptAt: Number(this.runtime.lastAttemptAt) || 0,
        lastSuccessAt: Number(this.runtime.lastSuccessAt) || 0,
        lastFailureAt: Number(this.runtime.lastFailureAt) || 0,
        lastMatchId: String(this.runtime.lastMatchId || ""),
        lastError: text(this.runtime.lastError, 500),
      },
    };
  }

  saveSettings(input = {}) {
    const previousDestination = JSON.stringify({
      mode: this.config.mode,
      webhookUrl: this.config.webhookUrl,
      botToken: this.config.botToken,
      channelId: this.config.channelId,
      threadId: this.config.threadId,
    });
    const next = { ...this.config };
    if (Object.hasOwn(input, "enabled")) next.enabled = input.enabled === true;
    if (Object.hasOwn(input, "mode")) next.mode = input.mode === "bot" ? "bot" : "webhook";
    if (Object.hasOwn(input, "channelId")) {
      const raw = String(input.channelId || "").trim();
      if (raw && !normalizeSnowflake(raw)) throw new Error("Kanal kimliği 16-22 haneli Discord kimliği olmalı.");
      next.channelId = normalizeSnowflake(raw);
    }
    if (Object.hasOwn(input, "threadId")) {
      const raw = String(input.threadId || "").trim();
      if (raw && !normalizeSnowflake(raw)) throw new Error("Alt kanal kimliği 16-22 haneli Discord kimliği olmalı.");
      next.threadId = normalizeSnowflake(raw);
    }
    if (Object.hasOwn(input, "notifyRoleId")) {
      const raw = String(input.notifyRoleId || "").trim();
      if (raw && !normalizeSnowflake(raw)) throw new Error("Rol kimliği 16-22 haneli Discord kimliği olmalı.");
      next.notifyRoleId = normalizeSnowflake(raw);
    }
    if (input.clearWebhookUrl === true) next.webhookUrl = "";
    else if (typeof input.webhookUrl === "string" && input.webhookUrl.trim()) next.webhookUrl = normalizeWebhookUrl(input.webhookUrl);
    if (input.clearBotToken === true) next.botToken = "";
    else if (typeof input.botToken === "string" && input.botToken.trim()) next.botToken = input.botToken.trim();
    validateEnabledConfig(next);
    this.config = sanitizeStoredConfig(next);
    const nextDestination = JSON.stringify({
      mode: this.config.mode,
      webhookUrl: this.config.webhookUrl,
      botToken: this.config.botToken,
      channelId: this.config.channelId,
      threadId: this.config.threadId,
    });
    atomicWriteJson(this.configPath, this.config);
    this.runtime.lastError = "";
    if (previousDestination !== nextDestination) this.runtime.lastSuccessAt = 0;
    this.runtime.outbox = this.runtime.outbox.map((job) => ({ ...job, paused: false, attempts: 0, nextAttemptAt: this.now() }));
    this.persistRuntime();
    if (this.config.enabled && this.runtime.outbox.length) this.schedule(50);
    return this.publicState();
  }

  disconnect() {
    this.stop();
    this.config = sanitizeStoredConfig({});
    this.runtime = defaultRuntimeState();
    atomicWriteJson(this.configPath, this.config);
    this.persistRuntime();
    return this.publicState();
  }

  enqueue(match, { profile = null, force = false } = {}) {
    if (!this.config.enabled) return { queued: false, reason: "disabled" };
    validateEnabledConfig(this.config);
    const matchId = text(match?.id || `local-${Number(match?.timestamp) || this.now()}`, 500);
    if (!force && (this.runtime.sentMatchIds.includes(matchId) || this.runtime.outbox.some((job) => job.matchId === matchId))) {
      return { queued: false, reason: "duplicate", matchId };
    }
    const messages = buildDiscordMatchMessages(match, this.config, profile);
    const imageModel = buildDiscordReportImageModel(match, profile);
    if (force) this.runtime.outbox = this.runtime.outbox.filter((job) => job.matchId !== matchId);
    this.runtime.outbox.push({
      id: `${matchId}:${this.now()}`,
      matchId,
      createdAt: this.now(),
      attempts: 0,
      nextAttemptAt: this.now(),
      nextMessageIndex: 0,
      messages,
      imageModel,
    });
    this.runtime.outbox = this.runtime.outbox.slice(-MAX_OUTBOX);
    this.runtime.lastError = "";
    this.persistRuntime();
    this.schedule(10);
    return { queued: true, matchId, messageCount: messages.length };
  }

  async sendTest({ match = null, profile = null } = {}) {
    if (!this.config.enabled) throw new Error("Önce Discord maç gönderimini açıp ayarları kaydet.");
    validateEnabledConfig(this.config);
    this.runtime.lastAttemptAt = this.now();
    this.persistRuntime();
    try {
      const imageModel = match?.fullAnalysis ? buildDiscordReportImageModel(match, profile) : sampleReportImageModel();
      const image = await this.imageRenderer(imageModel);
      await this.sendMessage(imageMessageForModel(imageModel, this.config, true), image);
      this.runtime.lastSuccessAt = this.now();
      this.runtime.lastError = "";
      this.persistRuntime();
      return this.publicState();
    } catch (error) {
      this.runtime.lastFailureAt = this.now();
      this.runtime.lastError = error instanceof Error ? error.message : String(error);
      this.persistRuntime();
      throw error;
    }
  }

  schedule(delayMs = 0) {
    if (this.timer || !this.config.enabled) return;
    this.timer = this.scheduleImpl(() => {
      this.timer = null;
      void this.processQueue();
    }, Math.max(0, delayMs));
    if (typeof this.timer?.unref === "function") this.timer.unref();
  }

  persistRuntime() {
    atomicWriteJson(this.statePath, this.runtime);
  }

  async processQueue() {
    if (this.processing || !this.config.enabled || !this.runtime.outbox.length) return;
    this.processing = true;
    try {
      const job = this.runtime.outbox[0];
      if (job.paused) return;
      const waitMs = Number(job.nextAttemptAt) - this.now();
      if (waitMs > 0) {
        this.schedule(waitMs);
        return;
      }
      this.runtime.lastAttemptAt = this.now();
      const image = job.imageModel ? await this.imageRenderer(job.imageModel) : null;
      while (job.nextMessageIndex < job.messages.length) {
        await this.sendMessage(job.messages[job.nextMessageIndex], job.nextMessageIndex === 0 ? image : null);
        job.nextMessageIndex += 1;
        this.persistRuntime();
      }
      this.runtime.outbox.shift();
      this.runtime.sentMatchIds = [job.matchId, ...this.runtime.sentMatchIds.filter((id) => id !== job.matchId)].slice(0, MAX_SENT_IDS);
      this.runtime.lastSuccessAt = this.now();
      this.runtime.lastMatchId = job.matchId;
      this.runtime.lastError = "";
      this.persistRuntime();
    } catch (error) {
      const job = this.runtime.outbox[0];
      const attempts = (Number(job?.attempts) || 0) + 1;
      if (job) {
        job.attempts = attempts;
        job.paused = error?.permanent === true;
        const explicitRetry = Number(error?.retryAfterMs);
        job.nextAttemptAt = job.paused ? 0 : this.now() + (Number.isFinite(explicitRetry) ? explicitRetry : retryDelay(attempts));
      }
      this.runtime.lastFailureAt = this.now();
      this.runtime.lastError = error instanceof Error ? error.message : String(error);
      this.persistRuntime();
    } finally {
      this.processing = false;
      if (this.config.enabled && this.runtime.outbox.length && !this.runtime.outbox[0].paused) {
        const delay = Math.max(10, Number(this.runtime.outbox[0].nextAttemptAt) - this.now());
        this.schedule(delay);
      }
    }
  }

  async sendMessage(message, image = null) {
    const webhook = this.config.mode === "webhook";
    const url = webhook
      ? new URL(normalizeWebhookUrl(this.config.webhookUrl))
      : new URL(`https://discord.com/api/v${DISCORD_API_VERSION}/channels/${normalizeSnowflake(this.config.channelId)}/messages`);
    if (webhook) {
      url.searchParams.set("wait", "true");
      if (this.config.threadId) url.searchParams.set("thread_id", this.config.threadId);
    }
    const headers = { "User-Agent": "TRACER-CS2/DiscordReporter" };
    if (!webhook) headers.Authorization = `Bot ${this.config.botToken}`;
    const requestMessage = webhook ? message : { ...message };
    if (!webhook) delete requestMessage.username;
    let body;
    if (image) {
      const form = new FormData();
      form.append("payload_json", JSON.stringify(requestMessage));
      form.append("files[0]", new Blob([image], { type: "image/png" }), REPORT_IMAGE_NAME);
      body = form;
    } else {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(requestMessage);
    }
    let response;
    try {
      response = await this.fetchImpl(url, {
        method: "POST",
        headers,
        body,
        redirect: "error",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      const safe = new Error(error?.name === "TimeoutError" ? "Discord 8 saniye içinde yanıt vermedi; rapor kuyrukta tutuluyor." : "Discord ağına ulaşılamadı; rapor kuyrukta tutuluyor.");
      safe.cause = error;
      throw safe;
    }
    let payload = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
    if (response.ok) return payload;
    if (response.status === 429) {
      const retrySeconds = finite(payload?.retry_after) ?? finite(response.headers.get("retry-after")) ?? 15;
      const rateError = new Error(`Discord hız sınırı uyguladı; ${Math.ceil(retrySeconds)} saniye sonra yeniden denenecek.`);
      rateError.retryAfterMs = Math.max(1_000, Math.ceil(retrySeconds * 1_000));
      throw rateError;
    }
    if (response.status === 401) {
      const error = new Error("Discord bot tokenını kabul etmedi. Tokenı yenileyip tekrar test et.");
      error.permanent = true;
      throw error;
    }
    if (response.status === 403) {
      const error = new Error("Discord bu kanala mesaj izni vermedi. Botun Mesaj Gönder ve Bağlantı Yerleştir izinlerini kontrol et.");
      error.permanent = true;
      throw error;
    }
    if (response.status === 404) {
      const error = new Error(webhook ? "Discord webhooku bulunamadı veya silinmiş." : "Discord kanalı bulunamadı; kanal kimliğini kontrol et.");
      error.permanent = true;
      throw error;
    }
    if (response.status === 400) {
      const error = new Error(`Discord rapor biçimini kabul etmedi${payload?.message ? `: ${text(payload.message, 180)}` : "."}`);
      error.permanent = true;
      throw error;
    }
    throw new Error(`Discord geçici olarak gönderimi tamamlamadı (HTTP ${response.status}); rapor kuyrukta tutuluyor.`);
  }
}

export function hasDiscordFiles(dataDir) {
  return existsSync(join(dataDir, CONFIG_FILE)) || existsSync(join(dataDir, STATE_FILE));
}
