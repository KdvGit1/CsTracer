import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const appOrigin = "http://127.0.0.1:43118";

function getFreePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      const port = typeof address === "object" && address ? address.port : 0;
      probe.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

async function waitForCompanion(companionUrl, timeoutMs = 12_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${companionUrl}/health`);
      if (response.ok) return;
    } catch {
      // Süreç henüz portu açmamış olabilir.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Companion test süresi içinde başlamadı.");
}

async function post(companionUrl, path, body) {
  return fetch(`${companionUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: appOrigin },
    body: JSON.stringify(body),
  });
}

test("takım keşif endpoint'i Steam oturumu yokken güvenli önbellek sonucu döndürür", async () => {
  const companionPort = await getFreePort();
  const companionUrl = `http://127.0.0.1:${companionPort}`;
  const dataRoot = mkdtempSync(join(tmpdir(), "tracer-squad-server-"));
  writeFileSync(join(dataRoot, "recent_matches.json"), JSON.stringify([
    { id: "date-a", map: "dust2", timestamp: 1, formattedDate: "Eski A" },
    { id: "date-b", map: "dust2", timestamp: 2, formattedDate: "Eski B" },
  ]), "utf8");
  writeFileSync(join(dataRoot, "scanned_matches.json"), JSON.stringify([
    { id: "date-a", map: "dust2", timestamp: 200_001, formattedDate: "Doğru A" },
    { id: "date-b", map: "dust2", timestamp: 400_002, formattedDate: "Doğru B" },
  ]), "utf8");
  writeFileSync(join(dataRoot, "match_notifications.json"), JSON.stringify([
    {
      id: "match:test-notification", matchId: "test-notification", status: "detected", auto: false, read: false,
      createdAt: 10, updatedAt: 10, message: "Tam rapor için tıkla.",
      match: { id: "test-notification", map: "inferno", mode: "Premier", timestamp: 10 },
    },
  ]), "utf8");
  const serverPath = fileURLToPath(new URL("../companion/server.mjs", import.meta.url));
  const child = spawn(process.execPath, [serverPath], {
    cwd: fileURLToPath(new URL("..", import.meta.url)),
    env: {
      ...process.env,
      TRACER_DATA_DIR: dataRoot,
      TRACER_COMPANION_PORT: String(companionPort),
      TRACER_SKIP_GSI_AUTO_OPTIMIZE: "1",
    },
    stdio: "ignore",
    windowsHide: true,
  });

  try {
    await waitForCompanion(companionUrl);
    const recentResponse = await fetch(`${companionUrl}/matches/recent`);
    const recent = await recentResponse.json();
    const dates = new Map(recent.matches.map((match) => [match.id, match.formattedDate]));
    assert.equal(dates.get("date-a"), "Doğru A");
    assert.equal(dates.get("date-b"), "Doğru B");

    const automationResponse = await fetch(`${companionUrl}/automation/state`);
    assert.equal(automationResponse.status, 200);
    const automation = await automationResponse.json();
    assert.equal(automation.settings.demoRetentionCount, 5);
    assert.equal(automation.unreadCount, 1);

    const settingsResponse = await fetch(`${companionUrl}/automation/settings`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Origin: appOrigin },
      body: JSON.stringify({ demoRetentionCount: 1, autoDownloadLatestMatch: true }),
    });
    assert.equal(settingsResponse.status, 200);
    const settings = await settingsResponse.json();
    assert.equal(settings.settings.demoRetentionCount, 3, "takım koçu için en az üç demo korunmalı");
    assert.equal(settings.settings.autoDownloadLatestMatch, true);

    const readAllResponse = await post(companionUrl, "/notifications/read-all", {});
    assert.equal(readAllResponse.status, 200);
    assert.equal((await readAllResponse.json()).unreadCount, 0);

    const roster = Array.from({ length: 5 }, (_, index) => ({ steamid: `7656119800000000${index}`, name: `A${index}` }));
    const discoveryResponse = await post(companionUrl, "/squads/discover", { roster, map: "de_dust2", refresh: true });
    assert.equal(discoveryResponse.status, 200);
    const discovery = await discoveryResponse.json();
    assert.equal(discovery.scan.requiresLogin, true);
    assert.deepEqual(discovery.availableMatches, []);
    assert.deepEqual(discovery.candidates, []);

    const invalidDownload = await post(companionUrl, "/squads/download", { roster, map: "de_dust2", matchIds: [] });
    assert.equal(invalidDownload.status, 400);

    const gsiResponse = await post(companionUrl, "/gsi", {
      map: { name: "de_inferno", mode: "competitive", phase: "live", round: 4 },
      round: { phase: "live" },
    });
    assert.equal(gsiResponse.status, 200);
    const performanceResponse = await fetch(`${companionUrl}/performance/status`);
    const performance = await performanceResponse.json();
    assert.equal(performance.performance.active, true);

    const canonicalGsiState = await fetch(`${companionUrl}/gsi/state`);
    const legacyGsiState = await fetch(`${companionUrl}/gsi/live`);
    assert.equal(canonicalGsiState.status, 200);
    assert.equal(legacyGsiState.status, 200, "eski canlı ekran adresi geriye uyumlu kalmalı");
    const canonicalStatePayload = await canonicalGsiState.json();
    const legacyStatePayload = await legacyGsiState.json();
    assert.equal(typeof canonicalStatePayload.map.name, "string");
    assert.equal(canonicalStatePayload.connected, true);
    assert.equal(legacyStatePayload.connected, true);

    const blockedAnalysis = await post(companionUrl, "/analyze", {});
    assert.equal(blockedAnalysis.status, 423);
    const blockedPayload = await blockedAnalysis.json();
    assert.equal(blockedPayload.performanceMode, true);
  } finally {
    try {
      await post(companionUrl, "/shutdown", {});
    } catch {
      child.kill();
    }
    await new Promise((resolve) => {
      if (child.exitCode !== null) resolve();
      else {
        const timer = setTimeout(resolve, 2_000);
        child.once("exit", () => {
          clearTimeout(timer);
          resolve();
        });
      }
    });
    if (child.exitCode === null) child.kill();
    rmSync(dataRoot, { recursive: true, force: true });
  }
});
