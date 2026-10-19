// Radar görsellerini indirir (Valve'ın harita görselleri; depoya eklenmez).
// Kaynak masaüstü TRACER ile aynı: MurkyYT/cs2-map-icons. Kalibrasyon
// engine/shared/radar-manifest.json içindeki v0.53.0 değerleridir.
// Kullanım: npm run maps
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

const SOURCE = "https://raw.githubusercontent.com/MurkyYT/cs2-map-icons/main/data/available.json";
const ASSET_PREFIX = "https://raw.githubusercontent.com/MurkyYT/cs2-map-icons/main/images/radars/";
const outDir = new URL("../engine/public/maps/", import.meta.url);
const manifest = JSON.parse(readFileSync(new URL("../engine/shared/radar-manifest.json", import.meta.url), "utf8"));
mkdirSync(outDir, { recursive: true });

const catalogResponse = await fetch(SOURCE, { signal: AbortSignal.timeout(30_000) });
if (!catalogResponse.ok) throw new Error(`Harita kataloğu indirilemedi: ${catalogResponse.status}`);
const catalog = await catalogResponse.json();

async function download(url, file) {
  if (!url.startsWith(ASSET_PREFIX)) throw new Error(`Beklenmeyen görsel kaynağı: ${url}`);
  const target = new URL(file, outDir);
  if (existsSync(target) && !process.argv.includes("--force")) return "var";
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`${file}: ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a" || bytes.readUInt32BE(16) !== bytes.readUInt32BE(20)) throw new Error(`${file}: kare PNG değil`);
  writeFileSync(target, bytes);
  return "indirildi";
}

let ok = 0;
for (const [name, entry] of Object.entries(manifest)) {
  const paths = catalog.maps?.[name]?.radar_paths || [];
  const upper = paths.find((path) => !/lower|higher|spectate/.test(path));
  if (!upper) {
    console.warn(`- ${name}: katalogda radar yok`);
    continue;
  }
  try {
    const status = await download(upper, `${name}.png`);
    const lower = entry.lowerImage ? paths.find((path) => /_lower_/.test(path)) : null;
    if (lower) await download(lower, `${name}_lower.png`);
    console.log(`✓ ${name} (${status})`);
    ok++;
  } catch (error) {
    console.warn(`✗ ${name}: ${error.message}`);
  }
}
writeFileSync(new URL("SOURCE.txt", outDir), `Map assets belong to Valve.\nSource: ${SOURCE}\nDownloaded: ${new Date().toISOString()}\n`);
console.log(`${ok} radar haritası hazır.`);
