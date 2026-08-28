import assert from "node:assert/strict";
import test from "node:test";
import { getSteamConnectionHealth, mergeScannedMatchCache, parseGcpdMatchesFromHtml } from "../companion/steam_downloader.mjs";

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
  assert.equal(getSteamConnectionHealth({ steamLoginSecure: "76561198000000000||token", lastScanStatus: "expired" }).state, "expired");
  assert.equal(getSteamConnectionHealth({ steamLoginSecure: "" }).state, "disconnected");
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
