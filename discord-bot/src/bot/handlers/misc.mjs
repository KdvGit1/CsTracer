// /yardim, /sozluk, /premium, /canli, /admin.
import { AttachmentBuilder } from "discord.js";
import { hashToken } from "../../secrets.mjs";
import { gsiConfig } from "../../services/live.mjs";
import { mapLabel } from "../../render/svg.mjs";
import { GLOSSARY, HELP_SECTIONS } from "../text.mjs";
import { COLORS, EPHEMERAL, embed, errorMessage, infoMessage, linkButton, row } from "../ui.mjs";

export async function yardim(app, interaction) {
  const disabled = [];
  if (!app.features.web) disabled.push("büyük dosya yükleme, Steam doğrulama ve canlı GSI (PUBLIC_URL yok)");
  if (!app.features.faceit) disabled.push("FACEIT (FACEIT_API_KEY yok)");
  if (!app.features.steamDemos) disabled.push("paylaşım kodundan otomatik demo (Steam bot hesabı yok)");
  return interaction.reply({
    embeds: [embed({
      title: "TRACER · CS2 koçu",
      description: "Demo analizi, tepki süresi, düello, T tarafı disiplini, kişisel gelişim ve takım koçu — hepsi Discord'da. Hem tek başına (DM'de) hem sunucunda kullanabilirsin.",
      fields: [
        ...HELP_SECTIONS.map(([name, value]) => ({ name, value })),
        ...(disabled.length ? [{ name: "Bu botta kapalı", value: disabled.join(" · ") }] : []),
      ],
      color: COLORS.accent,
      footer: "Demo dosyaları analizden sonra silinir; yalnız sonuçlar saklanır.",
    })],
    flags: EPHEMERAL,
  });
}

export async function sozluk(app, interaction) {
  const key = interaction.options.getString("terim");
  if (key && GLOSSARY[key]) return interaction.reply({ embeds: [embed({ title: GLOSSARY[key].title, description: GLOSSARY[key].body, color: COLORS.info })], flags: EPHEMERAL });
  return interaction.reply({
    embeds: [embed({ title: "TRACER sözlüğü", fields: Object.values(GLOSSARY).map((item) => ({ name: item.title, value: item.body })), color: COLORS.info })],
    flags: EPHEMERAL,
  });
}

export async function premium(app, interaction) {
  const premiumNow = app.entitlements.isPremium({ userId: interaction.user.id, guildId: interaction.guildId, interaction });
  const limit = app.config.freeDailyAnalyses;
  const allowance = app.entitlements.analysisAllowance({ userId: interaction.user.id, guildId: interaction.guildId, interaction });
  const lines = [
    premiumNow ? "⭐ **Premium aktif.** Teşekkürler!" : limit ? `Ücretsiz plan: günde **${limit}** analiz (bugün ${allowance.used}/${limit}).` : "Bu bot şu an herkese **sınırsız** ve ücretsiz.",
    "",
    limit ? "**Premium ile** günlük analiz sınırı kalkar (otomatik takipte bulunan maçlar dahil)." : "Projeyi desteklemek istersen aşağıdaki bağlantıyı kullanabilirsin.",
  ];
  const buttons = [];
  if (app.config.supportUrl) buttons.push(linkButton(app.config.supportUrl, "Destek ol / Premium al", "⭐"));
  return interaction.reply({ embeds: [embed({ title: "TRACER Premium", description: lines.join("\n"), color: COLORS.tie })], components: buttons.length ? [row(...buttons)] : [], flags: EPHEMERAL });
}

