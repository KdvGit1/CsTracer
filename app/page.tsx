"use client";

import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import { radarMapFor, worldToRadar } from "./map-data";
import "./analysis.css";
import { CompactCoachVerdict, GrowthView, ProgressMatch } from "./growth";
import { HitboxMannequin } from "./components/HitboxMannequin";
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
  IconSettings,
  IconWarning,
  IconSparkles,
  IconCheck,
  IconFileText,
  IconClock,
  IconPower,
  IconTerminal,
  IconRocket,
  IconClose,
  IconExternalLink,
  IconRefresh,
} from "./components/NavIcons";
import { AimCoachCard } from "./components/AimCoachCard";
import LiveCoachView from "./components/LiveCoachView";
import TeamCoachView from "./components/TeamCoachView";
import { RecentMatchesView } from "./components/RecentMatchesView";
import { NotificationCenter } from "./components/NotificationCenter";
import UpdateModal, { UpdateInfo } from "./components/UpdateModal";
import LogsModal from "./components/LogsModal";
import FullMatchReportModal from "./components/FullMatchReportModal";
import { APP_VERSION, COMPANION_URL, PROGRESS_URL } from "./lib/config";
import { getAngleTier, getKastTier, getSprayTier, readableText } from "./lib/format";
import { COACH_RULES, SEVERITY_LABEL, buildCoachPacket, buildDeathPatterns, explainMovement } from "./lib/coaching";
import { buildCompactSummary, buildDeterministicFullReport } from "./lib/report";
import type {
  AiInsight,
  CoachEngine,
  CoachFinding,
  CoachState,
  DuelStats,
  FullMatchReport,
  ParseStatus,
  PlayerIdentity,
  PlayerReport,
  SideStat,
  WeaponStat,
} from "./lib/types";

// Geriye dönük uyumluluk: tipler artık lib/types.ts içinde yaşıyor.
export type {
  CoachEngine,
  CoachState,
  Recommendation,
  DeathDetail,
  KillDetail,
  SideStat,
  WeaponStat,
  MovementCategoryStat,
  MovementProfile,
  SprayStats,
  CrosshairStats,
  DuelStats,
  RoundEconomy,
  EconomyStats,
  PathPoint,
  RoundPath,
  RouteStat,
  PlayerReport,
  FullMatchReport,
} from "./lib/types";

type CurrentDemoMeta = { fileName: string; lastModified: number; size: number };

const sampleMetrics = [
  { label: "K / D", value: "—", delta: "demo gerekli", tone: "warn" },
  { label: "ADR", value: "—", delta: "demo gerekli", tone: "warn" },
  { label: "Headshot", value: "—", delta: "demo gerekli", tone: "warn" },
  { label: "Trade", value: "—", delta: "demo gerekli", tone: "warn" },
];

const sampleEvidence: { round: string; time: string; text: string; type: string }[] = [];

function hasMeasuredTtd(stats?: DuelStats): boolean {
  return stats?.ttdMethod === "spotted-to-first-damage-v2" && stats.ttdStatus === "measured" && stats.medianTTD !== null;
}

function hasMeasuredDuels(stats?: DuelStats): boolean {
  return stats?.duelMethod === "mutual-spotted-death-v2" && stats.duelStatus === "measured" && stats.duelWinrate !== null;
}

function analysisVersionAtLeast(version: string | undefined, major: number, minor: number): boolean {
  const match = String(version || "").match(/^(\d+)\.(\d+)/);
  return Boolean(match && (Number(match[1]) > major || (Number(match[1]) === major && Number(match[2]) >= minor)));
}

function sideTopZoneLabel(side?: SideStat): string {
  if (!side) return "—";
  if (side.rounds === 0) return "Bu taraf oynanmadı";
  if (side.deaths === 0) return "Bu tarafta ölüm yok";
  const zone = String(side.topZone || "").trim();
  if (zone && !/^(veri yok|bilinmeyen bölge)$/i.test(zone) && side.topZoneDeaths > 0) return `${zone} · ${side.topZoneDeaths} ölüm`;
  return `${side.deaths} ölüm · bölge adı çıkarılamadı`;
}

function weaponMatchVerdict(weapon: WeaponStat, allWeapons: WeaponStat[]) {
  if (weapon.shots <= 0 || weapon.efficiency === null) return { label: "Atış verisi yok", tone: "sample" };
  if (weapon.shots <= 2) return { label: `${weapon.shots} atış · sınırlı`, tone: "sample" };
  const comparable = allWeapons
    .filter((item) => item.shots > 2 && item.efficiency !== null)
    .sort((a, b) => Number(b.efficiency) - Number(a.efficiency) || b.damage - a.damage);
  if (comparable.length < 2) return { label: "Bu maçın ana örneği", tone: "normal" };
  const index = comparable.findIndex((item) => item.weapon === weapon.weapon);
  if (index === 0) return { label: "Maçta güçlü", tone: "strong" };
  if (index === comparable.length - 1) return { label: "Geliştirilebilir", tone: "developing" };
  return { label: "Dengeli", tone: "normal" };
}


