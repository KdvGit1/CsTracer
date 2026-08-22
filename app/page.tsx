"use client";

import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import { radarMapFor, worldToRadar } from "./map-data";
import "./analysis.css";

const COMPANION_URL = "http://127.0.0.1:43119";
const HANDLE_DATABASE = "tracer-local";
const HANDLE_STORE = "handles";
const DEMO_DIRECTORY_KEY = "demo-directory";

type LocalFileHandle = {
  kind: "file";
  name: string;
  getFile(): Promise<File>;
};
type LocalDirectoryHandle = {
  kind: "directory";
  name: string;
  entries(): AsyncIterableIterator<[string, LocalFileHandle | LocalDirectoryHandle]>;
  removeEntry(name: string): Promise<void>;
  queryPermission?(options: { mode: "readwrite" }): Promise<PermissionState>;
  requestPermission?(options: { mode: "readwrite" }): Promise<PermissionState>;
};
type DemoFileEntry = { name: string; size: number; lastModified: number; handle: LocalFileHandle };
type CompanionState = "checking" | "online" | "offline";

function openHandleDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(HANDLE_DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(HANDLE_STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function loadSavedDirectory() {
  const database = await openHandleDatabase();
  try {
    return await new Promise<LocalDirectoryHandle | undefined>((resolve, reject) => {
      const request = database.transaction(HANDLE_STORE).objectStore(HANDLE_STORE).get(DEMO_DIRECTORY_KEY);
      request.onsuccess = () => resolve(request.result as LocalDirectoryHandle | undefined);
      request.onerror = () => reject(request.error);
    });
  } finally {
    database.close();
  }
}

async function saveDirectory(handle: LocalDirectoryHandle) {
  const database = await openHandleDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const request = database.transaction(HANDLE_STORE, "readwrite").objectStore(HANDLE_STORE).put(handle, DEMO_DIRECTORY_KEY);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  } finally {
    database.close();
  }
}

function formatBytes(bytes: number) {
  if (!bytes) return "0 MB";
  return `${(bytes / 1024 / 1024).toFixed(bytes >= 100 * 1024 * 1024 ? 0 : 1)} MB`;
}

async function readDemoFiles(directory: LocalDirectoryHandle) {
  const files: DemoFileEntry[] = [];
  for await (const [name, handle] of directory.entries()) {
    if (handle.kind !== "file" || !name.toLowerCase().endsWith(".dem")) continue;
    const file = await handle.getFile();
    files.push({ name, size: file.size, lastModified: file.lastModified, handle });
  }
  return files.sort((a, b) => b.lastModified - a.lastModified);
}

const sampleMetrics = [
  { label: "K / D", value: "—", delta: "demo gerekli", tone: "warn" },
  { label: "ADR", value: "—", delta: "demo gerekli", tone: "warn" },
  { label: "Headshot", value: "—", delta: "demo gerekli", tone: "warn" },
  { label: "Trade", value: "—", delta: "demo gerekli", tone: "warn" },
];

const sampleEvidence: { round: string; time: string; text: string; type: string }[] = [];

type Recommendation = { id: string; title: string; body: string; confidence: number };
type DeathDetail = {
  round: number; tick: number; time: number; zone: string; x: number; y: number; z: number;
  killer: string; weapon: string; nearestTeammate: number | null; usedRecentFlash: boolean; traded: boolean;
  side?: "CT" | "T" | "Unknown";
  speed?: number; openingDeath?: boolean; wasBlind?: boolean;
};
type KillDetail = {
  round: number; tick: number; time: number; zone: string; x: number; y: number; z: number;
  victim: string; weapon: string; headshot: boolean; side: "CT" | "T" | "Unknown";
};
type SideStat = {
  side: "CT" | "T"; rounds: number; kills: number; deaths: number; assists: number; damage: number;
  adr: number; shots: number; movingShotPercent: number; tradePercent: number; topZone: string; topZoneDeaths: number;
};
type WeaponStat = {
  weapon: string; label: string; kills: number; damage: number; shots: number; headshots: number;
  headshotPercent: number; movingShotPercent: number; efficiency: number; score: number;
  status: "signature" | "strong" | "developing" | "sample";
};
type MovementProfile = {
  averageSpeed: number; p90Speed: number; stableShots: number; microMoveShots: number;
  movingShots: number; fastMoveShots: number; stablePercent: number; microPercent: number;
  movingPercent: number; fastPercent: number; severityScore: number;
  severity: "clean" | "minor" | "moderate" | "severe";
};
type PlayerReport = {
  player: { name: string; steamid: string }; map: string; rounds: number; kills: number; deaths: number;
  assists: number; adr: number; headshotPercent: number; openingKills: number; openingDeaths: number;
  utilityDamage: number; enemyBlindSeconds: number; flashesThrown: number; shots: number;
  movingShotPercent: number; tradePercent: number; topZone: string; topZoneDeaths: number;
  unflashedDeaths: number; untradedDeaths: number; impact: number; deathDetails: DeathDetail[];
  killDetails?: KillDetail[]; sideStats?: SideStat[]; weaponStats?: WeaponStat[]; movementProfile?: MovementProfile;
  recommendations: Recommendation[];
};
type ErrorSeverity = "critical" | "high" | "moderate" | "minor" | "info" | "strong";
type CoachRule = { id: string; area: string; title: string; target: string; rationale: string; caveat: string };
type CoachFinding = {
  id: string; area: string; title: string; evidence: string; interpretation: string;
  action: string; severity: ErrorSeverity; confidence: number;
};
type DeathPattern = {
  id: string; category: string; title: string; count: number; share: number; severity: Exclude<ErrorSeverity, "strong">;
  confidence: number; evidence: string; interpretation: string; rounds: number[];
};
type CoachPacket = {
  title: string; summary: string; confidence: number; findings: CoachFinding[];
  priorities: CoachFinding[]; strengths: CoachFinding[];
  dimensions: { area: string; status: ErrorSeverity; label: string }[];
  positionZones: { zone: string; deaths: number; share: number }[];
};
type AiInsight = {
  title: string;
  summary: string;
  priorities: { area: string; evidence: string; interpretation: string; action: string }[];
  strengths: string[];
  sessionPlan: string;
  confidence?: number;
};
type ParseStatus = "idle" | "reading" | "parsing" | "ready" | "error";

const COACH_RULES: CoachRule[] = [
  { id: "movement", area: "Aim & hareket", title: "Atış hızını bağlamla ölç", target: "≤15 u/s sabit · 15–50 mikro · 50–120 belirgin · >120 ağır", rationale: "Küçük hareketi koşarak atışla aynı hata saymaz; ortalama, P90 ve ağırlıklı hata skoru birlikte okunur.", caveat: "Silah, mesafe ve duruş doğruluğu değiştirir; hız bandı yayılımın birebir ölçümü değil, koçluk sezgisidir." },
  { id: "trade", area: "Takım oyunu", title: "Trade edilebilir temas", target: "Trade oranı ≥ %45", rationale: "Düello kaybedildiğinde takımın skoru eşitleme ihtimalini artırır.", caveat: "Lurk ve clutch rollerinde hedef daha düşük olabilir; görüş hattı demodan her zaman kesin kurulamaz." },
  { id: "position", area: "Pozisyon", title: "Tekrarlayan ölüm kümesi", target: "Aynı bölgede 3+ ölümde round incelemesi", rationale: "Aynı açı, zamanlama veya geri düşme planındaki tekrarları görünür yapar.", caveat: "Bölge etiketi geniş olabilir; sebep aim, utility, ekonomi veya takım planı olabilir." },
  { id: "utility", area: "Utility", title: "Temas öncesi hazırlık", target: "Round başına ≥ 3 utility hasarı veya ölçülebilir flash etkisi", rationale: "Rakibi temiz nişan düellosundan önce dezavantaja sokar.", caveat: "Demo burada yalnızca oyuncunun kendi flashını güvenle bağlar; takım flashı eksik sayılabilir." },
  { id: "opening", area: "Round disiplini", title: "Açılış düellosu dengesi", target: "Opening farkı negatif olmamalı", rationale: "İlk ölümün takımın round kazanma ihtimaline etkisi yüksektir.", caveat: "Entry rolü daha fazla risk alır; kararın doğruluğu spawn, ekonomi ve planla birlikte değerlendirilir." },
  { id: "damage", area: "Genel etki", title: "Sürdürülebilir hasar", target: "ADR 70–85 gelişim bandı", rationale: "Roundlar boyunca düzenli çatışma katkısını izler.", caveat: "Support, AWP ve anchor rollerinde tek bir ADR hedefi optimum oyun anlamına gelmez." },
];

const SEVERITY_LABEL: Record<ErrorSeverity, string> = {
  critical: "Kritik", high: "Yüksek", moderate: "Orta", minor: "Küçük", info: "Bilgi", strong: "Güçlü",
};
const SEVERITY_RANK: Record<ErrorSeverity, number> = { critical: 0, high: 1, moderate: 2, minor: 3, info: 4, strong: 5 };

function severityForCount(count: number, share: number): Exclude<ErrorSeverity, "strong"> {
  if (count >= 5 || (count >= 4 && share >= 45)) return "critical";
  if (count >= 4 || (count >= 3 && share >= 35)) return "high";
  if (count >= 3 || (count >= 2 && share >= 25)) return "moderate";
  return count >= 2 ? "minor" : "info";
}

function buildDeathPatterns(report: PlayerReport): DeathPattern[] {
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

function buildCoachPacket(report: PlayerReport): CoachPacket {
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

  const findings: CoachFinding[] = [
    {
      id: "movement", area: "Aim & hareket",
      title: movement?.severity === "severe" ? "Yüksek hızda atış öncelikli sorun" : movement?.severity === "moderate" ? "Duruş zamanlaması geliştirilebilir" : movement?.severity === "minor" ? "Küçük hareket sapmaları" : "Duruş disiplini hedefte",
      evidence: movement ? `${report.shots} atış · ortalama ${movement.averageSpeed} u/s · P90 ${movement.p90Speed} u/s · mikro %${movement.microPercent} · 120+ u/s %${movement.fastPercent} · ağırlıklı hata ${movement.severityScore}/100.` : `${report.shots} atışın %${report.movingShotPercent} kadarında hız 50 u/s üzerindeydi.`,
      interpretation: movement?.severity === "minor" ? "Sapmalar çoğunlukla mikro hareket bandında; ağır bir koşarak atış problemi gibi yorumlanmıyor." : movementSeverity !== "strong" ? "Yüksek hızdaki atışlar counter-strafe veya ilk burst zamanlamasını zayıflatmış olabilir." : "Ölçülen atışların büyük bölümünde hareket kontrolü dengeli.",
      action: movement?.severity === "minor" ? "Mikro sapmaları ısınmada kontrol et; ana çalışma süresini daha ağır bulgulara ayır." : movementSeverity !== "strong" ? "Antrenmanda 50 tekli counter-strafe tekrarı yap; ilk mermiden önce tam duruşu doğrula." : "Mevcut duruş kalitesini koru; yakın mesafe koşu atışlarını ayrı değerlendir.",
      severity: movementSeverity,
      confidence: report.shots >= 80 ? 88 : report.shots >= 25 ? 76 : 58,
    },
    {
      id: "trade", area: "Takım oyunu",
      title: report.tradePercent < 30 ? "Temasların çoğu çevrilemiyor" : report.tradePercent < 45 ? "Trade mesafesi geliştirilebilir" : "Trade yapısı dengeli",
      evidence: `${report.untradedDeaths}/${report.deaths} ölüm 5 saniye içinde takım tarafından çevrilmedi; trade oranı %${report.tradePercent}.`,
      interpretation: report.tradePercent < 45 ? "Bazı temaslar takım görüşünden uzakta veya sıra dışı zamanlamada alınmış olabilir." : "Ölümlerin önemli kısmı takım tarafından cevaplanmış.",
      action: report.tradePercent < 45 ? "Temastan önce en yakın takım arkadaşını ve aynı görüş hattını kontrol et; ilk oyuncuysan rotanı ikinci oyuncuya haber ver." : "Trade edilebilir mesafeyi koru; lurk ve clutch roundlarını ayrıca incele.",
      severity: report.deaths < 4 && report.tradePercent < 45 ? "minor" : report.tradePercent < 20 ? "high" : report.tradePercent < 30 ? "moderate" : report.tradePercent < 45 ? "minor" : "strong",
      confidence: report.deaths >= 10 ? 86 : 68,
    },
    {
      id: "position", area: "Pozisyon",
      title: topZone.deaths >= 3 ? `${topZone.zone} tekrar eden risk alanı` : "Belirgin ölüm kümesi yok",
      evidence: `${topZone.zone}: ${topZone.deaths} ölüm (%${topZone.share}). Taranan bölgeler: ${positionZones.slice(0, 4).map((item) => `${item.zone} ${item.deaths}`).join(", ") || "veri yok"}.`,
      interpretation: topZone.deaths >= 3 ? "Aynı açı, yeniden peek, utility eksikliği veya geç rotasyon ihtimalleri round görüntüsüyle ayrıştırılmalı." : "Ölümler tek bir pozisyona aşırı yığılmamış.",
      action: topZone.deaths >= 3 ? `${topZone.zone} ölümlerini sırayla izle; her biri için ilk temas, kaçış rotası, takım görüşü ve rakip utility sütunlarını işaretle.` : "Yeni demolarla konum örneğini büyüt; iki maç üst üste tekrarlayan bölgeleri önceliklendir.",
      severity: topZone.deaths >= 5 && topZone.share >= 45 ? "critical" : topZone.deaths >= 4 || topZone.share >= 40 ? "high" : topZone.deaths >= 3 ? "moderate" : topZone.deaths >= 2 ? "minor" : "strong",
      confidence: report.deaths >= 8 ? sampleConfidence : 62,
    },
    {
      id: "utility", area: "Utility",
      title: utilityPerRound < 3 && flashValue < .7 ? "Temas öncesi utility etkisi düşük" : "Utility katkısı görünür",
      evidence: `${report.utilityDamage} utility hasarı (${utilityPerRound.toFixed(1)}/round), ${report.flashesThrown} flash ve ${report.enemyBlindSeconds.toFixed(1)} sn rakip körlüğü.`,
      interpretation: utilityPerRound < 3 && flashValue < .7 ? "Rakipler bazı düellolara yeterince zorlanmadan girmiş olabilir." : "Utility en az bir ölçümde roundlara katkı sağlamış.",
      action: utilityPerRound < 3 && flashValue < .7 ? "Oynadığın iki ana pozisyon için bir temas flashı ve bir geciktirme molotofu belirle; kullanımını round planına bağla." : "Etkili setleri koru; flashın takım arkadaşına açtığı düelloları video üzerinden ayrıca kontrol et.",
      severity: report.flashesThrown === 0 && report.rounds >= 12 ? "high" : report.flashesThrown === 0 && report.rounds >= 8 ? "moderate" : utilityPerRound < 3 && flashValue < .7 ? "minor" : "strong",
      confidence: 72,
    },
    {
      id: "opening", area: "Round disiplini",
      title: openingDifference < -1 ? "Açılış düellolarında fazla kayıp" : openingDifference < 0 ? "Opening dengesi hafif negatif" : "Opening dengesi korunuyor",
      evidence: `${report.openingKills} opening kill, ${report.openingDeaths} opening death; fark ${openingDifference >= 0 ? "+" : ""}${openingDifference}.`,
      interpretation: openingDifference < 0 ? "Erken riskler takımını eksik başlatmış olabilir; rol ve round planı doğrulanmalı." : "İlk temas sonucu bu maçta negatif değil.",
      action: openingDifference < 0 ? "Opening death roundlarında spawn avantajı, takım flashı, geri düşme yolu ve ekonomi kararını birlikte kontrol et." : "Olumlu açılışları aynı koşullarla tekrarla; gereksiz ikinci temastan kaçın.",
      severity: openingDifference <= -5 ? "critical" : openingDifference <= -3 ? "high" : openingDifference <= -2 ? "moderate" : openingDifference < 0 ? "minor" : "strong",
      confidence: report.openingKills + report.openingDeaths >= 5 ? 82 : 64,
    },
    {
      id: "damage", area: "Genel etki",
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

export default function Home() {
  const workerRef = useRef<Worker | null>(null);
  const [status, setStatus] = useState<ParseStatus>("idle");
  const [progress, setProgress] = useState(0);
  const [progressLabel, setProgressLabel] = useState("");
  const [error, setError] = useState("");
  const [fileName, setFileName] = useState("");
  const [reports, setReports] = useState<PlayerReport[]>([]);
  const [selectedPlayer, setSelectedPlayer] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [ollamaUrl, setOllamaUrl] = useState("http://127.0.0.1:11434");
  const [ollamaModel, setOllamaModel] = useState("qwen3:1.7b");
  const [ollamaState, setOllamaState] = useState<"unknown" | "checking" | "online" | "offline" | "thinking" | "released">("unknown");
  const [ollamaResourceMessage, setOllamaResourceMessage] = useState("Analiz bittiğinde model RAM/VRAM'den hemen çıkarılır.");
  const [mapLevel, setMapLevel] = useState<"upper" | "lower">("upper");
  const [aiInsight, setAiInsight] = useState<AiInsight | null>(null);
  const [steamId, setSteamId] = useState("");
  const [steamWebApiKey, setSteamWebApiKey] = useState("");
  const [steamAuthCode, setSteamAuthCode] = useState("");
  const [steamKnownCode, setSteamKnownCode] = useState("");
  const [faceitNickname, setFaceitNickname] = useState("");
  const [faceitApiKey, setFaceitApiKey] = useState("");
  const [sourceMessage, setSourceMessage] = useState("");
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [demoDirectory, setDemoDirectory] = useState<LocalDirectoryHandle | null>(null);
  const [demoFiles, setDemoFiles] = useState<DemoFileEntry[]>([]);
  const [archiveMessage, setArchiveMessage] = useState("");
  const [archiveBusy, setArchiveBusy] = useState(false);
  const [companionState, setCompanionState] = useState<CompanionState>("checking");
  const [sideFilter, setSideFilter] = useState<"all" | "CT" | "T">("all");
  const [activeSection, setActiveSection] = useState("dashboard");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch(`${COMPANION_URL}/health`);
        if (!cancelled) setCompanionState(response.ok ? "online" : "offline");
      } catch {
        if (!cancelled) setCompanionState("offline");
      }
      try {
        const saved = await loadSavedDirectory();
        if (!saved || cancelled) return;
        setDemoDirectory(saved);
        const permission = saved.queryPermission ? await saved.queryPermission({ mode: "readwrite" }) : "prompt";
        if (permission === "granted") {
          const files = await readDemoFiles(saved);
          if (!cancelled) setDemoFiles(files);
        } else if (!cancelled) {
          setArchiveMessage("Klasör kaydı bulundu; yeniden erişmek için klasörü seç.");
        }
      } catch {
        if (!cancelled) setArchiveMessage("Kayıtlı klasör izni okunamadı; klasörü yeniden seçebilirsin.");
      }
    })();
    return () => {
      cancelled = true;
      workerRef.current?.terminate();
    };
  }, []);

  const report = useMemo(() => reports.find((item) => (item.player.steamid || item.player.name) === selectedPlayer) || reports[0], [reports, selectedPlayer]);
  const coachPacket = useMemo(() => report ? buildCoachPacket(report) : null, [report]);
  const deathPatterns = useMemo(() => report ? buildDeathPatterns(report) : [], [report]);
  const displayedCoachItems: CoachFinding[] = aiInsight?.priorities?.length ? aiInsight.priorities.slice(0, 3).map((item, index) => ({
    id: `ai-${index}`,
    area: item.area,
    title: item.interpretation,
    evidence: item.evidence,
    interpretation: item.interpretation,
    action: item.action,
    severity: coachPacket?.priorities[index]?.severity || "high",
    confidence: aiInsight.confidence || coachPacket?.confidence || 70,
  })) : coachPacket?.priorities.slice(0, 3) || [];
  const coachTitle = aiInsight?.title || coachPacket?.title;
  const coachSummary = aiInsight?.summary || coachPacket?.summary;
  const coachConfidence = aiInsight?.confidence || coachPacket?.confidence;
  const coachCards = displayedCoachItems;
  const metrics = report ? [
    { label: "K / D", value: `${report.kills} / ${report.deaths}`, delta: `${report.assists} asist`, tone: report.kills >= report.deaths ? "good" : "warn" },
    { label: "ADR", value: report.adr.toFixed(1), delta: report.adr >= 75 ? "iyi" : "geliştir", tone: report.adr >= 75 ? "good" : "warn" },
    { label: "HS", value: `%${report.headshotPercent}`, delta: `${report.openingKills}-${report.openingDeaths} opening`, tone: report.headshotPercent >= 45 ? "good" : "warn" },
    { label: "Trade", value: `%${report.tradePercent}`, delta: `${report.untradedDeaths} çevrilmedi`, tone: report.tradePercent >= 45 ? "good" : "bad" },
  ] : sampleMetrics;
  const evidence = report ? report.deathDetails.slice(0, 3).map((item) => ({
    round: `R${String(item.round || 0).padStart(2, "0")}`,
    time: `T${item.tick}`,
    text: `${item.zone} · ${item.speed !== undefined ? `${item.speed} u/s · ` : ""}${item.openingDeath ? "opening ölüm · " : ""}${item.usedRecentFlash ? "yakın flash var" : "yakın flash yok"}${item.nearestTeammate ? ` · takım ${item.nearestTeammate}u` : ""}`,
    type: item.traded ? "Trade" : "Pozisyon",
  })) : sampleEvidence;
  const deathsOnMap = report?.deathDetails || [];
  const killsOnMap = report?.killDetails || [];
  const radarMap = report ? radarMapFor(report.map) : undefined;
  const visibleDeaths = deathsOnMap.filter((death) => {
    if (sideFilter !== "all" && death.side !== sideFilter) return false;
    if (!radarMap?.lowerImage || radarMap.lowerMaxZ === undefined) return true;
    return mapLevel === "lower" ? death.z < radarMap.lowerMaxZ : death.z >= radarMap.lowerMaxZ;
  });
  const visibleKills = killsOnMap.filter((kill) => {
    if (sideFilter !== "all" && kill.side !== sideFilter) return false;
    if (!radarMap?.lowerImage || radarMap.lowerMaxZ === undefined) return true;
    return mapLevel === "lower" ? kill.z < radarMap.lowerMaxZ : kill.z >= radarMap.lowerMaxZ;
  });
  const radarImage = mapLevel === "lower" && radarMap?.lowerImage ? radarMap.lowerImage : radarMap?.image;
  const ctStats = report?.sideStats?.find((item) => item.side === "CT");
  const tStats = report?.sideStats?.find((item) => item.side === "T");
  const weaponStats = report?.weaponStats || [];
  const strongestWeapon = weaponStats[0];
  const developmentWeapon = [...weaponStats].filter((item) => item.shots >= 12 && item !== strongestWeapon).sort((a, b) => a.efficiency - b.efficiency || b.shots - a.shots)[0] || weaponStats[1];
  const weakerSide = ctStats && tStats
    ? ((ctStats.kills / Math.max(1, ctStats.deaths)) <= (tStats.kills / Math.max(1, tStats.deaths)) ? ctStats : tStats)
    : ctStats || tStats;
  const primaryDevelopmentFinding = coachPacket?.priorities[0];
  const developmentSteps = report ? [
    {
      number: "01", duration: "15 dk", title: primaryDevelopmentFinding?.title || "Maçın en güçlü tekrarını düzelt",
      reason: primaryDevelopmentFinding?.evidence || "Kural motorunun öncelikli bulgusu.",
      work: primaryDevelopmentFinding?.action || "İlgili roundları sırayla incele ve tek davranış hedefi seç.",
      success: primaryDevelopmentFinding?.id === "movement" ? "Ağırlıklı hareket hata puanını ve 120+ u/s atış payını sonraki demoda düşür." : "Aynı hata kümesini sonraki demoda en az %30 azalt.",
    },
    {
      number: "02", duration: "12 dk", title: developmentWeapon ? `${developmentWeapon.label} gelişim bloğu` : "Ana tüfek mekanik bloğu",
      reason: developmentWeapon ? `${developmentWeapon.shots} atış, ${developmentWeapon.kills} kill, %${developmentWeapon.movingShotPercent} hareketli atış.` : "Silah örneği henüz yeterli değil.",
      work: developmentWeapon?.movingShotPercent && developmentWeapon.movingShotPercent > 12 ? "Counter-strafe sonrası 3–5 mermilik burst çalış; her seride tamamen durduğunu kontrol et." : "İlk mermi, recoil reset ve orta mesafe spray transfer bloklarını ayrı çalış.",
      success: developmentWeapon ? `${developmentWeapon.label} ile hareketli atış oranını düşürürken kill/atış verimini koru.` : "En az 30 kayıtlı atıştan sonra tekrar ölç.",
    },
    {
      number: "03", duration: "10 dk", title: weakerSide ? `${weakerSide.side} tarafı round incelemesi` : "CT/T taraf incelemesi",
      reason: weakerSide ? `${weakerSide.kills}/${weakerSide.deaths} K/D · en yoğun ölüm ${weakerSide.topZone}.` : "Taraf ayrımı için yeni parser sonucu bekleniyor.",
      work: weakerSide ? `${weakerSide.side} tarafındaki ilk üç ölümü izle; temas amacı, takım görüşü, utility ve kaçış rotasını not et.` : "Demoyu güncel yerel parser ile yeniden analiz et.",
      success: weakerSide ? `${weakerSide.topZone} bölgesinde ikinci plansız teması tekrarlama.` : "CT ve T verisini ayrı oluştur.",
    },
  ] : [];

  function playerKey(item: PlayerReport) {
    return item.player.steamid || item.player.name;
  }

  function navigateTo(sectionId: string) {
    setActiveSection(sectionId);
    document.getElementById(sectionId)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function applyReports(nextReports: PlayerReport[]) {
    setReports(nextReports);
    setSelectedPlayer(nextReports[0] ? playerKey(nextReports[0]) : "");
    setProgress(100);
    setProgressLabel("Analiz tamamlandı · parser 0.42.0");
    setStatus("ready");
  }

  async function refreshCompanion() {
    setCompanionState("checking");
    try {
      const response = await fetch(`${COMPANION_URL}/health`);
      const online = response.ok;
      setCompanionState(online ? "online" : "offline");
      return online;
    } catch {
      setCompanionState("offline");
      return false;
    }
  }

  async function analyzeInBrowser(file: File) {
    workerRef.current?.terminate();
    const worker = new Worker("/demo-worker.js");
    workerRef.current = worker;
    setProgressLabel("Uyumlu eski demo için tarayıcı parserı deneniyor");
    return await new Promise<PlayerReport[]>((resolve, reject) => {
      worker.onmessage = (message: MessageEvent) => {
        const data = message.data;
        if (data.type === "progress") {
          setStatus("parsing");
          setProgress(data.progress);
          setProgressLabel(data.label);
        } else if (data.type === "warning") {
          setProgressLabel(data.label);
        } else if (data.type === "done") {
          worker.terminate();
          resolve((data.reports || []) as PlayerReport[]);
        } else if (data.type === "error") {
          worker.terminate();
          reject(new Error(String(data.message || "Demo çözümlenemedi")));
        }
      };
      worker.onerror = (workerError) => {
        worker.terminate();
        reject(new Error(`Analiz worker'ı durdu: ${workerError.message}`));
      };
      void file.arrayBuffer().then((buffer) => {
        worker.postMessage({ fileBytes: buffer }, [buffer]);
      }).catch((readError) => {
        worker.terminate();
        reject(readError);
      });
    });
  }

  async function analyzeFile(file: File) {
    setAiInsight(null);
    setMapLevel("upper");
    setSideFilter("all");
    setError("");
    setFileName(file.name);
    if (!file.name.toLowerCase().endsWith(".dem")) {
      setStatus("error");
      setError("Sıkıştırılmış .bz2 dosyasını önce çıkartıp içindeki .dem dosyasını yükle.");
      return;
    }
    if (file.size > 800 * 1024 * 1024) {
      setStatus("error");
      setError("Bu demo 800 MB güvenlik sınırını aşıyor.");
      return;
    }
    setStatus("reading");
    setProgress(8);
    setProgressLabel("Demo yerel parsera aktarılıyor");
    let companionReached = false;
    try {
      setCompanionState("checking");
      setStatus("parsing");
      setProgress(34);
      setProgressLabel("Güncel Valve olayları ve konumları çözümleniyor");
      const response = await fetch(`${COMPANION_URL}/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream", "X-File-Name": encodeURIComponent(file.name) },
        body: file,
      });
      companionReached = true;
      const payload = await response.json() as { reports?: PlayerReport[]; error?: string };
      if (!response.ok) throw new Error(payload.error || `Yerel parser ${response.status} döndürdü`);
      setCompanionState("online");
      applyReports(payload.reports || []);
      return;
    } catch (companionError) {
      if (companionReached) {
        setCompanionState("online");
        setError(`Demo çözümlenemedi: ${companionError instanceof Error ? companionError.message : "Bilinmeyen parser hatası"}`);
        setStatus("error");
        return;
      }
      setCompanionState("offline");
    }
    try {
      const nextReports = await analyzeInBrowser(file);
      applyReports(nextReports);
    } catch (browserError) {
      const rawMessage = browserError instanceof Error ? browserError.message : String(browserError);
      const requiresCompanion = /EntityNotFound|LOCAL_PARSER_REQUIRED|FailedByteRead/i.test(rawMessage);
      setError(requiresCompanion
        ? "Bu güncel Valve demosu parser 0.42.0 gerektiriyor. D:\\CsTracker\\TRACER-Yerel.cmd dosyasını çalıştırıp tekrar dene."
        : `Demo çözümlenemedi: ${rawMessage}`);
      setStatus("error");
    }
  }

  async function handleDemo(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) await analyzeFile(file);
  }

  async function scanDirectory(directory: LocalDirectoryHandle) {
    setArchiveBusy(true);
    setArchiveMessage("Demo dosyaları taranıyor…");
    try {
      const files = await readDemoFiles(directory);
      setDemoFiles(files);
      setArchiveMessage(files.length ? `${files.length} demo bulundu.` : "Bu klasörde .dem dosyası bulunamadı.");
    } catch (scanError) {
      setArchiveMessage(scanError instanceof Error ? scanError.message : "Klasör okunamadı.");
    } finally {
      setArchiveBusy(false);
    }
  }

  async function pickDemoDirectory() {
    const picker = (window as unknown as { showDirectoryPicker?: (options: { mode: "readwrite" }) => Promise<LocalDirectoryHandle> }).showDirectoryPicker;
    if (!picker) {
      setArchiveMessage("Klasör seçimi için güncel Chrome, Edge veya Chromium tabanlı uygulamayı kullan. Tek dosya yükleme çalışmaya devam eder.");
      return;
    }
    try {
      const directory = await picker({ mode: "readwrite" });
      setDemoDirectory(directory);
      await saveDirectory(directory);
      await scanDirectory(directory);
    } catch (pickerError) {
      if (pickerError instanceof DOMException && pickerError.name === "AbortError") return;
      setArchiveMessage(pickerError instanceof Error ? pickerError.message : "Klasör izni alınamadı.");
    }
  }

  async function analyzeArchiveEntry(entry: DemoFileEntry) {
    try {
      const file = await entry.handle.getFile();
      setArchiveOpen(false);
      await analyzeFile(file);
    } catch (entryError) {
      setArchiveMessage(entryError instanceof Error ? entryError.message : "Demo açılamadı.");
    }
  }

  async function deleteArchiveEntry(entry: DemoFileEntry) {
    if (!demoDirectory || !window.confirm(`${entry.name} kalıcı olarak silinsin mi?`)) return;
    try {
      await demoDirectory.removeEntry(entry.name);
      await scanDirectory(demoDirectory);
      setArchiveMessage(`${entry.name} silindi.`);
    } catch (deleteError) {
      setArchiveMessage(deleteError instanceof Error ? deleteError.message : "Demo silinemedi.");
    }
  }

  async function testOllama() {
    setOllamaState("checking");
    try {
      const response = await fetch(`${ollamaUrl.replace(/\/$/, "")}/api/tags`);
      if (!response.ok) throw new Error("Ollama yanıt vermedi");
      setOllamaState("online");
      setOllamaResourceMessage("Bağlantı hazır; henüz hiçbir model belleğe yüklenmedi.");
    } catch {
      setOllamaState("offline");
    }
  }

  async function verifyOllamaReleased() {
    try {
      const response = await fetch(`${ollamaUrl.replace(/\/$/, "")}/api/ps`);
      if (!response.ok) throw new Error("Kaynak durumu okunamadı");
      const payload = await response.json();
      const target = ollamaModel.toLowerCase().replace(/:latest$/, "");
      const stillLoaded = (payload.models || []).some((item: { name?: string; model?: string }) => {
        const running = String(item.model || item.name || "").toLowerCase().replace(/:latest$/, "");
        return running === target;
      });
      if (stillLoaded) {
        setOllamaState("online");
        setOllamaResourceMessage("Model hâlâ bellekte görünüyor; `ollama stop` ile durdurabilirsin.");
      } else {
        setOllamaState("released");
        setOllamaResourceMessage("✓ Doğrulandı: model RAM/VRAM'den çıkarıldı.");
      }
    } catch {
      setOllamaState("online");
      setOllamaResourceMessage("keep_alive: 0 gönderildi; /api/ps doğrulaması CORS nedeniyle okunamadı.");
    }
  }

  async function runAiCoach() {
    if (!report || !coachPacket) return;
    setOllamaState("thinking");
    setError("");
    const coachInput = {
      match: {
        player: report.player.name, map: report.map, rounds: report.rounds,
        kills: report.kills, deaths: report.deaths, assists: report.assists, adr: report.adr,
      },
      rulebook: COACH_RULES,
      deterministicAssessment: {
        confidence: coachPacket.confidence,
        dimensions: coachPacket.dimensions,
        findings: coachPacket.findings,
        deathPatterns,
        movementProfile: report.movementProfile || null,
        positionZones: coachPacket.positionZones,
        sideStats: report.sideStats || [],
        weaponStats: (report.weaponStats || []).slice(0, 8),
      },
      positionEvidence: report.deathDetails.slice(0, 30).map((detail) => ({
        round: detail.round, tick: detail.tick, zone: detail.zone, weapon: detail.weapon,
        nearestTeammate: detail.nearestTeammate, ownRecentFlash: detail.usedRecentFlash, traded: detail.traded,
        speed: detail.speed, openingDeath: detail.openingDeath, wasBlind: detail.wasBlind,
      })),
    };
    try {
      const response = await fetch(`${ollamaUrl.replace(/\/$/, "")}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: ollamaModel,
          stream: false,
          format: "json",
          keep_alive: 0,
          options: { num_ctx: 4096, temperature: 0.2 },
          messages: [
            { role: "system", content: "Sen TRACER'ın CS2 koç editörüsün; serbestçe hüküm veren bir otorite değilsin. KURAL_KITABI ve deterministicAssessment birincil kaynaktır. Veride olmayan pozisyonu, utility kullanımını, aim sebebini veya takım planını uydurma. Korelasyonu neden gibi yazma; belirsizse 'olabilir' de ve hangi round görüntüsünün doğrulaması gerektiğini belirt. CT ve T taraflarını ayrı karşılaştır; aim/hareket, konum dağılımı, trade/takım oyunu, utility, opening disiplini, silah profili ve genel etkiyi birlikte yorumla. Tüm hatalarda deterministicAssessment içindeki kritik/yüksek/orta/küçük/bilgi derecesini koru; küçük örnekleri ağır hataya yükseltme. Hareket yorumunda ortalama hız, P90 ve bantları kullan; 15–50 u/s mikro hareketi 120+ u/s atışla eşitleme. deathPatterns içindeki ortak ölüm özelliklerini round kanıtıyla özetle. Silah uzmanlığı için tek maçın yalnızca aday gösterebileceğini açıkça koru. En fazla 3 öncelik seç, güçlü alanları da söyle ve tek antrenman planı ver. Yalnızca JSON döndür: {title, summary, priorities:[{area,evidence,interpretation,action}], strengths:[string], sessionPlan, confidence}." },
            { role: "user", content: `KURAL_KITABI VE MAÇ KANITI:\n${JSON.stringify(coachInput)}` },
          ],
        }),
      });
      if (!response.ok) throw new Error(`Ollama ${response.status} döndürdü`);
      const payload = await response.json();
      const content = payload.message?.content || payload.response;
      const parsed = (typeof content === "string" ? JSON.parse(content.replace(/^```(?:json)?\s*|\s*```$/g, "")) : content) as Partial<AiInsight>;
      const priorities = Array.isArray(parsed.priorities) ? parsed.priorities.slice(0, 3).map((item) => ({
        area: String(item.area || "Genel oyun"),
        evidence: String(item.evidence || "Kural motoru bulgusu"),
        interpretation: String(item.interpretation || "Bu bulgu round görüntüsüyle doğrulanmalı."),
        action: String(item.action || "İlgili roundları incele."),
      })) : [];
      setAiInsight({
        title: String(parsed.title || coachPacket.title),
        summary: String(parsed.summary || coachPacket.summary),
        priorities: priorities.length ? priorities : coachPacket.priorities.slice(0, 3).map((item) => ({ area: item.area, evidence: item.evidence, interpretation: item.interpretation, action: item.action })),
        strengths: Array.isArray(parsed.strengths) ? parsed.strengths.slice(0, 3).map(String) : coachPacket.strengths.slice(0, 2).map((item) => item.title),
        sessionPlan: String(parsed.sessionPlan || "Öncelikli üç bulgunun geçtiği roundları sırayla izle ve tek bir davranış hedefi seç."),
        confidence: Math.max(0, Math.min(100, Number(parsed.confidence) || coachPacket.confidence)),
      });
      await verifyOllamaReleased();
    } catch (aiError) {
      setOllamaState("offline");
      setError(`Ollama analizi alınamadı. ${aiError instanceof Error ? aiError.message : "Bağlantıyı kontrol et."}`);
    }
  }

  async function checkSteamMatch() {
    setSourceMessage("Valve maç geçmişi kontrol ediliyor…");
    try {
      const response = await fetch("/api/steam/next", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ steamid: steamId, apiKey: steamWebApiKey, authCode: steamAuthCode, knownCode: steamKnownCode }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Valve sorgusu başarısız");
      setSourceMessage(payload.nextCode ? `Yeni maç bulundu: ${payload.nextCode}` : "Yeni Valve maçı yok; geçmiş güncel.");
      if (payload.nextCode) setSteamKnownCode(payload.nextCode);
    } catch (sourceError) {
      setSourceMessage(sourceError instanceof Error ? sourceError.message : "Valve bağlantısı kurulamadı.");
    }
  }

  async function checkFaceit() {
    setSourceMessage("FACEIT profili kontrol ediliyor…");
    try {
      const response = await fetch(`/api/faceit/player?nickname=${encodeURIComponent(faceitNickname)}`, { headers: faceitApiKey ? { "X-Faceit-Api-Key": faceitApiKey } : {} });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "FACEIT sorgusu başarısız");
      setSourceMessage(`${payload.player.nickname} bulundu · ${payload.matches.length} son maç hazır.`);
    } catch (sourceError) {
      setSourceMessage(sourceError instanceof Error ? sourceError.message : "FACEIT bağlantısı kurulamadı.");
    }
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand"><span>TR</span><strong>TRACER</strong></div>
        <nav aria-label="Ana menü">
          <button className={`nav-item ${activeSection === "dashboard" ? "active" : ""}`} onClick={() => navigateTo("dashboard")}><span>⌁</span> Genel bakış</button>
          <button className={`nav-item ${activeSection === "side-analysis" ? "active" : ""}`} onClick={() => navigateTo("side-analysis")}><span>CT</span> Taraf analizi</button>
          <button className={`nav-item ${activeSection === "weapon-profile" ? "active" : ""}`} onClick={() => navigateTo("weapon-profile")}><span>⌁</span> Silah profili</button>
          <button className={`nav-item ${activeSection === "map-analysis" ? "active" : ""}`} onClick={() => navigateTo("map-analysis")}><span>⌖</span> Harita olayları</button>
          <button className={`nav-item ${activeSection === "development" ? "active" : ""}`} onClick={() => navigateTo("development")}><span>↗</span> Gelişim planı</button>
          <button className="nav-item" onClick={() => { setArchiveOpen(true); void refreshCompanion(); }}><span>▤</span> Yerel maçlar</button>
        </nav>
        <div className="sidebar-spacer" />
        <button className={`ai-status ${ollamaState}`} onClick={() => setSettingsOpen(true)}>
          <span className="pulse" />
          <div><b>{ollamaState === "released" ? "KAYNAKLAR BIRAKILDI" : ollamaState === "online" ? "OLLAMA BAĞLI" : ollamaState === "thinking" ? "OLLAMA DÜŞÜNÜYOR" : "OLLAMA AYARLA"}</b><small>{ollamaModel} · yerel</small></div>
        </button>
        <div className="player-card">
          <div className="avatar">KD</div>
          <div><b>{report?.player.name || "Oyuncu seçilmedi"}</b><small>{report ? `${report.map || "CS2"} · ${report.rounds} round` : "Demo verisi bekleniyor"}</small></div>
          <span>•••</span>
        </div>
      </aside>

      <section className="workspace" id="dashboard">
        <header className="topbar">
          <div>
            <p className="eyebrow">PERFORMANS MERKEZİ</p>
            <h1>{report ? `${report.player.name} için analiz hazır.` : "Demo analizine hazır."}</h1>
          </div>
          <div className="top-actions">
            <button className="ghost-button archive-trigger" onClick={() => { setArchiveOpen(true); void refreshCompanion(); }}>▤ Yerel maçlar</button>
            <button className="ghost-button" onClick={() => setSettingsOpen(true)}>⚙ Kaynakları bağla</button>
            <label className="upload-button">
              <input type="file" accept=".dem,.bz2" onChange={handleDemo} />
              <span>＋</span> {status === "parsing" || status === "reading" ? "%" + progress : "Demo yükle"}
            </label>
          </div>
        </header>

        <div className="match-strip">
          <div className="map-thumb"><span>A</span><span>B</span></div>
          <div><p>{report ? "YÜKLENEN DEMO" : "ANALİZ BEKLİYOR"}</p><b>{report ? `${report.map || "Bilinmeyen harita"} · ${fileName}` : "Yerel maçlardan bir demo seç veya yükle"}</b></div>
          <span className="win-pill">{report ? `${report.rounds} ROUND` : "HAZIR"}</span>
          <b className="score">{report ? report.kills : "—"} <i>:</i> {report ? report.deaths : "—"}</b>
          <div className="match-meta"><span>{report ? "Cihazında yerel analiz" : "Sahte istatistik gösterilmiyor"}</span><span>{report ? `${report.assists} asist · ${report.adr} ADR` : "Gerçek demo verisi bekleniyor"}</span></div>
          <button className="icon-button" aria-label="Yerel maç arşivini aç" onClick={() => { setArchiveOpen(true); void refreshCompanion(); }}>⌄</button>
        </div>

        {report && (
          <section className="player-switcher" aria-label="Analiz edilecek oyuncu">
            <div className="player-switcher-avatar">{report.player.name.slice(0, 2).toLocaleUpperCase("tr-TR")}</div>
            <div className="player-switcher-copy"><span>ANALİZ EDİLEN OYUNCU</span><b>{report.player.name}</b><small>{reports.length} oyuncu bulundu · seçim tüm raporu ve koç tavsiyesini değiştirir</small></div>
            <label>
              <span>Oyuncuyu değiştir</span>
              <select value={selectedPlayer} onChange={(event) => { setSelectedPlayer(event.target.value); setAiInsight(null); }}>
                {reports.map((item) => <option key={playerKey(item)} value={playerKey(item)}>{item.player.name}</option>)}
              </select>
            </label>
          </section>
        )}

        {(status === "reading" || status === "parsing" || status === "ready" || status === "error") && (
          <div className={`analysis-progress ${status}`} role="status">
            <div><span>{status === "error" ? "!" : status === "ready" ? "✓" : "↻"}</span><b>{status === "error" ? error : progressLabel}</b><small>{status === "ready" ? "Veri cihazından ayrılmadı." : status === "error" ? "Dosyayı kontrol edip yeniden dene." : `${progress}%`}</small></div>
            <div className="progress-track"><i style={{ width: `${status === "error" ? 100 : progress}%` }} /></div>
          </div>
        )}

        <div className="metrics-row">
          {metrics.map((metric) => (
            <article className="metric-card" key={metric.label}>
              <span>{metric.label}</span>
              <div><strong>{metric.value}</strong><em className={metric.tone}>{metric.delta}</em></div>
            </article>
          ))}
          <article className="metric-card focus-score">
            <span>Maç etkisi</span>
            <div><strong>{report?.impact ?? "—"}</strong><small>/100</small></div>
            <div className="score-line"><i style={{ width: `${report?.impact ?? 0}%` }} /></div>
          </article>
        </div>

        <section className="side-analysis" id="side-analysis">
          <div className="section-title-row"><div><p className="eyebrow">CT / T AYRIMI</p><h2>İki taraf, iki farklı oyun problemi</h2></div><span>{report?.sideStats?.length ? "Gerçek taraf verisi" : "Yeni parser analizi gerekli"}</span></div>
          {report ? <div className="side-grid">
            {([ctStats, tStats] as (SideStat | undefined)[]).map((side, index) => {
              const sideName = index === 0 ? "CT" : "T";
              return <article className={`side-card ${sideName.toLowerCase()}`} key={sideName}>
                <header><span>{sideName}</span><div><b>{sideName === "CT" ? "Savunma tarafı" : "Hücum tarafı"}</b><small>{side ? `${side.rounds} gözlenen round` : "Demo yeniden analiz edildiğinde dolar"}</small></div></header>
                <div className="side-metrics"><div><span>K / D</span><b>{side ? `${side.kills} / ${side.deaths}` : "—"}</b></div><div><span>ADR</span><b>{side?.adr ?? "—"}</b></div><div><span>Trade</span><b>{side ? `%${side.tradePercent}` : "—"}</b></div><div><span>Hareketli atış</span><b>{side ? `%${side.movingShotPercent}` : "—"}</b></div></div>
                <footer><span>En çok öldüğün bölge</span><b>{side ? `${side.topZone} · ${side.topZoneDeaths}` : "—"}</b></footer>
              </article>;
            })}
          </div> : <div className="section-empty"><b>CT/T değerlendirmesi için demo gerekli</b><span>Demosuz ekranda taraf istatistiği veya örnek sonuç gösterilmez.</span></div>}
          {report && <p className="data-caveat">Taraf ADR’sindeki round sayısı oyuncunun olay ürettiği roundlardan hesaplanır. Sessiz roundlar nedeniyle genel ADR kadar kesin olmayabilir; K/D ve ölüm bölgeleri doğrudan olay kaydıdır.</p>}
        </section>

        <div className="dashboard-grid">
          <article className="coach-card">
            <div className="card-kicker"><span className="spark">✦</span> {aiInsight ? "KURAL MOTORU + OLLAMA KOÇ" : "KANITA DAYALI KURAL MOTORU"} {report && coachConfidence !== undefined && <em>%{coachConfidence} güven · LLM hüküm vermez</em>}</div>
            {coachPacket && <><div className="classification-head"><span>TÜM HATA SINIFLANDIRMASI</span><b>Kritik → yüksek → orta → küçük → güçlü</b></div><div className="coach-dimensions">{coachPacket.dimensions.map((item) => <span className={item.status} key={item.area}><i />{item.area}<b>{item.label}</b></span>)}</div></>}
            {report && coachPacket ? <>
              <h2>{coachTitle}<br/><span>maçın tamamından çıkarılan koç raporu.</span></h2>
              <p className="coach-copy">{coachSummary}</p>
              <div className="coach-priority-list">
                {coachCards.map((item, index) => (
                  <article className={`coach-priority ${item.severity}`} key={item.id}>
                    <header><span>{String(index + 1).padStart(2, "0")}</span><div><small>{item.area}</small><b>{item.title}</b></div><em className={`severity-badge ${item.severity}`}>{SEVERITY_LABEL[item.severity]}</em></header>
                    <p><strong>Kanıt</strong>{item.evidence}</p>
                    <p><strong>Koç hedefi</strong>{item.action}</p>
                  </article>
                ))}
              </div>
              {report.movementProfile && <section className="movement-spectrum">
                <header><div><span>ATIŞ HIZI PROFİLİ</span><b>Ortalama {report.movementProfile.averageSpeed} u/s · P90 {report.movementProfile.p90Speed} u/s</b></div><em className={`severity-badge ${coachPacket.findings.find((item) => item.id === "movement")?.severity || "info"}`}>{report.movementProfile.severityScore}/100 hata ağırlığı</em></header>
                <div className="movement-bands">
                  {[
                    { label: "Sabit", range: "≤15", percent: report.movementProfile.stablePercent, className: "stable" },
                    { label: "Mikro", range: "15–50", percent: report.movementProfile.microPercent, className: "micro" },
                    { label: "Belirgin", range: "50–120", percent: report.movementProfile.movingPercent, className: "moving" },
                    { label: "Yüksek", range: ">120", percent: report.movementProfile.fastPercent, className: "fast" },
                  ].map((band) => <div key={band.label}><span><b>{band.label}</b>{band.range} u/s</span><i><em className={band.className} style={{ width: `${band.percent}%` }}/></i><strong>%{band.percent}</strong></div>)}
                </div>
                <p>Mikro hareketler düşük ağırlıkla değerlendirilir; yüksek hızdaki atışlar hata puanını daha fazla yükseltir.</p>
              </section>}
              <section className="death-patterns">
                <header><div><span>ORTAK ÖLÜM ÖRÜNTÜLERİ</span><b>Ölümlerde tekrar eden koşullar</b></div><small>{deathPatterns.length ? `${deathPatterns.length} örüntü sınıflandırıldı` : "Güçlü tekrar yok"}</small></header>
                {deathPatterns.length ? <div>{deathPatterns.map((pattern) => <article key={pattern.id}>
                  <span className={`severity-badge ${pattern.severity}`}>{SEVERITY_LABEL[pattern.severity]}</span>
                  <section><b>{pattern.title}</b><p>{pattern.evidence}</p><small>{pattern.interpretation}</small></section>
                  <em>{pattern.count} ölüm · %{pattern.share}</em>
                </article>)}</div> : <p className="pattern-empty">Bu demoda ortak ölüm özelliği için yeterli tekrar oluşmadı.</p>}
              </section>
            </> : <div className="analysis-empty-state">
              <span>✦</span><b>Koç raporu için demo gerekli</b>
              <p>TRACER tahmin üretmiyor. Demo analiz edildiğinde gerçek hareket hızı, ölüm örüntüsü, taraf, utility, trade ve round etkisi sınıflandırılacak.</p>
              <button onClick={() => { setArchiveOpen(true); void refreshCompanion(); }}>Yerel maç seç</button>
            </div>}
            {report && <button className="ollama-coach-button" onClick={runAiCoach} disabled={ollamaState === "thinking"}>{ollamaState === "thinking" ? "Koç maçın genelini yorumluyor…" : "✦ Koçtan tavsiye al"}</button>}
            {aiInsight && <div className="coach-session"><span>SONRAKİ ÇALIŞMA</span><b>{aiInsight.sessionPlan}</b>{aiInsight.strengths.length > 0 && <p>Güçlü taraflar: {aiInsight.strengths.join(" · ")}</p>}</div>}
            {coachPacket && coachPacket.positionZones.length > 0 && <div className="position-scan"><div><b>Taranan ölüm bölgeleri</b><span>Tek bölgeye körlenmeden tüm konum dağılımı</span></div><section>{coachPacket.positionZones.map((item) => <span key={item.zone}><b>{item.zone}</b>{item.deaths} ölüm · %{item.share}</span>)}</section></div>}
            <details className="coach-rulebook">
              <summary><span>▤</span><div><b>TRACER oyun kural kitabı</b><small>{COACH_RULES.length} kontrol · rol ve round bağlamı korunur</small></div><em>İncele</em></summary>
              <div className="rulebook-list">{COACH_RULES.map((rule) => <article key={rule.id}><span>{rule.area}</span><b>{rule.title}</b><p><strong>Hedef:</strong> {rule.target}</p><p>{rule.rationale}</p><small>{rule.caveat}</small></article>)}</div>
            </details>
            {report && <div className="evidence-list">
              {evidence.map((item) => (
                <button className="evidence-item" key={`${item.round}-${item.time}`}>
                  <span className="round-tag">{item.round}</span>
                  <b>{item.time}</b>
                  <p>{item.text}</p>
                  <em>{item.type}</em>
                  <i>›</i>
                </button>
              ))}
            </div>}
          </article>

          <article className="map-card" id="map-analysis">
            <div className="section-head">
              <div><p>HARİTA OLAYLARI</p><h3>Kill ve ölüm konumların</h3></div>
              <div className="map-controls">
                <div className="segmented side-segment"><button className={sideFilter === "all" ? "selected" : ""} onClick={() => setSideFilter("all")}>TÜMÜ</button><button className={sideFilter === "CT" ? "selected" : ""} onClick={() => setSideFilter("CT")}>CT</button><button className={sideFilter === "T" ? "selected" : ""} onClick={() => setSideFilter("T")}>T</button></div>
                {radarMap?.lowerImage && <div className="segmented"><button className={mapLevel === "upper" ? "selected" : ""} onClick={() => setMapLevel("upper")}>ÜST</button><button className={mapLevel === "lower" ? "selected" : ""} onClick={() => setMapLevel("lower")}>ALT</button></div>}
              </div>
            </div>
            <div className="radar" role="img" aria-label={`${report?.map || "Harita"} üzerinde kill ve ölüm noktaları`}>
              {radarImage && <img className="radar-image" src={radarImage} alt="" draggable="false" />}
              {report && !radarMap && <div className="radar-unavailable">Bu harita için radar kalibrasyonu henüz yok.</div>}
              {radarMap && visibleDeaths.map((item, index) => {
                if (item.x === 0 && item.y === 0) return null;
                const point = worldToRadar(item.x, item.y, radarMap);
                if (point.left < 0 || point.left > 100 || point.top < 0 || point.top > 100) return null;
                return <span key={`d-${item.tick}-${index}`} className="death dynamic-death" style={{ left: `${point.left}%`, top: `${point.top}%` }} title={`Ölüm · ${item.side || "?"} · R${item.round} · ${item.zone} · ${item.killer} (${item.weapon})${item.speed !== undefined ? ` · ${item.speed} u/s` : ""}${item.openingDeath ? " · opening" : ""}${item.wasBlind ? " · kör" : ""}`}>×</span>;
              })}
              {radarMap && visibleKills.map((item, index) => {
                if (item.x === 0 && item.y === 0) return null;
                const point = worldToRadar(item.x, item.y, radarMap);
                if (point.left < 0 || point.left > 100 || point.top < 0 || point.top > 100) return null;
                return <span key={`k-${item.tick}-${index}`} className="kill dynamic-kill" style={{ left: `${point.left}%`, top: `${point.top}%` }} title={`Kill · ${item.side} · R${item.round} · ${item.zone} · ${item.weapon}${item.headshot ? " · HS" : ""}`}>＋</span>;
              })}
              {!report && <div className="radar-empty"><b>Harita olayı yok</b><span>Demo analiz edildiğinde gerçek kill ve ölüm noktaları burada görünür.</span></div>}
              {report && <div className="map-event-count"><span><i className="red-dot"/>{visibleDeaths.length} ölüm</span><span><i className="green-dot"/>{visibleKills.length} kill</span><b>{sideFilter === "all" ? "CT + T" : sideFilter}</b></div>}
            </div>
            <div className="map-legend"><span><i className="red-dot"/>Ölüm</span><span><i className="green-dot"/>Kill</span><span>{report ? (radarMap?.label || report.map || "Bilinmeyen harita") : "Demo bekleniyor"}</span>{report && <button>İşaretin üzerine gel: round, taraf, silah</button>}</div>
          </article>
        </div>

        <section className="weapon-profile" id="weapon-profile">
          <div className="section-title-row"><div><p className="eyebrow">SİLAH UZMANLIĞI</p><h2>Hangi silahın taşıyor, hangisi seni yavaşlatıyor?</h2><p>Tek maç “uzmanım” demek için yetmez; TRACER bu maçtan uzmanlık ve gelişim adayları çıkarır.</p></div><span>{weaponStats.length ? `${weaponStats.length} silah ölçüldü` : "Demo verisi bekleniyor"}</span></div>
          {report ? <><div className="weapon-highlights">
            <article className="weapon-hero strong"><span>BU MAÇTAKİ GÜÇLÜ SİLAH</span><h3>{strongestWeapon?.label || "—"}</h3><p>{strongestWeapon ? `${strongestWeapon.kills} kill · ${strongestWeapon.damage} hasar · %${strongestWeapon.headshotPercent} HS` : "Gerçek silah olayları analiz edildiğinde görünür."}</p><div><i style={{ width: `${strongestWeapon?.score || 0}%` }}/></div><small>{strongestWeapon ? `${strongestWeapon.score}/100 maç içi kanıt skoru` : "Örnek istatistik gösterilmiyor"}</small></article>
            <article className="weapon-hero develop"><span>GELİŞİM ADAYI</span><h3>{developmentWeapon?.label || "—"}</h3><p>{developmentWeapon ? `${developmentWeapon.shots} atış · ${developmentWeapon.kills} kill · %${developmentWeapon.movingShotPercent} hareketli atış` : "Yeterli ikinci silah örneği yok."}</p><b>{developmentWeapon ? (developmentWeapon.movingShotPercent > 12 ? "Önce duruş ve ilk burst" : "İlk mermi ve recoil reset") : "Yeni demo bekleniyor"}</b><small>Bu öneri kullanım hacmi ve verime göre seçilir.</small></article>
          </div>
          <div className="weapon-table" role="table" aria-label="Silah performansı">
            <div className="weapon-table-head" role="row"><span>Silah</span><span>Kill</span><span>Hasar</span><span>Atış</span><span>HS</span><span>Hareketli</span><span>Durum</span></div>
            {weaponStats.map((weapon) => <div className="weapon-row" role="row" key={weapon.weapon}><b>{weapon.label}</b><span>{weapon.kills}</span><span>{weapon.damage}</span><span>{weapon.shots}</span><span>%{weapon.headshotPercent}</span><span>%{weapon.movingShotPercent}</span><em className={weapon.status}>{weapon.status === "signature" ? "Uzmanlık adayı" : weapon.status === "strong" ? "Güçlü" : weapon.status === "developing" ? "Geliştir" : "Az örnek"}</em></div>)}
            {!weaponStats.length && <div className="weapon-empty">Silah bazlı kill, hasar ve atış verisi için demoyu güncel yerel parser ile analiz et.</div>}
          </div></> : <div className="section-empty"><b>Silah profili için demo gerekli</b><span>Güçlü silah, gelişim adayı ve tablo yalnızca gerçek silah olaylarından üretilecek.</span></div>}
        </section>

        <section className="development-plan" id="development">
          <div className="development-intro"><div><p className="eyebrow">GELİŞİM PLANI</p><h2>İstatistiği bir sonraki çalışma seansına çevir</h2><p>Bu bölüm yalnızca “kötü oynadın” demez. Öncelikli hatayı, kullanılacak drill’i, taraf incelemesini ve başarı ölçütünü tek sıraya koyar.</p></div><span>{report ? `Toplam ${developmentSteps.reduce((sum, item) => sum + Number.parseInt(item.duration), 0)} dk` : "Plan bekliyor"}</span></div>
          {developmentSteps.length ? <div className="plan-grid">{developmentSteps.map((step) => <article key={step.number}><header><span>{step.number}</span><em>{step.duration}</em></header><h3>{step.title}</h3><p><b>Neden?</b>{step.reason}</p><p><b>Ne yapacaksın?</b>{step.work}</p><footer><span>Başarı ölçütü</span><b>{step.success}</b></footer></article>)}</div> : <div className="plan-empty"><b>Kişisel plan için bir demo analiz et.</b><span>TRACER taraf, pozisyon, silah ve koç bulgularını tek çalışma sırasına dönüştürecek.</span><button onClick={() => { setArchiveOpen(true); void refreshCompanion(); }}>Yerel maç seç</button></div>}
          {report && <div className="plan-protocol"><span>Profesyonel gelişim döngüsü</span><b>Analiz et → tek davranış hedefi seç → 30–40 dk çalış → sonraki demoda aynı metriği yeniden ölç</b><p>Bir maç rastlantı olabilir. “Uzmanlık” veya kalıcı zayıflık etiketi için aynı haritada en az 5 demo karşılaştır.</p></div>}
        </section>
      </section>

      {archiveOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setArchiveOpen(false); }}>
          <section className="settings-modal archive-modal" role="dialog" aria-modal="true" aria-labelledby="archive-title">
            <button className="modal-close" onClick={() => setArchiveOpen(false)} aria-label="Yerel maçları kapat">×</button>
            <div className="archive-heading">
              <div><p className="eyebrow">CİHAZINDAKİ DEMOLAR</p><h2 id="archive-title">Yerel maç arşivi</h2></div>
              <span className={`companion-chip ${companionState}`}><i />{companionState === "online" ? "Parser 0.42 bağlı" : companionState === "checking" ? "Parser aranıyor" : "Parser kapalı"}</span>
            </div>
            <p>Bir klasör seç; maçlarını tarihe göre listele, istediğini analiz et veya onay vererek sil. Seçim yalnızca bu tarayıcıda hatırlanır ve hiçbir yol varsayılan yapılmaz.</p>
            <div className="archive-toolbar">
              <div><span>SEÇİLİ KLASÖR</span><b>{demoDirectory?.name || "Henüz klasör seçilmedi"}</b></div>
              <button className="upload-button" onClick={pickDemoDirectory}>{demoDirectory ? "Klasörü değiştir" : "Klasör seç"}</button>
              {demoDirectory && <button className="ghost-button archive-refresh" onClick={() => scanDirectory(demoDirectory)} disabled={archiveBusy}>↻ Yenile</button>}
            </div>
            {companionState === "offline" && (
              <div className="companion-warning"><b>Güncel Valve demoları için yerel parser kapalı.</b><span><code>TRACER-Yerel.cmd</code> dosyasını çalıştır, bu pencereyi açık tut ve tekrar dene.</span><button onClick={() => void refreshCompanion()}>Bağlantıyı yenile</button></div>
            )}
            {archiveMessage && <div className="archive-message">{archiveMessage}</div>}
            <div className="demo-library" aria-busy={archiveBusy}>
              {!archiveBusy && !demoFiles.length && <div className="archive-empty"><span>▤</span><b>Demo listesi boş</b><p>CS2 içinden indirdiğin maçların bulunduğu klasörü seç.</p></div>}
              {demoFiles.map((entry) => (
                <article className="demo-row" key={entry.name}>
                  <div className="demo-file-icon">DEM</div>
                  <div className="demo-file-copy"><b>{entry.name}</b><span>{new Date(entry.lastModified).toLocaleString("tr-TR")} · {formatBytes(entry.size)}</span></div>
                  <div className="demo-actions">
                    <button className="analyze-demo" onClick={() => void analyzeArchiveEntry(entry)}>Analiz et</button>
                    <button className="delete-demo" onClick={() => void deleteArchiveEntry(entry)} aria-label={`${entry.name} dosyasını sil`}>Sil</button>
                  </div>
                </article>
              ))}
            </div>
            <p className="local-privacy">Demo yalnızca tarayıcıdan <code>127.0.0.1</code> üzerindeki yerel parsera gider; buluta yüklenmez. Silme işlemi seçtiğin klasörde ve yalnızca onayından sonra yapılır.</p>
          </section>
        </div>
      )}

      {settingsOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSettingsOpen(false); }}>
          <section className="settings-modal integration-modal" role="dialog" aria-modal="true" aria-labelledby="settings-title">
            <button className="modal-close" onClick={() => setSettingsOpen(false)} aria-label="Ayarları kapat">×</button>
            <p className="eyebrow">YEREL AI</p>
            <h2 id="settings-title">Ollama bağlantısı</h2>
            <p>Analiz özeti yalnızca cihazındaki Ollama servisine gönderilir. Demo dosyasının kendisi gönderilmez.</p>
            <label>Sunucu adresi<input value={ollamaUrl} onChange={(event) => setOllamaUrl(event.target.value)} /></label>
            <label>Model<input list="ollama-models" value={ollamaModel} onChange={(event) => setOllamaModel(event.target.value)} /></label>
            <datalist id="ollama-models"><option value="qwen3:1.7b">Önerilen · dengeli</option><option value="qwen3.5:0.8b">En hafif</option><option value="qwen3:4b-instruct">Daha kaliteli</option></datalist>
            <div className="settings-actions"><button className="ghost-button" onClick={testOllama}>{ollamaState === "checking" ? "Kontrol ediliyor…" : "Bağlantıyı test et"}</button><button className="upload-button" onClick={() => setSettingsOpen(false)}>Kaydet</button></div>
            <div className={`connection-result ${ollamaState}`}>{ollamaState === "released" ? ollamaResourceMessage : ollamaState === "online" ? `✓ Ollama erişilebilir · ${ollamaResourceMessage}` : ollamaState === "offline" ? "Ollama'ya ulaşılamadı. OLLAMA_ORIGINS ayarını kontrol et." : "Varsayılan: http://127.0.0.1:11434 · 4096 context · anında unload"}</div>
            <details className="demo-help">
              <summary>Demo dosyasını nerede bulurum?</summary>
              <ol><li>CS2 içinde İzle → Maçların bölümünü aç.</li><li>Premier/Competitive maçını seçip indirme okuna bas.</li><li><code>…\Steam\steamapps\common\Counter-Strike Global Offensive\game\csgo\replays</code> klasöründeki <code>.dem</code> dosyasını yükle.</li></ol>
              <p>Casual maçlar otomatik GOTV demosu sunmayabilir; tam konum analizi için Premier/Competitive demosu en sağlıklısıdır.</p>
            </details>
            <hr/>
            <p className="eyebrow">MAÇ KAYNAKLARI</p>
            <div className="connection-wizard">
              <section className="connect-card steam-connect">
                <header><span>01</span><div><b>Steam Premier / Competitive</b><small>SteamID64 + Web API key + Game Authentication Code + paylaşım kodu</small></div><em>Özel</em></header>
                <div className="connect-steps">
                  <div><span>1</span><p><b>Resmî Steam kod sayfasını aç</b><small>Steam’e giriş yap; CS2 maç geçmişi erişim kodunu oluştur veya mevcut kodunu görüntüle.</small></p><a href="https://help.steampowered.com/en/wizard/HelpWithGameIssue/?appid=730&issueid=128" target="_blank" rel="noreferrer">Steam kod sayfasını aç ↗</a></div>
                  <div><span>2</span><p><b>Steam Web API key oluştur</b><small>Valve maç geçmişi endpoint’i geliştirici API anahtarı da ister.</small></p><a href="https://steamcommunity.com/dev/apikey" target="_blank" rel="noreferrer">API key sayfasını aç ↗</a></div>
                  <div><span>3</span><p><b>Dört değeri buraya yapıştır</b><small>Anahtarlar yalnızca açık sayfadaki sorguda kullanılır; tarayıcı depolamasına yazılmaz.</small></p></div>
                </div>
                <div className="guided-form">
                  <label><span>SteamID64</span><input inputMode="numeric" placeholder="17 haneli SteamID64" value={steamId} onChange={(event) => setSteamId(event.target.value.trim())} /></label>
                  <label><span>Steam Web API key</span><input type="password" autoComplete="off" placeholder="Steam geliştirici anahtarın" value={steamWebApiKey} onChange={(event) => setSteamWebApiKey(event.target.value.trim())} /></label>
                  <label><span>Game Authentication Code</span><input type="password" autoComplete="off" placeholder="AAAA-AAAAA-AAAA" value={steamAuthCode} onChange={(event) => setSteamAuthCode(event.target.value.trim())} /></label>
                  <label><span>Son maç paylaşım kodu</span><input placeholder="CSGO-xxxxx-xxxxx-xxxxx-xxxxx-xxxxx" value={steamKnownCode} onChange={(event) => setSteamKnownCode(event.target.value.trim())} /></label>
                  <button className="upload-button" onClick={checkSteamMatch}>Bağlantıyı doğrula</button>
                </div>
                <footer><span>?</span><p>Paylaşım kodu aynı Steam hesabına ait olmalı. Steam bu yöntemde geçersiz kod denemelerini hızla sınırlar.</p><a href="https://developer.valvesoftware.com/wiki/Counter-Strike%3A_Global_Offensive_Access_Match_History" target="_blank" rel="noreferrer">Valve rehberi ↗</a></footer>
              </section>
              <section className="connect-card faceit-connect">
                <header><span>02</span><div><b>FACEIT</b><small>Herkese açık maç geçmişi için yalnızca kullanıcı adı</small></div><em>Şifresiz</em></header>
                <p className="connect-explainer">TRACER senden FACEIT şifresi istemez. Kendi FACEIT Developer App’inden oluşturduğun Data API key ve kullanıcı adıyla herkese açık maç geçmişini okur; anahtar bu sayfada saklanmaz.</p>
                <div className="faceit-key-links"><a href="https://developers.faceit.com/" target="_blank" rel="noreferrer">FACEIT Developer Portal’ı aç ↗</a><a href="https://docs.faceit.com/docs/data-api/" target="_blank" rel="noreferrer">Data API key rehberi ↗</a></div>
                <div className="faceit-quick"><input type="password" autoComplete="off" aria-label="FACEIT Data API key" placeholder="FACEIT Data API key" value={faceitApiKey} onChange={(event) => setFaceitApiKey(event.target.value.trim())} /><input aria-label="FACEIT kullanıcı adı" placeholder="FACEIT kullanıcı adın" value={faceitNickname} onChange={(event) => setFaceitNickname(event.target.value)} /><button className="upload-button" onClick={checkFaceit}>Profili bul</button><a href="https://www.faceit.com/en/login" target="_blank" rel="noreferrer">FACEIT’te oturum aç ↗</a></div>
                <details className="oauth-note"><summary>Tek tık OAuth bağlantısı neden henüz yok?</summary><p>FACEIT Connect için kayıtlı bir OAuth istemcisi, izin ekranı, yönlendirme adresi ve güvenli sunucu tarafı kod değişimi gerekir. Sahte bir “bağlan” butonu yerine şimdilik şifresiz kullanıcı adı akışı kullanılıyor.</p><a href="https://docs.faceit.com/getting-started/authentication/oauth2/" target="_blank" rel="noreferrer">Resmî FACEIT OAuth rehberi ↗</a></details>
              </section>
            </div>
            {sourceMessage && <div className="connection-result">{sourceMessage}</div>}
          </section>
        </div>
      )}
    </main>
  );
}
