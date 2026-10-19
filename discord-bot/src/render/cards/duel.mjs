// Düello Analisti kartları: olay yeri (gerçek radar üzerinde yakın plan), bakış
// şeması (nişangaha göre rakip) ve silah/mesafe tablosu. Masaüstündeki
// DuelSceneView/DuelPovView bileşenlerinin SVG karşılığı.
import { dot3, projectPoint, projectShotDirection } from "../../../engine/shared/duel_view.mjs";
import { worldToRadar } from "../../../engine/shared/radar.mjs";
import { radarImage } from "../png.mjs";
import { THEME, barTrack, circle, clipSegment, frame, line, panel, paragraph, pill, rect, text } from "../svg.mjs";

const SELF = "#B9EE64";
const ENEMY = "#FF8A83";
const SINGLE = "#FFCB7A";
const OUTCOME = { win: "Kazanıldı", loss: "Kaybedildi", unresolved: "Sonuçlanmadı" };
const OUTCOME_COLOR = { win: THEME.win, loss: THEME.loss, unresolved: THEME.tie };
const STATUS = { measured: "Geçerli tepki ölçümü", prefire: "Hazır atış / prefire", censored: "Başlangıç belirsiz", "no-shot": "Atış kaydı yok", late: "1500 ms üzerinde", unavailable: "Yeterli veri yok" };
const REASON = { visible: "Görüş hattı açık", wall: "Arada duvar var", smoke: "Duman görüşü kapatıyor", "outside-fov": "Rakip bakış alanı dışında", unknown: "Görüş doğrulanamadı" };
const GUNS = { ak47: "AK-47", m4a1: "M4A4", m4a1_silencer: "M4A1-S", usp_silencer: "USP-S", glock: "Glock-18", galilar: "Galil AR", deagle: "Desert Eagle", awp: "AWP", famas: "FAMAS", ssg08: "SSG 08", hkp2000: "P2000", p250: "P250", mac10: "MAC-10", mp9: "MP9", tec9: "Tec-9", fiveseven: "Five-SeveN", cz75a: "CZ75-Auto", sg556: "SG 553", aug: "AUG", ump45: "UMP-45", p90: "P90", mp7: "MP7", xm1014: "XM1014", nova: "Nova", mag7: "MAG-7", negev: "Negev", m249: "M249", elite: "Dual Berettas", revolver: "R8", scar20: "SCAR-20", g3sg1: "G3SG1", mp5sd: "MP5-SD", bizon: "PP-Bizon", sawedoff: "Sawed-Off" };

export const gunLabel = (name) => GUNS[String(name || "").toLowerCase()] || String(name || "—").toUpperCase();
const ms = (value) => (value === null || value === undefined ? "—" : `${value} ms`);

export function filterEncounters(analyst, filter = "all") {
  return (analyst?.encounters || []).filter((duel) => filter === "all" || (filter === "unseen" ? duel.unseenDeath : duel.outcome === filter));
}

