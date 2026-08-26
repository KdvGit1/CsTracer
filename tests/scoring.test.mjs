import assert from "node:assert/strict";
import test from "node:test";
import { SCORE_METHOD, scoreMatchReport } from "../shared/scoring.mjs";

test("genel skor yalnız doğrudan KAST değeridir", () => {
  const score = scoreMatchReport({
    rounds: 24,
    kills: 18,
    deaths: 16,
    headshotPercent: 50,
    kastPercent: 70.8,
    survivalPercent: 33.3,
    tradePercent: 43.8,
    utilityImpactRoundPercent: 25,
    utilityImpactRoundSampleCount: 24,
    movementProfile: { status: "measured", sampleCount: 80, invalidShotPercent: 12.5 },
  });

  assert.equal(score.method, SCORE_METHOD);
  assert.equal(score.overall, 70.8);
  assert.equal(score.sampleCount, 24);
  assert.deepEqual(score.dimensions, {
    aim: 50,
    movement: 87.5,
    utility: 25,
    teamwork: 43.8,
    position: 33.3,
    roundImpact: 70.8,
  });
  assert.equal("economy" in score.dimensions, false);
});

test("eksik metrikler rastgele veya sıfır değere düşmez", () => {
  const score = scoreMatchReport({
    rounds: 0,
    kills: 0,
    deaths: 0,
    movementProfile: { status: "unavailable", sampleCount: 0, invalidShotPercent: 0 },
  });

  assert.equal(score.overall, null);
  assert.equal(score.grade, "Ölçülemedi");
  assert.deepEqual(score.dimensions, {
    aim: null,
    movement: null,
    utility: null,
    teamwork: null,
    position: null,
    roundImpact: null,
  });
});

test("null yüzde değeri ölçülebilir sıfır gibi yorumlanmaz", () => {
  const score = scoreMatchReport({ rounds: 12, kills: 4, deaths: 8, kastPercent: null, survivalPercent: null, tradePercent: null });
  assert.equal(score.overall, null);
  assert.equal(score.dimensions.position, null);
  assert.equal(score.dimensions.teamwork, null);
});
