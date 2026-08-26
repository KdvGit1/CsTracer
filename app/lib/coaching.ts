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

// ═══════════════════════════════════════════════════════════════════════════
// KOÇLUK EŞİKLERİ — tek kaynak. AimCoachCard ve buildCoachPacket buradan beslenir.
// Profesyonel referans noktaları (HLTV / üst düzey analitik):
//  • TTD (ilk hasar süresi): elit rifler ortalaması ~200–280 ms; 380 ms üstü
//    amatör bandında bile yavaş sayılır.
//  • Kafa sapması (crosshair placement): üst düzey oyuncular köşe dönüşünde
//    2–4° bandında kalır; 6.5° üstü belirgin placement sorunudur.
//  • Tüfekle hareketli atış: pro demolarında <%5; %16 üstü counter-strafe
//    alışkanlığı eksikliğine işaret eder.
//  • Trade oranı: takım oyununda ölümlerin %45+ trade edilmesi sağlıklıdır.
//  • ADR: 80+ iyi, 70–85 gelişim bandı, <60 sürdürülemez.
// ═══════════════════════════════════════════════════════════════════════════
export const COACH_THRESHOLDS = {
  ttd: { warnMs: 380, highMs: 460, strongMs: 280, targetMs: 320, strongMinDuels: 8 },
  headshotAngle: { warnDeg: 5.0, highDeg: 6.5, strongDeg: 3.8, targetDeg: 4.0 },
  preAimScoreMin: 60,
  movingShotPercent: {
    rifle: { warn: 16, high: 25, strong: 8, strongMinShots: 30 },
    sniper: { warn: 12, high: 20 },
  },
  spray: {
    earlyStrong: 48,
    decayEarlyMin: 40,
    decayLateMax: 20,
    decayHighLateMax: 14,
    decayMinShots: 35,
    weakEarlyMax: 30,
    weakMinShots: 30,
  },
  hitboxLegsPercent: { warn: 12, high: 20 },
} as const;

export const COACH_RULES: CoachRule[] = [
  { id: "aim_crosshair", area: "Pre-Aim & Kafa Hizası", title: "Köşe dönme ve kafa seviyesi", target: "Kafa sapması ≤ 4.0° · Pre-Aim ≥ 75/100 (pro bandı 2–4°)", rationale: "Köşeleri dönerken crosshair kafa seviyesinde tutulduğunda flick ihtiyacı azalır ve ilk mermi isabeti artar. Üst düzey oyuncular 2–4° bandında kalır.", caveat: "Eğimli zeminler ve çömelmiş rakipler açı sapmasını doğal olarak değiştirebilir." },
  { id: "aim_spray", area: "Sprey & Recoil", title: "Burst ve geri tepme kontrolü", target: "İlk 3 mermi ≥ %30 · 4+ mermi sprey ≥ %18", rationale: "Menzile göre uzun sprey yerine 2-3 mermilik kısa burst atışları tercih etmek recoil sapmasını önler.", caveat: "Yakın mesafe çatışmalarında ve SMG silahlarında tam sprey bazen en doğru karardır." },
  { id: "duel_ttd", area: "İlk Temas & TTD", title: "Time-to-Damage (Reaksiyon)", target: "Medyan yaklaşık TTD ≤ 320 ms · karşılıklı görünür düello galibiyeti ≥ %50", rationale: "Yaklaşık görünür temasın ilk hasara dönüşme süresini kısaltarak rakibe cevap fırsatı bırakmaz.", caveat: "Spotted verisi yaklaşık ölçümdür; geniş swing, flash, prefire ve görünmeden verilen hasarlar ayrı değerlendirilir." },
  { id: "movement", area: "Counter-Strafe & Duruş", title: "Atış anında tam durma disiplini", target: "Tüfekte hareketli atış <%8 (pro <%5) · ≤15 u/s sabit · 15–50 mikro · 50–120 belirgin · >120 ağır", rationale: "Küçük hareketi koşarak atışla aynı hata saymaz; ortalama, P90 ve ağırlıklı hata skoru birlikte okunur. Pro demolarında tüfekle hareketli atış %5'in altındadır.", caveat: "Silah, mesafe ve duruş doğruluğu değiştirir; hız bandı yayılımın birebir ölçümü değil, koçluk sezgisidir." },
  { id: "trade", area: "Takım & Trade", title: "Trade edilebilir temas", target: "Trade oranı ≥ %45", rationale: "Düello kaybedildiğinde takımın skoru eşitleme ihtimalini artırır.", caveat: "Lurk ve clutch rollerinde hedef daha düşük olabilir; görüş hattı demodan her zaman kesin kurulamaz." },
  { id: "position", area: "Harita Pozisyonu", title: "Tekrarlayan ölüm kümesi", target: "Aynı bölgede 3+ ölümde round incelemesi", rationale: "Aynı açı, zamanlama veya geri düşme planındaki tekrarları görünür yapar.", caveat: "Bölge etiketi geniş olabilir; sebep aim, utility, ekonomi veya takım planı olabilir." },
  { id: "utility", area: "Utility & Flash", title: "Temas öncesi hazırlık", target: "Round başına ≥ 3 utility hasarı veya ölçülebilir flash etkisi", rationale: "Rakibi temiz nişan düellosundan önce dezavantaja sokar.", caveat: "Demo burada yalnızca oyuncunun kendi flashını güvenle bağlar; takım flashı eksik sayılabilir." },
  { id: "opening", area: "Açılış Düellosu (Entry)", title: "İlk temas dengesi", target: "Opening farkı negatif olmamalı", rationale: "İlk ölümün takımın round kazanma ihtimaline etkisi yüksektir.", caveat: "Entry rolü daha fazla risk alır; kararın doğruluğu spawn, ekonomi ve planla birlikte değerlendirilir." },
  { id: "damage", area: "Hasar Katkısı (ADR)", title: "Sürdürülebilir round hasarı", target: "ADR 70–85 gelişim bandı", rationale: "Roundlar boyunca düzenli çatışma katkısını izler.", caveat: "Support, AWP ve anchor rollerinde tek bir ADR hedefi optimum oyun anlamına gelmez." },
];

