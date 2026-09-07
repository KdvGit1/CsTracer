import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  buildDiscordReportImageModel,
  buildDiscordMatchMessages,
  DiscordReporter,
  normalizeWebhookUrl,
  renderDiscordReportPng,
  sampleReportImageModel,
} from "../companion/discord_reporter.mjs";

const WEBHOOK = "https://discord.com/api/webhooks/123456789012345678/abcdefghijklmnopqrstuvwxyzABCDEFGH123456";

function sampleReport(index, overrides = {}) {
  return {
    player: { steamid: `765611980000000${String(index).padStart(2, "0")}`, name: `Oyuncu ${index}` },
    map: "de_anubis",
    rounds: 20,
    kills: 10 + index,
    deaths: 8,
    assists: 4,
    adr: 80 + index,
    headshotPercent: 45,
    openingKills: 2,
    openingDeaths: 1,
    utilityDamage: 110,
    enemyBlindSeconds: 7.5,
    tradePercent: 62,
    survivalPercent: 60,
    kastPercent: 70 + index,
    topZone: "A Bölgesi",
    topZoneDeaths: 2,
    movementProfile: { status: "measured", sampleCount: 30, invalidShotPercent: 10 },
    sprayStats: { status: "measured", sampleCount: 24, earlyAccuracy: 25, lateAccuracy: 18 },
    duelStats: { duelStatus: "measured", duelTotal: 8, duelWinrate: 50 },
    weaponStats: [{ label: "AK-47", kills: 8, shots: 40, movingShotPercent: 7 }],
    recommendations: [{ id: "spray_control", title: "Uzun sprey kontrolü", body: "İlk üç mermi ile 4+ mermiyi aynı çatışmalarda karşılaştır." }],
    ...overrides,
  };
}

function sampleMatch(reportCount = 10) {
  const reports = Array.from({ length: reportCount }, (_, index) => sampleReport(index));
  return {
    id: "match-discord-1",
    map: "anubis",
    mode: "Premier",
    timestamp: 1_788_223_076_000,
    score: { userTeam: "Takım 2", userScore: 13, enemyScore: 8, result: "Galibiyet", rawScore: "13 - 8" },
    players: reports.map((report, index) => ({ ...report.player, team: index < 5 ? "Team 1" : "Team 2" })),
    fullAnalysis: { reports },
  };
}

function manualSchedule() {
  return { unref() {} };
}

const TEST_PNG = Buffer.from("89504e470d0a1a0a00000000", "hex");
const fakeImageRenderer = async () => TEST_PNG;

function payloadFromRequest(options) {
  if (options.body instanceof FormData) return JSON.parse(options.body.get("payload_json"));
  return JSON.parse(options.body);
}

test("Discord webhook doğrulaması yalnız resmî HTTPS uç noktasını kabul eder", () => {
  assert.equal(normalizeWebhookUrl(`${WEBHOOK}?wait=true`), WEBHOOK);
  assert.throws(() => normalizeWebhookUrl("http://discord.com/api/webhooks/123/token"), /HTTPS/);
  assert.throws(() => normalizeWebhookUrl("https://example.com/api/webhooks/123456789012345678/abcdefghijklmnopqrstuvwxyzABCDEFGH123456"), /Discord/);
  assert.throws(() => normalizeWebhookUrl("https://discord.com.evil.example/api/webhooks/123456789012345678/abcdefghijklmnopqrstuvwxyzABCDEFGH123456"), /Discord/);
});

