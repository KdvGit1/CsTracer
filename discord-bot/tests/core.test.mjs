import assert from "node:assert/strict";
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { gzipSync } from "node:zlib";
import { classifyDemoUrl, detectFormat, normalizeDemoFile } from "../src/analysis/download.mjs";
import { perspective, persistAnalysis, reportMatch, teamsFromAnalysis } from "../src/analysis/pipeline.mjs";
import { Store } from "../src/db.mjs";
import { decrypt, encrypt, hashToken } from "../src/secrets.mjs";
import { gsiConfig, LiveService, normalizeGsi } from "../src/services/live.mjs";
import { Reporter, retryDelay } from "../src/services/reporter.mjs";
import { decodeShareCode, isAuthCode, isShareCode, parseSteamInput, SteamService } from "../src/services/steam.mjs";
import { Entitlements } from "../src/services/entitlements.mjs";
import { redact, registerSecret } from "../src/log.mjs";
import { STEAM, syntheticAnalysis, tempDir, testConfig, writeAnalysis } from "./helpers.mjs";

test("paylaşım kodu çözücü bilinen örnekle aynı sonucu verir", () => {
  assert.deepEqual(decodeShareCode("CSGO-GADqf-jjyJ8-cSP2r-smZRo-TO2xK"), { matchId: "3230642215713767580", outcomeId: "3230647599455273103", token: 55788 });
  assert.ok(isShareCode("CSGO-XU6KP-SEhPY-WDZT4-n5PaM-tD8nL"));
  assert.ok(!isShareCode("CSGO-XU6KP"));
  assert.ok(isAuthCode("ab12-cd345-ef67"));
  assert.throws(() => decodeShareCode("geçersiz"));
});

test("Steam girdileri SteamID64'e çevrilir", () => {
  assert.deepEqual(parseSteamInput("https://steamcommunity.com/profiles/76561197960287930/"), { steamId: "76561197960287930" });
  assert.deepEqual(parseSteamInput("[U:1:22202]"), { steamId: "76561197960287930" });
  assert.deepEqual(parseSteamInput("STEAM_0:0:11101"), { steamId: "76561197960287930" });
  assert.deepEqual(parseSteamInput("https://steamcommunity.com/id/gaben"), { vanity: "gaben" });
  assert.equal(parseSteamInput("http://kötü site/"), null);
});

test("demo indirici yalnız izinli sunuculara gider (SSRF koruması)", () => {
  assert.equal(classifyDemoUrl("https://cdn.discordapp.com/attachments/1/2/mac.dem")?.kind, "discord");
  assert.equal(classifyDemoUrl("http://replay183.valve.net/730/003712345678_1234.dem.bz2")?.kind, "valve");
  assert.equal(classifyDemoUrl("https://demos-us-east.backblaze.faceit-cdn.net/cs2/x.dem.gz"), null);
  assert.equal(classifyDemoUrl("https://demos-europe-central-faceit-cdn.s3.eu-central-003.backblazeb2.com/cs2/x.dem.gz")?.kind, "faceit");
  for (const bad of ["http://169.254.169.254/latest", "http://localhost:8787/saglik", "https://cdn.discordapp.com.evil.com/x.dem", "https://user:pw@cdn.discordapp.com/x.dem", "file:///etc/passwd", "http://cdn.discordapp.com/x.dem", "http://replay1.valve.net/731/x.dem.bz2"]) {
    assert.equal(classifyDemoUrl(bad), null, bad);
  }
});

