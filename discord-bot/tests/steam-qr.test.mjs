import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { handleInteraction } from "../src/bot/router.mjs";
import { decrypt } from "../src/secrets.mjs";
import { SteamQrError, SteamQrLinker, cookieHeader, extractMatchCodes, qrSvg } from "../src/services/steam-qr.mjs";
import { STEAM, fakeInteraction, lastText, testApp } from "./helpers.mjs";

const AUTH = "AB12-CD345-EF67";
const SHARE = "CSGO-aBcDe-FgHiJ-kLmNo-PqRsT-uVwXy";
const HELP_PAGE = `<html><div class="tracking">ZZ99-ZZ999-ZZ99 (iz kodu)</div><div class="help_page_title">Access to Your Match History</div>
  <p>Authentication Code</p><input type="text" value="${AUTH}" readonly>
  <p>Your most recently completed match token:</p><div>${SHARE}</div></html>`;

test("Steam kod sayfası: kimlik kodu ve son maç kodu ayıklanır (sayfa ya da yapıştırılan metin)", () => {
  assert.deepEqual(extractMatchCodes(HELP_PAGE), { authCode: AUTH, shareCode: SHARE }, "başlıktan sonraki kod seçilir, sayfadaki başka şeye takılmaz");
  assert.deepEqual(extractMatchCodes(`Kimlik doğrulama kodu\n${AUTH}\nEn son tamamlanan maç: ${SHARE}`), { authCode: AUTH, shareCode: SHARE });
  assert.deepEqual(extractMatchCodes("Steam'e giriş yap"), { authCode: null, shareCode: null });
});

test("çerez başlığı yalnız istenen alan adının çerezlerinden oluşur", () => {
  const cookies = [
    "steamLoginSecure=topluluk; Path=/; Secure; HttpOnly; Domain=steamcommunity.com",
    "steamLoginSecure=yardim; Path=/; Secure; HttpOnly; SameSite=None; Domain=help.steampowered.com",
    "sessionid=abc; Path=/; Secure; SameSite=None; Domain=help.steampowered.com",
  ];
  assert.equal(cookieHeader(cookies, "help.steampowered.com"), "steamLoginSecure=yardim; sessionid=abc");
});

test("QR kartı: koyu modüller açık zemin üstünde, köşe bulucu desenleri yerinde", () => {
  const svg = qrSvg("https://s.team/q/1/1234567890");
  assert.match(svg, /^<svg[^>]+width="\d+"/);
  assert.match(svg, /fill="#ffffff"/);
  assert.ok((svg.match(/<rect /g) || []).length > 50);
});

function fakeSession({ fail = null } = {}) {
  const session = Object.assign(new EventEmitter(), {
    loginTimeout: 0,
    canceled: false,
    refreshToken: null,
    accessToken: null,
    steamID: null,
    startWithQR: async () => ({ qrChallengeUrl: "https://s.team/q/1/111" }),
    cancelLoginAttempt() { this.canceled = true; },
    getWebCookies: async () => ["steamLoginSecure=x; Path=/; Domain=help.steampowered.com", "sessionid=s; Path=/; Domain=help.steampowered.com"],
  });
  // Oyuncu QR'ı okutur, Steam QR'ı yeniler, oyuncu onaylar.
  session.drive = async () => {
    await new Promise((resolve) => setImmediate(resolve));
    if (fail === "timeout") return session.emit("timeout");
    session.emit("remoteInteraction");
    session.emit("debug", "poll response", { newChallengeUrl: "https://s.team/q/1/222" });
    session.refreshToken = "eyJhbGciOiJFZERTQSJ9.yenileme";
    session.accessToken = "eyJhbGciOiJFZERTQSJ9.erisim";
    session.steamID = { getSteamID64: () => STEAM(1) };
    session.emit("authenticated");
  };
  return session;
}

function recordingFetch(page = HELP_PAGE) {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url).startsWith("https://help.steampowered.com/")) return { ok: true, text: async () => page };
    return { ok: true, status: 200, headers: new Headers({ "x-eresult": "1" }) };
  };
  return { calls, fetchImpl };
}

test("QR girişi: okutma, yenilenen QR, onay; kodlar okunur ve oturum Steam'de kapatılır", async () => {
  const session = fakeSession();
  const { calls, fetchImpl } = recordingFetch();
  const linker = new SteamQrLinker({ createSession: () => session, fetchImpl });
  const shown = [];
  let scanned = 0;
  const pending = linker.link({ onChallenge: (url) => { shown.push(url); }, onScanned: () => { scanned++; } });
  void session.drive();
  const result = await pending;
  assert.deepEqual(result, { steamId: STEAM(1), authCode: AUTH, shareCode: SHARE });
  assert.deepEqual(shown, ["https://s.team/q/1/111", "https://s.team/q/1/222"], "Steam QR'ı yenileyince yenisi gösterilir");
  assert.equal(scanned, 1);
  assert.equal(session.loginTimeout, 120_000);
  assert.equal(calls[0].options.headers.Cookie, "steamLoginSecure=x; sessionid=s");
  const revoke = calls.find((call) => call.url.includes("RevokeToken"));
  assert.ok(revoke, "oturum kapatma isteği gönderildi");
  assert.match(revoke.url, /access_token=eyJhbGciOiJFZERTQSJ9\.erisim$/);
  const body = Buffer.from(revoke.options.body.get("input_protobuf_encoded"), "base64");
  const token = "eyJhbGciOiJFZERTQSJ9.yenileme";
  assert.deepEqual([...body.subarray(0, 2)], [0x0a, token.length]);
  assert.equal(body.subarray(2, 2 + token.length).toString(), token);
  assert.deepEqual([...body.subarray(-2)], [0x10, 0x01]);
});

