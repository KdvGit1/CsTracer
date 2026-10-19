// /sunucu: maç raporu kanalı, rol bildirimi, test görseli, liderlik ayarı.
import { PermissionFlagsBits } from "discord.js";
import { COLORS, EPHEMERAL, embed, errorMessage, infoMessage, png } from "../ui.mjs";

const NEEDED = [
  [PermissionFlagsBits.ViewChannel, "Kanalı görme"],
  [PermissionFlagsBits.SendMessages, "Mesaj gönderme"],
  [PermissionFlagsBits.EmbedLinks, "Bağlantı yerleştirme"],
  [PermissionFlagsBits.AttachFiles, "Dosya ekleme"],
];

function missingPermissions(channel, member) {
  if (!channel || !member) return ["Bot bu sunucuda üye değil — sunucu yöneticisi botu 'Sunucuya ekle' ile eklemeli"];
  const permissions = channel.permissionsFor(member);
  const list = channel.type === 15 ? [...NEEDED, [PermissionFlagsBits.SendMessagesInThreads, "Gönderi açma"]] : NEEDED;
  return list.filter(([flag]) => !permissions?.has(flag)).map(([, label]) => label);
}

export async function sunucu(app, interaction) {
  const sub = interaction.options.getSubcommand();
  const guildId = interaction.guildId;
  app.store.touchGuild(guildId, interaction.guild?.name || "");
  if (sub === "kur") {
    const channel = interaction.options.getChannel("kanal", true);
    const role = interaction.options.getRole("rol");
    const auto = interaction.options.getBoolean("otomatik");
    const resolved = interaction.guild ? await interaction.guild.channels.fetch(channel.id).catch(() => null) : null;
    const missing = missingPermissions(resolved, interaction.guild?.members?.me);
    if (missing.length) return interaction.reply({ ...errorMessage(`<#${channel.id}> kanalında eksik izinler: **${missing.join(", ")}**. İzinleri verip tekrar dene.`), flags: EPHEMERAL });
    app.store.updateGuild(guildId, { report_channel_id: channel.id, report_thread_id: null, notify_role_id: role?.id || null, auto_report: auto === null ? true : auto });
    return interaction.reply({
      embeds: [embed({
        title: "Maç raporları ayarlandı",
        description: [
          `📣 Kanal: <#${channel.id}>${channel.type === 15 ? " (forum — her maç ayrı gönderi)" : ""}`,
          `🔔 Rol: ${role ? `<@&${role.id}>` : "yok"}`,
          `🤖 Otomatik paylaşım: ${auto === false ? "kapalı (üyeler maçlarını 📣 düğmesiyle paylaşır)" : "açık — bu sunucuda TRACER kullanan üyelerin yeni maçları otomatik paylaşılır"}`,
          "",
          "Üyeler profillerini `/hesap durum` → **Herkese açık profil** ile gizleyebilir. Test için `/sunucu test`.",
        ].join("\n"),
        color: COLORS.accent,
      })],
      flags: EPHEMERAL,
    });
  }
  const guild = app.store.getGuild(guildId);
  if (sub === "durum") {
    const stats = app.store.outboxStats(guildId);
    const count = (status) => stats.find((item) => item.status === status)?.count || 0;
    const lastError = stats.find((item) => item.status === "failed")?.error;
    const members = app.store.guildMemberIds(guildId).length;
    return interaction.reply({
      embeds: [embed({
        title: "Sunucu durumu",
        fields: [
          { name: "Rapor kanalı", value: guild?.report_channel_id ? `<#${guild.report_channel_id}>` : "ayarlı değil · `/sunucu kur`", inline: true },
          { name: "Rol", value: guild?.notify_role_id ? `<@&${guild.notify_role_id}>` : "yok", inline: true },
          { name: "Otomatik paylaşım", value: guild?.auto_report ? "açık" : "kapalı", inline: true },
          { name: "Gönderim kutusu", value: `✅ ${count("sent")} gönderildi · ⏳ ${count("pending")} bekliyor · ⚠️ ${count("failed")} başarısız${lastError ? `\nSon hata: ${lastError}` : ""}`, inline: false },
          { name: "TRACER kullanan üyeler", value: String(members), inline: true },
          { name: "Liderlik", value: guild?.leaderboard ? "açık" : "kapalı", inline: true },
        ],
        color: COLORS.info,
      })],
      flags: EPHEMERAL,
    });
  }
  if (sub === "test") {
    if (!guild?.report_channel_id) return interaction.reply({ ...errorMessage("Önce `/sunucu kur` ile kanal seç."), flags: EPHEMERAL });
    await interaction.deferReply({ flags: EPHEMERAL });
    try {
      const channel = await interaction.client.channels.fetch(guild.report_channel_id);
      const image = await app.sampleReportImage();
      const message = {
        content: "",
        embeds: [embed({ author: "TRACER · TABLO GÖRSELİ TESTİ", title: "Anubis · 13 - 8 · Galibiyet", description: "Bu görsel kanal ve tablo görünümü testi için gönderildi. Gerçek maçlar analiz edildikçe aynı biçimde paylaşılır.", color: COLORS.win, image: "attachment://tracer-test.png" })],
        files: [png(image, "tracer-test.png")],
        allowedMentions: { parse: [] },
      };
      if (channel.type === 15) await channel.threads.create({ name: "TRACER test raporu", message });
      else await channel.send(message);
      return interaction.editReply(infoMessage(`Test görseli <#${guild.report_channel_id}> kanalına gönderildi.`));
    } catch (error) {
      return interaction.editReply(errorMessage(`Gönderilemedi: ${error.message}. Botun kanal izinlerini kontrol et.`));
    }
  }
  if (sub === "kapat") {
    app.store.updateGuild(guildId, { auto_report: false });
    return interaction.reply({ ...infoMessage("Otomatik maç raporları kapatıldı. Üyeler 📣 düğmesiyle yine elle paylaşabilir."), flags: EPHEMERAL });
  }
  if (sub === "liderlik") {
    const open = interaction.options.getBoolean("acik", true);
    app.store.updateGuild(guildId, { leaderboard: open });
    return interaction.reply({ ...infoMessage(`Liderlik tablosu ${open ? "açıldı" : "kapatıldı"}.`), flags: EPHEMERAL });
  }
  return undefined;
}
