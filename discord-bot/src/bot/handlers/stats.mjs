// /profil, /gelisim, /faceit, /karsilastir, /liderlik ve sağ tık menüleri.
import { summarizeProgress } from "../../../engine/shared/experience.mjs";
import { compareCardSvg, faceitCardSvg, leaderboardCardSvg, profileCardSvg, progressCardSvg } from "../../render/cards/player.mjs";
import { fetchAvatar } from "../../render/png.mjs";
import { fmt } from "../../render/svg.mjs";
import { FaceitService } from "../../services/faceit.mjs";
import { greeting, memberSince } from "../text.mjs";
import { COLORS, EPHEMERAL, cid, embed, errorMessage, infoMessage, linkButton, png, row, select } from "../ui.mjs";

function avg(values) {
  const list = values.filter((value) => Number.isFinite(Number(value)) && value !== null).map(Number);
  return list.length ? list.reduce((sum, value) => sum + value, 0) / list.length : null;
}

/** Profil kartı için kişisel geçmişten özet. */
export function profileData(store, userId) {
  const matches = store.userMatches(userId, { limit: 90 });
  const progress = summarizeProgress(matches.map((item) => ({ id: item.match_id, date: item.played_at, summary: item.summary })));
  const wins = matches.filter((item) => item.result === "W").length;
  const losses = matches.filter((item) => item.result === "L").length;
  const ties = matches.filter((item) => item.result === "T").length;
  const decided = wins + losses + ties;
  const mapStats = new Map();
  for (const item of matches) {
    const entry = mapStats.get(item.map) || { map: item.map, count: 0, wins: 0 };
    entry.count++;
    if (item.result === "W") entry.wins++;
    mapStats.set(item.map, entry);
  }
  const maps = [...mapStats.values()].sort((a, b) => b.count - a.count).map((item) => ({ ...item, winRate: item.count ? (item.wins / item.count) * 100 : 0 }));
  const recent = matches.slice(0, 10).reverse();
  let streak = null;
  for (const item of matches) {
    if (!item.result) break;
    if (!streak) streak = { type: item.result, count: 1 };
    else if (streak.type === item.result) streak.count++;
    else break;
  }
  const last = matches[0];
  return {
    matches,
    progress,
    totals: { matches: matches.length, wins, losses, ties, winRate: decided ? (wins / decided) * 100 : 0 },
    maps,
    trend: recent.map((item) => (Number.isFinite(Number(item.kast)) && item.kast !== null ? Number(item.kast) : NaN)),
    trendResults: recent.map((item) => ({ W: "Galibiyet", L: "Mağlubiyet", T: "Beraberlik" })[item.result] || ""),
    streak: streak && streak.type !== "T" ? streak : null,
    last: last ? { map: last.map, score: last.user_score === null ? "" : `${last.user_score} - ${last.enemy_score}`, result: ({ W: "Galibiyet", L: "Mağlubiyet", T: "Beraberlik" })[last.result], date: last.played_at } : null,
  };
}

function privacyBlocked(app, interaction, targetId) {
  if (targetId === interaction.user.id) return false;
  const target = app.store.getUser(targetId);
  return !target || target.settings.publicProfile === false;
}

