// /baslat ve /hesap: kişiyi tanıma, Steam/FACEIT bağlama, ayarlar ve KVKK silme.
import { FaceitService } from "../../services/faceit.mjs";
import { isAuthCode, isShareCode } from "../../services/steam.mjs";
import { welcomeCardSvg } from "../../render/cards/player.mjs";
import { fetchAvatar } from "../../render/png.mjs";
import { encrypt } from "../../secrets.mjs";
import { DEFAULT_USER_SETTINGS } from "../../db.mjs";
import { greeting, memberSince } from "../text.mjs";
import { COLORS, EPHEMERAL, STYLE, button, cid, embed, errorMessage, infoMessage, linkButton, modal, png, row } from "../ui.mjs";

const SETTING_LABELS = {
  dmNotify: ["DM bildirimleri", "Analiz bitince ve yeni maç bulununca özelden yaz"],
  autoAnalyze: ["Otomatik analiz", "Yeni maçlarını otomatik kuyruğa al"],
  autoTrack: ["Otomatik takip", "Steam/FACEIT hesaplarını düzenli tara"],
  publicProfile: ["Herkese açık profil", "Liderlik tablosu, karşılaştırma ve sunucu raporlarında görün"],
};

export async function baslat(app, interaction, ctx) {
  await interaction.deferReply({ flags: EPHEMERAL });
  const user = ctx.user;
  const count = app.store.countUserMatches(user.id);
  const avatar = await fetchAvatar(app.avatarUrl(interaction.user));
  const stats = count ? `${count} analizli maç · TRACER'da ${memberSince(user.first_seen)}${user.steam_id ? " · Steam bağlı" : ""}${user.faceit_nickname ? ` · FACEIT ${user.faceit_nickname}` : ""}` : null;
  const image = await app.renderer.render(welcomeCardSvg({ name: user.name || interaction.user.username, avatarHref: avatar, returning: Boolean(ctx.previous), stats }));
  const components = [row(
    button(cid("start", "steam", user.id), user.steam_id ? "Steam'i güncelle" : "Steam bağla", { emoji: "🎮", style: user.steam_id ? STYLE.secondary : STYLE.primary }),
    button(cid("start", "faceit", user.id), user.faceit_nickname ? "FACEIT'i güncelle" : "FACEIT bağla", { emoji: "🟠" }),
    button(cid("start", "upload", user.id), "Demo yükle", { emoji: "📤", style: STYLE.success }),
    button(cid("start", "profile", user.id), "Profilim", { emoji: "🪪" }),
  )];
  await interaction.editReply({ content: greeting({ user, previous: ctx.previous }) || undefined, embeds: [embed({ image: "attachment://tracer-hosgeldin.png", color: COLORS.accent })], files: [png(image, "tracer-hosgeldin.png")], components });
}

export function steamModal(app, userId) {
  const user = app.store.getUser(userId);
  return modal(cid("modal", "steam", userId), "Steam hesabını bağla", [
    { id: "profil", label: "Steam profili / SteamID64", placeholder: "steamcommunity.com/id/... veya 7656119...", value: user?.steam_id || "", max: 200 },
    { id: "kimlik", label: "Maç geçmişi kimlik kodu (isteğe bağlı)", placeholder: "XXXX-XXXXX-XXXX", required: false, max: 20 },
    { id: "kod", label: "En son maçının paylaşım kodu (isteğe bağlı)", placeholder: "CSGO-xxxxx-xxxxx-xxxxx-xxxxx-xxxxx", required: false, max: 40 },
  ]);
}

export function faceitModal(app, userId) {
  const user = app.store.getUser(userId);
  return modal(cid("modal", "faceit", userId), "FACEIT hesabını bağla", [
    { id: "kullanici", label: "FACEIT kullanıcı adın", placeholder: "örn. s1mple", value: user?.faceit_nickname || "", max: 100 },
  ]);
}

export async function startButton(app, interaction, [, action, ownerId]) {
  if (interaction.user.id !== ownerId) return interaction.reply({ ...infoMessage("Bu düğmeler başkasına ait; kendin için `/baslat` yaz."), flags: EPHEMERAL });
  if (action === "steam") return interaction.showModal(steamModal(app, ownerId));
  if (action === "faceit") return interaction.showModal(faceitModal(app, ownerId));
  if (action === "upload") {
    const link = app.createUploadLink(ownerId, { channelId: interaction.channelId, guildId: interaction.guildId });
    return interaction.reply({ ...uploadMessage(app, link), flags: EPHEMERAL });
  }
  if (action === "profile") {
    const { profil } = await import("./stats.mjs");
    return profil(app, interaction, { user: app.store.getUser(ownerId) }, { targetUser: interaction.user });
  }
  return undefined;
}

