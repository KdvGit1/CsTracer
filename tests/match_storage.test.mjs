import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_STORED_ROUTE_POINTS_PER_ROUND,
  compactAnalysisForStorage,
  compactRoutePoints,
} from "../companion/match_storage.mjs";

test("rota noktaları ilk/son konumu ve bölge geçişlerini koruyarak küçülür", () => {
  const points = Array.from({ length: 2_000 }, (_, index) => ({
    x: index,
    y: index * 2,
    z: 0,
    tick: index * 8,
    zone: index < 700 ? "A" : index < 1_400 ? "Orta" : "B",
  }));
  const compacted = compactRoutePoints(points);

  assert.ok(compacted.length <= MAX_STORED_ROUTE_POINTS_PER_ROUND);
  assert.deepEqual(compacted[0], points[0]);
  assert.deepEqual(compacted.at(-1), points.at(-1));
  assert.ok(compacted.some((point) => point.zone === "A"));
  assert.ok(compacted.some((point) => point.zone === "Orta"));
  assert.ok(compacted.some((point) => point.zone === "B"));
  assert.ok(compacted.every((point, index) => index === 0 || point.tick > compacted[index - 1].tick));
});

test("analiz kompaktlaştırma metrikleri değiştirmeden yalnız rota çizimini seyreltir", () => {
  const analysis = {
    analysisVersion: "3.2.0",
    reports: [{
      kills: 21,
      sprayStats: { status: "measured", sampleCount: 42 },
      roundPaths: [{ round: 1, points: Array.from({ length: 500 }, (_, tick) => ({ tick, zone: "A", x: tick, y: 0, z: 0 })) }],
    }],
  };
  compactAnalysisForStorage(analysis);

  assert.equal(analysis.reports[0].kills, 21);
  assert.deepEqual(analysis.reports[0].sprayStats, { status: "measured", sampleCount: 42 });
  assert.ok(analysis.reports[0].roundPaths[0].points.length <= MAX_STORED_ROUTE_POINTS_PER_ROUND);
});
