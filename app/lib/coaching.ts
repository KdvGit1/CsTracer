import type {
  CoachFinding,
  CoachPacket,
  CoachRule,
  DeathDetail,
  DeathPattern,
  ErrorSeverity,
  MovementProfile,
  PlayerReport,
} from "./types";
import { getAngleTier, getSprayTier } from "./format";

// Bu eşikler profesyonel benchmark değildir. Yalnız aynı maç içinde video
// incelemesine aday tekrarları seçen, kullanıcıya açık TRACER kurallarıdır.
export const COACH_THRESHOLDS = {
  movementReview: { minimumShots: 8, share: 20, highShare: 35 },
  sprayReview: { minimumEarlyShots: 6, minimumLateShots: 6, lateToEarlyRatio: 0.5 },
  tradeReview: { minimumDeaths: 4 },
} as const;

export const COACH_RULES: CoachRule[] = [
  { id: "aim_crosshair", area: "Kill Anı Nişangah Hizası", title: "Kill tick'i kafa/gövde açısı", target: "Puanlanmaz; maçtan maça yalnız aynı yöntemle izlenir", rationale: "Öldürme anındaki nişangah-hedef açısını doğrudan gösterir.", caveat: "Harita raycast'i olmadığı için pre-aim, görünür ilk temas veya profesyonel seviye ölçümü değildir." },
  { id: "aim_spray", area: "Sprey & Recoil", title: "Burst ve uzun seri karşılaştırması", target: "İlk 3 ve 4+ mermi gruplarında en az 10'ar doğrudan eşleşme", rationale: "Aynı maç içinde uzayan serideki isabet kaybını görünür yapar.", caveat: "weapon_fire ve bullet_damage aynı saldırgan + normal demo tick'iyle eşleşmezse değer üretilmez; menzil ayrıca sınıflandırılmaz." },
  { id: "duel_ttd", area: "İlk Temas & TTD", title: "Yaklaşık görünürlükten ilk hasara", target: "Bilgi metriği; puan veya seviye üretmez", rationale: "approximate_spotted_by başlangıcından silahlı ilk hasara kadar geçen süreyi gösterir.", caveat: "Spotted verisi yaklaşık olduğundan reaksiyon veya pre-aim hükmü değildir." },
  { id: "movement", area: "Atış Anı Hareket Uygunluğu", title: "Silahın doğruluk hız sınırı", target: "Her atışta hız ≤ demo max_speed değerinin %34'ü", rationale: "Sabit silah eşiği yerine o tick'teki silah hız sınırını kullanır.", caveat: "Bu gerçek counter-strafe girdisini ölçmez; max_speed/hız yoksa atış temiz kabul edilmez, ölçülemedi olarak ayrılır." },
  { id: "trade", area: "Takım & Trade", title: "Beş saniye içindeki takım cevabı", target: "Aynı round, aynı killer SteamID ve doğru takım doğrulaması", rationale: "Ölümden sonra killer'ın takım arkadaşı tarafından düşürülmesini doğrudan sayar.", caveat: "Beş saniye ürün kuralıdır; görüş hattı veya rol uygunluğu kanıtlanmaz." },
  { id: "position", area: "Harita Pozisyonu", title: "Tekrarlayan ölüm kümesi", target: "Aynı bölgede 3+ ölümde round incelemesi", rationale: "Aynı açı, zamanlama veya geri düşme planındaki tekrarları görünür yapar.", caveat: "Bölge etiketi geniş olabilir; sebep aim, utility, ekonomi veya takım planı olabilir." },
  { id: "utility", area: "Utility & Flash", title: "Rakibe doğrudan utility etkisi", target: "Hasar veya körlük üretilen round yüzdesi", rationale: "Yalnız karşı takım doğrulanmış hasar ve körlük olaylarını sayar.", caveat: "Takım arkadaşına açılan ama asist olayı üretmeyen flash değeri eksik kalabilir." },
  { id: "opening", area: "Açılış Düellosu (Entry)", title: "İlk temas dengesi", target: "Opening farkı negatif olmamalı", rationale: "İlk ölümün takımın round kazanma ihtimaline etkisi yüksektir.", caveat: "Entry rolü daha fazla risk alır; kararın doğruluğu spawn, ekonomi ve planla birlikte değerlendirilir." },
  { id: "damage", area: "Hasar Katkısı (ADR)", title: "Round başına rakip hasarı", target: "Doğrudan gösterilir; tek başına iyi/kötü etiketi almaz", rationale: "Roundlar boyunca çatışma katkısını izler.", caveat: "Rol, silah ve takım planı bilinmeden evrensel ADR hedefi uygulanmaz." },
];

