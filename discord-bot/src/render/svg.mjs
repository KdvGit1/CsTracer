// Kart çizimleri için küçük SVG yardımcıları. Renkler TRACER masaüstü
// uygulamasının koyu yeşil teması ve lime vurgusuyla aynıdır.
import { fitText, textWidth, wrapText } from "./fonts.mjs";

export const THEME = Object.freeze({
  bg: "#0A100E",
  bgDeep: "#070A09",
  panel: "#14201A",
  panelAlt: "#111A16",
  panelHi: "#1B2A1B",
  border: "#29352F",
  borderHi: "#3C5037",
  accent: "#C8F54D",
  accentInk: "#17200D",
  text: "#EEF3F0",
  textSoft: "#C9D6CC",
  muted: "#98A99E",
  dim: "#81978B",
  win: "#C8F54D",
  loss: "#FF6F77",
  tie: "#F4C95D",
  cyan: "#68D4FF",
  orange: "#FFAD66",
  purple: "#C3A1FF",
  pink: "#FF7F9D",
  gold: "#F4C95D",
  ct: "#6EAAFF",
  t: "#F2B45C",
});

export const PLAYER_COLORS = ["#B9EE64", "#68D4FF", "#FFAD66", "#C3A1FF", "#FF7F9D"];

// XML 1.0'da geçersiz kontrol karakterleri (oyuncu adlarında olabilir) atılır.
const validXmlCharacter = (character) => {
  const code = character.codePointAt(0);
  return code === 9 || code === 10 || code === 13 || (code >= 32 && code !== 0xfffe && code !== 0xffff);
};

export function escapeXml(value) {
  return [...String(value ?? "")].filter(validXmlCharacter).join("")
    .replace(/[<>&"']/g, (character) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "\"": "&quot;", "'": "&apos;" })[character])
    // SVG ardışık boşlukları birleştirir; tasarımdaki aralıkları korumak için bölünmez boşluk kullan.
    .replace(/ {2,}/g, (spaces) => "\u00A0".repeat(spaces.length));
}

const n = (value) => Math.round(Number(value) * 100) / 100;

/**
 * Tek satır metin. width verilirse sığmayan metin … ile kısaltılır.
 * anchor: start | middle | end
 */
export function text(value, x, y, { size = 20, weight = 400, color = THEME.text, anchor = "start", width = 0, opacity = 1, letterSpacing = 0, family = "Inter" } = {}) {
  const content = width > 0 ? fitText(value, width, size, weight) : String(value ?? "");
  const spacing = letterSpacing ? ` letter-spacing="${letterSpacing}"` : "";
  const alpha = opacity < 1 ? ` opacity="${opacity}"` : "";
  return `<text x="${n(x)}" y="${n(y)}" font-family="${family}" font-size="${size}" font-weight="${weight}" fill="${color}" text-anchor="${anchor}"${spacing}${alpha}>${escapeXml(content)}</text>`;
}

/** Çok satırlı paragraf; satır sayısını döndürür. */
export function paragraph(value, x, y, { size = 18, weight = 400, color = THEME.textSoft, width = 600, lineHeight = 1.4, maxLines = 3, anchor = "start" } = {}) {
  const lines = wrapText(value, width, size, weight, maxLines);
  const svg = lines.map((line, index) => text(line, x, y + index * size * lineHeight, { size, weight, color, anchor })).join("");
  return { svg, lines: lines.length, height: lines.length * size * lineHeight };
}

export function rect(x, y, width, height, { fill = THEME.panel, stroke = "", strokeWidth = 1, radius = 0, opacity = 1 } = {}) {
  if (!finite(x, y, width, height) || width <= 0 || height <= 0) return "";
  const strokeAttr = stroke ? ` stroke="${stroke}" stroke-width="${strokeWidth}"` : "";
  const alpha = opacity < 1 ? ` opacity="${opacity}"` : "";
  return `<rect x="${n(x)}" y="${n(y)}" width="${n(Math.max(0, width))}" height="${n(Math.max(0, height))}" rx="${radius}" fill="${fill}"${strokeAttr}${alpha}/>`;
}

export function panel(x, y, width, height, { fill = THEME.panel, border = THEME.border, radius = 16 } = {}) {
  return rect(x, y, width, height, { fill, stroke: border, radius });
}

