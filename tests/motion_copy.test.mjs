import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
const source = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

test("animasyonlar erişilebilirlik ve oyun performansı tercihlerine uyar", () => {
  const css = source("../app/motion.css");
  assert.match(css, /prefers-reduced-motion:reduce/);
  assert.match(css, /data-motion="reduced"/);
  assert.match(css, /data-motion-paused="true"/);
  assert.match(css, /\.performance-mode/);
  assert.match(css, /\.squad-focus-mode/);
  assert.match(css, /animation:none!important/);
  assert.doesNotMatch(css, /@import|url\(|backdrop-filter|will-change/);
  const preferences = source("../app/components/MotionSettings.tsx");
  assert.match(preferences, /aria-pressed/);
  assert.match(preferences, /useSyncExternalStore/);
  assert.match(preferences, /visibilitychange/);
  assert.match(preferences, /removeEventListener/);
  assert.doesNotMatch(preferences, /fetch\(|setInterval|requestAnimationFrame/);
});

test("metin düzeltmeleri analiz yöntem kimliğini değiştirmez", () => {
  const page = source("../app/page.tsx");
  assert.match(page, /report\.crosshairStats\.method === "kill-tick-alignment-v2"/);
  assert.doesNotMatch(page, /method === "Öldürme/);
  assert.match(page, /downloadedDemoMeta\(match\)/);
  assert.match(page, /<MotionSettings \/>/);
  assert.doesNotMatch(page, /key=\{activeView\}/);
});

test("arayüz metni sade Türkçe kullanır; puan ve ölçüm ayrımını korur", () => {
  const home = source("../app/components/HomeOverview.tsx");
  const aim = source("../app/components/AimCoachCard.tsx");
  const guide = source("../app/components/AnalysisGuide.tsx");
  assert.match(home, /Son 5 maçın özeti/);
  assert.match(home, /tarihi bilinmeyen maçlar dahil edilmez/);
  assert.match(guide, /resmî CS2 derecesi veya profesyonellik ölçüsü değildir/);
  assert.doesNotMatch(aim, /Mekanik Hata Teşhisi|Antrenman Reçetesi|güçlü bir tekrar|Kapsamlı Full/);
  assert.match(aim, /Olası neden/);
  assert.match(source("../app/growth.tsx"), /pathLength=\{1\}/);
});