/** Haritada olay yeri: 700×470 kutuda yakın plan. */
function sceneMap(duel, mapName, { showAllShots, shotIndex, x, y, width, height }) {
  const scene = duel.scene;
  const own = scene?.camera?.origin;
  const enemy = scene?.targetPoints?.[0];
  const ownLower = (calibration) => Boolean(calibration?.lowerMaxZ !== undefined && own && own[2] - 64 < calibration.lowerMaxZ);
  const base = radarImage(mapName);
  const calibration = base.calibration;
  if (!calibration || !own) {
    return panel(x, y, width, height, { fill: THEME.bgDeep, border: THEME.border, radius: 14 })
      + text("Bu temasın harita konumu bulunamadı.", x + width / 2, y + height / 2, { size: 20, color: THEME.muted, anchor: "middle" });
  }
  const lowerManifest = ownLower(calibration);
  const image = lowerManifest ? radarImage(mapName, { lower: true }) : base;
  const map = { posX: calibration.posX, posY: calibration.posY, scale: calibration.scale };
  const project = (point) => { const r = worldToRadar(point[0], point[1], map); return { x: r.left * 10.24, y: r.top * 10.24 }; };
  const a = project(own);
  const b = enemy ? project(enemy) : null;
  const aspect = height / width;
  const span = Math.min(1024, Math.max(300, b ? Math.max(Math.abs(a.x - b.x) * 1.9, (Math.abs(a.y - b.y) * 1.9) / aspect) : 260));
  const cx = (a.x + (b?.x ?? a.x)) / 2;
  const cy = (a.y + (b?.y ?? a.y)) / 2;
  const left = Math.max(0, Math.min(1024 - span, cx - span / 2));
  const top = Math.max(0, Math.min(1024 - span * aspect, cy - (span * aspect) / 2));
  const unit = span / 600;
  const yaw = Math.atan2(-scene.camera.forward[1], scene.camera.forward[0]);
  const half = Math.atan(scene.camera.tanH);
  const reach = span * 0.55;
  const cone = `${a.x},${a.y} ${a.x + Math.cos(yaw - half) * reach},${a.y + Math.sin(yaw - half) * reach} ${a.x + Math.cos(yaw + half) * reach},${a.y + Math.sin(yaw + half) * reach}`;
  const shots = showAllShots ? duel.shots : duel.shots.slice(shotIndex, shotIndex + 1);
  let inner = image.href ? `<image href="${image.href}" x="0" y="0" width="1024" height="1024" opacity="0.72"/>` : rect(0, 0, 1024, 1024, { fill: "#0E1512" });
  inner += `<polygon points="${cone}" fill="#A9DA58" fill-opacity="0.15" stroke="#B9EE64" stroke-opacity="0.35" stroke-width="${unit}"/>`;
  for (const smoke of scene.smokes || []) {
    const p = project(smoke.center);
    inner += circle(p.x, p.y, smoke.radius / map.scale, { fill: "#CCD4D1", opacity: 0.22 })
      + `<circle cx="${p.x}" cy="${p.y}" r="${smoke.radius / map.scale}" fill="none" stroke="#CCD4D1" stroke-width="${unit}" stroke-dasharray="${3 * unit} ${5 * unit}"/>`;
  }
  if (b) inner += line(a.x, a.y, b.x, b.y, { color: scene.visibility?.visible ? "#B9EE64" : "#E2A077", width: unit * 1.5, dash: `${4 * unit} ${6 * unit}`, opacity: 0.7 });
  for (const shot of shots) {
    const color = showAllShots ? (shot.owner === "self" ? SELF : ENEMY) : SINGLE;
    const start = shot.origin ? project(shot.origin) : null;
    if (!start) continue;
    const impacts = (shot.impacts || []).map((impact) => project(impact.point));
    for (const point of impacts) {
      inner += line(start.x, start.y, point.x, point.y, { color, width: unit * 2, opacity: showAllShots ? 0.75 : 1 })
        + `<path d="M${point.x - 4 * unit},${point.y - 4 * unit} l${8 * unit},${8 * unit} m${-8 * unit},0 l${8 * unit},${-8 * unit}" stroke="${color}" stroke-width="${unit * 2}"/>`;
    }
    if (!impacts.length && shot.direction) {
      const distance = shot.target ? Math.hypot(...shot.target.map((value, index) => value - shot.origin[index])) : 700;
      const aim = project(shot.origin.map((value, index) => value + shot.direction[index] * Math.max(128, distance)));
      const segment = clipSegment(start.x, start.y, aim.x, aim.y, { x: 0, y: 0, width: 1024, height: 1024 });
      if (segment) inner += line(...segment, { color, width: unit * 2, dash: `${8 * unit} ${5 * unit}`, opacity: showAllShots ? 0.75 : 1 });
    }
  }
  for (const [point, label, color] of [[a, "S", SELF], ...(b ? [[b, "R", ENEMY]] : [])]) {
    inner += circle(point.x, point.y, 12 * unit, { fill: color, stroke: "#101815", strokeWidth: 3 * unit })
      + `<text x="${point.x}" y="${point.y + 4.5 * unit}" font-family="Inter" font-size="${13 * unit}" font-weight="800" text-anchor="middle" fill="#101815">${label}</text>`;
  }
  return `<defs><clipPath id="scene-clip"><rect x="${x}" y="${y}" width="${width}" height="${height}" rx="14"/></clipPath></defs>`
    + rect(x, y, width, height, { fill: THEME.bgDeep, radius: 14 })
    + `<g clip-path="url(#scene-clip)"><svg x="${x}" y="${y}" width="${width}" height="${height}" viewBox="${left} ${top} ${span} ${span * aspect}" preserveAspectRatio="xMidYMid slice">${inner}</svg></g>`
    + rect(x, y, width, height, { fill: "none", stroke: THEME.border, radius: 14 })
    + text(`${calibration.label || mapName} · ${duel.zone || "—"}${lowerManifest ? " · Alt kat" : ""}`, x + 16, y + height - 16, { size: 16, weight: 700, color: THEME.textSoft, width: width - 32 });
}

