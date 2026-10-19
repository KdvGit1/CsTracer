// Uygulama çekirdeği: servisleri bir araya getirir, analiz sonuçlarını doğru
// yere (etkileşim yanıtı → DM → sunucu rapor kanalı) ulaştırır.
import { WebhookClient } from "discord.js";
import { buildDiscordReportImageModel, sampleReportImageModel } from "../../engine/companion/discord_reporter.mjs";
import { normalizeSteamId } from "../../engine/companion/squad/identity.mjs";
import { reportMatch } from "../analysis/pipeline.mjs";
import { STAGES } from "../analysis/queue.mjs";
import { logger, redact } from "../log.mjs";
import { matchReportSvg } from "../render/cards/match-report.mjs";
import { mapLabel } from "../render/svg.mjs";
import { hashToken, randomToken } from "../secrets.mjs";
import { forgetAnalysis, loadAnalysis, playerPicker, renderMatchTab } from "./match-view.mjs";
import { COLORS, EPHEMERAL, RESULT_TEXT, STYLE, button, cid, embed, png, resultColor, row } from "./ui.mjs";

const log = logger("app");
const INTERACTION_TTL_MS = 14 * 60 * 1000;

export class App {
  constructor(services) {
    Object.assign(this, services);
    this.cooldowns = new Map();
    this.liveEdits = new Map();
  }

  // ---------- Hatırlama ----------

  remember(interaction) {
    const user = interaction.user;
    const name = interaction.member?.displayName || user.globalName || user.username;
    const { user: row, previous } = this.store.touchUser(user.id, name);
    if (interaction.guildId) {
      if (interaction.guild) this.store.touchGuild(interaction.guildId, interaction.guild.name);
      else if (!this.store.getGuild(interaction.guildId)) this.store.touchGuild(interaction.guildId, "");
      this.store.touchMember(interaction.guildId, user.id);
    }
    return { user: row, previous };
  }

  /** Ağır işler (görsel üretimi) için kullanıcı başına kısa bekleme. */
  throttled(userId, ms = 2500) {
    const now = Date.now();
    const last = this.cooldowns.get(userId) || 0;
    if (now - last < ms) return true;
    this.cooldowns.set(userId, now);
    if (this.cooldowns.size > 5000) this.cooldowns.clear();
    return false;
  }

  avatarUrl(discordUser) {
    try { return discordUser?.displayAvatarURL?.({ extension: "png", size: 256, forceStatic: true }) || ""; } catch { return ""; }
  }

  /** Bir maçı kimin gözünden göstereceğimiz: kullanıcının o maçtaki kaydı, yoksa bağlı SteamID'si. */
  viewerFor(userId, matchId) {
    const personal = this.store.userMatch(userId, matchId);
    if (personal?.steam_id) return { steamid: personal.steam_id, name: personal.player_name };
    const user = this.store.getUser(userId);
    return user?.steam_id ? { steamid: user.steam_id, name: "" } : {};
  }

  // ---------- Tek kullanımlık bağlantılar ----------

  createUploadLink(userId, context = {}) {
    if (!this.features.web) return null;
    const token = randomToken(24);
    this.store.revokeTokens(userId, "upload");
    this.store.saveToken({ tokenHash: hashToken(token), kind: "upload", userId, data: context, ttlMs: 60 * 60 * 1000 });
    return this.web.url(`/yukle/${token}`);
  }

  createSteamLoginLink(userId) {
    if (!this.features.web) return null;
    const token = randomToken(24);
    this.store.revokeTokens(userId, "steam-login");
    this.store.saveToken({ tokenHash: hashToken(token), kind: "steam-login", userId, ttlMs: 15 * 60 * 1000 });
    return this.web.url(`/steam/${token}`);
  }

  // ---------- Mesaj teslimi ----------

  async sendDm(userId, payload) {
    const user = this.store.getUser(userId);
    if (user && user.settings.dmNotify === false) return false;
    try {
      const discordUser = await this.client.users.fetch(userId);
      await discordUser.send(payload);
      return true;
    } catch (error) {
      log.debug(`DM gönderilemedi (${userId}): ${redact(error?.message)}`);
      return false;
    }
  }

  /** İşi başlatan etkileşimin orijinal yanıtını düzenler (15 dk içinde). */
  async editInteraction(reply, payload) {
    if (!reply?.token || !reply?.applicationId || Date.now() - Number(reply.createdAt || 0) > INTERACTION_TTL_MS) return false;
    const webhook = new WebhookClient({ id: reply.applicationId, token: reply.token });
    try {
      await webhook.editMessage("@original", payload);
      return true;
    } catch (error) {
      log.debug(`Etkileşim yanıtı düzenlenemedi: ${redact(error?.message)}`);
      return false;
    } finally {
      webhook.destroy();
    }
  }

  async followUp(reply, payload) {
    if (!reply?.token || !reply?.applicationId || Date.now() - Number(reply.createdAt || 0) > INTERACTION_TTL_MS) return false;
    const webhook = new WebhookClient({ id: reply.applicationId, token: reply.token });
    try {
      await webhook.send({ ...payload, flags: reply.ephemeral ? EPHEMERAL : undefined });
      return true;
    } catch {
      return false;
    } finally {
      webhook.destroy();
    }
  }

