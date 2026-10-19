// Testler için sentetik analiz, geçici hafıza ve sahte Discord etkileşimi.
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { App } from "../src/bot/app.mjs";
import { Store } from "../src/db.mjs";
import { Renderer } from "../src/render/renderer.mjs";
import { Entitlements } from "../src/services/entitlements.mjs";
import { FaceitService } from "../src/services/faceit.mjs";
import { LiveService } from "../src/services/live.mjs";
import { SteamService } from "../src/services/steam.mjs";

export const STEAM = (index) => String(76561198000000000n + BigInt(index));

/** 10 oyunculu, 9 roundluk sentetik analiz (ilk yarı: 0-4 CT, 5-9 T; CT 7-2 kazanır). */
export function syntheticAnalysis({ rounds = 9, ctWins = 7 } = {}) {
  const roundEvents = Array.from({ length: rounds }, (_, index) => ({ round: index + 1, winnerSide: index < ctWins ? "CT" : "T" }));
  const reports = Array.from({ length: 10 }, (_, index) => {
    const side = index < 5 ? "CT" : "T";
    return {
      analysisVersion: "3.4.0",
      player: { name: `Oyuncu${index + 1}`, steamid: STEAM(index + 1) },
      map: "de_mirage",
      rounds,
      kills: 10 + index, deaths: 8, assists: 2,
      adr: 70 + index, headshotPercent: 40 + index,
      openingKills: 1, openingDeaths: 1, utilityDamage: 30, enemyBlindSeconds: 2.5, flashesThrown: 3, shots: 100,
      tradePercent: 50, kastPercent: 60 + index, survivalPercent: 30, utilityImpactRoundPercent: 20, utilityImpactRoundSampleCount: rounds,
      movementProfile: { status: "measured", sampleCount: 40, invalidShotPercent: 15 },
      sprayStats: { status: "measured", method: "bullet-damage-event-tick-v2", earlyAccuracy: 30, lateAccuracy: 20, sampleCount: 20, totalShots: 60, accuracyPercent: 25 },
      duelStats: { duelStatus: "measured", duelMethod: "mutual-spotted-death-v2", duelWinrate: 55, duelTotal: 9 },
      duelAnalyst: {
        reaction: { samples: [{ round: 1, ms: 250 + index * 10 }, { round: 2, ms: 400 }, { round: 3, ms: 300 }], medianMs: 300, histogram: [] },
        encounters: [],
        distanceProfile: [{ side, weapon: "ak47", range: "10–20 m", contacts: 3, wins: 2, losses: 1, damage: 200, winrate: 67, recommendation: null }],
      },
      roundPaths: roundEvents.map((event) => ({ round: event.round, side, won: event.winnerSide === side, points: [] })),
      sideStats: [], weaponStats: [], routeStats: [], deathDetails: [], killDetails: [],
      recommendations: [{ id: "r", title: "Takas mesafesini koru", body: "Takımına yakın oyna.", confidence: 60 }],
    };
  });
  return { header: { map_name: "de_mirage" }, players: reports.map((report) => report.player), reports, roundEvents, tickRate: 64, parserVersion: "0.42.0", analysisVersion: "3.4.0" };
}

export function tempDir(prefix = "tracer-test-") {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  mkdirSync(join(dir, "tmp"), { recursive: true });
  return dir;
}

export function writeAnalysis(dir, name, analysis) {
  mkdirSync(join(dir, "analyses"), { recursive: true });
  const path = join(dir, "analyses", `${name}.json.gz`);
  writeFileSync(path, gzipSync(JSON.stringify(analysis)));
  return path;
}

export function testConfig(dataDir, overrides = {}) {
  return {
    token: "x", clientId: "1", devGuildId: "", ownerIds: ["900000000000000001"], dataDir, secretKey: "test-key",
    steamApiKey: "", steamBot: {}, faceitApiKey: "", faceitDownloadsToken: "", publicUrl: "https://bot.example", httpPort: 0, httpHost: "127.0.0.1",
    maxDemoMb: 800, analysisConcurrency: 1, analysisMemoryMb: 2048, analysisTimeoutMin: 5, keepAnalysesPerUser: 40, keepDemos: false,
    freeDailyAnalyses: 0, premiumSkuIds: [], supportUrl: "", trackerIntervalMin: 20, logLevel: "error",
    ...overrides,
  };
}

