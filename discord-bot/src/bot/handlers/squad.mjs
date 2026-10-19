// /takim: masaüstü TRACER v0.53.0 Takım Koçu'nun Discord karşılığı — beşli
// raporu, demodan T taktikleri, maç öncesi plan ve GSI ile canlı round tahtası.
import { buildPlanImageModel, buildPlanMessage } from "../../../engine/companion/squad/discord_live.mjs";
import { cleanPlayer, normalizeMapName, normalizeSteamId, selectionFingerprint } from "../../../engine/companion/squad/identity.mjs";
import { startLiveSession } from "../../../engine/companion/squad/live.mjs";
import { buildSquadReport } from "../../../engine/companion/squad/planner.mjs";
import { buildStrategyImageModel, buildStrategyMessage } from "../../../engine/companion/squad/strat_render.mjs";
import { buildStrategies } from "../../../engine/companion/squad/strats.mjs";
import { buildTacticalMap } from "../../../engine/companion/squad/tactics.mjs";
import { radarCalibration } from "../../../engine/companion/radar_calibration.mjs";
import { planCardSvg, squadReportCardSvg, strategyCardSvg } from "../../render/cards/team.mjs";
import { mapLabel } from "../../render/svg.mjs";
import { COLORS, EPHEMERAL, STYLE, button, cid, embed, errorMessage, infoMessage, png, row, select } from "../ui.mjs";

const scopeOf = (interaction) => (interaction.guildId ? `guild:${interaction.guildId}` : `user:${interaction.user.id}`);

function squadsVisible(app, interaction) {
  const list = [...app.store.squadsInScope(scopeOf(interaction))];
  if (interaction.guildId) list.push(...app.store.squadsInScope(`user:${interaction.user.id}`));
  return list;
}

export function squadAutocomplete(app, interaction) {
  const query = String(interaction.options.getFocused() || "").toLocaleLowerCase("tr-TR");
  return squadsVisible(app, interaction)
    .filter((squad) => !query || squad.name.toLocaleLowerCase("tr-TR").includes(query))
    .slice(0, 25)
    .map((squad) => ({ name: `${squad.name} · ${mapLabel(squad.map)} · ${squad.roster.length} oyuncu`.slice(0, 100), value: squad.id }));
}

function pickSquad(app, interaction) {
  const id = interaction.options.getString("takim");
  const squad = id ? app.store.getSquad(id) : squadsVisible(app, interaction)[0];
  if (!squad) return { error: "Henüz takımın yok. `/takim kur` ile oluştur." };
  const scopes = [scopeOf(interaction), `user:${interaction.user.id}`];
  if (!scopes.includes(squad.scope)) return { error: "Bu takım burada kullanılamaz." };
  return { squad };
}

function canManage(interaction, squad) {
  if (squad.owner_user_id === interaction.user.id) return true;
  return Boolean(interaction.memberPermissions?.has?.("ManageGuild"));
}

/** Takımın haritadaki kompakt maçlarıyla raporu yeniden üretir. */
function rebuildReport(app, squad) {
  const ids = squad.roster.map((player) => player.steamid);
  const matches = app.store.squadMatchesFor(squad.map, ids, 150);
  if (!matches.length) throw Object.assign(new Error(`Bu oyuncuların ${mapLabel(squad.map)} haritasında analiz edilmiş maçı yok. Önce birkaç ortak maçınızı \`/analiz\` ile yükleyin.`), { userFacing: true });
  const report = buildSquadReport(matches, squad.roster, squad.map, { ownerSteamId: squad.owner_steam_id, mapMatches: matches });
  return { report, matches };
}

