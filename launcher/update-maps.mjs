import { writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const root = new URL('../', import.meta.url);
const source = 'https://raw.githubusercontent.com/MurkyYT/cs2-map-icons/main/data/available.json';
const response = await fetch(source, { signal: AbortSignal.timeout(30000) });
if (!response.ok) throw new Error(`Map catalog: ${response.status}`);
const catalog = await response.json();
const manifest = {};
await mkdir(new URL('public/maps/', root), { recursive: true });
for (const [name, entry] of Object.entries(catalog.maps || {})) {
  const info = entry.radar_info;
  if (!/^(de|cs|ar)_[a-z0-9_]+$/.test(name) || !info || ![info.pos_x, info.pos_y, info.scale].every(Number.isFinite) || info.scale <= 0) continue;
  const paths = entry.radar_paths || [];
  const upper = paths.find((p) => !/lower|higher|spectate/.test(p));
  if (!upper) continue;
  const map = { name, label: entry.display_name || name, image: `/maps/${name}.png`, posX: info.pos_x, posY: info.pos_y, scale: info.scale };
  async function download(url, file) {
    if (!url.startsWith('https://raw.githubusercontent.com/MurkyYT/cs2-map-icons/main/images/radars/')) throw new Error('Unexpected map asset source');
    const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
    if (!res.ok) throw new Error(`${name}: ${res.status}`);
    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a' || bytes.readUInt32BE(16) !== bytes.readUInt32BE(20)) throw new Error(`${name}: invalid/non-square radar`);
    await writeFile(new URL(`public${file}`, root), bytes);
  }
  await download(upper, map.image);
  const lower = paths.find((p) => /_lower_/.test(p));
  const lowerMaxZ = Number(info.verticalsections?.lower?.AltitudeMax);
  if (lower && Number.isFinite(lowerMaxZ)) { map.lowerImage = `/maps/${name}_lower.png`; map.lowerMaxZ = lowerMaxZ; await download(lower, map.lowerImage); }
  manifest[name] = map;
}
if (!manifest.de_cache || !manifest.de_mirage) throw new Error('Incomplete radar catalog');
await writeFile(new URL('public/maps/available.json', root), JSON.stringify(catalog, null, 2) + '\n');
await writeFile(new URL('app/radar-manifest.json', root), JSON.stringify(manifest, null, 2) + '\n');
await writeFile(new URL('public/maps/SOURCE.txt', root), `Map assets and overview data belong to Valve.\nSource: ${source}\nDownloaded: ${new Date().toISOString()}\nRotation/zoom in overview files configure the in-game HUD, not the north-up radar transform.\n`);
console.log(`${Object.keys(manifest).length} radar maps updated: ${fileURLToPath(new URL('app/radar-manifest.json', root))}`);
