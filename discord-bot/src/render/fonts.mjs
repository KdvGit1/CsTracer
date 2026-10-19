// Kartlardaki metinleri kesmek ve ortalamak için Inter yazı tipinin gerçek
// karakter genişliklerini (hmtx + cmap tabloları) okur. SVG'de otomatik satır
// kaydırma/kısaltma olmadığından taşmayı burada önleriz.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { BOT_ROOT } from "../config.mjs";

export const FONT_DIR = join(BOT_ROOT, "assets", "fonts");
export const FONT_FILES = {
  400: "Inter-Regular.otf",
  500: "Inter-Medium.otf",
  600: "Inter-SemiBold.otf",
  700: "Inter-Bold.otf",
  800: "Inter-ExtraBold.otf",
};

function tables(buffer) {
  const count = buffer.readUInt16BE(4);
  const map = new Map();
  for (let index = 0; index < count; index++) {
    const offset = 12 + index * 16;
    map.set(buffer.toString("ascii", offset, offset + 4), { offset: buffer.readUInt32BE(offset + 8), length: buffer.readUInt32BE(offset + 12) });
  }
  return map;
}

function readCmap(buffer, table) {
  const glyphs = new Map();
  const count = buffer.readUInt16BE(table.offset + 2);
  let best = null;
  for (let index = 0; index < count; index++) {
    const record = table.offset + 4 + index * 8;
    const platform = buffer.readUInt16BE(record);
    const encoding = buffer.readUInt16BE(record + 2);
    const offset = table.offset + buffer.readUInt32BE(record + 4);
    const format = buffer.readUInt16BE(offset);
    if (platform === 3 && encoding === 10 && format === 12) { best = { offset, format }; break; }
    if (platform === 3 && encoding === 1 && format === 4 && !best) best = { offset, format };
    if (platform === 0 && (format === 4 || format === 12) && !best) best = { offset, format };
  }
  if (!best) return glyphs;
  if (best.format === 12) {
    const groups = buffer.readUInt32BE(best.offset + 12);
    for (let index = 0; index < groups; index++) {
      const group = best.offset + 16 + index * 12;
      const start = buffer.readUInt32BE(group);
      const end = buffer.readUInt32BE(group + 4);
      const glyph = buffer.readUInt32BE(group + 8);
      for (let code = start; code <= end && code - start < 0x10000; code++) glyphs.set(code, glyph + (code - start));
    }
    return glyphs;
  }
  const segments = buffer.readUInt16BE(best.offset + 6) / 2;
  const ends = best.offset + 14;
  const starts = ends + segments * 2 + 2;
  const deltas = starts + segments * 2;
  const ranges = deltas + segments * 2;
  for (let index = 0; index < segments; index++) {
    const end = buffer.readUInt16BE(ends + index * 2);
    const start = buffer.readUInt16BE(starts + index * 2);
    const delta = buffer.readInt16BE(deltas + index * 2);
    const rangeOffset = buffer.readUInt16BE(ranges + index * 2);
    for (let code = start; code <= end && code !== 0xffff; code++) {
      let glyph;
      if (rangeOffset === 0) glyph = (code + delta) & 0xffff;
      else {
        const position = ranges + index * 2 + rangeOffset + (code - start) * 2;
        glyph = buffer.readUInt16BE(position);
        if (glyph) glyph = (glyph + delta) & 0xffff;
      }
      if (glyph) glyphs.set(code, glyph);
    }
  }
  return glyphs;
}

function loadMetrics(file) {
  const buffer = readFileSync(join(FONT_DIR, file));
  const map = tables(buffer);
  const head = map.get("head");
  const hhea = map.get("hhea");
  const hmtx = map.get("hmtx");
  const cmap = map.get("cmap");
  const unitsPerEm = buffer.readUInt16BE(head.offset + 18);
  const metricCount = buffer.readUInt16BE(hhea.offset + 34);
  const advances = new Uint16Array(metricCount);
  for (let index = 0; index < metricCount; index++) advances[index] = buffer.readUInt16BE(hmtx.offset + index * 4);
  return { unitsPerEm, advances, glyphs: readCmap(buffer, cmap) };
}

const cache = new Map();
function metrics(weight) {
  const key = FONT_FILES[weight] ? weight : weight >= 650 ? 700 : 400;
  if (!cache.has(key)) cache.set(key, loadMetrics(FONT_FILES[key]));
  return cache.get(key);
}

/** Metnin piksel genişliği (yaklaşık; kerning hesaba katılmaz). */
export function textWidth(value, size, weight = 400) {
  const font = metrics(weight);
  let units = 0;
  for (const character of String(value ?? "")) {
    const glyph = font.glyphs.get(character.codePointAt(0));
    // Inter'de olmayan karakterler (CJK, emoji) yedek yazı tipinde ~1em genişliğindedir.
    units += glyph === undefined ? font.unitsPerEm : font.advances[Math.min(glyph, font.advances.length - 1)];
  }
  return (units / font.unitsPerEm) * size;
}

/** Genişliğe sığmayan metni sonuna … koyarak kısaltır. */
export function fitText(value, maxWidth, size, weight = 400) {
  const clean = String(value ?? "").replace(/[\r\n\t]+/g, " ").trim();
  if (textWidth(clean, size, weight) <= maxWidth) return clean;
  const characters = [...clean];
  let low = 0;
  let high = characters.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (textWidth(`${characters.slice(0, middle).join("").trimEnd()}…`, size, weight) <= maxWidth) low = middle;
    else high = middle - 1;
  }
  return low > 0 ? `${characters.slice(0, low).join("").trimEnd()}…` : "…";
}

/** Metni verilen genişlikte satırlara böler; satır sınırı aşılırsa son satır kısaltılır. */
export function wrapText(value, maxWidth, size, weight = 400, maxLines = 3) {
  const words = String(value ?? "").replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  const lines = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (textWidth(candidate, size, weight) <= maxWidth || !current) current = candidate;
    else { lines.push(current); current = word; }
  }
  if (current) lines.push(current);
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    kept[maxLines - 1] = fitText(`${kept[maxLines - 1]} ${lines.slice(maxLines).join(" ")}`, maxWidth, size, weight);
    return kept;
  }
  return lines.map((line) => fitText(line, maxWidth, size, weight));
}