export const SEVERITY_LABEL: Record<ErrorSeverity, string> = {
  critical: "Kritik", high: "Yüksek", moderate: "Orta", minor: "Küçük", info: "Bilgi", strong: "Güçlü",
};
export const SEVERITY_RANK: Record<ErrorSeverity, number> = { critical: 0, high: 1, moderate: 2, minor: 3, info: 4, strong: 5 };

export function explainMovement(profile: MovementProfile) {
  const fastShotsPerTen = Math.max(0, Math.min(10, Math.round(profile.fastPercent / 10)));
  const severityMeaning = profile.status !== "measured"
    ? "Hız veya max_speed alanı çıkmadığı için hareket sonucu üretilmedi."
    : `Ölçülen atışların %${profile.invalidShotPercent} kadarı silahın max_speed değerinin %34'lük doğruluk sınırını aştı veya havadayken atıldı.`;
  const rifleMov = profile.byCategory?.rifle?.movingPercent ?? 0;
  const sniperMov = profile.byCategory?.sniper?.movingPercent ?? 0;
  const smgMov = profile.byCategory?.smg?.movingPercent ?? 0;
  return {
    summary: `Basitçe: Her 10 atışın yaklaşık ${fastShotsPerTen} tanesinde duruş hız sınırını aştın. ${severityMeaning}`,
    average: `Ortalama ${profile.averageSpeed} u/s: Tetiğe bastığın anlardaki ortalama hareket hızın; silahın hızı veya FPS değil.`,
    p90: `P90 ${profile.p90Speed} u/s: Atışlarının %90'ında bu hızda ya da daha yavaştın.`,
    micro: `Mikro %${profile.microPercent}: Küçük ayak kaymaları.`,
    fast: `Yüksek Hız %${profile.fastPercent}: Belirgin biçimde hareket ederken atılan mermiler.`,
    score: `%${profile.invalidShotPercent} doğrudan sınır üstü atış payıdır; birleşik veya profesyonel puan değildir. ${profile.unmeasuredShots} atış eksik veri nedeniyle dışarıda tutuldu.`,
    byWeaponNote: `Tüfek sınır üstü: %${rifleMov} · Sniper: %${sniperMov} · SMG: %${smgMov}. Her kategori kendi tick max_speed değerine göre ölçülür.`,
  };
}

export function severityForCount(count: number, share: number): Exclude<ErrorSeverity, "strong"> {
  if (count >= 5 || (count >= 4 && share >= 45)) return "critical";
  if (count >= 4 || (count >= 3 && share >= 35)) return "high";
  if (count >= 3 || (count >= 2 && share >= 25)) return "moderate";
  return count >= 2 ? "minor" : "info";
}

