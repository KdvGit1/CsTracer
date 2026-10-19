// TRACER Discord botu giriş noktası: `npm start`
import { readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { Client, Events, GatewayIntentBits } from "discord.js";
import { buildRoundMessage, roundMessageKey } from "../engine/companion/squad/discord_live.mjs";
import { reconcileLiveSession } from "../engine/companion/squad/live.mjs";
import { AnalysisQueue } from "./analysis/queue.mjs";
import { App } from "./bot/app.mjs";
import { uploadHook } from "./bot/handlers/analysis.mjs";
import { forgetAnalysis } from "./bot/match-view.mjs";
import { handleInteraction } from "./bot/router.mjs";
import { features, loadConfig } from "./config.mjs";
import { Store } from "./db.mjs";
import { commandsHash, deployCommands } from "./deploy.mjs";
import { logger, redact, registerSecret, setLogLevel } from "./log.mjs";
import { Renderer } from "./render/renderer.mjs";
import { loadSecretKey } from "./secrets.mjs";
import { Entitlements } from "./services/entitlements.mjs";
import { FaceitService } from "./services/faceit.mjs";
import { LiveService } from "./services/live.mjs";
import { Reporter } from "./services/reporter.mjs";
import { SteamService } from "./services/steam.mjs";
import { Tracker } from "./services/tracker.mjs";
import { WebServer } from "./services/web.mjs";

const log = logger("bot");
const config = loadConfig();
setLogLevel(config.logLevel);
for (const secret of [config.token, config.steamApiKey, config.faceitApiKey, config.faceitDownloadsToken, config.steamBot.password, config.secretKey]) registerSecret(secret);

const enabled = features(config);
const store = new Store(config.dataDir);
const secretKey = loadSecretKey(config);
const renderer = new Renderer();
const steam = new SteamService({ apiKey: config.steamApiKey, bot: config.steamBot });
const faceit = new FaceitService({ apiKey: config.faceitApiKey, downloadsToken: config.faceitDownloadsToken, store });
const entitlements = new Entitlements({ store, config });
const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const app = new App({ config, features: enabled, store, renderer, steam, faceit, entitlements, secretKey, client });

app.queue = new AnalysisQueue({ store, config, faceit, steam, hooks: app.queueHooks() });
app.reporter = new Reporter({ store, client, buildPayload: (item) => app.guildReportPayload(item) });
app.tracker = new Tracker({ store, config, steam, faceit, queue: app.queue, entitlements, secretKey, notify: (user, event) => app.trackerNotify(user, event) });
app.live = new LiveService({
  hooks: {
    onMatchEnd: (userId) => app.tracker.scheduleSoon(userId),
    onUpdate: (userId, state) => void app.updateLiveBoards(userId, state, { reconcileLiveSession, roundMessageKey, buildRoundMessage }).catch(() => null),
  },
});
app.web = new WebServer({
  config,
  store,
  hooks: {
    onUpload: uploadHook(app),
    onGsi: (userId, payload) => app.live.ingest(userId, payload),
    onSteamVerified: async ({ userId, steamId }) => {
      store.claimSteamId(userId, steamId, { verified: true });
      let name = steamId;
      try {
        const summary = await steam.summary(steamId);
        store.updateUser(userId, { steam_name: summary.name || null, steam_avatar: summary.avatar || null });
        name = summary.name || steamId;
      } catch { /* API anahtarı yoksa yalnız SteamID */ }
      await app.sendDm(userId, { content: `🔒 Steam hesabın doğrulandı: **${name}** ✓` });
      return { name };
    },
    health: () => ({ ok: client.isReady(), queue: store.queueLength(), uptime: Math.round(process.uptime()) }),
  },
});

/** Eski geçici dosyalar, süresi dolan bağlantılar ve saklama sınırını aşan analizler. */
function maintenance() {
  try {
    const tokens = store.pruneTokens();
    const jobs = store.pruneJobs(14 * 86_400_000);
    let files = 0;
    for (const item of store.prunableAnalysisFiles(config.keepAnalysesPerUser, 30 * 86_400_000)) {
      rmSync(item.analysis_file, { force: true });
      store.clearAnalysisFile(item.id);
      forgetAnalysis(item.id);
      files++;
    }
    const tmp = join(config.dataDir, "tmp");
    for (const name of readdirSync(tmp)) {
      const path = join(tmp, name);
      if (Date.now() - statSync(path).mtimeMs > 6 * 3_600_000) rmSync(path, { force: true });
    }
    if (tokens || jobs || files) log.info(`Bakım: ${tokens} bağlantı, ${jobs} eski iş, ${files} analiz dosyası temizlendi.`);
  } catch (error) {
    log.warn("Bakım başarısız", error?.message);
  }
}

client.once(Events.ClientReady, async (ready) => {
  log.info(`${ready.user.tag} olarak bağlandı · ${ready.guilds.cache.size} sunucu · özellikler: ${Object.entries(enabled).map(([key, value]) => `${key}=${value ? "açık" : "kapalı"}`).join(" ")}`);
  const hash = commandsHash();
  const deployed = store.getMeta(`commands:${config.devGuildId || "global"}`);
  if (deployed !== hash) {
    try {
      const result = await deployCommands({ token: config.token, clientId: config.clientId || ready.user.id, devGuildId: config.devGuildId });
      store.setMeta(`commands:${config.devGuildId || "global"}`, hash);
      log.info(`${result.count} slash komutu kaydedildi (${result.scope}).`);
    } catch (error) {
      log.error("Komutlar kaydedilemedi", redact(error?.message));
    }
  }
  for (const guild of ready.guilds.cache.values()) store.touchGuild(guild.id, guild.name);
  app.queue.start();
  app.reporter.start();
  app.tracker.start();
  maintenance();
  setInterval(maintenance, 6 * 3_600_000).unref();
});

client.on(Events.InteractionCreate, (interaction) => void handleInteraction(app, interaction));
client.on(Events.GuildCreate, (guild) => {
  store.touchGuild(guild.id, guild.name);
  log.info(`Yeni sunucu: ${guild.name} (${guild.memberCount} üye)`);
});
client.on(Events.GuildDelete, (guild) => {
  // Discord kesintisinde de tetiklenir; yalnız gerçekten çıkarıldıysak verileri temizle.
  if (guild.available === false) return;
  store.removeGuild(guild.id);
  log.info(`Sunucudan çıkarıldı: ${guild.name || guild.id}`);
});
client.on(Events.EntitlementCreate, (entitlement) => log.info(`Yeni premium hakkı: ${entitlement.userId || entitlement.guildId} (SKU ${entitlement.skuId})`));
client.on(Events.Error, (error) => log.error("Discord istemci hatası", redact(error?.message)));
client.on(Events.Warn, (message) => log.warn(redact(message)));

let stopping = false;
async function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  log.info(`${signal} alındı, kapanıyor…`);
  app.queue.stop();
  app.reporter.stop();
  app.tracker.stop();
  app.web.stop();
  renderer.close();
  steam.close();
  await client.destroy().catch(() => null);
  store.close();
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("unhandledRejection", (error) => log.error("Yakalanmamış hata", redact(error?.stack || error)));

await app.web.start().catch((error) => log.error(`Web sunucusu açılamadı (${config.httpPort}): ${error.message}`));
await client.login(config.token);