export async function profil(app, interaction, ctx, { targetUser = null } = {}) {
  const discordUser = targetUser || interaction.options?.getUser?.("kullanici") || interaction.targetUser || interaction.user;
  if (privacyBlocked(app, interaction, discordUser.id)) return interaction.reply({ ...infoMessage(`${discordUser.username} henüz TRACER kullanmıyor veya profilini gizli tutuyor.`), flags: EPHEMERAL });
  await interaction.deferReply();
  const user = app.store.getUser(discordUser.id);
  const data = profileData(app.store, discordUser.id);
  const self = discordUser.id === interaction.user.id;
  const newSince = self && ctx.previous ? data.matches.filter((item) => Number(item.added_at) > Number(ctx.previous.last_seen)).length : 0;
  const avatar = await fetchAvatar(app.avatarUrl(discordUser)) || await fetchAvatar(user?.steam_avatar);
  const svg = profileCardSvg({
    user: {
      name: user?.name || discordUser.username,
      avatarHref: avatar,
      greeting: self ? (ctx.previous ? `TEKRAR HOŞ GELDİN · ${user.visits}. ZİYARET` : "İLK KARTIN · SENİ HATIRLAYACAĞIM") : "TRACER OYUNCU KARTI",
      memberSince: memberSince(user?.first_seen),
      premium: app.entitlements.isPremium({ userId: discordUser.id }),
    },
    steam: user?.steam_id ? { id: user.steam_id, name: user.steam_name, verified: Boolean(user.steam_verified) } : null,
    faceit: user?.faceit_nickname ? { nickname: user.faceit_nickname, level: user.faceit_level, elo: user.faceit_elo } : null,
    ...data,
  });
  const image = await app.renderer.render(svg);
  const content = self ? greeting({ user, previous: ctx.previous, newMatches: newSince }) : "";
  const components = data.matches.length ? [select(cid("libopen", discordUser.id), data.matches.slice(0, 10).map((item) => ({ label: `${item.map} ${item.user_score ?? ""}-${item.enemy_score ?? ""} · ${item.played_at ? fmt.date(item.played_at, "short") : "?"}`, value: item.match_id })), { placeholder: "Son maçlardan birini aç" })] : [];
  return interaction.editReply({ content: content || undefined, embeds: [embed({ image: "attachment://tracer-profil.png", color: COLORS.accent, footer: data.matches.length ? "Ortalamalar yalnız ölçülen maçlardan · eksik ölçüm sıfır sayılmaz" : "İlk analiz için /analiz" })], files: [png(image, "tracer-profil.png")], components });
}

export async function gelisim(app, interaction) {
  const discordUser = interaction.options.getUser("kullanici") || interaction.user;
  if (privacyBlocked(app, interaction, discordUser.id)) return interaction.reply({ ...infoMessage("Bu oyuncunun profili gizli."), flags: EPHEMERAL });
  const count = interaction.options.getInteger("adet") || 15;
  const matches = app.store.userMatches(discordUser.id, { limit: count });
  if (matches.length < 2) return interaction.reply({ ...infoMessage("Gelişim grafiği için en az 2 analizli maç gerekli. `/analiz` ile devam et."), flags: EPHEMERAL });
  await interaction.deferReply();
  const user = app.store.getUser(discordUser.id);
  const avatar = await fetchAvatar(app.avatarUrl(discordUser));
  const image = await app.renderer.render(progressCardSvg({ name: user?.name || discordUser.username, matches, avatarHref: avatar }));
  const progress = summarizeProgress(matches.map((item) => ({ id: item.match_id, date: item.played_at, summary: item.summary })));
  const delta = (metric, unit) => (metric.delta === null ? "kıyas için yeterli maç yok" : `${fmt.signed(metric.delta, 1, unit)} (son 5 ↔ önceki 5)`);
  return interaction.editReply({
    embeds: [embed({ image: "attachment://tracer-gelisim.png", color: COLORS.accent, fields: [
      { name: "KAST", value: delta(progress.kast, " puan"), inline: true },
      { name: "ADR", value: delta(progress.adr, ""), inline: true },
      { name: "HS", value: delta(progress.hs, " puan"), inline: true },
    ] })],
    files: [png(image, "tracer-gelisim.png")],
  });
}