  async deliverJobMessage(job, payload) {
    if (job.reply?.token && await this.editInteraction(job.reply, payload)) return "interaction";
    if (await this.sendDm(job.user_id, payload)) return "dm";
    return "none";
  }

  // ---------- Kuyruk kancaları ----------

  queueHooks() {
    return {
      onProgress: async (job, stage) => {
        if (!job.reply?.token || job.reply.auto) return;
        const position = stage === "queued" ? ` (sıradaki ${this.store.queuePosition(job.id)}.)` : "";
        await this.editInteraction(job.reply, {
          embeds: [embed({ title: "Analiz sürüyor", description: `⏳ ${STAGES[stage] || stage}${position}\nBitince bu mesaj güncellenecek; uzun sürerse DM'den haber veririm.`, color: COLORS.info, footer: `İş #${job.id}` })],
          components: [row(button(cid("job", "cancel", job.id, job.user_id), "İptal et", { style: STYLE.danger }))],
          files: [],
        });
      },
      onDone: async (job, result) => this.onJobDone(job, result),
      onFailed: async (job, { message }) => {
        const retry = ["url", "sharecode", "faceit"].includes(job.source?.type);
        const components = retry ? [row(button(cid("job", "retry", job.id, job.user_id), "Tekrar dene", { emoji: "🔁" }))] : [];
        const tip = job.source?.type === "file" ? "\nYeni yükleme bağlantısı için `/analiz` yaz." : "";
        await this.deliverJobMessage(job, { embeds: [embed({ title: job.reply?.auto ? "Otomatik analiz yapılamadı" : "Analiz yapılamadı", description: `⚠️ ${message}${tip}`, color: COLORS.error, footer: `İş #${job.id}` })], components, files: [] });
      },
    };
  }

  async onJobDone(job, result) {
    const match = this.store.getMatch(job.match_id);
    if (!match) return;
    forgetAnalysis(match.id);
    this.store.updateUser(job.user_id, { last_match_id: match.id });
    const viewer = this.viewerFor(job.user_id, match.id);
    const payload = await renderMatchTab({ renderer: this.renderer, storedMatch: match, ownerId: job.user_id, viewer, tab: "o" });
    const intro = job.reply?.auto ? "🆕 Yeni maçın otomatik analiz edildi." : result.reused ? "♻️ Bu demo daha önce analiz edilmişti; hazır sonucu gösteriyorum." : "✅ Analiz tamamlandı.";
    const others = (result.participants || []).filter((item) => !item.isRequester).length;
    const extra = others ? ` Demodaki ${others} bağlı oyuncunun geçmişine de eklendi.` : "";
    payload.content = `${intro}${extra}`;
    if (result.needsPlayerChoice) {
      const analysis = loadAnalysis(match);
      payload.content += this.store.getUser(job.user_id)?.steam_id
        ? "\nBağlı Steam hesabın bu demoda yok, bu yüzden maçı geçmişine eklemedim. Başka bir hesapla oynadıysan aşağıdan kendini seç."
        : "\nBu demoda hangi oyuncu olduğunu bilmiyorum — aşağıdan seçersen hem bu maçı geçmişine eklerim hem de bir dahakine seni tanırım.";
      if (analysis) payload.components = [playerPicker(match, analysis, job.user_id), ...payload.components].slice(0, 5);
    }
    await this.deliverJobMessage(job, payload);
    await this.shareToGuilds(match, result, job);
  }

  /** Maçı ilgili sunucuların rapor kanallarına kuyruğa alır. */
  async shareToGuilds(match, result, job) {
    const targets = new Map();
    const userIds = new Set([job.user_id, ...(result.participants || []).map((item) => item.userId)]);
    for (const userId of userIds) {
      const user = this.store.getUser(userId);
      if (!user || user.settings.publicProfile === false) continue;
      for (const guild of this.store.guildsOfUser(userId)) {
        if (!guild.report_channel_id || !guild.auto_report) continue;
        if (!targets.has(guild.id)) targets.set(guild.id, { guild, userId });
      }
    }
    for (const { guild, userId } of targets.values()) this.reporter.enqueueForGuild(guild, match.id, userId);
  }

