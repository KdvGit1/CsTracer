// /baslat ve /hesap: kişiyi tanıma, Steam/FACEIT bağlama, ayarlar ve KVKK silme.
import { logger, redact } from "../../log.mjs";
import { FaceitService } from "../../services/faceit.mjs";
import { isAuthCode, isShareCode } from "../../services/steam.mjs";
import { AUTH_CODE_PAGE, extractMatchCodes, qrSvg } from "../../services/steam-qr.mjs";
import { welcomeCardSvg } from "../../render/cards/player.mjs";
import { fetchAvatar } from "../../render/png.mjs";
import { encrypt } from "../../secrets.mjs";
import { DEFAULT_USER_SETTINGS } from "../../db.mjs";
import { greeting, memberSince } from "../text.mjs";
import { COLORS, EPHEMERAL, STYLE, button, cid, embed, errorMessage, infoMessage, linkButton, modal, png, row } from "../ui.mjs";

const log = logger("hesap");

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
  return modal(cid("modal", "steam", userId), "Steam'i elle bağla", [
    { id: "profil", label: "Steam profilin", placeholder: "steamcommunity.com/id/... veya 7656119...", value: user?.steam_id || "", max: 200 },
    { id: "kodlar", label: "Steam kod sayfasından kopyaladığın metin", placeholder: "Sayfada Ctrl+A, Ctrl+C yap, buraya yapıştır. Kimlik kodunu ve son maç kodunu ben ayıklarım.", required: false, max: 4000, paragraph: true },
  ]);
}

const manualButton = (userId) => button(cid("start", "steamform", userId), "QR okutamıyorum, elle gireceğim", { emoji: "⌨️" });
const codePageButton = () => linkButton(AUTH_CODE_PAGE, "Steam kod sayfası", "🔑");

function qrPayload(image, url, userId) {
  return {
    embeds: [embed({
      title: "📱 Steam'i QR ile bağla",
      description: [
        "1. Telefonda **Steam** uygulamasını aç, alttaki **kalkan (Steam Guard)** simgesine dokun.",
        "2. **QR kodu tara**'ya bas ve bu kodu okut.",
        "3. **Onayla**'ya bas. Bu kadar!",
        "",
        "Bot bu girişle yalnız maç geçmişi kodunu okur ve Steam oturumunu hemen kapatır; şifren ya da oturumun saklanmaz. Onay ekranında konum **Almanya** görünür (botun sunucusu).",
        "",
        "⚠️ Steam QR'larını yalnız kendin istediğinde okut: başkasının gönderdiği bir QR hesabını ona açar.",
      ].join("\n"),
      image: "attachment://steam-qr.png",
      color: COLORS.accent,
      footer: "QR 2 dakika geçerli · telefondaysan aşağıdaki düğmeye dokun",
    })],
    files: [png(image, "steam-qr.png")],
    attachments: [],
    components: [row(linkButton(url, "Telefondaysan dokun", "📲"), manualButton(userId))],
  };
}