test("Discord PNG modeli kendi takımı ayrıntılı, rakibi tek kısa tabloda ayırır", () => {
  const match = sampleMatch();
  const model = buildDiscordReportImageModel(match, { steamid: match.fullAnalysis.reports[6].player.steamid });
  const messages = buildDiscordMatchMessages(match, {}, { steamid: match.fullAnalysis.reports[6].player.steamid });
  assert.equal(messages.length, 1);
  assert.equal(messages[0].embeds.length, 1);
  assert.equal(messages[0].embeds[0].image.url, "attachment://tracer-match.png");
  assert.equal(messages[0].attachments[0].filename, "tracer-match.png");
  assert.deepEqual(model.ownRows.map((row) => row.name), ["Oyuncu 5", "Oyuncu 6", "Oyuncu 7", "Oyuncu 8", "Oyuncu 9"]);
  assert.equal(model.ownRows[1].highlighted, true);
  assert.equal(model.ownRows[1].movement, "%90");
  assert.equal(model.ownRows[1].spray, "%25/%18");
  assert.deepEqual(model.opponentRows.map((row) => row.name), ["Oyuncu 0", "Oyuncu 1", "Oyuncu 2", "Oyuncu 3", "Oyuncu 4"]);
  assert.equal(Object.hasOwn(model.opponentRows[0], "movement"), false, "rakip satırı kısa kalmalı");
});

