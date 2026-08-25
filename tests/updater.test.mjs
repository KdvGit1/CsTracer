import assert from "node:assert/strict";
import test from "node:test";
import { selectPatchAsset } from "../companion/updater.mjs";

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
