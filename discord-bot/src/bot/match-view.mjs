// /mac görünümü: masaüstü TRACER'daki analiz ekranının Discord karşılığı.
// Sekmeler: Takım tablosu · Tepki · Düello · Silah/Mesafe · T tarafı · Kapsam.
import { existsSync } from "node:fs";
import { buildDiscordReportImageModel } from "../../engine/companion/discord_reporter.mjs";
import { attachTSideReports } from "../../engine/companion/tside.mjs";
import { reportCoverage } from "../../engine/shared/experience.mjs";
import { scoreMatchReport } from "../../engine/shared/scoring.mjs";
import { readAnalysis, reportMatch } from "../analysis/pipeline.mjs";
import { distanceCardSvg, duelCardSvg, encounterLabel, filterEncounters } from "../render/cards/duel.mjs";
import { matchReportSvg, reactionCardSvg } from "../render/cards/match-report.mjs";
import { tsideCardSvg } from "../render/cards/player.mjs";
import { fmt, mapLabel } from "../render/svg.mjs";
import { COLORS, RESULT_TEXT, STYLE, button, cid, embed, png, resultColor, row, select } from "./ui.mjs";

export const TABS = [
  ["o", "Takım tablosu", "📋"],
  ["r", "Tepki", "⚡"],
  ["d", "Düello", "🎯"],
  ["w", "Silah/Mesafe", "📏"],
  ["t", "T tarafı", "💣"],
];

const analysisCache = new Map();

/** Sıkıştırılmış analizi küçük bir bellek önbelleğiyle okur (sekme geçişleri hızlı olsun). */
export function loadAnalysis(match) {
  if (!match?.analysis_file || !existsSync(match.analysis_file)) return null;
  const cached = analysisCache.get(match.id);
  if (cached) return cached;
  const analysis = readAnalysis(match.analysis_file);
  if (analysisCache.size >= 4) analysisCache.delete(analysisCache.keys().next().value);
  analysisCache.set(match.id, analysis);
  return analysis;
}

export function forgetAnalysis(matchId) {
  analysisCache.delete(matchId);
}

function tabRows(matchId, ownerId, active) {
  return [row(...TABS.map(([key, label, emoji]) => button(cid("m", key, matchId, ownerId), label, { emoji, style: key === active ? STYLE.primary : STYLE.secondary })))];
}

function summaryFields(report) {
  if (!report) return [];
  const kast = scoreMatchReport(report)?.overall;
  const reaction = report.duelAnalyst?.reaction;
  const duel = report.duelStats;
  return [
    { name: "K / D / A", value: `${report.kills}/${report.deaths}/${report.assists}`, inline: true },
    { name: "ADR", value: fmt.number(report.adr), inline: true },
    { name: "KAST", value: kast === null || kast === undefined ? "Ölçülemedi" : `%${fmt.number(kast)}`, inline: true },
    { name: "HS", value: report.kills > 0 ? `%${fmt.number(report.headshotPercent, 0)}` : "—", inline: true },
    { name: "Düello", value: duel?.duelStatus === "measured" ? `%${fmt.number(duel.duelWinrate, 0)} (${duel.duelTotal} temas)` : "Ölçülemedi", inline: true },
    { name: "Tepki medyanı", value: Number.isFinite(Number(reaction?.medianMs)) ? `${Math.round(reaction.medianMs)} ms` : "Ölçülemedi", inline: true },
  ];
}

function header(storedMatch, view) {
  const score = view.score;
  const result = score ? (score.isTie ? "T" : score.isWin ? "W" : "L") : "";
  const date = storedMatch.played_at ? fmt.date(storedMatch.played_at) : "Tarih bilinmiyor";
  const dateNote = storedMatch.meta?.dateSource === "upload" ? " (yükleme zamanı)" : "";
  return {
    title: `${mapLabel(storedMatch.map)} · ${score?.rawScore || "—"} · ${RESULT_TEXT[result] || "Sonuç bilinmiyor"}`,
    color: resultColor(result),
    footer: `${storedMatch.meta?.mode || "CS2"} · ${date}${dateNote} · KAST profesyonel rating değildir; round katkısıdır.`,
    result,
  };
}

