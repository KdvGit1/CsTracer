"use client";

import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import { radarMapFor, worldToRadar } from "./map-data";
import "./analysis.css";
import { CompactCoachVerdict, CompactMatchSummary, GrowthView, ProgressMatch } from "./growth";
import { HitboxMannequin } from "./components/HitboxMannequin";
import { MapEmblem, formatMapTitle, normalizeMapKey } from "./components/MapEmblem";
import {
  IconDashboard,
  IconGrowth,
  IconCrosshair,
  IconDuel,
  IconEconomy,
  IconSideAnalysis,
  IconWeapon,
  IconMap,
  IconPlan,
  IconFolder,
  IconSettings,
  IconWarning,
  IconSparkles,
  IconCopy,
  IconCheck,
  IconFileText,
} from "./components/NavIcons";
import { AimCoachCard, evaluateAimMechanics } from "./components/AimCoachCard";
import LiveCoachView from "./components/LiveCoachView";
import UpdateModal, { UpdateInfo } from "./components/UpdateModal";

const COMPANION_URL = "http://127.0.0.1:43119";
const PROGRESS_URL = `${COMPANION_URL}/progress`;
const HANDLE_DATABASE = "tracer-local";
const HANDLE_STORE = "handles";
const DEMO_DIRECTORY_KEY = "demo-directory";
const DEMO_META_CACHE_KEY = "tracer_demo_meta_cache_v3";

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
type DemoFileEntry = {
  name: string;
  size: number;
  lastModified: number;
  handle: LocalFileHandle;
  map?: string;
  score?: string;
  ctScore?: number;
  tScore?: number;
  totalRounds?: number;
};
type CompanionState = "checking" | "online" | "offline";
export type CoachEngine = "embedded" | "ollama";
export type CoachState = "unknown" | "checking" | "online" | "offline" | "thinking" | "released";

