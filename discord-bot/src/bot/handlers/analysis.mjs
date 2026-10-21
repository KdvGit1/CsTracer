// /analiz, /kuyruk, iş düğmeleri, web yüklemesi ve "bu demoda sen hangisisin?" seçimi.
import { classifyDemoUrl } from "../../analysis/download.mjs";
import { attachPlayerToUser } from "../../analysis/pipeline.mjs";
import { isShareCode } from "../../services/steam.mjs";
import { loadAnalysis, renderMatchTab } from "../match-view.mjs";
import { STAGES } from "../../analysis/queue.mjs";
import { COLORS, EPHEMERAL, STYLE, button, cid, embed, errorMessage, infoMessage, row } from "../ui.mjs";
import { uploadMessage } from "./account.mjs";

const DEMO_NAME = /\.(dem|dem\.gz|dem\.bz2|gz|bz2)$/i;

function replyTarget(interaction) {
  return { applicationId: interaction.applicationId, token: interaction.token, createdAt: Date.now(), ephemeral: false };
}

function allowanceError(app, allowance) {
  return errorMessage(`Bugünkü ücretsiz analiz hakkın doldu (${allowance.used}/${allowance.limit}). Yarın tekrar dene ya da \`/premium\` ile sınırsız analize geç.`);
}

export async function analiz(app, interaction) {
  const attachment = interaction.options.getAttachment("dosya");
  const link = interaction.options.getString("baglanti")?.trim();
  const shareCode = interaction.options.getString("paylasim-kodu")?.trim();
  const playerHint = interaction.options.getString("oyuncu")?.trim() || null;
  const userId = interaction.user.id;

  if (!attachment && !link && !shareCode) {
    const url = app.createUploadLink(userId, { guildId: interaction.guildId, channelId: interaction.channelId, playerHint });
    return interaction.reply({ ...uploadMessage(app, url), flags: EPHEMERAL });
  }
  const allowance = app.entitlements.analysisAllowance({ userId, guildId: interaction.guildId, interaction });
  if (!allowance.ok) return interaction.reply({ ...allowanceError(app, allowance), flags: EPHEMERAL });

  let source;
  let dedupeKey = null;
  if (attachment) {
    if (!DEMO_NAME.test(attachment.name || "")) return interaction.reply({ ...errorMessage("Ek bir CS2 demosu olmalı (.dem, .dem.gz veya .dem.bz2)."), flags: EPHEMERAL });
    if (attachment.size > app.config.maxDemoMb * 1024 * 1024) return interaction.reply({ ...errorMessage(`Dosya ${app.config.maxDemoMb} MB sınırını aşıyor.`), flags: EPHEMERAL });
    source = { type: "url", url: attachment.url, fileName: attachment.name };
    dedupeKey = `att:${attachment.id}`;
  } else if (shareCode) {
    if (!isShareCode(shareCode)) return interaction.reply({ ...errorMessage("Paylaşım kodu CSGO-xxxxx-xxxxx-xxxxx-xxxxx-xxxxx biçiminde olmalı."), flags: EPHEMERAL });
    if (!app.steam.canResolveShareCodes()) {
      const url = app.createUploadLink(userId, { guildId: interaction.guildId, channelId: interaction.channelId, playerHint });
      // Bot sahibine neyin eksik olduğunu açıkça söyle; diğerlerine yalnız ne yapabileceklerini.
      const ownerNote = app.entitlements.isOwner(userId) ? `\n\n🔧 **Bot sahibi olarak sana:** ${app.steam.shareCodeBlocker()}` : "";
      return interaction.reply({ ...infoMessage(`Bu botta paylaşım kodundan otomatik demo indirme kapalı. CS2'de **İzle → Maçlarım** bölümünden demoyu indirip yükleyebilirsin.${ownerNote}`, { components: url ? uploadMessage(app, url).components : [] }), flags: EPHEMERAL });
    }
    source = { type: "sharecode", shareCode };
    dedupeKey = `sc:${shareCode}`;
  } else {
    const classified = classifyDemoUrl(link);
    if (!classified) return interaction.reply({ ...errorMessage("Bu bağlantıdan demo indiremem. Valve replay (replayNNN.valve.net/730/...dem.bz2), FACEIT demo bağlantısı veya Discord eki gönder."), flags: EPHEMERAL });
    source = { type: "url", url: classified.url, fileName: new URL(classified.url).pathname.split("/").pop() };
    dedupeKey = `url:${classified.url.split("?")[0]}`;
  }

  await interaction.deferReply();
  const { job, duplicate, position } = app.queue.enqueue({
    userId,
    guildId: interaction.guildId,
    channelId: interaction.channelId,
    source,
    reply: replyTarget(interaction),
    playerHint,
    dedupeKey,
  });
  if (duplicate) return interaction.editReply(infoMessage(`Bu demo zaten kuyrukta (iş #${job?.id}). Bitince haber vereceğim.`));
  app.entitlements.recordAnalysis(userId);
  return interaction.editReply({
    embeds: [embed({ title: "Analiz sıraya alındı", description: `⏳ ${STAGES.queued} — sıradaki **${position}.** iş.\nTam bir maçın analizi 1–4 dakika sürer. Bu mesaj güncellenecek.`, color: COLORS.info, footer: `İş #${job.id}` })],
    components: [row(button(cid("job", "cancel", job.id, userId), "İptal et", { style: STYLE.danger }))],
  });
}

