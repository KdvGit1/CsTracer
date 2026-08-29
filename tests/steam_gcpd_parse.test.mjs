import assert from "node:assert/strict";
import test from "node:test";
import {
  extractSteamIdFromCookie,
  extractSteamCookieValues,
  getSteamConnectionHealth,
  mergeSteamSession,
  mergeScannedMatchCache,
  normalizeSteamLoginSecure,
  normalizeSteamSessionId,
  parseGcpdAjaxResponse,
  parseGcpdMatchesFromHtml,
} from "../companion/steam_downloader.mjs";

function playerRow(name, id, profile = false) {
  const identity = profile
    ? `<a href="https://steamcommunity.com/profiles/${id}">${name}</a>`
    : `<a href="https://steamcommunity.com/id/${name}" data-miniprofile="${id}">${name}</a>`;
  return `<tr><td class="inner_name"><span class="playerNickname">${identity}</span></td><td>25</td><td>10</td><td>2</td><td>8</td><td></td><td>50%</td><td>20</td></tr>`;
}

test("GCPD data-miniprofile AccountID değerlerini SteamID64'e dönüştürür", () => {
  const team1 = [
    playerRow("Kısa Kimlik", "466268533"),
    playerRow("A2", "76561198000000002", true),
    playerRow("A3", "76561198000000003", true),
    playerRow("A4", "76561198000000004", true),
    playerRow("A5", "76561198000000005", true),
  ].join("");
  const team2 = [
    playerRow("B1", "175683481"),
    playerRow("B2", "76561199000000002", true),
    playerRow("B3", "76561199000000003", true),
    playerRow("B4", "76561199000000004", true),
    playerRow("B5", "76561199000000005", true),
  ].join("");
  const html = `<table class="csgo_scoreboard_inner_left"><a href="https://replay1.valve.net/730/account-id-test.dem.bz2">Replay</a><td>2026-08-24 23:54:00 GMT</td><span>Inferno Premier</span>${team1}<td class="csgo_scoreboard_score">13 : 9</td>${team2}`;

  const [match] = parseGcpdMatchesFromHtml(html, "Premier", "76561198426534261");
  assert.ok(match);
  assert.equal(match.map, "inferno");
  assert.equal(match.players.length, 10);
  assert.equal(match.players.filter((player) => player.team === "Team 1").length, 5);
  assert.equal(match.players.filter((player) => player.team === "Team 2").length, 5);
  assert.equal(match.players.find((player) => player.name === "Kısa Kimlik").steamid, "76561198426534261");
  assert.equal(match.players.find((player) => player.name === "B1").steamid, "76561198135949209");
  assert.equal(match.players.every((player) => /^\d{17}$/.test(player.steamid)), true);
});

test("Steam bağlantı rozeti yalnız kayıtlı çerezi doğrulanmış bağlantı saymaz", () => {
  assert.equal(getSteamConnectionHealth({ steamLoginSecure: "76561198000000000||token" }).state, "unverified");
  assert.equal(getSteamConnectionHealth({ steamLoginSecure: "76561198000000000||token", lastScanStatus: "success" }).state, "connected");
  assert.equal(getSteamConnectionHealth({ steamLoginSecure: "76561198000000000||token", lastScanStatus: "error", lastScanError: "timeout" }).state, "error");
  assert.match(getSteamConnectionHealth({ steamLoginSecure: "76561198000000000||token", lastScanStatus: "error", lastScanError: "timeout" }).message, /kayıtlı çerezin korunuyor/);
  assert.equal(getSteamConnectionHealth({ steamLoginSecure: "76561198000000000||token", lastScanStatus: "expired" }).state, "expired");
  assert.equal(getSteamConnectionHealth({ steamLoginSecure: "" }).state, "disconnected");
});

test("bağlantı ayarı kaydedilirken boş bırakılan alan mevcut Steam çerezini korur", () => {
  const current = {
    steamLoginSecure: "76561198000000000%7C%7Cold-token",
    steamId: "76561198000000000",
    sessionid: "old-session",
    lastScanStatus: "success",
  };
  const merged = mergeSteamSession(current, { sessionid: "new-session", autoScanEnabled: false });

  assert.equal(merged.steamLoginSecure, current.steamLoginSecure);
  assert.equal(merged.steamId, current.steamId);
  assert.equal(merged.sessionid, "new-session");
  assert.equal(merged.autoScanEnabled, false);
  assert.equal(merged.lastScanStatus, "success");
});

test("Steam çerez alanı yalnız değeri veya tam çerez atamasını güvenle kabul eder", () => {
  const steamId = "76561198000000000";
  const encoded = `${steamId}%7C%7Ctoken-value`;

  assert.equal(normalizeSteamLoginSecure(encoded), encoded);
  assert.equal(normalizeSteamLoginSecure(`steamLoginSecure=${encoded}; Path=/; Secure`), encoded);
  assert.equal(extractSteamIdFromCookie(`steamLoginSecure=${encoded}; Path=/`), steamId);
  assert.equal(extractSteamIdFromCookie("0123456789ABCDEF0123456789ABCDEF"), "");
  assert.equal(normalizeSteamSessionId("sessionid=abcdef123456; Path=/"), "abcdef123456");

  const fullHeader = `timezoneOffset=10800,0; sessionid=abcdef123456; steamLoginSecure=${encoded}; steamCountry=TR`;
  assert.deepEqual(extractSteamCookieValues(fullHeader), {
    steamLoginSecure: encoded,
    sessionid: "abcdef123456",
  });
  const merged = mergeSteamSession({}, { steamLoginSecure: fullHeader });
  assert.equal(merged.steamLoginSecure, encoded);
  assert.equal(merged.sessionid, "abcdef123456");
  assert.equal(merged.steamId, steamId);
});

test("kısmi Steam taraması önceki maç önbelleğini boş veya eksik sonuçla ezmez", () => {
  const merged = mergeScannedMatchCache(
    [{ id: "new", timestamp: 30, replayUrl: "https://replay1.valve.net/730/new.dem.bz2" }],
    [{ id: "old", timestamp: 20, fileName: "old.dem", replayUrl: "https://replay1.valve.net/730/old.dem.bz2" }],
    [{ id: "old", fileName: "old.dem" }],
  );
  assert.deepEqual(merged.map((match) => match.id), ["new", "old"]);
  assert.equal(merged.find((match) => match.id === "old").isDownloaded, true);
});

test("Steam giriş sayfası zaman aşımı değil süresi dolmuş oturum olarak sınıflandırılır", () => {
  assert.throws(
    () => parseGcpdAjaxResponse({ status: 200, text: "<script>var g_steamID = false;</script><a>Sign In</a>" }, "matchhistorypremier"),
    (error) => error?.code === "STEAM_AUTH_EXPIRED" && /çerezini kabul etmedi/i.test(error.message),
  );
  assert.equal(
    parseGcpdAjaxResponse({ status: 200, text: JSON.stringify({ success: 1, html: "<table>maç</table>" }) }, "matchhistorypremier"),
    "<table>maç</table>",
  );
});
