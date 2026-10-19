// Ücretsiz/premium sınırları. Varsayılan (FREE_DAILY_ANALYSES=0) herkes için
// sınırsızdır — kendi sunucunda arkadaşlarınla kullanırken limit gerekmez.
// Gelir modeli kurulursa: Discord Premium Apps SKU'ları (bölgen destekliyorsa)
// veya /admin premium ile elle verilen süreler (Patreon, Shopier vb. ödemeler).
const day = (now) => new Date(now).toISOString().slice(0, 10);

export class Entitlements {
  constructor({ store, config, now = () => Date.now() }) {
    this.store = store;
    this.config = config;
    this.now = now;
  }

  isOwner(userId) {
    return this.config.ownerIds.includes(String(userId));
  }

  /** Discord SKU hakkı (interaction.entitlements) veya elle verilen premium. */
  isPremium({ userId, guildId = null, interaction = null } = {}) {
    if (this.isOwner(userId)) return true;
    const now = this.now();
    const user = userId ? this.store.getUser(userId) : null;
    if (Number(user?.premium_until) > now) return true;
    const guild = guildId ? this.store.getGuild(guildId) : null;
    if (Number(guild?.premium_until) > now) return true;
    if (interaction?.entitlements && this.config.premiumSkuIds.length) {
      for (const entitlement of interaction.entitlements.values()) {
        const active = typeof entitlement.isActive === "function" ? entitlement.isActive() : !entitlement.deleted;
        if (active && this.config.premiumSkuIds.includes(entitlement.skuId)) return true;
      }
    }
    return false;
  }

  analysisAllowance(context) {
    const limit = this.config.freeDailyAnalyses;
    if (!limit || this.isPremium(context)) return { ok: true, limit: 0, used: 0, premium: limit > 0 };
    const used = this.store.usageToday(context.userId, day(this.now()));
    return { ok: used < limit, limit, used, premium: false };
  }

  recordAnalysis(userId) {
    this.store.addUsage(userId, day(this.now()));
  }
}
