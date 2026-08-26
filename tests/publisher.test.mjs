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
});

test("patch ve portable ortak skor motorunu içerir", () => {
  const patchScript = readFileSync(join(root, "launcher", "create-patch.ps1"), "utf8");
  const portableScript = readFileSync(join(root, "launcher", "package-portable.ps1"), "utf8");

  assert.match(patchScript, /"shared"/);
  assert.match(patchScript, /shared\\scoring\.mjs/);
  assert.match(portableScript, /Join-Path \$tracerRoot "shared"/);
  assert.match(portableScript, /shared\\scoring\.mjs/);
});
