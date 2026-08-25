import assert from "node:assert/strict";
import test from "node:test";
import { CS2_APP_ID, isAllowedReplayUrl, replayFileBase } from "../companion/steam_replay_url.mjs";

test("Steam GCPD'nin resmî HTTP Valve replay adreslerini kabul eder", () => {
  assert.equal(
    isAllowedReplayUrl("http://replay273.valve.net/730/003838664880936714467_1150226278.dem.bz2"),
    true,
  );
  assert.equal(
    isAllowedReplayUrl("http://replay193.valve.net/730/003838660558052131554_0268782591.dem.bz2"),
    true,
  );
});

test("HTTPS Steam CDN adreslerini kabul eder", () => {
  assert.equal(isAllowedReplayUrl("https://cdn.steamcontent.com/730/match.dem.bz2"), true);
  assert.equal(isAllowedReplayUrl("https://steamcommunity.com/replay/match.dem.bz2"), true);
});

test("arkadaş maçlarında değişebilen host, dosya adı ve query biçimlerini destekler", () => {
  const url = "https://replay1.valve.net/730/friend-match.v2_123.dem.bz2?token=signed-value";
  assert.equal(CS2_APP_ID, "730");
  assert.equal(isAllowedReplayUrl(url), true);
  assert.equal(replayFileBase(url), "friend-match.v2_123");
});

test("Valve dışı, sahte ve geniş HTTP adreslerini reddeder", () => {
  const rejected = [
    "http://steamcommunity.com/replay/match.dem.bz2",
    "http://replay273.valve.net.evil.example/730/match.dem.bz2",
    "http://replay273.valve.net@evil.example/730/match.dem.bz2",
    "http://valve.net/730/match.dem.bz2",
    "http://replay.valve.net/730/match.dem.bz2",
    "http://replay273.valve.net/other/match.dem.bz2",
    "http://replay273.valve.net/740/match.dem.bz2",
    "http://replay273.valve.net:8080/730/match.dem.bz2",
    "file:///730/match.dem.bz2",
  ];

  for (const url of rejected) assert.equal(isAllowedReplayUrl(url), false, url);
});