/** Nişangaha göre rakip şeması: 640×360 kutu. */
function scenePov(duel, { showAllShots, shotIndex, x, y, width, height }) {
  const scene = duel.scene;
  if (!scene) return panel(x, y, width, height, { fill: THEME.bgDeep, radius: 14 }) + text("Bakış verisi yok", x + width / 2, y + height / 2, { size: 20, color: THEME.muted, anchor: "middle" });
  const sx = width / 960;
  const sy = height / 540;
  const toSvg = (point) => ({ x: x + (480 + (point.x - 0.5) * 960) * sx, y: y + (270 + (point.y - 0.5) * 540) * sy });
  const box = { x, y, width, height };
  const insideBox = (point) => point.x >= x && point.x <= x + width && point.y >= y && point.y <= y + height;
  const projected = (scene.targetPoints || []).map((point) => projectPoint(scene.camera, point));
  const head = projected[0];
  const position = head ? toSvg(head) : null;
  const inView = Boolean(position && position.x >= x && position.x <= x + width && position.y >= y && position.y <= y + height);
  const hidden = scene.visibility?.visible !== true;
  const color = hidden ? "#A7B5B2" : "#FF9589";
  let svg = rect(x, y, width, height, { fill: "#0C1410", radius: 14 })
    + line(x, y + height / 2, x + width, y + height / 2, { color: "#FFFFFF", width: 1, dash: "4 8", opacity: 0.08 })
    + line(x + width / 2, y, x + width / 2, y + height, { color: "#FFFFFF", width: 1, dash: "4 8", opacity: 0.08 })
    + rect(x + 18, y + 18, width - 36, height - 36, { fill: "none", stroke: "#354D3C", radius: 10 });
  if (inView && head) {
    const radius = Math.max(3, Math.min(30, (5 / (head.depth * scene.camera.tanH * 2)) * 960 * sx));
    const bones = [[0, 1], [1, 2], [3, 4], [1, 3], [1, 4], [2, 5], [2, 6]];
    svg += `<g opacity="${hidden ? 0.55 : 0.95}">` + circle(position.x, position.y, radius, { fill: color });
    for (const [from, to] of bones) {
      if (!projected[from] || !projected[to]) continue;
      const p1 = toSvg(projected[from]);
      const p2 = toSvg(projected[to]);
      const solid = scene.pointVisibility?.[from] && scene.pointVisibility?.[to];
      svg += line(p1.x, p1.y, p2.x, p2.y, { color, width: Math.max(3, radius * 0.75), dash: solid ? "" : "5 5" });
    }
    svg += "</g>";
  }
  const shots = showAllShots ? duel.shots : duel.shots.slice(shotIndex, shotIndex + 1);
  for (const shot of shots) {
    const traceColor = showAllShots ? (shot.owner === "self" ? SELF : ENEMY) : "#FFCE84";
    if (!shot.impacts?.length) {
      const guide = projectShotDirection(scene.camera, shot);
      if (guide) {
        const start = toSvg(guide.start);
        const end = toSvg(guide.end);
        // Uzak uçlar resvg'yi zorlar; çizgi görünür kutuya kırpılarak çizilir.
        const segment = clipSegment(start.x, start.y, end.x, end.y, box);
        if (segment) svg += line(...segment, { color: traceColor, width: 2, dash: "8 8" });
        if (!guide.clipped && insideBox(end)) svg += `<circle cx="${end.x}" cy="${end.y}" r="7" fill="none" stroke="${traceColor}" stroke-width="2"/>`;
      }
    }
    for (const impact of shot.impacts || []) {
      const point = projectPoint(scene.camera, impact.point);
      if (!point) continue;
      const p = toSvg(point);
      if (insideBox(p)) svg += `<path d="M${p.x - 6} ${p.y - 6} l12 12 m-12 0 l12 -12" stroke="${traceColor}" stroke-width="3"/>`;
    }
  }
  const cx = x + width / 2;
  const cy = y + height / 2;
  svg += circle(cx, cy, 14, { fill: "#0C1410", stroke: "#DAEED0", strokeWidth: 1.5, opacity: 0.9 })
    + `<path d="M${cx - 26} ${cy}H${cx - 7} M${cx + 7} ${cy}H${cx + 26} M${cx} ${cy - 26}V${cy - 7} M${cx} ${cy + 7}V${cy + 26}" stroke="#DAEED0" stroke-width="2"/>`
    + text("Nişangahın", cx, cy + 50, { size: 13, color: "#ACC4B1", anchor: "middle" });
  const target = scene.targetPoints?.[0];
  const relative = target ? target.map((value, index) => value - scene.camera.origin[index]) : null;
  const bearing = relative ? Math.round((Math.atan2(dot3(relative, scene.camera.right), dot3(relative, scene.camera.forward)) * 180) / Math.PI) : null;
  const behind = relative ? dot3(relative, scene.camera.forward) <= 0 : false;
  if (!inView) {
    svg += `<path d="${bearing !== null && bearing < 0 ? `M${x + 50} ${cy - 12}l-16 12 16 12` : `M${x + width - 50} ${cy - 12}l16 12-16 12`}" fill="none" stroke="#FF9589" stroke-width="4"/>`
      + text(!target ? "Rakip konumu yok" : behind ? "Rakip arkanda" : "Rakip ekranın dışında", cx, y + height - 40, { size: 18, color: "#D6B7AE", anchor: "middle" });
  }
  const clipped = `<defs><clipPath id="pov-clip"><rect x="${x}" y="${y}" width="${width}" height="${height}" rx="14"/></clipPath></defs><g clip-path="url(#pov-clip)">${svg}</g>`;
  return { svg: clipped + rect(x, y, width, height, { fill: "none", stroke: THEME.border, radius: 14 }), bearing, behind };
}

