import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { downloadedDemoMeta, progressMatchDate, validMatchDate } from "../shared/match_dates.mjs";
import { summarizeProgress } from "../shared/experience.mjs";

test("raporu açmak son beş maçın tarihini ve kimliğini değiştirmez", () => {
  const matches = Array.from({ length: 10 }, (_, i) => ({ id: `match-${i}`, date: 1_000_000 - i * 1000, summary: { stats: { adr: 80 + i } } }));
  const before = summarizeProgress(matches);
  const meta = downloadedDemoMeta({ id: matches[0].id, timestamp: matches[0].date, map: "nuke" });
  assert.equal(meta.matchId, matches[0].id);
  assert.equal(meta.matchDate, matches[0].date);
  const reopened = [{ ...matches[0], date: meta.matchDate }, ...matches.slice(1)];
  assert.deepEqual(summarizeProgress(reopened.reverse()), before);
  assert.equal(downloadedDemoMeta(undefined), null);
});

test("sunucu taranmış tarihi korur; açılma zamanı veya sentinel tarihi kabul etmez", () => {
  for (const incoming of [1, Date.now(), undefined]) {
    assert.equal(progressMatchDate("a", incoming, [{ id: "a", timestamp: 3000 }], [{ id: "a", timestamp: 2000 }]), 2000);
    assert.equal(progressMatchDate("a", incoming, [{ id: "a", timestamp: 3000 }]), 3000);
  }
  assert.equal(progressMatchDate("manual", Date.now(), [], [], [{ id: "manual", date: 5000 }]), 5000);
  assert.equal(progressMatchDate("unknown", 1), 0);
});

test("bilinmeyen tarih bugünün maçı veya 1970 olarak son beşe girmez", () => {
  for (const value of [null, undefined, NaN, Infinity, 0, 1, -1, "5000"]) assert.equal(validMatchDate(value), 0);
  const matches = [0, 1, NaN, undefined, 2000].map((date, id) => ({ id: String(id), date, summary: { stats: { adr: 80 } } }));
  assert.deepEqual(summarizeProgress(matches).recent.map(m => m.date), [2000]);
});

test("bildirim raporu maç metadatasını ana ekrana taşır", () => {
  const notification = readFileSync(new URL("../app/components/NotificationCenter.tsx", import.meta.url), "utf8");
  assert.match(notification, /onSelectAnalysis\(payload\.analysis, payload\.match\)/);
  const page = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(page, /setCurrentDemoMeta\(downloadedDemoMeta\(match\)\)/);
  assert.doesNotMatch(page, /analysis\.timestamp\s*\|\|\s*1/);
});
