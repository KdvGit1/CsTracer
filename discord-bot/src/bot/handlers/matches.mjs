// /maclar (filtreli maç kütüphanesi) ve /mac (sekmeli maç analizi).
import { randomBytes } from "node:crypto";
import { fmt, mapLabel } from "../../render/svg.mjs";
import { renderMatchTab } from "../match-view.mjs";
import { COLORS, EPHEMERAL, STYLE, button, cid, embed, errorMessage, infoMessage, resultEmoji, row, select } from "../ui.mjs";

const PAGE = 10;
const SOURCE_LABEL = { steam: "Steam", faceit: "FACEIT", upload: "Demo" };
const filterMemory = new Map();

function rememberFilters(filters) {
  const key = randomBytes(4).toString("hex");
  filterMemory.set(key, filters);
  if (filterMemory.size > 2000) filterMemory.delete(filterMemory.keys().next().value);
  return key;
}

function libraryPayload(app, ownerId, filters, page, key) {
  const total = app.store.countUserMatches(ownerId, filters);
  const pages = Math.max(1, Math.ceil(total / PAGE));
  const current = Math.max(0, Math.min(page, pages - 1));
  const rows = app.store.userMatches(ownerId, { ...filters, limit: PAGE, offset: current * PAGE });
  const active = [filters.map && mapLabel(filters.map), filters.result && { W: "Galibiyet", L: "Mağlubiyet", T: "Beraberlik" }[filters.result], filters.source && SOURCE_LABEL[filters.source], filters.search && `“${filters.search}”`, filters.sort === "oldest" && "en eski önce"].filter(Boolean).join(" · ");
  if (!rows.length) {
    return infoMessage(total ? "Bu sayfada maç yok." : `Bu filtrelerle maç bulunamadı${active ? ` (${active})` : ""}. Yeni maç için \`/analiz\`.`, { title: "Maç kütüphanen" });
  }
  const lines = rows.map((item, index) => {
    const kda = item.kills === null ? "—" : `${item.kills}/${item.deaths}/${item.assists}`;
    const kast = Number.isFinite(Number(item.kast)) ? `KAST %${fmt.number(item.kast, 0)}` : "KAST —";
    const score = item.user_score === null ? "" : ` ${item.user_score}-${item.enemy_score}`;
    return `\`${String(current * PAGE + index + 1).padStart(2, " ")}\` ${resultEmoji(item.result)} **${mapLabel(item.map)}**${score} · ${kda} · ADR ${fmt.number(item.adr, 0)} · ${kast} · ${SOURCE_LABEL[item.source] || item.source} · ${item.played_at ? fmt.date(item.played_at, "short") : "tarih ?"}${item.analysis_file ? "" : " · 🗄️"}`;
  });
  return {
    embeds: [embed({ title: `Maç kütüphanen · ${total} maç`, description: `${active ? `Filtre: ${active}\n\n` : ""}${lines.join("\n")}`, color: COLORS.accent, footer: `Sayfa ${current + 1}/${pages} · 🗄️ ayrıntılı analiz arşivden kaldırılmış` })],
    components: [
      select(cid("libopen", ownerId), rows.map((item) => ({ label: `${mapLabel(item.map)} ${item.user_score ?? ""}-${item.enemy_score ?? ""} · ${item.played_at ? fmt.date(item.played_at, "short") : "?"}`, value: item.match_id, description: `${item.player_name} · ${item.kills ?? "—"}/${item.deaths ?? "—"}/${item.assists ?? "—"}`, emoji: resultEmoji(item.result) })), { placeholder: "Maçı aç" }),
      row(
        button(cid("lib", ownerId, key, current - 1), "Önceki", { emoji: "◀️", disabled: current === 0 }),
        button(cid("lib", ownerId, key, current + 1), "Sonraki", { emoji: "▶️", disabled: current >= pages - 1 }),
      ),
    ],
    files: [],
  };
}

export async function maclar(app, interaction) {
  const filters = {
    map: interaction.options.getString("harita") || "",
    result: interaction.options.getString("sonuc") || "",
    source: interaction.options.getString("kaynak") || "",
    sort: interaction.options.getString("sirala") || "newest",
    search: interaction.options.getString("ara")?.trim() || "",
  };
  const key = rememberFilters(filters);
  return interaction.reply({ ...libraryPayload(app, interaction.user.id, filters, 0, key), flags: EPHEMERAL });
}