export function uploadMessage(app, link) {
  if (!link) {
    return infoMessage("Demo dosyasını `/analiz dosya:` ile ekleyebilirsin (Discord ek sınırı: Nitro'suz 10 MB). Valve replay veya FACEIT demo bağlantısını `/analiz baglanti:` ile de gönderebilirsin.\n\nBüyük dosyalar için web yükleme bu botta açık değil (bot sahibi `PUBLIC_URL` ayarlamamış).", { title: "Demo yükle" });
  }
  return {
    embeds: [embed({ title: "Demo yükleme bağlantın hazır", description: "Bağlantıyı aç, `.dem`, `.dem.gz` veya `.dem.bz2` dosyanı seç. Yükleme bitince analiz sıraya girer ve sonuç Discord'a gelir.\n\n• Bağlantı **1 saat** geçerli ve **tek kullanımlık**.\n• CS2 demoları genelde `Counter-Strike Global Offensive/game/csgo/replays` klasöründedir.", color: COLORS.accent })],
    components: [row(linkButton(link, "Demo yükle", "📤"))],
    files: [],
  };
}

async function linkSteam(app, interaction, { profile, authCode, shareCode }) {
  const userId = interaction.user.id;
  const auth = String(authCode || "").trim().toUpperCase();
  const code = String(shareCode || "").trim();
  if (auth && !isAuthCode(auth)) return errorMessage("Kimlik kodu XXXX-XXXXX-XXXX biçiminde olmalı. Steam yardım sayfasından alabilirsin.");
  if (code && !isShareCode(code)) return errorMessage("Paylaşım kodu CSGO-xxxxx-xxxxx-xxxxx-xxxxx-xxxxx biçiminde olmalı.");
  if ((auth && !code) || (!auth && code)) return errorMessage("Otomatik takip için kimlik kodu ve son paylaşım kodu birlikte gerekli.");
  let steamId;
  try {
    steamId = await app.steam.resolveSteamId(profile);
  } catch (error) {
    return errorMessage(error.message);
  }
  const existing = app.store.getUser(userId);
  const sameAccount = existing?.steam_id === steamId;
  try {
    app.store.claimSteamId(userId, steamId, { verified: sameAccount && Boolean(existing?.steam_verified) });
  } catch (error) {
    return errorMessage(error.message);
  }
  // Hesap değiştiyse eski hesabın takip kodları geçersizdir.
  if (!sameAccount) app.store.updateUser(userId, { match_auth_code: null, last_share_code: null, track_error: null });
  let summary = { name: "", avatar: "", public: null };
  try { summary = await app.steam.summary(steamId); } catch { /* API anahtarı yoksa ad bilinmez */ }
  app.store.updateUser(userId, { steam_name: summary.name || null, steam_avatar: summary.avatar || null });
  if (auth && code) {
    if (!app.features.steam) return errorMessage("Bu botta Steam Web API anahtarı yok; otomatik takip kullanılamıyor. Hesabın yine de bağlandı.");
    try {
      await app.steam.nextShareCode(steamId, auth, code);
    } catch (error) {
      return errorMessage(`Steam bilgileri doğrulanamadı: ${error.message}`);
    }
    app.store.updateUser(userId, { match_auth_code: encrypt(app.secretKey, auth), last_share_code: code, track_error: null });
  }
  const verified = app.store.getUser(userId)?.steam_verified;
  const verifyLink = !verified ? app.createSteamLoginLink(userId) : null;
  const lines = [
    `✅ Steam hesabın bağlandı: **${summary.name || steamId}**${verified ? " (doğrulandı ✓)" : ""}`,
    auth ? `🔁 Otomatik takip açık. Yeni maçlarını ${app.config.trackerIntervalMin} dakikada bir kontrol edeceğim${app.features.steamDemos ? " ve otomatik analiz edeceğim." : "; demo indirme bu botta kapalı olduğu için yeni maç bulununca haber vereceğim."}` : "ℹ️ Otomatik takip için `/hesap steam` komutuna **kimlik-kodu** ve **son-kod** ekle.",
    summary.public === false ? "⚠️ Steam profilin gizli görünüyor; ad ve avatar okunamayabilir." : "",
    verifyLink ? "🔒 Liderlik tablosunda ✓ işareti ve hesabının başkası tarafından sahiplenilmemesi için Steam ile doğrula:" : "",
  ].filter(Boolean);
  return {
    embeds: [embed({ title: "Steam", description: lines.join("\n"), color: COLORS.accent, thumbnail: summary.avatar || undefined })],
    components: [row(
      verifyLink ? linkButton(verifyLink, "Steam ile doğrula", "🔒") : null,
      linkButton("https://help.steampowered.com/en/wizard/HelpWithGameIssue/?appid=730&issueid=128", "Kimlik kodu nerede?", "❓"),
    )],
    files: [],
  };
}

