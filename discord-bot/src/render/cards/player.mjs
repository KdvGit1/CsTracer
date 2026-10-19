// Kişisel kartlar: profil (kişiyi hatırlayan özet), gelişim grafiği, karşılaştırma,
// sunucu liderlik tablosu, FACEIT kartı ve T tarafı disiplin kartı.
import { PLAYER_COLORS, THEME, avatar, barTrack, circle, fmt, frame, line, linearGradient, mapLabel, metricColor, panel, paragraph, pill, polyline, rect, resultColor, text } from "../svg.mjs";

const FACEIT_LEVEL_COLORS = ["#EEEEEE", "#1CE400", "#1CE400", "#FFC800", "#FFC800", "#FFC800", "#FFC800", "#FF6309", "#FF6309", "#FE1F00"];

function faceitBadge(x, y, level, size = 44) {
  const safe = Math.max(1, Math.min(10, Number(level) || 1));
  const color = FACEIT_LEVEL_COLORS[safe - 1];
  const r = size / 2;
  const arc = (Math.PI * 2 * safe) / 10;
  const startX = x + r;
  const startY = y;
  const endX = x + r + Math.sin(arc) * (r - 3);
  const endY = y + r - Math.cos(arc) * (r - 3);
  return circle(x + r, y + r, r, { fill: "#1C1F22", stroke: "#2C3035", strokeWidth: 2 })
    + (safe === 10
      ? circle(x + r, y + r, r - 3, { fill: "none", stroke: color, strokeWidth: 4 })
      : `<path d="M${startX} ${startY + 3} A ${r - 3} ${r - 3} 0 ${arc > Math.PI ? 1 : 0} 1 ${endX} ${endY}" fill="none" stroke="${color}" stroke-width="4" stroke-linecap="round"/>`)
    + text(String(safe), x + r, y + r + size * 0.17, { size: Math.round(size * 0.42), weight: 800, color, anchor: "middle" });
}

function metricTile(x, y, width, label, metric, { suffix = "", digits = 1, percent = false, color = THEME.text } = {}) {
  const value = metric?.value;
  const formatted = value === null || value === undefined ? "—" : percent ? fmt.percent(value, digits) : `${fmt.number(value, digits)}${suffix}`;
  const delta = metric?.delta;
  const deltaColor = delta === null || delta === undefined ? THEME.muted : delta > 0 ? THEME.win : delta < 0 ? THEME.loss : THEME.muted;
  return panel(x, y, width, 150, { fill: THEME.panelAlt, border: THEME.border, radius: 14 })
    + text(label, x + 22, y + 34, { size: 14, weight: 800, color: THEME.dim, letterSpacing: 1.2 })
    + text(formatted, x + 22, y + 90, { size: 46, weight: 800, color })
    + text(delta === null || delta === undefined ? `${metric?.count || 0} maç · kıyas için ≥3+3 maç` : `${fmt.signed(delta, 1, percent ? " puan" : "")} önceki 5 maça göre`, x + 22, y + 126, { size: 15, weight: 600, color: deltaColor, width: width - 44 });
}

function sparkline(values, x, y, width, height, { color = THEME.accent, min = null, max = null, results = [] } = {}) {
  const points = values.map((value, index) => ({ value, index })).filter((point) => Number.isFinite(point.value));
  if (points.length < 2) return text("Grafik için en az 2 ölçüm gerekli", x + width / 2, y + height / 2, { size: 15, color: THEME.muted, anchor: "middle" });
  const low = min ?? Math.min(...points.map((point) => point.value));
  const high = max ?? Math.max(...points.map((point) => point.value));
  const span = Math.max(1, high - low);
  const step = width / Math.max(1, values.length - 1);
  const coords = points.map((point) => [x + point.index * step, y + height - ((point.value - low) / span) * height]);
  const area = `M${coords[0][0]} ${y + height} ${coords.map(([px, py]) => `L${px} ${py}`).join(" ")} L${coords.at(-1)[0]} ${y + height} Z`;
  return `<path d="${area}" fill="url(#spark-fill)"/>` + polyline(coords, { color, width: 3 })
    + coords.map(([px, py], index) => circle(px, py, 5, { fill: results[points[index].index] ? resultColor(results[points[index].index]) : color, stroke: THEME.bg, strokeWidth: 2 })).join("");
}