export async function faceit(app, interaction) {
  if (!app.faceit?.enabled) return interaction.reply({ ...errorMessage("Bu botta FACEIT bağlantısı kapalı (FACEIT_API_KEY yok)."), flags: EPHEMERAL });
  const nickname = interaction.options.getString("takma-ad");
  const discordUser = interaction.options.getUser("kullanici");
  await interaction.deferReply();
  try {
    let playerId;
    let avatarUrl = "";
    if (nickname) {
      const player = FaceitService.summarize(await app.faceit.findPlayer(nickname));
      playerId = player.playerId;
      avatarUrl = player.avatar;
    } else {
      const target = discordUser || interaction.user;
      if (privacyBlocked(app, interaction, target.id)) return interaction.editReply(infoMessage("Bu oyuncunun profili gizli."));
      const user = app.store.getUser(target.id);
      if (!user?.faceit_player_id) return interaction.editReply(infoMessage(target.id === interaction.user.id ? "FACEIT hesabın bağlı değil. `/hesap faceit` ile bağla." : "Bu oyuncunun FACEIT hesabı bağlı değil."));
      playerId = user.faceit_player_id;
      avatarUrl = user.faceit_avatar || "";
    }
    const scan = await app.faceit.scan(playerId);
    for (const user of [...new Set([interaction.user.id, discordUser?.id].filter(Boolean))].map((id) => app.store.getUser(id))) {
      if (user?.faceit_player_id === playerId) app.store.updateUser(user.id, { faceit_elo: scan.player.elo, faceit_level: scan.player.level, faceit_nickname: scan.player.nickname });
    }
    const avatar = await fetchAvatar(avatarUrl || scan.player.avatar);
    const image = await app.renderer.render(faceitCardSvg({ player: scan.player, matches: scan.matches, avatarHref: avatar }));
    const own = app.store.getUser(interaction.user.id)?.faceit_player_id === playerId;
    const analyzable = scan.matches.filter((match) => !match.analyzedMatchId && match.demoResource).slice(0, 25);
    const components = [row(linkButton(scan.player.url, "FACEIT profili", "🟠"))];
    if (own && analyzable.length) {
      components.unshift(select(cid("fcan", interaction.user.id), analyzable.map((match) => ({ label: `${match.map} ${match.score?.rawScore || ""} · ${fmt.date(match.timestamp, "short")}`, value: match.id, description: match.statsAvailable ? `${match.userStats?.kills}/${match.userStats?.deaths}/${match.userStats?.assists} · ADR ${match.userStats?.adr ?? "—"}` : "istatistik yok" })), { placeholder: app.faceit.canDownload ? "Tam analiz için maç seç" : "Maç seç (demo yükleme bağlantısı vereyim)" }));
    }
    return interaction.editReply({ embeds: [embed({ image: "attachment://tracer-faceit.png", color: COLORS.faceit, footer: scan.partial ? "Bazı maç ayrıntıları FACEIT'te henüz hazır değil." : undefined })], files: [png(image, "tracer-faceit.png")], components });
  } catch (error) {
    return interaction.editReply(errorMessage(error.message));
  }
}

/** FACEIT maç seçimi: Downloads izni varsa otomatik, yoksa yükleme bağlantısı. */
export async function faceitAnalyze(app, interaction, [, ownerId]) {
  if (interaction.user.id !== ownerId) return interaction.reply({ ...errorMessage("Bu liste başkasına ait."), flags: EPHEMERAL });
  const id = interaction.values?.[0];
  const match = app.store.faceitMatch(id);
  if (!match) return interaction.reply({ ...errorMessage("FACEIT maçı bulunamadı."), flags: EPHEMERAL });
  if (!app.faceit.canDownload) {
    const link = app.createUploadLink(ownerId, { guildId: interaction.guildId, channelId: interaction.channelId });
    return interaction.reply({
      embeds: [embed({ title: "FACEIT demosunu yükle", description: `1. [Maç odasını aç](${match.faceitUrl}) → **Watch demo / Demoyu izle** ile \`.dem.gz\` dosyasını indir.\n2. ${link ? "Aşağıdaki bağlantıdan yükle." : "`/analiz dosya:` ile ekle (10 MB sınırı)."}`, color: COLORS.faceit })],
      components: link ? [row(linkButton(link, "Demo yükle", "📤"))] : [],
      flags: EPHEMERAL,
    });
  }
  const allowance = app.entitlements.analysisAllowance({ userId: ownerId, guildId: interaction.guildId, interaction });
  if (!allowance.ok) return interaction.reply({ ...errorMessage(`Bugünkü ücretsiz analiz hakkın doldu (${allowance.used}/${allowance.limit}).`), flags: EPHEMERAL });
  await interaction.deferReply();
  const result = app.queue.enqueue({ userId: ownerId, guildId: interaction.guildId, channelId: interaction.channelId, source: { type: "faceit", id }, reply: { applicationId: interaction.applicationId, token: interaction.token, createdAt: Date.now() }, dedupeKey: `fc:${id}` });
  if (!result.duplicate) app.entitlements.recordAnalysis(ownerId);
  return interaction.editReply(infoMessage(result.duplicate ? "Bu maç zaten kuyrukta." : `FACEIT demosu sıraya alındı (iş #${result.job.id}, sıradaki ${result.position}.).`));
}