async function linkFaceit(app, interaction, nickname) {
  if (!app.faceit?.enabled) return errorMessage("Bu botta FACEIT bağlantısı kapalı (bot sahibi FACEIT_API_KEY tanımlamamış).");
  try {
    const player = FaceitService.summarize(await app.faceit.findPlayer(nickname));
    app.store.updateUser(interaction.user.id, {
      faceit_nickname: player.nickname, faceit_player_id: player.playerId, faceit_elo: player.elo, faceit_level: player.level,
      faceit_avatar: player.avatar || null, faceit_country: player.country || null,
    });
    const user = app.store.getUser(interaction.user.id);
    if (!user.steam_id && player.steamId) {
      try { app.store.claimSteamId(user.id, player.steamId, { verified: false }); } catch { /* başka biri doğrulamışsa dokunma */ }
    }
    void app.faceit.scan(player.playerId).catch(() => null);
    return {
      embeds: [embed({
        title: "FACEIT bağlandı",
        description: `✅ **${player.nickname}** · Seviye ${player.level ?? "—"} · ${player.elo ?? "—"} ELO\nSon 20 maçını tarıyorum; \`/faceit\` ile kartını görebilirsin. Yeni maçların otomatik takip edilecek${app.faceit.canDownload ? " ve analiz edilecek." : " (demoyu yüklersen tam analiz ederim)."}`,
        color: COLORS.faceit,
        thumbnail: player.avatar || undefined,
      })],
      components: [row(linkButton(player.url, "FACEIT profili", "🟠"))],
      files: [],
    };
  } catch (error) {
    return errorMessage(error.message);
  }
}

export async function modalSubmit(app, interaction, [, kind, ownerId]) {
  if (interaction.user.id !== ownerId) return interaction.reply({ ...errorMessage("Bu form sana ait değil."), flags: EPHEMERAL });
  await interaction.deferReply({ flags: EPHEMERAL });
  const field = (id) => interaction.fields.getTextInputValue(id) || "";
  const payload = kind === "steam"
    ? await linkSteam(app, interaction, { profile: field("profil"), authCode: field("kimlik"), shareCode: field("kod") })
    : await linkFaceit(app, interaction, field("kullanici"));
  return interaction.editReply(payload);
}

function statusPayload(app, userId, ctx) {
  const user = app.store.getUser(userId);
  const count = app.store.countUserMatches(userId);
  const maps = app.store.userMaps(userId).slice(0, 3).map((item) => `${item.map} (${item.count})`).join(", ");
  const guilds = app.store.guildsOfUser(userId).length;
  const premium = app.entitlements.isPremium({ userId });
  const fields = [
    { name: "Steam", value: user.steam_id ? `${user.steam_name || user.steam_id}${user.steam_verified ? " ✓ doğrulandı" : " · doğrulanmadı"}\n${user.match_auth_code ? `Otomatik takip: ${user.track_error ? `⚠️ ${user.track_error}` : "açık"}` : "Otomatik takip: kapalı"}` : "Bağlı değil · `/hesap steam`", inline: true },
    { name: "FACEIT", value: user.faceit_nickname ? `${user.faceit_nickname} · Seviye ${user.faceit_level ?? "—"} · ${user.faceit_elo ?? "—"} ELO` : "Bağlı değil · `/hesap faceit`", inline: true },
    { name: "Hafıza", value: `${count} maç · ${maps || "harita yok"}\n${guilds} sunucuda görüldün · ilk tanışma ${memberSince(user.first_seen)} önce · ${user.visits}. ziyaret`, inline: false },
    { name: "Plan", value: premium ? "⭐ Premium" : app.config.freeDailyAnalyses ? `Ücretsiz · günde ${app.config.freeDailyAnalyses} analiz` : "Sınırsız", inline: true },
  ];
  const toggles = Object.entries(SETTING_LABELS).map(([key, [label]]) => button(cid("set", key, userId), `${label}: ${user.settings[key] ? "Açık" : "Kapalı"}`, { style: user.settings[key] ? STYLE.success : STYLE.secondary }));
  return {
    content: ctx?.greeting || undefined,
    embeds: [embed({ title: "TRACER seni böyle hatırlıyor", fields, color: COLORS.accent, footer: "Ayarları aşağıdan değiştirebilirsin · /hesap sil her şeyi siler" })],
    components: [row(...toggles)],
    files: [],
  };
}