test("Windows görsel üreticisi geçerli 1600x1520 PNG oluşturur", async () => {
  const root = mkdtempSync(join(tmpdir(), "tracer-discord-render-"));
  try {
    const model = buildDiscordReportImageModel(sampleMatch(), { steamid: sampleReport(6).player.steamid });
    const image = await renderDiscordReportPng(model, root);
    assert.equal(image.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
    assert.equal(image.readUInt32BE(16), 1600);
    assert.equal(image.readUInt32BE(20), 1520);
    assert.ok(image.length < 1024 * 1024, "tablo görseli Discord için hafif kalmalı");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("Discord görselinde eksik skorlar sıfır, eksik tarih bugün sayılmaz", () => {
  const match = sampleMatch(1);
  match.timestamp = 0;
  Object.assign(match.fullAnalysis.reports[0], { kills: undefined, deaths: 0, assists: null, openingKills: null });
  const model = buildDiscordReportImageModel(match, match.fullAnalysis.reports[0].player);
  assert.equal(model.ownRows[0].kda, "—/0/—");
  assert.equal(model.ownRows[0].opening, "—-1");
  assert.match(model.subtitle, /Tarih bilinmiyor/);
  assert.equal(model.mapName, "Anubis");
  assert.equal(model.scoreText, "13 - 8");
});

test("PNG uzun Türkçe adları, eksik veriyi ve bilinmeyen rakibi güvenle çizer", async () => {
  const root = mkdtempSync(join(tmpdir(), "tracer-discord-edge-"));
  try {
    const model = sampleReportImageModel();
    model.ownRows = [{ ...model.ownRows[0], name: "Çığlık_Şampiyonu_İstanbul_😀_".repeat(8), note: "Ölçüm eksik. ".repeat(40), kast: "—", kastColor: null, spray: "—", duel: "—" }];
    model.opponentRows = [];
    const png = await renderDiscordReportPng(model, root);
    assert.equal(png.readUInt32BE(16), 1600);
    assert.equal(png.readUInt32BE(20), 816);
    assert.ok(png.length < 1024 * 1024);
    const script = readFileSync(new URL("../companion/render_discord_report.ps1", import.meta.url));
    assert.equal(script.subarray(0, 3).toString("hex"), "efbbbf", "Windows PowerShell Türkçe karakterler için BOM gerektirir");
    assert.match(script.toString("utf8"), /EllipsisCharacter/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("Discord sırrı API durumuna sızmaz; başarılı outbox gönderimi kalıcı tekilleştirilir", async () => {
  const root = mkdtempSync(join(tmpdir(), "tracer-discord-"));
  const calls = [];
  try {
    const reporter = new DiscordReporter(root, {
      fetchImpl: async (url, options) => {
        calls.push({ url: String(url), options });
        return new Response(JSON.stringify({ id: String(calls.length) }), { status: 200, headers: { "content-type": "application/json" } });
      },
      schedule: manualSchedule,
      imageRenderer: fakeImageRenderer,
    });
    const state = reporter.saveSettings({ enabled: true, mode: "webhook", webhookUrl: WEBHOOK });
    assert.equal(state.settings.hasWebhookUrl, true);
    assert.equal(JSON.stringify(state).includes("abcdefghijklmnopqrstuvwxyz"), false, "webhook tokenı istemci durumunda bulunmamalı");
    assert.equal(reporter.enqueue(sampleMatch()).queued, true);
    await reporter.processQueue();
    assert.equal(calls.length, 1);
    assert.equal(reporter.publicState().connection.pendingCount, 0);
    assert.equal(reporter.enqueue(sampleMatch()).reason, "duplicate");
    const stored = JSON.parse(readFileSync(join(root, "discord_outbox.json"), "utf8"));
    assert.deepEqual(stored.sentMatchIds, ["match-discord-1"]);
    assert.equal(calls.every((call) => call.options.redirect === "error"), true);
    assert.equal(calls.every((call) => call.options.body instanceof FormData), true);
    assert.equal(calls.every((call) => payloadFromRequest(call.options).allowed_mentions.parse.length === 0), true);
    assert.equal(calls[0].options.body.get("files[0]").type, "image/png");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("Discord 429 retry_after süresini kullanır; geçersiz webhook saldırgan tekrar döngüsüne girmez", async () => {
  const root = mkdtempSync(join(tmpdir(), "tracer-discord-rate-"));
  let status = 429;
  const now = 10_000;
  try {
    const reporter = new DiscordReporter(root, {
      now: () => now,
      schedule: manualSchedule,
      imageRenderer: fakeImageRenderer,
      fetchImpl: async () => new Response(
        JSON.stringify(status === 429 ? { retry_after: 2.5 } : { message: "Unknown Webhook" }),
        { status, headers: { "content-type": "application/json", "retry-after": "2.5" } },
      ),
    });
    reporter.saveSettings({ enabled: true, webhookUrl: WEBHOOK });
    reporter.enqueue(sampleMatch(1));
    await reporter.processQueue();
    assert.equal(reporter.runtime.outbox[0].nextAttemptAt, now + 2500);
    assert.equal(reporter.runtime.outbox[0].paused, false);

    reporter.runtime.outbox[0].nextAttemptAt = now;
    status = 404;
    await reporter.processQueue();
    assert.equal(reporter.runtime.outbox[0].paused, true);
    assert.match(reporter.publicState().connection.lastError, /webhooku bulunamadı/);

    reporter.saveSettings({ webhookUrl: WEBHOOK });
    assert.equal(reporter.runtime.outbox[0].paused, false, "ayar düzeltildiğinde kuyruk yeniden açılmalı");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("gelişmiş bot modu doğru kanal API'sini ve Bot yetkilendirmesini kullanır", async () => {
  const root = mkdtempSync(join(tmpdir(), "tracer-discord-bot-"));
  let sent = null;
  try {
    const reporter = new DiscordReporter(root, {
      schedule: manualSchedule,
      imageRenderer: fakeImageRenderer,
      fetchImpl: async (url, options) => {
        sent = { url: String(url), options };
        return new Response(JSON.stringify({ id: "message-1" }), { status: 200, headers: { "content-type": "application/json" } });
      },
    });
    reporter.saveSettings({
      enabled: true,
      mode: "bot",
      botToken: "test.bot.token-that-is-long-enough-for-validation",
      channelId: "123456789012345678",
    });
    await reporter.sendTest();
    assert.equal(sent.url, "https://discord.com/api/v10/channels/123456789012345678/messages");
    assert.equal(sent.options.headers.Authorization, "Bot test.bot.token-that-is-long-enough-for-validation");
    assert.equal(sent.options.body instanceof FormData, true);
    assert.equal(Object.hasOwn(payloadFromRequest(sent.options), "username"), false, "bot mesajına webhook username alanı eklenmemeli");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