function compareRows(store, userId) {
  const matches = store.userMatches(userId, { limit: 10 });
  const kd = avg(matches.map((item) => (Number(item.deaths) > 0 ? item.kills / item.deaths : null)));
  const decided = matches.filter((item) => item.result);
  const reactions = matches.map((item) => item.summary?.aimMetrics?.medianTTD).filter((value) => Number.isFinite(Number(value)) && value !== null);
  return {
    count: matches.length,
    kast: avg(matches.map((item) => item.kast)),
    adr: avg(matches.map((item) => item.adr)),
    hs: avg(matches.map((item) => item.hs)),
    kd,
    reaction: avg(reactions),
    win: decided.length ? (decided.filter((item) => item.result === "W").length / decided.length) * 100 : null,
  };
}

export async function karsilastir(app, interaction, ctx, { left: leftUser = null, right: rightUser = null } = {}) {
  const right = rightUser || interaction.options?.getUser?.("kullanici") || interaction.targetUser;
  const left = leftUser || interaction.options?.getUser?.("diger") || interaction.user;
  if (!right || left.id === right.id) return interaction.reply({ ...infoMessage("Karşılaştırmak için iki farklı oyuncu seç."), flags: EPHEMERAL });
  for (const target of [left, right]) {
    if (privacyBlocked(app, interaction, target.id)) return interaction.reply({ ...infoMessage(`${target.username} TRACER kullanmıyor veya profilini gizli tutuyor.`), flags: EPHEMERAL });
  }
  const a = compareRows(app.store, left.id);
  const b = compareRows(app.store, right.id);
  if (!a.count || !b.count) return interaction.reply({ ...infoMessage("İki oyuncunun da en az bir analizli maçı olmalı."), flags: EPHEMERAL });
  await interaction.deferReply();
  const [avatarA, avatarB] = await Promise.all([fetchAvatar(app.avatarUrl(left)), fetchAvatar(app.avatarUrl(right))]);
  const percent = (value) => `%${fmt.number(value, 1)}`;
  const image = await app.renderer.render(compareCardSvg({
    left: { name: app.store.getUser(left.id)?.name || left.username, avatarHref: avatarA, subtitle: `son ${a.count} maç` },
    right: { name: app.store.getUser(right.id)?.name || right.username, avatarHref: avatarB, subtitle: `son ${b.count} maç` },
    rows: [
      { label: "KAST", a: a.kast, b: b.kast, format: percent },
      { label: "ADR", a: a.adr, b: b.adr, format: (value) => fmt.number(value, 1) },
      { label: "HS", a: a.hs, b: b.hs, format: (value) => `%${fmt.number(value, 0)}` },
      { label: "K/D", a: a.kd, b: b.kd, format: (value) => fmt.number(value, 2) },
      { label: "Tepki (TTD medyan)", a: a.reaction, b: b.reaction, higherIsBetter: false, format: (value) => `${Math.round(value)} ms` },
      { label: "Galibiyet", a: a.win, b: b.win, format: (value) => `%${Math.round(value)}` },
    ],
  }));
  return interaction.editReply({ embeds: [embed({ image: "attachment://tracer-karsilastirma.png", color: COLORS.accent, footer: "Yalnız ölçülen değerler karşılaştırılır" })], files: [png(image, "tracer-karsilastirma.png")] });
}

