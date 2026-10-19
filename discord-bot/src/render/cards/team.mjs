// Takım koçu kartları: T taktiği (render_strat.ps1), takım planı radarı
// (render_squad_radar.ps1) ve takım raporu özeti. Modeller motorun
// buildStrategyImageModel / buildPlanImageModel / buildSquadReport çıktılarıdır.
import { radarImage } from "../png.mjs";
import { THEME, circle, frame, panel, paragraph, rect, text } from "../svg.mjs";
import { textWidth } from "../fonts.mjs";

const MAP_SIZE = 1000;
const MAP_X = 50;

function mapLayer(mapName, y) {
  const { href } = radarImage(mapName);
  return rect(MAP_X, y, MAP_SIZE, MAP_SIZE, { fill: THEME.bgDeep })
    + (href ? `<image href="${href}" x="${MAP_X}" y="${y}" width="${MAP_SIZE}" height="${MAP_SIZE}" opacity="0.72"/>` : text("Radar görseli yok · npm run maps", MAP_X + MAP_SIZE / 2, y + MAP_SIZE / 2, { size: 22, color: THEME.muted, anchor: "middle" }));
}

const px = (item, y) => [MAP_X + item.left * MAP_SIZE, y + item.top * MAP_SIZE];

function disc(x, y, r, fill, opacity, stroke, label = "", labelColor = "#0A0D0C", size = 13) {
  return circle(x, y, r, { fill, opacity }) + circle(x, y, r, { fill: "none", stroke, strokeWidth: 2.5 })
    + (label ? text(label, x, y + size * 0.36, { size, weight: 800, color: labelColor, anchor: "middle" }) : "");
}

/** Etiketleri harita içinde ve birbirinin üstüne binmeden yerleştirir. */
function labelPlacer(mapY) {
  const placed = [];
  return (value, x, y, color = THEME.text, iconRadius = 0) => {
    const width = textWidth(value, 14, 700) + 8;
    let left = x;
    if (left + width > MAP_X + MAP_SIZE) left = x - width - 10 - 2 * iconRadius;
    let top = y - 10;
    for (let guard = 0; guard < 8 && placed.some((box) => left < box.x + box.w && left + width > box.x && top < box.y + box.h && top + 20 > box.y); guard++) top += 22;
    top = Math.min(top, mapY + MAP_SIZE - 22);
    placed.push({ x: left, y: top, w: width, h: 20 });
    return rect(left, top, width, 20, { fill: "#070A09", opacity: 0.86, radius: 4 }) + text(value, left + 4, top + 15, { size: 14, weight: 700, color });
  };
}