export async function libraryPage(app, interaction, [, ownerId, key, page]) {
  if (interaction.user.id !== ownerId) return interaction.reply({ ...errorMessage("Bu liste başkasına ait; kendi maçların için `/maclar`."), flags: EPHEMERAL });
  const filters = filterMemory.get(key) || {};
  return interaction.update(libraryPayload(app, ownerId, filters, Number(page) || 0, key));
}

export async function libraryOpen(app, interaction, [, ownerId]) {
  const matchId = interaction.values?.[0];
  // Kütüphane kişiseldir; açılan maç da yalnız sana görünür (herkese göstermek için /mac).
  return openMatch(app, interaction, matchId, { ownerId, tab: "o", ephemeral: true, newMessage: true });
}

/** Maçı açar. newMessage: yeni mesaj olarak gönder; değilse mevcut mesajı güncelle. */
export async function openMatch(app, interaction, matchId, { ownerId = interaction.user.id, tab = "o", duel = {}, newMessage = false, ephemeral = false } = {}) {
  const match = app.store.getMatch(matchId);
  if (!match) return interaction.reply({ ...errorMessage("Maç bulunamadı."), flags: EPHEMERAL });
  if (app.throttled(interaction.user.id, 1200)) return interaction.reply({ ...infoMessage("Biraz yavaş 🙂 Bir saniye sonra tekrar dene."), flags: EPHEMERAL });
  // Başkasının mesajındaki düğmeye basan kişi kendi gözünden, kendine özel kopya görür.
  const viewerId = interaction.user.id;
  const sameOwner = viewerId === ownerId;
  const viewer = app.viewerFor(sameOwner ? ownerId : viewerId, matchId);
  const effectiveViewer = viewer.steamid ? viewer : app.viewerFor(ownerId, matchId);
  if (newMessage || !sameOwner) await interaction.deferReply({ flags: ephemeral || !sameOwner ? EPHEMERAL : undefined });
  else await interaction.deferUpdate();
  const payload = await renderMatchTab({ renderer: app.renderer, storedMatch: match, ownerId: sameOwner ? ownerId : viewerId, viewer: effectiveViewer, tab, duel });
  if (sameOwner) app.store.updateUser(ownerId, { last_match_id: matchId });
  return interaction.editReply({ ...payload, attachments: [] });
}

export async function matchTab(app, interaction, [, tab, matchId, ownerId]) {
  return openMatch(app, interaction, matchId, { ownerId, tab });
}

export async function duelNav(app, interaction, [, matchId, ownerId, index, filter, all]) {
  return openMatch(app, interaction, matchId, { ownerId, tab: "d", duel: { index: Number(index), filter, all: all === "1" } });
}

export async function duelJump(app, interaction, [, matchId, ownerId, filter, all]) {
  return openMatch(app, interaction, matchId, { ownerId, tab: "d", duel: { index: Number(interaction.values?.[0] || 0), filter, all: all === "1" } });
}

export async function duelFilter(app, interaction, [, matchId, ownerId]) {
  return openMatch(app, interaction, matchId, { ownerId, tab: "d", duel: { index: 0, filter: interaction.values?.[0] || "all", all: false } });
}

export async function mac(app, interaction, ctx) {
  const requested = interaction.options.getString("mac");
  const user = ctx.user;
  const matchId = requested || user.last_match_id || app.store.userMatches(user.id, { limit: 1 })[0]?.match_id;
  if (!matchId) return interaction.reply({ ...infoMessage("Henüz analiz edilmiş maçın yok. `/analiz` ile başla."), flags: EPHEMERAL });
  return openMatch(app, interaction, matchId, { ownerId: user.id, tab: "o", newMessage: true });
}

/** /mac ve /koc otomatik tamamlama: kullanıcının son maçları. */
export function matchAutocomplete(app, interaction) {
  const query = String(interaction.options.getFocused() || "").toLocaleLowerCase("tr-TR");
  const rows = app.store.userMatches(interaction.user.id, { limit: 50 });
  return rows
    .map((item) => ({ name: `${resultEmoji(item.result)} ${mapLabel(item.map)} ${item.user_score ?? ""}-${item.enemy_score ?? ""} · ${item.kills ?? "—"}/${item.deaths ?? "—"}/${item.assists ?? "—"} · ${item.played_at ? fmt.date(item.played_at, "short") : "tarih ?"}`, value: item.match_id }))
    .filter((choice) => !query || choice.name.toLocaleLowerCase("tr-TR").includes(query))
    .slice(0, 25);
}

export { STYLE };
