// Sunucu kanallarına maç raporu gönderen kalıcı kutu (outbox). Masaüstündeki
// DiscordReporter ile aynı kurallar: aynı maç aynı sunucuya ikinci kez
// gönderilmez, geçici hatalarda artan aralıklarla yeniden denenir, silinmiş
// kanal veya yetki hatalarında saldırgan tekrar döngüsüne girilmez.
import { logger } from "../log.mjs";

const log = logger("reporter");
const MAX_RETRY_MS = 6 * 60 * 60 * 1000;
const MAX_ATTEMPTS = 12;
// Discord: Unknown Channel, Missing Access, Missing Permissions, Unknown Guild, Cannot send messages in a non-text channel.
const PERMANENT_CODES = new Set([10003, 10004, 50001, 50013, 50008, 160002]);

export function retryDelay(attempts) {
  return Math.min(MAX_RETRY_MS, Math.max(15_000, 15_000 * 2 ** Math.min(10, attempts)));
}

export class Reporter {
  constructor({ store, client, buildPayload, now = () => Date.now() }) {
    this.store = store;
    this.client = client;
    this.buildPayload = buildPayload;
    this.now = now;
    this.timer = null;
    this.processing = false;
  }

  start(intervalMs = 15_000) {
    this.timer = setInterval(() => void this.flush(), intervalMs);
    this.timer.unref?.();
    void this.flush();
  }

  stop() {
    clearInterval(this.timer);
  }

  /** Maçı sunucunun rapor kanalı için kuyruğa alır. Aynı maç tekrar eklenmez. */
  enqueueForGuild(guild, matchId, userId) {
    if (!guild?.report_channel_id) return false;
    const added = this.store.enqueueOutbox({ guildId: guild.id, channelId: guild.report_channel_id, threadId: guild.report_thread_id, matchId, userId });
    if (added) void this.flush();
    return added;
  }

  async resolveChannel(item) {
    const channel = await this.client.channels.fetch(item.thread_id || item.channel_id);
    if (!channel) throw Object.assign(new Error("Kanal bulunamadı"), { code: 10003 });
    return channel;
  }

  async deliver(item) {
    const channel = await this.resolveChannel(item);
    const payload = await this.buildPayload(item);
    // Forum kanalında her maç için yeni gönderi açılır.
    if (channel.type === 15) {
      await channel.threads.create({ name: payload.threadName || "TRACER maç raporu", message: { ...payload.message } });
      return;
    }
    await channel.send(payload.message);
  }

  async flush() {
    if (this.processing) return;
    this.processing = true;
    try {
      for (const item of this.store.dueOutbox(5)) {
        try {
          await this.deliver(item);
          this.store.updateOutbox(item.id, { status: "sent", error: null });
        } catch (error) {
          const code = Number(error?.code || error?.rawError?.code || 0);
          const status = Number(error?.status || 0);
          const permanent = PERMANENT_CODES.has(code) || status === 403 || status === 404 || error?.permanent;
          const attempts = Number(item.attempts) + 1;
          const message = String(error?.message || error).slice(0, 300);
          if (permanent || attempts >= MAX_ATTEMPTS) {
            this.store.updateOutbox(item.id, { status: "failed", attempts, error: permanent ? `Kalıcı hata: ${message}` : message });
            log.warn(`Rapor gönderilemedi (sunucu ${item.guild_id}, maç ${item.match_id}): ${message}`);
          } else {
            const retryAfter = Number(error?.retryAfter || error?.rawError?.retry_after || 0) * 1000;
            this.store.updateOutbox(item.id, { attempts, next_attempt_at: this.now() + Math.max(retryAfter, retryDelay(attempts)), error: message });
          }
        }
      }
    } finally {
      this.processing = false;
    }
  }
}