/** Liang–Barsky: doğru parçasını kutuya kırpar; kutu dışındaysa null döner. */
export function clipSegment(x1, y1, x2, y2, box) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  let t0 = 0;
  let t1 = 1;
  const edges = [[-dx, x1 - box.x], [dx, box.x + box.width - x1], [-dy, y1 - box.y], [dy, box.y + box.height - y1]];
  for (const [p, q] of edges) {
    if (p === 0) { if (q < 0) return null; continue; }
    const r = q / p;
    if (p < 0) { if (r > t1) return null; if (r > t0) t0 = r; } else { if (r < t0) return null; if (r < t1) t1 = r; }
  }
  return [x1 + t0 * dx, y1 + t0 * dy, x1 + t1 * dx, y1 + t1 * dy];
}

export function circle(cx, cy, r, { fill = THEME.accent, stroke = "", strokeWidth = 2, opacity = 1 } = {}) {
  if (!finite(cx, cy, r) || r <= 0) return "";
  const strokeAttr = stroke ? ` stroke="${stroke}" stroke-width="${strokeWidth}"` : "";
  const alpha = opacity < 1 ? ` opacity="${opacity}"` : "";
  return `<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(r)}" fill="${fill}"${strokeAttr}${alpha}/>`;
}

const finite = (...values) => values.every((value) => Number.isFinite(Number(value)));

export function line(x1, y1, x2, y2, { color = THEME.border, width = 1, dash = "", opacity = 1, cap = "round" } = {}) {
  // resvg sıfır uzunluklu/NaN geometride çökebildiği için bu tür çizgiler atlanır.
  if (!finite(x1, y1, x2, y2) || Math.hypot(x2 - x1, y2 - y1) < 0.01) return "";
  const dashAttr = dash ? ` stroke-dasharray="${dash}"` : "";
  const alpha = opacity < 1 ? ` opacity="${opacity}"` : "";
  return `<line x1="${n(x1)}" y1="${n(y1)}" x2="${n(x2)}" y2="${n(y2)}" stroke="${color}" stroke-width="${width}" stroke-linecap="${cap}"${dashAttr}${alpha}/>`;
}

export function polyline(rawPoints, { color = THEME.accent, width = 3, fill = "none", dash = "", opacity = 1 } = {}) {
  const points = rawPoints.filter(([x, y]) => finite(x, y));
  if (points.length < 2 || points.every(([x, y]) => Math.hypot(x - points[0][0], y - points[0][1]) < 0.01)) return "";
  const dashAttr = dash ? ` stroke-dasharray="${dash}"` : "";
  const alpha = opacity < 1 ? ` opacity="${opacity}"` : "";
  return `<polyline points="${points.map(([x, y]) => `${n(x)},${n(y)}`).join(" ")}" fill="${fill}" stroke="${color}" stroke-width="${width}" stroke-linejoin="round" stroke-linecap="round"${dashAttr}${alpha}/>`;
}

export function initials(name) {
  const letters = [...String(name || "?").replace(/[^\p{L}\p{N}]/gu, "")].slice(0, 2).join("");
  return (letters || "?").toLocaleUpperCase("tr-TR");
}

/** Kare veya yuvarlak avatar; görsel yoksa baş harfler. */
export function avatar(x, y, size, { name = "", image = "", highlighted = false, round = true, id = "av" } = {}) {
  const radius = round ? size / 2 : 10;
  const clipId = `clip-${id}`;
  if (image) {
    return `<defs><clipPath id="${clipId}"><rect x="${n(x)}" y="${n(y)}" width="${size}" height="${size}" rx="${radius}"/></clipPath></defs>`
      + `<image href="${image}" x="${n(x)}" y="${n(y)}" width="${size}" height="${size}" clip-path="url(#${clipId})" preserveAspectRatio="xMidYMid slice"/>`
      + rect(x, y, size, size, { fill: "none", stroke: highlighted ? THEME.accent : THEME.borderHi, strokeWidth: highlighted ? 3 : 1.5, radius });
  }
  return rect(x, y, size, size, { fill: highlighted ? THEME.accent : "#26392B", stroke: highlighted ? THEME.accent : THEME.borderHi, radius })
    + text(initials(name), x + size / 2, y + size / 2 + size * 0.15, { size: Math.round(size * 0.4), weight: 800, color: highlighted ? THEME.accentInk : "#C3D7B5", anchor: "middle" });
}