test("QR girişi: süre dolunca anlaşılır hata, oturum açılmadığı için kapatma isteği yok", async () => {
  const session = fakeSession({ fail: "timeout" });
  const { calls, fetchImpl } = recordingFetch();
  const linker = new SteamQrLinker({ createSession: () => session, fetchImpl });
  const pending = linker.link({ onChallenge: () => {} });
  void session.drive();
  await assert.rejects(pending, (error) => error instanceof SteamQrError && /süresi doldu/.test(error.message));
  assert.equal(calls.length, 0);
});

function qrApp({ codes = { authCode: AUTH, shareCode: SHARE }, demos = true } = {}) {
  const parts = testApp();
  const { app } = parts;
  app.features.steam = true;
  app.steam.nextShareCode = async () => null;
  app.steam.summary = async () => ({ name: "KuzeyCS", avatar: "", public: true });
  app.steam.canResolveShareCodes = () => demos;
  app.steam.shareCodeBlocker = () => (demos ? null : ".env'de boş: STEAM_BOT_USERNAME");
  app.steamQr = {
    link: async ({ onChallenge, onScanned }) => {
      await onChallenge("https://s.team/q/1/333");
      await onScanned();
      return { steamId: STEAM(1), ...codes };
    },
  };
  return parts;
}

test("/hesap steam (boş): QR gösterir, onaydan sonra takibi açar ve son maçı analize alır", async () => {
  const { app, store, enqueued } = qrApp();
  const interaction = fakeInteraction({ commandName: "hesap", subcommand: "steam" });
  await handleInteraction(app, interaction);
  const edits = interaction.calls.filter((call) => call.type === "editReply");
  const qr = edits[0].payload;
  assert.equal(qr.files[0].name, "steam-qr.png");
  assert.equal(qr.files[0].attachment.subarray(1, 4).toString(), "PNG");
  assert.equal(qr.components[0].components[0].url, "https://s.team/q/1/333", "telefondan girenler için dokunulacak bağlantı");
  assert.match(edits[1].payload.embeds[0].title, /QR okundu/);
  assert.deepEqual(edits[1].payload.attachments, [], "okununca QR görseli kaldırılır");
  const final = lastText(interaction);
  assert.match(final, /Steam hesabın bağlandı: \*\*KuzeyCS\*\* \(doğrulandı ✓\)/);
  assert.match(final, /Otomatik takip açık/);
  assert.match(final, /Son maçını da şimdi analiz ediyorum/);
  assert.match(final, /Steam oturumunu kapattım/);
  const user = store.getUser("100000000000000001");
  assert.equal(user.steam_id, STEAM(1));
  assert.equal(user.steam_verified, 1);
  assert.equal(user.last_share_code, SHARE);
  assert.equal(decrypt(app.secretKey, user.match_auth_code), AUTH);
  assert.equal(enqueued[0].source.shareCode, SHARE);
  assert.equal(enqueued[0].reply.dm, true);
});

test("/hesap steam QR: Steam'de kod yoksa ne yapacağını söyler; demo indirme kapalıysa sahibine nedeni", async () => {
  const noCode = qrApp({ codes: { authCode: null, shareCode: null } });
  const first = fakeInteraction({ commandName: "hesap", subcommand: "steam" });
  await handleInteraction(noCode.app, first);
  assert.match(lastText(first), /maç geçmişi kodunu göremedim/);
  assert.equal(noCode.store.getUser("100000000000000001").steam_verified, 1, "hesap yine de doğrulanmış olarak bağlanır");
  assert.equal(noCode.enqueued.length, 0);

  const noDemos = qrApp({ demos: false });
  const owner = fakeInteraction({ commandName: "hesap", subcommand: "steam", user: { id: "900000000000000001", username: "sahip", globalName: "sahip", bot: false, displayAvatarURL: () => "" } });
  await handleInteraction(noDemos.app, owner);
  assert.match(lastText(owner), /yeni maç bulununca haber vereceğim\. \(🔧 Demoları kendiliğinden indirmek için: \.env'de boş: STEAM_BOT_USERNAME\)/);
  assert.equal(noDemos.enqueued.length, 0);
});

test("elle bağlama: sayfadan yapıştırılan metinden iki kod da ayıklanır", async () => {
  const { app, store } = qrApp();
  app.steam.resolveSteamId = async () => STEAM(2);
  const form = fakeInteraction({ kind: "modal", customId: "modal:steam:100000000000000001", fields: { profil: "https://steamcommunity.com/profiles/76561198000000002", kodlar: `Authentication Code ${AUTH}\nYour most recently completed match token: ${SHARE}` } });
  await handleInteraction(app, form);
  assert.match(lastText(form), /Otomatik takip açık/);
  assert.equal(store.getUser("100000000000000001").last_share_code, SHARE);
  assert.doesNotMatch(lastText(form), /Son maçını da/, "elle bağlamada son maç kendiliğinden kuyruğa alınmaz");
});