  /** Outbox öğesinden sunucu kanalı mesajı (görsel + rol etiketi). */
  async guildReportPayload(item) {
    const match = this.store.getMatch(item.match_id);
    const guild = this.store.getGuild(item.guild_id);
    if (!match) throw Object.assign(new Error("Maç kaydı bulunamadı"), { permanent: true });
    const analysis = loadAnalysis(match);
    if (!analysis) throw Object.assign(new Error("Analiz dosyası bulunamadı"), { permanent: true });
    const viewer = item.user_id ? this.viewerFor(item.user_id, match.id) : {};
    const view = reportMatch(match, analysis, viewer);
    const model = buildDiscordReportImageModel(view, viewer?.steamid ? viewer : view.userStats);
    const image = await this.renderer.render(matchReportSvg(model));
    const role = /^\d{16,22}$/.test(String(guild?.notify_role_id || "")) ? guild.notify_role_id : "";
    const mention = item.user_id ? `<@${item.user_id}>` : "";
    const result = view.score ? (view.score.isTie ? "T" : view.score.isWin ? "W" : "L") : "";
    return {
      threadName: model.title.slice(0, 100),
      message: {
        content: [role ? `<@&${role}>` : "", mention ? `${mention} yeni maç raporu hazır.` : "Yeni TRACER maç raporu hazır."].filter(Boolean).join(" "),
        allowedMentions: { parse: [], roles: role ? [role] : [], users: [] },
        embeds: [embed({
          author: "TRACER · CS2 MAÇ SONU",
          title: model.title,
          description: "Bizim takım ayrıntılı, rakip takım kısa özet halinde tek görselde. Ayrıntılar için `/mac`.",
          color: resultColor(result),
          image: "attachment://tracer-mac.png",
          footer: "KAST profesyonel rating değildir; round katkısıdır.",
        })],
        files: [png(image, "tracer-mac.png")],
      },
    };
  }

  async sampleReportImage() {
    return this.renderer.render(matchReportSvg(sampleReportImageModel()));
  }

  // ---------- Takip bildirimleri ----------

  async trackerNotify(user, event) {
    if (event.kind === "steam-new") {
      const lines = event.codes.map((code) => `\`${code}\``).join("\n");
      await this.sendDm(user.id, { embeds: [embed({
        title: `${event.codes.length} yeni Steam maçın var`,
        description: `${lines}\n\nBu botta paylaşım kodundan otomatik demo indirme kapalı. CS2 → İzle → Maçlarım'dan demoyu indirip \`/analiz\` ile yükleyebilirsin.`,
        color: COLORS.info,
      })] });
    } else if (event.kind === "faceit-new") {
      const matches = event.ids.map((id) => this.store.faceitMatch(id)).filter(Boolean);
      const lines = matches.map((match) => `${match.score?.isTie ? "🟡" : match.score?.isWin ? "🟢" : "🔴"} **${mapLabel(match.map)}** ${match.score?.rawScore || "—"}${match.statsAvailable ? ` · ${match.userStats?.kills}/${match.userStats?.deaths}/${match.userStats?.assists} · ADR ${match.userStats?.adr ?? "—"}` : ""} · [maç odası](${match.faceitUrl})`);
      await this.sendDm(user.id, { embeds: [embed({
        title: "Yeni FACEIT maçların",
        description: `${lines.join("\n")}\n\nTam analiz (tepki, düello, T tarafı) için maç odasından demoyu indirip \`/analiz\` ile gönder.`,
        color: COLORS.faceit,
      })] });
    } else if (event.kind === "error") {
      await this.sendDm(user.id, { embeds: [embed({ title: "Otomatik takip durdu", description: `⚠️ ${event.message}`, color: COLORS.error })] });
    }
  }

  // ---------- Canlı takım tahtası ----------

  async updateLiveBoards(userId, gsi, { reconcileLiveSession, roundMessageKey, buildRoundMessage }) {
    for (const live of this.store.liveSessionsForUser(userId)) {
      const squad = this.store.getSquad(live.squad_id);
      if (!squad?.report) continue;
      const session = reconcileLiveSession(live.session, squad.report, gsi);
      const key = roundMessageKey(session);
      // Discord hız sınırı için aynı tahta en fazla 2,5 sn'de bir düzenlenir; değişiklik kaçmaz,
      // anahtar kaydedilmediği için sonraki pakette yeniden denenir.
      const due = key !== live.message_key && Date.now() - Number(this.liveEdits.get(live.squad_id) || 0) > 2500;
      if (due) this.liveEdits.set(live.squad_id, Date.now());
      this.store.saveLiveSession({ squadId: live.squad_id, userId, guildId: live.guild_id, channelId: live.channel_id, roundMessageId: live.round_message_id, session, messageKey: due ? key : live.message_key });
      if (!due) continue;
      try {
        const channel = await this.client.channels.fetch(live.channel_id);
        const message = buildRoundMessage(squad.report, session);
        const body = { content: "", embeds: message.embeds, allowedMentions: { parse: [] } };
        if (live.round_message_id) await channel.messages.edit(live.round_message_id, body);
        else {
          const sent = await channel.send(body);
          this.store.saveLiveSession({ squadId: live.squad_id, userId, guildId: live.guild_id, channelId: live.channel_id, roundMessageId: sent.id, session, messageKey: key });
        }
      } catch (error) {
        log.warn(`Canlı tahta güncellenemedi (${live.squad_id}): ${redact(error?.message)}`);
        if ([10003, 10008, 50001, 50013].includes(Number(error?.code))) this.store.stopLiveSession(live.squad_id);
      }
    }
  }

  steamIdOf(userId) {
    return normalizeSteamId(this.store.getUser(userId)?.steam_id);
  }

  resultLabel(result) {
    return RESULT_TEXT[result] || "—";
  }
}
