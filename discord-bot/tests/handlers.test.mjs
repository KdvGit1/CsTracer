import assert from "node:assert/strict";
import test from "node:test";
import { persistAnalysis } from "../src/analysis/pipeline.mjs";
import { handleInteraction } from "../src/bot/router.mjs";
import { fakeInteraction, fakeUser, lastText, STEAM, syntheticAnalysis, testApp, writeAnalysis } from "./helpers.mjs";

const OWNER = "100000000000000001";
const PNG = "89504e470d0a1a0a";

function seedMatch(app, { matchId = "demo_test1", userId = OWNER, steamIndex = 1 } = {}) {
  app.store.touchUser(userId, "Kuzey");
  app.store.claimSteamId(userId, STEAM(steamIndex), { verified: true });
  const analysis = syntheticAnalysis();
  const file = writeAnalysis(app.config.dataDir, matchId, analysis);
  return persistAnalysis({ store: app.store, matchId, source: "upload", analysis, analysisFile: file, playedAt: Date.now() - 3600_000, requesterId: userId });
}

const attachmentOf = (call) => call.payload.files?.[0]?.attachment;

test("ilk etkileşimde kişi hatırlanır ve selamlanır", async () => {
  const { app } = testApp();
  const interaction = fakeInteraction({ commandName: "hesap", subcommand: "durum", guildId: "500000000000000001" });
  await handleInteraction(app, interaction);
  assert.match(lastText(interaction), /TRACER seni böyle hatırlıyor/);
  assert.match(lastText(interaction), /1\. ziyaret/);
  assert.deepEqual(app.store.guildMemberIds("500000000000000001"), [OWNER], "sunucu üyeliği hatırlanır");
  const again = fakeInteraction({ commandName: "hesap", subcommand: "durum" });
  await handleInteraction(app, again);
  assert.match(lastText(again), /2\. ziyaret/);
});

test("/analiz argümansız: tek kullanımlık yükleme bağlantısı verir", async () => {
  const { app, store } = testApp();
  const interaction = fakeInteraction({ commandName: "analiz" });
  await handleInteraction(app, interaction);
  const button = interaction.calls[0].payload.components[0].components[0];
  assert.match(button.url, /^https:\/\/bot\.example\/yukle\/[\w-]{20,}$/);
  assert.equal(store.stats().users, 1);
});

test("/analiz ek ile kuyruğa alır; uygunsuz dosyayı reddeder", async () => {
  const { app, enqueued } = testApp();
  const bad = fakeInteraction({ commandName: "analiz", options: { dosya: { id: "9", name: "resim.png", size: 100, url: "https://cdn.discordapp.com/attachments/1/2/resim.png" } } });
  await handleInteraction(app, bad);
  assert.match(lastText(bad), /CS2 demosu olmalı/);
  assert.equal(enqueued.length, 0);
  const good = fakeInteraction({ commandName: "analiz", options: { dosya: { id: "10", name: "mac.dem.gz", size: 5_000_000, url: "https://cdn.discordapp.com/attachments/1/2/mac.dem.gz" }, oyuncu: "Oyuncu3" } });
  await handleInteraction(app, good);
  assert.equal(enqueued.length, 1);
  assert.equal(enqueued[0].source.type, "url");
  assert.equal(enqueued[0].playerHint, "Oyuncu3");
  assert.equal(enqueued[0].reply.token, "tok", "sonuç aynı mesajı günceller");
  assert.match(lastText(good), /sıraya alındı/);
  const ssrf = fakeInteraction({ commandName: "analiz", options: { baglanti: "http://169.254.169.254/latest/meta-data" } });
  await handleInteraction(app, ssrf);
  assert.match(lastText(ssrf), /indiremem/);
  assert.equal(enqueued.length, 1);
});

test("günlük ücretsiz sınır dolunca analiz reddedilir", async () => {
  const { app, enqueued } = testApp({ config: { freeDailyAnalyses: 1 } });
  const make = (id) => fakeInteraction({ commandName: "analiz", options: { baglanti: `http://replay1.valve.net/730/00371234567${id}_1.dem.bz2` } });
  await handleInteraction(app, make(1));
  const second = make(2);
  await handleInteraction(app, second);
  assert.equal(enqueued.length, 1);
  assert.match(lastText(second), /ücretsiz analiz hakkın doldu/);
});