function getDemoMetaCache(): Record<string, { map: string; score: string; ctScore?: number; tScore?: number; totalRounds?: number }> {
  try {
    const raw = localStorage.getItem(DEMO_META_CACHE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveDemoMetaToCache(key: string, meta: { map: string; score: string; ctScore?: number; tScore?: number; totalRounds?: number }) {
  try {
    const cache = getDemoMetaCache();
    cache[key] = meta;
    localStorage.setItem(DEMO_META_CACHE_KEY, JSON.stringify(cache));
  } catch {
    // ignore
  }
}

function inferMapFromName(name: string): string {
  const lower = name.toLowerCase();
  if (lower.includes("dust2") || lower.includes("dust_2") || lower.includes("dust")) return "de_dust2";
  if (lower.includes("mirage")) return "de_mirage";
  if (lower.includes("inferno")) return "de_inferno";
  if (lower.includes("nuke")) return "de_nuke";
  if (lower.includes("ancient")) return "de_ancient";
  if (lower.includes("anubis")) return "de_anubis";
  if (lower.includes("vertigo")) return "de_vertigo";
  if (lower.includes("overpass")) return "de_overpass";
  if (lower.includes("train")) return "de_train";
  if (lower.includes("office")) return "cs_office";
  if (lower.includes("italy")) return "cs_italy";
  return "";
}

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

function getAngleTier(angle: number, type: "head" | "body" = "head") {
  if (type === "head") {
    if (angle <= 3.5) return { label: "Pro Seviye", tone: "pro" as const, range: "< 3.5°", hint: "Tier 1 CS2 Pro standardı" };
    if (angle <= 5.0) return { label: "İyi", tone: "good" as const, range: "3.5° - 5.0°", hint: "Faceit 8-10 / İleri seviye" };
    if (angle <= 7.0) return { label: "Normal", tone: "normal" as const, range: "5.1° - 7.0°", hint: "Ortalama, mikro düzeltme var" };
    return { label: "Geliştirilmeli", tone: "poor" as const, range: "> 7.0°", hint: "Nişangah kafa hizasından uzak" };
  } else {
    if (angle <= 5.5) return { label: "Pro Seviye", tone: "pro" as const, range: "< 5.5°", hint: "Gövde eksenine kilitli" };
    if (angle <= 8.5) return { label: "İyi", tone: "good" as const, range: "5.5° - 8.5°", hint: "Temiz gövde hizalaması" };
    if (angle <= 12.0) return { label: "Normal", tone: "normal" as const, range: "8.6° - 12.0°", hint: "Ortalama gövde sapması" };
    return { label: "Geliştirilmeli", tone: "poor" as const, range: "> 12.0°", hint: "Geniş gövde sapması" };
  }
}

function getSprayTier(value: number, type: "overall" | "early" | "late" | "head") {
  if (type === "overall") {
    if (value >= 26) return { label: "Pro Seviye", tone: "pro" as const, hint: "CS2 Tier 1 genel isabet" };
    if (value >= 20) return { label: "İyi", tone: "good" as const, hint: "İleri seviye isabet oranı" };
    if (value >= 15) return { label: "Normal", tone: "normal" as const, hint: "Ortalama mermi isabeti" };
    return { label: "Geliştirilmeli", tone: "poor" as const, hint: "Düşük isabet, fazla spam" };
  } else if (type === "early") {
    if (value >= 50) return { label: "Pro Seviye", tone: "pro" as const, hint: "Kusursuz ilk 3 mermi burst" };
    if (value >= 40) return { label: "İyi", tone: "good" as const, hint: "Güçlü ilk temas isabeti" };
    if (value >= 28) return { label: "Normal", tone: "normal" as const, hint: "Ortalama ilk mermi başarısı" };
    return { label: "Geliştirilmeli", tone: "poor" as const, hint: "İlk mermilerde ıskalama yüksek" };
  } else if (type === "late") {
    if (value >= 35) return { label: "Pro Seviye", tone: "pro" as const, hint: "Mükemmel sprey recoil kontrolü" };
    if (value >= 25) return { label: "İyi", tone: "good" as const, hint: "Kontrollü uzun sprey" };
    if (value >= 16) return { label: "Normal", tone: "normal" as const, hint: "Ortalama sprey transferi" };
    return { label: "Geliştirilmeli", tone: "poor" as const, hint: "Recoil kontrolü dağılıyor" };
  } else {
    if (value >= 32) return { label: "Pro Seviye", tone: "pro" as const, hint: "Yüksek kafa vuruş payı" };
    if (value >= 22) return { label: "İyi", tone: "good" as const, hint: "İyi kafa hedefleme" };
    if (value >= 14) return { label: "Normal", tone: "normal" as const, hint: "Gövde odaklı isabetler" };
    return { label: "Geliştirilmeli", tone: "poor" as const, hint: "Kafaya isabet oranı düşük" };
  }
}

async function readDemoFiles(directory: LocalDirectoryHandle) {
  const files: DemoFileEntry[] = [];
  const cache = getDemoMetaCache();
  for await (const [name, handle] of directory.entries()) {
    if (handle.kind !== "file" || !name.toLowerCase().endsWith(".dem")) continue;
    const file = await handle.getFile();
    const cacheKey = `${name}_${file.size}_${file.lastModified}`;
    const cachedMeta = cache[cacheKey];
    const inferredMap = inferMapFromName(name);

    files.push({
      name,
      size: file.size,
      lastModified: file.lastModified,
      handle,
      map: cachedMeta?.map || inferredMap || undefined,
      score: cachedMeta?.score || undefined,
      ctScore: cachedMeta?.ctScore,
      tScore: cachedMeta?.tScore,
      totalRounds: cachedMeta?.totalRounds,
    });
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

export type Recommendation = { id: string; title: string; body: string; confidence: number };
export type DeathDetail = {
  round: number; tick: number; time: number; zone: string; x: number; y: number; z: number;
  killer: string; weapon: string; nearestTeammate: number | null; usedRecentFlash: boolean;
  traded: boolean; side: "CT" | "T" | "Unknown"; speed?: number; openingDeath?: boolean; wasBlind?: boolean;
};
export type KillDetail = {
  round: number; tick: number; time: number; zone: string; x: number; y: number; z: number;
  victim: string; weapon: string; headshot: boolean; side: "CT" | "T" | "Unknown";
};
export type SideStat = {
  side: "CT" | "T"; rounds: number; kills: number; deaths: number; assists: number; damage: number;
  adr: number; shots: number; movingShotPercent: number; tradePercent: number; topZone: string; topZoneDeaths: number;
};
export type WeaponStat = {
  weapon: string; label: string; category?: string; kills: number; damage: number; shots: number; headshots: number;
  headshotPercent: number; movingShotPercent: number; efficiency: number; score: number;
  status: "signature" | "strong" | "developing" | "sample";
};
export type MovementCategoryStat = { shots: number; movingPercent: number };
export type MovementProfile = {
  averageSpeed: number; p90Speed: number; stableShots: number; microMoveShots: number;
  movingShots: number; fastMoveShots: number; stablePercent: number; microPercent: number;
  movingPercent: number; fastPercent: number; severityScore: number;
  severity: "clean" | "minor" | "moderate" | "severe";
  byCategory?: {
    sniper?: MovementCategoryStat;
    rifle?: MovementCategoryStat;
    pistol?: MovementCategoryStat;
    smg?: MovementCategoryStat;
    other?: MovementCategoryStat;
  };
};
export type SprayStats = {
  totalShots: number;
  totalHits: number;
  accuracyPercent: number;
  earlyAccuracy: number;
  lateAccuracy: number;
  hitboxCounts: { head: number; chest: number; stomach: number; arms: number; legs: number };
  hitboxPercents: { head: number; chest: number; stomach: number; arms: number; legs: number };
};
export type CrosshairStats = {
  headErrorAngle: number;
  bodyErrorAngle: number;
  preAimScore: number;
  headLevelRating: string;
};
export type DuelStats = {
  averageTTD: number;
  duelWinrate: number;
  duelWins: number;
  duelTotal: number;
  fastReactions: number;
  reactionRating: string;
};
export type RoundEconomy = {
  round: number;
  startMoney: number;
  spentMoney: number;
  endMoney: number;
  buyType: string;
  heroBuy: boolean;
};
export type EconomyStats = {
  averageStartMoney: number;
  totalCashSpent: number;
  roundEconomy: RoundEconomy[];
  ecoRounds: number;
  forceRounds: number;
  fullBuyRounds: number;
};
export type PathPoint = { x: number; y: number; z: number; zone: string; tick: number };
export type RoundPath = {
  round: number;
  side: "CT" | "T" | "Unknown";
  won: boolean;
  winnerSide: "CT" | "T";
  winReason: string;
  durationSeconds: number;
  startZone: string;
  endZone: string;
  primaryZone: string;
  routeSummary: string;
  points: PathPoint[];
};
export type RouteStat = {
  side: "CT" | "T" | "Unknown";
  zone: string;
  totalRounds: number;
  wins: number;
  losses: number;
  winrate: number;
  kills: number;
  deaths: number;
  avgX: number;
  avgY: number;
  isBestRoute?: boolean;
};
export type PlayerReport = {
  player: { name: string; steamid: string }; map: string; rounds: number; kills: number; deaths: number;
  assists: number; adr: number; headshotPercent: number; openingKills: number; openingDeaths: number;
  utilityDamage: number; enemyBlindSeconds: number; flashesThrown: number; shots: number;
  movingShotPercent: number; tradePercent: number; topZone: string; topZoneDeaths: number;
  unflashedDeaths: number; untradedDeaths: number; impact: number; deathDetails: DeathDetail[];
  killDetails?: KillDetail[]; sideStats?: SideStat[]; weaponStats?: WeaponStat[]; movementProfile?: MovementProfile;
  sprayStats?: SprayStats; crosshairStats?: CrosshairStats; duelStats?: DuelStats; economyStats?: EconomyStats;
  roundPaths?: RoundPath[]; routeStats?: RouteStat[];
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
export type FullMatchReport = {
  generatedAt: number;
  isAiGenerated: boolean;
  title: string;
  summary: string;
  matchScorecard: {
    overallScore: number;
    grade: string;
    impactScore: number;
    aimScore: number;
    movementScore: number;
    utilityScore: number;
    teamworkScore: number;
    positionScore: number;
    economyScore: number;
  };
  priorities: Array<{
    area: string;
    title: string;
    evidence: string;
    interpretation: string;
    action: string;
    severity: ErrorSeverity;
  }>;
  strengths: string[];
  sessionPlan: string;
  routine: Array<{ step: number; title: string; duration: string; drill: string; goal: string }>;
  sideReview: {
    ctKills: number;
    ctDeaths: number;
    ctAdr: number;
    tKills: number;
    tDeaths: number;
    tAdr: number;
    verdict: string;
  };
  weaponVerdict: {
    strongWeapon: string;
    developWeapon: string;
    tip: string;
  };
  confidence: number;
};
type ParseStatus = "idle" | "reading" | "parsing" | "ready" | "error";

const COACH_RULES: CoachRule[] = [
  { id: "aim_crosshair", area: "Pre-Aim & Kafa Hizası", title: "Köşe dönme ve kafa seviyesi", target: "Kafa sapması ≤ 4.5° · Pre-Aim ≥ 75/100", rationale: "Köşeleri dönerken crosshair kafa seviyesinde tutulduğunda flick ihtiyacı azalır ve ilk mermi isabeti artar.", caveat: "Eğimli zeminler ve çömelmiş rakipler açı sapmasını doğal olarak değiştirebilir." },
  { id: "aim_spray", area: "Sprey & Recoil", title: "Burst ve geri tepme kontrolü", target: "İlk 3 mermi ≥ %30 · 4+ mermi sprey ≥ %18", rationale: "Menzile göre uzun sprey yerine 2-3 mermilik kısa burst atışları tercih etmek recoil sapmasını önler.", caveat: "Yakın mesafe çatışmalarında ve SMG silahlarında tam sprey bazen en doğru karardır." },
  { id: "duel_ttd", area: "İlk Temas & TTD", title: "Time-to-Damage (Reaksiyon)", target: "Ortalama TTD ≤ 320 ms · 1v1 Galibiyet ≥ %50", rationale: "İlk temas anından ilk hasara kadar geçen süreyi kısaltarak rakibe cevap fırsatı bırakmaz.", caveat: "Geniş swing atan rakipler veya flash sonrası açılışlar TTD süresini uzatabilir." },
  { id: "movement", area: "Counter-Strafe & Duruş", title: "Atış anında tam durma disiplini", target: "≤15 u/s sabit · 15–50 mikro · 50–120 belirgin · >120 ağır", rationale: "Küçük hareketi koşarak atışla aynı hata saymaz; ortalama, P90 ve ağırlıklı hata skoru birlikte okunur.", caveat: "Silah, mesafe ve duruş doğruluğu değiştirir; hız bandı yayılımın birebir ölçümü değil, koçluk sezgisidir." },
  { id: "trade", area: "Takım & Trade", title: "Trade edilebilir temas", target: "Trade oranı ≥ %45", rationale: "Düello kaybedildiğinde takımın skoru eşitleme ihtimalini artırır.", caveat: "Lurk ve clutch rollerinde hedef daha düşük olabilir; görüş hattı demodan her zaman kesin kurulamaz." },
  { id: "position", area: "Harita Pozisyonu", title: "Tekrarlayan ölüm kümesi", target: "Aynı bölgede 3+ ölümde round incelemesi", rationale: "Aynı açı, zamanlama veya geri düşme planındaki tekrarları görünür yapar.", caveat: "Bölge etiketi geniş olabilir; sebep aim, utility, ekonomi veya takım planı olabilir." },
  { id: "utility", area: "Utility & Flash", title: "Temas öncesi hazırlık", target: "Round başına ≥ 3 utility hasarı veya ölçülebilir flash etkisi", rationale: "Rakibi temiz nişan düellosundan önce dezavantaja sokar.", caveat: "Demo burada yalnızca oyuncunun kendi flashını güvenle bağlar; takım flashı eksik sayılabilir." },
  { id: "opening", area: "Açılış Düellosu (Entry)", title: "İlk temas dengesi", target: "Opening farkı negatif olmamalı", rationale: "İlk ölümün takımın round kazanma ihtimaline etkisi yüksektir.", caveat: "Entry rolü daha fazla risk alır; kararın doğruluğu spawn, ekonomi ve planla birlikte değerlendirilir." },
  { id: "damage", area: "Hasar Katkısı (ADR)", title: "Sürdürülebilir round hasarı", target: "ADR 70–85 gelişim bandı", rationale: "Roundlar boyunca düzenli çatışma katkısını izler.", caveat: "Support, AWP ve anchor rollerinde tek bir ADR hedefi optimum oyun anlamına gelmez." },
];

const SEVERITY_LABEL: Record<ErrorSeverity, string> = {
  critical: "Kritik", high: "Yüksek", moderate: "Orta", minor: "Küçük", info: "Bilgi", strong: "Güçlü",
};
const SEVERITY_RANK: Record<ErrorSeverity, number> = { critical: 0, high: 1, moderate: 2, minor: 3, info: 4, strong: 5 };

function readableText(value: unknown, fallback: string) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function explainMovement(profile: MovementProfile) {
  const fastShotsPerTen = Math.max(0, Math.min(10, Math.round(profile.fastPercent / 10)));
  const microShotsPerTen = Math.max(0, Math.min(10, Math.round(profile.microPercent / 10)));
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
    ...(report.duelStats ? [{
      id: "duel_ttd", area: "İlk Temas & TTD",
      title: report.duelStats.averageTTD > 380 ? "Time-to-Damage (TTD) süresi uzun" : report.duelStats.duelWinrate < 45 ? "1v1 düello kazanma oranı düşük" : "Düello reaksiyonları keskin",
      evidence: `Ortalama TTD ${report.duelStats.averageTTD} ms (${report.duelStats.reactionRating}). 1v1 düellolarda ${report.duelStats.duelWins}/${report.duelStats.duelTotal} galibiyet (%${report.duelStats.duelWinrate}), ${report.duelStats.fastReactions} yıldırım reaksiyon.`,
      interpretation: report.duelStats.averageTTD > 350 ? "Düşmanı gördükten sonra ilk hasarı işleme süren uzuyor; rakip ilk ateşi açarak avantaj elde ediyor." : "Hedefe kilitlenme ve ilk hasarı verme reaksiyonun hızlı.",
      action: report.duelStats.averageTTD > 350 ? "Aim Botz ve reaktif tracking modlarında hedef değiştirme (target switching) egzersizleri yap." : "Hızlı reaksiyon refleksini koru.",
      severity: (report.duelStats.averageTTD > 420 ? "high" : report.duelStats.averageTTD > 350 || report.duelStats.duelWinrate < 40 ? "moderate" : report.duelStats.averageTTD > 320 ? "minor" : "strong") as ErrorSeverity,
      confidence: 82,
    }] : []),
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

type PlayerIdentity = { steamid: string; name: string };
type CurrentDemoMeta = { fileName: string; lastModified: number; size: number };

function clampScore(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function buildCompactSummary(report: PlayerReport, coachVerdict?: CompactCoachVerdict): CompactMatchSummary {
  const rounds = Math.max(1, report.rounds);
  const kd = report.kills / Math.max(1, report.deaths);
  const aim = clampScore(
    Math.min(100, report.headshotPercent / 60 * 100) * .42
    + Math.min(100, report.adr / 90 * 100) * .36
    + Math.min(100, kd / 1.25 * 100) * .22,
  );
  const movement = clampScore(100 - (report.movementProfile?.severityScore ?? Math.min(100, report.movingShotPercent * 2.2)));
  const utility = clampScore(
    Math.min(100, report.utilityDamage / rounds / 6 * 100) * .58
    + Math.min(100, report.enemyBlindSeconds / rounds / 1.5 * 100) * .42,
  );
  const teamwork = clampScore(
    Math.min(100, report.tradePercent / 55 * 100) * .68
    + Math.min(100, report.assists / rounds / .28 * 100) * .32,
  );
  const zoneShare = report.deaths ? report.topZoneDeaths / report.deaths * 100 : 0;
  const openingDeathShare = report.rounds ? report.openingDeaths / report.rounds * 100 : 0;
  const position = clampScore(100 - Math.max(0, zoneShare - 20) * .9 - openingDeathShare * 1.5);
  const roundImpact = clampScore(report.impact);
  const dimensions = { aim, movement, utility, teamwork, position, roundImpact };
  const overall = clampScore(aim * .24 + movement * .16 + utility * .14 + teamwork * .15 + position * .15 + roundImpact * .16);

  const aimMetrics = report.crosshairStats && report.duelStats && report.sprayStats ? {
    headErrorAngle: report.crosshairStats.headErrorAngle,
    bodyErrorAngle: report.crosshairStats.bodyErrorAngle,
    preAimScore: report.crosshairStats.preAimScore,
    averageTTD: report.duelStats.averageTTD,
    duelWinrate: report.duelStats.duelWinrate,
    earlyAccuracy: report.sprayStats.earlyAccuracy,
    lateAccuracy: report.sprayStats.lateAccuracy,
  } : undefined;

  return {
    overall,
    dimensions,
    stats: {
      kills: report.kills, deaths: report.deaths, assists: report.assists, adr: Math.round(report.adr * 10) / 10,
      headshotPercent: report.headshotPercent, tradePercent: report.tradePercent,
    },
    weapons: (report.weaponStats || []).slice(0, 6).map((weapon) => ({
      weapon: weapon.weapon, label: weapon.label, score: weapon.score, kills: weapon.kills, shots: weapon.shots,
    })),
    aimMetrics,
    coachVerdict: coachVerdict || (report.crosshairStats ? {
      title: report.crosshairStats.headErrorAngle > 4.5 ? "Pre-Aim ve kafa hizası geliştirilmeli" : "Kafa seviyesi ve açı yerleşimi temiz",
      priorityArea: "Pre-Aim & Kafa Hizası",
      grade: overall >= 85 ? "Tier 1 Pro" : overall >= 72 ? "İleri Düzey" : overall >= 58 ? "Gelişime Açık" : "Temel Hata",
    } : undefined),
  };
}

function buildDeterministicFullReport(report: PlayerReport, packet: CoachPacket): FullMatchReport {
  const aimEvaluation = evaluateAimMechanics(report);
  const rounds = Math.max(1, report.rounds);
  const overallScore = clampScore(
    (aimEvaluation.score * 0.28) +
    (clampScore(report.impact) * 0.22) +
    (clampScore(Math.min(100, report.tradePercent / 50 * 100)) * 0.18) +
    (clampScore(100 - (report.movementProfile?.severityScore ?? 30)) * 0.16) +
    (clampScore(Math.min(100, (report.utilityDamage / rounds / 5) * 100)) * 0.16)
  );

  const grade = overallScore >= 85 ? "Tier 1 Pro Standardı" : overallScore >= 72 ? "İleri Düzey Rekabetçi" : overallScore >= 58 ? "Ortalama / Gelişime Açık" : "Temel Mekanik Hatalar";

  const ctStats = report.sideStats?.find((s) => s.side === "CT");
  const tStats = report.sideStats?.find((s) => s.side === "T");
  const sideVerdict = ctStats && tStats
    ? (ctStats.adr > tStats.adr + 15
        ? "Savunma (CT) tarafında belirgin daha yüksek hasar ve etki üretildi; T tarafında takım açılışları ve trade mesafesi geliştirilmeli."
        : tStats.adr > ctStats.adr + 15
        ? "Hücum (T) tarafında etkili oynandı; CT tarafında anchor pozisyon tutuşları ve rota planı gözden geçirilmeli."
        : "CT ve T tarafları arasında dengeli hasar ve etki sağlandı.")
    : "CT/T taraf performansı incelendi.";

  const strongestWeapon = report.weaponStats?.length ? [...report.weaponStats].sort((a, b) => b.score - a.score)[0] : undefined;
  const developWeapon = report.weaponStats?.length ? [...report.weaponStats].filter((w) => w.shots > 15).sort((a, b) => a.score - b.score)[0] : undefined;

  const priorities = packet.priorities.slice(0, 3).map((item) => ({
    area: item.area,
    title: item.title,
    evidence: item.evidence,
    interpretation: item.interpretation,
    action: item.action,
    severity: item.severity,
  }));

  const strengths = packet.strengths.slice(0, 3).map((item) => item.title).concat(aimEvaluation.strengths.slice(0, 2));

  return {
    generatedAt: Date.now(),
    isAiGenerated: false,
    title: packet.title || "Kapsamlı Maç Analizi",
    summary: packet.summary,
    matchScorecard: {
      overallScore,
      grade,
      impactScore: clampScore(report.impact),
      aimScore: aimEvaluation.score,
      movementScore: clampScore(100 - (report.movementProfile?.severityScore ?? 30)),
      utilityScore: clampScore(Math.min(100, (report.utilityDamage / rounds / 6) * 100)),
      teamworkScore: clampScore(Math.min(100, (report.tradePercent / 55) * 100)),
      positionScore: clampScore(100 - Math.min(60, (report.topZoneDeaths / Math.max(1, report.deaths)) * 100)),
      economyScore: report.economyStats ? clampScore(100 - (report.economyStats.roundEconomy.filter((r) => r.heroBuy).length * 15)) : 75,
    },
    priorities,
    strengths: [...new Set(strengths)].slice(0, 4),
    sessionPlan: packet.priorities[0]
      ? `30-40 dk: ${packet.priorities[0].action} Ardından ilk 10 rounddaki ölüm kanıtlarını izle ve sonraki maçta aynı metriği takip et.`
      : "30-40 dk: Öncelikli pozisyon ve nişangah drill'lerini uygula.",
    routine: aimEvaluation.routine,
    sideReview: {
      ctKills: ctStats?.kills || 0,
      ctDeaths: ctStats?.deaths || 0,
      ctAdr: ctStats?.adr || 0,
      tKills: tStats?.kills || 0,
      tDeaths: tStats?.deaths || 0,
      tAdr: tStats?.adr || 0,
      verdict: sideVerdict,
    },
    weaponVerdict: {
      strongWeapon: strongestWeapon?.label ? `${strongestWeapon.label} (${strongestWeapon.kills} kill, %${strongestWeapon.headshotPercent} HS)` : "AK-47 / Tüfek",
      developWeapon: developWeapon?.label ? `${developWeapon.label} (%${developWeapon.movingShotPercent} hareketli atış)` : "İkincil Silah",
      tip: developWeapon?.movingShotPercent && developWeapon.movingShotPercent > 15 ? "Atış öncesi tam duruş (counter-strafe) çalış." : "İlk 3 mermi burst ve recoil reset çalış.",
    },
    confidence: packet.confidence,
  };
}

function formatReportAsMarkdown(reportData: FullMatchReport, playerReport: PlayerReport): string {
  const dateStr = new Date(reportData.generatedAt).toLocaleString("tr-TR");
  return `# 🏆 TRACER CS2 Kapsamlı Maç Koçluk Raporu
**Oyuncu:** ${playerReport.player.name} | **Harita:** ${playerReport.map} | **Round:** ${playerReport.rounds} | **Tarih:** ${dateStr}
**Skor:** ${playerReport.kills} K / ${playerReport.deaths} D / ${playerReport.assists} A (${playerReport.adr.toFixed(1)} ADR)

---

## 📊 Maç Karnesi: ${reportData.matchScorecard.overallScore}/100 (${reportData.matchScorecard.grade})
- **Maç Etkisi:** ${reportData.matchScorecard.impactScore}/100
- **Nişangah & İsabet:** ${reportData.matchScorecard.aimScore}/100
- **Duruş & Counter-Strafe:** ${reportData.matchScorecard.movementScore}/100
- **Takım & Trade:** ${reportData.matchScorecard.teamworkScore}/100
- **Utility & Hazırlık:** ${reportData.matchScorecard.utilityScore}/100
- **Pozisyon & Açılış:** ${reportData.matchScorecard.positionScore}/100

---

## ✦ Koç Değerlendirmesi: ${reportData.title}
${reportData.summary}

---

## 🎯 Öncelikli 3 Gelişim Alanı
${reportData.priorities.map((item, idx) => `### ${idx + 1}. ${item.area} (${item.title})
- **Kanıt:** ${item.evidence}
- **Koç Yorumu:** ${item.interpretation}
- **Aksiyon / Hedef:** ${item.action}`).join("\n\n")}

---

## 🛡️ Taraf & Silah Özeti
- **CT / T Değerlendirmesi:** ${reportData.sideReview.verdict}
- **Güçlü Silah:** ${reportData.weaponVerdict.strongWeapon}
- **Geliştirilecek Silah:** ${reportData.weaponVerdict.developWeapon} (${reportData.weaponVerdict.tip})

---

## 📋 30-40 Dakikalık Özel Antrenman Reçetesi
**Genel Plan:** ${reportData.sessionPlan}

${reportData.routine.map((r) => `1. **[${r.duration}] ${r.title}:** ${r.drill} *(Hedef: ${r.goal})*`).join("\n")}
${reportData.strengths.length ? `\n**💪 Güçlü Yanlar:** ${reportData.strengths.join(" · ")}` : ""}
`;
}

function FullMatchReportModal({
  isOpen,
  onClose,
  reportData,
  playerReport,
  coachState,
  coachResourceMessage,
  onReAnalyze,
}: {
  isOpen: boolean;
  onClose: () => void;
  reportData: FullMatchReport | null;
  playerReport: PlayerReport | null;
  coachState: CoachState;
  coachResourceMessage: string;
  onReAnalyze: () => void;
}) {
  const [copied, setCopied] = useState(false);

  if (!isOpen || !reportData || !playerReport) return null;

  const handleCopy = () => {
    const md = formatReportAsMarkdown(reportData, playerReport);
    void navigator.clipboard.writeText(md);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  const card = reportData.matchScorecard;

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <section className="settings-modal full-report-modal" role="dialog" aria-modal="true" aria-labelledby="full-report-title">
        <button className="modal-close" onClick={onClose} aria-label="Raporu kapat">×</button>
        
        <header className="report-hero-head">
          <div className="report-hero-title">
            <MapEmblem mapName={playerReport.map || "unknown"} size={52} />
            <div className="report-hero-meta">
              <p className="eyebrow" style={{ color: "var(--acid)" }}>✦ TRACER KAPSAMLI MAÇ KOÇLUK RAPORU</p>
              <h2 id="full-report-title">{playerReport.player.name} · {playerReport.map} Maç Analizi</h2>
              <p><strong>{playerReport.rounds} Round</strong> · {playerReport.kills} K / {playerReport.deaths} D / {playerReport.assists} A ({playerReport.adr.toFixed(1)} ADR) · %{playerReport.headshotPercent} HS</p>
            </div>
          </div>
          <div className="report-actions">
            <button className={`copy-report-btn ${copied ? "copied" : ""}`} onClick={handleCopy}>
              {copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
              <span>{copied ? "Rapor Kopyalandı!" : "Markdown Olarak Kopyala"}</span>
            </button>
            <button className="ghost-button" onClick={onReAnalyze} disabled={coachState === "thinking"}>
              {coachState === "thinking" ? "Analiz ediliyor…" : "↻ Yeniden Analiz Et"}
            </button>
          </div>
        </header>

        {/* 1. Maç Karnesi & 360 Skor */}
        <div className="report-scorecard-grid">
          <div className="scorecard-hero">
            <span>GENEL MAÇ PUANI</span>
            <strong>{card.overallScore}<i>/100</i></strong>
            <em className="scorecard-grade-badge">{card.grade}</em>
            <small style={{ color: "#798c82", fontSize: "11px" }}>%{reportData.confidence} Kanıt Güveni</small>
          </div>
          <div className="scorecard-dimensions">
            <div className="scorecard-dim-box">
              <span>Maç Etkisi</span>
              <b>{card.impactScore}<i>/100</i></b>
              <i><em style={{ width: `${card.impactScore}%`, background: "var(--acid)" }} /></i>
            </div>
            <div className="scorecard-dim-box">
              <span>Nişangah & İsabet</span>
              <b>{card.aimScore}<i>/100</i></b>
              <i><em style={{ width: `${card.aimScore}%`, background: "#52e389" }} /></i>
            </div>
            <div className="scorecard-dim-box">
              <span>Counter-Strafe</span>
              <b>{card.movementScore}<i>/100</i></b>
              <i><em style={{ width: `${card.movementScore}%`, background: "#68d4ff" }} /></i>
            </div>
            <div className="scorecard-dim-box">
              <span>Takım & Trade</span>
              <b>{card.teamworkScore}<i>/100</i></b>
              <i><em style={{ width: `${card.teamworkScore}%`, background: "#b99cff" }} /></i>
            </div>
            <div className="scorecard-dim-box">
              <span>Utility Katkısı</span>
              <b>{card.utilityScore}<i>/100</i></b>
              <i><em style={{ width: `${card.utilityScore}%`, background: "#ffb761" }} /></i>
            </div>
            <div className="scorecard-dim-box">
              <span>Pozisyon Tutarlılığı</span>
              <b>{card.positionScore}<i>/100</i></b>
              <i><em style={{ width: `${card.positionScore}%`, background: "#ff7e85" }} /></i>
            </div>
          </div>
        </div>

        {/* 2. Koç Başlığı & Kapsamlı Özeti */}
        <article className="report-verdict-box">
          <div className="report-verdict-head">
            <span>{reportData.isAiGenerated ? "✦ YEREL AI KOÇ SENTEZİ & KURAL MOTORU" : "✦ KANITA DAYALI KURAL MOTORU RAPORU"}</span>
            <em>{new Date(reportData.generatedAt).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" })} oluşturuldu</em>
          </div>
          <h3>{reportData.title}</h3>
          <p>{reportData.summary}</p>
        </article>

        {/* 3. Öncelikli 3 Gelişim Alanı */}
        <div style={{ display: "grid", gap: "8px" }}>
          <div className="section-title-row" style={{ margin: 0 }}>
            <div>
              <p className="eyebrow">ÖNCELİKLİ GELİŞİM ALANLARI</p>
              <h3 style={{ margin: 0, fontSize: "14px", color: "#fff" }}>Bu Maçtan Çıkarılan 3 Temel Düzeltme</h3>
            </div>
          </div>
          <div className="report-priorities-grid">
            {reportData.priorities.map((item, idx) => (
              <article key={idx} className={`report-priority-card ${item.severity}`}>
                <header>
                  <span>0{idx + 1} · {item.area}</span>
                  <em className={`severity-badge ${item.severity}`}>{SEVERITY_LABEL[item.severity] || item.severity}</em>
                </header>
                <b>{item.title}</b>
                <p><strong>Kanıt:</strong> {item.evidence}</p>
                <p><strong>Koç Değerlendirmesi:</strong> {item.interpretation}</p>
                <div className="action-box">
                  <strong>Hedef / Aksiyon:</strong> {item.action}
                </div>
              </article>
            ))}
          </div>
        </div>

        {/* 4. Taraf (CT vs T) & Silah Analizi */}
        <div className="report-two-col-grid">
          <article className="report-subpanel">
            <div className="report-subpanel-head">
              <span>CT / T TARAF FARKLILIKLARI</span>
              <b>{reportData.sideReview.ctAdr > 0 ? "Taraf Verisi Hazır" : "Genel"}</b>
            </div>
            <div className="side-mini-row">
              <div className="side-mini-box ct">
                <span>SAVUNMA (CT)</span>
                <b>{reportData.sideReview.ctKills} K / {reportData.sideReview.ctDeaths} D · {reportData.sideReview.ctAdr.toFixed(1)} ADR</b>
              </div>
              <div className="side-mini-box t">
                <span>HÜCUM (T)</span>
                <b>{reportData.sideReview.tKills} K / {reportData.sideReview.tDeaths} D · {reportData.sideReview.tAdr.toFixed(1)} ADR</b>
              </div>
            </div>
            <p style={{ margin: 0, fontSize: "11.5px", color: "#b3c3bb", lineHeight: "1.45" }}>
              {reportData.sideReview.verdict}
            </p>
          </article>

          <article className="report-subpanel">
            <div className="report-subpanel-head">
              <span>SİLAH PROFİLİ & GELİŞİM</span>
              <b>{playerReport.weaponStats?.length || 0} Silah Tanındı</b>
            </div>
            <div className="weapon-verdict-box">
              <div className="weapon-verdict-item">
                <span>En Güçlü Silah</span>
                <b style={{ color: "#52e389" }}>{reportData.weaponVerdict.strongWeapon}</b>
              </div>
              <div className="weapon-verdict-item">
                <span>Gelişim Adayı</span>
                <b style={{ color: "#ffb761" }}>{reportData.weaponVerdict.developWeapon}</b>
              </div>
            </div>
            <p style={{ margin: 0, fontSize: "11.5px", color: "#b3c3bb", lineHeight: "1.45" }}>
              <strong>Tavsiye:</strong> {reportData.weaponVerdict.tip}
            </p>
          </article>
        </div>

        {/* 5. 30-40 Dakikalık Antrenman Programı */}
        <div className="report-routine-wrap">
          <div className="section-title-row" style={{ margin: 0 }}>
            <div>
              <p className="eyebrow">ÖZELLEŞTİRİLMİŞ ANTRENMAN REÇETESİ</p>
              <h3 style={{ margin: 0, fontSize: "14px", color: "#fff" }}>Sonraki Maç Öncesi 30-40 Dakikalık Uygulama Sırası</h3>
            </div>
            <span style={{ color: "var(--acid)", fontWeight: 800, fontSize: "11.5px" }}>{reportData.routine.length} Adım</span>
          </div>
          <div className="report-routine-grid">
            {reportData.routine.map((step) => (
              <article key={step.step} className="report-routine-card">
                <header>
                  <span>{step.step}</span>
                  <em>{step.duration}</em>
                </header>
                <b>{step.title}</b>
                <p>{step.drill}</p>
                <footer>
                  <span>Hedef:</span>
                  <strong>{step.goal}</strong>
                </footer>
              </article>
            ))}
          </div>
        </div>

        {/* Güçlü Yanlar */}
        {reportData.strengths.length > 0 && (
          <div className="aim-strengths-strip" style={{ margin: 0 }}>
            <span>KORUNMASI GEREKEN GÜÇLÜ YÖNLER</span>
            <div className="aim-strengths-tags">
              {reportData.strengths.map((str, i) => (
                <em key={i} className="aim-strength-pill" style={{ borderColor: "#2d4e38", color: "#85e8a5" }}>✓ {str}</em>
              ))}
            </div>
          </div>
        )}

        <footer className="report-modal-footer">
          <small>
            {coachResourceMessage || "Model kaynakları otomatik kapatılır; CS2 sırasında RAM/VRAM tutulmaz."}
          </small>
          <div style={{ display: "flex", gap: "8px" }}>
            <button className={`copy-report-btn ${copied ? "copied" : ""}`} onClick={handleCopy}>
              {copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
              <span>{copied ? "Rapor Kopyalandı!" : "Raporu Kopyala"}</span>
            </button>
            <button className="upload-button" onClick={onClose}>Kapat</button>
          </div>
        </footer>
      </section>
    </div>
  );
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
  const [coachEngine, setCoachEngine] = useState<CoachEngine>("embedded");
  const [embeddedModelName, setEmbeddedModelName] = useState("Qwen3 1.7B Q4_K_M");
  const [embeddedBackendLabel, setEmbeddedBackendLabel] = useState("Donanım algılanıyor");
  const [ollamaUrl, setOllamaUrl] = useState("http://127.0.0.1:11434");
  const [ollamaModel, setOllamaModel] = useState("qwen3:1.7b");
  const [coachState, setCoachState] = useState<CoachState>("unknown");
  const [coachResourceMessage, setCoachResourceMessage] = useState("Model yalnızca koç tavsiyesi sırasında yüklenir ve yanıt bittiğinde tamamen kapatılır.");
  const [mapLevel, setMapLevel] = useState<"upper" | "lower">("upper");
  const [aiInsight, setAiInsight] = useState<AiInsight | null>(null);
  const [fullMatchReport, setFullMatchReport] = useState<FullMatchReport | null>(null);
  const [fullReportModalOpen, setFullReportModalOpen] = useState(false);
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
  const [showRoutePaths, setShowRoutePaths] = useState(true);
  const [selectedRouteRound, setSelectedRouteRound] = useState<number | "all">("all");
  const [activeSection, setActiveSection] = useState("dashboard");
  const [activeView, setActiveView] = useState<"analysis" | "growth" | "live">("analysis");
  const [profileOpen, setProfileOpen] = useState(false);
  const [preferredPlayer, setPreferredPlayer] = useState<PlayerIdentity | null>(null);
  const [profileReady, setProfileReady] = useState(false);
  const [progressMatches, setProgressMatches] = useState<ProgressMatch[]>([]);
  const [progressLoading, setProgressLoading] = useState(true);
  const [progressMessage, setProgressMessage] = useState("");
  const [currentDemoMeta, setCurrentDemoMeta] = useState<CurrentDemoMeta | null>(null);
  const [updateModalOpen, setUpdateModalOpen] = useState(false);
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [updateChecking, setUpdateChecking] = useState(false);
  const savedSummaryRef = useRef("");
  const preferredPlayerRef = useRef<PlayerIdentity | null>(null);
  const reportsRef = useRef<PlayerReport[]>([]);

  async function checkUpdates() {
    setUpdateChecking(true);
    try {
      const res = await fetch(`${COMPANION_URL}/update/check`);
      if (res.ok) {
        const data = await res.json();
        setUpdateInfo(data);
      }
    } catch { /* offline / local */ }
    finally { setUpdateChecking(false); }
  }

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch(`${COMPANION_URL}/health`);
        if (!cancelled) {
          setCompanionState(response.ok ? "online" : "offline");
          if (response.ok) {
            void checkUpdates();
          }
          if (response.ok) {
            const payload = await response.json();
            if (payload.coach?.model) setEmbeddedModelName(String(payload.coach.model));
            if (payload.coach?.backendLabel) setEmbeddedBackendLabel(String(payload.coach.backendLabel));
            setCoachState(payload.coach?.available ? "online" : "offline");
            if (payload.coach?.available) setCoachResourceMessage(`Hazır · ${payload.coach.backendLabel || "CPU"}; model şu anda bellekte değil.`);
          }
        }
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

  useEffect(() => {
    void (async () => {
      setProgressLoading(true);
      try {
        const response = await fetch(PROGRESS_URL, { cache: "no-store" });
        const payload = await response.json() as { profile?: PlayerIdentity | null; matches?: ProgressMatch[]; error?: string };
        if (!response.ok) throw new Error(payload.error || "Gelişim hafızası okunamadı.");
        const profile = payload.profile || null;
        preferredPlayerRef.current = profile;
        setPreferredPlayer(profile);
        setProfileReady(Boolean(profile));
        setProgressMatches(Array.isArray(payload.matches) ? payload.matches : []);
        if (profile && reportsRef.current.length) {
          const matched = reportsRef.current.find((item) => profile.steamid ? item.player.steamid === profile.steamid : item.player.name === profile.name);
          setSelectedPlayer(matched ? (matched.player.steamid || matched.player.name) : "");
          setProfileOpen(!matched);
        }
        setProgressMessage("");
      } catch (historyError) {
        setProfileReady(false);
        setProgressMessage(historyError instanceof Error ? historyError.message : "Gelişim hafızası okunamadı.");
      } finally {
        setProgressLoading(false);
      }
    })();
  }, []);

  const report = useMemo(() => reports.find((item) => (item.player.steamid || item.player.name) === selectedPlayer), [reports, selectedPlayer]);
  const coachPacket = useMemo(() => report ? buildCoachPacket(report) : null, [report]);
  const deathPatterns = useMemo(() => report ? buildDeathPatterns(report) : [], [report]);
  const movementExplanation = useMemo(() => report?.movementProfile ? explainMovement(report.movementProfile) : null, [report]);
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

  const allSideRoundPaths = (report?.roundPaths || []).filter((p) => {
    if (sideFilter !== "all" && p.side !== sideFilter) return false;
    return true;
  });

  const visibleRoundPaths = allSideRoundPaths.filter((p) => {
    if (selectedRouteRound !== "all" && p.round !== selectedRouteRound) return false;
    return true;
  });

  const visibleRouteStats = (report?.routeStats || []).filter((r) => {
    if (sideFilter !== "all" && r.side !== sideFilter) return false;
    return true;
  });

  const bestRoute = visibleRouteStats.find((r) => r.isBestRoute) || (visibleRouteStats.length ? [...visibleRouteStats].sort((a, b) => b.winrate - a.winrate || b.totalRounds - a.totalRounds)[0] : undefined);
  const eligibleRoutesForWorst = visibleRouteStats.filter((r) => r.zone !== bestRoute?.zone && (r.losses > 0 || r.winrate < 50));
  const worstRoute = eligibleRoutesForWorst.length
    ? [...eligibleRoutesForWorst].sort((a, b) => a.winrate - b.winrate || b.losses - a.losses || b.totalRounds - a.totalRounds)[0]
    : (visibleRouteStats.length > 1 ? [...visibleRouteStats].sort((a, b) => a.winrate - b.winrate || b.losses - a.losses)[0] : undefined);
  const mostPlayedRoute = visibleRouteStats.length ? [...visibleRouteStats].sort((a, b) => b.totalRounds - a.totalRounds)[0] : undefined;
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
      success: primaryDevelopmentFinding?.id === "movement" ? "Sonraki maçta hızlı hareket ederken attığın mermi payını ve hareket hata ağırlığını düşür." : "Aynı hata kümesini sonraki demoda en az %30 azalt.",
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

  useEffect(() => {
    if (!report || !preferredPlayer || !profileReady || !currentDemoMeta || status !== "ready") return;
    const samePlayer = preferredPlayer.steamid ? report.player.steamid === preferredPlayer.steamid : report.player.name === preferredPlayer.name;
    if (!samePlayer) return;
    const reportKey = report.player.steamid || report.player.name;
    const summaryKey = `${currentDemoMeta.fileName}:${currentDemoMeta.lastModified}:${currentDemoMeta.size}:${reportKey}`;
    if (savedSummaryRef.current === summaryKey) return;
    savedSummaryRef.current = summaryKey;
    const summary = buildCompactSummary(report);
    const savedMatch: ProgressMatch = {
      id: summaryKey, date: currentDemoMeta.lastModified || Date.now(), fileName: currentDemoMeta.fileName,
      map: report.map, playerSteamId: report.player.steamid, playerName: report.player.name, summary,
    };
    void (async () => {
      try {
        const response = await fetch(PROGRESS_URL, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ matchId: summaryKey, matchDate: savedMatch.date, fileName: savedMatch.fileName, map: savedMatch.map, player: report.player, summary }),
        });
        const payload = await response.json() as { error?: string };
        if (!response.ok) throw new Error(payload.error || "Maç özeti kaydedilemedi.");
        setProgressMatches((current) => [savedMatch, ...current.filter((item) => item.id !== savedMatch.id)].sort((a, b) => b.date - a.date).slice(0, 90));
        setProgressMessage("Maç özeti gelişim hafızasına kaydedildi.");
      } catch (saveError) {
        savedSummaryRef.current = "";
        setProgressMessage(saveError instanceof Error ? saveError.message : "Maç özeti kaydedilemedi.");
      }
    })();
  }, [report, preferredPlayer, profileReady, currentDemoMeta, status]);

  function playerKey(item: PlayerReport) {
    return item.player.steamid || item.player.name;
  }

  function playerMatchesIdentity(item: PlayerReport, identity: PlayerIdentity) {
    return identity.steamid ? item.player.steamid === identity.steamid : item.player.name === identity.name;
  }

  async function chooseOwnPlayer(key: string) {
    const chosen = reports.find((item) => playerKey(item) === key);
    if (!chosen) return;
    const identity = { steamid: chosen.player.steamid || "", name: chosen.player.name };
    preferredPlayerRef.current = identity;
    setSelectedPlayer(key);
    setPreferredPlayer(identity);
    setAiInsight(null);
    setFullMatchReport(null);
    setProfileOpen(false);
    setProfileReady(false);
    setProgressMessage("Kişisel oyuncu profili kaydediliyor…");
    try {
      const response = await fetch(PROGRESS_URL, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(identity) });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error || "Oyuncu profili kaydedilemedi.");
      const historyResponse = await fetch(PROGRESS_URL, { cache: "no-store" });
      const historyPayload = await historyResponse.json() as { matches?: ProgressMatch[]; error?: string };
      if (!historyResponse.ok) throw new Error(historyPayload.error || "Bu oyuncunun gelişim geçmişi okunamadı.");
      setProgressMatches(Array.isArray(historyPayload.matches) ? historyPayload.matches : []);
      setProfileReady(true);
      setProgressMessage(`${identity.name} kişisel oyuncun olarak kaydedildi.`);
    } catch (profileError) {
      setProgressMessage(profileError instanceof Error ? profileError.message : "Oyuncu profili kaydedilemedi.");
    }
  }

  function navigateTo(sectionId: string) {
    setActiveView("analysis");
    setActiveSection(sectionId);
    window.setTimeout(() => document.getElementById(sectionId)?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
  }

  function applyReports(nextReports: PlayerReport[]) {
    reportsRef.current = nextReports;
    setReports(nextReports);
    const savedIdentity = preferredPlayerRef.current;
    const matched = savedIdentity ? nextReports.find((item) => playerMatchesIdentity(item, savedIdentity)) : undefined;
    setSelectedPlayer(matched ? playerKey(matched) : "");
    if (!matched && nextReports.length) {
      setProfileOpen(true);
      setProgressMessage(savedIdentity ? `${savedIdentity.name} bu demoda bulunamadı; başka oyuncu otomatik seçilmedi.` : "Bu demoda kendini bir kez seç; sonraki maçlarda otomatik eşleştirilecek.");
    }
    setProgress(100);
    setProgressLabel(matched ? "Analiz tamamlandı · kişisel oyuncu doğrulandı" : "Analiz tamamlandı · kendi oyuncunu seç");
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
    setFullMatchReport(null);
    savedSummaryRef.current = "";
    setCurrentDemoMeta({ fileName: file.name, lastModified: file.lastModified, size: file.size });
    setMapLevel("upper");
    setSideFilter("all");
    setSelectedRouteRound("all");
    setShowRoutePaths(true);
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

  async function fetchQuickMetaForFiles(files: DemoFileEntry[]) {
    for (const entry of files) {
      if (entry.map && entry.score && entry.score !== "—" && entry.score !== "0 - 0") continue;
      try {
        const file = await entry.handle.getFile();
        const response = await fetch(`${COMPANION_URL}/quick-meta`, {
          method: "POST",
          headers: { "Content-Type": "application/octet-stream", "X-File-Name": encodeURIComponent(entry.name) },
          body: file,
        });
        if (!response.ok) continue;
        const result = await response.json() as { ok?: boolean; meta?: { map: string; score: string; ctScore?: number; tScore?: number; totalRounds?: number } };
        if (result?.ok && result?.meta) {
          const meta = result.meta;
          const cacheKey = `${entry.name}_${entry.size}_${entry.lastModified}`;
          const formattedScore = meta.score || (meta.totalRounds && meta.totalRounds > 0 ? `${meta.ctScore} - ${meta.tScore}` : undefined);
          saveDemoMetaToCache(cacheKey, {
            map: meta.map,
            score: formattedScore || "—",
            ctScore: meta.ctScore,
            tScore: meta.tScore,
            totalRounds: meta.totalRounds,
          });

          setDemoFiles((prev) => prev.map((item) => {
            if (item.name === entry.name && item.lastModified === entry.lastModified) {
              return {
                ...item,
                map: meta.map || item.map,
                score: formattedScore || item.score,
                ctScore: meta.ctScore,
                tScore: meta.tScore,
                totalRounds: meta.totalRounds,
              };
            }
            return item;
          }));
        }
      } catch {
        // ignore background meta error
      }
    }
  }

  async function scanDirectory(directory: LocalDirectoryHandle) {
    setArchiveBusy(true);
    setArchiveMessage("Demo dosyaları taranıyor…");
    try {
      const files = await readDemoFiles(directory);
      setDemoFiles(files);
      setArchiveMessage(files.length ? `${files.length} demo bulundu.` : "Bu klasörde .dem dosyası bulunamadı.");
      void fetchQuickMetaForFiles(files);
    } catch (scanError) {
      setArchiveMessage(scanError instanceof Error ? scanError.message : "Klasör okunamadı.");
    } finally {
      setArchiveBusy(false);
    }
  }

  async function pickDemoDirectory() {
    const picker = (window as unknown as { showDirectoryPicker?: (options?: { mode?: string }) => Promise<LocalDirectoryHandle> }).showDirectoryPicker;
    if (!picker) {
      setArchiveMessage("Tarayıcınız doğrudan klasör seçimini desteklemiyor, lütfen 'Tek Dosya Seç' butonunu kullanarak .dem dosyasını seçin.");
      return;
    }
    try {
      let directory: LocalDirectoryHandle;
      try {
        directory = await picker({ mode: "readwrite" });
      } catch {
        directory = await picker();
      }
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

  async function testCoachEngine() {
    setCoachState("checking");
    try {
      if (coachEngine === "embedded") {
        const response = await fetch(`${COMPANION_URL}/coach/status`);
        const payload = await response.json();
        if (!response.ok || !payload.available) throw new Error(payload.error || "Gömülü model dosyaları bulunamadı.");
        setEmbeddedModelName(String(payload.model || embeddedModelName));
        setEmbeddedBackendLabel(String(payload.backendLabel || "CPU"));
        setCoachState("online");
        setCoachResourceMessage(`Hazır · ${payload.backendLabel || "CPU"}; doğrulama sırasında model belleğe yüklenmedi.`);
        return;
      }
      const response = await fetch(`${ollamaUrl.replace(/\/$/, "")}/api/tags`);
      if (!response.ok) throw new Error("Ollama yanıt vermedi");
      setCoachState("online");
      setCoachResourceMessage("Bağlantı hazır; henüz hiçbir model belleğe yüklenmedi.");
    } catch (coachError) {
      setCoachState("offline");
      setCoachResourceMessage(coachError instanceof Error ? coachError.message : "Yerel koç motoruna ulaşılamadı.");
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
        setCoachState("online");
        setCoachResourceMessage("Model hâlâ bellekte görünüyor; `ollama stop` ile durdurabilirsin.");
      } else {
        setCoachState("released");
        setCoachResourceMessage("✓ Doğrulandı: model RAM/VRAM'den çıkarıldı.");
      }
    } catch {
      setCoachState("online");
      setCoachResourceMessage("keep_alive: 0 gönderildi; /api/ps doğrulaması CORS nedeniyle okunamadı.");
    }
  }

  async function runFullMatchAnalysis(openModal = true) {
    if (!report || !coachPacket) return;
    setCoachState("thinking");
    setError("");

    const baseReport = buildDeterministicFullReport(report, coachPacket);

    const fullCoachInput = {
      match: {
        player: report.player.name, map: report.map, rounds: report.rounds,
        kills: report.kills, deaths: report.deaths, assists: report.assists, adr: report.adr,
      },
      deterministicAssessment: {
        confidence: coachPacket.confidence,
        dimensions: coachPacket.dimensions,
        findings: coachPacket.findings,
        priorities: coachPacket.priorities,
        strengths: coachPacket.strengths,
        deathPatterns,
        movementProfile: report.movementProfile || null,
        crosshairStats: report.crosshairStats || null,
        sprayStats: report.sprayStats || null,
        duelStats: report.duelStats || null,
        economySummary: report.economyStats ? {
          heroBuys: report.economyStats.roundEconomy.filter((r) => r.heroBuy).length,
          ecoBuys: report.economyStats.roundEconomy.filter((r) => r.buyType === "Eco").length,
          fullBuys: report.economyStats.roundEconomy.filter((r) => r.buyType === "Full Buy").length,
        } : null,
        positionZones: coachPacket.positionZones.slice(0, 5),
        sideStats: report.sideStats || [],
        weaponStats: (report.weaponStats || []).slice(0, 5),
      },
      positionEvidence: report.deathDetails.slice(0, 12).map((detail) => ({
        round: detail.round, zone: detail.zone, weapon: detail.weapon,
        nearestTeammate: detail.nearestTeammate, ownRecentFlash: detail.usedRecentFlash, traded: detail.traded,
        speed: detail.speed, openingDeath: detail.openingDeath, wasBlind: detail.wasBlind,
      })),
    };

    const deterministicCoach = {
      title: baseReport.title,
      summary: baseReport.summary,
      priorities: baseReport.priorities.slice(0, 3).map(({ area, evidence, interpretation, action }) => ({ area, evidence, interpretation, action })),
      strengths: baseReport.strengths.slice(0, 2),
      sessionPlan: baseReport.sessionPlan,
      confidence: baseReport.confidence,
    };

    let finalReport = baseReport;

    try {
      const messages = [
        { role: "system", content: coachEngine === "embedded"
          ? "Görev: Aşağıdaki demo kanıtından oyuncuya doğrudan ve ayrıntılı bir CS2 maç raporu yaz. Yanıt görev tanımını değil maçtaki sonucu anlatarak başlasın; başlıkta TRACER, model, koç veya analiz kelimelerini kullanma. deterministicAssessment ve kural kitabındaki bütün dalları karşılaştır; kanıtta olmayan sebebi kesinleştirme. Aim (Kafa ve Gövde sapması, Pre-Aim, ilk 3 mermi vs 4+ mermi sprey kontrolü), düello reaksiyonu (TTD), CT ve T, hareket, tüm ölüm bölgeleri, ortak ölüm koşulları, trade, utility, opening, silahlar ve genel etki arasından en önemli üç önceliği seç. Her öncelikte sayısal/round kanıtı, oyuncu için anlamı ve uygulanabilir çalışma/drill ver. Teknik terimin günlük Türkçe anlamını aynı cümlede açıkla. Küçük hareketi koşarak atışla eşitleme; tek maçtan kesin silah uzmanlığı ilan etme. strengths yalnızca deterministicAssessment.strengths içinde gerçekten bulunan güçlü alanlardan oluşsun; yoksa boş dizi olsun. sessionPlan süre, drill ve sonraki demoda ölçülecek başarı ölçütünü içersin. Önemli: Düşünme veya ek açıklama yapma. Doğrudan geçerli JSON ile yanıt ver."
          : "Sen TRACER'ın CS2 koç editörüsün; hükmü deterministicAssessment ve kural kitabı verir. Veride olmayan pozisyonu, utility kullanımını, aim sebebini veya takım planını uydurma. Aim ve nişangah sapması (Kafa sapması, pre-aim, sprey dağılımı, TTD), CT ve T tarafını ayrı karşılaştır. Hata derecesini büyütme; küçük hareketi koşarak atışla eşitleme. Ortak ölüm özelliklerini round kanıtıyla özetle. Tek maçtan kesin silah uzmanlığı ilan etme. En fazla 3 öncelik, güçlü alanlar ve tek antrenman planı yaz. Teknik terim veya sayı kullandığında aynı cümlede günlük Türkçeyle anlamını açıkla. Sayıları yeniden sıralamak yerine oyuncu için ne anlama geldiğini söyle. Kısa, anlaşılır Türkçe kullan. Yalnızca istenen JSON alanlarını döndür." },
        { role: "user", content: `KURAL KİTABI VE MAÇ KANITI:\n${JSON.stringify(fullCoachInput)}` },
      ];

      const response = coachEngine === "embedded"
        ? await fetch(`${COMPANION_URL}/coach/chat`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ messages, deterministic: deterministicCoach }),
          })
        : await fetch(`${ollamaUrl.replace(/\/$/, "")}/api/chat`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ model: ollamaModel, stream: false, format: "json", keep_alive: 0, options: { num_ctx: 8192, temperature: 0.2 }, messages }),
          });

      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || `${coachEngine === "embedded" ? "Gömülü koç" : "Ollama"} ${response.status} döndürdü.`);
      const content = payload.content || payload.message?.content || payload.response;
      const cleanContent = typeof content === "string"
        ? content.replace(/<think>[\s\S]*?<\/think>/gi, "").replace(/^```(?:json)?\s*|\s*```$/g, "").trim()
        : content;
      const jsonContent = typeof cleanContent === "string"
        ? cleanContent.slice(cleanContent.indexOf("{"), cleanContent.lastIndexOf("}") + 1)
        : cleanContent;
      const parsed = (typeof jsonContent === "string" ? JSON.parse(jsonContent) : jsonContent) as Partial<AiInsight>;

      const priorities = Array.isArray(parsed.priorities) && parsed.priorities.length ? parsed.priorities.slice(0, 3).map((item, idx) => ({
        area: readableText(item.area, baseReport.priorities[idx]?.area || "Genel oyun"),
        title: readableText(item.interpretation, baseReport.priorities[idx]?.title || "Gelişim alanı"),
        evidence: readableText(item.evidence, baseReport.priorities[idx]?.evidence || "Kural motoru bulgusu"),
        interpretation: readableText(item.interpretation, baseReport.priorities[idx]?.interpretation || "Bu bulgu round görüntüsüyle doğrulanmalı."),
        action: readableText(item.action, baseReport.priorities[idx]?.action || "İlgili roundları incele."),
        severity: baseReport.priorities[idx]?.severity || "high",
      })) : baseReport.priorities;

      const strengths = Array.isArray(parsed.strengths) && parsed.strengths.length
        ? parsed.strengths.slice(0, 4).map((item) => readableText(item, "")).filter(Boolean)
        : baseReport.strengths;

      finalReport = {
        ...baseReport,
        isAiGenerated: true,
        title: readableText(parsed.title, baseReport.title),
        summary: readableText(parsed.summary, baseReport.summary),
        priorities,
        strengths,
        sessionPlan: readableText(parsed.sessionPlan, baseReport.sessionPlan),
        confidence: Math.max(0, Math.min(100, Number(parsed.confidence) || baseReport.confidence)),
      };

      setAiInsight({
        title: finalReport.title,
        summary: finalReport.summary,
        priorities: finalReport.priorities.map((p) => ({ area: p.area, evidence: p.evidence, interpretation: p.interpretation, action: p.action })),
        strengths: finalReport.strengths,
        sessionPlan: finalReport.sessionPlan,
        confidence: finalReport.confidence,
      });

      if (coachEngine === "embedded") {
        if (payload.generated === false) {
          setCoachState("offline");
          setError(`Gömülü AI anlatımı tamamlanamadı; kanıta dayalı kural motoru raporu gösteriliyor. ${payload.warning || "Model yanıtı kullanılamadı."}`);
          setCoachResourceMessage(`Model kapatıldı. AI anlatımı yerine doğrulanmış yerel analiz gösteriliyor. ${payload.warning || ""}`.trim());
        } else {
          setEmbeddedBackendLabel(String(payload.backendLabel || payload.backend || embeddedBackendLabel));
          setCoachState("released");
          setCoachResourceMessage(payload.released ? `✓ Doğrulandı: koç raporu ${payload.backendLabel || payload.backend || "yerel motor"} ile tamamlandı; model kapatıldı, RAM/VRAM serbest.` : "Koç yanıtı tamamlandı.");
        }
      } else {
        await verifyOllamaReleased();
      }
    } catch (aiError) {
      const message = aiError instanceof Error ? aiError.message : "Koç ayarlarını kontrol et.";
      finalReport = baseReport;
      setAiInsight({
        title: baseReport.title,
        summary: `${baseReport.summary} Gömülü modelin ek anlatımı tamamlanamadığı için yalnızca doğrulanmış kural motoru bulguları gösteriliyor.`,
        priorities: baseReport.priorities.map((p) => ({ area: p.area, evidence: p.evidence, interpretation: p.interpretation, action: p.action })),
        strengths: baseReport.strengths,
        sessionPlan: baseReport.sessionPlan,
        confidence: baseReport.confidence,
      });
      setCoachState("offline");
      setError(coachEngine === "embedded" ? `Gömülü AI metni tamamlanamadı; kanıta dayalı kural motoru raporu gösteriliyor. ${message}` : `Ollama koç analizi alınamadı. ${message}`);
      setCoachResourceMessage(coachEngine === "embedded" ? `Model kapatıldı. AI anlatımı tamamlanamadı; doğrulanmış yerel analiz gösteriliyor. ${message}` : `Ollama koç raporu alınamadı. ${message}`);
    }

    setFullMatchReport(finalReport);

    // Save/update compact coach verdict to progress memory
    if (preferredPlayer && playerMatchesIdentity(report, preferredPlayer) && currentDemoMeta) {
      const reportKey = report.player.steamid || report.player.name;
      const summaryKey = `${currentDemoMeta.fileName}:${currentDemoMeta.lastModified}:${currentDemoMeta.size}:${reportKey}`;
      const compactVerdict: CompactCoachVerdict = {
        title: finalReport.priorities[0]?.title ? `${finalReport.priorities[0].area}: ${finalReport.priorities[0].title}`.slice(0, 60) : finalReport.title.slice(0, 60),
        priorityArea: finalReport.priorities[0]?.area || "Genel Oyun",
        grade: finalReport.matchScorecard.grade,
      };
      const updatedSummary = buildCompactSummary(report, compactVerdict);
      const updatedMatch: ProgressMatch = {
        id: summaryKey,
        date: currentDemoMeta.lastModified || Date.now(),
        fileName: currentDemoMeta.fileName,
        map: report.map,
        playerSteamId: report.player.steamid,
        playerName: report.player.name,
        summary: updatedSummary,
      };
      void fetch(PROGRESS_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ matchId: summaryKey, matchDate: updatedMatch.date, fileName: updatedMatch.fileName, map: updatedMatch.map, player: report.player, summary: updatedSummary }),
      }).then(() => {
        setProgressMatches((current) => [updatedMatch, ...current.filter((item) => item.id !== updatedMatch.id)].sort((a, b) => b.date - a.date).slice(0, 90));
      }).catch(() => {});
    }

    if (openModal) {
      setFullReportModalOpen(true);
    }
  }

  const runAiCoach = () => runFullMatchAnalysis(true);

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
          <button className={`nav-item nav-item-live ${activeView === "live" ? "active" : ""}`} onClick={() => { setActiveView("live"); setActiveSection("live"); }}><span className="live-nav-dot" /> 🔴 Canlı Koç (Live)</button>
          <button className={`nav-item ${activeView === "analysis" && activeSection === "dashboard" ? "active" : ""}`} onClick={() => { setActiveView("analysis"); navigateTo("dashboard"); }}><IconDashboard size={15} /> Genel bakış</button>
          <button className={`nav-item ${activeView === "growth" ? "active" : ""}`} onClick={() => { setActiveView("growth"); setActiveSection("growth"); }}><IconGrowth size={15} /> Gelişim</button>
          <button className={`nav-item ${activeSection === "aim-precision" ? "active" : ""}`} onClick={() => navigateTo("aim-precision")}><IconCrosshair size={15} /> Nişangah & İsabet</button>
          <button className={`nav-item ${activeSection === "duel-reaction" ? "active" : ""}`} onClick={() => navigateTo("duel-reaction")}><IconDuel size={15} /> Düello & Reaksiyon</button>
          <button className={`nav-item ${activeSection === "economy-view" ? "active" : ""}`} onClick={() => navigateTo("economy-view")}><IconEconomy size={15} /> Ekonomi & Bakiye</button>
          <button className={`nav-item ${activeSection === "side-analysis" ? "active" : ""}`} onClick={() => navigateTo("side-analysis")}><IconSideAnalysis size={15} /> Taraf analizi</button>
          <button className={`nav-item ${activeSection === "weapon-profile" ? "active" : ""}`} onClick={() => navigateTo("weapon-profile")}><IconWeapon size={15} /> Silah profili</button>
          <button className={`nav-item ${activeSection === "map-analysis" ? "active" : ""}`} onClick={() => navigateTo("map-analysis")}><IconMap size={15} /> Harita olayları</button>
          <button className={`nav-item ${activeSection === "development" ? "active" : ""}`} onClick={() => navigateTo("development")}><IconPlan size={15} /> Gelişim planı</button>
          <button className="nav-item" onClick={() => { setArchiveOpen(true); void refreshCompanion(); }}><IconFolder size={15} /> Yerel maçlar</button>
        </nav>
        <div className="sidebar-spacer" />
        <button className={`ai-status ${coachState}`} onClick={() => setSettingsOpen(true)}>
          <span className="pulse" />
          <div><b>{coachState === "released" ? "KAYNAKLAR BIRAKILDI" : coachState === "online" ? (coachEngine === "embedded" ? "GÖMÜLÜ KOÇ HAZIR" : "OLLAMA BAĞLI") : coachState === "thinking" ? "KOÇ DÜŞÜNÜYOR" : "YEREL KOÇU AYARLA"}</b><small>{coachEngine === "embedded" ? `${embeddedModelName} · ${embeddedBackendLabel}` : ollamaModel} · cihazda</small></div>
        </button>
        <button className="player-card" onClick={() => setProfileOpen(true)} aria-label="Kişisel oyuncu profilini seç">
          <div className="avatar">KD</div>
          <div><b>{preferredPlayer?.name || "Kendini seç"}</b><small>{preferredPlayer ? `${progressMatches.length} kayıtlı maç · kişisel profil` : "Başka oyuncu verisi kullanılmaz"}</small></div>
          <span>•••</span>
        </button>
      </aside>

      {activeView === "live" ? (
        <LiveCoachView onBack={() => setActiveView("analysis")} />
      ) : activeView === "growth" ? (
        <GrowthView matches={progressMatches} loading={progressLoading} playerName={preferredPlayer?.name} onBack={() => navigateTo("dashboard")} />
      ) : (
        <section className="workspace" id="dashboard">
        <header className="topbar">
          <div>
            <p className="eyebrow">PERFORMANS MERKEZİ</p>
            <h1>{report ? `${report.player.name} için analiz hazır.` : "Demo analizine hazır."}</h1>
          </div>
          <div className="top-actions">
            <button
              className="topbar-live-toggle-btn"
              onClick={() => setActiveView("live")}
              title="Canlı CS2 Maç Koçluğuna Geç"
            >
              <span className="live-btn-dot" />
              <span>🔴 CANLI KOÇ (LIVE)</span>
            </button>
            <button
              className={`topbar-coach-btn ${fullMatchReport ? "has-report" : ""}`}
              onClick={() => {
                if (!report) {
                  setArchiveOpen(true);
                  void refreshCompanion();
                  return;
                }
                if (fullMatchReport) {
                  setFullReportModalOpen(true);
                } else {
                  void runFullMatchAnalysis(true);
                }
              }}
              disabled={coachState === "thinking"}
              title={report ? "Aim, TTD, Ekonomi, Taraf, Silah ve Pozisyonu tek tıkla analiz et" : "Önce bir demo seç"}
            >
              <span className="btn-spark">✦</span>
              <span>
                {coachState === "thinking"
                  ? "Maç Analiz Ediliyor…"
                  : fullMatchReport
                  ? "Full Koç Raporunu Aç"
                  : report
                  ? "Full Maç Analizi Yap & Rapor"
                  : "Full Maç Analizi (Demo Seç)"}
              </span>
            </button>
            <button className="ghost-button archive-trigger" onClick={() => { setArchiveOpen(true); void refreshCompanion(); }}><IconFolder size={14} /> Yerel maçlar</button>
            <button className="ghost-button" onClick={() => setSettingsOpen(true)}><IconSettings size={14} /> Kaynakları bağla</button>
            <button
              className={`ghost-button update-nav-btn ${updateInfo?.hasUpdate ? "has-new-update" : ""}`}
              onClick={() => setUpdateModalOpen(true)}
              title={updateInfo?.hasUpdate ? `Yeni v${updateInfo.latestVersion} güncellemesi mevcut!` : "TRACER sürüm & yama merkezi"}
            >
              <span>{updateInfo?.hasUpdate ? "🚀 Güncelleme" : `v${updateInfo?.currentVersion || "0.42"}`}</span>
            </button>
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
          {report && fullMatchReport && (
            <button
              className="growth-coach-tag"
              style={{ cursor: "pointer", border: "1px solid rgba(227, 246, 77, 0.4)" }}
              onClick={() => setFullReportModalOpen(true)}
              title="Full Maç Koçluk Raporunu Aç"
            >
              ✦ {fullMatchReport.matchScorecard.overallScore}/100 Karne ({fullMatchReport.matchScorecard.grade})
            </button>
          )}
          <button className="icon-button" aria-label="Yerel maç arşivini aç" onClick={() => { setArchiveOpen(true); void refreshCompanion(); }}>⌄</button>
        </div>

        {report && (
          <section className="player-switcher" aria-label="Analiz edilecek oyuncu">
            <div className="player-switcher-avatar">{report.player.name.slice(0, 2).toLocaleUpperCase("tr-TR")}</div>
            <div className="player-switcher-copy"><span>KİŞİSEL OYUNCU · KALICI</span><b>{report.player.name}</b><small>Bu SteamID/ad sonraki demolarla eşleştirilir; diğer oyuncular gelişim hafızasına girmez.</small></div>
            <label>
              <span>Demodaki ben</span>
              <select value={selectedPlayer} onChange={(event) => void chooseOwnPlayer(event.target.value)}>
                {reports.map((item) => <option key={playerKey(item)} value={playerKey(item)}>{item.player.name}</option>)}
              </select>
            </label>
          </section>
        )}
        {progressMessage && <div className={`profile-memory-note ${/kaydedildi|kişisel oyuncun/i.test(progressMessage) ? "saved" : ""}`}><span>●</span>{progressMessage}<button onClick={() => setActiveView("growth")}>Gelişimi aç</button></div>}

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
            <div className="card-kicker"><span className="spark">✦</span> {aiInsight ? "KURAL MOTORU + YEREL AI KOÇ" : "KANITA DAYALI KURAL MOTORU"} {report && coachConfidence !== undefined && <em>%{coachConfidence} güven · LLM hüküm vermez</em>}</div>
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
                <header><div><span>ATIŞ HIZI PROFİLİ</span><b>Ortalama {report.movementProfile.averageSpeed} u/s · P90 hız eşiği {report.movementProfile.p90Speed} u/s</b></div><em className={`severity-badge ${coachPacket.findings.find((item) => item.id === "movement")?.severity || "info"}`}>{report.movementProfile.severityScore}/100 hata ağırlığı</em></header>
                <div className="movement-bands">
                  {[
                    { label: "Sabit", range: "≤15", percent: report.movementProfile.stablePercent, className: "stable" },
                    { label: "Mikro", range: "15–50", percent: report.movementProfile.microPercent, className: "micro" },
                    { label: "Belirgin", range: "50–120", percent: report.movementProfile.movingPercent, className: "moving" },
                    { label: "Yüksek", range: ">120", percent: report.movementProfile.fastPercent, className: "fast" },
                  ].map((band) => <div key={band.label}><span><b>{band.label}</b>{band.range} u/s</span><i><em className={band.className} style={{ width: `${band.percent}%` }}/></i><strong>%{band.percent}</strong></div>)}
                </div>
                {movementExplanation && <>
                  <div className="movement-plain"><span>KISACA</span><b>{movementExplanation.summary}</b><p>{movementExplanation.fast}</p><small>{movementExplanation.score}</small></div>
                  <p className="movement-weapon-note">{movementExplanation.byWeaponNote}</p>
                  <div className="movement-dictionary">
                    <p><b>Ortalama hız</b>{movementExplanation.average}</p>
                    <p><b>P90 ne?</b>{movementExplanation.p90}</p>
                    <p><b>Mikro hareket</b>{movementExplanation.micro}</p>
                  </div>
                </>}
                {report.movementProfile.byCategory && (
                  <div className="weapon-movement-grid">
                    <div className="w-cat-box"><span>Tüfekler (AK/M4)</span><b>%{report.movementProfile.byCategory.rifle?.movingPercent ?? 0}</b><small>{report.movementProfile.byCategory.rifle?.shots ?? 0} atış (Katı Duruş)</small></div>
                    <div className="w-cat-box"><span>Sniper (AWP/SSG)</span><b>%{report.movementProfile.byCategory.sniper?.movingPercent ?? 0}</b><small>{report.movementProfile.byCategory.sniper?.shots ?? 0} atış (Sıfır Tolerans)</small></div>
                    <div className="w-cat-box"><span>Tabancalar</span><b>%{report.movementProfile.byCategory.pistol?.movingPercent ?? 0}</b><small>{report.movementProfile.byCategory.pistol?.shots ?? 0} atış (Orta Tolerans)</small></div>
                    <div className="w-cat-box"><span>Hafif Makineli (SMG)</span><b>%{report.movementProfile.byCategory.smg?.movingPercent ?? 0}</b><small>{report.movementProfile.byCategory.smg?.shots ?? 0} atış (Doğal Run&Gun)</small></div>
                  </div>
                )}
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
            {report && (
              <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginTop: "10px" }}>
                <button
                  className="ollama-coach-button"
                  onClick={() => void runFullMatchAnalysis(true)}
                  disabled={coachState === "thinking"}
                  style={{ flex: 1 }}
                >
                  <span className="btn-spark" style={{ marginRight: "6px" }}>✦</span>
                  {coachState === "thinking"
                    ? "Koç maçın genelini yorumluyor…"
                    : fullMatchReport
                    ? "↻ Full Maç Analizini Yenile"
                    : "✦ Tek Tuşla Full Maç Analizi & Rapor"}
                </button>
                {fullMatchReport && (
                  <button
                    className="ghost-button"
                    onClick={() => setFullReportModalOpen(true)}
                    style={{ color: "var(--acid)", borderColor: "rgba(227, 246, 77, 0.35)", fontWeight: 700 }}
                  >
                    <IconFileText size={14} /> Full Raporu Aç
                  </button>
                )}
              </div>
            )}
            {aiInsight && <div className="coach-session"><span>SONRAKİ ÇALIŞMA</span><b>{aiInsight.sessionPlan}</b>{aiInsight.strengths.length > 0 && <p>Güçlü taraflar: {aiInsight.strengths.join(" · ")}</p>}</div>}
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
              <div>
                <p>HARİTA & TAKTİKSEL ROTA ANALİZİ</p>
                <h3>Kill/Ölüm Konumları & Round Bazlı Hareket Rotaları</h3>
              </div>
              <div className="map-controls">
                <div className="segmented side-segment">
                  <button className={sideFilter === "all" ? "selected" : ""} onClick={() => setSideFilter("all")}>TÜMÜ</button>
                  <button className={sideFilter === "CT" ? "selected" : ""} onClick={() => setSideFilter("CT")}>CT</button>
                  <button className={sideFilter === "T" ? "selected" : ""} onClick={() => setSideFilter("T")}>T</button>
                </div>
                {report && (report.roundPaths?.length || 0) > 0 && (
                  <button
                    className={`map-route-toggle-btn ${showRoutePaths ? "active" : ""}`}
                    onClick={() => setShowRoutePaths(!showRoutePaths)}
                    title="Radar üzerinde oyuncunun hareket rotalarını çiz"
                  >
                    <span>✦</span> Rotalar: {showRoutePaths ? "AÇIK" : "KAPALI"}
                  </button>
                )}
                {report && showRoutePaths && allSideRoundPaths.length > 0 && (
                  <select
                    className="map-round-select"
                    value={selectedRouteRound}
                    onChange={(e) => setSelectedRouteRound(e.target.value === "all" ? "all" : Number(e.target.value))}
                    aria-label="Gösterilecek round rotası"
                  >
                    <option value="all">Tüm Roundlar ({allSideRoundPaths.length})</option>
                    {allSideRoundPaths.map((p) => (
                      <option key={p.round} value={p.round}>
                        R{String(p.round).padStart(2, "0")} · {p.won ? "🟢 WIN" : "🔴 LOSS"} ({p.primaryZone})
                      </option>
                    ))}
                  </select>
                )}
                {radarMap?.lowerImage && (
                  <div className="segmented">
                    <button className={mapLevel === "upper" ? "selected" : ""} onClick={() => setMapLevel("upper")}>ÜST</button>
                    <button className={mapLevel === "lower" ? "selected" : ""} onClick={() => setMapLevel("lower")}>ALT</button>
                  </div>
                )}
              </div>
            </div>

            <div className="radar" role="img" aria-label={`${report?.map || "Harita"} üzerinde kill, ölüm ve hareket rotaları`}>
              {radarImage && <img className="radar-image" src={radarImage} alt="" draggable="false" />}
              {report && !radarMap && <div className="radar-unavailable">Bu harita için radar kalibrasyonu henüz yok.</div>}

              {/* Radar Köşe HUD: En Başarılı ve En Zayıf Rota Bilgisi */}
              {report && (bestRoute || worstRoute) && (
                <div className="radar-best-route-hud">
                  {bestRoute && (
                    <div className="hud-route-chip best" title={`En Başarılı Rota: ${bestRoute.zone} (%${bestRoute.winrate} Win · ${bestRoute.wins}W - ${bestRoute.losses}L)`}>
                      <span className="hud-spark win">✦</span>
                      <span className="hud-label">En Başarılı:</span>
                      <b className="hud-zone">{bestRoute.zone}</b>
                      <span className="hud-winrate win">%{bestRoute.winrate}</span>
                      <small className="hud-record">({bestRoute.wins}W - {bestRoute.losses}L)</small>
                    </div>
                  )}
                  {worstRoute && worstRoute.zone !== bestRoute?.zone && (
                    <div className="hud-route-chip worst" title={`En Zayıf Rota: ${worstRoute.zone} (%${worstRoute.winrate} Win · ${worstRoute.wins}W - ${worstRoute.losses}L)`}>
                      <span className="hud-spark loss">✕</span>
                      <span className="hud-label">En Zayıf:</span>
                      <b className="hud-zone">{worstRoute.zone}</b>
                      <span className="hud-winrate loss">%{worstRoute.winrate}</span>
                      <small className="hud-record">({worstRoute.wins}W - {worstRoute.losses}L)</small>
                    </div>
                  )}
                </div>
              )}

              {/* 1. SVG Hareket Rota Çizgileri Katmanı */}
              {radarMap && showRoutePaths && (
                <svg className="radar-routes-overlay" viewBox="0 0 100 100" preserveAspectRatio="none">
                  <defs>
                    <filter id="route-glow-win" x="-20%" y="-20%" width="140%" height="140%">
                      <feDropShadow dx="0" dy="0" stdDeviation="0.6" floodColor="#52e389" floodOpacity="0.8" />
                    </filter>
                    <filter id="route-glow-loss" x="-20%" y="-20%" width="140%" height="140%">
                      <feDropShadow dx="0" dy="0" stdDeviation="0.6" floodColor="#ff4d4f" floodOpacity="0.7" />
                    </filter>
                  </defs>
                  {visibleRoundPaths.map((path) => {
                    if (!path.points || path.points.length < 2) return null;
                    const validPoints = path.points
                      .map((pt) => worldToRadar(pt.x, pt.y, radarMap))
                      .filter((p) => p.left >= 0 && p.left <= 100 && p.top >= 0 && p.top <= 100);
                    if (validPoints.length < 2) return null;
                    const polylinePoints = validPoints.map((p) => `${p.left.toFixed(1)},${p.top.toFixed(1)}`).join(" ");
                    const isSingle = selectedRouteRound === path.round;

                    return (
                      <g key={`rpath-${path.round}`} className={`radar-path-g ${path.won ? "win" : "loss"} ${isSingle ? "single-focused" : ""}`}>
                        <polyline
                          points={polylinePoints}
                          className={`radar-polyline ${path.won ? "line-win" : "line-loss"}`}
                          filter={path.won ? "url(#route-glow-win)" : "url(#route-glow-loss)"}
                          strokeWidth={isSingle ? "1.6" : "0.85"}
                        />
                        <circle cx={validPoints[0].left} cy={validPoints[0].top} r={isSingle ? "1.2" : "0.8"} className="route-start-circle" />
                        <circle cx={validPoints[validPoints.length - 1].left} cy={validPoints[validPoints.length - 1].top} r={isSingle ? "1.6" : "1.1"} className={path.won ? "route-end-win" : "route-end-loss"} />
                      </g>
                    );
                  })}
                </svg>
              )}

              {/* 2. Haritada En Başarılı Rota Waypoint Pin */}
              {radarMap && bestRoute && bestRoute.avgX !== 0 && bestRoute.avgY !== 0 && (
                (() => {
                  const pinPos = worldToRadar(bestRoute.avgX, bestRoute.avgY, radarMap);
                  if (pinPos.left < 4 || pinPos.left > 96 || pinPos.top < 4 || pinPos.top > 96) return null;
                  return (
                    <div
                      className="radar-route-waypoint-pin best"
                      style={{ left: `${pinPos.left}%`, top: `${pinPos.top}%` }}
                      title={`✦ En Başarılı Rota: ${bestRoute.zone} (%${bestRoute.winrate} Win · ${bestRoute.wins}W - ${bestRoute.losses}L)`}
                    >
                      <span className="waypoint-pulse best" />
                      <span className="waypoint-dot best">✦</span>
                    </div>
                  );
                })()
              )}

              {/* 3. Haritada En Zayıf Rota Waypoint Pin */}
              {radarMap && worstRoute && worstRoute.zone !== bestRoute?.zone && worstRoute.avgX !== 0 && worstRoute.avgY !== 0 && (
                (() => {
                  const pinPos = worldToRadar(worstRoute.avgX, worstRoute.avgY, radarMap);
                  if (pinPos.left < 4 || pinPos.left > 96 || pinPos.top < 4 || pinPos.top > 96) return null;
                  return (
                    <div
                      className="radar-route-waypoint-pin worst"
                      style={{ left: `${pinPos.left}%`, top: `${pinPos.top}%` }}
                      title={`✕ En Zayıf Rota: ${worstRoute.zone} (%${worstRoute.winrate} Win · ${worstRoute.wins}W - ${worstRoute.losses}L)`}
                    >
                      <span className="waypoint-pulse worst" />
                      <span className="waypoint-dot worst">✕</span>
                    </div>
                  );
                })()
              )}

              {/* 3. Ölüm ve Kill Noktaları */}
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

              {!report && <div className="radar-empty"><b>Harita olayı yok</b><span>Demo analiz edildiğinde gerçek kill, ölüm ve hareket rotaları burada görünür.</span></div>}
              {report && (
                <div className="map-event-count">
                  <span><i className="route-dot-win"/>{visibleRoundPaths.filter((p) => p.won).length} Galibiyet Rotası</span>
                  <span><i className="route-dot-loss"/>{visibleRoundPaths.filter((p) => !p.won).length} Mağlubiyet Rotası</span>
                  <span><i className="red-dot"/>{visibleDeaths.length} ölüm</span>
                  <span><i className="green-dot"/>{visibleKills.length} kill</span>
                  <b>{sideFilter === "all" ? "CT + T" : sideFilter}</b>
                </div>
              )}
            </div>

            <div className="map-legend">
              <span><i className="route-dot-win" />Kazanılan Rota</span>
              <span><i className="route-dot-loss" />Kaybedilen Rota</span>
              <span><i className="red-dot"/>Ölüm</span>
              <span><i className="green-dot"/>Kill</span>
              <span>{report ? (radarMap?.label || report.map || "Bilinmeyen harita") : "Demo bekleniyor"}</span>
              {report && <button>İşaretin üzerine gel: round, rota, taraf, silah</button>}
            </div>

            {/* TAKTİKSEL ROTA & BÖLGE KAZANMA ANALİZİ */}
            {report && visibleRouteStats.length > 0 && (
              <section className="route-tactics-panel">
                <div className="route-tactics-head">
                  <div>
                    <span>TAKTIKSEL ROTA & BÖLGE VERİMİ</span>
                    <h4>Hangi rotalardan gidildiğinde round kazanıldı?</h4>
                  </div>
                  <small>{visibleRouteStats.length} farklı rota sınıflandırıldı · {sideFilter === "all" ? "CT ve T" : sideFilter}</small>
                </div>

                <div className="route-table" role="table" aria-label="Taktiksel rota kazanma tablosu">
                  <div className="route-table-head" role="row">
                    <span>Rota / Bölge</span>
                    <span>Taraf</span>
                    <span>Round</span>
                    <span>Kazanma Oranı</span>
                    <span>Kill / Ölüm</span>
                    <span>Taktiksel Değerlendirme</span>
                  </div>
                  {visibleRouteStats.map((r) => (
                    <div
                      className={`route-table-row ${r.isBestRoute ? "best-route-row" : r.zone === worstRoute?.zone && !r.isBestRoute && r.losses > 0 ? "worst-route-row" : ""}`}
                      role="row"
                      key={`${r.side}-${r.zone}`}
                    >
                      <b>
                        <span className={`route-side-indicator ${r.side.toLowerCase()}`} />
                        {r.zone}
                        {r.isBestRoute && <em className="best-route-badge">✦ En Başarılı Rota</em>}
                        {r.zone === worstRoute?.zone && !r.isBestRoute && r.losses > 0 && <em className="worst-route-badge">✕ En Zayıf Rota</em>}
                      </b>
                      <span>
                        <em className={`side-chip ${r.side.toLowerCase()}`}>{r.side === "CT" ? "Savunma" : "Hücum"}</em>
                      </span>
                      <span><strong>{r.totalRounds}</strong> round</span>
                      <div className="route-winrate-cell">
                        <div className="route-win-bar-track">
                          <div className="route-win-bar-fill" style={{ width: `${r.winrate}%`, background: r.winrate >= 60 ? "#52e389" : r.winrate >= 40 ? "#68d4ff" : "#ff7e85" }} />
                        </div>
                        <b>%{r.winrate}</b>
                        <small>({r.wins}W / {r.losses}L)</small>
                      </div>
                      <span>{r.kills} K / {r.deaths} D</span>
                      <span className={`route-verdict-text ${r.winrate >= 60 ? "positive" : r.winrate <= 35 ? "negative" : "neutral"}`}>
                        {r.winrate >= 65
                          ? "✓ Yüksek verimli dominant rota"
                          : r.winrate >= 50
                          ? "Dengeli açılış/tutuş"
                          : r.winrate >= 35
                          ? "Ortalama altı verim"
                          : "⚠ Riskli rota / round kaybı yoğun"}
                      </span>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* HARİTA KONUM TARAMASI VE BÖLGE DAĞILIMI */}
            {coachPacket && coachPacket.positionZones.length > 0 && (
              <div className="position-scan map-position-scan">
                <div><b>Taranan Harita Bölgeleri</b><span>Ölüm ve temasın yoğunlaştığı alanlar</span></div>
                <section>{coachPacket.positionZones.map((item) => <span key={item.zone}><b>{item.zone}</b>{item.deaths} ölüm · %{item.share}</span>)}</section>
              </div>
            )}
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

        {/* 1 & 5. NİŞANGAH SAPMASI, PRE-AIM & HITBOX DAĞILIMI */}
        <section className="aim-precision-section" id="aim-precision">
          <div className="section-title-row">
            <div>
              <p className="eyebrow">NİŞANGAH & İSABET DERİNLİĞİ</p>
              <h2>Kafa Sapması, Gövde Sapması ve İnsan Hedef Hitbox Dağılımı</h2>
              <p>Temas anlarında crosshair'in kafa seviyesinden sapması ve hedef insan maketi üstünde mermilerin vücut bölgelerine dağılımı.</p>
            </div>
            <span>{report?.crosshairStats ? `${report.crosshairStats.headLevelRating}` : "Demo bekleniyor"}</span>
          </div>

          <div className="aim-precision-grid">
            {/* İNSAN HEDEF HİTBOX MAKETİ (MANNEQUIN) */}
            <article className="aim-stat-card mannequin-card">
              <header>
                <span>HEDEF İNSAN MAKETİ (HITBOX SİLUETİ)</span>
                <small>{report?.sprayStats ? `${report.sprayStats.totalHits} İsabetli Mermi` : "Demo analizi bekleniyor"}</small>
              </header>
              <HitboxMannequin
                counts={report?.sprayStats?.hitboxCounts}
                percents={report?.sprayStats?.hitboxPercents}
                totalHits={report?.sprayStats?.totalHits}
              />
            </article>

            <div className="aim-side-cards">
              <article className="aim-stat-card">
                <header>
                  <span>KAFA & GÖVDE AÇI SAPMASI</span>
                  <em className="rating-pill">{report?.crosshairStats?.headLevelRating || "Hazır"}</em>
                </header>
                {(() => {
                  const headAngle = report?.crosshairStats?.headErrorAngle ?? 0;
                  const bodyAngle = report?.crosshairStats?.bodyErrorAngle ?? 0;
                  const headTier = getAngleTier(headAngle, "head");
                  const bodyTier = getAngleTier(bodyAngle, "body");
                  const pointerLeftPercent = Math.min(96, Math.max(4, (headAngle / 10) * 100));

                  return (
                    <>
                      <div className="deviation-metrics">
                        <div className="dev-box">
                          <span>Kafa Sapması</span>
                          <b>{headAngle}°</b>
                          <em className={`tier-badge ${headTier.tone}`}>{headTier.label}</em>
                          <small>{headTier.hint}</small>
                        </div>
                        <div className="dev-box">
                          <span>Gövde Sapması</span>
                          <b>{bodyAngle}°</b>
                          <em className={`tier-badge ${bodyTier.tone}`}>{bodyTier.label}</em>
                          <small>{bodyTier.hint}</small>
                        </div>
                        <div className="dev-box highlight">
                          <span>Pre-Aim Skoru</span>
                          <b>{report?.crosshairStats?.preAimScore ?? 0}<i>/100</i></b>
                          <em className="tier-badge good">Kafa Seviyesi</em>
                          <small>Açı yerleşim kalitesi</small>
                        </div>
                      </div>

                      <div className="angle-spectrum-container">
                        <div className="spectrum-head">
                          <span>Kafa Açı Sapması Spektrumu</span>
                          <b className={headTier.tone}>{headAngle}° · {headTier.label} ({headTier.range})</b>
                        </div>
                        <div className="spectrum-track-wrap">
                          <div className="spectrum-pointer" style={{ left: `${pointerLeftPercent}%` }}>
                            <div className="spectrum-pointer-tag">{headAngle}°</div>
                            <div className="spectrum-pointer-arrow" />
                          </div>
                          <div className="spectrum-bar">
                            <div className="spectrum-seg pro" title="Pro Seviye (<3.5°)" />
                            <div className="spectrum-seg good" title="İyi (3.5°-5.0°)" />
                            <div className="spectrum-seg normal" title="Normal (5.1°-7.0°)" />
                            <div className="spectrum-seg poor" title="Geliştirilmeli (>7.0°)" />
                          </div>
                          <div className="spectrum-scale">
                            <span>0° (Kusursuz)</span>
                            <span>3.5° (Pro)</span>
                            <span>5.0° (İyi)</span>
                            <span>7.0° (Normal)</span>
                            <span>10°+</span>
                          </div>
                        </div>

                        <div className="angle-guide-grid">
                          <div className="guide-item"><span className="pro">PRO</span><small>&lt; 3.5°</small></div>
                          <div className="guide-item"><span className="good">İYİ</span><small>3.5°-5.0°</small></div>
                          <div className="guide-item"><span className="normal">NORMAL</span><small>5.1°-7.0°</small></div>
                          <div className="guide-item"><span className="poor">ZAYIF</span><small>&gt; 7.0°</small></div>
                        </div>
                      </div>

                      <div className="dev-bar-wrap">
                        <div className="dev-bar-label"><span>Kafa Hizası Tutarlılığı</span><b>%{report?.crosshairStats?.preAimScore ?? 0}</b></div>
                        <div className="dev-bar-track"><i style={{ width: `${report?.crosshairStats?.preAimScore ?? 0}%` }} /></div>
                      </div>
                    </>
                  );
                })()}
              </article>

              <article className="aim-stat-card">
                <header>
                  <span>SPREY VE BURST VERİMİ</span>
                  <small>{report?.sprayStats ? `${report.sprayStats.totalShots} Toplam Mermi` : "Demo bekleniyor"}</small>
                </header>
                {(() => {
                  const acc = report?.sprayStats?.accuracyPercent || 0;
                  const early = report?.sprayStats?.earlyAccuracy || 0;
                  const late = report?.sprayStats?.lateAccuracy || 0;
                  const headShare = report?.sprayStats?.hitboxPercents.head || 0;

                  const accTier = getSprayTier(acc, "overall");
                  const earlyTier = getSprayTier(early, "early");
                  const lateTier = getSprayTier(late, "late");
                  const headShareTier = getSprayTier(headShare, "head");

                  return (
                    <>
                      <div className="spray-efficiency-box">
                        <div>
                          <span>Genel İsabet</span>
                          <b>%{acc}</b>
                          <em className={`tier-badge ${accTier.tone}`}>{accTier.label}</em>
                          <small>{report?.sprayStats?.totalHits || 0} isabetli vuruş</small>
                        </div>
                        <div>
                          <span>İlk 3 Mermi İsabeti</span>
                          <b>%{early}</b>
                          <em className={`tier-badge ${earlyTier.tone}`}>{earlyTier.label}</em>
                          <small>{earlyTier.hint}</small>
                        </div>
                        <div>
                          <span>4+ Mermi Sprey İsabeti</span>
                          <b>%{late}</b>
                          <em className={`tier-badge ${lateTier.tone}`}>{lateTier.label}</em>
                          <small>{lateTier.hint}</small>
                        </div>
                        <div>
                          <span>Kafa Vuruş Payı</span>
                          <b>%{headShare}</b>
                          <em className={`tier-badge ${headShareTier.tone}`}>{headShareTier.label}</em>
                          <small>{headShareTier.hint}</small>
                        </div>
                      </div>

                      <div className="angle-guide-grid" style={{ marginTop: "8px", marginBottom: "8px" }}>
                        <div className="guide-item"><span className="pro">PRO</span><small>%50+ Burst / %35+ Sprey</small></div>
                        <div className="guide-item"><span className="good">İYİ</span><small>%40+ Burst / %25+ Sprey</small></div>
                        <div className="guide-item"><span className="normal">NORMAL</span><small>%28+ Burst / %16+ Sprey</small></div>
                        <div className="guide-item"><span className="poor">ZAYIF</span><small>&lt; %28 Burst</small></div>
                      </div>

                      <div className="hitbox-bars">
                        <div className="hb-row"><span>Kafa (Head)</span><i><em style={{ width: `${report?.sprayStats?.hitboxPercents.head || 0}%` }} /></i><b>%{report?.sprayStats?.hitboxPercents.head || 0} ({report?.sprayStats?.hitboxCounts.head || 0})</b></div>
                        <div className="hb-row"><span>Gövde (Body)</span><i><em style={{ width: `${(report?.sprayStats?.hitboxPercents.chest || 0) + (report?.sprayStats?.hitboxPercents.stomach || 0)}%` }} /></i><b>%{((report?.sprayStats?.hitboxPercents.chest || 0) + (report?.sprayStats?.hitboxPercents.stomach || 0))} ({(report?.sprayStats?.hitboxCounts.chest || 0) + (report?.sprayStats?.hitboxCounts.stomach || 0)})</b></div>
                        <div className="hb-row"><span>Bacaklar</span><i><em style={{ width: `${report?.sprayStats?.hitboxPercents.legs || 0}%` }} /></i><b>%{report?.sprayStats?.hitboxPercents.legs || 0} ({report?.sprayStats?.hitboxCounts.legs || 0})</b></div>
                      </div>
                    </>
                  );
                })()}
              </article>
            </div>
          </div>

          {report && (
            <AimCoachCard
              report={report}
              coachEngine={coachEngine}
              coachState={coachState}
              hasFullReport={Boolean(fullMatchReport)}
              onOpenFullReport={() => setFullReportModalOpen(true)}
              onRunAiCoach={() => void runFullMatchAnalysis(true)}
            />
          )}
        </section>

        {/* 4. DÜELLO & REAKSİYON (TIME TO DAMAGE) */}
        <section className="duel-reaction-section" id="duel-reaction">
          <div className="section-title-row">
            <div>
              <p className="eyebrow">REAKSİYON & DÜELLO</p>
              <h2>Time-to-Damage (TTD) ve 1v1 Temas Başarısı</h2>
              <p>Düşmanı ilk gördüğün an ile hasara dönüştürme hızın ve düelloları kazanma oranın.</p>
            </div>
            <span>{report?.duelStats ? `${report.duelStats.reactionRating}` : "Demo bekleniyor"}</span>
          </div>

          {report ? (
            <div className="duel-metrics-grid">
              <article className="duel-hero-card">
                <span>ORTALAMA HASAR VERME SÜRESİ</span>
                <h3>{report.duelStats?.averageTTD || 0} <i>ms</i></h3>
                <p>İlk temas anından ilk merminin isabetine kadar geçen reaksiyon süresi.</p>
                <div className="reaction-pill">{report.duelStats?.reactionRating || "Normal"}</div>
              </article>

              <article className="duel-hero-card">
                <span>1v1 DÜELLO KAZANMA ORANI</span>
                <h3>%{report.duelStats?.duelWinrate || 0}</h3>
                <p>{report.duelStats?.duelWins || 0} galibiyet · {report.duelStats?.duelTotal || 0} toplam temas</p>
                <div className="score-line"><i style={{ width: `${report.duelStats?.duelWinrate || 0}%` }} /></div>
              </article>

              <article className="duel-hero-card">
                <span>YILDIRIM REAKSİYONLAR (&lt;250ms)</span>
                <h3>{report.duelStats?.fastReactions || 0} <i>kez</i></h3>
                <p>250 milisaniyenin altında düşmanı avladığın refleks anları.</p>
              </article>
            </div>
          ) : (
            <div className="section-empty"><b>Düello ve reaksiyon verisi için demo gerekli.</b></div>
          )}
        </section>

        {/* 2. EKONOMİ & HARCAMA DİSİPLİNİ */}
        <section className="economy-section" id="economy-view">
          <div className="section-title-row">
            <div>
              <p className="eyebrow">EKONOMİ VE HARCAMA DİSİPLİNİ</p>
              <h2>Rauntluk Bakiye ve Satın Alma Stratejisi</h2>
              <p>Eco, Force ve Full Buy rauntlarındaki harcama disiplini ve takım uyumu.</p>
            </div>
            <span>{report?.economyStats ? `$${report.economyStats.totalCashSpent.toLocaleString()} Harcandı` : "Demo bekleniyor"}</span>
          </div>

          {report?.economyStats ? (
            <>
              <div className="economy-summary-cards">
                <article className="eco-card"><span>ORTALAMA BAŞLANGIÇ PARASI</span><b>${report.economyStats.averageStartMoney}</b></article>
                <article className="eco-card"><span>TOPLAM HARCANAN</span><b>${report.economyStats.totalCashSpent.toLocaleString()}</b></article>
                <article className="eco-card"><span>ECO RAUNT SAYISI</span><b>{report.economyStats.ecoRounds} Raunt</b></article>
                <article className="eco-card"><span>FORCE BUY SAYISI</span><b>{report.economyStats.forceRounds} Raunt</b></article>
                <article className="eco-card"><span>FULL BUY SAYISI</span><b>{report.economyStats.fullBuyRounds} Raunt</b></article>
              </div>

              <div className="economy-rounds-table" role="table" aria-label="Rauntluk Ekonomi">
                <div className="eco-table-head" role="row">
                  <span>Round</span>
                  <span>Başlangıç $</span>
                  <span>Harcanan $</span>
                  <span>Kalan $</span>
                  <span>Satın Alma Tipi</span>
                  <span>Durum</span>
                </div>
                {report.economyStats.roundEconomy.map((eco) => (
                  <div className="eco-table-row" role="row" key={`eco-r-${eco.round}`}>
                    <b>R{String(eco.round).padStart(2, "0")}</b>
                    <span>${eco.startMoney}</span>
                    <span>${eco.spentMoney}</span>
                    <span>${eco.endMoney}</span>
                    <em className={`buy-pill ${eco.buyType.toLowerCase().replace(/\s+/g, "-")}`}>{eco.buyType}</em>
                    <span>{eco.heroBuy ? <b className="hero-buy-warning"><IconWarning size={12} /> Hero Buy</b> : "Uyumlu"}</span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="section-empty"><b>Ekonomi değerlendirmesi için demo gerekli.</b></div>
          )}
        </section>

        <section className="development-plan" id="development">
          <div className="development-intro"><div><p className="eyebrow">GELİŞİM PLANI</p><h2>İstatistiği bir sonraki çalışma seansına çevir</h2><p>Bu bölüm yalnızca “kötü oynadın” demez. Öncelikli hatayı, kullanılacak drill’i, taraf incelemesini ve başarı ölçütünü tek sıraya koyar.</p></div><span>{report ? `Toplam ${developmentSteps.reduce((sum, item) => sum + Number.parseInt(item.duration), 0)} dk` : "Plan bekliyor"}</span></div>
          {developmentSteps.length ? <div className="plan-grid">{developmentSteps.map((step) => <article key={step.number}><header><span>{step.number}</span><em>{step.duration}</em></header><h3>{step.title}</h3><p><b>Neden?</b>{step.reason}</p><p><b>Ne yapacaksın?</b>{step.work}</p><footer><span>Başarı ölçütü</span><b>{step.success}</b></footer></article>)}</div> : <div className="plan-empty"><b>Kişisel plan için bir demo analiz et.</b><span>TRACER taraf, pozisyon, silah ve koç bulgularını tek çalışma sırasına dönüştürecek.</span><button onClick={() => { setArchiveOpen(true); void refreshCompanion(); }}>Yerel maç seç</button></div>}
          {report && <div className="plan-protocol"><span>Profesyonel gelişim döngüsü</span><b>Analiz et → tek davranış hedefi seç → 30–40 dk çalış → sonraki demoda aynı metriği yeniden ölç</b><p>Bir maç rastlantı olabilir. “Uzmanlık” veya kalıcı zayıflık etiketi için aynı haritada en az 5 demo karşılaştır.</p></div>}
        </section>
      </section>
      )}

      {profileOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setProfileOpen(false); }}>
          <section className="settings-modal profile-modal" role="dialog" aria-modal="true" aria-labelledby="profile-title">
            <button className="modal-close" onClick={() => setProfileOpen(false)} aria-label="Oyuncu seçimini kapat">×</button>
            <p className="eyebrow">KİŞİSEL OYUNCU KİLİDİ</p>
            <h2 id="profile-title">Demoda hangisi sensin?</h2>
            <p>Bir kez seçtiğinde SteamID varsa onunla, yoksa tam oyuncu adıyla sonraki maçlarda otomatik eşleştirilirsin. Başka oyuncuların analizi gelişim geçmişine asla yazılmaz.</p>
            {reports.length ? <div className="profile-player-list">{reports.map((item) => {
              const key = playerKey(item);
              const selected = preferredPlayer ? playerMatchesIdentity(item, preferredPlayer) : false;
              return <button className={selected ? "selected" : ""} onClick={() => void chooseOwnPlayer(key)} key={key}><span>{item.player.name.slice(0, 2).toLocaleUpperCase("tr-TR")}</span><div><b>{item.player.name}</b><small>{item.player.steamid || "SteamID yok · adla eşleştirilir"}</small></div><em>{selected ? "Kişisel profil" : "Bu benim"}</em></button>;
            })}</div> : <div className="profile-empty"><b>Önce bir demo analiz et</b><span>Demodaki oyuncu listesi çıkarıldığında burada kendini seçebilirsin.</span><button onClick={() => { setProfileOpen(false); setArchiveOpen(true); void refreshCompanion(); }}>Yerel maç seç</button></div>}
            {progressMessage && <div className="profile-message">{progressMessage}</div>}
          </section>
        </div>
      )}

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
              <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
                <button className="upload-button" onClick={pickDemoDirectory}>{demoDirectory ? "Klasörü değiştir" : "📁 Klasör Seç"}</button>
                <label className="upload-button" style={{ cursor: "pointer", display: "inline-flex", alignItems: "center" }}>
                  <input type="file" accept=".dem,.bz2" style={{ display: "none" }} onChange={(e) => { setArchiveOpen(false); void handleDemo(e); }} />
                  <span>＋</span> Tek Dosya Seç (.dem)
                </label>
                {demoDirectory && <button className="ghost-button archive-refresh" onClick={() => scanDirectory(demoDirectory)} disabled={archiveBusy}>↻ Yenile</button>}
              </div>
            </div>
            {companionState === "offline" && (
              <div className="companion-warning"><b>Güncel Valve demoları için yerel parser kapalı.</b><span><code>TRACER-Yerel.cmd</code> dosyasını çalıştır, bu pencereyi açık tut ve tekrar dene.</span><button onClick={() => void refreshCompanion()}>Bağlantıyı yenile</button></div>
            )}
            {archiveMessage && <div className="archive-message">{archiveMessage}</div>}
            <div className="demo-library" aria-busy={archiveBusy}>
              {!archiveBusy && !demoFiles.length && <div className="archive-empty"><span>▤</span><b>Demo listesi boş</b><p>CS2 içinden indirdiğin maçların bulunduğu klasörü seç.</p></div>}
              {demoFiles.map((entry) => {
                const mapKey = entry.map || inferMapFromName(entry.name);
                const displayTitle = formatMapTitle(mapKey || entry.name);
                return (
                  <article className="demo-row" key={entry.name}>
                    <MapEmblem mapName={mapKey || "unknown"} size={46} />
                    <div className="demo-file-copy">
                      <div className="demo-match-head">
                        <b>{displayTitle}</b>
                        {entry.score && entry.score !== "—" && (
                          <span className="demo-match-score">{entry.score}</span>
                        )}
                      </div>
                      <span className="demo-match-sub">
                        {new Date(entry.lastModified).toLocaleString("tr-TR")} · {formatBytes(entry.size)}
                        <span className="demo-filename-hint">{entry.name}</span>
                      </span>
                    </div>
                    <div className="demo-actions">
                      <button className="analyze-demo" onClick={() => void analyzeArchiveEntry(entry)}>Analiz et</button>
                      <button className="delete-demo" onClick={() => void deleteArchiveEntry(entry)} aria-label={`${entry.name} dosyasını sil`}>Sil</button>
                    </div>
                  </article>
                );
              })}
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
            <h2 id="settings-title">Yerel koç motoru</h2>
          <p>Demo dosyası hiçbir yere gönderilmez. Koça kural motorunun çıkardığı kapsamlı rapor gider: tüm analiz dalları, CT/T, silahlar, ölüm örüntüleri ve pozisyon kanıtları korunur. Varsayılan motor internet olmadan bu cihazda çalışır.</p>
            <div className="engine-selector" role="radiogroup" aria-label="Yerel koç motoru">
              <button className={coachEngine === "embedded" ? "selected" : ""} role="radio" aria-checked={coachEngine === "embedded"} onClick={() => { setCoachEngine("embedded"); setCoachState("unknown"); }}><b>Gömülü model</b><span>Ollama gerekmez · RAR içinde</span></button>
              <button className={coachEngine === "ollama" ? "selected" : ""} role="radio" aria-checked={coachEngine === "ollama"} onClick={() => { setCoachEngine("ollama"); setCoachState("unknown"); }}><b>Ollama</b><span>İsteğe bağlı alternatif</span></button>
            </div>
            {coachEngine === "embedded" ? (
              <div className="embedded-model-card"><span>PAKETTEKİ MODEL</span><b>{embeddedModelName}</b><small>{embeddedBackendLabel}</small><p>NVIDIA CUDA uygunsa model otomatik olarak GPU/VRAM üzerinde çalışır; CUDA başlatılamazsa CPU yedeğine geçer. Yanıt tamamlanınca ayrı model işlemi kapatılır; oyun sırasında RAM/VRAM’de model tutulmaz.</p></div>
            ) : <>
              <label>Sunucu adresi<input value={ollamaUrl} onChange={(event) => setOllamaUrl(event.target.value)} /></label>
              <label>Model<input list="ollama-models" value={ollamaModel} onChange={(event) => setOllamaModel(event.target.value)} /></label>
              <datalist id="ollama-models"><option value="qwen3:1.7b">Önerilen · dengeli</option><option value="qwen3.5:0.8b">En hafif</option><option value="qwen3:4b">Daha kaliteli</option></datalist>
            </>}
            <div className="settings-actions"><button className="ghost-button" onClick={testCoachEngine}>{coachState === "checking" ? "Kontrol ediliyor…" : "Motoru test et"}</button><button className="upload-button" onClick={() => setSettingsOpen(false)}>Kaydet</button></div>
            <div className={`connection-result ${coachState}`}>{coachState === "released" ? coachResourceMessage : coachState === "online" ? `✓ Yerel koç hazır · ${coachResourceMessage}` : coachState === "offline" ? coachResourceMessage : coachEngine === "embedded" ? "Beklemede: model bellekte değil ve CS2 performansını etkilemiyor." : "Varsayılan: http://127.0.0.1:11434 · 4096 context · anında unload"}</div>
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

      <FullMatchReportModal
        isOpen={fullReportModalOpen}
        onClose={() => setFullReportModalOpen(false)}
        reportData={fullMatchReport}
        playerReport={report || null}
        coachState={coachState}
        coachResourceMessage={coachResourceMessage}
        onReAnalyze={() => void runFullMatchAnalysis(true)}
      />

      <UpdateModal
        isOpen={updateModalOpen}
        onClose={() => setUpdateModalOpen(false)}
        updateInfo={updateInfo}
        onRefreshCheck={checkUpdates}
        checking={updateChecking}
      />
    </main>
  );
}
