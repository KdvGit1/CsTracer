import assert from "node:assert/strict";
import test from "node:test";
import { filterMatchLibrary, formatMeasuredNumber, movementEvidence, reportCoverage, summarizeProgress } from "../shared/experience.mjs";
import { createSteamScanJob, sameSteamScanSession } from "../companion/steam_scan_job.mjs";

test("başlangıç özeti eksik/eski veriyi sıfır veya KAST saymaz", () => {
  assert.equal(summarizeProgress([]).adr.value, null);
  const data = summarizeProgress([
    { date: 3, summary: { stats: { adr: 0 }, overall: 0, scoreMethod: "kast-round-contribution-v1" } },
    { date: 2, summary: { stats: { adr: null }, overall: 99 } },
    { date: 1, summary: { stats: { adr: NaN }, overall: null, scoreMethod: "kast-round-contribution-v1" } },
  ]);
  assert.deepEqual(data.adr, { value: 0, count: 1, delta: null });
  assert.deepEqual(data.kast, { value: 0, count: 1, delta: null });
});

test("oranlar kayan nokta kuyruğu olmadan gösterilir; eksik değer sıfır olmaz", () => {
  assert.equal(formatMeasuredNumber(4.1000000000000005), "4,1");
  assert.equal(formatMeasuredNumber(16 / 13, 2), "1,23");
  assert.equal(formatMeasuredNumber(0), "0");
  for (const value of [null, undefined, NaN, Infinity, "2"]) assert.equal(formatMeasuredNumber(value), "—");
});

test("her 10 atış özeti sabit hızlı atış bandını değil silahın gerçek sınır ihlalini anlatır", () => {
  const facts = movementEvidence({ status: "measured", sampleCount: 100, invalidShotPercent: 38, fastPercent: 0, byCategory: { rifle: { shots: 80, movingPercent: 25 }, sniper: { shots: 0, movingPercent: 0 } } });
  assert.equal(facts.invalidPerTen, 4);
  assert.equal(facts.rifle, "%25 (80 atış)");
  assert.equal(facts.sniper, "ölçüm yok");
  assert.equal(facts.smg, "ölçüm yok");
  assert.equal(movementEvidence({ status: "unavailable", invalidShotPercent: 0 }).invalidPerTen, null);
});

test("başlangıç karşılaştırması yalnız iki grupta en az üç ölçümle yapılır", () => {
  const matches = Array.from({ length: 10 }, (_, i) => ({ date: 10 - i, summary: { stats: { adr: i < 5 ? 90 : 80 } } }));
  assert.equal(summarizeProgress(matches).adr.delta, 10);
  assert.equal(summarizeProgress(matches.slice(0, 7)).adr.delta, null);
  assert.equal(summarizeProgress([...matches].reverse()).adr.delta, 10);
});

test("maç araması filtreleri birlikte uygular; kaynak dizisini değiştirmez", () => {
  const matches = [
    { id: "a", map: "nuke", mode: "Premier", timestamp: 1, isDownloaded: true, score: { isWin: true }, players: [{ name: "Işık" }] },
    { id: "b", map: "nuke", timestamp: 3, replayUrl: "https://example.invalid", score: { isWin: false, isTie: true } },
    { id: "c", map: "mirage", timestamp: 2, score: { isWin: false } },
  ];
  assert.deepEqual(filterMatchLibrary(matches, { search: "ışık", map: "nuke", result: "win", tab: "downloaded" }).map((m) => m.id), ["a"]);
  assert.deepEqual(filterMatchLibrary(matches, { tab: "available" }).map((m) => m.id), ["b"]);
  assert.deepEqual(filterMatchLibrary(matches, { result: "loss" }).map((m) => m.id), ["c"]);
  assert.deepEqual(filterMatchLibrary(matches, { sort: "oldest" }).map((m) => m.id), ["a", "c", "b"]);
  assert.deepEqual(matches.map((m) => m.id), ["a", "b", "c"]);
});

test("veri kapsamı gerçek sıfırla eksik veya eski atış verisini ayırır", () => {
  const report = { rounds: 20, kastPercent: 0, sprayStats: { totalShots: 50, accuracyPercent: 0, status: "measured", method: "bullet-damage-event-tick-v2" } };
  let coverage = reportCoverage(report);
  assert.equal(coverage[0].available, true);
  assert.equal(coverage[1].available, true);
  assert.equal(coverage[2].available, false);
  report.sprayStats.method = "bullet-damage-attack-tick-v1";
  coverage = reportCoverage(report);
  assert.equal(coverage[1].available, false);
  report.sprayStats.method = "bullet-damage-event-tick-v2";
  report.sprayStats.accuracyPercent = null;
  assert.equal(reportCoverage(report)[1].available, false);
});

test("Steam işi tek taramayı paylaşır, beklemeden durum verir ve sır sızdırmaz", async () => {
  let resolve;
  let calls = 0;
  const job = createSteamScanJob(() => { calls++; return new Promise((done) => { resolve = done; }); });
  const first = job.start();
  const second = job.start();
  assert.equal(first, second);
  assert.equal(job.snapshot().running, true);
  assert.equal(job.snapshot().revision, 1);
  await Promise.resolve();
  assert.equal(calls, 1);
  resolve({ ok: true, message: "Tamamlandı", steamLoginSecure: "test-secret", scannedMatches: [{ id: "x" }] });
  await first;
  assert.equal(job.snapshot().running, false);
  assert.equal(job.snapshot().revision, 2);
  assert.ok(job.snapshot().finishedAt > 0);
  assert.doesNotMatch(JSON.stringify(job.snapshot()), /test-secret|scannedMatches/);
  const snapshot = job.snapshot();
  snapshot.running = true;
  assert.equal(job.snapshot().running, false);
});

test("Steam işi bir hatadan sonra kilitlenmez; eski oturum sonucu tanınır", async () => {
  let attempts = 0;
  const job = createSteamScanJob(() => { if (++attempts === 1) throw new Error("test"); return { ok: true, message: "Yeniden hazır" }; });
  await assert.rejects(job.start(), /test/);
  assert.equal(job.snapshot().ok, false);
  await job.start();
  assert.equal(job.snapshot().ok, true);
  assert.equal(sameSteamScanSession({ steamId: "a", steamLoginSecure: "old" }, { steamId: "a", steamLoginSecure: "new" }), false);
  assert.equal(sameSteamScanSession({ steamId: "a", steamLoginSecure: "same" }, { steamId: "b", steamLoginSecure: "same" }), false);
});