test("dem, gz ve bz2 demolar açılır; CS:GO ve bozuk dosyalar reddedilir", async () => {
  const dir = tempDir();
  const demo = Buffer.concat([Buffer.from("PBDEMS2\0", "binary"), Buffer.alloc(131072, 7)]);
  assert.equal(detectFormat(demo.subarray(0, 8)), "dem");
  writeFileSync(join(dir, "a.raw"), demo);
  const raw = await normalizeDemoFile(join(dir, "a.raw"), join(dir, "a.dem"), { maxBytes: 1e9 });
  assert.equal(raw.format, "dem");
  assert.equal(raw.size, demo.length);
  writeFileSync(join(dir, "b.raw"), gzipSync(demo));
  const gz = await normalizeDemoFile(join(dir, "b.raw"), join(dir, "b.dem"), { maxBytes: 1e9 });
  assert.equal(gz.sha256, raw.sha256);
  assert.ok(!existsSync(join(dir, "b.raw")), "ham dosya silinir");
  copyFileSync(new URL("./fixtures/fake-demo.dem.bz2", import.meta.url), join(dir, "c.raw"));
  const bz = await normalizeDemoFile(join(dir, "c.raw"), join(dir, "c.dem"), { maxBytes: 1e9 });
  assert.equal(bz.format, "bz2");
  assert.equal(readFileSync(join(dir, "c.dem")).subarray(0, 8).toString("binary"), "PBDEMS2\0");
  writeFileSync(join(dir, "d.raw"), Buffer.concat([Buffer.from("HL2DEMO\0"), Buffer.alloc(70000)]));
  await assert.rejects(normalizeDemoFile(join(dir, "d.raw"), join(dir, "d.dem"), { maxBytes: 1e9 }), /CS:GO|CS2/);
  writeFileSync(join(dir, "e.raw"), gzipSync(demo));
  await assert.rejects(normalizeDemoFile(join(dir, "e.raw"), join(dir, "e.dem"), { maxBytes: 50_000 }), /sınırını aşıyor/);
  writeFileSync(join(dir, "f.raw"), Buffer.from("merhaba dünya, bu bir demo değil"));
  await assert.rejects(normalizeDemoFile(join(dir, "f.raw"), join(dir, "f.dem"), { maxBytes: 1e9 }), /CS2 demosu değil/);
});

test("hafıza: kişiyi hatırlar, ziyaretleri sayar ve ayarları korur", () => {
  const store = new Store(tempDir());
  const first = store.touchUser("1001", "Kuzey");
  assert.equal(first.previous, null);
  assert.equal(first.user.visits, 1);
  const second = store.touchUser("1001", "");
  assert.equal(second.previous.name, "Kuzey");
  assert.equal(second.user.name, "Kuzey", "boş ad eski adı silmez");
  assert.equal(second.user.visits, 2);
  assert.equal(second.user.settings.dmNotify, true);
  store.updateUserSettings("1001", { dmNotify: false, bilinmeyen: true });
  assert.equal(store.getUser("1001").settings.dmNotify, false);
  assert.equal(store.getUser("1001").settings.bilinmeyen, undefined);
});

test("doğrulanmış Steam hesabı başkası tarafından sahiplenilemez", () => {
  const store = new Store(tempDir());
  store.touchUser("a", "A");
  store.touchUser("b", "B");
  store.claimSteamId("a", STEAM(1), { verified: false });
  store.claimSteamId("b", STEAM(1), { verified: true });
  assert.equal(store.getUser("a").steam_id, null, "doğrulayan kazanır, doğrulanmamış kayıt düşer");
  assert.equal(store.getUser("b").steam_verified, 1);
  assert.throws(() => store.claimSteamId("a", STEAM(1), { verified: false }), /doğrulanmış/);
});

test("analiz kaydı demodaki bütün bağlı oyuncuların geçmişine eklenir", () => {
  const dir = tempDir();
  const store = new Store(dir);
  for (const [id, index] of [["u1", 1], ["u2", 7]]) {
    store.touchUser(id, id);
    store.claimSteamId(id, STEAM(index), { verified: false });
  }
  store.touchUser("istek", "İsteyen");
  const analysis = syntheticAnalysis();
  const file = writeAnalysis(dir, "m1", analysis);
  const result = persistAnalysis({ store, matchId: "demo_m1", source: "upload", analysis, analysisFile: file, sha256: "abc", playedAt: 1_700_000_000_000, requesterId: "istek" });
  assert.equal(result.match.map, "mirage");
  assert.equal(result.needsPlayerChoice, true, "istek sahibi demoda tanınmadı");
  assert.deepEqual(result.participants.map((item) => item.userId).sort(), ["u1", "u2"]);
  const ct = store.userMatch("u1", "demo_m1");
  const t = store.userMatch("u2", "demo_m1");
  assert.equal(ct.result, "W");
  assert.equal(ct.user_score, 7);
  assert.equal(t.result, "L");
  assert.equal(t.enemy_score, 7);
  assert.ok(ct.summary?.stats, "kompakt özet saklanır");
  assert.equal(store.squadMatchesFor("mirage", [STEAM(1)]).length, 1, "takım koçu arşivine girer");
  const withHint = persistAnalysis({ store, matchId: "demo_m1", source: "upload", analysis, analysisFile: file, requesterId: "istek", playerHint: "oyuncu3" });
  assert.equal(withHint.needsPlayerChoice, false, "oyuncu adı ipucu büyük/küçük harf duyarsız eşleşir");
  assert.equal(store.userMatch("istek", "demo_m1").player_name, "Oyuncu3");
});