export function pill(label, x, y, { color = THEME.accent, ink = THEME.accentInk, size = 14, padding = 10, weight = 700, outline = false } = {}) {
  const width = textWidth(label, size, weight) + padding * 2;
  const height = size + 12;
  const body = outline
    ? rect(x, y, width, height, { fill: "none", stroke: color, strokeWidth: 1.5, radius: height / 2 })
    : rect(x, y, width, height, { fill: color, radius: height / 2 });
  return { svg: body + text(label, x + width / 2, y + height / 2 + size * 0.36, { size, weight, color: outline ? color : ink, anchor: "middle" }), width, height };
}

export function barTrack(x, y, width, height, ratio, { color = THEME.accent, track = "#253540", radius = 3 } = {}) {
  const safe = Number.isFinite(ratio) ? Math.max(0, Math.min(1, ratio)) : 0;
  return rect(x, y, width, height, { fill: track, radius }) + (safe > 0 ? rect(x, y, Math.max(radius * 2, width * safe), height, { fill: color, radius }) : "");
}

export function linearGradient(id, stops, { x2 = 1, y2 = 0 } = {}) {
  return `<linearGradient id="${id}" x1="0" y1="0" x2="${x2}" y2="${y2}">${stops.map(([offset, color, opacity = 1]) => `<stop offset="${offset}" stop-color="${color}" stop-opacity="${opacity}"/>`).join("")}</linearGradient>`;
}

/** Ortak kart iskeleti: arka plan, ince ızgara deseni ve TRACER başlığı. */
export function frame(width, height, body, { kicker = "", accent = THEME.accent, defs = "" } = {}) {
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`
    + `<defs>${linearGradient("bg-glow", [[0, "#13241A"], [0.55, THEME.bg], [1, THEME.bg]], { x2: 0.6, y2: 1 })}`
    + `<pattern id="grid" width="48" height="48" patternUnits="userSpaceOnUse"><path d="M48 0H0V48" fill="none" stroke="#FFFFFF" stroke-opacity="0.025" stroke-width="1"/></pattern>${defs}</defs>`
    + rect(0, 0, width, height, { fill: "url(#bg-glow)" })
    + rect(0, 0, width, height, { fill: "url(#grid)" })
    + rect(48, 41, 5, 30, { fill: accent })
    + text("TRACER", 68, 66, { size: 28, weight: 800, color: accent, letterSpacing: 1 })
    + (kicker ? text(kicker, width - 48, 63, { size: 17, weight: 600, color: THEME.muted, anchor: "end", letterSpacing: 1.5 }) : "")
    + body
    + "</svg>";
}

export function resultColor(result) {
  if (/galibiyet|^w/i.test(String(result))) return THEME.win;
  if (/mağlubiyet|^l/i.test(String(result))) return THEME.loss;
  return THEME.tie;
}

export function metricColor(value) {
  const measured = Number(value);
  if (value === null || value === undefined || value === "" || !Number.isFinite(measured)) return THEME.muted;
  if (measured >= 80) return "#C8F54D";
  if (measured >= 70) return "#66D98A";
  if (measured >= 60) return "#F4C95D";
  return "#FF6F77";
}

export const fmt = {
  number(value, digits = 1) {
    if (value === null || value === undefined || value === "" || !Number.isFinite(Number(value))) return "—";
    return new Intl.NumberFormat("tr-TR", { maximumFractionDigits: digits }).format(Number(value));
  },
  percent(value, digits = 1) {
    const formatted = fmt.number(value, digits);
    return formatted === "—" ? "—" : `%${formatted}`;
  },
  signed(value, digits = 1, suffix = "") {
    if (value === null || value === undefined || !Number.isFinite(Number(value))) return "—";
    const number = Number(value);
    return `${number > 0 ? "+" : number < 0 ? "−" : "±"}${fmt.number(Math.abs(number), digits)}${suffix}`;
  },
  date(timestamp, style = "medium") {
    const value = Number(timestamp);
    if (!Number.isFinite(value) || value <= 1) return "Tarih bilinmiyor";
    return new Intl.DateTimeFormat("tr-TR", style === "short" ? { day: "2-digit", month: "2-digit", year: "2-digit" } : { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Istanbul" }).format(new Date(value));
  },
};

export function mapLabel(value) {
  const cleaned = String(value || "").replace(/^(de|cs|ar)_/, "").replace(/_/g, " ");
  if (!cleaned || cleaned === "unknown") return "Bilinmeyen harita";
  // Harita adları İngilizcedir: "inferno" → "Inferno" (Türkçe büyük İ değil).
  return cleaned.charAt(0).toLocaleUpperCase("en-US") + cleaned.slice(1);
}