export function strategyCardSvg(model, mapName) {
  const WIDTH = 1100;
  const players = model.players || [];
  const subtitle = paragraph(model.subtitle || "", 50, 172, { size: 16, color: "#A6B3AD", width: 1000, maxLines: 2 });
  const mapY = 186 + subtitle.height;
  const listY = mapY + MAP_SIZE + 26;
  const height = listY + 40 + players.length * 62 + 70;
  let body = text(model.kicker || "", 50, 112, { size: 17, weight: 800, color: THEME.accent, width: 1000 })
    + text(model.title || "", 50, 146, { size: 30, weight: 800, color: "#F4F5F0", width: 1000 })
    + subtitle.svg;
  body += mapLayer(mapName, mapY);
  for (const angle of model.angles || []) {
    const [x, y] = px(angle, mapY);
    const radius = 18 + Math.min(26, Number(angle.share || 0) * 0.45);
    body += disc(x, y, radius, "#4682FF", 0.3, "#6EAAFF", `CT %${angle.share}`, "#DCE8FF", 12);
  }
  players.forEach((player, index) => {
    const offset = (index - (players.length - 1) / 2) * 5;
    const points = (player.path || []).map((point) => px(point, mapY)).map(([x, y]) => [x + offset, y + offset]);
    if (points.length >= 2) {
      const [ax, ay] = points.at(-2);
      const [bx, by] = points.at(-1);
      const angle = Math.atan2(by - ay, bx - ax);
      body += `<polyline points="${points.map(([x, y]) => `${x},${y}`).join(" ")}" fill="none" stroke="${player.color}" stroke-opacity="0.92" stroke-width="4.5" stroke-linejoin="round" stroke-linecap="round"/>`
        + `<path d="M${bx} ${by} L${bx - 14 * Math.cos(angle - 0.45)} ${by - 14 * Math.sin(angle - 0.45)} L${bx - 14 * Math.cos(angle + 0.45)} ${by - 14 * Math.sin(angle + 0.45)} Z" fill="${player.color}"/>`;
    }
    const last = points.at(-1);
    if (last) body += disc(last[0], last[1], 14, player.color, 1, "#070A09", String(index + 1));
  });
  const label = labelPlacer(mapY);
  for (const item of model.utility || []) {
    const [x, y] = px(item, mapY);
    if (item.kind === "smoke") body += disc(x, y, 26, "#C9D1D3", 0.6, "#F2F5F5", "S", "#1B2224", 15);
    else if (item.kind === "molotov") body += disc(x, y, 20, "#FF6A2A", 0.67, "#FFB36D", "M", "#FFFFFF", 14);
    else if (item.kind === "flash") body += disc(x, y, 16, "#FFE45C", 0.86, "#FFFFFF", "F", "#2A2400");
    else body += disc(x, y, 16, "#9AA6A0", 0.8, "#FFFFFF", "HE", "#0A0D0C", 11);
  }
  for (const item of model.utility || []) {
    const [x, y] = px(item, mapY);
    body += label(`${item.time} sn · ${item.thrower || "—"}`, x + 28, y, item.throwerColor || THEME.text, 28);
  }
  if (model.plant) {
    const [x, y] = px(model.plant, mapY);
    body += disc(x, y, 15, "#FF9C4D", 1, "#070A09", "C4", "#160A02", 12);
  }
  body += text("OYUNCULAR VE GÖREVLER", 50, listY + 14, { size: 15, weight: 800, color: THEME.accent, letterSpacing: 1.2 });
  let y = listY + 34;
  players.forEach((player, index) => {
    body += disc(66, y + 14, 13, player.color, 1, "#070A09", String(index + 1))
      + text(`${player.name} · ${player.role}`, 92, y + 18, { size: 18, weight: 800, color: player.color, width: 960 })
      + text(player.task || "", 92, y + 42, { size: 15, color: "#C4CEC9", width: 960 });
    y += 62;
  });
  body += paragraph(model.footer || "", 50, y + 24, { size: 14, color: "#6F7A74", width: 1000, maxLines: 2 }).svg;
  return frame(WIDTH, height, body, { kicker: "T TAKTİĞİ" });
}

export function planCardSvg(model, mapName) {
  const WIDTH = 1100;
  const mapY = 150;
  const legendY = mapY + MAP_SIZE + 22;
  const height = legendY + 90;
  let body = text(model.kicker || "", 50, 112, { size: 17, weight: 800, color: THEME.accent, width: 1000 })
    + text(model.title || "", 50, 142, { size: 28, weight: 800, color: "#F4F5F0", width: 1000 });
  body += mapLayer(mapName, mapY);
  for (const hold of model.holds || []) {
    const [x, y] = px(hold, mapY);
    const radius = 16 + Math.min(34, Number(hold.share || 0) * 0.5);
    body += disc(x, y, radius, "#4682FF", 0.32, "#6EAAFF", `%${hold.share}`, "#DCE8FF", 15);
  }
  const route = (model.route || []).map((point) => px(point, mapY));
  if (route.length >= 2) body += `<polyline points="${route.map(([x, y]) => `${x},${y}`).join(" ")}" fill="none" stroke="${THEME.accent}" stroke-opacity="0.82" stroke-width="4" stroke-dasharray="14 9" stroke-linejoin="round"/>`;
  const label = labelPlacer(mapY);
  for (const marker of model.markers || []) {
    const [x, y] = px(marker, mapY);
    const fill = marker.kind === "threat" ? "#FF5660" : marker.kind === "plant" ? "#FF9C4D" : marker.kind === "post" ? "#F0D77F" : THEME.accent;
    body += disc(x, y, 15, fill, 1, "#070A09", marker.badge || "", marker.kind === "threat" ? "#FFFFFF" : "#0A0D0C", 14);
  }
  for (const marker of model.markers || []) {
    const [x, y] = px(marker, mapY);
    body += label(marker.label || "", x + 19, y, THEME.text, 15);
  }
  const legend = [["#4682FF", "CT tutuşu (20. sn, round %)"], [THEME.accent, "Plan adımı"], ["#FF5660", "Temizlenecek açı"], ["#FF9C4D", "Kurulum"], ["#F0D77F", "Kurulum sonrası"]];
  let lx = 62;
  for (const [color, labelText] of legend) {
    body += circle(lx, legendY + 10, 10, { fill: color }) + text(labelText, lx + 18, legendY + 16, { size: 16, color: "#A6B3AD" });
    lx += 40 + textWidth(labelText, 16);
  }
  body += text(model.footer || "", 50, legendY + 52, { size: 15, color: "#6F7A74", width: 1000 })
    + text(model.subtitle || "", 50, legendY + 74, { size: 14, color: "#6F7A74", width: 1000 });
  return frame(WIDTH, height, body, { kicker: "TAKIM PLANI" });
}

