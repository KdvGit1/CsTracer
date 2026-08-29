import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import {
  requestSteamCommunityViaWindows,
  requestTextWithHardTimeout,
  validateSteamCommunityUrl,
} from "../companion/steam_http.mjs";
import { buildGcpdRequestUrls } from "../companion/steam_downloader.mjs";

async function withServer(handler, run) {
  const server = createServer(handler);
  await new Promise((resolvePromise) => server.listen(0, "127.0.0.1", resolvePromise));
  try {
    const address = server.address();
    return await run(`http://127.0.0.1:${address.port}`);
  } finally {
    server.closeAllConnections?.();
    await new Promise((resolvePromise) => server.close(resolvePromise));
  }
}

test("Steam HTTP katmanı normal metin yanıtını okur", async () => {
  await withServer((_request, response) => {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end('{"success":1}');
  }, async (origin) => {
    const result = await requestTextWithHardTimeout(`${origin}/history`, { timeoutMs: 500 });
    assert.equal(result.status, 200);
    assert.equal(result.text, '{"success":1}');
  });
});

test("Steam HTTP katmanı DNS/socket beklemesinden bağımsız mutlak sürede keser", async () => {
  await withServer(() => {
    // Bilerek hiçbir yanıt gönderme.
  }, async (origin) => {
    const startedAt = Date.now();
    await assert.rejects(
      requestTextWithHardTimeout(`${origin}/hang`, { timeoutMs: 60 }),
      (error) => error?.code === "STEAM_TIMEOUT",
    );
    assert.ok(Date.now() - startedAt < 1_000);
  });
});

test("Steam HTTP katmanı aşırı büyük yanıtı reddeder", async () => {
  await withServer((_request, response) => response.end("0123456789"), async (origin) => {
    await assert.rejects(
      requestTextWithHardTimeout(`${origin}/large`, { timeoutMs: 500, maxBytes: 4 }),
      (error) => error?.code === "STEAM_RESPONSE_TOO_LARGE",
    );
  });
});

test("GCPD taraması kalıcı profil ve çerez hesabı yedek adreslerini üretir", () => {
  assert.deepEqual(buildGcpdRequestUrls("76561198113042361", "matchhistorypremier"), [
    "https://steamcommunity.com/profiles/76561198113042361/gcpd/730/?ajax=1&tab=matchhistorypremier",
    "https://steamcommunity.com/my/gcpd/730/?ajax=1&tab=matchhistorypremier",
  ]);
  assert.throws(() => buildGcpdRequestUrls("not-a-steamid", "matchhistorypremier"));
  assert.throws(() => buildGcpdRequestUrls("76561198113042361", "../../login"));
});

test("Steam ağ yolları yalnızca güvenli Community adreslerine izin verir", async () => {
  assert.equal(validateSteamCommunityUrl("https://steamcommunity.com/my/gcpd/730/").hostname, "steamcommunity.com");
  assert.throws(() => validateSteamCommunityUrl("http://steamcommunity.com/my/gcpd/730/"));
  assert.throws(() => validateSteamCommunityUrl("https://steamcommunity.com.evil.example/my/gcpd/730/"));
  assert.throws(
    () => requestSteamCommunityViaWindows("https://example.com/", { platform: "win32" }),
    (error) => error?.code === "STEAM_URL_REJECTED",
  );
});