/** QR ile bağlama: QR'ı gösterir, okutulunca durumu günceller, onaylanınca hesabı bağlar. */
async function steamQr(app, interaction) {
  const userId = interaction.user.id;
  if (!interaction.deferred && !interaction.replied) await interaction.deferReply({ flags: EPHEMERAL });
  // Aynı kişi yeniden isterse eski QR geçersiz olur; iki QR aynı anda beklemez.
  app.qrLinks.get(userId)?.abort();
  const controller = new AbortController();
  app.qrLinks.set(userId, controller);
  try {
    const result = await app.steamQr.link({
      signal: controller.signal,
      onChallenge: async (url) => interaction.editReply(qrPayload(await app.renderer.render(qrSvg(url)), url, userId)),
      onScanned: () => interaction.editReply({
        embeds: [embed({ title: "📱 QR okundu", description: "Telefonda **Onayla**'ya bas. Onaylayınca maç geçmişi kodunu alıp Steam oturumunu hemen kapatacağım.", color: COLORS.info })],
        files: [], attachments: [], components: [],
      }),
    });
    const payload = await finishSteamLink(app, interaction, { ...result, verified: true, analyzeLatest: true });
    await interaction.editReply({ ...payload, attachments: [] });
  } catch (error) {
    if (controller.signal.aborted) {
      await interaction.editReply({ ...infoMessage("Bu QR'ın yerine yenisi açıldı; en son gelen QR'ı okut."), files: [], attachments: [], components: [] }).catch(() => null);
      return;
    }
    if (!error?.userFacing) log.warn("Steam QR bağlantısı başarısız", redact(error?.stack || error));
    const message = error?.userFacing ? error.message : "Steam'e bağlanılamadı. Birazdan tekrar dene ya da elle bağla.";
    await interaction.editReply({ ...errorMessage(message, { components: [row(manualButton(userId), codePageButton())] }), files: [], attachments: [] });
  } finally {
    if (app.qrLinks.get(userId) === controller) app.qrLinks.delete(userId);
  }
}

export function faceitModal(app, userId) {
  const user = app.store.getUser(userId);
  return modal(cid("modal", "faceit", userId), "FACEIT hesabını bağla", [
    { id: "kullanici", label: "FACEIT kullanıcı adın", placeholder: "örn. s1mple", value: user?.faceit_nickname || "", max: 100 },
  ]);
}

export async function startButton(app, interaction, [, action, ownerId]) {
  if (interaction.user.id !== ownerId) return interaction.reply({ ...infoMessage("Bu düğmeler başkasına ait; kendin için `/baslat` yaz."), flags: EPHEMERAL });
  if (action === "steam") return steamQr(app, interaction);
  if (action === "steamform") return interaction.showModal(steamModal(app, ownerId));
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
  const auth = String(authCode || "").trim().toUpperCase();
  const code = String(shareCode || "").trim();
  if (auth && !isAuthCode(auth)) return errorMessage("Kimlik kodu XXXX-XXXXX-XXXX biçiminde olmalı. Steam yardım sayfasından alabilirsin.");
  if (code && !isShareCode(code)) return errorMessage("Paylaşım kodu CSGO-xxxxx-xxxxx-xxxxx-xxxxx-xxxxx biçiminde olmalı.");
  if ((auth && !code) || (!auth && code)) return errorMessage("Otomatik takip için kimlik kodu ve son paylaşım kodu birlikte gerekli. Steam kod sayfasının tamamını kopyalayıp yapıştırırsan ikisini de ben bulurum.");
  let steamId;
  try {
    steamId = await app.steam.resolveSteamId(profile);
  } catch (error) {
    return errorMessage(error.message);
  }
  return finishSteamLink(app, interaction, { steamId, authCode: auth, shareCode: code });
}

