// Kurulum kontrolü: yerel modüller (ARM/x64), yazı tipleri, harita verisi,
// bellek ve disk. Kullanım: npm run check
import { existsSync, readdirSync, statfsSync } from "node:fs";
import { freemem, totalmem, arch, platform } from "node:os";
import { join } from "node:path";
import { BOT_ROOT, features, loadConfig } from "../src/config.mjs";

const results = [];
const check = async (label, run, hint = "") => {
  try {
    const detail = await run();
    results.push(["✓", label, detail || ""]);
  } catch (error) {
    results.push(["✗", label, `${error.message}${hint ? ` → ${hint}` : ""}`]);
  }
};

await check("Node.js ≥ 22.13", () => {
  const [major, minor] = process.versions.node.split(".").map(Number);
  if (major < 22 || (major === 22 && minor < 13)) throw new Error(process.versions.node);
  return `${process.versions.node} · ${platform()}-${arch()}`;
}, "NodeSource ile Node 22 kur");
await check("SQLite (node:sqlite)", async () => {
  const { DatabaseSync } = await import("node:sqlite");
  new DatabaseSync(":memory:").close();
  return process.versions.sqlite;
});
await check("Demo ayrıştırıcı (@laihoe/demoparser2)", async () => {
  const parser = await import("@laihoe/demoparser2");
  if (typeof parser.parseEvents !== "function") throw new Error("parseEvents yok");
  return "yüklendi";
}, "npm ci --omit=dev");
await check("Görsel çizici (@resvg/resvg-js)", async () => {
  const { renderPng } = await import("../src/render/png.mjs");
  const png = await renderPng('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20"><text x="2" y="15" font-family="Inter" font-size="12">ŞİĞ</text></svg>');
  return `${png.length} bayt PNG`;
});
await check("Inter yazı tipi", () => {
  const files = readdirSync(join(BOT_ROOT, "assets", "fonts")).filter((file) => file.endsWith(".otf"));
  if (files.length < 5) throw new Error(`${files.length} dosya`);
  return `${files.length} kalınlık`;
});
await check("Harita geometrisi (duvar/duman raycast)", async () => {
  const { loadMapGeometry } = await import("../engine/companion/map_geometry.mjs");
  const result = loadMapGeometry("de_mirage");
  if (!result.mesh) throw new Error(result.reason || result.status);
  return result.status;
}, "depoyu tam klonla (companion/geometry gerekli) veya TRACER_GEOMETRY_DIR ayarla");
await check("Radar görselleri", () => {
  const dir = join(BOT_ROOT, "engine", "public", "maps");
  const count = existsSync(dir) ? readdirSync(dir).filter((file) => file.endsWith(".png")).length : 0;
  if (count < 10) throw new Error(`${count} görsel`);
  return `${count} görsel`;
}, "npm run maps");
await check("Bellek", () => {
  const total = totalmem() / 1024 ** 3;
  const free = freemem() / 1024 ** 3;
  if (total < 3.5) throw new Error(`${total.toFixed(1)} GB toplam — tam maç analizi için en az 4 GB (önerilen ≥ 8 GB) gerekir`);
  return `${total.toFixed(1)} GB toplam · ${free.toFixed(1)} GB boş`;
}, "Oracle'da VM.Standard.A1.Flex (ARM) kullan; 1 GB'lık AMD micro yetmez");
await check("Disk", () => {
  const stats = statfsSync(BOT_ROOT);
  const free = (stats.bavail * stats.bsize) / 1024 ** 3;
  if (free < 3) throw new Error(`${free.toFixed(1)} GB boş`);
  return `${free.toFixed(1)} GB boş`;
});
let config = null;
await check(".env ayarları", () => {
  config = loadConfig({ requireToken: false });
  if (!config.token) throw new Error("DISCORD_TOKEN boş");
  const enabled = features(config);
  return Object.entries(enabled).map(([key, value]) => `${key}:${value ? "açık" : "kapalı"}`).join(" ");
}, ".env.example dosyasını .env olarak kopyala");

for (const [mark, label, detail] of results) console.log(`${mark} ${label}${detail ? ` — ${detail}` : ""}`);
const failed = results.filter(([mark]) => mark === "✗").length;
console.log(failed ? `\n${failed} sorun var.` : "\nHer şey hazır. `npm start` ile başlat.");
process.exitCode = failed ? 1 : 0;