test("takımlar ilk yarı tarafına göre ayrılır ve skor perspektife göre çevrilir", () => {
  const analysis = syntheticAnalysis();
  const teams = teamsFromAnalysis(analysis);
  assert.deepEqual(teams.map((team) => [team.label, team.players.length]), [["İlk yarı CT", 5], ["İlk yarı T", 5]]);
  const view = perspective(analysis, analysis.reports[9]);
  assert.equal(view.rawScore, "2 - 7");
  assert.equal(view.result, "L");
  const faceitView = perspective(analysis, analysis.reports[0], { faceit: { score: { userScore: 13, enemyScore: 11 }, userStats: { steamid: STEAM(1) } } });
  assert.equal(faceitView.rawScore, "13 - 11", "FACEIT skoru biliniyorsa önceliklidir");
  const match = reportMatch({ id: "x", map: "mirage", meta: {} }, analysis, { steamid: STEAM(6) });
  assert.equal(match.userStats.name, "Oyuncu6");
  assert.equal(match.players.length, 10);
});

test("iş kuyruğu: aynı demo iki kez kuyruğa girmez, yeniden başlatmada kurtarılır", () => {
  const store = new Store(tempDir());
  const first = store.enqueueJob({ userId: "u", source: { type: "url", url: "x" }, dedupeKey: "att:1" });
  const second = store.enqueueJob({ userId: "u", source: { type: "url", url: "x" }, dedupeKey: "att:1" });
  assert.equal(second.duplicate, true);
  assert.equal(second.job.id, first.job.id);
  const claimed = store.claimNextJob();
  assert.equal(claimed.status, "running");
  assert.equal(store.recoverJobs(), 1);
  assert.equal(store.getJob(claimed.id).status, "queued");
  store.updateJob(claimed.id, { status: "done" });
  assert.equal(store.enqueueJob({ userId: "u", source: {}, dedupeKey: "att:1" }).duplicate, false, "biten iş tekrar eklenebilir");
});

test("rapor kutusu: aynı maç bir sunucuya bir kez, kalıcı hatada tekrar yok", async () => {
  const store = new Store(tempDir());
  assert.equal(store.enqueueOutbox({ guildId: "g", channelId: "c", matchId: "m" }), true);
  assert.equal(store.enqueueOutbox({ guildId: "g", channelId: "c", matchId: "m" }), false);
  const reporter = new Reporter({
    store,
    client: { channels: { fetch: async () => ({ type: 0, send: async () => { throw Object.assign(new Error("Missing Access"), { code: 50001 }); } }) } },
    buildPayload: async () => ({ message: { content: "x" } }),
  });
  await reporter.flush();
  assert.equal(store.outboxStats("g").find((item) => item.status === "failed")?.count, 1);
  assert.ok(retryDelay(1) >= 15_000 && retryDelay(50) <= 6 * 3_600_000);

  store.enqueueOutbox({ guildId: "g2", channelId: "c", matchId: "m" });
  let calls = 0;
  const flaky = new Reporter({
    store,
    client: { channels: { fetch: async () => ({ type: 0, send: async () => { calls++; throw Object.assign(new Error("rate limited"), { status: 429, retryAfter: 30 }); } }) } },
    buildPayload: async () => ({ message: {} }),
  });
  await flaky.flush();
  await flaky.flush();
  assert.equal(calls, 1, "geçici hatada bekleme süresi dolmadan tekrar denenmez");
  assert.equal(store.outboxStats("g2").find((item) => item.status === "pending")?.count, 1);
});