function comparison(x, y, width, { name, reaction, visibility, ping, damage, enemy }) {
  const color = enemy ? ENEMY : SELF;
  const seen = visibility?.status === "spotted" ? "Görüş açıldı" : visibility?.status === "not-spotted" ? "Görüş açılmadı" : "Görüş belirsiz";
  return panel(x, y, width, 196, { fill: enemy ? "#1D1514" : "#141F17", border: enemy ? "#4A302C" : "#33452F", radius: 14 })
    + circle(x + 22, y + 28, 7, { fill: color })
    + text(name, x + 38, y + 35, { size: 20, weight: 800, color: THEME.text, width: width - 170 })
    + text(seen, x + width - 18, y + 34, { size: 14, color: THEME.muted, anchor: "end" })
    + text(reaction?.status === "measured" ? ms(reaction.fireMs) : "—", x + 22, y + 92, { size: 44, weight: 800, color })
    + text(STATUS[reaction?.status] || "Ölçülemedi", x + 22, y + 120, { size: 15, color: THEME.textSoft })
    + text("İLK HASAR", x + 22, y + 152, { size: 12, weight: 700, color: THEME.dim })
    + text(ms(reaction?.damageMs), x + 22, y + 176, { size: 18, weight: 700, color: THEME.textSoft })
    + text("PING", x + width * 0.4, y + 152, { size: 12, weight: 700, color: THEME.dim })
    + text(ms(ping), x + width * 0.4, y + 176, { size: 18, weight: 700, color: THEME.textSoft })
    + text("HASAR", x + width * 0.7, y + 152, { size: 12, weight: 700, color: THEME.dim })
    + text(String(damage ?? 0), x + width * 0.7, y + 176, { size: 18, weight: 700, color: THEME.textSoft });
}