export function profileCardSvg(profile) {
  const WIDTH = 1400;
  const HEIGHT = 900;
  const { user, steam, faceit, progress, totals, maps = [], trend = [], trendResults = [], last, streak } = profile;
  let body = panel(48, 100, WIDTH - 96, 210, { fill: "#132019", border: THEME.borderHi, radius: 20 })
    + avatar(78, 130, 150, { name: user.name, image: user.avatarHref, highlighted: true, id: "profile" })
    + text(user.greeting || "TRACER OYUNCU KARTI", 262, 160, { size: 16, weight: 800, color: THEME.accent, letterSpacing: 1.5, width: 700 })
    + text(user.name, 260, 218, { size: 52, weight: 800, color: THEME.text, width: 640 });
  let badgeX = 262;
  const badges = [];
  if (steam) badges.push(pill(`STEAM · ${steam.name || steam.id}${steam.verified ? " ✓" : ""}`, 0, 0, { color: "#1B2838", ink: "#C7D5E0", size: 14, outline: false }));
  if (faceit) badges.push(pill(`FACEIT · ${faceit.nickname}${faceit.elo ? ` · ${faceit.elo} ELO` : ""}`, 0, 0, { color: "#FF5500", ink: "#FFFFFF", size: 14 }));
  if (user.premium) badges.push(pill("PREMIUM", 0, 0, { color: THEME.gold, ink: "#2A2000", size: 14 }));
  if (!badges.length) badges.push(pill("Hesap bağlanmadı · /hesap", 0, 0, { color: THEME.muted, size: 14, outline: true }));
  for (const badge of badges) {
    body += `<g transform="translate(${badgeX} 246)">${badge.svg}</g>`;
    badgeX += badge.width + 10;
  }
  if (faceit?.level) body += faceitBadge(78 + 150 - 50, 130 + 150 - 50, faceit.level, 52);
  body += text(`${totals.matches} maç`, WIDTH - 90, 168, { size: 34, weight: 800, color: THEME.text, anchor: "end" })
    + text(totals.matches ? `${totals.wins}G · ${totals.losses}M${totals.ties ? ` · ${totals.ties}B` : ""} · %${Math.round(totals.winRate)} galibiyet` : "Henüz analiz yok", WIDTH - 90, 198, { size: 17, color: THEME.muted, anchor: "end" });
  if (streak?.count >= 2) body += text(`${streak.count} maçlık ${streak.type === "W" ? "galibiyet" : "mağlubiyet"} serisi`, WIDTH - 90, 228, { size: 16, weight: 700, color: streak.type === "W" ? THEME.win : THEME.loss, anchor: "end" });

  body += text("SON 5 MAÇ · ÖLÇÜLEN ORTALAMALAR", 48, 356, { size: 15, weight: 800, color: THEME.muted, letterSpacing: 1.2 });
  const tileWidth = (WIDTH - 96 - 32) / 3;
  body += metricTile(48, 372, tileWidth, "KAST · ROUND KATKISI", progress.kast, { percent: true, color: metricColor(progress.kast?.value) })
    + metricTile(48 + tileWidth + 16, 372, tileWidth, "ADR · ROUND BAŞINA HASAR", progress.adr, { digits: 1 })
    + metricTile(48 + (tileWidth + 16) * 2, 372, tileWidth, "HS · KAFADAN ÖLDÜRME", progress.hs, { percent: true });

  body += panel(48, 546, 820, 270, { fill: THEME.panelAlt, border: THEME.border, radius: 16 })
    + text("KAST EĞİLİMİ · SON 10 MAÇ", 72, 584, { size: 14, weight: 800, color: THEME.dim, letterSpacing: 1.2 })
    + text("Noktalar: yeşil galibiyet · kırmızı mağlubiyet", 844, 584, { size: 13, color: THEME.muted, anchor: "end" })
    + rect(72, 606, 772, 1, { fill: "#1F2C25" }) + rect(72, 706, 772, 1, { fill: "#1F2C25" }) + rect(72, 790, 772, 1, { fill: "#1F2C25" })
    + sparkline(trend, 88, 620, 740, 160, { color: THEME.accent, min: 0, max: 100, results: trendResults });

  body += panel(884, 546, WIDTH - 932, 270, { fill: THEME.panelAlt, border: THEME.border, radius: 16 })
    + text("HARİTA HAVUZU", 908, 584, { size: 14, weight: 800, color: THEME.dim, letterSpacing: 1.2 });
  maps.slice(0, 5).forEach((item, index) => {
    const y = 616 + index * 40;
    body += text(mapLabel(item.map), 908, y + 18, { size: 19, weight: 700, color: THEME.text, width: 150 })
      + text(`${item.count} maç`, 1070, y + 18, { size: 15, color: THEME.muted })
      + barTrack(1150, y + 7, 116, 12, item.winRate / 100, { color: item.winRate >= 50 ? THEME.win : THEME.loss })
      + text(`%${Math.round(item.winRate)}`, WIDTH - 72, y + 18, { size: 16, weight: 700, color: THEME.textSoft, anchor: "end" });
  });
  if (!maps.length) body += text("Analiz edilen maç yok", 908, 640, { size: 17, color: THEME.muted });

  const footer = last
    ? `Son maç: ${mapLabel(last.map)} · ${last.score || "—"} · ${last.result || ""} · ${fmt.date(last.date)}`
    : "İlk maçını analiz ettirmek için /analiz kullan.";
  body += text(footer, 48, 856, { size: 17, color: THEME.textSoft, width: 900 })
    + text(`${user.memberSince ? `TRACER'da ${user.memberSince} beri` : ""}`, WIDTH - 48, 856, { size: 15, color: THEME.dim, anchor: "end" });
  return frame(WIDTH, HEIGHT, body, { kicker: "OYUNCU PROFİLİ", defs: linearGradient("spark-fill", [[0, THEME.accent, 0.28], [1, THEME.accent, 0]], { x2: 0, y2: 1 }) });
}

function chartPanel(x, y, width, height, { title, values, results, color, min = 0, max = null, format }) {
  const finiteValues = values.filter(Number.isFinite);
  const high = max ?? Math.max(10, Math.ceil((Math.max(...finiteValues, 0) * 1.15) / 10) * 10);
  const average = finiteValues.length ? finiteValues.reduce((sum, value) => sum + value, 0) / finiteValues.length : null;
  const plotX = x + 70;
  const plotY = y + 56;
  const plotWidth = width - 100;
  const plotHeight = height - 100;
  let svg = panel(x, y, width, height, { fill: THEME.panelAlt, border: THEME.border, radius: 16 })
    + text(title, x + 24, y + 36, { size: 15, weight: 800, color, letterSpacing: 1.2 })
    + text(average === null ? "—" : `ortalama ${format(average)}`, x + width - 24, y + 36, { size: 15, weight: 700, color: THEME.textSoft, anchor: "end" });
  for (const ratio of [0, 0.5, 1]) {
    const gy = plotY + plotHeight - ratio * plotHeight;
    svg += rect(plotX, gy, plotWidth, 1, { fill: "#1F2C25" }) + text(format(min + (high - min) * ratio), plotX - 10, gy + 5, { size: 13, color: THEME.dim, anchor: "end" });
  }
  if (average !== null) {
    const ay = plotY + plotHeight - ((average - min) / Math.max(1, high - min)) * plotHeight;
    svg += line(plotX, ay, plotX + plotWidth, ay, { color, width: 1.5, dash: "6 6", opacity: 0.6 });
  }
  const step = plotWidth / Math.max(1, values.length - 1);
  const coords = values.map((value, index) => (Number.isFinite(value) ? [plotX + index * step, plotY + plotHeight - ((Math.min(high, value) - min) / Math.max(1, high - min)) * plotHeight, index] : null)).filter(Boolean);
  svg += polyline(coords.map(([px, py]) => [px, py]), { color, width: 3 });
  for (const [px, py, index] of coords) svg += circle(px, py, 5.5, { fill: results[index] ? resultColor(results[index]) : color, stroke: THEME.bg, strokeWidth: 2 });
  if (coords.length < 2) svg += text("Yeterli ölçüm yok", x + width / 2, y + height / 2 + 10, { size: 17, color: THEME.muted, anchor: "middle" });
  return svg;
}

export function progressCardSvg({ name, matches, avatarHref = "" }) {
  const WIDTH = 1400;
  const ordered = [...matches].reverse();
  const results = ordered.map((match) => match.result === "W" ? "Galibiyet" : match.result === "L" ? "Mağlubiyet" : match.result === "T" ? "Beraberlik" : "");
  const kast = ordered.map((match) => (Number.isFinite(match.kast) ? match.kast : NaN));
  const adr = ordered.map((match) => (Number.isFinite(match.adr) ? match.adr : NaN));
  const hs = ordered.map((match) => (Number.isFinite(match.hs) ? match.hs : NaN));
  const kd = ordered.map((match) => (Number(match.deaths) > 0 ? Number(match.kills) / Number(match.deaths) : NaN));
  let body = avatar(48, 100, 72, { name, image: avatarHref, highlighted: true, id: "progress" })
    + text("GELİŞİM", 140, 124, { size: 15, weight: 800, color: THEME.accent, letterSpacing: 1.5 })
    + text(`${name} · son ${matches.length} maç`, 140, 164, { size: 36, weight: 800, color: THEME.text, width: 1000 })
    + text("Eski → yeni · noktaların rengi maç sonucunu gösterir · kesik çizgi dönem ortalaması", WIDTH - 48, 164, { size: 15, color: THEME.muted, anchor: "end" });
  const half = (WIDTH - 96 - 20) / 2;
  body += chartPanel(48, 200, half, 300, { title: "KAST · ROUND KATKISI", values: kast, results, color: THEME.accent, min: 0, max: 100, format: (value) => `%${Math.round(value)}` })
    + chartPanel(68 + half, 200, half, 300, { title: "ADR", values: adr, results, color: THEME.cyan, format: (value) => fmt.number(value, 0) })
    + chartPanel(48, 520, half, 300, { title: "HS %", values: hs, results, color: THEME.orange, min: 0, max: 100, format: (value) => `%${Math.round(value)}` })
    + chartPanel(68 + half, 520, half, 300, { title: "K/D", values: kd, results, color: THEME.purple, max: Math.max(2, Math.ceil(Math.max(0, ...kd.filter(Number.isFinite)) * 1.2 * 2) / 2), format: (value) => fmt.number(value, 2) });
  const mapsLine = ordered.slice(-12).map((match) => mapLabel(match.map).slice(0, 7)).join(" · ");
  body += text(`Son maçlar: ${mapsLine || "—"}`, 48, 864, { size: 15, color: THEME.dim, width: WIDTH - 96 });
  return frame(WIDTH, 900, body, { kicker: "KİŞİSEL GELİŞİM" });
}

export function compareCardSvg({ left, right, rows }) {
  const WIDTH = 1400;
  const height = 300 + rows.length * 70 + 60;
  let body = avatar(48, 104, 96, { name: left.name, image: left.avatarHref, highlighted: true, id: "cmp-a" })
    + text(left.name, 162, 150, { size: 34, weight: 800, color: PLAYER_COLORS[0], width: 420 })
    + text(left.subtitle || "", 162, 182, { size: 16, color: THEME.muted, width: 420 })
    + avatar(WIDTH - 144, 104, 96, { name: right.name, image: right.avatarHref, id: "cmp-b" })
    + text(right.name, WIDTH - 162, 150, { size: 34, weight: 800, color: PLAYER_COLORS[1], anchor: "end", width: 420 })
    + text(right.subtitle || "", WIDTH - 162, 182, { size: 16, color: THEME.muted, anchor: "end", width: 420 })
    + text("VS", WIDTH / 2, 160, { size: 40, weight: 800, color: THEME.dim, anchor: "middle" });
  let leftWins = 0;
  let rightWins = 0;
  rows.forEach((row, index) => {
    const y = 240 + index * 70;
    const a = Number(row.a);
    const b = Number(row.b);
    const bothMeasured = Number.isFinite(a) && Number.isFinite(b);
    const better = bothMeasured && a !== b ? ((a > b) === (row.higherIsBetter !== false) ? "a" : "b") : "";
    if (better === "a") leftWins++;
    if (better === "b") rightWins++;
    const max = Math.max(Math.abs(a) || 0, Math.abs(b) || 0, row.max || 0) || 1;
    body += panel(48, y, WIDTH - 96, 60, { fill: index % 2 ? THEME.panelAlt : "#141D18", border: THEME.border, radius: 12 })
      + text(row.label, WIDTH / 2, y + 38, { size: 17, weight: 800, color: THEME.textSoft, anchor: "middle" })
      + text(Number.isFinite(a) ? row.format(a) : "—", 76, y + 40, { size: 24, weight: 800, color: better === "a" ? PLAYER_COLORS[0] : THEME.text })
      + text(Number.isFinite(b) ? row.format(b) : "—", WIDTH - 76, y + 40, { size: 24, weight: 800, color: better === "b" ? PLAYER_COLORS[1] : THEME.text, anchor: "end" })
      + (Number.isFinite(a) ? rect(WIDTH / 2 - 130 - 250 * (Math.abs(a) / max), y + 26, 250 * (Math.abs(a) / max), 8, { fill: PLAYER_COLORS[0], radius: 4, opacity: better === "a" ? 1 : 0.4 }) : "")
      + (Number.isFinite(b) ? rect(WIDTH / 2 + 130, y + 26, 250 * (Math.abs(b) / max), 8, { fill: PLAYER_COLORS[1], radius: 4, opacity: better === "b" ? 1 : 0.4 }) : "");
  });
  const verdict = leftWins === rightWins ? "Dengeli bir eşleşme" : `${leftWins > rightWins ? left.name : right.name} ${Math.max(leftWins, rightWins)}-${Math.min(leftWins, rightWins)} önde`;
  body += text(verdict, WIDTH / 2, height - 40, { size: 22, weight: 800, color: THEME.accent, anchor: "middle", width: WIDTH - 200 });
  return frame(WIDTH, height, body, { kicker: "KARŞILAŞTIRMA" });
}

export function leaderboardCardSvg({ title, subtitle, rows, metricLabel }) {
  const WIDTH = 1200;
  const height = 230 + Math.max(1, rows.length) * 74 + 50;
  const max = Math.max(1, ...rows.map((row) => Number(row.value) || 0));
  const medals = ["#F4C95D", "#C9D2D6", "#D69A6A"];
  let body = text("SUNUCU SIRALAMASI", 48, 126, { size: 15, weight: 800, color: THEME.accent, letterSpacing: 1.5 })
    + text(title, 48, 172, { size: 38, weight: 800, color: THEME.text, width: WIDTH - 96 })
    + text(subtitle, 48, 204, { size: 17, color: THEME.muted, width: WIDTH - 96 });
  rows.forEach((row, index) => {
    const y = 230 + index * 74;
    const highlight = index < 3;
    body += panel(48, y, WIDTH - 96, 64, { fill: highlight ? "#16241B" : THEME.panelAlt, border: highlight ? "#3C5037" : THEME.border, radius: 14 })
      + (highlight ? circle(90, y + 32, 20, { fill: medals[index] }) + text(String(index + 1), 90, y + 39, { size: 20, weight: 800, color: "#1A1A1A", anchor: "middle" })
        : text(String(index + 1), 90, y + 40, { size: 22, weight: 800, color: THEME.muted, anchor: "middle" }))
      + avatar(126, y + 10, 44, { name: row.name, image: row.avatarHref, id: `lb-${index}` })
      + text(row.name, 186, y + 32, { size: 21, weight: 800, color: THEME.text, width: 360 })
      + text(row.sub || "", 186, y + 54, { size: 14, color: THEME.muted, width: 360 })
      + barTrack(600, y + 27, 330, 10, (Number(row.value) || 0) / max, { color: highlight ? medals[index] : THEME.accent, track: "#1E2A24" })
      + text(row.display, WIDTH - 72, y + 41, { size: 24, weight: 800, color: highlight ? medals[index] : THEME.text, anchor: "end" });
  });
  if (!rows.length) body += text("Henüz sıralamaya girecek oyuncu yok. Hesabını bağla ve maç analiz ettir!", 48, 270, { size: 20, color: THEME.muted });
  body += text(`${metricLabel} · yalnız profilini herkese açık bırakan ve yeterli maçı olan oyuncular`, 48, height - 30, { size: 14, color: THEME.dim, width: WIDTH - 96 });
  return frame(WIDTH, height, body, { kicker: "LİDERLİK TABLOSU" });
}

export function faceitCardSvg({ player, matches, avatarHref = "" }) {
  const WIDTH = 1400;
  const rows = matches.slice(0, 10);
  const height = 470 + Math.max(1, rows.length) * 52 + 50;
  const withStats = matches.filter((match) => match.statsAvailable);
  const average = (read) => {
    const values = withStats.map(read).filter((value) => Number.isFinite(value));
    return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
  };
  const wins = matches.filter((match) => match.score?.isWin && !match.score?.isTie).length;
  const known = matches.filter((match) => match.score && match.score.rawScore !== "—").length;
  let body = panel(48, 100, WIDTH - 96, 190, { fill: "#1A1410", border: "#5A3418", radius: 20 })
    + avatar(78, 128, 134, { name: player.nickname, image: avatarHref, id: "faceit" })
    + text("FACEIT · CS2", 240, 156, { size: 16, weight: 800, color: "#FF5500", letterSpacing: 1.5 })
    + text(player.nickname, 238, 212, { size: 50, weight: 800, color: THEME.text, width: 620 })
    + text(`${player.country ? `${String(player.country).toUpperCase()} · ` : ""}${player.region || "Bölge bilinmiyor"}`, 240, 250, { size: 18, color: THEME.muted, width: 600 })
    + faceitBadge(WIDTH - 330, 138, player.level, 96)
    + text(player.elo ? String(player.elo) : "—", WIDTH - 90, 196, { size: 52, weight: 800, color: THEME.text, anchor: "end" })
    + text("ELO", WIDTH - 90, 228, { size: 16, weight: 800, color: THEME.muted, anchor: "end" });
  const tiles = [
    ["SON MAÇLAR", known ? `${wins}/${known}` : "—", known ? `%${Math.round((wins / known) * 100)} galibiyet` : "skor yok"],
    ["ORT. K/D", fmt.number(average((match) => match.userStats?.kd), 2), `${withStats.length} maçta`],
    ["ORT. ADR", fmt.number(average((match) => match.userStats?.adr), 1), "round başına hasar"],
    ["ORT. HS", fmt.percent(average((match) => match.userStats?.hsPercent), 0), "kafadan öldürme"],
  ];
  const tileWidth = (WIDTH - 96 - 48) / 4;
  tiles.forEach(([label, value, sub], index) => {
    const x = 48 + index * (tileWidth + 16);
    body += panel(x, 312, tileWidth, 128, { fill: THEME.panelAlt, border: THEME.border, radius: 14 })
      + text(label, x + 20, 344, { size: 13, weight: 800, color: THEME.dim, letterSpacing: 1.2 })
      + text(value, x + 20, 394, { size: 40, weight: 800, color: THEME.text })
      + text(sub, x + 20, 424, { size: 14, color: THEME.muted });
  });
  rows.forEach((match, index) => {
    const y = 460 + index * 52;
    const color = match.score?.isTie ? THEME.tie : match.score?.isWin ? THEME.win : match.score?.rawScore === "—" ? THEME.muted : THEME.loss;
    body += rect(48, y, WIDTH - 96, 46, { fill: index % 2 ? THEME.panelAlt : "#141D18", radius: 10 })
      + rect(48, y, 6, 46, { fill: color, radius: 3 })
      + text(match.score?.isTie ? "B" : match.score?.isWin ? "G" : match.score?.rawScore === "—" ? "?" : "M", 80, y + 31, { size: 20, weight: 800, color, anchor: "middle" })
      + text(mapLabel(match.map), 110, y + 31, { size: 19, weight: 700, color: THEME.text, width: 170 })
      + text(match.score?.rawScore || "—", 300, y + 31, { size: 19, weight: 700, color: THEME.textSoft })
      + text(match.statsAvailable ? `${match.userStats?.kills ?? "—"}/${match.userStats?.deaths ?? "—"}/${match.userStats?.assists ?? "—"}` : "istatistik yok", 420, y + 31, { size: 18, color: THEME.textSoft })
      + text(match.statsAvailable ? `K/D ${fmt.number(match.userStats?.kd, 2)}` : "", 590, y + 31, { size: 17, color: THEME.muted })
      + text(match.statsAvailable ? `ADR ${fmt.number(match.userStats?.adr, 0)}` : "", 730, y + 31, { size: 17, color: THEME.muted })
      + text(match.statsAvailable ? `HS ${fmt.percent(match.userStats?.hsPercent, 0)}` : "", 870, y + 31, { size: 17, color: THEME.muted })
      + text(match.analyzedMatchId ? "ANALİZ HAZIR" : "", 1020, y + 31, { size: 14, weight: 800, color: THEME.accent })
      + text(fmt.date(match.timestamp, "short"), WIDTH - 72, y + 31, { size: 16, color: THEME.dim, anchor: "end" });
  });
  if (!rows.length) body += text("FACEIT maç geçmişi bulunamadı.", 48, 500, { size: 20, color: THEME.muted });
  body += text("Veriler FACEIT Data API'den · demo analizi için maç seçip Analiz Et'e bas", 48, height - 26, { size: 14, color: THEME.dim });
  return frame(WIDTH, height, body, { kicker: "FACEIT PROFİLİ", accent: "#FF5500" });
}

const STATUS = { good: ["İYİ", THEME.win], watch: ["DİKKAT", THEME.gold], problem: ["ÖNCELİK", THEME.loss], nodata: ["VERİ YOK", THEME.muted] };

export function tsideCardSvg({ name, mapName, summary }) {
  const WIDTH = 1500;
  const cards = (summary?.cards || []).slice(0, 10);
  const rowsCount = Math.ceil(cards.length / 2);
  const height = 260 + rowsCount * 196 + 50;
  let body = text("T TARAFI OYUN DİSİPLİNİ", 48, 126, { size: 15, weight: 800, color: THEME.t, letterSpacing: 1.5 })
    + text(`${name}${mapName ? ` · ${mapName}` : ""}`, 48, 172, { size: 38, weight: 800, color: THEME.text, width: 1000 })
    + text(`${summary?.tRounds ?? 0} T roundu · T kazanma ${summary?.tWinRate === null || summary?.tWinRate === undefined ? "—" : `%${summary.tWinRate}`} · demo zaman çizelgesinden ölçüldü`, 48, 206, { size: 17, color: THEME.muted, width: 1000 });
  if (summary?.score !== null && summary?.score !== undefined) {
    body += circle(WIDTH - 110, 160, 56, { fill: "#1B2418", stroke: metricColor(summary.score), strokeWidth: 5 })
      + text(String(summary.score), WIDTH - 110, 172, { size: 38, weight: 800, color: metricColor(summary.score), anchor: "middle" })
      + text("DİSİPLİN", WIDTH - 110, 238, { size: 12, weight: 800, color: THEME.muted, anchor: "middle" });
  }
  const cardWidth = (WIDTH - 96 - 20) / 2;
  cards.forEach((item, index) => {
    const x = 48 + (index % 2) * (cardWidth + 20);
    const y = 250 + Math.floor(index / 2) * 196;
    const [label, color] = STATUS[item.status] || STATUS.nodata;
    const badge = pill(label, 0, 0, { color, size: 12, padding: 8 });
    body += panel(x, y, cardWidth, 182, { fill: THEME.panelAlt, border: item.status === "problem" ? "#5A2E31" : THEME.border, radius: 14 })
      + text(`${item.order ?? index + 1}. ${item.title}`, x + 20, y + 36, { size: 21, weight: 800, color: THEME.text, width: cardWidth - 230 })
      + `<g transform="translate(${x + cardWidth - 20 - badge.width} ${y + 16})">${badge.svg}</g>`
      + text(item.value ?? "—", x + 20, y + 80, { size: 32, weight: 800, color })
      + text(item.detail || "", x + 20, y + 104, { size: 14, color: THEME.muted, width: cardWidth - 40 })
      + paragraph(item.status === "nodata" ? `Yeterli örnek yok. ${item.evidence || ""}` : item.action || item.evidence || "", x + 20, y + 132, { size: 15, color: item.status === "nodata" ? THEME.muted : THEME.textSoft, width: cardWidth - 40, maxLines: 2 }).svg;
  });
  if (!cards.length) body += text("Bu maç için T tarafı zaman çizelgesi oluşturulamadı.", 48, 300, { size: 20, color: THEME.muted });
  body += text("Kurallar: alan al · erken ölme · default oyna · amaçlı utility · takas mesafesi · geç execute yapma · rotasyon · tempo · sayı üstünlüğü · bomba sonrası", 48, height - 28, { size: 14, color: THEME.dim, width: WIDTH - 96 });
  return frame(WIDTH, height, body, { kicker: "T TARAFI", accent: THEME.t });
}

export function welcomeCardSvg({ name, avatarHref = "", returning = false, stats = null }) {
  const WIDTH = 1400;
  const HEIGHT = 620;
  const steps = [
    ["1", "Hesabını bağla", "/hesap steam veya /hesap faceit — seni maçlarda tanırım."],
    ["2", "Demo analiz ettir", "/analiz ile dosya, bağlantı ya da tek kullanımlık yükleme linki."],
    ["3", "Gelişimini izle", "/profil ve /gelisim son maçlarını önceki dönemle kıyaslar."],
    ["4", "Takımca oyna", "/sunucu kur, /liderlik ve /takim ile beşli koçluk."],
  ];
  let body = avatar(48, 104, 120, { name, image: avatarHref, highlighted: true, id: "welcome" })
    + text(returning ? "TEKRAR HOŞ GELDİN" : "HOŞ GELDİN", 196, 140, { size: 16, weight: 800, color: THEME.accent, letterSpacing: 1.5 })
    + text(name, 194, 196, { size: 48, weight: 800, color: THEME.text, width: 1100 })
    + text(stats || "TRACER CS2 koçu: demo analizi, tepki süresi, düello, T taktiği ve kişisel gelişim — hepsi Discord'da.", 196, 232, { size: 19, color: THEME.muted, width: 1150 });
  const width = (WIDTH - 96 - 48) / 4;
  steps.forEach(([number, title, detail], index) => {
    const x = 48 + index * (width + 16);
    body += panel(x, 290, width, 250, { fill: THEME.panelAlt, border: THEME.border, radius: 16 })
      + circle(x + 44, 340, 24, { fill: THEME.accent })
      + text(number, x + 44, 349, { size: 24, weight: 800, color: THEME.accentInk, anchor: "middle" })
      + text(title, x + 22, 410, { size: 23, weight: 800, color: THEME.text, width: width - 44 })
      + paragraph(detail, x + 22, 446, { size: 16, color: THEME.textSoft, width: width - 44, maxLines: 4 }).svg;
  });
  body += text("Seni hatırlarım: bağlı hesapların, maç geçmişin ve ayarların sunucular arasında seninle gelir. /hesap sil ile her şeyi silebilirsin.", 48, 584, { size: 15, color: THEME.dim, width: WIDTH - 96 });
  return frame(WIDTH, HEIGHT, body, { kicker: "CS2 KOÇU · DISCORD" });
}
