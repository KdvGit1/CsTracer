import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const manifestUpdater = join(root, "launcher", "sync-version-files.mjs");
const publisher = join(root, "launcher", "publish-release.ps1");

test("yayıncı package-lock boş paket anahtarını kaybetmeden sürümü eşitler", () => {
  const workDir = mkdtempSync(join(tmpdir(), "tracer-publisher-"));
  const versionPath = join(workDir, "version.json");
  const packagePath = join(workDir, "package.json");
  const lockPath = join(workDir, "package-lock.json");

  try {
    writeFileSync(versionPath, JSON.stringify({
      version: "0.48.0",
      releaseDate: "2026-08-25",
      title: "TRACER v0.48.0 - Test",
      changelog: ["koru"],
    }, null, 2));
    writeFileSync(packagePath, JSON.stringify({
      name: "tracer-test",
      version: "0.48.0",
      private: true,
    }, null, 2));
    writeFileSync(lockPath, JSON.stringify({
      name: "tracer-test",
      version: "0.48.0",
      lockfileVersion: 3,
      packages: {
        "": { name: "tracer-test", version: "0.48.0" },
        "node_modules/example": { version: "1.2.3" },
      },
    }, null, 2));

    execFileSync(process.execPath, [manifestUpdater, versionPath, packagePath, lockPath, "0.49.0", "2026-08-26"]);
    const updatedVersion = JSON.parse(readFileSync(versionPath, "utf8"));
    const updatedPackage = JSON.parse(readFileSync(packagePath, "utf8"));
    const updated = JSON.parse(readFileSync(lockPath, "utf8"));

    assert.equal(updatedVersion.version, "0.49.0");
    assert.equal(updatedVersion.releaseDate, "2026-08-26");
    assert.equal(updatedVersion.title, "TRACER v0.49.0 - Test");
    assert.deepEqual(updatedVersion.changelog, ["koru"]);
    assert.equal(updatedPackage.version, "0.49.0");
    assert.equal(updatedPackage.private, true);
    assert.equal(updated.version, "0.49.0");
    assert.equal(updated.packages[""].version, "0.49.0");
    assert.equal(updated.packages["node_modules/example"].version, "1.2.3");
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
});

test("yayıncı Windows PowerShell 5.1 uyumsuz AsHashtable seçeneğini kullanmaz", () => {
  const source = readFileSync(publisher, "utf8");

  assert.doesNotMatch(source, /ConvertFrom-Json\s+-AsHashtable/);
  assert.match(source, /\[switch\]\$VersionSyncOnly/);
  assert.match(source, /\[switch\]\$BuildOnly/);
  assert.match(source, /npm test/);
  assert.match(source, /npm run lint/);
  assert.match(source, /npm run typecheck/);
  assert.match(source, /sync-version-files\.mjs/);
  assert.match(source, /\$targetVersion -eq \$currentVersion/);
  assert.match(source, /\$vData\.releaseDate/);
});

test("patch ve portable ortak skor motorunu içerir", () => {
  const patchScript = readFileSync(join(root, "launcher", "create-patch.ps1"), "utf8");
  const portableScript = readFileSync(join(root, "launcher", "package-portable.ps1"), "utf8");

  assert.match(patchScript, /"shared"/);
  assert.match(patchScript, /shared\\scoring\.mjs/);
  assert.match(portableScript, /Join-Path \$tracerRoot "shared"/);
  assert.match(portableScript, /shared\\scoring\.mjs/);
});

test("patch ve portable Steam bz2 çalışma zamanı bağımlılıklarını companion altında taşır", () => {
  const patchScript = readFileSync(join(root, "launcher", "create-patch.ps1"), "utf8");
  const portableScript = readFileSync(join(root, "launcher", "package-portable.ps1"), "utf8");

  for (const source of [patchScript, portableScript]) {
    assert.match(source, /companion\\node_modules/);
    assert.match(source, /"unbzip2-stream", "buffer", "through", "ieee754"/);
    assert.match(source, /buffer\\node_modules\\base64-js\\package\.json/);
    assert.match(source, /createRequire/);
    assert.match(source, /require\('unbzip2-stream'\)/);
  }
});

test("patch ve portable dayanıklı Steam bağlantı katmanını zorunlu dosya sayar", () => {
  for (const script of ["../launcher/create-patch.ps1", "../launcher/package-portable.ps1"]) {
    const source = readFileSync(new URL(script, import.meta.url), "utf8");
    assert.match(source, /companion\\steam_downloader\.mjs/);
    assert.match(source, /companion\\analysis_version\.mjs/);
    assert.match(source, /companion\\analyze-worker\.mjs/);
    assert.match(source, /companion\\match_storage\.mjs/);
    assert.match(source, /companion\\recent-matches-compactor\.mjs/);
    assert.match(source, /companion\\steam_http\.mjs/);
    assert.match(source, /companion\\steam_http_bridge\.ps1/);
    assert.match(source, /companion\\steam_replay_url\.mjs/);
  }
});

test("yayıncı eski portable kurulumlar için güncelleyici kurtarma paketini ekler", () => {
  const source = readFileSync(publisher, "utf8");
  const hotfixScript = readFileSync(join(root, "launcher", "create-updater-hotfix.ps1"), "utf8");

  assert.match(source, /create-updater-hotfix\.ps1/);
  assert.match(source, /TRACER-Guncelleyici-Duzeltmesi-v\$targetVersion\.zip/);
  assert.match(source, /release create \$tag "\$patchZip" "\$updaterHotfix" "\$portableArchive"/);
  assert.match(hotfixScript, /companion\\updater\.mjs/);
  assert.match(hotfixScript, /KURULUM\.txt/);
});

test("oyuncu başlatıcısı Windows PowerShell 5.1 için UTF-8 BOM taşır", () => {
  const launcherBytes = readFileSync(join(root, "launcher", "start-tracer.ps1"));
  assert.deepEqual([...launcherBytes.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
});
