import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { Store } from "../src/db.mjs";
import { hashToken } from "../src/secrets.mjs";
import { WebServer } from "../src/services/web.mjs";
import { tempDir, testConfig } from "./helpers.mjs";

async function server(hooks = {}) {
  const dir = tempDir();
  const store = new Store(dir);
  const config = testConfig(dir, { httpPort: 30000 + Math.floor(Math.random() * 20000), maxDemoMb: 1 });
  const web = new WebServer({ config, store, hooks });
  await web.start();
  const port = web.server.address().port;
  return { web, store, base: `http://127.0.0.1:${port}`, config };
}

test("yükleme bağlantısı tek kullanımlıktır ve boyut sınırını uygular", async () => {
  const uploads = [];
  const { web, store, base } = await server({ onUpload: async (upload) => { uploads.push(upload); return { message: "tamam" }; } });
  try {
    store.saveToken({ tokenHash: hashToken("a".repeat(32)), kind: "upload", userId: "u", data: { guildId: "g" }, ttlMs: 60_000 });
    const page = await fetch(`${base}/yukle/${"a".repeat(32)}`);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /Demo yükle/);
    const body = Buffer.concat([Buffer.from("PBDEMS2\0"), Buffer.alloc(1000)]);
    const put = await fetch(`${base}/yukle/${"a".repeat(32)}`, { method: "PUT", body, headers: { "X-File-Name": encodeURIComponent("maç.dem"), "X-Last-Modified": "1700000000000" } });
    assert.equal(put.status, 200);
    assert.equal(uploads.length, 1);
    assert.equal(uploads[0].fileName, "maç.dem");
    assert.equal(uploads[0].lastModified, 1700000000000);
    assert.equal(uploads[0].token.user_id, "u");
    assert.deepEqual(readFileSync(uploads[0].path), body);
    const again = await fetch(`${base}/yukle/${"a".repeat(32)}`, { method: "PUT", body });
    assert.equal(again.status, 410, "ikinci kullanım reddedilir");

    store.saveToken({ tokenHash: hashToken("b".repeat(32)), kind: "upload", userId: "u", ttlMs: 60_000 });
    const big = await fetch(`${base}/yukle/${"b".repeat(32)}`, { method: "PUT", body: Buffer.alloc(2 * 1024 * 1024) });
    assert.equal(big.status, 413);
    const unknown = await fetch(`${base}/yukle/${"c".repeat(32)}`);
    assert.equal(unknown.status, 410);
  } finally {
    web.stop();
  }
});

test("GSI yalnız geçerli kişisel anahtarla kabul edilir", async () => {
  const packets = [];
  const { web, store, base } = await server({ onGsi: (userId, payload) => packets.push({ userId, payload }) });
  try {
    store.saveToken({ tokenHash: hashToken("g".repeat(32)), kind: "gsi", userId: "u", ttlMs: 60_000 });
    const ok = await fetch(`${base}/gsi`, { method: "POST", body: JSON.stringify({ auth: { token: "g".repeat(32) }, map: { name: "de_nuke" } }) });
    assert.equal(ok.status, 200);
    const bad = await fetch(`${base}/gsi`, { method: "POST", body: JSON.stringify({ auth: { token: "h".repeat(32) } }) });
    assert.equal(bad.status, 401);
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.deepEqual(packets.map((item) => item.userId), ["u"]);
  } finally {
    web.stop();
  }
});

test("Steam doğrulama sayfası resmî OpenID adresine yönlendirir; sahte dönüş reddedilir", async () => {
  const verified = [];
  const { web, store, base } = await server({ onSteamVerified: async (data) => { verified.push(data); return { name: "x" }; } });
  try {
    const raw = "s".repeat(32);
    store.saveToken({ tokenHash: hashToken(raw), kind: "steam-login", userId: "u", ttlMs: 60_000 });
    const page = await (await fetch(`${base}/steam/${raw}`)).text();
    assert.match(page, /https:\/\/steamcommunity\.com\/openid\/login\?/);
    assert.match(page, /openid\.return_to=https%3A%2F%2Fbot\.example%2Fsteam%2Fs+%2Fdonus/);
    const forged = await fetch(`${base}/steam/${raw}/donus?openid.mode=id_res&openid.claimed_id=https%3A%2F%2Fsteamcommunity.com%2Fopenid%2Fid%2F76561197960287930&openid.return_to=https%3A%2F%2Fevil.example`);
    assert.equal(forged.status, 400);
    assert.equal(verified.length, 0);
  } finally {
    web.stop();
  }
});

test("sağlık ucu ve bilinmeyen yol", async () => {
  const { web, base } = await server({ health: () => ({ ok: true, queue: 0 }) });
  try {
    assert.deepEqual(await (await fetch(`${base}/saglik`)).json(), { ok: true, queue: 0 });
    assert.equal((await fetch(`${base}/../../etc/passwd`)).status, 404);
    assert.ok(!existsSync("/nonexistent"));
  } finally {
    web.stop();
  }
});
