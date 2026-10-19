// Otomatik maç takibi: bağlı Steam (resmî paylaşım kodu API'si) ve FACEIT
// hesaplarını düzenli aralıkla tarar, yeni maçları analiz kuyruğuna alır ya da
// otomatik indirme mümkün değilse kullanıcıya haber verir. CS2 GSI "maç bitti"
// sinyali gelirse ilgili kullanıcı birkaç dakika sonra öncelikli taranır.
import { logger } from "../log.mjs";
import { decrypt } from "../secrets.mjs";

const log = logger("tracker");
const BATCH = 10;
const MAX_NEW_PER_RUN = 3;

export class Tracker {
  constructor({ store, config, steam, faceit, queue, entitlements, secretKey, notify, now = () => Date.now() }) {
    Object.assign(this, { store, config, steam, faceit, queue, entitlements, secretKey, notify, now });
    this.timer = null;
    this.soon = new Map();
    this.running = false;
  }

  start() {
    this.timer = setInterval(() => void this.cycle(), 60_000);
    this.timer.unref?.();
  }

  stop() {
    clearInterval(this.timer);
    for (const timer of this.soon.values()) clearTimeout(timer);
  }

  /** GSI maç sonu: demolar birkaç dakika içinde hazır olur; 3 ve 12 dk sonra tekrar bak. */
  scheduleSoon(userId) {
    for (const delay of [3 * 60_000, 12 * 60_000]) {
      const key = `${userId}:${delay}`;
      clearTimeout(this.soon.get(key));
      const timer = setTimeout(() => {
        this.soon.delete(key);
        const user = this.store.getUser(userId);
        if (user) void this.trackUser(user, { reason: "maç sonu" });
      }, delay);
      timer.unref?.();
      this.soon.set(key, timer);
    }
  }

  async cycle() {
    if (this.running) return;
    this.running = true;
    try {
      const cutoff = this.now() - this.config.trackerIntervalMin * 60_000;
      const users = this.store.trackableUsers(BATCH * 3).filter((user) => Number(user.last_tracked_at) < cutoff).slice(0, BATCH);
      for (const user of users) await this.trackUser(user, { reason: "zamanlı" });
    } catch (error) {
      log.warn("Takip turu başarısız", error?.message || error);
    } finally {
      this.running = false;
    }
  }

  canAutoAnalyze(user) {
    if (!user.settings.autoAnalyze) return false;
    const allowance = this.entitlements.analysisAllowance({ userId: user.id });
    return allowance.ok;
  }

  async trackUser(user, { reason = "elle" } = {}) {
    const result = { steam: [], faceit: [], errors: [] };
    this.store.updateUser(user.id, { last_tracked_at: this.now() });
    if (this.steam?.enabled && user.steam_id && user.match_auth_code && user.last_share_code) {
      try {
        const authCode = decrypt(this.secretKey, user.match_auth_code);
        const codes = await this.steam.newShareCodes(user.steam_id, authCode, user.last_share_code, MAX_NEW_PER_RUN);
        if (codes.length) {
          this.store.updateUser(user.id, { last_share_code: codes.at(-1), track_error: null });
          result.steam = codes;
          if (this.steam.canResolveShareCodes() && this.canAutoAnalyze(user)) {
            for (const shareCode of codes) {
              this.queue.enqueue({ userId: user.id, source: { type: "sharecode", shareCode }, reply: { dm: true, auto: true }, dedupeKey: `sc:${shareCode}` });
              this.entitlements.recordAnalysis(user.id);
            }
          } else {
            await this.notify(user, { kind: "steam-new", codes });
          }
        }
      } catch (error) {
        result.errors.push(error.message);
        if (error.status === 403 || error.status === 412) {
          if (user.track_error !== error.message) await this.notify(user, { kind: "error", message: error.message });
          this.store.updateUser(user.id, { track_error: error.message });
        }
      }
    }
    if (this.faceit?.enabled && user.faceit_player_id) {
      try {
        const scan = await this.faceit.scan(user.faceit_player_id);
        this.store.updateUser(user.id, { faceit_elo: scan.player.elo, faceit_level: scan.player.level, faceit_nickname: scan.player.nickname, faceit_avatar: scan.player.avatar });
        const fresh = scan.hadHistory ? scan.newIds.slice(0, MAX_NEW_PER_RUN) : [];
        result.faceit = fresh;
        if (fresh.length) {
          if (this.faceit.canDownload && this.canAutoAnalyze(user)) {
            for (const id of fresh) {
              this.queue.enqueue({ userId: user.id, source: { type: "faceit", id }, reply: { dm: true, auto: true }, dedupeKey: `fc:${id}` });
              this.entitlements.recordAnalysis(user.id);
            }
          } else {
            await this.notify(user, { kind: "faceit-new", ids: fresh });
          }
        }
      } catch (error) {
        result.errors.push(error.message);
      }
    }
    if (result.steam.length || result.faceit.length) log.info(`${user.id}: ${result.steam.length} Steam, ${result.faceit.length} FACEIT yeni maç (${reason}).`);
    return result;
  }
}
