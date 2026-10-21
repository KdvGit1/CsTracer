// /radyo: bulunduğun ses kanalında Türk radyosu. Tek bir panel mesajı çalan istasyonu ve şarkıyı
// gösterir; istasyon değiştirme, rastgele ve durdurma düğmelerini herkes aynı panelden kullanır.
import { PermissionFlagsBits } from "discord.js";
import { RadioError } from "../../services/radio.mjs";
import { COLORS, EPHEMERAL, STYLE, button, cid, embed, errorMessage, infoMessage, row, select } from "../ui.mjs";

const RADIO_COLOR = 0xff5c8a;
const STAGE_CHANNEL = 13;
const NEEDED = [[PermissionFlagsBits.ViewChannel, "Kanalı Görüntüle"], [PermissionFlagsBits.Connect, "Bağlan"], [PermissionFlagsBits.Speak, "Konuş"]];

const escapeMarkdown = (text) => String(text).replace(/[\\*_`~|>]/g, "\\$&");
const describe = (station) => [station.tags.slice(0, 3).join(", "), station.bitrate ? `${station.bitrate} kbps` : ""].filter(Boolean).join(" · ");

function stationOptions(app, current) {
  let list = app.radio.catalog.popular(25);
  if (current && app.radio.catalog.get(current.id) && !list.some((station) => station.id === current.id)) list = [current, ...list.slice(0, 24)];
  return list.map((station) => ({ label: station.name, value: station.id, description: describe(station) || undefined, emoji: "📻", default: station.id === current?.id }));
}

function controls(app, current, { playing }) {
  const buttons = playing
    ? [button(cid("radio", "stop"), "Durdur", { emoji: "⏹️", style: STYLE.danger })]
    : current && app.radio.catalog.get(current.id) ? [button(cid("radio", "again", current.id), "Tekrar aç", { emoji: "▶️", style: STYLE.success })] : [];
  return [
    select(cid("radio", "pick"), stationOptions(app, current), { placeholder: playing ? "📻 İstasyon değiştir" : "📻 Popüler istasyonlar" }),
    row(...buttons, button(cid("radio", "random"), "Rastgele", { emoji: "🔀" })),
  ];
}

const footer = (station) => [station.codec, station.bitrate ? `${station.bitrate} kbps` : "", "İstasyonlar: Radio Browser"].filter(Boolean).join(" · ");

export function panelPayload(app, session) {
  const { station } = session;
  return {
    content: "",
    embeds: [embed({
      author: "📻 TRACER Radyo · çalıyor",
      title: station.name,
      url: station.homepage || undefined,
      description: [session.title ? `🎵 **${escapeMarkdown(session.title)}**` : "🔴 **Canlı yayın**", "", `🔊 <#${session.channelId}> · açan <@${session.startedBy}>`].join("\n"),
      thumbnail: station.favicon || undefined,
      color: RADIO_COLOR,
      footer: footer(station),
    })],
    components: controls(app, station, { playing: true }),
  };
}

export function stoppedPayload(app, session, reason) {
  return {
    content: "",
    embeds: [embed({ author: "📻 TRACER Radyo · kapalı", title: session.station.name, description: reason, thumbnail: session.station.favicon || undefined, color: COLORS.muted })],
    components: controls(app, session.station, { playing: false }),
  };
}

function pickerPayload(app, note = "") {
  return {
    content: "",
    embeds: [embed({
      author: "📻 TRACER Radyo",
      title: "Hangi radyoyu açayım?",
      description: `${note ? `${note}\n\n` : ""}Bulunduğun ses kanalına gelip çalarım. Aşağıdan seç ya da \`/radyo cal istasyon:\` yazıp adını aramaya başla.\n**${app.radio.catalog.size}** Türk radyosu hazır.`,
      color: RADIO_COLOR,
    })],
    components: controls(app, null, { playing: false }),
  };
}

/** Komutta hata yanıtı; düğmede panele dokunmadan yalnız basana görünen mesaj. */
function failWith(interaction, message, component) {
  const payload = errorMessage(message);
  if (component) return interaction.deferred || interaction.replied ? interaction.followUp({ ...payload, flags: EPHEMERAL }) : interaction.reply({ ...payload, flags: EPHEMERAL });
  return interaction.deferred ? interaction.editReply(payload) : interaction.reply({ ...payload, flags: EPHEMERAL });
}