export async function canli(app, interaction) {
  const sub = interaction.options.getSubcommand();
  if (!app.features.web) return interaction.reply({ ...errorMessage("Canlı bağlantı için botun web adresi (PUBLIC_URL) ayarlı olmalı."), flags: EPHEMERAL });
  if (sub === "kur") {
    const token = app.live.newToken();
    app.store.revokeTokens(interaction.user.id, "gsi");
    app.store.saveToken({ tokenHash: hashToken(token), kind: "gsi", userId: interaction.user.id, ttlMs: 365 * 86_400_000 });
    const file = new AttachmentBuilder(Buffer.from(gsiConfig(app.config.publicUrl, token), "utf8"), { name: "gamestate_integration_tracer_bot.cfg" });
    return interaction.reply({
      embeds: [embed({
        title: "CS2 canlı bağlantı dosyan",
        description: [
          "1. Dosyayı indir ve şu klasöre kopyala:",
          "`Steam/steamapps/common/Counter-Strike Global Offensive/game/csgo/cfg/`",
          "2. CS2'yi yeniden başlat.",
          "3. Maça girince `/canli durum` ile kontrol et.",
          "",
          "• Maç bitince yeni demon otomatik aranır (Steam/FACEIT takibin açıksa).",
          "• `/takim canli baslat` ile takımının kanalında round round güncellenen plan tahtası çalışır.",
          "• Dosyadaki anahtar sana özeldir; paylaşma. Yeni dosya alırsan eskisi geçersiz olur.",
        ].join("\n"),
        color: COLORS.accent,
      })],
      files: [file],
      flags: EPHEMERAL,
    });
  }
  const state = app.live.get(interaction.user.id);
  if (!state) return interaction.reply({ ...infoMessage("Senden henüz CS2 verisi gelmedi. `/canli kur` ile dosyanı kurup CS2'yi yeniden başlat."), flags: EPHEMERAL });
  return interaction.reply({
    embeds: [embed({
      title: state.connected ? "🟢 CS2 bağlı" : "⚪ CS2 bağlantısı yok",
      fields: [
        { name: "Harita", value: state.map.name ? mapLabel(state.map.name) : "—", inline: true },
        { name: "Skor", value: `CT ${state.map.scoreCT} : ${state.map.scoreT} T`, inline: true },
        { name: "Faz", value: `${state.map.phase || "—"} · round ${state.map.round + 1}`, inline: true },
        { name: "Sen", value: `${state.player.team || "—"} · ${state.player.kills}/${state.player.deaths}/${state.player.assists} · $${state.player.money}`, inline: true },
      ],
      color: state.connected ? COLORS.win : COLORS.muted,
      footer: `Son paket: ${new Date(state.lastPacketTime).toLocaleTimeString("tr-TR", { timeZone: "Europe/Istanbul" })}`,
    })],
    flags: EPHEMERAL,
  });
}

export async function admin(app, interaction) {
  if (!app.entitlements.isOwner(interaction.user.id)) return interaction.reply({ ...errorMessage("Bu komut yalnız bot sahibine açık (OWNER_IDS)."), flags: EPHEMERAL });
  const sub = interaction.options.getSubcommand();
  if (sub === "istatistik") {
    const stats = app.store.stats();
    const memory = process.memoryUsage();
    return interaction.reply({
      embeds: [embed({
        title: "Bot istatistikleri",
        fields: [
          { name: "Kullanıcılar", value: `${stats.users} (Steam ${stats.steamLinked} · FACEIT ${stats.faceitLinked} · Premium ${stats.premiumUsers})`, inline: false },
          { name: "Sunucular", value: `${stats.guilds} kayıtlı · ${interaction.client.guilds.cache.size} bağlı`, inline: true },
          { name: "Maçlar", value: `${stats.matches} (${stats.analyzedFiles} ayrıntılı)`, inline: true },
          { name: "Kuyruk", value: `${stats.queued} bekleyen · son 24 saatte ${stats.failed24h} hata`, inline: true },
          { name: "Takımlar", value: String(stats.squads), inline: true },
          { name: "Bellek", value: `${Math.round(memory.rss / 1024 / 1024)} MB RSS`, inline: true },
          { name: "Özellikler", value: Object.entries(app.features).map(([key, value]) => `${value ? "✅" : "▫️"} ${key}`).join(" · "), inline: false },
        ],
        color: COLORS.info,
      })],
      flags: EPHEMERAL,
    });
  }
  if (sub === "premium") {
    const days = interaction.options.getInteger("gun", true);
    const user = interaction.options.getUser("kullanici");
    const guildId = interaction.options.getString("sunucu");
    const note = interaction.options.getString("not") || "";
    if (!user && !/^\d{16,22}$/.test(String(guildId || ""))) return interaction.reply({ ...errorMessage("Kullanıcı veya geçerli sunucu ID'si ver."), flags: EPHEMERAL });
    const until = Date.now() + days * 86_400_000;
    if (user) {
      app.store.touchUser(user.id, user.username);
      app.store.grantPremium({ targetType: "user", targetId: user.id, until, source: "manual", note });
    } else {
      app.store.touchGuild(guildId, "");
      app.store.grantPremium({ targetType: "guild", targetId: guildId, until, source: "manual", note });
    }
    return interaction.reply({ ...infoMessage(`⭐ ${user ? `<@${user.id}>` : `Sunucu ${guildId}`} için ${days} gün premium verildi (${new Date(until).toLocaleDateString("tr-TR")}).`), flags: EPHEMERAL });
  }
  return undefined;
}
