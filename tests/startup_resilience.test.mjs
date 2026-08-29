import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("companion ağır parser doğrulamasını beklemeden yerel portu açar", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "tracer-fast-start-"));
  const startedAt = Date.now();
  const child = spawn(process.execPath, ["companion/server.mjs"], {
    cwd: new URL("..", import.meta.url),
    env: {
      ...process.env,
      TRACER_COMPANION_PORT: "0",
      TRACER_DATA_DIR: dataDir,
      TRACER_SKIP_GSI_AUTO_OPTIMIZE: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });

  let output = "";
  try {
    await new Promise((resolvePromise, rejectPromise) => {
      const timer = setTimeout(() => rejectPromise(new Error(`Companion hızlı başlamadı: ${output}`)), 5_000);
      const collect = (chunk) => {
        output += chunk.toString("utf8");
        if (output.includes("TRACER yerel parser hazır")) {
          clearTimeout(timer);
          resolvePromise();
        }
      };
      child.stdout.on("data", collect);
      child.stderr.on("data", collect);
      child.once("error", (error) => {
        clearTimeout(timer);
        rejectPromise(error);
      });
      child.once("exit", (code) => {
        if (!output.includes("TRACER yerel parser hazır")) {
          clearTimeout(timer);
          rejectPromise(new Error(`Companion erken kapandı (${code}): ${output}`));
        }
      });
    });
    assert.ok(Date.now() - startedAt < 5_000);
  } finally {
    child.kill();
    await new Promise((resolvePromise) => {
      if (child.exitCode !== null) resolvePromise();
      else child.once("exit", resolvePromise);
    });
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("başlatıcı arayüzü parserdan bağımsız açar ve 35 saniyelik web beklemesi kullanmaz", async () => {
  const [launcher, server, downloader, recentMatches] = await Promise.all([
    readFile(new URL("../launcher/start-tracer.ps1", import.meta.url), "utf8"),
    readFile(new URL("../companion/server.mjs", import.meta.url), "utf8"),
    readFile(new URL("../companion/steam_downloader.mjs", import.meta.url), "utf8"),
    readFile(new URL("../app/components/RecentMatchesView.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(launcher, /Wait-ForLocalPort 43118 15/);
  assert.match(launcher, /Wait-ForLocalPort 43119 2/);
  assert.doesNotMatch(launcher, /Demo parser 35 saniye|Wait-ForUrl/);
  assert.match(launcher, /Yerel parser arka planda yeniden başlatılıyor/);
  assert.doesNotMatch(server, /^import .*\.\/analyze\.mjs/m);
  assert.match(server, /prepareRecentMatchesStorage\(\)/);
  assert.match(server, /quickDemoMetaInWorker/);
  assert.doesNotMatch(downloader, /^import bz2Stream from "unbzip2-stream"/m);
  assert.match(downloader, /import\("unbzip2-stream"\)/);
  assert.match(downloader, /Promise\.any\(buildGcpdRequestUrls/);
  assert.match(recentMatches, /loadWhenCompanionIsReady/);
  assert.match(recentMatches, /AbortSignal\.timeout\(8_000\)/);
  assert.match(recentMatches, /void triggerScan\(false\)/);
  assert.doesNotMatch(recentMatches, /await triggerScan\(true\)/);
});

test("kayıtlı oyuncu companion geç başlasa da yeniden yüklenir", async () => {
  const [page, notifications] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/NotificationCenter.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(page, /restoreSavedPlayer/);
  assert.match(page, /loadProgressMemory\(attempt > 0\)/);
  assert.match(page, /Profil yükleniyor…/);
  assert.match(page, /onProgressChange=\{refreshProgressMemory\}/);
  assert.match(notifications, /lastReadyProgressKey/);
});