/** SteamID'yi kişiye bağlar; kodlar varsa otomatik takibi açar ve istenirse son maçı hemen analize alır. */
async function finishSteamLink(app, interaction, { steamId, verified = false, authCode, shareCode, analyzeLatest = false }) {
  const userId = interaction.user.id;
  const auth = String(authCode || "").trim().toUpperCase();
  const code = String(shareCode || "").trim();
  const existing = app.store.getUser(userId);
  const sameAccount = existing?.steam_id === steamId;
  try {
    app.store.claimSteamId(userId, steamId, { verified: verified || (sameAccount && Boolean(existing?.steam_verified)) });
  } catch (error) {
    return errorMessage(error.message);
  }
  // Hesap değiştiyse eski hesabın takip kodları geçersizdir.
  if (!sameAccount) app.store.updateUser(userId, { match_auth_code: null, last_share_code: null, track_error: null });
  let summary = { name: "", avatar: "", public: null };
  try { summary = await app.steam.summary(steamId); } catch { /* API anahtarı yoksa ad bilinmez */ }
  app.store.updateUser(userId, { steam_name: summary.name || null, steam_avatar: summary.avatar || null });
  const owner = app.entitlements.isOwner(userId);
  let tracking;
  if (!auth || !code) {
    tracking = analyzeLatest
      ? "ℹ️ Steam kod sayfasında maç geçmişi kodunu göremedim. Hiç oluşturmadıysan aşağıdaki **Steam kod sayfası**nı aç, **kimlik doğrulama kodu oluştur**'a bas ve `/hesap steam` ile QR'ı bir kez daha okut. Kodun zaten varsa `/baslat` → **Steam bağla** → **elle gir** ile sayfadaki metni yapıştır."
      : "ℹ️ Otomatik takip için Steam kod sayfasındaki metni de yapıştır (ya da `/hesap steam` ile QR'la bağlan).";
  } else if (!app.features.steam) {
    tracking = `⚠️ Otomatik takip için botta Steam Web API anahtarı gerekiyor; ${owner ? "`.env`'e `STEAM_API_KEY` ekleyip botu yeniden başlat, sonra tekrar bağlan." : "bot sahibine haber ver."}`;
  } else {
    try {
      await app.steam.nextShareCode(steamId, auth, code);
    } catch (error) {
      return errorMessage(`Steam bilgileri doğrulanamadı: ${error.message}`);
    }
    app.store.updateUser(userId, { match_auth_code: encrypt(app.secretKey, auth), last_share_code: code, track_error: null });
    const downloads = app.steam.canResolveShareCodes();
    tracking = `🔁 Otomatik takip açık. Yeni Premier/Rekabetçi maçlarını ${app.config.trackerIntervalMin} dakikada bir kontrol edeceğim${downloads ? " ve kendiliğinden analiz edip sana göndereceğim." : `; yeni maç bulununca haber vereceğim.${owner ? ` (🔧 Demoları kendiliğinden indirmek için: ${app.steam.shareCodeBlocker()})` : ""}`}`;
    const user = app.store.getUser(userId);
    if (analyzeLatest && downloads && user.settings.autoAnalyze && app.entitlements.analysisAllowance({ userId }).ok) {
      app.queue.enqueue({ userId, source: { type: "sharecode", shareCode: code }, reply: { dm: true, auto: true }, dedupeKey: `sc:${code}` });
      app.entitlements.recordAnalysis(userId);
      tracking += "\n📥 Son maçını da şimdi analiz ediyorum; bitince özelden gelecek.";
    }
  }
  const verifiedNow = app.store.getUser(userId)?.steam_verified;
  const verifyLink = !verifiedNow ? app.createSteamLoginLink(userId) : null;
  const lines = [
    `✅ Steam hesabın bağlandı: **${summary.name || steamId}**${verifiedNow ? " (doğrulandı ✓)" : ""}`,
    tracking,
    verified ? "🔒 Steam oturumunu kapattım; giriş bilgilerinden hiçbirini saklamadım." : "",
    summary.public === false ? "⚠️ Steam profilin gizli görünüyor; ad ve avatar okunamayabilir." : "",
    verifyLink ? "🔒 Liderlik tablosunda ✓ işareti ve hesabının başkası tarafından sahiplenilmemesi için Steam ile doğrula:" : "",
  ].filter(Boolean);
  return {
    embeds: [embed({ title: "Steam", description: lines.join("\n"), color: COLORS.accent, thumbnail: summary.avatar || undefined })],
    components: [row(verifyLink ? linkButton(verifyLink, "Steam ile doğrula", "🔒") : null, codePageButton())],
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
    ? await linkSteam(app, interaction, { profile: field("profil"), ...extractMatchCodes(field("kodlar")) })
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
    const profile = interaction.options.getString("profil");
    // Profil verilmediyse en kolay yol: QR.
    if (!profile) return steamQr(app, interaction);
    await interaction.deferReply({ flags: EPHEMERAL });
    return interaction.editReply(await linkSteam(app, interaction, {
      profile,
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
