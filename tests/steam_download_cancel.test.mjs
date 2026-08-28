import assert from "node:assert/strict";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const sourceDemoDir = new URL("../data/recent_demos/", import.meta.url);

function smallestDemo() {
  if (!existsSync(sourceDemoDir)) return null;
  return readdirSync(sourceDemoDir)
    .filter((name) => name.toLowerCase().endsWith(".dem"))
    .map((name) => ({ name, size: statSync(new URL(name, sourceDemoDir)).size }))
    .sort((left, right) => left.size - right.size)[0]?.name || null;
}

const demoName = smallestDemo();

test("etkin Steam demo analizi iptal edilir ve ikinci indirme eşzamanlı başlamaz", { skip: !demoName && "test demosu yok", timeout: 30_000 }, async () => {
  const dataRoot = mkdtempSync(join(tmpdir(), "tracer-download-cancel-"));
  const demosDir = join(dataRoot, "recent_demos");
  mkdirSync(demosDir, { recursive: true });
  const replayBase = "queue-cancel-test";
  copyFileSync(new URL(demoName, sourceDemoDir), join(demosDir, `${replayBase}.dem`));
  process.env.TRACER_DATA_DIR = dataRoot;

  try {
    const downloader = await import(`../companion/steam_downloader.mjs?cancel-test=${Date.now()}`);
    const activePromise = downloader.downloadSingleMatch(
      "active-match",
      `https://replay1.valve.net/730/${replayBase}.dem.bz2`,
      { id: "active-match", map: "dust2", timestamp: Date.now() },
    );
    await new Promise((resolve) => setTimeout(resolve, 50));

    const busy = await downloader.downloadSingleMatch(
      "second-match",
      "https://replay1.valve.net/730/second-match.dem.bz2",
      { id: "second-match" },
    );
    assert.equal(busy.busy, true);
    assert.equal(busy.activeMatchId, "active-match");
    assert.equal(downloader.cancelSingleMatch("active-match"), true);

    const result = await activePromise;
    assert.equal(result.cancelled, true);
    assert.equal(downloader.getActiveDownloadMatchId(), null);
  } finally {
    delete process.env.TRACER_DATA_DIR;
    rmSync(dataRoot, { recursive: true, force: true });
  }
});