export async function settingButton(app, interaction, [, key, ownerId]) {
  if (interaction.user.id !== ownerId) return interaction.reply({ ...errorMessage("Bu ayarlar sana ait değil."), flags: EPHEMERAL });
  if (!(key in DEFAULT_USER_SETTINGS)) return undefined;
  const user = app.store.getUser(ownerId);
  app.store.updateUserSettings(ownerId, { [key]: !user.settings[key] });
  return interaction.update(statusPayload(app, ownerId));
}

export async function deleteButton(app, interaction, [, action, ownerId]) {
  if (interaction.user.id !== ownerId) return interaction.reply({ ...errorMessage("Bu işlem sana ait değil."), flags: EPHEMERAL });
  if (action === "no") return interaction.update(infoMessage("Silme iptal edildi. Verilerin yerinde."));
  const result = app.store.deleteUser(ownerId);
  return interaction.update(infoMessage(`🗑️ Bütün kişisel verilerin silindi (${result.squads} takım dahil). Paylaşılan maç analizleri yalnız diğer oyuncuların geçmişi için kalır; seni artık tanımıyorum. Tekrar görüşmek istersen \`/baslat\`.`, { color: COLORS.muted }));
}

export async function hesap(app, interaction, ctx) {
  const sub = interaction.options.getSubcommand();
  const userId = interaction.user.id;
  if (sub === "steam") {
    await interaction.deferReply({ flags: EPHEMERAL });
    return interaction.editReply(await linkSteam(app, interaction, {
      profile: interaction.options.getString("profil", true),
      authCode: interaction.options.getString("kimlik-kodu"),
      shareCode: interaction.options.getString("son-kod"),
    }));
  }
  if (sub === "dogrula") {
    const link = app.createSteamLoginLink(userId);
    if (!link) return interaction.reply({ ...errorMessage("Steam doğrulaması için botun web adresi (PUBLIC_URL) ayarlı olmalı."), flags: EPHEMERAL });
    return interaction.reply({ embeds: [embed({ title: "Steam ile doğrula", description: "Steam'in resmî giriş sayfası açılacak. TRACER şifreni görmez; yalnız SteamID'ni öğrenir. Bağlantı 15 dakika geçerli.", color: COLORS.accent })], components: [row(linkButton(link, "Steam ile doğrula", "🔒"))], flags: EPHEMERAL });
  }
  if (sub === "faceit") {
    await interaction.deferReply({ flags: EPHEMERAL });
    return interaction.editReply(await linkFaceit(app, interaction, interaction.options.getString("kullanici", true)));
  }
  if (sub === "durum") return interaction.reply({ ...statusPayload(app, userId, ctx), flags: EPHEMERAL });
  if (sub === "kaldir") {
    const which = interaction.options.getString("hesap", true);
    if (which === "steam") app.store.updateUser(userId, { steam_id: null, steam_verified: 0, steam_name: null, steam_avatar: null, match_auth_code: null, last_share_code: null, track_error: null });
    else app.store.updateUser(userId, { faceit_nickname: null, faceit_player_id: null, faceit_elo: null, faceit_level: null, faceit_avatar: null, faceit_country: null });
    return interaction.reply({ ...infoMessage(`${which === "steam" ? "Steam" : "FACEIT"} bağlantın kaldırıldı. Analiz geçmişin duruyor.`), flags: EPHEMERAL });
  }
  if (sub === "sil") {
    return interaction.reply({
      embeds: [embed({ title: "Bütün verilerini silmek istediğine emin misin?", description: "Bağlı hesapların, maç geçmişin, gelişim kayıtların, takımların ve ayarların kalıcı olarak silinir. Bu işlem geri alınamaz.", color: COLORS.error })],
      components: [row(button(cid("del", "yes", userId), "Evet, hepsini sil", { style: STYLE.danger }), button(cid("del", "no", userId), "Vazgeç"))],
      flags: EPHEMERAL,
    });
  }
  return undefined;
}
