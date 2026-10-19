// Discord görselleri için radar kalibrasyonu ve görsel yolu. Arayüz aynı
// kalibrasyonu shared/radar-manifest.json üzerinden kullanır.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const COMPANION_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = join(COMPANION_DIR, "..");
// Geliştirmede public/, portable pakette app-runtime/public/ altında durur.
const IMAGE_DIRS = [
  join(ROOT, "public", "maps"),
  join(ROOT, "app-runtime", "public", "maps"),
  join(ROOT, "dist", "client", "maps"),
];

let manifestCache = null;

function manifest() {
  if (manifestCache) return manifestCache;
  try {
    manifestCache = JSON.parse(readFileSync(join(ROOT, "shared", "radar-manifest.json"), "utf8"));
  } catch {
    manifestCache = {};
  }
  return manifestCache;
}

export function radarCalibration(mapName) {
  const key = String(mapName || "").toLowerCase().replace(/\\/g, "/").split("/").pop().replace(/\.(vpk|bsp)$/i, "");
  const maps = manifest();
  const entry = maps[key] || maps[`de_${key}`] || maps[`cs_${key}`] || maps[`ar_${key}`];
  if (!entry) return null;
  const fileName = String(entry.image || "").split("/").pop();
  const imagePath = IMAGE_DIRS.map((dir) => join(dir, fileName)).find((path) => existsSync(path)) || "";
  return { name: entry.name, label: entry.label, posX: entry.posX, posY: entry.posY, scale: entry.scale, imagePath };
}

/** Dünya koordinatını radar görselindeki 0–1 oranına çevirir; dışarıdaysa null. */
export function radarFraction(calibration, x, y) {
  if (!calibration || !Number.isFinite(x) || !Number.isFinite(y)) return null;
  const size = calibration.scale * 1024;
  const left = (x - calibration.posX) / size;
  const top = (calibration.posY - y) / size;
  return left >= 0 && left <= 1 && top >= 0 && top <= 1 ? { left, top } : null;
}