test("/mac sekmeleri görsel üretir; düello ve kapsam sekmeleri çalışır", async () => {
  const { app } = testApp();
  app.throttled = () => false;
  seedMatch(app);
  const open = fakeInteraction({ commandName: "mac" });
  await handleInteraction(app, open);
  const reply = open.calls.find((call) => call.type === "editReply");
  assert.equal(attachmentOf(reply).subarray(0, 8).toString("hex"), PNG);
  assert.match(reply.payload.embeds[0].title, /Mirage · 7 - 2 · Galibiyet/);
  const tabs = reply.payload.components[0].components.map((component) => component.custom_id);
  assert.deepEqual(tabs.map((id) => id.split(":")[1]), ["o", "r", "d", "w", "t"]);
  for (const id of [...tabs.slice(1), `m:k:demo_test1:${OWNER}`]) {
    const click = fakeInteraction({ kind: "button", customId: id });
    await handleInteraction(app, click);
    const edited = click.calls.find((call) => call.type === "editReply");
    assert.ok(edited, `sekme yanıtı: ${id}`);
    assert.equal(click.calls[0].type, "deferUpdate", "sahibi kendi mesajını günceller");
  }
});

test("başkasının maç düğmesine basan kişiye kendine özel kopya gösterilir", async () => {
  const { app } = testApp();
  seedMatch(app);
  const stranger = fakeUser("100000000000000099", "Gölge");
  const click = fakeInteraction({ user: stranger, kind: "button", customId: `m:r:demo_test1:${OWNER}` });
  await handleInteraction(app, click);
  assert.equal(click.calls[0].type, "deferReply");
  assert.ok(click.calls[0].payload.flags, "geçici (ephemeral) yanıt");
});

test("bu demoda sen hangisisin seçimi kişiyi hatırlar", async () => {
  const { app, store } = testApp();
  const analysis = syntheticAnalysis();
  store.touchUser(OWNER, "Kuzey");
  persistAnalysis({ store, matchId: "demo_pick", source: "upload", analysis, analysisFile: writeAnalysis(app.config.dataDir, "demo_pick", analysis), requesterId: OWNER });
  assert.equal(store.userMatch(OWNER, "demo_pick"), null);
  const pick = fakeInteraction({ kind: "select", customId: `pick:demo_pick:${OWNER}`, values: [STEAM(4)] });
  await handleInteraction(app, pick);
  assert.equal(store.userMatch(OWNER, "demo_pick").player_name, "Oyuncu4");
  assert.equal(store.getUser(OWNER).steam_id, STEAM(4), "SteamID bir kez seçilince bağlanır");
  assert.match(lastText(pick), /Oyuncu4/);
});

test("/maclar filtreler, sayfalar ve maç açar", async () => {
  const { app } = testApp();
  seedMatch(app, { matchId: "demo_a" });
  seedMatch(app, { matchId: "demo_b" });
  const list = fakeInteraction({ commandName: "maclar", options: { harita: "mirage", sonuc: "W" } });
  await handleInteraction(app, list);
  assert.match(lastText(list), /Maç kütüphanen · 2 maç/);
  const none = fakeInteraction({ commandName: "maclar", options: { sonuc: "L" } });
  await handleInteraction(app, none);
  assert.match(lastText(none), /bulunamadı/);
  const selectId = list.calls[0].payload.components[0].components[0].custom_id;
  const open = fakeInteraction({ kind: "select", customId: selectId, values: ["demo_b"] });
  await handleInteraction(app, open);
  assert.ok(open.calls.find((call) => call.type === "editReply")?.payload.files?.length);
});

test("/profil, /gelisim ve /karsilastir kart üretir; gizli profil gösterilmez", async () => {
  const { app, store } = testApp();
  seedMatch(app, { matchId: "demo_p1" });
  seedMatch(app, { matchId: "demo_p2" });
  const profile = fakeInteraction({ commandName: "profil" });
  await handleInteraction(app, profile);
  assert.equal(attachmentOf(profile.calls.find((call) => call.type === "editReply")).subarray(0, 8).toString("hex"), PNG);
  const progress = fakeInteraction({ commandName: "gelisim" });
  await handleInteraction(app, progress);
  assert.ok(progress.calls.find((call) => call.type === "editReply")?.payload.files?.length);

  const otherId = "100000000000000002";
  seedMatch(app, { matchId: "demo_p3", userId: otherId, steamIndex: 8 });
  const compare = fakeInteraction({ commandName: "karsilastir", options: { kullanici: fakeUser(otherId, "Gölge") } });
  await handleInteraction(app, compare);
  assert.ok(compare.calls.find((call) => call.type === "editReply")?.payload.files?.length);

  store.updateUserSettings(otherId, { publicProfile: false });
  const hidden = fakeInteraction({ commandName: "profil", options: { kullanici: fakeUser(otherId, "Gölge") } });
  await handleInteraction(app, hidden);
  assert.match(lastText(hidden), /gizli/);
});