/** Web'den yüklenen dosya için iş oluşturur (WebServer.onUpload kancası). */
export function uploadHook(app) {
  return async ({ token, path, size, fileName, lastModified }) => {
    const userId = token.user_id;
    const allowance = app.entitlements.analysisAllowance({ userId, guildId: token.data?.guildId });
    if (!allowance.ok) throw new Error(`Bugünkü ücretsiz analiz hakkın doldu (${allowance.used}/${allowance.limit}).`);
    const { job, position } = app.queue.enqueue({
      userId,
      guildId: token.data?.guildId || null,
      channelId: token.data?.channelId || null,
      source: { type: "file", path, fileName, lastModified, size },
      reply: { dm: true },
      playerHint: token.data?.playerHint || null,
    });
    app.entitlements.recordAnalysis(userId);
    await app.sendDm(userId, infoMessage(`📥 **${fileName || "Demo"}** yüklendi (${Math.round(size / 1024 / 1024)} MB). Sıradaki ${position}. iş; bitince buradan haber vereceğim.`, { components: [row(button(cid("job", "cancel", job.id, userId), "İptal et", { style: STYLE.danger }))] }));
    return { message: `Yüklendi! Sıradaki ${position}. iş. Analiz bitince Discord'dan DM ile haber vereceğim.` };
  };
}

export async function kuyruk(app, interaction) {
  const jobs = app.store.activeJobsForUser(interaction.user.id);
  const total = app.store.queueLength();
  if (!jobs.length) return interaction.reply({ ...infoMessage(`Bekleyen analizin yok. Kuyrukta toplam ${total} iş var.`), flags: EPHEMERAL });
  const lines = jobs.map((job) => `**#${job.id}** · ${job.source?.fileName || job.source?.shareCode || job.source?.type} · ${job.status === "running" ? `🔄 ${STAGES[job.progress] || "işleniyor"}` : `⏳ sırada (${app.store.queuePosition(job.id)}.)`}`);
  return interaction.reply({
    embeds: [embed({ title: "Analizlerin", description: lines.join("\n"), color: COLORS.info, footer: `Kuyrukta toplam ${total} iş` })],
    components: [row(...jobs.slice(0, 5).map((job) => button(cid("job", "cancel", job.id, interaction.user.id), `#${job.id} iptal`, { style: STYLE.danger })))],
    flags: EPHEMERAL,
  });
}