/** Panel mesajını kanalda günceller (şarkı değişti, radyo kendiliğinden kapandı…). */
export async function refreshPanel(app, session, event = {}) {
  if (!session.panel) return;
  const payload = event.type === "stopped" ? stoppedPayload(app, session, event.reason) : panelPayload(app, session);
  try {
    const channel = await app.client.channels.fetch(session.panel.channelId);
    await channel?.messages?.edit(session.panel.messageId, payload);
  } catch { /* panel silinmiş olabilir */ }
}

async function deletePanel(app, panel) {
  try {
    const channel = await app.client.channels.fetch(panel.channelId);
    await channel?.messages?.delete(panel.messageId);
  } catch { /* zaten silinmiş */ }
}

/** Radyoyu yönetebilir mi: botla aynı kanalda olmak, kanal boşsa herkes, yetkililer her zaman. */
function canControl(app, interaction, session) {
  return interaction.member?.voice?.channelId === session.channelId
    || app.radio.listeners(interaction.guild, session.channelId) === 0
    || Boolean(interaction.memberPermissions?.has?.(PermissionFlagsBits.ManageChannels))
    || app.entitlements.isOwner(interaction.user.id);
}

async function startRadio(app, interaction, station, { component }) {
  const guild = interaction.guild;
  if (!guild) return failWith(interaction, "Radyo yalnız botun ekli olduğu sunucularda çalışır.", component);
  const channel = interaction.member?.voice?.channel;
  if (!channel) return failWith(interaction, "Önce bir ses kanalına gir, sonra tekrar dene; geldiğim kanal seninki olur.", component);
  if (channel.type === STAGE_CHANNEL) return failWith(interaction, "Sahne kanallarında çalamıyorum; normal bir ses kanalına geç.", component);
  const permissions = guild.members?.me ? channel.permissionsFor?.(guild.members.me) : null;
  const missing = permissions ? NEEDED.filter(([flag]) => !permissions.has(flag)).map(([, label]) => label) : [];
  if (missing.length) return failWith(interaction, `<#${channel.id}> kanalında iznim yok: **${missing.join(", ")}**. Sunucu ayarlarından botun rolüne bu izinleri ver.`, component);
  if (channel.full && !permissions?.has(PermissionFlagsBits.MoveMembers)) return failWith(interaction, `<#${channel.id}> dolu; bana yer kalmadı.`, component);
  const current = app.radio.session(guild.id);
  if (current && current.channelId !== channel.id && app.radio.listeners(guild, current.channelId) > 0) {
    return failWith(interaction, `Radyo şu an <#${current.channelId}> kanalında çalıyor. Oraya gel ya da oradakiler kapatınca çağır.`, component);
  }

  if (!interaction.deferred) await (component ? interaction.deferUpdate() : interaction.deferReply());
  let session;
  try {
    session = await app.radio.play({ guild, channel, station, userId: interaction.user.id });
  } catch (error) {
    if (!(error instanceof RadioError)) throw error;
    // Düğmeyle istasyon değişirken yayın açılmazsa panel "çalıyor" diye kalmasın.
    if (component && !app.radio.session(guild.id)) return interaction.editReply(stoppedPayload(app, { station }, `⚠️ ${error.message}`));
    return failWith(interaction, error.message, component);
  }
  const shownTitle = session.title;
  const message = await interaction.editReply(panelPayload(app, session));
  const previous = session.panel;
  if (message?.id) session.panel = { channelId: message.channelId || interaction.channelId, messageId: message.id };
  // Tek panel kalsın: yeni komutla açılan panel eskisinin yerini alır.
  if (previous && session.panel && previous.messageId !== session.panel.messageId) void deletePanel(app, previous);
  if (session.title !== shownTitle) void refreshPanel(app, session);
}