const METRICS = {
  kast: { label: "KAST ortalaması", read: (rows) => avg(rows.map((item) => item.kast)), format: (value) => `%${fmt.number(value, 1)}` },
  adr: { label: "ADR ortalaması", read: (rows) => avg(rows.map((item) => item.adr)), format: (value) => fmt.number(value, 1) },
  hs: { label: "HS ortalaması", read: (rows) => avg(rows.map((item) => item.hs)), format: (value) => `%${fmt.number(value, 0)}` },
  kd: { label: "K/D", read: (rows) => { const kills = rows.reduce((sum, item) => sum + (Number(item.kills) || 0), 0); const deaths = rows.reduce((sum, item) => sum + (Number(item.deaths) || 0), 0); return deaths ? kills / deaths : null; }, format: (value) => fmt.number(value, 2) },
  win: { label: "Galibiyet oranı", read: (rows) => { const decided = rows.filter((item) => item.result); return decided.length ? (decided.filter((item) => item.result === "W").length / decided.length) * 100 : null; }, format: (value) => `%${Math.round(value)}` },
  matches: { label: "Analizli maç sayısı", read: (rows) => rows.length, format: (value) => String(value) },
};

export async function liderlik(app, interaction) {
  const guild = app.store.getGuild(interaction.guildId);
  if (guild && !guild.leaderboard) return interaction.reply({ ...infoMessage("Bu sunucuda liderlik tablosu kapalı."), flags: EPHEMERAL });
  const key = interaction.options.getString("olcut") || "kast";
  const days = interaction.options.getInteger("gun") || 30;
  const metric = METRICS[key] || METRICS.kast;
  const since = Date.now() - days * 86_400_000;
  const minimum = key === "matches" ? 1 : 3;
  const rows = [];
  for (const userId of app.store.guildMemberIds(interaction.guildId)) {
    const user = app.store.getUser(userId);
    if (!user || user.settings.publicProfile === false) continue;
    const matches = app.store.userMatches(userId, { limit: 200 }).filter((item) => Number(item.played_at) >= since);
    if (matches.length < minimum) continue;
    const value = metric.read(matches);
    if (value === null || !Number.isFinite(value)) continue;
    rows.push({ userId, name: `${user.name}${user.steam_verified ? " ✓" : ""}`, value, display: metric.format(value), sub: `${matches.length} maç · ADR ${fmt.number(avg(matches.map((item) => item.adr)), 0)}` });
  }
  rows.sort((a, b) => b.value - a.value);
  const top = rows.slice(0, 10);
  await interaction.deferReply();
  const members = await Promise.all(top.map(async (item) => {
    try { return await interaction.client.users.fetch(item.userId); } catch { return null; }
  }));
  const avatars = await Promise.all(members.map((member) => fetchAvatar(app.avatarUrl(member))));
  const image = await app.renderer.render(leaderboardCardSvg({
    title: `${interaction.guild?.name || "Sunucu"} · ${metric.label}`,
    subtitle: `Son ${days >= 3650 ? "tüm zamanlar" : `${days} gün`} · en az ${minimum} maç · ${rows.length} oyuncu`,
    metricLabel: metric.label,
    rows: top.map((item, index) => ({ ...item, avatarHref: avatars[index] })),
  }));
  const own = rows.findIndex((item) => item.userId === interaction.user.id);
  return interaction.editReply({ content: own >= 0 ? `Senin sıran: **${own + 1}.** (${rows[own].display})` : "Listede yoksan: hesabını bağla ve en az birkaç maç analiz ettir.", embeds: [embed({ image: "attachment://tracer-liderlik.png", color: COLORS.accent })], files: [png(image, "tracer-liderlik.png")] });
}

export async function userContext(app, interaction, ctx) {
  if (interaction.commandName === "TRACER profili") return profil(app, interaction, ctx, { targetUser: interaction.targetUser });
  return karsilastir(app, interaction, ctx, { left: interaction.user, right: interaction.targetUser });
}