test("/liderlik yalnız açık profilleri ve yeterli maçı olanları sıralar", async () => {
  const { app, store } = testApp();
  const guildId = "500000000000000001";
  for (const [userId, steamIndex] of [[OWNER, 1], ["100000000000000002", 2]]) {
    store.touchUser(userId, userId);
    store.touchMember(guildId, userId);
    store.claimSteamId(userId, STEAM(steamIndex), { verified: false });
  }
  for (let index = 0; index < 3; index++) {
    const analysis = syntheticAnalysis();
    persistAnalysis({ store, matchId: `demo_lb${index}`, source: "upload", analysis, analysisFile: writeAnalysis(app.config.dataDir, `demo_lb${index}`, analysis), playedAt: Date.now(), requesterId: OWNER });
  }
  store.updateUserSettings("100000000000000002", { publicProfile: false });
  const board = fakeInteraction({ commandName: "liderlik", guildId, options: { olcut: "adr" } });
  await handleInteraction(app, board);
  const reply = board.calls.find((call) => call.type === "editReply");
  assert.match(reply.payload.content, /Senin sıran: \*\*1\.\*\*/);
  assert.ok(reply.payload.files.length);
});

test("sunucu raporu: analiz bitince üyenin sunucusuna kuyruğa alınır", async () => {
  const { app, store, shared } = testApp();
  const guildId = "500000000000000001";
  store.touchGuild(guildId, "Test");
  store.updateGuild(guildId, { report_channel_id: "600000000000000001", auto_report: true });
  const { match } = seedMatch(app);
  store.touchMember(guildId, OWNER);
  await app.shareToGuilds(match, { participants: [] }, { user_id: OWNER });
  assert.deepEqual(shared, [{ guild: guildId, matchId: match.id, userId: OWNER }]);
  store.updateUserSettings(OWNER, { publicProfile: false });
  await app.shareToGuilds(match, { participants: [] }, { user_id: OWNER });
  assert.equal(shared.length, 1, "gizli profil otomatik paylaşılmaz");
  const payload = await app.guildReportPayload({ match_id: match.id, guild_id: guildId, user_id: OWNER });
  assert.equal(payload.message.files.length, 1);
  assert.deepEqual(payload.message.allowedMentions.users, [], "kullanıcı etiketi bildirim göndermez");
});

test("hesap ayarları düğmeyle değişir; veri silme onay ister", async () => {
  const { app, store } = testApp();
  store.touchUser(OWNER, "Kuzey");
  const toggle = fakeInteraction({ kind: "button", customId: `set:dmNotify:${OWNER}` });
  await handleInteraction(app, toggle);
  assert.equal(store.getUser(OWNER).settings.dmNotify, false);
  const foreign = fakeInteraction({ user: fakeUser("100000000000000077"), kind: "button", customId: `set:dmNotify:${OWNER}` });
  await handleInteraction(app, foreign);
  assert.equal(store.getUser(OWNER).settings.dmNotify, false, "başkası değiştiremez");
  const ask = fakeInteraction({ commandName: "hesap", subcommand: "sil" });
  await handleInteraction(app, ask);
  assert.ok(store.getUser(OWNER), "onaysız silinmez");
  await handleInteraction(app, fakeInteraction({ kind: "button", customId: `del:yes:${OWNER}` }));
  assert.equal(store.getUser(OWNER), null);
});

test("/hesap steam: SteamID64 ile bağlanır, eksik takip bilgisini açıklar", async () => {
  const { app, store } = testApp();
  const link = fakeInteraction({ commandName: "hesap", subcommand: "steam", options: { profil: "76561197960287930" } });
  await handleInteraction(app, link);
  assert.equal(store.getUser(OWNER).steam_id, "76561197960287930");
  assert.match(lastText(link), /Steam hesabın bağlandı/);
  const half = fakeInteraction({ commandName: "hesap", subcommand: "steam", options: { profil: "76561197960287930", "kimlik-kodu": "ABCD-EFGHJ-KLMN" } });
  await handleInteraction(app, half);
  assert.match(lastText(half), /birlikte gerekli/);
});

test("/takim kur Steam'i bağlı olmayan oyuncuyu bildirir; rapor için veri yetersizse açıklar", async () => {
  const { app, store } = testApp();
  const guildId = "500000000000000001";
  store.touchUser(OWNER, "Kuzey");
  store.claimSteamId(OWNER, STEAM(1), { verified: false });
  const missing = fakeInteraction({ commandName: "takim", subcommand: "kur", guildId, options: { ad: "Beşli", harita: "mirage", oyuncu1: fakeUser(OWNER, "Kuzey"), oyuncu2: fakeUser("100000000000000055", "Yok") } });
  await handleInteraction(app, missing);
  assert.match(lastText(missing), /Steam hesabı bağlı olmayan/);
  const create = fakeInteraction({ commandName: "takim", subcommand: "kur", guildId, options: { ad: "Beşli", harita: "mirage", oyuncu1: fakeUser(OWNER, "Kuzey") } });
  await handleInteraction(app, create);
  assert.match(lastText(create), /Takım kuruldu/);
  const report = fakeInteraction({ commandName: "takim", subcommand: "rapor", guildId });
  await handleInteraction(app, report);
  assert.match(lastText(report), /analiz edilmiş maçı yok|en az 3/);
});