test("sırlar şifreli saklanır ve loglarda maskelenir", () => {
  const key = Buffer.alloc(32, 3);
  const stored = encrypt(key, "ABCD-EFGHJ-KLMN");
  assert.ok(stored.startsWith("v1:") && !stored.includes("ABCD"));
  assert.equal(decrypt(key, stored), "ABCD-EFGHJ-KLMN");
  assert.throws(() => decrypt(Buffer.alloc(32, 4), stored));
  registerSecret("cok-gizli-faceit-anahtari");
  assert.ok(!redact("hata: cok-gizli-faceit-anahtari reddedildi").includes("cok-gizli"));
  assert.ok(!redact("https://api.steampowered.com/x?key=SECRET123&steamid=1").includes("SECRET123"));
  assert.equal(hashToken("a").length, 64);
});

test("GSI: maç sonu bir kez algılanır, cfg kişisel anahtarı içerir", () => {
  const ended = [];
  const live = new LiveService({ hooks: { onMatchEnd: (userId) => ended.push(userId) } });
  const packet = (phase, round = 5) => ({ map: { name: "de_mirage", phase, round, team_ct: { score: 7 }, team_t: { score: 6 } }, player: { team: "CT", state: { health: 100, money: 4500 }, match_stats: { kills: 9 } }, phase_countdowns: { phase: "live", phase_ends_in: "80.0" } });
  live.ingest("u", packet("live"));
  const state = live.get("u");
  assert.equal(state.map.name, "mirage");
  assert.equal(state.round.phaseEndsIn, 80);
  assert.equal(state.player.money, 4500);
  live.ingest("u", packet("gameover", 13));
  live.ingest("u", packet("gameover", 13));
  assert.deepEqual(ended, ["u"]);
  assert.match(gsiConfig("https://bot.example", "TOKEN123"), /"uri" "https:\/\/bot\.example\/gsi"[\s\S]*"token" "TOKEN123"/);
  assert.equal(normalizeGsi(null, { player: { team: "2" } }).player.team, "T");
});

test("ücretsiz plan sınırı ve elle verilen premium", () => {
  const dir = tempDir();
  const store = new Store(dir);
  const config = testConfig(dir, { freeDailyAnalyses: 2 });
  const entitlements = new Entitlements({ store, config });
  store.touchUser("u", "U");
  assert.equal(entitlements.analysisAllowance({ userId: "u" }).ok, true);
  entitlements.recordAnalysis("u");
  entitlements.recordAnalysis("u");
  assert.equal(entitlements.analysisAllowance({ userId: "u" }).ok, false);
  store.grantPremium({ targetType: "user", targetId: "u", until: Date.now() + 60_000, source: "manual" });
  assert.equal(entitlements.analysisAllowance({ userId: "u" }).ok, true);
  assert.equal(entitlements.isPremium({ userId: config.ownerIds[0] }), true, "bot sahibi her zaman premium");
  assert.equal(new Entitlements({ store, config: testConfig(dir) }).analysisAllowance({ userId: "x" }).ok, true, "varsayılan sınırsız");
});

test("KVKK silme: kişisel kayıtlar gider, paylaşılan maç kalır", () => {
  const dir = tempDir();
  const store = new Store(dir);
  store.touchUser("u", "U");
  store.claimSteamId("u", STEAM(1), { verified: false });
  const analysis = syntheticAnalysis();
  persistAnalysis({ store, matchId: "m", source: "upload", analysis, analysisFile: writeAnalysis(dir, "m", analysis), requesterId: "u" });
  assert.ok(store.userMatch("u", "m"));
  store.deleteUser("u");
  assert.equal(store.getUser("u"), null);
  assert.equal(store.userMatch("u", "m"), null);
  assert.ok(store.getMatch("m"));
});

