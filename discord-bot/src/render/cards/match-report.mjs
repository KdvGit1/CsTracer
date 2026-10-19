// Maç sonu takım tablosu: masaüstü TRACER v0.53.0'daki render_discord_report.ps1
// tasarımının SVG karşılığı. Model, motorun buildDiscordReportImageModel çıktısıdır.
import { PLAYER_COLORS, THEME, avatar, barTrack, circle, frame, line, panel, polyline, rect, resultColor, text } from "../svg.mjs";

const WIDTH = 1600;
const BIN_LABELS = ["50–150 ms", "150–250 ms", "250–400 ms", "400–700 ms", "700–1500 ms"];
const BIN_LIMITS = [50, 150, 250, 400, 700, 1500];

const COLUMNS = [
  { label: "OYUNCU", x: 132, w: 280, field: "name", anchor: "start" },
  { label: "K / D / A", x: 444, w: 164, field: "kda", anchor: "middle" },
  { label: "ADR", x: 646, w: 118, field: "adr", anchor: "middle" },
  { label: "HS", x: 808, w: 108, field: "hs", anchor: "middle" },
  { label: "KAST", x: 968, w: 142, field: "kast", anchor: "middle" },
  { label: "DÜELLO", x: 1150, w: 360, field: "duel", anchor: "middle" },
];

const ENEMY_COLUMNS = [
  { label: "OYUNCU", x: 72, w: 460, field: "name", anchor: "start" },
  { label: "K / D / A", x: 550, w: 180, field: "kda", anchor: "middle" },
  { label: "ADR", x: 770, w: 120, field: "adr", anchor: "middle" },
  { label: "KAST", x: 950, w: 130, field: "kast", anchor: "middle" },
  { label: "ROUND KATKISI", x: 1140, w: 382, field: "grade", anchor: "start" },
];

const anchorX = (column) => (column.anchor === "middle" ? column.x + column.w / 2 : column.anchor === "end" ? column.x + column.w : column.x);
const validSamples = (row) => (row?.reaction?.samples || []).filter((sample) => Number.isFinite(Number(sample?.ms)) && sample.ms >= 50 && sample.ms <= 1500);

export function reactionSection(rows, top, { width = WIDTH, title = "TEPKİ SÜRESİ / GÖRÜNÜRLÜKTEN İLK ATEŞE" } = {}) {
  const height = 450;
  const series = rows.slice(0, 5).map((row, index) => ({ row, samples: validSamples(row), color: PLAYER_COLORS[index] }));
  const maxSamples = Math.max(0, ...series.map((item) => item.samples.length));
  const maxMs = Math.max(0, ...series.flatMap((item) => item.samples.map((sample) => sample.ms)));
  const chartMax = Math.max(500, Math.ceil(maxMs / 100) * 100);
  const plotLeft = 155;
  const plotWidth = 760;
  const yFor = (ms) => top + 295 - (ms / chartMax) * 170;
  const xFor = (index) => plotLeft + (index * plotWidth) / Math.max(1, maxSamples - 1);
  let svg = panel(48, top, width - 96, height, { fill: "#101C23", border: "#334958", radius: 14 })
    + text(title, 70, top + 40, { size: 23, weight: 800, color: THEME.cyan })
    + text("Yaklaşık demo ölçümü · prefire ve belirsiz başlangıçlar hariç · eksik ölçüm sıfır değildir", 70, top + 70, { size: 17, color: "#A6BCCB" })
    + text("Tüm takım · her oyuncunun kendi temas sırası", 100, top + 104, { size: 18, weight: 700, color: "#D9E6EE" })
    + text("ms", 128, top + 110, { size: 14, color: "#8BA6B6", anchor: "end" });
  for (const ratio of [0, 0.25, 0.5, 0.75, 1]) {
    const y = top + 295 - ratio * 170;
    svg += rect(144, y, 785, 1, { fill: "#2B414E" }) + text(String(Math.round(chartMax * ratio)), 128, y + 5, { size: 15, color: "#8BA6B6", anchor: "end" });
  }
  for (const item of series) {
    const points = item.samples.map((sample, index) => [xFor(index), yFor(sample.ms)]);
    svg += polyline(points, { color: item.color, width: 2.5, opacity: 0.95 });
    for (const [x, y] of points) svg += circle(x, y, 4.5, { fill: item.color });
  }
  const tickCount = Math.min(9, maxSamples);
  for (let tick = 0; tick < tickCount; tick++) {
    const index = Math.round((tick * (maxSamples - 1)) / Math.max(1, tickCount - 1));
    svg += text(String(index + 1), xFor(index), top + 320, { size: 15, color: "#8BA6B6", anchor: "middle" });
  }
  if (maxSamples === 0) svg += text("Geçerli tepki örneği bulunamadı.", 520, top + 215, { size: 24, color: "#8BA6B6", anchor: "middle" });
  svg += text("OYUNCU RENGİ / MEDYAN", 984, top + 104, { size: 18, weight: 700, color: "#D9E6EE" });
  series.forEach((item, index) => {
    const y = top + 120 + index * 39;
    const median = Number.isFinite(Number(item.row.reaction?.medianMs)) ? `${Math.round(item.row.reaction.medianMs)} ms` : "—";
    const label = item.samples.length ? `${median} / ${item.samples.length} temas` : "Ölçülemedi / 0 temas";
    svg += circle(988, y + 12, 6, { fill: item.color })
      + text(item.row.name, 1008, y + 19, { size: 18, weight: 700, color: item.color, width: 225 })
      + text(label, 1240, y + 19, { size: 17, color: "#B9CEDC", width: 280 });
  });
  svg += text("TEPKİ DAĞILIMI · çubuklar oyuncunun kendi temasları içindeki payı gösterir", 95, top + 350, { size: 15, color: "#A6BCCB" });
  for (let bin = 0; bin < 5; bin++) {
    const x = 95 + bin * 285;
    svg += text(BIN_LABELS[bin], x, top + 376, { size: 16, color: "#8BA6B6" });
    series.forEach((item, index) => {
      const count = item.samples.filter((sample) => sample.ms >= BIN_LIMITS[bin] && (sample.ms < BIN_LIMITS[bin + 1] || (bin === 4 && sample.ms === 1500))).length;
      svg += barTrack(x, top + 386 + index * 10, 200, 6, item.samples.length ? count / item.samples.length : 0, { color: item.color, radius: 2 });
    });
  }
  return { svg, height };
}