async function stopRadio(app, interaction, { component }) {
  const session = interaction.guild ? app.radio.session(interaction.guild.id) : null;
  if (!session) {
    if (component) return interaction.update(pickerPayload(app, "Radyo zaten kapalı."));
    return interaction.reply({ ...infoMessage("Radyo zaten kapalı."), flags: EPHEMERAL });
  }
  if (!canControl(app, interaction, session)) return failWith(interaction, `Radyoyu kapatmak için <#${session.channelId}> kanalında olmalısın.`, component);
  const reason = `⏹️ <@${interaction.user.id}> kapattı.`;
  const onPanel = component && Boolean(session.panel) && interaction.message?.id === session.panel.messageId;
  app.radio.stop(interaction.guild.id, reason, { silent: onPanel });
  if (onPanel) return interaction.update(stoppedPayload(app, session, reason));
  return interaction.reply({ ...infoMessage(`Radyo kapatıldı: **${session.station.name}**.`), flags: EPHEMERAL });
}

/** Seçilen değeri istasyona çevirir: katalog kimliği, bot sahibinin kendi bağlantısı ya da ada göre arama. */
function resolveStation(app, value, userId) {
  const text = String(value || "").trim();
  const known = app.radio.catalog.get(text);
  if (known) return known;
  if (/^https?:\/\//i.test(text)) {
    if (!app.entitlements.isOwner(userId)) throw new RadioError("Kendi yayın bağlantını yalnız bot sahibi çalabilir; listeden bir istasyon seç.");
    let url;
    try { url = new URL(text); } catch { throw new RadioError("Bu bağlantı geçerli değil."); }
    return { id: "custom", name: url.hostname, url: url.href, homepage: "", favicon: "", tags: [], codec: "", bitrate: 0, hls: /\.m3u8$/i.test(url.pathname), clicks: 0, votes: 0 };
  }
  return app.radio.catalog.search(text, 1)[0] || null;
}

async function ensureCatalog(app, interaction) {
  if (app.radio.catalog.size) {
    if (app.radio.catalog.stale()) void app.radio.catalog.refresh().catch(() => null);
    return true;
  }
  await interaction.deferReply();
  try {
    await app.radio.catalog.refresh();
    return true;
  } catch (error) {
    const detail = app.entitlements.isOwner(interaction.user.id) ? `\n\n🔧 ${error.message}` : "";
    await interaction.editReply(errorMessage(`Radyo listesini şu an alamadım (Radio Browser'a ulaşılamadı). Birazdan tekrar dene.${detail}`));
    return false;
  }
}

export async function radyo(app, interaction) {
  if (interaction.options.getSubcommand() === "dur") return stopRadio(app, interaction, { component: false });
  if (!(await ensureCatalog(app, interaction))) return;
  const value = interaction.options.getString("istasyon");
  if (!value) {
    const payload = pickerPayload(app);
    return interaction.deferred ? interaction.editReply(payload) : interaction.reply(payload);
  }
  let station;
  try {
    station = resolveStation(app, value, interaction.user.id);
  } catch (error) {
    if (error instanceof RadioError) return failWith(interaction, error.message, false);
    throw error;
  }
  if (!station) return failWith(interaction, `“${escapeMarkdown(value.slice(0, 60))}” adında bir radyo bulamadım. Yazarken çıkan listeden seç ya da \`/radyo cal\` ile popülerlere bak.`, false);
  return startRadio(app, interaction, station, { component: false });
}

export async function radioComponent(app, interaction, [, action, value]) {
  if (action === "stop") return stopRadio(app, interaction, { component: true });
  const station = action === "pick" ? app.radio.catalog.get(interaction.values?.[0])
    : action === "again" ? app.radio.catalog.get(value)
      : app.radio.catalog.random();
  if (!station) return failWith(interaction, "Bu istasyonu artık bulamıyorum; listeden başka birini seç.", true);
  return startRadio(app, interaction, station, { component: true });
}

export function radioAutocomplete(app, interaction) {
  const query = String(interaction.options.getFocused() || "");
  // Bağlantı yazılıyorsa öneri yok; Enter'a basınca yazılan bağlantı gider (yalnız bot sahibi).
  if (/^https?:\/\//i.test(query.trim())) return [];
  if (app.radio.catalog.stale()) void app.radio.catalog.refresh().catch(() => null);
  return app.radio.catalog.search(query, 25).map((station) => ({
    name: `${station.name}${station.tags.length ? ` · ${station.tags.slice(0, 2).join(", ")}` : ""}`.slice(0, 100),
    value: station.id,
  }));
}