export function buildDeathPatterns(report: PlayerReport): DeathPattern[] {
  const deaths = report.deathDetails || [];
  if (!deaths.length) return [];
  const total = deaths.length;
  const share = (count: number) => Math.round(count / total * 100);
  const rounds = (items: DeathDetail[]) => [...new Set(items.map((item) => item.round))].sort((a, b) => a - b).slice(0, 8);
  const patterns: DeathPattern[] = [];
  const add = (pattern: Omit<DeathPattern, "share" | "severity"> & { severity?: DeathPattern["severity"] }) => {
    const patternShare = share(pattern.count);
    patterns.push({ ...pattern, share: patternShare, severity: pattern.severity || severityForCount(pattern.count, patternShare) });
  };

  const byZone = new Map<string, DeathDetail[]>();
  deaths.forEach((death) => byZone.set(death.zone, [...(byZone.get(death.zone) || []), death]));
  const [zone, zoneDeaths] = [...byZone.entries()].sort((a, b) => b[1].length - a[1].length)[0] || [];
  if (zone && zoneDeaths.length >= 2) add({
    id: "zone-cluster", category: "Pozisyon", title: `${zone} bölgesinde ölüm kümesi`, count: zoneDeaths.length,
    confidence: Math.min(92, 58 + zoneDeaths.length * 7), rounds: rounds(zoneDeaths),
    evidence: `${zoneDeaths.length}/${total} ölüm bu bölgede; roundlar ${rounds(zoneDeaths).map((round) => `R${round}`).join(", ")}.`,
    interpretation: "Tekrar eden açı, yeniden peek, geç rotasyon veya utility eksikliği ihtimalleri bu roundlarda ayrı ayrı doğrulanmalı.",
  });

  const isolated = deaths.filter((death) => !death.traded && (death.nearestTeammate === null || death.nearestTeammate > 800));
  if (isolated.length >= 2) add({
    id: "isolated", category: "Takım oyunu", title: "İzole ve çevrilemeyen temaslar", count: isolated.length,
    confidence: 78, rounds: rounds(isolated), evidence: `${isolated.length}/${total} ölümde trade yok ve en yakın takım arkadaşı 800u dışında ya da ölçülememiş.`,
    interpretation: "Mesafe tek başına görüş hattını kanıtlamaz; temas zamanlaması ve takımın aynı açıya erişimi round görüntüsünde kontrol edilmeli.",
  });

  const openings = deaths.filter((death) => death.openingDeath);
  if (openings.length) add({
    id: "opening", category: "Round etkisi", title: "Roundun ilk kaybı", count: openings.length,
    severity: openings.length >= 4 ? "high" : openings.length >= 2 ? "moderate" : "minor",
    confidence: 88, rounds: rounds(openings), evidence: `${openings.length} round takımın ilk ölümü oldun.`,
    interpretation: "Entry rolü planlı risk alabilir; spawn, ekonomi, takım flashı ve geri düşme yolu sonucu belirler.",
  });

  const blindDeaths = deaths.filter((death) => death.wasBlind);
  if (blindDeaths.length) add({
    id: "blind", category: "Utility", title: "Körken alınan ölümler", count: blindDeaths.length,
    severity: blindDeaths.length >= 3 ? "high" : blindDeaths.length === 2 ? "moderate" : "minor",
    confidence: 76, rounds: rounds(blindDeaths), evidence: `${blindDeaths.length} ölümden hemen önce player_blind olayı kaydedildi.`,
    interpretation: "Anti-flash açı, takım çağrısı veya geri düşme zamanlaması eksik kalmış olabilir; körlük süresi yaklaşık eşleştirilir.",
  });

  const fastDeaths = deaths.filter((death) => (death.speed || 0) > 120);
  if (fastDeaths.length >= 2) add({
    id: "fast-death", category: "Hareket", title: "Yüksek hızda yakalanma", count: fastDeaths.length,
    severity: fastDeaths.length >= 4 ? "high" : fastDeaths.length >= 3 ? "moderate" : "minor",
    confidence: 70, rounds: rounds(fastDeaths), evidence: `${fastDeaths.length} ölüm anında yatay hız 120 u/s üzerindeydi.`,
    interpretation: "Rotasyon, geniş swing veya kaçış sırasında yakalanmış olabilirsin; bu doğrudan aim hatası sayılmaz.",
  });

  const byWeapon = new Map<string, DeathDetail[]>();
  deaths.forEach((death) => byWeapon.set(death.weapon || "bilinmeyen silah", [...(byWeapon.get(death.weapon || "bilinmeyen silah") || []), death]));
  const [weapon, weaponDeaths] = [...byWeapon.entries()].sort((a, b) => b[1].length - a[1].length)[0] || [];
  if (weapon && weaponDeaths.length >= 3) add({
    id: "weapon-repeat", category: "Eşleşme", title: `${weapon.toUpperCase()} karşısında tekrar`, count: weaponDeaths.length,
    severity: weaponDeaths.length >= 5 ? "high" : "moderate", confidence: 82, rounds: rounds(weaponDeaths),
    evidence: `${weaponDeaths.length}/${total} ölüm aynı silaha karşı geldi.`,
    interpretation: "Mesafe, açı avantajı ve ekonomi birlikte incelenmeli; aynı silaha ölmek tek başına mekanik zayıflık kanıtı değildir.",
  });

  const byKiller = new Map<string, DeathDetail[]>();
  deaths.filter((death) => death.killer && death.killer !== "Bilinmiyor").forEach((death) => byKiller.set(death.killer, [...(byKiller.get(death.killer) || []), death]));
  const [killer, killerDeaths] = [...byKiller.entries()].sort((a, b) => b[1].length - a[1].length)[0] || [];
  if (killer && killerDeaths.length >= 3) add({
    id: "killer-repeat", category: "Rakip eşleşmesi", title: `${killer} karşısında tekrar`, count: killerDeaths.length,
    severity: killerDeaths.length >= 5 ? "high" : "moderate", confidence: 88, rounds: rounds(killerDeaths),
    evidence: `${killerDeaths.length}/${total} ölüm aynı rakipten geldi; roundlar ${rounds(killerDeaths).map((round) => `R${round}`).join(", ")}.`,
    interpretation: "Aynı açıya alışkanlıkla dönme, silah/mesafe dezavantajı veya rakibin seni okuması ihtimalleri birlikte incelenmeli.",
  });

  const bySide = new Map<string, DeathDetail[]>();
  deaths.filter((death) => death.side === "CT" || death.side === "T").forEach((death) => bySide.set(death.side || "Unknown", [...(bySide.get(death.side || "Unknown") || []), death]));
  const [side, sideDeaths] = [...bySide.entries()].sort((a, b) => b[1].length - a[1].length)[0] || [];
  if (side && sideDeaths.length >= 4 && share(sideDeaths.length) >= 65) add({
    id: "side-concentration", category: "Taraf", title: `${side} tarafında ölüm yoğunluğu`, count: sideDeaths.length,
    severity: sideDeaths.length >= 7 && share(sideDeaths.length) >= 75 ? "moderate" : "info", confidence: 90, rounds: rounds(sideDeaths),
    evidence: `Ölümlerin %${share(sideDeaths.length)} kadarı ${side} tarafında gerçekleşti.`,
    interpretation: "Taraf başına oynanan round sayısı ve rol farkı hesaba katılmadan bu dağılım tek başına hata sayılmaz.",
  });

  return patterns.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || b.count - a.count);
}