export function matchReportSvg(model) {
  const ownRows = (model.ownRows || []).slice(0, 5);
  const opponentRows = (model.opponentRows || []).slice(0, 5);
  const reactionY = 384 + Math.max(1, ownRows.length) * 136;
  const reaction = reactionSection(ownRows, reactionY);
  const opponentY = reactionY + reaction.height + 24;
  const opponentHeight = 90 + Math.max(1, opponentRows.length) * 40;
  const height = opponentY + opponentHeight + 166;
  const result = String(model.result || "");
  const color = resultColor(result);

  let body = panel(48, 96, 1504, 146, { fill: "#14201A", border: "#3C5037", radius: 18 })
    + text("HARİTA", 74, 130, { size: 16, weight: 700, color: "#A8BE9C", letterSpacing: 1.5 })
    + text(model.mapName || String(model.title || "").split(" · ")[0], 70, 182, { size: 48, weight: 800, color: "#F0F6EB", width: 900 })
    + text(model.subtitle || "", 74, 222, { size: 19, color: "#A2B2A8", width: 925 })
    + panel(1090, 112, 444, 114, { fill: "#0B1410", border: "#334631", radius: 12 })
    + text(model.scoreText || "—", 1312, 172, { size: 56, weight: 800, color: "#F3F7EE", anchor: "middle" })
    + text(result, 1312, 208, { size: 22, weight: 800, color: result.match(/Mağlubiyet/) ? "#FF9093" : color, anchor: "middle" })
    + text("SENİN TAKIMIN", 48, 300, { size: 26, weight: 800, color: THEME.accent })
    + text(model.ownSummary || "", 1552, 302, { size: 20, color: "#AAB9AF", anchor: "end", width: 1100 });
  for (const column of COLUMNS) body += text(column.label, anchorX(column), 346, { size: 17, weight: 700, color: "#90A298", anchor: column.anchor, letterSpacing: 0.5 });

  ownRows.forEach((row, index) => {
    const y = 360 + index * 136;
    const fill = row.highlighted ? THEME.panelHi : index % 2 === 0 ? "#141D18" : "#111A16";
    const border = row.highlighted ? "#6B8740" : "#2A3830";
    body += panel(48, y, 1504, 128, { fill, border, radius: 12 });
    if (row.highlighted) body += rect(48, y + 16, 4, 36, { fill: THEME.accent });
    body += avatar(68, y + 14, 44, { name: row.name, highlighted: row.highlighted, round: false, id: `own-${index}` })
      + text(row.name, 132, y + 44, { size: 27, weight: 800, color: "#F0F5EE", width: row.highlighted ? 225 : 280 });
    if (row.highlighted) body += text("SEN", 366, y + 42, { size: 14, weight: 800, color: THEME.accent });
    for (const column of COLUMNS.slice(1)) {
      const value = column.field === "duel" ? String(row.duel || "—").replace(/\(n(\d+)\)/, "($1 örnek)") : String(row[column.field] ?? "—");
      const colorValue = column.field === "kast" && /^#[0-9A-Fa-f]{6}$/.test(String(row.kastColor)) ? row.kastColor : "#EEF3F0";
      body += text(value, anchorX(column), y + 46, { size: column.field === "duel" ? 26 : 30, weight: 800, color: colorValue, anchor: column.anchor, width: column.w });
    }
    const details = [
      ["HAYATTA", row.survival], ["İLK DÜELLO K / D", row.opening], ["TAKAS", row.trade], ["BOMBA HASARI", row.utility],
      ["FLAŞ SÜRESİ", row.flash], ["HAREKET KONTROLÜ", row.movement], ["BURST / SPREY", row.spray],
    ];
    details.forEach(([label, value], detail) => {
      const x = 70 + detail * 211;
      body += text(label, x, y + 75, { size: 14, weight: 700, color: "#92A79A", width: 201 })
        + text(value ?? "—", x, y + 98, { size: 20, color: "#C9D6CC", width: 201 });
    });
    body += text(`NOT  /  ${row.note || "—"}`, 70, y + 118, { size: 16, color: "#B0C79D", width: 1458 });
  });
  if (!ownRows.length) body += text("Bu analizde takım oyuncuları doğrulanamadı.", 70, 426, { size: 25, color: "#AAB9AF" });

  body += reaction.svg;

  body += panel(48, opponentY, 1504, opponentHeight, { fill: "#101916", border: "#38433A", radius: 14 })
    + text("RAKİP TAKIM", 70, opponentY + 44, { size: 23, weight: 800, color: "#CFBE90" })
    + text(model.opponentSummary || "", 1530, opponentY + 46, { size: 19, color: "#97A89D", anchor: "end", width: 1040 });
  for (const column of ENEMY_COLUMNS) body += text(column.label, anchorX(column), opponentY + 74, { size: 14, weight: 700, color: "#81978B", anchor: column.anchor });
  opponentRows.forEach((row, index) => {
    const y = opponentY + 84 + index * 40;
    if (index % 2 === 0) body += rect(64, y, 1472, 38, { fill: "#18231D", radius: 6 });
    for (const column of ENEMY_COLUMNS) {
      const colorValue = column.field === "kast" && /^#[0-9A-Fa-f]{6}$/.test(String(row.kastColor)) ? row.kastColor : "#CCD6CE";
      body += text(row[column.field] ?? "—", anchorX(column), y + 27, { size: 22, weight: column.field === "name" ? 700 : 500, color: colorValue, anchor: column.anchor, width: column.w });
    }
  });
  if (!opponentRows.length) body += text("Rakip oyuncular bu analizde doğrulanamadı.", 72, opponentY + 110, { size: 22, color: "#97A89D" });

  const footerY = opponentY + opponentHeight + 22;
  body += text("İSTATİSTİKLERİ OKUMA REHBERİ", 48, footerY + 14, { size: 15, weight: 700, color: "#91A784", letterSpacing: 1 })
    + text("K / D / A: öldürme / ölüm / asist   ·   ADR: round başına hasar   ·   HS: kafadan öldürme oranı", 48, footerY + 42, { size: 18, color: "#9DAEA2" })
    + text("KAST: öldürme, asist, hayatta kalma veya takas katkısı olan roundların yüzdesi. Resmî bir seviye puanı değildir.", 48, footerY + 67, { size: 18, color: "#9DAEA2" })
    + text("Hareket: hız sınırına uygun atış oranı   ·   Burst / sprey: ilk 3 / sonraki mermiler   ·   Düello: kazanma oranı (örnek sayısı)", 48, footerY + 92, { size: 17, color: "#8B9E90", width: 1504 })
    + text("— Ölçülemedi     SEN Seçili oyuncu", 48, footerY + 118, { size: 16, color: "#C0CEB8" })
    + text("TRACER / MAÇ ANALİZİ", 1552, footerY + 118, { size: 16, weight: 700, color: "#819574", anchor: "end" })
    + line(48, footerY - 6, 1552, footerY - 6, { color: "#1E2B24" });

  return frame(WIDTH, height, body, { kicker: "CS2 / MAÇ SONU RAPORU" });
}

/** Yalnız tepki grafiği (tek oyuncu veya takım) — /mac Tepki sekmesi. */
export function reactionCardSvg(model) {
  const rows = (model.ownRows || []).slice(0, 5);
  const section = reactionSection(rows, 110, { title: `TEPKİ SÜRESİ · ${model.mapName || ""} · ${model.scoreText || ""}` });
  return frame(WIDTH, 110 + section.height + 40, section.svg, { kicker: "TEPKİ ANALİZİ" });
}