export async function jobButton(app, interaction, [, action, jobId, ownerId]) {
  if (interaction.user.id !== ownerId) return interaction.reply({ ...errorMessage("Bu iş sana ait değil."), flags: EPHEMERAL });
  if (action === "cancel") {
    const ok = app.queue.cancel(jobId, ownerId);
    return interaction.reply({ ...infoMessage(ok ? `İş #${jobId} iptal edildi.` : `İş #${jobId} zaten bitmiş veya bulunamadı.`), flags: EPHEMERAL });
  }
  if (action === "retry") {
    const job = app.store.getJob(jobId);
    if (!job || !["url", "sharecode", "faceit"].includes(job.source?.type)) return interaction.reply({ ...errorMessage("Bu iş tekrar denenemez; dosyayı yeniden gönder."), flags: EPHEMERAL });
    await interaction.deferReply();
    const result = app.queue.enqueue({ userId: ownerId, guildId: interaction.guildId, channelId: interaction.channelId, source: job.source, reply: replyTarget(interaction), playerHint: job.player_hint, dedupeKey: job.dedupe_key });
    return interaction.editReply(infoMessage(result.duplicate ? "Bu demo zaten kuyrukta." : `Tekrar sıraya alındı (iş #${result.job.id}, sıradaki ${result.position}.).`));
  }
  return undefined;
}

/** "Bu demoda sen hangisisin?" — seçimi hatırlar ve SteamID'yi (doğrulanmamış) bağlar. */
export async function pickPlayer(app, interaction, [, matchId, ownerId]) {
  if (interaction.user.id !== ownerId) return interaction.reply({ ...errorMessage("Bu seçim maçı analiz ettirene ait."), flags: EPHEMERAL });
  const steamid = interaction.values?.[0];
  const match = app.store.getMatch(matchId);
  const analysis = match ? loadAnalysis(match) : null;
  if (!match || !analysis || !steamid) return interaction.reply({ ...errorMessage("Maç bulunamadı."), flags: EPHEMERAL });
  await interaction.deferUpdate();
  const report = attachPlayerToUser({ store: app.store, match, analysis, userId: ownerId, steamid });
  const user = app.store.getUser(ownerId);
  let linked = false;
  if (report && !user.steam_id) {
    try { app.store.claimSteamId(ownerId, steamid, { verified: false }); linked = true; } catch { linked = false; }
  }
  const payload = await renderMatchTab({ renderer: app.renderer, storedMatch: match, ownerId, viewer: { steamid, name: report?.player?.name }, tab: "o" });
  payload.content = `👍 **${report?.player?.name || steamid}** olarak kaydettim.${linked ? " Bu SteamID'yi hesabına bağladım; `/hesap dogrula` ile doğrulayabilirsin." : ""}`;
  return interaction.editReply({ ...payload, attachments: [] });
}

/** Maç raporunu sunucunun rapor kanalına elle gönder. */
export async function shareButton(app, interaction, [, matchId, ownerId]) {
  if (!interaction.guildId) return interaction.reply({ ...errorMessage("Paylaşmak için bu düğmeyi bir sunucuda kullan."), flags: EPHEMERAL });
  if (interaction.user.id !== ownerId) return interaction.reply({ ...errorMessage("Yalnız maçın sahibi paylaşabilir."), flags: EPHEMERAL });
  const guild = app.store.getGuild(interaction.guildId);
  if (!guild?.report_channel_id) return interaction.reply({ ...errorMessage("Bu sunucuda rapor kanalı ayarlanmamış. Yöneticiler `/sunucu kur` ile ayarlayabilir."), flags: EPHEMERAL });
  const added = app.reporter.enqueueForGuild(guild, matchId, ownerId);
  return interaction.reply({ ...infoMessage(added ? `📣 Rapor <#${guild.report_channel_id}> kanalına gönderiliyor.` : "Bu maç bu sunucuda zaten paylaşılmış."), flags: EPHEMERAL });
}