test("otomatik tamamlama son maçları ve sözlüğü önerir", async () => {
  const { app } = testApp();
  seedMatch(app);
  const auto = fakeInteraction({ kind: "autocomplete", commandName: "mac" });
  await handleInteraction(app, auto);
  assert.equal(auto.calls[0].payload[0].value, "demo_test1");
  const terms = fakeInteraction({ kind: "autocomplete", commandName: "sozluk", options: { focused: "kast" } });
  await handleInteraction(app, terms);
  assert.equal(terms.calls[0].payload[0].value, "kast");
});

test("/admin yalnız bot sahibine açık", async () => {
  const { app } = testApp();
  const denied = fakeInteraction({ commandName: "admin", subcommand: "istatistik" });
  await handleInteraction(app, denied);
  assert.match(lastText(denied), /yalnız bot sahibine/);
  const owner = fakeInteraction({ user: fakeUser("900000000000000001", "Sahip"), commandName: "admin", subcommand: "premium", options: { gun: 30, kullanici: fakeUser(OWNER, "Kuzey"), not: "Shopier #12" } });
  await handleInteraction(app, owner);
  assert.ok(app.entitlements.isPremium({ userId: OWNER }));
});

test("çok hızlı sekme tıklaması kısa süre bekletilir", async () => {
  const { app } = testApp();
  seedMatch(app);
  const first = fakeInteraction({ kind: "button", customId: `m:r:demo_test1:${OWNER}` });
  const second = fakeInteraction({ kind: "button", customId: `m:w:demo_test1:${OWNER}` });
  await handleInteraction(app, first);
  await handleInteraction(app, second);
  assert.ok(first.calls.find((call) => call.type === "editReply"));
  assert.match(lastText(second), /yavaş/);
});

test("canlı takım tahtası: ilk pakette mesaj açar, round değişince aynı mesajı düzenler", async () => {
  const { buildRoundMessage, roundMessageKey } = await import("../engine/companion/squad/discord_live.mjs");
  const { reconcileLiveSession, startLiveSession } = await import("../engine/companion/squad/live.mjs");
  const { normalizeGsi } = await import("../src/services/live.mjs");
  const { app, store } = testApp();
  const sent = [];
  const edited = [];
  app.client = { channels: { fetch: async () => ({ send: async (body) => { sent.push(body); return { id: "700000000000000001" }; }, messages: { edit: async (id, body) => edited.push({ id, body }) } }) } };
  const report = { map: "mirage", mapLabel: "Mirage", playbook: { roundPlans: [{ id: "p1", side: "T", title: "A execute", goal: "A'yı al", lane: "A", buy: "full", evidence: {}, phases: [{ id: "take", label: "Alan al", window: [0, 40], text: "Orta ve A'ya yayıl", assignments: [] }, { id: "plant", label: "Kur", window: [40, 115], text: "A'ya kur", markers: [] }] }] } };
  store.saveSquad({ id: "s1", scope: "guild:g", name: "Beşli", map: "mirage", roster: [{ steamid: STEAM(1), name: "A" }], owner_user_id: OWNER, report });
  store.saveLiveSession({ squadId: "s1", userId: OWNER, guildId: "g", channelId: "c", session: startLiveSession({ id: "s1", map: "mirage", report }) });
  const packet = (round) => ({ map: { name: "de_mirage", phase: "live", round, team_ct: { score: 0 }, team_t: { score: round } }, round: { phase: "live" }, player: { team: "T", state: { health: 100, money: 5000 } }, phase_countdowns: { phase: "live", phase_ends_in: "100" } });
  const engine = { reconcileLiveSession, roundMessageKey, buildRoundMessage };
  let gsi = normalizeGsi(null, packet(0));
  await app.updateLiveBoards(OWNER, gsi, engine);
  assert.equal(sent.length, 1);
  assert.match(sent[0].embeds[0].title, /R1 · T · A execute/);
  await app.updateLiveBoards(OWNER, gsi, engine);
  assert.equal(sent.length + edited.length, 1, "durum değişmeden yeniden gönderilmez");
  gsi = normalizeGsi(gsi, packet(1));
  app.liveEdits.set("s1", 0);
  await app.updateLiveBoards(OWNER, gsi, engine);
  assert.equal(sent.length, 1, "yeni mesaj açılmaz");
  assert.equal(edited.length, 1);
  assert.equal(edited[0].id, "700000000000000001");
});