export const SEVERITY_LABEL: Record<ErrorSeverity, string> = {
  critical: "Kritik", high: "Yüksek", moderate: "Orta", minor: "Küçük", info: "Bilgi", strong: "Güçlü",
};
export const SEVERITY_RANK: Record<ErrorSeverity, number> = { critical: 0, high: 1, moderate: 2, minor: 3, info: 4, strong: 5 };

export function explainMovement(profile: MovementProfile) {
  const fastShotsPerTen = Math.max(0, Math.min(10, Math.round(profile.fastPercent / 10)));
  const severityMeaning = profile.severityScore >= 55
    ? "Bu maçta hareket ederek ateş etme belirgin bir gelişim alanı (özellikle tüfek ve AWP atışlarında)."
    : profile.severityScore >= 30
      ? "Hareket zamanlaması tüfek düellolarında isabetini zorlaştırmış olabilir."
      : "Hareket kaynaklı atış riski bu maçta düşük ve temiz görünüyor.";
  const rifleMov = profile.byCategory?.rifle?.movingPercent ?? 0;
  const sniperMov = profile.byCategory?.sniper?.movingPercent ?? 0;
  const smgMov = profile.byCategory?.smg?.movingPercent ?? 0;
  return {
    summary: `Basitçe: Her 10 atışın yaklaşık ${fastShotsPerTen} tanesinde duruş hız sınırını aştın. ${severityMeaning}`,
    average: `Ortalama ${profile.averageSpeed} u/s: Tetiğe bastığın anlardaki ortalama hareket hızın; silahın hızı veya FPS değil.`,
    p90: `P90 ${profile.p90Speed} u/s: Atışlarının %90'ında bu hızda ya da daha yavaştın.`,
    micro: `Mikro %${profile.microPercent}: Küçük ayak kaymaları.`,
    fast: `Yüksek Hız %${profile.fastPercent}: Belirgin biçimde hareket ederken atılan mermiler.`,
    score: `${profile.severityScore}/100 silaha göre ağırlıklı hareket hatası puanıdır. Sayı yükseldikçe sorun büyür.`,
    byWeaponNote: `Tüfek hareket hatası: %${rifleMov} · Sniper hareket hatası: %${sniperMov} · SMG hareketli atış: %${smgMov} (SMG koşu atışları doğal toleranslıdır).`,
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
  const flashValue = report.flashesThrown ? report.enemyBlindSeconds / report.flashesThrown : 0;
  const utilityPerRound = report.utilityDamage / rounds;
  const openingDifference = report.openingKills - report.openingDeaths;
  const sampleConfidence = Math.min(92, 58 + Math.min(14, report.deaths) * 2);
  const movement = report.movementProfile;
  const movementSeverity: ErrorSeverity = movement?.severity === "severe" ? "high" : movement?.severity === "moderate" ? "moderate" : movement?.severity === "minor" ? "minor" : movement ? "strong" : report.movingShotPercent > 20 ? "high" : report.movingShotPercent > 12 ? "moderate" : "strong";
  const duelStats = report.duelStats;
  const hasReliableTtd = duelStats?.ttdMethod === "spotted-to-first-damage-v1" && (duelStats.ttdSampleCount || 0) >= 5;
  const hasReliableDuels = duelStats?.duelMethod === "mutual-spotted-death-v1" && duelStats.duelTotal >= 3;
  const measuredTtd = duelStats?.medianTTD || 0;
  const duelFinding: CoachFinding | null = duelStats && (hasReliableTtd || hasReliableDuels) ? {
    id: "duel_ttd",
    area: "İlk Temas & Karşılıklı Düello",
    title: hasReliableTtd && measuredTtd > 380
      ? "Time-to-Damage (TTD) süresi uzun"
      : hasReliableDuels && duelStats.duelWinrate < 45
        ? "Karşılıklı düello kazanma oranı düşük"
        : "İlk temas ve düello reaksiyonları keskin",
    evidence: [
      hasReliableTtd
        ? `Yaklaşık TTD medyan ${measuredTtd} ms, ortalama ${duelStats.averageTTD} ms (${duelStats.ttdSampleCount} geçerli temas; ${duelStats.reactionRating}).`
        : "TTD için yeterli görünür temas örneği yok.",
      hasReliableDuels
        ? `Karşılıklı görünür düellolarda ${duelStats.duelWins} galibiyet / ${duelStats.duelLosses || 0} mağlubiyet (%${duelStats.duelWinrate}).`
        : "Karşılıklı düello oranı için yeterli sonuç yok.",
      hasReliableTtd ? `${duelStats.fastReactions} temas 250 ms veya altında.` : "",
    ].filter(Boolean).join(" "),
    interpretation: hasReliableTtd && measuredTtd > 350
      ? "Rakibi yaklaşık olarak gördüğün andan ilk hasara kadar geçen süre uzuyor; rakip karşılık vermek için daha fazla zaman buluyor."
      : hasReliableDuels && duelStats.duelWinrate < 45
        ? "İki tarafın da birbirini gördüğü ölümle sonuçlanan temaslarda rakip daha sık son vuruşu yapıyor."
        : "Ölçülen görünür temaslarda ilk hasar ve düello sonucu dengeli veya güçlü.",
    action: hasReliableTtd && measuredTtd > 350
      ? "Aim Botz ve reaktif tracking modlarında target-switching çalış; sonraki demoda medyan TTD'yi izle."
      : hasReliableDuels && duelStats.duelWinrate < 45
        ? "Karşılıklı açılarda ilk mermi, counter-strafe ve hasar aldıktan sonra geri düşme disiplinini çalış."
        : "Mevcut temas disiplinini koru.",
    severity: (hasReliableTtd && measuredTtd > 420
      ? "high"
      : (hasReliableTtd && measuredTtd > 350) || (hasReliableDuels && duelStats.duelWinrate < 40)
        ? "moderate"
        : hasReliableTtd && measuredTtd > 320
          ? "minor"
          : "strong") as ErrorSeverity,
    confidence: Math.min(92, 64 + Math.min(16, duelStats.ttdSampleCount || 0) + Math.min(10, duelStats.duelTotal)),
  } : null;

  const findings: CoachFinding[] = [
    ...(report.crosshairStats ? [{
      id: "aim_crosshair", area: "Pre-Aim & Kafa Hizası",
      title: report.crosshairStats.headErrorAngle > 5.5 ? "Nişangah kafa hizasından sapıyor" : report.crosshairStats.headErrorAngle > 4.2 ? "Pre-Aim ve kafa yerleşimi geliştirilebilir" : "Temiz kafa hizası ve pre-aim",
      evidence: `Ortalama kafa sapması ${report.crosshairStats.headErrorAngle}° (Gövde sapması ${report.crosshairStats.bodyErrorAngle}°), Pre-Aim skoru ${report.crosshairStats.preAimScore}/100 (${report.crosshairStats.headLevelRating}).`,
      interpretation: report.crosshairStats.headErrorAngle > 4.2 ? "Köşeleri dönerken crosshair düşman kafasından uzakta kalıyor; ilk vuruştan önce nişangahı micro-adjustment ile düzeltmek zorunda kalıyorsun." : "Nişangah açılardan çıkarken doğru kafa hizasında duruyor.",
      action: report.crosshairStats.headErrorAngle > 4.2 ? "YPrac veya Refrag pre-aim modlarında 15 dk köşe dönme çalış; açıyı görmeden önce kafanın olacağı noktaya nişan al." : "Mevcut crosshair placement alışkanlığını koru.",
      severity: (report.crosshairStats.headErrorAngle > 6.5 ? "high" : report.crosshairStats.headErrorAngle > 4.5 ? "moderate" : report.crosshairStats.headErrorAngle > 3.8 ? "minor" : "strong") as ErrorSeverity,
      confidence: 86,
    }] : []),
    ...(report.sprayStats ? [{
      id: "aim_spray", area: "Sprey & Recoil",
      title: report.sprayStats.lateAccuracy < 15 && report.sprayStats.totalShots > 40 ? "4+ mermi sonrası sprey kontrolü dağılıyor" : report.sprayStats.earlyAccuracy < 22 ? "İlk 3 mermi burst isabeti düşük" : "Sprey ve burst kontrolü dengeli",
      evidence: `Toplam ${report.sprayStats.totalShots} atışta %${report.sprayStats.accuracyPercent} isabet (${report.sprayStats.totalHits} hit). İlk 3 mermi %${report.sprayStats.earlyAccuracy}, 4+ mermi sprey %${report.sprayStats.lateAccuracy} isabet.`,
      interpretation: report.sprayStats.lateAccuracy < 18 ? "Menzilli çatışmalarda uzun sprey atıldığında mermilerin büyük kısmı kaçıyor; recoil sıfırlanmadan ateş ediliyor." : "Burst ve sprey geçişleri hedefe oturuyor.",
      action: report.sprayStats.lateAccuracy < 18 ? "Menzile göre 2-3 mermilik kısa burst atışlara geç; Recoil Master haritasında silahların ilk 10 mermi desenini çalış." : "Sprey disiplinini koru.",
      severity: (report.sprayStats.lateAccuracy < 12 && report.sprayStats.totalShots > 40 ? "high" : report.sprayStats.lateAccuracy < 18 && report.sprayStats.totalShots > 30 ? "moderate" : "strong") as ErrorSeverity,
      confidence: 84,
    }] : []),
    ...(duelFinding ? [duelFinding] : []),
    {
      id: "movement", area: "Counter-Strafe & Duruş",
      title: movement?.severity === "severe" ? "Yüksek hızda atış öncelikli sorun" : movement?.severity === "moderate" ? "Duruş zamanlaması geliştirilebilir" : movement?.severity === "minor" ? "Küçük hareket sapmaları" : "Duruş disiplini hedefte",
      evidence: movement ? `${report.shots} atış · ortalama ${movement.averageSpeed} u/s · P90 ${movement.p90Speed} u/s · mikro %${movement.microPercent} · 120+ u/s %${movement.fastPercent} · ağırlıklı hata ${movement.severityScore}/100.` : `${report.shots} atışın %${report.movingShotPercent} kadarında hız 50 u/s üzerindeydi.`,
      interpretation: movement ? explainMovement(movement).summary : movementSeverity !== "strong" ? "Ateş ederken hareket ettiğin atışların payı yüksek görünüyor." : "Ölçülen atışların büyük bölümünde hareket kontrolü dengeli.",
      action: movement?.severity === "minor" ? "Mikro sapmaları ısınmada kontrol et; ana çalışma süresini daha ağır bulgulara ayır." : movementSeverity !== "strong" ? "Antrenmanda 50 tekli counter-strafe tekrarı yap; ilk mermiden önce tam duruşu doğrula." : "Mevcut duruş kalitesini koru; yakın mesafe koşu atışlarını ayrı değerlendirilir.",
      severity: movementSeverity,
      confidence: report.shots >= 80 ? 88 : report.shots >= 25 ? 76 : 58,
    },
    {
      id: "trade", area: "Takım & Trade",
      title: report.tradePercent < 30 ? "Temasların çoğu çevrilemiyor" : report.tradePercent < 45 ? "Trade mesafesi geliştirilebilir" : "Trade yapısı dengeli",
      evidence: `${report.untradedDeaths}/${report.deaths} ölüm 5 saniye içinde takım tarafından çevrilmedi; trade oranı %${report.tradePercent}.`,
      interpretation: report.tradePercent < 45 ? "Bazı temaslar takım görüşünden uzakta veya sıra dışı zamanlamada alınmış olabilir." : "Ölümlerin önemli kısmı takım tarafından cevaplanmış.",
      action: report.tradePercent < 45 ? "Temastan önce en yakın takım arkadaşını ve aynı görüş hattını kontrol et; ilk oyuncuysan rotanı ikinci oyuncuya haber ver." : "Trade edilebilir mesafeyi koru; lurk ve clutch roundlarını ayrıca incele.",
      severity: report.deaths < 4 && report.tradePercent < 45 ? "minor" : report.tradePercent < 20 ? "high" : report.tradePercent < 30 ? "moderate" : report.tradePercent < 45 ? "minor" : "strong",
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
      title: utilityPerRound < 3 && flashValue < .7 ? "Temas öncesi utility etkisi düşük" : "Utility katkısı görünür",
      evidence: `${report.utilityDamage} utility hasarı (${utilityPerRound.toFixed(1)}/round), ${report.flashesThrown} flash ve ${report.enemyBlindSeconds.toFixed(1)} sn rakip körlüğü.`,
      interpretation: utilityPerRound < 3 && flashValue < .7 ? "Rakipler bazı düellolara yeterince zorlanmadan girmiş olabilir." : "Utility en az bir ölçümde roundlara katkı sağlamış.",
      action: utilityPerRound < 3 && flashValue < .7 ? "Oynadığın iki ana pozisyon için bir temas flashı ve bir geciktirme molotofu belirle; kullanımını round planına bağla." : "Etkili setleri koru; flashın takım arkadaşına açtığı düelloları video üzerinden ayrıca kontrol et.",
      severity: report.flashesThrown === 0 && report.rounds >= 12 ? "high" : report.flashesThrown === 0 && report.rounds >= 8 ? "moderate" : utilityPerRound < 3 && flashValue < .7 ? "minor" : "strong",
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
      title: report.adr < 60 ? "Round etkisi sürdürülemiyor" : report.adr < 75 ? "Hasar katkısı geliştirilebilir" : "Hasar üretimi dengeli",
      evidence: `${report.adr.toFixed(1)} ADR, ${report.kills}/${report.deaths} K/D ve ${report.assists} asist.`,
      interpretation: report.adr < 75 ? "Bazı roundlarda temas, hayatta kalma veya hasarı skora çevirme verimi düşük olabilir." : "Genel hasar çıktısı gelişim bandının içinde veya üzerinde.",
      action: report.adr < 75 ? "Hasarsız öldüğün roundları ayır; sebebi temas alamama, utility altında kalma veya kötü yeniden peek olarak sınıflandır." : "Hasar kalitesini korurken round sonu hayatta kalma ve trade değerini birlikte izle.",
      severity: report.adr < 50 ? "high" : report.adr < 60 ? "moderate" : report.adr < 75 ? "minor" : "strong",
      confidence: report.rounds >= 12 ? 84 : 66,
    },
  ];

  const priorities = [...findings].filter((item) => item.severity !== "strong").sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || b.confidence - a.confidence);
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
    priorities: priorities.length ? priorities : strengths.slice(0, 3),
    strengths,
    dimensions: findings.map((item) => ({ area: item.area, status: item.severity, label: SEVERITY_LABEL[item.severity] })),
    positionZones,
  };
}