export function duelCardSvg({ duel, mapName, playerName = "Sen", index = 0, total = 1, showAllShots = false, shotIndex = -1 }) {
  const WIDTH = 1500;
  const shots = duel.shots || [];
  const selectedShot = Math.max(0, shotIndex < 0 ? shots.length - 1 : Math.min(shotIndex, shots.length - 1));
  const outcome = OUTCOME[duel.outcome] || "—";
  let body = text(`DÜELLO ${index + 1} / ${total} · ROUND ${duel.round} · ${duel.side || ""}`, 48, 128, { size: 16, weight: 700, color: THEME.cyan, letterSpacing: 1.2 })
    + text(`${playerName} vs ${duel.opponent?.name || "?"}`, 48, 176, { size: 40, weight: 800, color: THEME.text, width: 1040 })
    + text(`${duel.zone || "—"} · ${duel.distanceM === null || duel.distanceM === undefined ? "Mesafe bilinmiyor" : `${duel.distanceM} m`} · ${duel.weapon === "Bilinmiyor" ? "Silah kaydı yok" : gunLabel(duel.weapon)}`, 48, 212, { size: 20, color: THEME.muted, width: 1040 });
  const badge = pill(outcome.toLocaleUpperCase("tr-TR"), 0, 0, { color: OUTCOME_COLOR[duel.outcome] || THEME.tie, size: 18 });
  body += `<g transform="translate(${WIDTH - 48 - badge.width} 140)">${badge.svg}</g>`;
  let noticeY = 236;
  const notices = [];
  if (duel.targetEvidence !== "damage") notices.push(duel.targetEvidence === "estimated" ? "Rakip tahmini; bu temas tepki ortalamasına katılmaz." : "Atışın hedefi doğrulanamadı; kayıt inceleme için saklandı.");
  if (duel.unseenDeath) notices.push("İncelenen pencerede rakibe açık görüş hattı bulunmadı. Tek başına hile göstergesi değildir.");
  for (const notice of notices) {
    body += panel(48, noticeY, WIDTH - 96, 40, { fill: "#2A2414", border: "#5A4A22", radius: 10 }) + text(notice, 66, noticeY + 26, { size: 16, color: "#F2DFA6", width: WIDTH - 130 });
    noticeY += 48;
  }
  const top = noticeY + 12;
  body += text("OLAY YERİ · HARİTADA", 48, top + 18, { size: 14, weight: 800, color: THEME.dim, letterSpacing: 1.2 })
    + sceneMap(duel, mapName, { showAllShots, shotIndex: selectedShot, x: 48, y: top + 30, width: 760, height: 500 });
  const pov = scenePov(duel, { showAllShots, shotIndex: selectedShot, x: 840, y: top + 30, width: 612, height: 344 });
  body += text("BAKIŞ ŞEMASI · NİŞANGAHA GÖRE RAKİP", 840, top + 18, { size: 14, weight: 800, color: THEME.dim, letterSpacing: 1.2 }) + (pov.svg || pov);
  const facts = [
    ["Rakibin yönü", pov.bearing === null || pov.bearing === undefined ? "—" : `${Math.abs(pov.bearing)}° ${pov.bearing < 0 ? "solunda" : "sağında"}`],
    ["Görüş hattı", duel.scene?.visibility?.visible ? "Açık" : duel.scene?.visibility?.reason === "wall" ? "Duvarla kapalı" : duel.scene?.visibility?.reason === "smoke" ? "Dumanla kapalı" : "Kapalı / belirsiz"],
    [showAllShots ? "Atışlar" : "Bakış farkı", showAllShots ? `${shots.length} atış · ${shots.reduce((sum, shot) => sum + (shot.impacts?.length || 0), 0)} çarpma` : shots[selectedShot]?.aimErrorDeg === null || shots[selectedShot]?.aimErrorDeg === undefined ? "—" : `${shots[selectedShot].aimErrorDeg}°`],
  ];
  facts.forEach(([label, value], i) => {
    const x = 840 + i * 206;
    body += panel(x, top + 390, 196, 140, { fill: THEME.panelAlt, border: THEME.border, radius: 12 })
      + text(label.toLocaleUpperCase("tr-TR"), x + 16, top + 420, { size: 12, weight: 800, color: THEME.dim, letterSpacing: 1 })
      + paragraph(value, x + 16, top + 452, { size: 19, weight: 700, color: THEME.text, width: 166, maxLines: 3 }).svg;
  });
  const compareY = top + 552;
  body += comparison(48, compareY, 694, { name: playerName, reaction: duel.reaction, visibility: duel.ownVisibility, ping: duel.ownPingMs, damage: duel.damageDealt, enemy: false })
    + comparison(758, compareY, 694, { name: duel.opponent?.name || "Rakip", reaction: duel.opponentReaction, visibility: duel.opponentVisibility, ping: duel.opponentPingMs, damage: duel.damageTaken, enemy: true });
  const legendY = compareY + 230;
  const reason = REASON[duel.scene?.visibility?.reason] ? `${REASON[duel.scene.visibility.reason]} · ` : "";
  const legend = reason + (showAllShots
    ? "Yeşil: senin atışların · Kırmızı: rakibin atışları · Kesik çizgi: yaklaşık atış yönü · ×: demodaki gerçek çarpma kaydı"
    : `Seçili atış: ${selectedShot + 1}/${shots.length || 1} · Kesik çizgi: yaklaşık atış yönü · ×: demodaki gerçek çarpma kaydı · S: sen · R: rakip`);
  body += text(legend, 48, legendY, { size: 16, color: THEME.muted, width: WIDTH - 96 })
    + text("Konumlar temasın son anına aittir. Gizli oyuncu konumu yalnız analiz için gösterilir.", 48, legendY + 26, { size: 15, color: THEME.dim, width: WIDTH - 96 });
  return frame(WIDTH, legendY + 60, body, { kicker: "DÜELLO ANALİSTİ" });
}

