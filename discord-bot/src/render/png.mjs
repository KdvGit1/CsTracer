// SVG → PNG dönüşümü (resvg, Rust tabanlı; Windows'taki PowerShell/System.Drawing
// çizicisinin Linux/ARM karşılığı). Yazı tipi olarak paketlenmiş Inter kullanılır;
// isimlerdeki CJK/emoji karakterleri için sistem yazı tipleri yedektir.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { renderAsync } from "@resvg/resvg-js";
import { FONT_DIR, FONT_FILES } from "./fonts.mjs";
import { radarCalibration } from "../../engine/companion/radar_calibration.mjs";

const fontFiles = Object.values(FONT_FILES).map((file) => join(FONT_DIR, file)).filter(existsSync);
const PNG_SIGNATURE = "89504e470d0a1a0a";
export const MAX_DISCORD_IMAGE_BYTES = 8 * 1024 * 1024;

export async function renderPng(svg, { width = 0 } = {}) {
  const image = await renderAsync(svg, {
    font: { fontFiles, loadSystemFonts: true, defaultFontFamily: "Inter", sansSerifFamily: "Inter" },
    fitTo: width ? { mode: "width", value: width } : { mode: "original" },
    imageRendering: 0,
    shapeRendering: 2,
    textRendering: 1,
    background: "#0A100E",
  });
  const png = image.asPng();
  if (png.subarray(0, 8).toString("hex") !== PNG_SIGNATURE) throw new Error("Oluşturulan görsel geçerli PNG değil.");
  if (png.length > MAX_DISCORD_IMAGE_BYTES) throw new Error("Görsel Discord sınırını aşıyor.");
  return png;
}

const radarCache = new Map();
let radarManifest = null;

function manifestEntry(mapName) {
  if (!radarManifest) {
    try { radarManifest = JSON.parse(readFileSync(new URL("../../engine/shared/radar-manifest.json", import.meta.url), "utf8")); } catch { radarManifest = {}; }
  }
  const key = String(mapName || "").toLowerCase().split("/").pop().replace(/\.(vpk|bsp)$/i, "");
  return radarManifest[key] || radarManifest[`de_${key}`] || radarManifest[`cs_${key}`] || radarManifest[`ar_${key}`] || null;
}

/** Radar görselini data URI olarak döndürür (küçük LRU önbellek). */
export function radarImage(mapName, { lower = false } = {}) {
  const base = radarCalibration(mapName);
  const entry = manifestEntry(mapName);
  const calibration = base ? { ...base, lowerMaxZ: entry?.lowerImage && Number.isFinite(entry?.lowerMaxZ) ? entry.lowerMaxZ : undefined } : null;
  if (!calibration?.imagePath) return { calibration, href: "" };
  const path = lower ? calibration.imagePath.replace(/\.png$/i, "_lower.png") : calibration.imagePath;
  if (!existsSync(path)) return { calibration, href: "" };
  if (!radarCache.has(path)) {
    if (radarCache.size >= 8) radarCache.delete(radarCache.keys().next().value);
    radarCache.set(path, `data:image/png;base64,${readFileSync(path).toString("base64")}`);
  }
  return { calibration, href: radarCache.get(path) };
}

/** Uzak avatarı (Discord/Steam/FACEIT CDN) küçük data URI'ye çevirir; hata olursa boş döner. */
const avatarCache = new Map();
const AVATAR_HOSTS = /^(cdn\.discordapp\.com|media\.discordapp\.net|avatars\.steamstatic\.com|avatars\.akamai\.steamstatic\.com|steamcdn-a\.akamaihd\.net|distribution\.faceit-cdn\.net|assets\.faceit-cdn\.net)$/i;

export async function fetchAvatar(url, { fetchImpl = fetch, timeoutMs = 4000 } = {}) {
  if (!url) return "";
  let parsed;
  try { parsed = new URL(url); } catch { return ""; }
  if (parsed.protocol !== "https:" || !AVATAR_HOSTS.test(parsed.hostname)) return "";
  if (avatarCache.has(url)) return avatarCache.get(url);
  try {
    const response = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs), redirect: "error" });
    const type = String(response.headers.get("content-type") || "");
    if (!response.ok || !/^image\/(png|jpeg|webp|gif)/.test(type)) return "";
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > 512 * 1024) return "";
    // resvg webp/gif desteklemez; yalnız PNG/JPEG gömülür.
    const mime = bytes.subarray(0, 8).toString("hex") === PNG_SIGNATURE ? "image/png" : bytes[0] === 0xff && bytes[1] === 0xd8 ? "image/jpeg" : "";
    if (!mime) return "";
    const href = `data:${mime};base64,${bytes.toString("base64")}`;
    if (avatarCache.size >= 200) avatarCache.delete(avatarCache.keys().next().value);
    avatarCache.set(url, href);
    return href;
  } catch {
    return "";
  }
}