/**
 * Bir sekmenin mesajını üretir.
 * viewer: { steamid, name } — kimin gözünden (kendi takımı ayrıntılı gösterilir).
 */
export async function renderMatchTab({ renderer, storedMatch, ownerId, viewer, tab = "o", duel = {} }) {
  const analysis = loadAnalysis(storedMatch);
  if (!analysis) {
    return {
      embeds: [embed({
        title: `${mapLabel(storedMatch.map)} · ayrıntılı analiz arşivde yok`,
        description: "Bu maçın ayrıntılı analiz dosyası yer açmak için silinmiş. Kişisel özetin gelişim geçmişinde duruyor; demoyu yeniden analiz ettirirsen bütün sekmeler geri gelir.",
        color: COLORS.muted,
      })],
      components: [],
      files: [],
    };
  }
  const view = reportMatch(storedMatch, analysis, viewer);
  const report = view.viewerReport;
  const head = header(storedMatch, view);
  const base = { title: head.title, color: head.color, footer: head.footer };
  const components = tabRows(storedMatch.id, ownerId, tab);

  if (tab === "o") {
    const model = buildDiscordReportImageModel(view, viewer?.steamid ? viewer : view.userStats);
    const image = await renderer.render(matchReportSvg(model));
    return {
      embeds: [embed({ ...base, description: `**${report?.player?.name || "Oyuncu"}** gözünden · bizim takım ayrıntılı, rakip kısa özet.`, fields: summaryFields(report), image: "attachment://tracer-mac.png" })],
      files: [png(image, "tracer-mac.png")],
      components: [...components, row(
        button(cid("m", "k", storedMatch.id, ownerId), "Veri kapsamı", { emoji: "🧪" }),
        button(cid("share", storedMatch.id, ownerId), "Sunucuya paylaş", { emoji: "📣" }),
      )],
    };
  }
  if (tab === "r") {
    const model = buildDiscordReportImageModel(view, viewer?.steamid ? viewer : view.userStats);
    const image = await renderer.render(reactionCardSvg(model));
    return {
      embeds: [embed({ ...base, description: "Görünürlükten ilk ateşe tepki süresi · takımın tüm oyuncuları aynı ms ekseninde, her biri kendi temas sırasıyla. Eksik ölçüm sıfır olarak çizilmez.", image: "attachment://tracer-tepki.png" })],
      files: [png(image, "tracer-tepki.png")],
      components,
    };
  }
  if (tab === "d") {
    const filter = duel.filter || "all";
    const encounters = filterEncounters(report?.duelAnalyst, filter);
    if (!encounters.length) {
      return {
        embeds: [embed({ ...base, description: report?.duelAnalyst ? "Bu filtrede temas bulunamadı." : "Düello Analisti için demoyu yeniden analiz et." })],
        files: [],
        components: [...components, duelFilterRow(storedMatch.id, ownerId, filter)],
      };
    }
    const index = Math.max(0, Math.min(Number(duel.index) || 0, encounters.length - 1));
    const current = encounters[index];
    const showAll = Boolean(duel.all);
    const image = await renderer.render(duelCardSvg({ duel: current, mapName: analysis.header?.map_name || storedMatch.map, playerName: report?.player?.name || "Sen", index, total: encounters.length, showAllShots: showAll }));
    const nav = row(
      button(cid("d", storedMatch.id, ownerId, Math.max(0, index - 1), filter, showAll ? 1 : 0), "Önceki", { emoji: "◀️", disabled: index === 0 }),
      button(cid("d", storedMatch.id, ownerId, Math.min(encounters.length - 1, index + 1), filter, showAll ? 1 : 0), "Sonraki", { emoji: "▶️", disabled: index >= encounters.length - 1 }),
      button(cid("d", storedMatch.id, ownerId, index, filter, showAll ? 0 : 1), showAll ? "Son atış" : "Tüm atışlar", { emoji: "🔫", style: showAll ? STYLE.primary : STYLE.secondary, disabled: !current.shots?.length }),
    );
    const start = Math.max(0, Math.min(index - 12, encounters.length - 25));
    const jump = select(cid("dj", storedMatch.id, ownerId, filter, showAll ? 1 : 0), encounters.slice(start, start + 25).map((item, offset) => ({
      label: encounterLabel(item, start + offset), value: String(start + offset), default: start + offset === index,
    })), { placeholder: "Düello seç" });
    return {
      embeds: [embed({ ...base, description: `Düello ${index + 1}/${encounters.length} · Round ${current.round} · ${current.opponent?.name || "?"}`, image: "attachment://tracer-duello.png" })],
      files: [png(image, "tracer-duello.png")],
      components: [...components, nav, jump, duelFilterRow(storedMatch.id, ownerId, filter)],
    };
  }
  if (tab === "w") {
    const image = await renderer.render(distanceCardSvg({ analyst: report?.duelAnalyst, playerName: report?.player?.name || "", mapName: mapLabel(storedMatch.map) }));
    return { embeds: [embed({ ...base, image: "attachment://tracer-mesafe.png" })], files: [png(image, "tracer-mesafe.png")], components };
  }
  if (tab === "t") {
    const copy = { ...analysis, reports: analysis.reports.map((item) => ({ ...item })) };
    attachTSideReports(copy, storedMatch.map);
    const tReport = copy.reports.find((item) => item.player?.steamid && item.player.steamid === report?.player?.steamid) || copy.reports[0];
    const image = await renderer.render(tsideCardSvg({ name: tReport?.player?.name || "", mapName: mapLabel(storedMatch.map), summary: tReport?.tSide }));
    return { embeds: [embed({ ...base, description: "On T tarafı kuralı demo zaman çizelgesinden ölçüldü. Takımca bakmak için `/takim rapor`.", image: "attachment://tracer-t.png" })], files: [png(image, "tracer-t.png")], components };
  }
  if (tab === "k") {
    const coverage = reportCoverage(report);
    return {
      embeds: [embed({ ...base, description: "Bu demoda hangi ölçümlerin yeterli örneği var? Eksik ölçüm sıfır sayılmaz; karşılaştırmalara katılmaz.", fields: coverage.map((item) => ({ name: `${item.available ? "✅" : "▫️"} ${item.label}`, value: item.available ? `${item.count} ${item.unit}` : item.reason, inline: true })) })],
      files: [],
      components,
    };
  }
  return { embeds: [embed({ ...base, description: "Bilinmeyen sekme." })], files: [], components };
}

function duelFilterRow(matchId, ownerId, active) {
  const options = [["all", "Tüm temaslar"], ["win", "Kazanılan"], ["loss", "Kaybedilen"], ["unseen", "Görüş açılmadan ölüm"], ["unresolved", "Sonuçlanmayan"]];
  return select(cid("df", matchId, ownerId), options.map(([value, label]) => ({ label, value, default: value === active })), { placeholder: "Temas filtresi" });
}

/** Bu demoda sen hangisisin? (hesap bağlı değilse) */
export function playerPicker(storedMatch, analysis, ownerId) {
  const options = (analysis?.reports || []).filter((report) => report.player?.steamid).slice(0, 25).map((report) => ({
    label: report.player.name || report.player.steamid,
    value: report.player.steamid,
    description: `${report.kills}/${report.deaths}/${report.assists} · ADR ${fmt.number(report.adr, 0)}`,
  }));
  return select(cid("pick", storedMatch.id, ownerId), options, { placeholder: "Bu demoda sen hangisisin? (bir kez seç, hatırlarım)" });
}