export function distanceCardSvg({ analyst, playerName = "", mapName = "" }) {
  const WIDTH = 1400;
  const rows = (analyst?.distanceProfile || []).filter((bucket) => !/knife|grenade|molotov|c4|taser/i.test(bucket.weapon)).slice(0, 14);
  const height = 260 + Math.max(1, rows.length) * 62 + 70;
  let body = text("SİLAH × MESAFE × TARAF", 48, 128, { size: 16, weight: 800, color: THEME.cyan, letterSpacing: 1.2 })
    + text("Hangi mesafede daha etkilisin?", 48, 174, { size: 38, weight: 800, color: THEME.text })
    + text(`${playerName}${mapName ? ` · ${mapName}` : ""} · oran yalnız sonuçlanan düelloları kapsar; az örnekli sonuçları temkinli yorumla.`, 48, 208, { size: 18, color: THEME.muted, width: WIDTH - 96 });
  const columns = [["SİLAH / TARAF", 48], ["MESAFE", 360], ["KAZANILAN / KAYIP", 520], ["KAZANMA ORANI", 740], ["SONRAKİ ROUND İÇİN", 1000]];
  for (const [label, x] of columns) body += text(label, x, 248, { size: 13, weight: 800, color: THEME.dim, letterSpacing: 1 });
  rows.forEach((bucket, index) => {
    const y = 262 + index * 62;
    if (index % 2 === 0) body += rect(36, y, WIDTH - 72, 56, { fill: "#141D18", radius: 10 });
    // Sonuçlanan düello yoksa oran ölçülemez; %0 diye gösterilmez.
    const resolved = Number(bucket.wins || 0) + Number(bucket.losses || 0);
    const rate = resolved > 0 && bucket.winrate !== null && Number.isFinite(Number(bucket.winrate)) ? Number(bucket.winrate) : null;
    const rateColor = rate === null ? THEME.muted : rate >= 60 ? THEME.win : rate >= 45 ? THEME.gold : THEME.loss;
    body += text(gunLabel(bucket.weapon), 48, y + 26, { size: 20, weight: 800, color: THEME.text, width: 290 })
      + text(`${bucket.side} · ${bucket.contacts} temas`, 48, y + 47, { size: 14, color: THEME.muted })
      + text(bucket.range || "—", 360, y + 35, { size: 19, weight: 600, color: THEME.textSoft, width: 150 })
      + text(`${bucket.wins} / ${bucket.losses}`, 520, y + 35, { size: 19, weight: 700, color: THEME.textSoft })
      + text(rate === null ? "—" : `%${rate}`, 740, y + 35, { size: 22, weight: 800, color: rateColor })
      + barTrack(820, y + 24, 150, 10, rate === null ? 0 : rate / 100, { color: rateColor })
      + text(bucket.recommendation || "—", 1000, y + 35, { size: 16, color: THEME.textSoft, width: WIDTH - 1048 });
  });
  if (!rows.length) body += text("Bu maçta sonuçlanan silah/mesafe düellosu bulunamadı.", 48, 300, { size: 22, color: THEME.muted });
  body += text("TRACER Düello Analisti · mesafe kovaları sonuçlanan temaslardan hesaplanır", 48, height - 30, { size: 15, color: THEME.dim });
  return frame(WIDTH, height, body, { kicker: "SİLAH VE MESAFE" });
}

export function encounterLabel(duel, index) {
  return `${index + 1}. R${duel.round} · ${duel.opponent?.name || "?"} · ${OUTCOME[duel.outcome] || "—"}`.slice(0, 100);
}
export { OUTCOME };