export function buildCoachPacket(report: PlayerReport): CoachPacket {
  const rounds = Math.max(1, report.rounds);
  const deaths = Math.max(1, report.deaths);
  const zoneCounts = new Map<string, number>();
  for (const detail of report.deathDetails) zoneCounts.set(detail.zone, (zoneCounts.get(detail.zone) || 0) + 1);
  const positionZones = [...zoneCounts.entries()].map(([zone, count]) => ({ zone, deaths: count, share: Math.round(count / deaths * 100) })).sort((a, b) => b.deaths - a.deaths);
  const topZone = positionZones[0] || { zone: report.topZone || "Bilinmeyen bölge", deaths: report.topZoneDeaths || 0, share: 0 };
  const utilityPerRound = report.utilityDamage / rounds;
  const openingDifference = report.openingKills - report.openingDeaths;
  const sampleConfidence = Math.min(92, 58 + Math.min(14, report.deaths) * 2);
  const movement = report.movementProfile;
  const movementSeverity: ErrorSeverity = movement?.status !== "measured" ? "info" : movement.severity === "severe" ? "high" : movement.severity === "moderate" ? "moderate" : movement.severity === "minor" ? "minor" : "info";
  const duelStats = report.duelStats;
  const hasMeasuredTtd = duelStats?.ttdMethod === "spotted-to-first-damage-v2" && duelStats.ttdStatus === "measured" && duelStats.medianTTD !== null;
  const hasMeasuredDuels = duelStats?.duelMethod === "mutual-spotted-death-v2" && duelStats.duelStatus === "measured" && duelStats.duelWinrate !== null;
  const measuredTtd = duelStats?.medianTTD ?? null;
  const duelFinding: CoachFinding | null = duelStats ? {
    id: "duel_ttd",
    area: "Yaklaşık Temas & Karşılıklı Düello",
    title: hasMeasuredTtd || hasMeasuredDuels ? "Yaklaşık temas metrikleri ölçüldü" : "Temas metriği için yeterli örnek yok",
    evidence: [
      hasMeasuredTtd
        ? `Yaklaşık TTD medyan ${measuredTtd} ms, ortalama ${duelStats.averageTTD} ms (${duelStats.ttdSampleCount} geçerli temas; ${duelStats.reactionRating}).`
        : "TTD için yeterli görünür temas örneği yok.",
      hasMeasuredDuels
        ? `Karşılıklı görünür düellolarda ${duelStats.duelWins} galibiyet / ${duelStats.duelLosses || 0} mağlubiyet (%${duelStats.duelWinrate}).`
        : "Karşılıklı düello oranı için yeterli sonuç yok.",
    ].filter(Boolean).join(" "),
    interpretation: "approximate_spotted_by görüş hattının yaklaşık temsilidir; bu değerler reaksiyon veya profesyonel seviye puanı değildir.",
    action: "Aynı yöntemle sonraki maçları karşılaştır; karar vermeden önce ilgili round videosunu doğrula.",
    severity: "info",
    confidence: Math.min(78, 50 + Math.min(18, duelStats.ttdSampleCount || 0) + Math.min(10, duelStats.duelTotal)),
  } : null;

  const findings: CoachFinding[] = [
    ...(report.crosshairStats ? [{
      id: "aim_crosshair", area: "Kill Anı Nişangah Hizası",
      title: report.crosshairStats.status === "measured" ? `Kill anı hizası: ${getAngleTier(report.crosshairStats.headErrorAngle, "head").label}` : "Kill tick'i hizası ölçülemedi",
      evidence: report.crosshairStats.status === "measured" ? `${report.crosshairStats.sampleCount} kill örneğinde medyan kafa sapması ${report.crosshairStats.headErrorAngle}°, gövde sapması ${report.crosshairStats.bodyErrorAngle}°.` : (report.crosshairStats.reason || "Geçerli örnek yok."),
      interpretation: "Bu ölçüm öldürme anını gösterir; köşe ön nişanı, ilk görünür temas veya görüş hattı raycast'i değildir.",
      action: "Değeri yalnız aynı yöntemli sonraki maçlarla ve ilgili kill videolarıyla birlikte yorumla.",
      severity: "info" as ErrorSeverity,
      confidence: report.crosshairStats.status === "measured" ? 64 : 40,
    }] : []),
    ...(report.sprayStats?.method === "bullet-damage-event-tick-v2" && report.sprayStats.status === "measured" ? [{
      id: "aim_spray", area: "Sprey & Recoil",
      title: report.sprayStats.earlyAccuracy !== null && report.sprayStats.lateAccuracy !== null && report.sprayStats.lateShots >= COACH_THRESHOLDS.sprayReview.minimumLateShots && report.sprayStats.lateAccuracy < report.sprayStats.earlyAccuracy * COACH_THRESHOLDS.sprayReview.lateToEarlyRatio ? "Uzayan spreyde kişisel isabet düşüyor" : `Genel silahlı isabet: ${getSprayTier(report.sprayStats.accuracyPercent, "overall").label}`,
      evidence: `Toplam ${report.sprayStats.totalShots} atışta %${report.sprayStats.accuracyPercent} isabet (${report.sprayStats.totalHits} hit). İlk 3 mermi %${report.sprayStats.earlyAccuracy}, 4+ mermi sprey %${report.sprayStats.lateAccuracy} isabet.`,
      interpretation: "Bu oranlar weapon_fire ile saldırgan SteamID + normal demo tick'inde eşleşen doğrudan bullet_damage olaylarından gelir; menzil ayrıca sınıflandırılmadı.",
      action: report.sprayStats.earlyAccuracy !== null && report.sprayStats.lateAccuracy !== null && report.sprayStats.lateShots >= COACH_THRESHOLDS.sprayReview.minimumLateShots && report.sprayStats.lateAccuracy < report.sprayStats.earlyAccuracy * COACH_THRESHOLDS.sprayReview.lateToEarlyRatio ? "Uzun seri roundlarını izle; Recoil Master'da aynı silahla ilk-3/4+ farkını azalt." : "Aynı örnek sayısıyla sonraki demoda yeniden karşılaştır.",
      severity: (report.sprayStats.earlyAccuracy !== null && report.sprayStats.lateAccuracy !== null && report.sprayStats.lateShots >= COACH_THRESHOLDS.sprayReview.minimumLateShots && report.sprayStats.lateAccuracy < report.sprayStats.earlyAccuracy * COACH_THRESHOLDS.sprayReview.lateToEarlyRatio ? "moderate" : "info") as ErrorSeverity,
      confidence: 84,
    }] : []),
    ...(duelFinding ? [duelFinding] : []),
    {
      id: "movement", area: "Atış Anı Hareket Uygunluğu",
      title: movement?.status !== "measured" ? "Atış hızı ölçülemedi" : movement.severity === "severe" ? "Doğruluk hız sınırı sık aşılıyor" : movement.severity === "moderate" ? "Duruş zamanlaması incelenmeli" : movement.severity === "minor" ? "Bazı atışlar hız sınırı üzerinde" : "Atış öncesi duruş iyi",
      evidence: movement?.status === "measured" ? `${movement.sampleCount} ölçülen atış · ortalama ${movement.averageSpeed} u/s · P90 ${movement.p90Speed} u/s · max_speed %34 sınırı üstünde %${movement.invalidShotPercent} · ${movement.unmeasuredShots} ölçülemeyen.` : (movement?.reason || "Hız/max_speed verisi bulunamadı."),
      interpretation: movement?.status === "measured" ? explainMovement(movement).summary : "Eksik veri sıfır hız veya temiz atış kabul edilmedi.",
      action: movementSeverity === "high" || movementSeverity === "moderate" ? "Antrenmanda 50 tekli A-D frenleme tekrarı yap; ilk mermiden önce hızın doğruluk bandına indiğini doğrula." : "Aynı yöntemi sonraki demoda tekrar ölç.",
      severity: movementSeverity,
      confidence: report.shots >= 80 ? 88 : report.shots >= 25 ? 76 : 58,
    },
    {
      id: "trade", area: "Takım & Trade",
      title: report.deaths < COACH_THRESHOLDS.tradeReview.minimumDeaths ? `${report.deaths} ölümde trade bilgisi` : report.untradedDeaths > report.deaths - report.untradedDeaths ? "Ölümlerin çoğu beş saniyede çevrilmedi" : "Trade dengesi iyi",
      evidence: report.deaths > 0 ? `${report.untradedDeaths}/${report.deaths} ölüm 5 saniye içinde takım tarafından çevrilmedi; trade oranı %${report.tradePercent}.` : "Trade için ölüm örneği yok.",
      interpretation: "Aynı round, killer kimliği, takım ve beş saniye penceresi doğrulandı; görüş hattı ve rol uygunluğu ölçülmedi.",
      action: report.deaths >= COACH_THRESHOLDS.tradeReview.minimumDeaths && report.untradedDeaths > report.deaths - report.untradedDeaths ? "Çevrilmeyen ölüm roundlarında ikinci oyuncunun mesafe ve görüş hattını video üzerinden kontrol et." : "Aynı yöntemle örnek sayısını büyüt.",
      severity: report.deaths >= COACH_THRESHOLDS.tradeReview.minimumDeaths && report.untradedDeaths > report.deaths - report.untradedDeaths ? "moderate" : "info",
      confidence: report.deaths >= 10 ? 86 : 68,
    },
    {
      id: "position", area: "Harita Pozisyonu",
      title: topZone.deaths >= 3 ? `${topZone.zone} tekrar eden risk alanı` : "Belirgin ölüm kümesi yok",
      evidence: `${topZone.zone}: ${topZone.deaths} ölüm (%${topZone.share}). Taranan bölgeler: ${positionZones.slice(0, 4).map((item) => `${item.zone} ${item.deaths}`).join(", ") || "veri yok"}.`,
      interpretation: topZone.deaths >= 3 ? "Aynı açı, yeniden peek, utility eksikliği veya geç rotasyon ihtimalleri round görüntüsüyle ayrıştırılmalı." : "Ölümler tek bir pozisyona aşırı yığılmamış.",
      action: topZone.deaths >= 3 ? `${topZone.zone} ölümlerini sırayla izle; her biri için ilk temas, kaçış rotası, takım görüşü ve rakip utility sütunlarını işaretle.` : "Yeni demolarla konum örneğini büyüt; iki maç üst üste tekrarlayan bölgeleri önceliklendir.",
      severity: topZone.deaths >= 5 && topZone.share >= 45 ? "critical" : topZone.deaths >= 4 || topZone.share >= 40 ? "high" : topZone.deaths >= 3 ? "moderate" : topZone.deaths >= 2 ? "minor" : "strong",
      confidence: report.deaths >= 8 ? sampleConfidence : 62,
    },
    {
      id: "utility", area: "Utility & Flash",
      title: report.utilityDamage === 0 && report.enemyBlindSeconds === 0 ? "Rakibe doğrudan utility etkisi kaydedilmedi" : "Rakibe utility etkisi ölçüldü",
      evidence: `${report.utilityDamage} utility hasarı (${utilityPerRound.toFixed(1)}/round), ${report.flashesThrown} flash ve ${report.enemyBlindSeconds.toFixed(1)} sn rakip körlüğü.`,
      interpretation: `Karşı takım doğrulaması yapıldı; utility etkisi bulunan round payı %${report.utilityImpactRoundPercent ?? 0}. Takım arkadaşına açılan bazı flashlar event üretmeyebilir.`,
      action: report.utilityDamage === 0 && report.enemyBlindSeconds === 0 && report.rounds >= 8 ? "Oynadığın iki ana pozisyon için bir temas flashı ve geciktirme molotofu belirle; sonraki demoda etkili round sayısını izle." : "Etkili roundları video üzerinden doğrula ve aynı setleri kaydet.",
      severity: report.utilityDamage === 0 && report.enemyBlindSeconds === 0 && report.rounds >= 8 ? "minor" : "info",
      confidence: 72,
    },
    {
      id: "opening", area: "Açılış Düellosu (Entry)",
      title: openingDifference < -1 ? "Açılış düellolarında fazla kayıp" : openingDifference < 0 ? "Opening dengesi hafif negatif" : "Opening dengesi korunuyor",
      evidence: `${report.openingKills} opening kill, ${report.openingDeaths} opening death; fark ${openingDifference >= 0 ? "+" : ""}${openingDifference}.`,
      interpretation: openingDifference < 0 ? "Erken riskler takımını eksik başlatmış olabilir; rol ve round planı doğrulanmalı." : "İlk temas sonucu bu maçta negatif değil.",
      action: openingDifference < 0 ? "Opening death roundlarında spawn avantajı, takım flashı, geri düşme yolu ve ekonomi kararını birlikte kontrol et." : "Olumlu açılışları aynı koşullarla tekrarla; gereksiz ikinci temastan kaçın.",
      severity: openingDifference <= -5 ? "critical" : openingDifference <= -3 ? "high" : openingDifference <= -2 ? "moderate" : openingDifference < 0 ? "minor" : "strong",
      confidence: report.openingKills + report.openingDeaths >= 5 ? 82 : 64,
    },
    {
      id: "damage", area: "Hasar Katkısı (ADR)",
      title: "Rakibe round başına hasar ölçümü",
      evidence: `${report.adr.toFixed(1)} ADR, ${report.kills}/${report.deaths} K/D ve ${report.assists} asist.`,
      interpretation: "ADR doğrudan rakip hasarıdır; rol ve silah bağlamı olmadan iyi/kötü etiketi verilmedi.",
      action: "Kendi son maçlarınla ve aynı taraftaki roundlarla karşılaştır.",
      severity: "info",
      confidence: report.rounds >= 12 ? 84 : 66,
    },
  ];

  const priorities = [...findings].filter((item) => item.severity !== "strong" && item.severity !== "info").sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || b.confidence - a.confidence);
  const strengths = findings.filter((item) => item.severity === "strong");
  const focus = priorities.slice(0, 2);
  const summary = focus.length
    ? `${report.map || "Bu maç"} genelinde ana gelişim alanların ${focus.map((item) => item.area.toLocaleLowerCase("tr-TR")).join(" ve ")}. Bulgular aim, hareket, pozisyon, takım oyunu, utility, opening ve genel etki birlikte taranarak üretildi.`
    : "Bu maçta kural eşiklerini aşan güçlü bir hata kümesi yok. Tek maç sonucunu kesin hüküm saymadan aynı haritada birkaç demo daha karşılaştır.";
  return {
    title: priorities[0]?.title || "Genel oyun dengeli görünüyor",
    summary,
    confidence: Math.round(findings.reduce((sum, item) => sum + item.confidence, 0) / findings.length),
    findings,
    priorities,
    strengths,
    dimensions: findings.map((item) => ({ area: item.area, status: item.severity, label: SEVERITY_LABEL[item.severity] })),
    positionZones,
  };
}