/** Discord olmadan işleyicileri çalıştırmak için uygulama. */
export function testApp({ config: overrides = {} } = {}) {
  const dataDir = tempDir();
  const config = testConfig(dataDir, overrides);
  const store = new Store(dataDir);
  const enqueued = [];
  const shared = [];
  const app = new App({
    config,
    features: { web: Boolean(config.publicUrl), faceit: false, faceitDownloads: false, steam: false, steamDemos: false },
    store,
    renderer: new Renderer({ inProcess: true }),
    steam: new SteamService({ apiKey: "" }),
    faceit: new FaceitService({ apiKey: "", store }),
    entitlements: new Entitlements({ store, config }),
    secretKey: Buffer.alloc(32, 7),
    client: { users: { fetch: async (id) => fakeUser(id) }, channels: { fetch: async () => null } },
  });
  app.queue = {
    enqueue: (options) => { enqueued.push(options); return { job: { id: enqueued.length, ...options }, duplicate: false, position: 1 }; },
    cancel: () => true,
  };
  app.reporter = { enqueueForGuild: (guild, matchId, userId) => { shared.push({ guild: guild.id, matchId, userId }); return true; } };
  app.live = new LiveService();
  app.web = { url: (path) => `${config.publicUrl}${path}` };
  return { app, store, config, enqueued, shared, dataDir };
}

export function fakeUser(id, username = `kullanici${String(id).slice(-3)}`) {
  return { id: String(id), username, globalName: username, bot: false, displayAvatarURL: () => "", send: async () => ({}) };
}

/** Sahte etkileşim: yanıtları `calls` listesine yazar. */
export function fakeInteraction({ user = fakeUser("100000000000000001", "Kuzey"), commandName = "", subcommand = null, group = null, options = {}, customId = "", values = [], guildId = null, fields = {}, kind = "command" } = {}) {
  const calls = [];
  const record = (type) => async (payload) => { calls.push({ type, payload }); interaction.replied = interaction.replied || type !== "deferReply" && type !== "deferUpdate"; if (type.startsWith("defer")) interaction.deferred = true; return {}; };
  const interaction = {
    user,
    member: null,
    guildId,
    guild: guildId ? { id: guildId, name: "Test Sunucusu", members: { me: null }, channels: { fetch: async () => null } } : null,
    channelId: "300000000000000001",
    applicationId: "1",
    token: "tok",
    commandName,
    customId,
    values,
    replied: false,
    deferred: false,
    entitlements: new Map(),
    memberPermissions: null,
    client: { users: { fetch: async (id) => fakeUser(id) }, guilds: { cache: new Map() } },
    options: {
      getSubcommand: () => subcommand,
      getSubcommandGroup: () => group,
      getString: (name) => options[name] ?? null,
      getInteger: (name) => options[name] ?? null,
      getBoolean: (name) => options[name] ?? null,
      getUser: (name) => options[name] ?? null,
      getAttachment: (name) => options[name] ?? null,
      getChannel: (name) => options[name] ?? null,
      getRole: (name) => options[name] ?? null,
      getFocused: (full) => (full ? { name: "mac", value: options.focused || "" } : options.focused || ""),
    },
    fields: { getTextInputValue: (id) => fields[id] ?? "" },
    isAutocomplete: () => kind === "autocomplete",
    isChatInputCommand: () => kind === "command",
    isUserContextMenuCommand: () => kind === "user-context",
    isButton: () => kind === "button",
    isStringSelectMenu: () => kind === "select",
    isModalSubmit: () => kind === "modal",
    reply: record("reply"),
    deferReply: record("deferReply"),
    editReply: record("editReply"),
    update: record("update"),
    deferUpdate: record("deferUpdate"),
    followUp: record("followUp"),
    showModal: record("showModal"),
    respond: record("respond"),
    calls,
  };
  return interaction;
}

/** Son görünür yanıtın düz metni (embed başlık/açıklama dahil). */
export function lastText(interaction) {
  const call = [...interaction.calls].reverse().find((item) => !item.type.startsWith("defer"));
  const payload = call?.payload || {};
  return [payload.content, ...(payload.embeds || []).flatMap((item) => [item.title, item.description, ...(item.fields || []).map((field) => `${field.name} ${field.value}`)])].filter(Boolean).join("\n");
}