export async function takim(app, interaction) {
  const group = interaction.options.getSubcommandGroup(false);
  const sub = interaction.options.getSubcommand();
  if (group === "canli") return live(app, interaction, sub);
  if (sub === "kur") return create(app, interaction);
  if (sub === "liste") {
    const squads = squadsVisible(app, interaction);
    if (!squads.length) return interaction.reply({ ...infoMessage("Henüz takımın yok. `/takim kur` ile oluştur."), flags: EPHEMERAL });
    return interaction.reply({ embeds: [embed({ title: "Takımlar", description: squads.map((squad) => `**${squad.name}** · ${mapLabel(squad.map)} · ${squad.roster.map((player) => player.name).join(", ")}${squad.report ? "" : " · rapor yok"}`).join("\n"), color: COLORS.accent })], flags: EPHEMERAL });
  }
  const { squad, error } = pickSquad(app, interaction);
  if (error) return interaction.reply({ ...infoMessage(error), flags: EPHEMERAL });
  if (sub === "sil") {
    if (!canManage(interaction, squad)) return interaction.reply({ ...errorMessage("Takımı yalnız kuran kişi veya sunucu yöneticisi silebilir."), flags: EPHEMERAL });
    app.store.deleteSquad(squad.id);
    return interaction.reply({ ...infoMessage(`**${squad.name}** silindi.`), flags: EPHEMERAL });
  }
  await interaction.deferReply();
  let report;
  let matches;
  try {
    ({ report, matches } = rebuildReport(app, squad));
    app.store.saveSquad({ ...squad, report });
  } catch (failure) {
    return interaction.editReply(errorMessage(failure.message));
  }
  if (sub === "rapor") {
    const image = await app.renderer.render(squadReportCardSvg(report, squad.name));
    const priorities = (report.tSide?.cards || []).filter((card) => card.status === "problem").slice(0, 3);
    return interaction.editReply({
      embeds: [embed({
        title: `${squad.name} · ${report.mapLabel}`,
        description: `${report.evidence?.matchIds?.length || matches.length} maçtan · güven: ${report.evidence?.evidence?.confidenceLabel || "—"}`,
        fields: [
          ...(priorities.length ? [{ name: "Takımın T öncelikleri", value: priorities.map((card) => `**${card.title}** ${card.value} — ${card.action}`).join("\n") }] : []),
          { name: "Kurallar", value: report.playbook.rules.slice(0, 4).map((rule) => `• ${rule}`).join("\n") },
        ],
        image: "attachment://tracer-takim.png",
        color: COLORS.accent,
        footer: report.limitations?.[0],
      })],
      files: [png(image, "tracer-takim.png")],
      components: [row(
        button(cid("sqt", squad.id, interaction.user.id), "T taktikleri", { emoji: "💣" }),
        button(cid("sqp", squad.id, interaction.user.id), "Maç öncesi plan", { emoji: "🗺️" }),
      )],
    });
  }
  if (sub === "taktik") return interaction.editReply(await strategyPayload(app, squad, report, matches, 0, interaction.user.id));
  if (sub === "plan") return interaction.editReply(await planPayload(app, squad, report));
  return undefined;
}

async function create(app, interaction) {
  const map = normalizeMapName(interaction.options.getString("harita", true));
  const name = interaction.options.getString("ad", true).trim().slice(0, 60);
  const members = [1, 2, 3, 4, 5].map((index) => interaction.options.getUser(`oyuncu${index}`)).filter(Boolean);
  const unique = [...new Map(members.map((member) => [member.id, member])).values()];
  const roster = [];
  const missing = [];
  for (const member of unique) {
    const user = app.store.getUser(member.id);
    const steamid = normalizeSteamId(user?.steam_id);
    if (!steamid) missing.push(member.username);
    else roster.push(cleanPlayer({ steamid, name: user.name || member.username }));
  }
  if (missing.length) return interaction.reply({ ...errorMessage(`Steam hesabı bağlı olmayan oyuncular: **${missing.join(", ")}**. Her oyuncu \`/hesap steam\` ile bağlamalı.`), flags: EPHEMERAL });
  const fingerprint = selectionFingerprint(roster);
  if (!fingerprint) return interaction.reply({ ...errorMessage("1–5 farklı oyuncu seç."), flags: EPHEMERAL });
  const scope = scopeOf(interaction);
  const owner = app.store.getUser(interaction.user.id);
  const ownerSteam = roster.find((player) => player.steamid === owner?.steam_id)?.steamid || roster[0].steamid;
  const id = `${interaction.guildId || `u${interaction.user.id}`}_${fingerprint}_${map}`;
  const squad = app.store.saveSquad({ id, scope, name, map, roster, owner_user_id: interaction.user.id, owner_steam_id: ownerSteam });
  const available = app.store.squadMatchesFor(map, roster.map((player) => player.steamid), 150).length;
  return interaction.reply({
    embeds: [embed({
      title: `Takım kuruldu: ${name}`,
      description: `🗺️ ${mapLabel(map)} · 👥 ${roster.map((player) => player.name).join(", ")}\n📦 Bu haritada arşivde **${available}** maç var. Rapor için her oyuncunun en az 3 analizli maçı gerekir.\n\nSıradaki: \`/takim rapor\`, \`/takim taktik\`, \`/takim plan\`.`,
      color: COLORS.accent,
    })],
    components: [row(button(cid("sqt", squad.id, interaction.user.id), "T taktikleri", { emoji: "💣" }), button(cid("sqp", squad.id, interaction.user.id), "Maç öncesi plan", { emoji: "🗺️" }))],
  });
}

async function strategyPayload(app, squad, report, matches, index, ownerId) {
  const tactical = report.tactical || buildTacticalMap(matches, squad.map, { ownerSteamId: squad.owner_steam_id, roster: squad.roster });
  const strategies = buildStrategies({ matches, roster: squad.roster, map: squad.map, tactical, ownerSteamId: squad.owner_steam_id });
  if (!strategies.length) return infoMessage("Taktik için her sitede en az 3 takım girişi gerekiyor. Birkaç ortak T yarısı daha analiz edin.", { title: `${squad.name} · T taktiği` });
  const strategy = strategies[Math.max(0, Math.min(index, strategies.length - 1))];
  const model = buildStrategyImageModel(strategy, { map: squad.map, mapLabel: mapLabel(squad.map) });
  const image = await app.renderer.render(strategyCardSvg(model, squad.map));
  const message = buildStrategyMessage(strategy, { mapLabel: mapLabel(squad.map), withImage: true });
  const embeds = message.embeds.map((item) => ({ ...item, image: { url: "attachment://tracer-t-taktigi.png" } }));
  return {
    embeds,
    files: [png(image, "tracer-t-taktigi.png")],
    components: strategies.length > 1 ? [select(cid("sqs", squad.id, ownerId), strategies.map((item, position) => ({ label: item.title, value: String(position), description: `${item.evidence?.samples || 0} giriş · %${item.evidence?.winRate ?? "—"} kazanma`, default: position === index })), { placeholder: "Başka taktik seç" })] : [],
    allowedMentions: { parse: [] },
  };
}

