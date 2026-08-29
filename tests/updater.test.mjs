import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyExtractedPatch, selectPatchAsset } from "../companion/updater.mjs";

test("güncelleyici tam portable yerine sürümle eşleşen hafif patch asset'ini seçer", () => {
  const assets = [
    { name: "TRACER-Portable-v0.48.0.zip", browser_download_url: "https://github.com/full.zip" },
    { name: "TRACER-Portable-v0.48.0.rar", browser_download_url: "https://github.com/full.rar" },
    { name: "TRACER-Patch-v0.47.0.zip", browser_download_url: "https://github.com/old.zip" },
    { name: "TRACER-Patch-v0.48.0.zip", browser_download_url: "https://github.com/patch.zip" },
  ];
  assert.equal(selectPatchAsset(assets, "0.48.0")?.browser_download_url, "https://github.com/patch.zip");
});

test("patch olmayan release arşivi uygulama güncellemesi diye seçilmez", () => {
  const assets = [{ name: "TRACER-Portable-v0.48.0.zip" }, { name: "Source-code.zip" }];
  assert.equal(selectPatchAsset(assets, "0.48.0"), null);
});

test("portable yaması kök dosyaları ve klasörleri yedekleyip uygular", async (t) => {
  const sandbox = await mkdtemp(join(tmpdir(), "tracer updater test "));
  const root = join(sandbox, "TRACER Portable v0.50.4");
  const extracted = join(sandbox, "extracted patch");
  const backup = join(sandbox, "rollback backup");
  t.after(() => rm(sandbox, { recursive: true, force: true }));

  await mkdir(join(root, "companion"), { recursive: true });
  await mkdir(join(root, "data"), { recursive: true });
  await writeFile(join(root, "version.json"), "old-version", "utf8");
  await writeFile(join(root, "companion", "server.mjs"), "old-server", "utf8");
  await writeFile(join(root, "data", "history.json"), "player-history", "utf8");

  await mkdir(join(extracted, "companion"), { recursive: true });
  await mkdir(join(extracted, "data"), { recursive: true });
  await writeFile(join(extracted, "version.json"), "new-version", "utf8");
  await writeFile(join(extracted, "companion", "server.mjs"), "new-server", "utf8");
  await writeFile(join(extracted, "data", "history.json"), "must-not-overwrite", "utf8");

  const result = await applyExtractedPatch(extracted, root, backup);

  assert.equal(await readFile(join(root, "version.json"), "utf8"), "new-version");
  assert.equal(await readFile(join(root, "companion", "server.mjs"), "utf8"), "new-server");
  assert.equal(await readFile(join(root, "data", "history.json"), "utf8"), "player-history");
  assert.equal(await readFile(join(backup, "version.json"), "utf8"), "old-version");
  assert.equal(await readFile(join(backup, "companion", "server.mjs"), "utf8"), "old-server");
  assert.deepEqual(result.appliedEntries.sort(), ["companion", "version.json"]);
});

test("yama dosya ve klasör türü değişikliklerini güvenle uygular", async (t) => {
  const sandbox = await mkdtemp(join(tmpdir(), "tracer updater type test "));
  const root = join(sandbox, "portable root");
  const extracted = join(sandbox, "patch root");
  const backup = join(sandbox, "backup root");
  t.after(() => rm(sandbox, { recursive: true, force: true }));

  await mkdir(join(root, "becomes-file"), { recursive: true });
  await writeFile(join(root, "becomes-file", "old.txt"), "old", "utf8");
  await writeFile(join(root, "becomes-directory"), "old-file", "utf8");

  await mkdir(join(extracted, "becomes-directory"), { recursive: true });
  await writeFile(join(extracted, "becomes-directory", "new.txt"), "new-dir", "utf8");
  await writeFile(join(extracted, "becomes-file"), "new-file", "utf8");

  await applyExtractedPatch(extracted, root, backup);

  assert.equal(await readFile(join(root, "becomes-file"), "utf8"), "new-file");
  assert.equal(await readFile(join(root, "becomes-directory", "new.txt"), "utf8"), "new-dir");
  assert.equal(await readFile(join(backup, "becomes-file", "old.txt"), "utf8"), "old");
  assert.equal(await readFile(join(backup, "becomes-directory"), "utf8"), "old-file");
});

test("uygulama sırasında hata oluşursa önceki sürümü geri yükler", async (t) => {
  const sandbox = await mkdtemp(join(tmpdir(), "tracer updater rollback test "));
  const root = join(sandbox, "portable root");
  const extracted = join(sandbox, "patch root");
  const backup = join(sandbox, "backup root");
  const unsupportedTarget = join(sandbox, "unsupported target");
  t.after(() => rm(sandbox, { recursive: true, force: true }));

  await mkdir(root, { recursive: true });
  await mkdir(extracted, { recursive: true });
  await mkdir(unsupportedTarget, { recursive: true });
  await writeFile(join(root, "a-version.json"), "old-version", "utf8");
  await writeFile(join(extracted, "a-version.json"), "new-version", "utf8");
  await symlink(unsupportedTarget, join(extracted, "z-unsupported-link"), "junction");

  await assert.rejects(
    applyExtractedPatch(extracted, root, backup),
    /önceki sürüme otomatik geri dönüldü/,
  );

  assert.equal(await readFile(join(root, "a-version.json"), "utf8"), "old-version");
});