export default function Home() {
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
  const [sideFilter, setSideFilter] = useState<"all" | "CT" | "T">("all");
  const [showRoutePaths, setShowRoutePaths] = useState(true);
  const [selectedRouteRound, setSelectedRouteRound] = useState<number | "all">("all");
  const [activeSection, setActiveSection] = useState("dashboard");
  const [activeView, setActiveView] = useState<"recent" | "analysis" | "growth" | "live" | "team">("analysis");
  const [profileOpen, setProfileOpen] = useState(false);
  const [preferredPlayer, setPreferredPlayer] = useState<PlayerIdentity | null>(null);
  const [profileReady, setProfileReady] = useState(false);
  const [progressMatches, setProgressMatches] = useState<ProgressMatch[]>([]);
  const [progressLoading, setProgressLoading] = useState(true);
  const [progressMessage, setProgressMessage] = useState("");
  const [currentDemoMeta, setCurrentDemoMeta] = useState<CurrentDemoMeta | null>(null);
  const [updateModalOpen, setUpdateModalOpen] = useState(false);
  const [logsModalOpen, setLogsModalOpen] = useState(false);
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
        const data = (await res.json()) as UpdateInfo;
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
          if (response.ok) {
            const payload = (await response.json()) as {
              performance?: { active?: boolean };
              coach?: { model?: string; backendLabel?: string; available?: boolean };
            };
            if (!payload.performance?.active) void checkUpdates();
            if (payload.coach?.model) setEmbeddedModelName(String(payload.coach.model));
            if (payload.coach?.backendLabel) setEmbeddedBackendLabel(String(payload.coach.backendLabel));
            setCoachState(payload.coach?.available ? "online" : "offline");
            if (payload.coach?.available) {
              setCoachResourceMessage(payload.performance?.active
                ? "Oyun Performans Modu etkin; AI ve güncelleme kontrolü maç sonrasına ertelendi."
                : `Hazır · ${payload.coach.backendLabel || "CPU"}; model şu anda bellekte değil.`);
            }
          }
        }
      } catch {
        // Companion kapalıysa ekran mevcut verilerle açılmaya devam eder.
      }
    })();

    const heartbeatTimer = setInterval(() => {
      fetch(`${COMPANION_URL}/heartbeat`, { method: "GET" }).catch(() => {});
    }, 5000);

    return () => {
      cancelled = true;
      clearInterval(heartbeatTimer);
    };
  }, []);

  async function shutdownTracer() {
    if (!window.confirm("TRACER ve tüm arka plan servisleri tamamen kapatılsın mı?")) return;
    try {
      if (navigator.sendBeacon) {
        navigator.sendBeacon(`${COMPANION_URL}/shutdown`);
      } else {
        await fetch(`${COMPANION_URL}/shutdown`, { method: "POST" });
      }
    } catch {
      // Companion kapanırken bağlantının kesilmesi beklenen davranıştır.
    }
    try {
      window.close();
    } catch {
      // Taşınabilir kabuk pencere kapatmayı desteklemiyorsa kapanış ekranı gösterilir.
    }
    document.body.innerHTML = `
      <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;background:#0d0e12;color:#fff;font-family:system-ui;text-align:center;padding:20px;">
        <div style="margin-bottom:16px;">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#e3f64d" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M18.36 6.64a9 9 0 1 1-12.73 0"></path>
            <line x1="12" y1="2" x2="12" y2="12"></line>
          </svg>
        </div>
        <h1 style="font-size:24px;font-weight:700;margin-bottom:8px;color:#e3f64d;">TRACER Tamamen Kapatıldı</h1>
        <p style="color:#8f96a3;font-size:14px;max-width:420px;line-height:1.5;">Tüm yerel arka plan servisleri sonlandırıldı ve CS2 için sistem kaynakları serbest bırakıldı. Bu pencereyi kapatabilirsiniz.</p>
      </div>
    `;
  }

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
  const analysisNeedsRefresh = Boolean(report && !analysisVersionAtLeast(report.analysisVersion, 3, 1));
  const crosshairSchemaCurrent = Boolean(
    report?.crosshairStats
    && report.crosshairStats.method === "kill-tick-alignment-v2"
    && Number.isFinite(report.crosshairStats.sampleCount)
    && !analysisNeedsRefresh
  );
  const measuredCrosshairSamples = crosshairSchemaCurrent && report?.crosshairStats?.status === "measured"
    ? Math.max(0, report.crosshairStats.sampleCount)
    : 0;
  const kastTier = getKastTier(report?.kastPercent);
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
    { label: "K / D", value: `${report.kills} / ${report.deaths}`, delta: `${report.assists} asist`, tone: "" },
    { label: "ADR", value: report.adr.toFixed(1), delta: "rakip hasarı", tone: "" },
    { label: "HS", value: `%${report.headshotPercent}`, delta: `${report.openingKills}-${report.openingDeaths} opening`, tone: "" },
    { label: "Trade", value: report.tradePercent === null ? "—" : `%${report.tradePercent}`, delta: report.deaths ? `${report.untradedDeaths} çevrilmedi` : "ölüm örneği yok", tone: "" },
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
  const ctStats = report?.sideStats?.find((item) => item.side === "CT");
  const tStats = report?.sideStats?.find((item) => item.side === "T");
  const weaponStats = report?.weaponStats || [];
  const strongestWeapon = weaponStats[0];
  const comparisonWeapon = [...weaponStats].filter((item) => item.shots > 0 && item.efficiency !== null && item !== strongestWeapon).sort((a, b) => Number(a.efficiency) - Number(b.efficiency) || b.shots - a.shots)[0];
  const measuredSides = [ctStats, tStats].filter((side): side is NonNullable<typeof side> => Boolean(side && side.rounds > 0 && side.adr !== null));
  const comparisonSide = [...measuredSides].sort((a, b) => Number(a.adr) - Number(b.adr))[0];
  const primaryDevelopmentFinding = coachPacket?.priorities[0];
  const developmentSteps = report ? [
    {
      number: "01", duration: "15 dk", title: primaryDevelopmentFinding?.title || "Maçın en güçlü tekrarını düzelt",
      reason: primaryDevelopmentFinding?.evidence || "Kural motorunun öncelikli bulgusu.",
      work: primaryDevelopmentFinding?.action || "İlgili roundları sırayla incele ve tek davranış hedefi seç.",
      success: "Sonraki demoda aynı yöntemle yeniden ölç ve ilgili round videosunda davranışın değiştiğini doğrula.",
    },
    {
      number: "02", duration: "12 dk", title: comparisonWeapon ? `${comparisonWeapon.label} karşılaştırma bloğu` : "Ana tüfek mekanik bloğu",
      reason: comparisonWeapon ? `${comparisonWeapon.shots} atış, ${comparisonWeapon.kills} kill, ${comparisonWeapon.efficiency} hasar/atış${comparisonWeapon.movingShotPercent === null ? "; hareket ölçülemedi" : `, %${comparisonWeapon.movingShotPercent} sınır üstü hareket`}.` : "Bu maçta karşılaştırılabilecek ikinci bir silah olayı yok.",
      work: "İlk mermi, recoil reset ve counter-strafe bloklarını ayrı çalış; sonra aynı silah çatışmalarını menzil ve satın alma bağlamıyla videoda incele.",
      success: comparisonWeapon ? `${comparisonWeapon.label} hasar/atış ve max_speed tabanlı hareket oranını aynı yöntemle sonraki demoda karşılaştır.` : "Sonraki maçta kullanılan silahları aynı yöntemle yeniden karşılaştır.",
    },
    {
      number: "03", duration: "10 dk", title: comparisonSide ? `${comparisonSide.side} tarafı round incelemesi` : "CT/T taraf incelemesi",
      reason: comparisonSide ? `${comparisonSide.rounds} round · ${comparisonSide.adr} ADR · ${sideTopZoneLabel(comparisonSide)}. Bu yalnız ölçülen taraflar içindeki düşük ADR karşılaştırmasıdır.` : "Taraf ayrımı için yeni parser sonucu bekleniyor.",
      work: comparisonSide ? `${comparisonSide.side} tarafındaki ilk üç ölümü izle; temas amacı, takım görüşü, utility ve kaçış rotasını not et.` : "Demoyu güncel yerel parser ile yeniden analiz et.",
      success: comparisonSide?.topZone ? `${comparisonSide.topZone} roundlarını aynı kontrol listesiyle yeniden değerlendir.` : comparisonSide ? `${comparisonSide.side} tarafındaki ölüm roundlarını aynı kontrol listesiyle yeniden değerlendir.` : "CT ve T verisini ayrı oluştur.",
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

  function applyReports(nextReports: PlayerReport[], analysisVersion?: string) {
    const normalizedReports = nextReports.map((item) => ({
      ...item,
      analysisVersion: item.analysisVersion || analysisVersion,
    }));
    reportsRef.current = normalizedReports;
    setReports(normalizedReports);
    const savedIdentity = preferredPlayerRef.current;
    const matched = savedIdentity ? normalizedReports.find((item) => playerMatchesIdentity(item, savedIdentity)) : undefined;
    setSelectedPlayer(matched ? playerKey(matched) : "");
    if (!matched && normalizedReports.length) {
      setProfileOpen(true);
      setProgressMessage(savedIdentity ? `${savedIdentity.name} bu demoda bulunamadı; başka oyuncu otomatik seçilmedi.` : "Bu demoda kendini bir kez seç; sonraki maçlarda otomatik eşleştirilecek.");
    }
    setProgress(100);
    setProgressLabel(matched ? "Analiz tamamlandı · kişisel oyuncu doğrulandı" : "Analiz tamamlandı · kendi oyuncunu seç");
    setStatus("ready");
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
    try {
      setStatus("parsing");
      setProgress(34);
      setProgressLabel("Güncel Valve olayları ve konumları çözümleniyor");
      const response = await fetch(`${COMPANION_URL}/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream", "X-File-Name": encodeURIComponent(file.name) },
        body: file,
      });
      const payload = await response.json() as { reports?: PlayerReport[]; analysisVersion?: string; error?: string };
      if (!response.ok) throw new Error(payload.error || `Yerel parser ${response.status} döndürdü`);
      applyReports(payload.reports || [], payload.analysisVersion);
      return;
    } catch (companionError) {
      const rawMessage = companionError instanceof Error ? companionError.message : String(companionError);
      setError(`Yerel parser zorunlu ve sentetik tarayıcı fallback'i kapalıdır. Portable klasöründeki TRACER-Yerel.cmd ile açıp yeniden dene. Ayrıntı: ${rawMessage}`);
      setStatus("error");
    }
  }

  async function handleDemo(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) await analyzeFile(file);
  }

  async function testCoachEngine() {
    setCoachState("checking");
    try {
      if (coachEngine === "embedded") {
        const response = await fetch(`${COMPANION_URL}/coach/status`);
        const payload = (await response.json()) as { available?: boolean; error?: string; model?: string; backendLabel?: string };
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
      const payload = (await response.json()) as { models?: Array<{ name?: string; model?: string }> };
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
        setCoachResourceMessage("Doğrulandı: model RAM/VRAM'den çıkarıldı.");
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
    let gamePerformanceActive = false;
    try {
      const performanceResponse = await fetch(`${COMPANION_URL}/performance/status`);
      const performancePayload = (await performanceResponse.json()) as { performance?: { active?: boolean } };
      gamePerformanceActive = Boolean(performanceResponse.ok && performancePayload.performance?.active);
    } catch {
      // Companion yanıt vermezse mevcut koç seçimiyle devam edilir.
    }
    const useEmbeddedCoach = coachEngine === "embedded" || gamePerformanceActive;

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
          status: report.economyStats.status,
          measuredRounds: report.economyStats.sampleCount,
          averageStartMoney: report.economyStats.averageStartMoney,
          totalCashSpent: report.economyStats.totalCashSpent,
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
        { role: "system", content: useEmbeddedCoach
          ? "Görev: Aşağıdaki demo kanıtından oyuncuya doğrudan ve ayrıntılı bir CS2 maç raporu yaz. Yanıt görev tanımını değil maçtaki sonucu anlatarak başlasın; başlıkta TRACER, model, koç veya analiz kelimelerini kullanma. deterministicAssessment ve kural kitabındaki bütün dalları karşılaştır; kanıtta olmayan sebebi kesinleştirme. Kill anı hizasını pre-aim diye adlandırma; approximate-spotted TTD'yi reaksiyon veya profesyonel seviye puanı yapma. bullet_damage ile ölçülen ilk 3/4+ mermi, max_speed tabanlı hareket, CT/T, ölüm bölgeleri, trade, utility, opening, silahlar ve KAST arasından yalnız doğrulanmış en önemli üç önceliği seç. Eksik/null metriği yorumlama ve ekonomi verisini puanlama. Her öncelikte sayısal/round kanıtı, oyuncu için anlamı ve uygulanabilir çalışma/drill ver. strengths yalnızca deterministicAssessment.strengths içinde bulunan alanlardan oluşsun. Doğrudan geçerli JSON döndür."
          : "Sen TRACER'ın CS2 koç editörüsün; hükmü deterministicAssessment ve kural kitabı verir. Veride olmayan sebebi uydurma. Kill anı hizası pre-aim değildir; approximate-spotted TTD profesyonel reaksiyon puanı değildir; ekonomi yalnız bilgi tablosudur. Null/ölçülemedi metriği yorumlama. En fazla 3 doğrulanmış öncelik, güçlü alanlar ve tek antrenman planı yaz. Kısa, anlaşılır Türkçe ve yalnız istenen JSON alanlarını döndür." },
        { role: "user", content: `KURAL KİTABI VE MAÇ KANITI:\n${JSON.stringify(fullCoachInput)}` },
      ];

      const response = useEmbeddedCoach
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

      const payload = (await response.json()) as {
        error?: string; content?: string; message?: { content?: string }; response?: string;
        generated?: boolean; warning?: string; backendLabel?: string; backend?: string; released?: boolean;
      };
      if (!response.ok) throw new Error(payload.error || `${useEmbeddedCoach ? "Gömülü koç" : "Ollama"} ${response.status} döndürdü.`);
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
        isAiGenerated: payload.generated !== false,
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

      if (useEmbeddedCoach) {
        if (payload.generated === false) {
          if (gamePerformanceActive) {
            setCoachState("released");
            setError("");
            setCoachResourceMessage("Oyun Performans Modu: AI çalıştırılmadı; doğrulanmış kural motoru raporu kullanıldı.");
          } else {
            setCoachState("offline");
            setError(`Gömülü AI anlatımı tamamlanamadı; kanıta dayalı kural motoru raporu gösteriliyor. ${payload.warning || "Model yanıtı kullanılamadı."}`);
            setCoachResourceMessage(`Model kapatıldı. AI anlatımı yerine doğrulanmış yerel analiz gösteriliyor. ${payload.warning || ""}`.trim());
          }
        } else {
          setEmbeddedBackendLabel(String(payload.backendLabel || payload.backend || embeddedBackendLabel));
          setCoachState("released");
          setCoachResourceMessage(payload.released ? `Doğrulandı: koç raporu ${payload.backendLabel || payload.backend || "yerel motor"} ile tamamlandı; model kapatıldı, RAM/VRAM serbest.` : "Koç yanıtı tamamlandı.");
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
      setError(useEmbeddedCoach ? `Gömülü AI metni tamamlanamadı; kanıta dayalı kural motoru raporu gösteriliyor. ${message}` : `Ollama koç analizi alınamadı. ${message}`);
      setCoachResourceMessage(useEmbeddedCoach ? `Model kapatıldı. AI anlatımı tamamlanamadı; doğrulanmış yerel analiz gösteriliyor. ${message}` : `Ollama koç raporu alınamadı. ${message}`);
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

  async function checkSteamMatch() {
    setSourceMessage("Valve maç geçmişi kontrol ediliyor…");
    try {
      const response = await fetch("/api/steam/next", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ steamid: steamId, apiKey: steamWebApiKey, authCode: steamAuthCode, knownCode: steamKnownCode }) });
      const payload = (await response.json()) as { error?: string; nextCode?: string | null };
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
      const payload = (await response.json()) as { error?: string; player?: { nickname?: string }; matches?: unknown[] };
      if (!response.ok) throw new Error(payload.error || "FACEIT sorgusu başarısız");
      setSourceMessage(`${payload.player?.nickname || "Oyuncu"} bulundu · ${payload.matches?.length ?? 0} son maç hazır.`);
    } catch (sourceError) {
      setSourceMessage(sourceError instanceof Error ? sourceError.message : "FACEIT bağlantısı kurulamadı.");
    }
  }

  function openDownloadedMatchAnalysis(analysis: import("./components/RecentMatchesView").RecentMatchAnalysis) {
    if (analysis?.reports) applyReports(analysis.reports, analysis.analysisVersion);
    setFileName(analysis.header?.map_name ? `de_${analysis.header.map_name.replace(/^de_/, "")}` : "Otomatik CS2 Maçı");
    setCurrentDemoMeta({
      fileName: analysis.header?.map_name || "auto_match.dem",
      lastModified: analysis.timestamp || 1,
      size: 1024 * 1024,
    });
    setActiveView("analysis");
    navigateTo("dashboard");
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand"><span>TR</span><strong>TRACER</strong></div>
        <nav aria-label="Ana menü">
          <button className={`nav-item ${activeView === "recent" ? "active" : ""}`} onClick={() => { setActiveView("recent"); setActiveSection("recent"); }}><IconClock size={15} /> Son Maçlarım</button>
          <button className={`nav-item ${activeView === "team" ? "active" : ""}`} onClick={() => { setActiveView("team"); setActiveSection("team"); }}><IconPlan size={15} /> Takım Koçu</button>
          <button className={`nav-item nav-item-live ${activeView === "live" ? "active" : ""}`} onClick={() => { setActiveView("live"); setActiveSection("live"); }}><span className="live-nav-dot" /> Canlı Koç (Live)</button>
          <button className={`nav-item ${activeView === "analysis" && activeSection === "dashboard" ? "active" : ""}`} onClick={() => { setActiveView("analysis"); navigateTo("dashboard"); }}><IconDashboard size={15} /> Genel bakış</button>
          <button className={`nav-item ${activeView === "growth" ? "active" : ""}`} onClick={() => { setActiveView("growth"); setActiveSection("growth"); }}><IconGrowth size={15} /> Gelişim</button>
          <button className={`nav-item ${activeSection === "aim-precision" ? "active" : ""}`} onClick={() => navigateTo("aim-precision")}><IconCrosshair size={15} /> Nişangah & İsabet</button>
          <button className={`nav-item ${activeSection === "duel-reaction" ? "active" : ""}`} onClick={() => navigateTo("duel-reaction")}><IconDuel size={15} /> Düello & Reaksiyon</button>
          <button className={`nav-item ${activeSection === "economy-view" ? "active" : ""}`} onClick={() => navigateTo("economy-view")}><IconEconomy size={15} /> Ekonomi & Bakiye</button>
          <button className={`nav-item ${activeSection === "side-analysis" ? "active" : ""}`} onClick={() => navigateTo("side-analysis")}><IconSideAnalysis size={15} /> Taraf analizi</button>
          <button className={`nav-item ${activeSection === "weapon-profile" ? "active" : ""}`} onClick={() => navigateTo("weapon-profile")}><IconWeapon size={15} /> Silah profili</button>
          <button className={`nav-item ${activeSection === "map-analysis" ? "active" : ""}`} onClick={() => navigateTo("map-analysis")}><IconMap size={15} /> Harita olayları</button>
          <button className={`nav-item ${activeSection === "development" ? "active" : ""}`} onClick={() => navigateTo("development")}><IconPlan size={15} /> Gelişim planı</button>
          <button className="nav-item" onClick={shutdownTracer} style={{ color: "#ff6b6b", marginTop: "4px" }} title="TRACER ve tüm arka plan servislerini tamamen kapat"><IconPower size={14} style={{ marginRight: "6px" }} /> TRACER’ı Kapat</button>
        </nav>
        <div className="sidebar-spacer" />
        <button className={`ai-status ${coachState}`} onClick={() => setSettingsOpen(true)}>
          <span className="pulse" />
          <div><b>{coachState === "released" ? "KAYNAKLAR BIRAKILDI" : coachState === "online" ? (coachEngine === "embedded" ? "GÖMÜLÜ KOÇ HAZIR" : "OLLAMA BAĞLI") : coachState === "thinking" ? "KOÇ DÜŞÜNÜYOR" : "YEREL KOÇU AYARLA"}</b><small>{coachEngine === "embedded" ? `${embeddedModelName} · ${embeddedBackendLabel}` : ollamaModel} · cihazda</small></div>
        </button>
        <button className="player-card" onClick={() => setProfileOpen(true)} aria-label="Kişisel oyuncu profilini seç">
          <div className="avatar">KD</div>
          <div><b>{preferredPlayer?.name || "Kendini seç"}</b><small>{preferredPlayer ? `${progressMatches.length} kayıtlı maç · kişisel profil` : "Başka oyuncu verisi kullanılmaz"}</small></div>
          <span><IconSettings size={14} /></span>
        </button>
      </aside>

      <NotificationCenter onSelectAnalysis={openDownloadedMatchAnalysis} />

      {activeView === "recent" ? (
        <RecentMatchesView onSelectAnalysis={openDownloadedMatchAnalysis} />
      ) : activeView === "team" ? (
        <TeamCoachView />
      ) : activeView === "live" ? (
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
              className="topbar-recent-toggle-btn"
              onClick={() => setActiveView("recent")}
              title="Steam'den Otomatik İndirilen Son 5 Maçım"
            >
              <IconClock size={13} style={{ marginRight: "4px" }} />
              <span>SON MAÇLARIM</span>
            </button>
            <button
              className="topbar-live-toggle-btn"
              onClick={() => setActiveView("live")}
              title="Canlı CS2 Maç Koçluğuna Geç"
            >
              <span className="live-btn-dot" />
              <span>CANLI KOÇ (LIVE)</span>
            </button>
            <button
              className={`topbar-coach-btn ${fullMatchReport ? "has-report" : ""}`}
              onClick={() => {
                if (!report) {
                  setActiveView("recent");
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
              <IconSparkles size={14} style={{ marginRight: "6px" }} />
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
            <button className="ghost-button" onClick={() => setSettingsOpen(true)}><IconSettings size={14} /> Kaynakları bağla</button>
            <button
              className="ghost-button nav-terminal-btn"
              onClick={() => setLogsModalOpen(true)}
              title="Canlı terminal ve hata ayıklama konsolunu aç"
            >
              <IconTerminal size={13} style={{ marginRight: "5px" }} />
              <span>Terminal</span>
            </button>
            <button
              className={`ghost-button update-nav-btn ${updateInfo?.hasUpdate ? "has-new-update" : ""}`}
              onClick={() => setUpdateModalOpen(true)}
              title={updateInfo?.hasUpdate ? `Yeni v${updateInfo.latestVersion} güncellemesi mevcut!` : "TRACER sürüm & yama merkezi"}
            >
              {updateInfo?.hasUpdate ? (
                <>
                  <IconRocket size={13} style={{ marginRight: "4px" }} />
                  <span>Güncelleme</span>
                </>
              ) : (
                <span>v{updateInfo?.currentVersion || APP_VERSION}</span>
              )}
            </button>
            <button
              className="ghost-button shutdown-nav-btn"
              onClick={shutdownTracer}
              title="TRACER'ı ve tüm arka plan servislerini tamamen kapat"
              style={{ color: "#ff6b6b", borderColor: "rgba(255, 107, 107, 0.35)", fontWeight: 700 }}
            >
              <IconPower size={13} style={{ marginRight: "4px" }} />
              <span>Kapat</span>
            </button>
            <label className="upload-button">
              <input type="file" accept=".dem,.bz2" onChange={handleDemo} />
              <span>＋</span> {status === "parsing" || status === "reading" ? "%" + progress : "Demo yükle"}
            </label>
          </div>
        </header>

        <div className="match-strip">
          <div className="map-thumb"><span>A</span><span>B</span></div>
          <div><p>{report ? "YÜKLENEN DEMO" : "ANALİZ BEKLİYOR"}</p><b>{report ? `${report.map || "Bilinmeyen harita"} · ${fileName}` : "Son Maçlarım’dan bir maç aç veya demo yükle"}</b></div>
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
              <IconSparkles size={12} style={{ marginRight: "4px", display: "inline-block", verticalAlign: "middle" }} />
              {fullMatchReport.matchScorecard.overallScore === null ? "KAST ölçülemedi" : `%${fullMatchReport.matchScorecard.overallScore} KAST`}
            </button>
          )}
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
            <div>
              <span>
                {status === "error" ? (
                  <IconWarning size={14} />
                ) : status === "ready" ? (
                  <IconCheck size={14} />
                ) : (
                  <IconRefresh size={14} className="spin-icon" />
                )}
              </span>
              <b>{status === "error" ? error : progressLabel}</b>
              <small>{status === "ready" ? "Veri cihazından ayrılmadı." : status === "error" ? "Dosyayı kontrol edip yeniden dene." : `${progress}%`}</small>
            </div>
            <div className="progress-track"><i style={{ width: `${status === "error" ? 100 : progress}%` }} /></div>
          </div>
        )}

        {analysisNeedsRefresh && report && (
          <div className="analysis-data-notice" role="status">
            <IconWarning size={16} />
            <div>
              <b>Bu maç eski analiz motoruyla kaydedilmiş.</b>
              <span>Analiz sürümü {report.analysisVersion || "bilinmiyor"}; yeni örnek sayıları ve veri durumu alanları bu raporda yok. Bu nedenle eski açı/fallback değerleri gösterilmiyor. Demoyu güncel portable sürümde yeniden analiz et.</span>
            </div>
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
            <span>KAST round katkısı</span>
            <div><strong>{report?.kastPercent ?? "—"}</strong><small>%</small><em className={kastTier.tone}>{kastTier.label}</em></div>
            <div className="score-line"><i style={{ width: `${report?.impact ?? 0}%` }} /></div>
            <p className="kast-explanation"><b>KAST</b> = Kill, Assist, Survived, Traded. Bu dört katkıdan en az birinin olduğu roundların yüzdesidir.</p>
          </article>
        </div>

        <section className="side-analysis" id="side-analysis">
          <div className="section-title-row"><div><p className="eyebrow">CT / T AYRIMI</p><h2>İki taraf, ayrı round paydaları</h2></div><span>{report?.sideStats?.length ? "Gerçek taraf verisi" : "Yeni parser analizi gerekli"}</span></div>
          {report ? <div className="side-grid">
            {([ctStats, tStats] as (SideStat | undefined)[]).map((side, index) => {
              const sideName = index === 0 ? "CT" : "T";
              return <article className={`side-card ${sideName.toLowerCase()}`} key={sideName}>
                <header><span>{sideName}</span><div><b>{sideName === "CT" ? "Savunma tarafı" : "Hücum tarafı"}</b><small>{side ? `${side.rounds} gözlenen round` : "Demo yeniden analiz edildiğinde dolar"}</small></div></header>
                <div className="side-metrics"><div><span>K / D</span><b>{side ? `${side.kills} / ${side.deaths}` : "—"}</b></div><div><span>ADR</span><b>{side?.adr ?? "—"}</b></div><div><span>Trade</span><b>{side?.tradePercent === null || side?.tradePercent === undefined ? "—" : `%${side.tradePercent}`}</b></div><div><span>Sınır üstü atış</span><b>{side?.movingShotPercent === null || side?.movingShotPercent === undefined ? "—" : `%${side.movingShotPercent}`}</b></div></div>
                <footer><span>En çok öldüğün bölge</span><b>{sideTopZoneLabel(side)}</b></footer>
              </article>;
            })}
          </div> : <div className="section-empty"><b>CT/T değerlendirmesi için demo gerekli</b><span>Demosuz ekranda taraf istatistiği veya örnek sonuç gösterilmez.</span></div>}
          {report && <p className="data-caveat">Taraf round sayıları freeze/end tick aralıklarındaki gerçek takım bilgisinden hesaplanır; sessiz roundlar da paydaya dahildir.</p>}
        </section>

        <div className="dashboard-grid">
          <article className="coach-card">
            <div className="card-kicker"><span className="spark"><IconSparkles size={13} style={{ display: "inline-block", verticalAlign: "middle" }} /></span> {aiInsight ? "KURAL MOTORU + YEREL AI KOÇ" : "KANITA DAYALI KURAL MOTORU"} {report && coachConfidence !== undefined && <em>%{coachConfidence} güven · LLM hüküm vermez</em>}</div>
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
                <header><div><span>ATIŞ HIZI PROFİLİ</span><b>{report.movementProfile.status === "measured" ? `Ortalama ${report.movementProfile.averageSpeed} u/s · P90 ${report.movementProfile.p90Speed} u/s` : "Hız / max_speed ölçülemedi"}</b></div><em className={`severity-badge ${coachPacket.findings.find((item) => item.id === "movement")?.severity || "info"}`}>{report.movementProfile.status === "measured" ? `%${report.movementProfile.invalidShotPercent} sınır üstü` : "Ölçülemedi"}</em></header>
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
                    <div className="w-cat-box"><span>Tüfekler (AK/M4)</span><b>%{report.movementProfile.byCategory.rifle?.movingPercent ?? 0}</b><small>{report.movementProfile.byCategory.rifle?.shots ?? 0} ölçüm · max_speed %34</small></div>
                    <div className="w-cat-box"><span>Sniper (AWP/SSG)</span><b>%{report.movementProfile.byCategory.sniper?.movingPercent ?? 0}</b><small>{report.movementProfile.byCategory.sniper?.shots ?? 0} ölçüm · max_speed %34</small></div>
                    <div className="w-cat-box"><span>Tabancalar</span><b>%{report.movementProfile.byCategory.pistol?.movingPercent ?? 0}</b><small>{report.movementProfile.byCategory.pistol?.shots ?? 0} ölçüm · max_speed %34</small></div>
                    <div className="w-cat-box"><span>Hafif Makineli (SMG)</span><b>%{report.movementProfile.byCategory.smg?.movingPercent ?? 0}</b><small>{report.movementProfile.byCategory.smg?.shots ?? 0} ölçüm · max_speed %34</small></div>
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
              <span><IconSparkles size={20} /></span><b>Koç raporu için demo gerekli</b>
              <p>TRACER tahmin üretmiyor. Demo analiz edildiğinde gerçek hareket hızı, ölüm örüntüsü, taraf, utility, trade ve round etkisi sınıflandırılacak.</p>
              <button onClick={() => setActiveView("recent")}>Son Maçlarım’ı aç</button>
            </div>}
            {report && (
              <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginTop: "10px" }}>
                <button
                  className="ollama-coach-button"
                  onClick={() => void runFullMatchAnalysis(true)}
                  disabled={coachState === "thinking"}
                  style={{ flex: 1 }}
                >
                  <IconSparkles size={14} style={{ marginRight: "6px" }} />
                  {coachState === "thinking"
                    ? "Koç maçın genelini yorumluyor…"
                    : fullMatchReport
                    ? "Full Maç Analizini Yenile"
                    : "Tek Tuşla Full Maç Analizi & Rapor"}
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
                    <IconSparkles size={12} style={{ marginRight: "4px" }} />
                    Rotalar: {showRoutePaths ? "AÇIK" : "KAPALI"}
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
                        R{String(p.round).padStart(2, "0")} · {p.won ? "WIN" : "LOSS"} ({p.primaryZone})
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
              {/* Harita radarları yerel, dinamik ve piksel hassasiyetli katmanlardır; Next Image dönüşümü uygulanmaz. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {radarImage && <img className="radar-image" src={radarImage} alt="" draggable="false" />}
              {report && !radarMap && <div className="radar-unavailable">Bu harita için radar kalibrasyonu henüz yok.</div>}

              {/* Radar Köşe HUD: En Başarılı ve En Zayıf Rota Bilgisi */}
              {report && (bestRoute || worstRoute) && (
                <div className="radar-best-route-hud">
                  {bestRoute && (
                    <div className="hud-route-chip best" title={`En Başarılı Rota: ${bestRoute.zone} (%${bestRoute.winrate} Win · ${bestRoute.wins}W - ${bestRoute.losses}L)`}>
                      <span className="hud-spark win"><IconCheck size={11} /></span>
                      <span className="hud-label">En Başarılı:</span>
                      <b className="hud-zone">{bestRoute.zone}</b>
                      <span className="hud-winrate win">%{bestRoute.winrate}</span>
                      <small className="hud-record">({bestRoute.wins}W - {bestRoute.losses}L)</small>
                    </div>
                  )}
                  {worstRoute && worstRoute.zone !== bestRoute?.zone && (
                    <div className="hud-route-chip worst" title={`En Zayıf Rota: ${worstRoute.zone} (%${worstRoute.winrate} Win · ${worstRoute.wins}W - ${worstRoute.losses}L)`}>
                      <span className="hud-spark loss"><IconClose size={11} /></span>
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
                      title={`En Başarılı Rota: ${bestRoute.zone} (%${bestRoute.winrate} Win · ${bestRoute.wins}W - ${bestRoute.losses}L)`}
                    >
                      <span className="waypoint-pulse best" />
                      <span className="waypoint-dot best"><IconCheck size={10} /></span>
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
                      title={`En Zayıf Rota: ${worstRoute.zone} (%${worstRoute.winrate} Win · ${worstRoute.wins}W - ${worstRoute.losses}L)`}
                    >
                      <span className="waypoint-pulse worst" />
                      <span className="waypoint-dot worst"><IconClose size={10} /></span>
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
                        {r.isBestRoute && <em className="best-route-badge">En Başarılı Rota</em>}
                        {r.zone === worstRoute?.zone && !r.isBestRoute && r.losses > 0 && <em className="worst-route-badge">En Zayıf Rota</em>}
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
                          ? "Yüksek verimli dominant rota"
                          : r.winrate >= 50
                          ? "Dengeli açılış/tutuş"
                          : r.winrate >= 35
                          ? "Ortalama altı verim"
                          : "Riskli rota / round kaybı yoğun"}
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
          <div className="section-title-row"><div><p className="eyebrow">SİLAH OLAYLARI</p><h2>Kill, hasar, atış ve hareket örnekleri</h2><p>Her kullanılan silah gösterilir; 15/40 atış şartı yoktur. İyi–orta–geliştirilebilir yorumu yalnız bu maçtaki silahları birbiriyle kıyaslar.</p></div><span>{weaponStats.length ? `${weaponStats.length} silah kullanıldı` : "Demo verisi bekleniyor"}</span></div>
          {report ? <><div className="weapon-highlights">
            <article className="weapon-hero strong"><span>EN ÇOK KILL ÜRETİLEN SİLAH</span><h3>{strongestWeapon?.label || "—"}</h3><p>{strongestWeapon ? `${strongestWeapon.kills} kill · ${strongestWeapon.damage} hasar · %${strongestWeapon.headshotPercent} HS` : "Gerçek silah olayları analiz edildiğinde görünür."}</p><div><i style={{ width: `${Math.min(100, strongestWeapon?.efficiency ?? 0)}%` }}/></div><small>{strongestWeapon ? `${strongestWeapon.efficiency ?? "—"} hasar/atış · birleşik puan değildir` : "Örnek istatistik gösterilmiyor"}</small></article>
            <article className="weapon-hero develop"><span>MAÇ İÇİ GELİŞTİRME ADAYI</span><h3>{comparisonWeapon?.label || "—"}</h3><p>{comparisonWeapon ? `${comparisonWeapon.shots} atış · ${comparisonWeapon.kills} kill · ${comparisonWeapon.efficiency} hasar/atış` : "Bu maçta kıyaslanabilecek ikinci bir silah kullanılmadı."}</p><b>{comparisonWeapon?.movingShotPercent === null || comparisonWeapon?.movingShotPercent === undefined ? "Hareket ölçülemedi" : `%${comparisonWeapon.movingShotPercent} max_speed sınırı üstü`}</b><small>Bu yorum yalnız maç içi göreli kıyastır; menzil, rol ve satın alma bağlamı videoda doğrulanmalıdır.</small></article>
          </div>
          <div className="weapon-table" role="table" aria-label="Silah performansı">
            <div className="weapon-table-head" role="row"><span>Silah</span><span>Kill</span><span>Hasar</span><span>Atış</span><span>HS</span><span>Hareketli</span><span>Maç yorumu</span></div>
            {weaponStats.map((weapon) => {
              const verdict = weaponMatchVerdict(weapon, weaponStats);
              return <div className="weapon-row" role="row" key={weapon.weapon}><b>{weapon.label}</b><span>{weapon.kills}</span><span>{weapon.damage}</span><span>{weapon.shots}</span><span>%{weapon.headshotPercent}</span><span>{weapon.movingShotPercent === null ? "—" : `%${weapon.movingShotPercent}`}</span><em className={verdict.tone}>{verdict.label}</em></div>;
            })}
            {!weaponStats.length && <div className="weapon-empty">Silah bazlı kill, hasar ve atış verisi için demoyu güncel yerel parser ile analiz et.</div>}
          </div></> : <div className="section-empty"><b>Silah olayları için demo gerekli</b><span>Karşılaştırma ve tablo yalnızca gerçek silah olaylarından üretilecek.</span></div>}
        </section>

        {/* KILL ANI NİŞANGAH HİZASI & HITBOX DAĞILIMI */}
        <section className="aim-precision-section" id="aim-precision">
          <div className="section-title-row">
            <div>
              <p className="eyebrow">NİŞANGAH & İSABET DERİNLİĞİ</p>
              <h2>Kill Anı Kafa/Gövde Açısı ve Hitbox Dağılımı</h2>
              <p>Açı yalnız öldürme tick’inde ölçülür; pre-aim veya ilk görünür temas metriği değildir.</p>
            </div>
            <span>{analysisNeedsRefresh ? "Eski analiz · yeniden çalıştır" : measuredCrosshairSamples > 0 ? `${getAngleTier(report?.crosshairStats?.headErrorAngle ?? null, "head").label} (kill anı)` : report ? "Geçerli kill örneği yok" : "Demo bekleniyor"}</span>
          </div>

          <div className="aim-precision-grid">
            {/* İNSAN HEDEF HİTBOX MAKETİ (MANNEQUIN) */}
            <article className="aim-stat-card mannequin-card">
              <header>
                <span>HEDEF İNSAN MAKETİ (HITBOX SİLUETİ)</span>
                <small>{report?.sprayStats ? `${report.sprayStats.hitboxSampleCount ?? Object.values(report.sprayStats.hitboxCounts).reduce((sum, count) => sum + count, 0)} Hitgroup Örneği` : "Demo analizi bekleniyor"}</small>
              </header>
              <HitboxMannequin
                counts={report?.sprayStats?.hitboxCounts}
                percents={report?.sprayStats?.hitboxPercents}
                totalHits={report?.sprayStats ? (report.sprayStats.hitboxSampleCount ?? Object.values(report.sprayStats.hitboxCounts).reduce((sum, count) => sum + count, 0)) : 0}
              />
            </article>

            <div className="aim-side-cards">
              <article className="aim-stat-card">
                <header>
                  <span>KAFA & GÖVDE AÇI SAPMASI</span>
                  <em className="rating-pill">{analysisNeedsRefresh ? "Eski analiz" : measuredCrosshairSamples > 0 ? getAngleTier(report?.crosshairStats?.headErrorAngle ?? null, "head").label : report ? "Örnek yok" : "Hazır"}</em>
                </header>
                {(() => {
                  const headAngle = measuredCrosshairSamples > 0 ? report?.crosshairStats?.headErrorAngle ?? null : null;
                  const bodyAngle = measuredCrosshairSamples > 0 ? report?.crosshairStats?.bodyErrorAngle ?? null : null;
                  const headTier = getAngleTier(headAngle, "head");
                  const bodyTier = getAngleTier(bodyAngle, "body");

                  return (
                    <>
                      <div className="deviation-metrics">
                        <div className="dev-box">
                          <span>Kafa Sapması</span>
                          <b>{headAngle === null ? "—" : `${headAngle}°`}</b>
                          <em className={`tier-badge ${headTier.tone}`}>{headTier.label}</em>
                          <small>{headTier.hint}</small>
                        </div>
                        <div className="dev-box">
                          <span>Gövde Sapması</span>
                          <b>{bodyAngle === null ? "—" : `${bodyAngle}°`}</b>
                          <em className={`tier-badge ${bodyTier.tone}`}>{bodyTier.label}</em>
                          <small>{bodyTier.hint}</small>
                        </div>
                        <div className="dev-box highlight">
                          <span>GEÇERLİ KILL ÖRNEĞİ</span>
                          <b>{measuredCrosshairSamples > 0 ? measuredCrosshairSamples : "—"}</b>
                          <em className="tier-badge normal">{analysisNeedsRefresh ? "Eski analiz" : measuredCrosshairSamples > 0 ? "Maç örneği" : "Örnek yok"}</em>
                          <small>{analysisNeedsRefresh ? "Eski raporda örnek sayısı güvenilir değil" : measuredCrosshairSamples > 0 ? "kill-tick-alignment-v2" : report?.crosshairStats?.reason || "Geçerli saldırgan/hedef tick konumu bulunamadı"}</small>
                        </div>
                      </div>
                      <p className="data-caveat">İyi–orta–geliştirilebilir etiketi yalnız kill anındaki açı sapmasına verilen maç içi koçluk yorumudur. Harita geometrisi/raycast olmadığı için pre-aim veya profesyonel seviye sonucu değildir.</p>
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
                  const acc = report?.sprayStats?.accuracyPercent ?? null;
                  const early = report?.sprayStats?.earlyAccuracy ?? null;
                  const late = report?.sprayStats?.lateAccuracy ?? null;
                  const headShare = report?.sprayStats ? report.sprayStats.hitboxPercents.head : null;

                  const accTier = getSprayTier(acc, "overall");
                  const earlyTier = getSprayTier(early, "early");
                  const lateTier = getSprayTier(late, "late");
                  const headShareTier = getSprayTier(headShare, "head");

                  return (
                    <>
                      <div className="spray-efficiency-box">
                        <div>
                          <span>Genel İsabet</span>
                          <b>{acc === null ? "—" : `%${acc}`}</b>
                          <em className={`tier-badge ${accTier.tone}`}>{accTier.label}</em>
                          <small>{report?.sprayStats ? `${report.sprayStats.totalShots} silahlı atış · ${report.sprayStats.totalHits} isabet` : "Demo bekleniyor"}</small>
                        </div>
                        <div>
                          <span>İlk 3 Mermi İsabeti</span>
                          <b>{early === null ? "—" : `%${early}`}</b>
                          <em className={`tier-badge ${earlyTier.tone}`}>{earlyTier.label}</em>
                          <small>{report?.sprayStats ? `${report.sprayStats.earlyShots} mermi · ${earlyTier.hint}` : earlyTier.hint}</small>
                        </div>
                        <div>
                          <span>4+ Mermi Sprey İsabeti</span>
                          <b>{late === null ? "—" : `%${late}`}</b>
                          <em className={`tier-badge ${lateTier.tone}`}>{lateTier.label}</em>
                          <small>{report?.sprayStats ? `${report.sprayStats.lateShots} mermi · ${lateTier.hint}` : lateTier.hint}</small>
                        </div>
                        <div>
                          <span>Kafa Vuruş Payı</span>
                          <b>{headShare === null ? "—" : `%${headShare}`}</b>
                          <em className={`tier-badge ${headShareTier.tone}`}>{headShareTier.label}</em>
                          <small>{report?.sprayStats ? `${report.sprayStats.hitboxSampleCount ?? Object.values(report.sprayStats.hitboxCounts).reduce((sum, count) => sum + count, 0)} isabet · ${headShareTier.hint}` : headShareTier.hint}</small>
                        </div>
                      </div>

                      <p className="data-caveat">İsabetler bullet_damage saldırı tick’iyle eşleştirilir. Olay yoksa player_hurt zaman yakınlığıyla tahmin yapılmaz.</p>

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
              <h2>Time-to-Damage (TTD) ve Karşılıklı Düello Başarısı</h2>
              <p>Yaklaşık görünür temasın ilk hasara dönüşme hızı ve iki rakibin birbirini gördüğü düelloların sonucu.</p>
            </div>
            <span>
              {report?.duelStats?.ttdMethod !== "spotted-to-first-damage-v2"
                ? report?.duelStats ? "Eski analiz · yeniden analiz et" : "Demo bekleniyor"
                : report.duelStats.reactionRating}
            </span>
          </div>

          {report ? (
            <div className="duel-metrics-grid">
              <article className="duel-hero-card">
                <span>MEDYAN HASAR VERME SÜRESİ</span>
                <h3>
                  {hasMeasuredTtd(report.duelStats) ? report.duelStats?.medianTTD : "—"}
                  {hasMeasuredTtd(report.duelStats) && <i> ms</i>}
                </h3>
                <p>
                  {hasMeasuredTtd(report.duelStats)
                    ? `${report.duelStats?.ttdSampleCount} geçerli görünür temas · ortalama ${report.duelStats?.averageTTD} ms.`
                    : report.duelStats?.ttdMethod === "spotted-to-first-damage-v2"
                      ? "Bu maçta güvenilir TTD üretmeye yetecek görünür temas bulunamadı."
                      : "Bu rapor eski hesaplama yöntemiyle oluşturulmuş; doğru TTD için maçı yeniden analiz et."}
                </p>
                <div className="reaction-pill">{hasMeasuredTtd(report.duelStats) ? report.duelStats?.reactionRating : "Ölçülemedi"}</div>
              </article>

              <article className="duel-hero-card">
                <span>KARŞILIKLI DÜELLO KAZANMA ORANI</span>
                <h3>{hasMeasuredDuels(report.duelStats) ? `%${report.duelStats?.duelWinrate}` : "—"}</h3>
                <p>
                  {hasMeasuredDuels(report.duelStats)
                    ? `${report.duelStats?.duelWins} galibiyet · ${report.duelStats?.duelLosses || 0} mağlubiyet · ${report.duelStats?.duelTotal} sonuçlanan düello`
                    : report.duelStats?.duelMethod === "mutual-spotted-death-v2"
                      ? "Ölümle sonuçlanan karşılıklı görünür düello bulunamadı."
                      : "Eski kill/death oranı gösterilmiyor; maçı yeniden analiz et."}
                </p>
                <div className="score-line"><i style={{ width: `${hasMeasuredDuels(report.duelStats) ? report.duelStats?.duelWinrate : 0}%` }} /></div>
              </article>

              <article className="duel-hero-card">
                <span>250 MS VE ALTI ÖLÇÜMLER</span>
                <h3>
                  {hasMeasuredTtd(report.duelStats) ? report.duelStats?.fastReactions : "—"}
                  {hasMeasuredTtd(report.duelStats) && <i> kez</i>}
                </h3>
                <p>
                  {hasMeasuredTtd(report.duelStats)
                    ? `250 ms veya altındaki ilk hasarlar · ${report.duelStats?.preparedContacts || 0} aynı-tick hazır temas/prefire ayrı tutuldu.`
                    : "Yalnız yeni görünürlük tabanlı analizde hesaplanır."}
                </p>
              </article>
            </div>
          ) : (
            <div className="section-empty"><b>Düello ve reaksiyon verisi için demo gerekli.</b></div>
          )}
        </section>

        {/* EKONOMİ BİLGİ TABLOSU — PUANLANMAZ */}
        <section className="economy-section" id="economy-view">
          <div className="section-title-row">
            <div>
              <p className="eyebrow">EKONOMİ BİLGİ TABLOSU · PUANLANMAZ</p>
              <h2>Round Başlangıcı Bakiye ve Harcama</h2>
              <p>Yalnız demoda ölçülen oyuncu parası gösterilir; takım uyumu veya hero-buy hükmü üretilmez.</p>
            </div>
            <span>{report?.economyStats?.totalCashSpent === null || report?.economyStats?.totalCashSpent === undefined ? "Ölçüm bekleniyor" : `$${report.economyStats.totalCashSpent.toLocaleString()} ölçülen harcama`}</span>
          </div>

          {report?.economyStats ? (
            <>
              <div className="economy-summary-cards">
                <article className="eco-card"><span>ORTALAMA BAŞLANGIÇ PARASI</span><b>{report.economyStats.averageStartMoney === null ? "—" : `$${report.economyStats.averageStartMoney}`}</b></article>
                <article className="eco-card"><span>TOPLAM ÖLÇÜLEN HARCAMA</span><b>{report.economyStats.totalCashSpent === null ? "—" : `$${report.economyStats.totalCashSpent.toLocaleString()}`}</b></article>
                <article className="eco-card"><span>DÜŞÜK HARCAMA (≤$1000)</span><b>{report.economyStats.ecoRounds} Round</b></article>
                <article className="eco-card"><span>ORTA HARCAMA (≤$2800)</span><b>{report.economyStats.forceRounds} Round</b></article>
                <article className="eco-card"><span>YÜKSEK HARCAMA</span><b>{report.economyStats.fullBuyRounds} Round</b></article>
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
                    <span>{eco.startMoney === null ? "—" : `$${eco.startMoney}`}</span>
                    <span>{eco.spentMoney === null ? "—" : `$${eco.spentMoney}`}</span>
                    <span>{eco.endMoney === null ? "—" : `$${eco.endMoney}`}</span>
                    <em className={`buy-pill ${eco.buyType.toLowerCase().replace(/\s+/g, "-")}`}>{eco.buyType}</em>
                    <span>{eco.status === "measured" ? "Ölçüldü" : "Veri yok"}</span>
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
          {developmentSteps.length ? <div className="plan-grid">{developmentSteps.map((step) => <article key={step.number}><header><span>{step.number}</span><em>{step.duration}</em></header><h3>{step.title}</h3><p><b>Neden?</b>{step.reason}</p><p><b>Ne yapacaksın?</b>{step.work}</p><footer><span>Başarı ölçütü</span><b>{step.success}</b></footer></article>)}</div> : <div className="plan-empty"><b>Kişisel plan için bir demo analiz et.</b><span>TRACER taraf, pozisyon, silah ve koç bulgularını tek çalışma sırasına dönüştürecek.</span><button onClick={() => setActiveView("recent")}>Son Maçlarım’ı aç</button></div>}
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
            })}</div> : <div className="profile-empty"><b>Önce bir demo analiz et</b><span>Demodaki oyuncu listesi çıkarıldığında burada kendini seçebilirsin.</span><button onClick={() => { setProfileOpen(false); setActiveView("recent"); }}>Son Maçlarım’ı aç</button></div>}
            {progressMessage && <div className="profile-message">{progressMessage}</div>}
          </section>
        </div>
      )}

      {settingsOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSettingsOpen(false); }}>
          <section className="settings-modal integration-modal" role="dialog" aria-modal="true" aria-labelledby="settings-title">
            <button className="modal-close" onClick={() => setSettingsOpen(false)} aria-label="Ayarları kapat">
              <IconClose size={16} />
            </button>
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
            <div className={`connection-result ${coachState}`}>{coachState === "released" ? coachResourceMessage : coachState === "online" ? `Yerel koç hazır · ${coachResourceMessage}` : coachState === "offline" ? coachResourceMessage : coachEngine === "embedded" ? "Beklemede: model bellekte değil ve CS2 performansını etkilemiyor." : "Varsayılan: http://127.0.0.1:11434 · 4096 context · anında unload"}</div>
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
                  <div><span>1</span><p><b>Resmî Steam kod sayfasını aç</b><small>Steam’e giriş yap; CS2 maç geçmişi erişim kodunu oluştur veya mevcut kodunu görüntüle.</small></p><a href="https://help.steampowered.com/en/wizard/HelpWithGameIssue/?appid=730&issueid=128" target="_blank" rel="noreferrer">Steam kod sayfasını aç <IconExternalLink size={12} style={{ display: "inline-block", verticalAlign: "middle" }} /></a></div>
                  <div><span>2</span><p><b>Steam Web API key oluştur</b><small>Valve maç geçmişi endpoint’i geliştirici API anahtarı da ister.</small></p><a href="https://steamcommunity.com/dev/apikey" target="_blank" rel="noreferrer">API key sayfasını aç <IconExternalLink size={12} style={{ display: "inline-block", verticalAlign: "middle" }} /></a></div>
                  <div><span>3</span><p><b>Dört değeri buraya yapıştır</b><small>Anahtarlar yalnızca açık sayfadaki sorguda kullanılır; tarayıcı depolamasına yazılmaz.</small></p></div>
                </div>
                <div className="guided-form">
                  <label><span>SteamID64</span><input inputMode="numeric" placeholder="17 haneli SteamID64" value={steamId} onChange={(event) => setSteamId(event.target.value.trim())} /></label>
                  <label><span>Steam Web API key</span><input type="password" autoComplete="off" placeholder="Steam geliştirici anahtarın" value={steamWebApiKey} onChange={(event) => setSteamWebApiKey(event.target.value.trim())} /></label>
                  <label><span>Game Authentication Code</span><input type="password" autoComplete="off" placeholder="AAAA-AAAAA-AAAA" value={steamAuthCode} onChange={(event) => setSteamAuthCode(event.target.value.trim())} /></label>
                  <label><span>Son maç paylaşım kodu</span><input placeholder="CSGO-xxxxx-xxxxx-xxxxx-xxxxx-xxxxx" value={steamKnownCode} onChange={(event) => setSteamKnownCode(event.target.value.trim())} /></label>
                  <button className="upload-button" onClick={checkSteamMatch}>Bağlantıyı doğrula</button>
                </div>
                <footer><span>?</span><p>Paylaşım kodu aynı Steam hesabına ait olmalı. Steam bu yöntemde geçersiz kod denemelerini hızla sınırlar.</p><a href="https://developer.valvesoftware.com/wiki/Counter-Strike%3A_Global_Offensive_Access_Match_History" target="_blank" rel="noreferrer">Valve rehberi <IconExternalLink size={12} style={{ display: "inline-block", verticalAlign: "middle" }} /></a></footer>
              </section>
              <section className="connect-card faceit-connect">
                <header><span>02</span><div><b>FACEIT</b><small>Herkese açık maç geçmişi için yalnızca kullanıcı adı</small></div><em>Şifresiz</em></header>
                <p className="connect-explainer">TRACER senden FACEIT şifresi istemez. Kendi FACEIT Developer App’inden oluşturduğun Data API key ve kullanıcı adıyla herkese açık maç geçmişini okur; anahtar bu sayfada saklanmaz.</p>
                <div className="faceit-key-links"><a href="https://developers.faceit.com/" target="_blank" rel="noreferrer">FACEIT Developer Portal’ı aç <IconExternalLink size={12} style={{ display: "inline-block", verticalAlign: "middle" }} /></a><a href="https://docs.faceit.com/docs/data-api/" target="_blank" rel="noreferrer">Data API key rehberi <IconExternalLink size={12} style={{ display: "inline-block", verticalAlign: "middle" }} /></a></div>
                <div className="faceit-quick"><input type="password" autoComplete="off" aria-label="FACEIT Data API key" placeholder="FACEIT Data API key" value={faceitApiKey} onChange={(event) => setFaceitApiKey(event.target.value.trim())} /><input aria-label="FACEIT kullanıcı adı" placeholder="FACEIT kullanıcı adın" value={faceitNickname} onChange={(event) => setFaceitNickname(event.target.value)} /><button className="upload-button" onClick={checkFaceit}>Profili bul</button><a href="https://www.faceit.com/en/login" target="_blank" rel="noreferrer">FACEIT’te oturum aç <IconExternalLink size={12} style={{ display: "inline-block", verticalAlign: "middle" }} /></a></div>
                <details className="oauth-note"><summary>Tek tık OAuth bağlantısı neden henüz yok?</summary><p>FACEIT Connect için kayıtlı bir OAuth istemcisi, izin ekranı, yönlendirme adresi ve güvenli sunucu tarafı kod değişimi gerekir. Sahte bir “bağlan” butonu yerine şimdilik şifresiz kullanıcı adı akışı kullanılıyor.</p><a href="https://docs.faceit.com/getting-started/authentication/oauth2/" target="_blank" rel="noreferrer">Resmî FACEIT OAuth rehberi <IconExternalLink size={12} style={{ display: "inline-block", verticalAlign: "middle" }} /></a></details>
              </section>
            </div>
            {sourceMessage && <div className="connection-result">{sourceMessage}</div>}
            <hr style={{ margin: "20px 0 14px", borderColor: "rgba(255, 255, 255, 0.08)" }} />
            <p className="eyebrow" style={{ color: "#ff6b6b" }}>UYGULAMAYI KAPAT</p>
            <div style={{ background: "rgba(255, 107, 107, 0.08)", border: "1px solid rgba(255, 107, 107, 0.25)", borderRadius: "10px", padding: "14px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
              <div>
                <b style={{ display: "block", color: "#fff", fontSize: "13px" }}>Tamamen Kapat & CS2 Kaynaklarını Bırak</b>
                <small style={{ color: "#8f96a3", fontSize: "11px" }}>Tüm yerel parser, arka plan Node.js ve tarayıcı işlemlerini sonlandırır.</small>
              </div>
              <button
                className="upload-button"
                onClick={shutdownTracer}
                style={{ background: "#ff5252", borderColor: "#ff5252", color: "#fff", fontWeight: 700, display: "inline-flex", alignItems: "center", gap: "6px" }}
              >
                <IconPower size={14} /> TRACER’ı Kapat
              </button>
            </div>
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

      <LogsModal
        isOpen={logsModalOpen}
        onClose={() => setLogsModalOpen(false)}
      />
    </main>
  );
}