export function squadReportCardSvg(report, squadName = "Takım") {
  const WIDTH = 1400;
  const assignments = report?.assignments?.t || [];
  const ct = report?.assignments?.ct || [];
  const cards = report?.playerCards || [];
  const height = 330 + Math.max(1, assignments.length) * 92 + 140;
  let body = text("TAKIM KOÇU", 48, 126, { size: 15, weight: 800, color: THEME.accent, letterSpacing: 1.5 })
    + text(`${squadName} · ${report?.mapLabel || report?.map || ""}`, 48, 174, { size: 40, weight: 800, color: THEME.text, width: 1000 })
    + text(`${report?.evidence?.matchIds?.length || 0} ortak maç · ${report?.genericMapPlan ? "genel harita planı" : "haritaya özel plan"} · güven: ${report?.evidence?.evidence?.confidenceLabel || "—"}`, 48, 208, { size: 18, color: THEME.muted, width: 1100 });
  const tWin = report?.tSide?.summary?.tWinRate ?? report?.tSide?.tWinRate;
  if (tWin !== undefined && tWin !== null) body += text(`T kazanma %${tWin}`, WIDTH - 48, 174, { size: 26, weight: 800, color: THEME.t, anchor: "end" });
  body += text("OYUNCU", 72, 262, { size: 13, weight: 800, color: THEME.dim, letterSpacing: 1 })
    + text("T ROLÜ", 420, 262, { size: 13, weight: 800, color: THEME.dim, letterSpacing: 1 })
    + text("CT POZİSYONU", 700, 262, { size: 13, weight: 800, color: THEME.dim, letterSpacing: 1 })
    + text("EN İYİ SİLAH / ROTA", 980, 262, { size: 13, weight: 800, color: THEME.dim, letterSpacing: 1 });
  assignments.forEach((assignment, index) => {
    const y = 280 + index * 92;
    const steamid = assignment.player?.steamid;
    const ctAssignment = ct.find((item) => item.player?.steamid === steamid);
    const card = cards.find((item) => item.player?.steamid === steamid);
    body += panel(48, y, WIDTH - 96, 80, { fill: index % 2 ? THEME.panelAlt : "#141D18", border: THEME.border, radius: 14 })
      + text(assignment.player?.name || "?", 72, y + 34, { size: 22, weight: 800, color: THEME.text, width: 320 })
      + text(card?.overall !== undefined && card?.overall !== null ? `Genel ${Math.round(card.overall)}` : "", 72, y + 60, { size: 14, color: THEME.muted })
      + text(assignment.roleLabel || assignment.role || "—", 420, y + 34, { size: 20, weight: 800, color: THEME.accent, width: 260 })
      + text(assignment.description || "", 420, y + 60, { size: 14, color: THEME.muted, width: 260 })
      + text(ctAssignment?.positionLabel || "—", 700, y + 34, { size: 20, weight: 800, color: THEME.ct, width: 260 })
      + text(card?.bestCTRoute?.zone ? `En iyi CT bölgesi: ${card.bestCTRoute.zone}` : "", 700, y + 60, { size: 14, color: THEME.muted, width: 260 })
      + text(card?.bestWeapon?.label || card?.bestWeapon?.weapon || "—", 980, y + 34, { size: 20, weight: 700, color: THEME.textSoft, width: 360 })
      + text(card?.bestTRoute?.zone ? `T rotası: ${card.bestTRoute.zone}` : "", 980, y + 60, { size: 14, color: THEME.muted, width: 360 });
  });
  const rulesY = 300 + Math.max(1, assignments.length) * 92;
  body += paragraph((report?.playbook?.rules || []).slice(0, 3).join(" · "), 48, rulesY + 20, { size: 15, color: THEME.textSoft, width: WIDTH - 96, maxLines: 3 }).svg
    + text("Plan kanıta dayalı bir başlangıç noktasıdır; canlı maç sonucu önceliklidir.", 48, height - 30, { size: 14, color: THEME.dim });
  return frame(WIDTH, height, body, { kicker: "TAKIM RAPORU" });
}