async function planPayload(app, squad, report) {
  const model = buildPlanImageModel(report, radarCalibration(squad.map));
  const image = await app.renderer.render(planCardSvg(model, squad.map));
  const message = buildPlanMessage(report, squad.roster, { withImage: true });
  return {
    embeds: message.embeds.map((item) => ({ ...item, image: { url: "attachment://tracer-takim-plani.png" } })),
    files: [png(image, "tracer-takim-plani.png")],
    components: [],
    allowedMentions: { parse: [] },
  };
}

export async function squadButton(app, interaction, [kind, squadId]) {
  const squad = app.store.getSquad(squadId);
  if (!squad) return interaction.reply({ ...errorMessage("Takım bulunamadı."), flags: EPHEMERAL });
  await interaction.deferReply();
  try {
    const { report, matches } = rebuildReport(app, squad);
    app.store.saveSquad({ ...squad, report });
    if (kind === "sqt") return interaction.editReply(await strategyPayload(app, squad, report, matches, 0, interaction.user.id));
    return interaction.editReply(await planPayload(app, squad, report));
  } catch (error) {
    return interaction.editReply(errorMessage(error.message));
  }
}

export async function strategySelect(app, interaction, [, squadId]) {
  const squad = app.store.getSquad(squadId);
  if (!squad) return interaction.reply({ ...errorMessage("Takım bulunamadı."), flags: EPHEMERAL });
  await interaction.deferUpdate();
  try {
    const { report, matches } = rebuildReport(app, squad);
    return interaction.editReply({ ...await strategyPayload(app, squad, report, matches, Number(interaction.values?.[0]) || 0, interaction.user.id), attachments: [] });
  } catch (error) {
    return interaction.followUp({ ...errorMessage(error.message), flags: EPHEMERAL });
  }
}

async function live(app, interaction, sub) {
  const { squad, error } = pickSquad(app, interaction);
  if (error) return interaction.reply({ ...infoMessage(error), flags: EPHEMERAL });
  if (sub === "durdur") {
    app.store.stopLiveSession(squad.id);
    return interaction.reply({ ...infoMessage(`**${squad.name}** canlı tahtası durduruldu.`), flags: EPHEMERAL });
  }
  if (!interaction.guildId || !interaction.guild) return interaction.reply({ ...errorMessage("Canlı tahta, botun üye olduğu bir sunucu kanalında çalışır."), flags: EPHEMERAL });
  if (!app.features.web) return interaction.reply({ ...errorMessage("Canlı tahta için botun web adresi (PUBLIC_URL) ayarlı olmalı; CS2 verisi bu adrese gelir."), flags: EPHEMERAL });
  await interaction.deferReply();
  let report;
  try {
    ({ report } = rebuildReport(app, squad));
  } catch (failure) {
    return interaction.editReply(errorMessage(failure.message));
  }
  const saved = app.store.saveSquad({ ...squad, report });
  const session = startLiveSession(saved);
  app.store.saveLiveSession({ squadId: squad.id, userId: interaction.user.id, guildId: interaction.guildId, channelId: interaction.channelId, session, active: true });
  const hasGsi = app.live.get(interaction.user.id);
  const plan = await planPayload(app, saved, report);
  plan.content = `🟢 **${squad.name}** canlı tahtası açıldı. ${interaction.user} CS2'de maça girince her round ve aşamada aşağıda tek bir mesaj güncellenecek.${hasGsi ? "" : "\n⚠️ Henüz senden CS2 verisi gelmedi: `/canli kur` ile GSI dosyanı kur ve CS2'yi yeniden başlat."}`;
  plan.components = [row(button(cid("livestop", squad.id, interaction.user.id), "Canlı tahtayı durdur", { style: STYLE.danger }))];
  return interaction.editReply(plan);
}

export async function liveStopButton(app, interaction, [, squadId, ownerId]) {
  const squad = app.store.getSquad(squadId);
  if (interaction.user.id !== ownerId && !(squad && canManage(interaction, squad))) return interaction.reply({ ...errorMessage("Tahtayı yalnız başlatan kişi durdurabilir."), flags: EPHEMERAL });
  app.store.stopLiveSession(squadId);
  return interaction.reply({ ...infoMessage("Canlı tahta durduruldu."), flags: EPHEMERAL });
}