test("kuyruk: geçersiz dosya anlaşılır hatayla biter; aynı maç yeniden analiz edilmeden kullanılır", async () => {
  const { AnalysisQueue } = await import("../src/analysis/queue.mjs");
  const dir = tempDir();
  const store = new Store(dir);
  store.touchUser("u", "U");
  const events = [];
  const queue = new AnalysisQueue({ store, config: testConfig(dir), hooks: { onDone: (job, result) => events.push(["done", result]), onFailed: (job, error) => events.push(["failed", error.message]) } });
  writeFileSync(join(dir, "tmp", "upload-x.raw"), "bu bir demo değil");
  const bad = store.enqueueJob({ userId: "u", source: { type: "file", path: join(dir, "tmp", "upload-x.raw") } }).job;
  await queue.process(store.claimNextJob(), new AbortController().signal);
  assert.equal(store.getJob(bad.id).status, "failed");
  assert.match(events[0][1], /CS2 demosu değil/);
  assert.ok(!existsSync(join(dir, "tmp", "upload-x.raw")), "geçici dosya temizlenir");

  const analysis = syntheticAnalysis();
  store.saveMatch({ id: "faceit_1-aaaa_0", source: "faceit", map: "mirage", analysis_file: writeAnalysis(dir, "f", analysis), analysis_version: "3.4.0", meta: {} });
  store.saveFaceitMatches("p", [{ id: "faceit_1-aaaa_0", faceitMatchId: "1-aaaa", timestamp: 1 }]);
  queue.faceit = { demoUrl: async () => { throw new Error("indirilmemeli"); } };
  store.claimSteamId("u", STEAM(2), { verified: false });
  store.enqueueJob({ userId: "u", source: { type: "faceit", id: "faceit_1-aaaa_0" } });
  await queue.process(store.claimNextJob(), new AbortController().signal);
  const [kind, result] = events[1];
  assert.equal(kind, "done", JSON.stringify(events[1]));
  assert.equal(result.reused, true);
  assert.equal(store.userMatch("u", "faceit_1-aaaa_0").player_name, "Oyuncu2");
});

test("OWNER_IDS boşsa Discord'dan öğrenilen uygulama sahibi yönetici sayılır", () => {
  const dir = tempDir();
  const entitlements = new Entitlements({ store: new Store(dir), config: testConfig(dir, { ownerIds: [] }) });
  assert.equal(entitlements.isOwner("123456789012345678"), false);
  entitlements.setDiscoveredOwners(["123456789012345678", "geçersiz"]);
  assert.equal(entitlements.isOwner("123456789012345678"), true);
  assert.equal(entitlements.isOwner("geçersiz"), false);
});

test(".env'deki boş satırlar varsayılan değere düşer (DATA_DIR= boş)", async () => {
  const { loadConfig, BOT_ROOT } = await import("../src/config.mjs");
  const dir = tempDir();
  const envFile = join(dir, "bos.env");
  writeFileSync(envFile, "DISCORD_TOKEN=x\nDATA_DIR=\nLOG_LEVEL=\nHTTP_PORT=\n");
  const saved = { ...process.env };
  try {
    for (const key of ["DATA_DIR", "LOG_LEVEL", "HTTP_PORT", "DISCORD_TOKEN"]) delete process.env[key];
    process.env.TRACER_ENV_FILE = envFile;
    const config = loadConfig();
    assert.equal(config.dataDir, join(BOT_ROOT, "data"));
    assert.equal(config.steamBot.dataDir, join(BOT_ROOT, "data", "steam"));
    assert.equal(config.logLevel, "info");
    assert.equal(config.httpPort, 8787);
  } finally {
    process.env = saved;
  }
});

test("Steam bot hesabı kod isteyince bir kez durur; tekrar tekrar giriş denemez", async () => {
  assert.match(new SteamService({ apiKey: "k", bot: { username: "u" } }).shareCodeBlocker(), /STEAM_BOT_PASSWORD/);
  const steam = new SteamService({ apiKey: "k", bot: { username: "u", password: "p" } });
  assert.equal(steam.canResolveShareCodes(), true);
  assert.equal(steam.shareCodeBlocker(), null);
  steam.gcBlocked = "Steam bot hesabı e-posta kodu istiyor (gmail.com).";
  assert.equal(steam.canResolveShareCodes(), false);
  await assert.rejects(steam.ensureGc(), /e-posta kodu/);
  assert.equal(steam.gcReady, null);
});
