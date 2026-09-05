"use client";

import { useCallback, useState, useEffect, useMemo, useRef, type FormEvent, type MouseEvent } from "react";
import { filterMatchLibrary, formatMeasuredNumber } from "../../shared/experience.mjs";
import { scanTimeLabel, steamStatusLabel, useSteamStatus, type SteamHealth, type SteamSnapshot } from "../lib/useSteamStatus";
import {
  IconCheck,
  IconSettings,
  IconSparkles,
  IconDownload,
  IconRefresh,
  IconClock,
  IconCalendar,
  IconZap,
  IconGame,
  IconArrowRight,
  IconClose,
  IconLock,
  IconLightbulb,
  IconStar,
  IconCloud,
} from "./NavIcons";
import { MapEmblem, formatMapTitle } from "./MapEmblem";
import { COMPANION_URL } from "../lib/config";
import { useToast } from "./Toast";
import type { PlayerReport } from "../lib/types";

export interface RecentMatchAnalysis {
  reports?: PlayerReport[];
  header?: { map_name?: string };
  analysisVersion?: string;
  timestamp?: number;
}

type MatchPlayerSummary = {
  steamid: string;
  name: string;
  team?: string;
  teamName?: string;
};

export interface ScannedMatchItem {
  id: string;
  source: string;
  mode: string;
  map: string;
  replayUrl: string;
  fileName: string;
  timestamp: number;
  rawDateGmt: string;
  formattedDate: string;
  duration?: string;
  waitTime?: string;
  score: {
    userTeam: string;
    userScore: number;
    enemyScore: number;
    result: "Galibiyet" | "Mağlubiyet" | "Beraberlik";
    isWin: boolean;
    isTie: boolean;
    rawScore: string;
  };
  userStats: {
    name: string;
    steamid: string;
    kills: number;
    deaths: number;
    assists: number;
    kd: number | null;
    hsPercent: number;
    score?: number;
    ping?: number;
    stars?: string;
    counterStrafePercent?: number | null;
    movementEligibilityPercent?: number | null;
    adr?: number;
  };
  players?: MatchPlayerSummary[];
  isDownloaded?: boolean;
  demoAvailable?: boolean;
  demoPath?: string;
  fullAnalysis?: RecentMatchAnalysis;
}

interface RecentMatchesViewProps {
  onSelectAnalysis: (analysis: RecentMatchAnalysis, match?: ScannedMatchItem) => void;
}

type SteamConnection = SteamHealth;

type DownloadQueueState = {
  activeMatchId: string | null;
  activeStartedAt: number;
  queuedMatchIds: string[];
  revision: number;
  items?: Array<{ matchId: string; status: string; message: string }>;
};

type HistoryStorageState = {
  state: "pending" | "optimizing" | "ready" | "error";
  message: string;
};

const EMPTY_DOWNLOAD_QUEUE: DownloadQueueState = {
  activeMatchId: null,
  activeStartedAt: 0,
  queuedMatchIds: [],
  revision: 0,
};


function hasCurrentShotSchema(analysis?: RecentMatchAnalysis): boolean {
  return analysis?.analysisVersion === "3.2.0"
    && Boolean(analysis.reports?.length)
    && analysis.reports!.every((report) => report.sprayStats?.method === "bullet-damage-event-tick-v2");
}

function displayTeamLabel(label: string, index: number) {
  const match = label.match(/^Team\s+(\d+)$/i);
  if (match) return `Takım ${match[1]}`;
  return label || `Takım ${index + 1}`;
}

function matchRosters(match: ScannedMatchItem) {
  const groups = new Map<string, Map<string, string>>();
  const addPlayer = (team: string, steamid: string, name: string) => {
    const label = team.trim();
    const playerName = name.trim();
    if (!label || !playerName) return;
    if (!groups.has(label)) groups.set(label, new Map());
    groups.get(label)?.set(steamid || playerName.toLocaleLowerCase("tr-TR"), playerName);
  };

  for (const player of match.players || []) {
    addPlayer(player.team || player.teamName || "", player.steamid, player.name);
  }

  if (groups.size < 2) {
    groups.clear();
    for (const report of match.fullAnalysis?.reports || []) {
      const firstSide = [...(report.roundPaths || [])]
        .filter((path) => path.side === "CT" || path.side === "T")
        .sort((a, b) => a.round - b.round)[0]?.side;
      if (firstSide) addPlayer(`İlk yarı ${firstSide}`, report.player.steamid, report.player.name);
    }
  }

  return [...groups.entries()].slice(0, 2).map(([label, players], index) => ({
    label: displayTeamLabel(label, index),
    players: [...players.values()].slice(0, 5),
  }));
}

export function RecentMatchesView({ onSelectAnalysis }: RecentMatchesViewProps) {
  const toast = useToast();
  const [downloadedMatches, setDownloadedMatches] = useState<ScannedMatchItem[]>([]);
  const [scannedMatches, setScannedMatches] = useState<ScannedMatchItem[]>([]);
  const [activeTab, setActiveTab] = useState<"all" | "available" | "downloaded">("all");
  const [loading, setLoading] = useState(true);
  const [scanStarting, setScanStarting] = useState(false);
  const { snapshot: steamSnapshot, service: localService, accept: acceptSteamStatus } = useSteamStatus();
  const scanning = scanStarting || Boolean(steamSnapshot?.scan.running);
  const scanRequestBusy = useRef(false);
  const completedScanRef = useRef(0);
  const [search, setSearch] = useState("");
  const [mapFilter, setMapFilter] = useState("all");
  const [resultFilter, setResultFilter] = useState("all");
  const [sort, setSort] = useState("newest");
  const [downloadQueue, setDownloadQueue] = useState<DownloadQueueState>(EMPTY_DOWNLOAD_QUEUE);
  const [downloadElapsed, setDownloadElapsed] = useState(0);
  const [statusMessage, setStatusMessage] = useState("");
  const [savedHasSession, setHasSession] = useState(false);
  const [savedSteamConnection, setSteamConnection] = useState<SteamConnection>({ state: "disconnected", message: "Steam oturumu kaydedilmemiş." });
  const hasSession = steamSnapshot?.hasSession ?? savedHasSession;
  const steamConnection = steamSnapshot?.connection || savedSteamConnection;
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [cookieInput, setCookieInput] = useState("");
  const [sessionidInput, setSessionidInput] = useState("");
  const [savingSettings, setSavingSettings] = useState(false);
  const [selectedMatchLoadingId, setSelectedMatchLoadingId] = useState<string | null>(null);
  const [autoScanEnabled, setAutoScanEnabled] = useState(true);
  const [demoStorage, setDemoStorage] = useState({ demoCount: 0, retentionCount: 5, totalBytes: 0 });
  const [historyStorage, setHistoryStorage] = useState<HistoryStorageState>({ state: "pending", message: "Maç geçmişi hazırlanıyor." });

  const downloadTimerRef = useRef<NodeJS.Timeout | null>(null);
  const downloadQueueRef = useRef<DownloadQueueState>(EMPTY_DOWNLOAD_QUEUE);
  const downloadingId = downloadQueue.activeMatchId;

  // Combine and de-duplicate matches for display
  const allDisplayMatches: ScannedMatchItem[] = useMemo(() => {
    const map = new Map<string, ScannedMatchItem>();

    // 1. Add downloaded matches first (with full analysis data)
    for (const dm of downloadedMatches) {
      map.set(dm.id, { ...dm, isDownloaded: true });
    }

    // 2. Add scanned matches
    for (const sm of scannedMatches) {
      if (map.has(sm.id)) {
        const existing = map.get(sm.id)!;
        map.set(sm.id, {
          ...sm,
          ...existing,
          isDownloaded: true,
          timestamp: sm.timestamp || existing.timestamp,
          formattedDate: sm.formattedDate || existing.formattedDate,
          players: existing.players?.length ? existing.players : sm.players,
        });
      } else {
        map.set(sm.id, { ...sm, isDownloaded: false });
      }
    }

    return Array.from(map.values()).sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
  }, [downloadedMatches, scannedMatches]);

  const filteredMatches = useMemo(() => filterMatchLibrary(allDisplayMatches, { search, map: mapFilter, result: resultFilter, sort, tab: activeTab }), [allDisplayMatches, activeTab, search, mapFilter, resultFilter, sort]);
  const libraryMaps = useMemo(() => [...new Set(allDisplayMatches.map((m) => m.map).filter(Boolean))].sort(), [allDisplayMatches]);
  const filtersActive = Boolean(search || mapFilter !== "all" || resultFilter !== "all");
  const resetFilters = () => { setSearch(""); setMapFilter("all"); setResultFilter("all"); };

  const availableCount = allDisplayMatches.filter((m) => !m.isDownloaded && m.replayUrl).length;
  const analyzedCount = allDisplayMatches.filter((m) => m.isDownloaded).length;
  const visibleStatusMessage = statusMessage || (historyStorage.state === "optimizing" ? historyStorage.message : "");

  const applyDownloadQueue = useCallback((next?: Partial<DownloadQueueState>) => {
    if (!next) return;
    const normalized: DownloadQueueState = {
      activeMatchId: typeof next.activeMatchId === "string" ? next.activeMatchId : null,
      activeStartedAt: Number(next.activeStartedAt) || 0,
      queuedMatchIds: Array.isArray(next.queuedMatchIds) ? next.queuedMatchIds.map(String) : [],
      revision: Number(next.revision) || 0,
      items: Array.isArray(next.items) ? next.items : [],
    };
    downloadQueueRef.current = normalized;
    setDownloadQueue(normalized);
  }, []);

  const fetchMatches = useCallback(async (silent = false) => {
    try {
      if (!silent) setLoading(true);
      const res = await fetch(`${COMPANION_URL}/matches/recent`, { signal: AbortSignal.timeout(2_000) });
      if (res.ok) {
        const data = (await res.json()) as {
          matches?: ScannedMatchItem[];
          scannedMatches?: ScannedMatchItem[];
          hasSession?: boolean;
          session?: { sessionid?: string; autoScanEnabled?: boolean };
          demoStorage?: { demoCount?: number; retentionCount?: number; totalBytes?: number };
          demoRetentionCount?: number;
          connection?: SteamConnection;
          downloadQueue?: DownloadQueueState;
          historyStorage?: HistoryStorageState;
        };
        setDownloadedMatches(data.matches || []);
        if (Array.isArray(data.scannedMatches)) {
          setScannedMatches(data.scannedMatches);
        }
        setHasSession(data.hasSession ?? false);
        setSteamConnection(data.connection || {
          state: data.hasSession ? "unverified" : "disconnected",
          message: data.hasSession ? "Steam bilgileri kayıtlı; bağlantı henüz doğrulanmadı." : "Steam oturumu kaydedilmemiş.",
        });
        applyDownloadQueue(data.downloadQueue);
        setHistoryStorage(data.historyStorage || { state: "ready", message: "Maç geçmişi hazır." });
        setDemoStorage({
          demoCount: Number(data.demoStorage?.demoCount) || 0,
          retentionCount: Number(data.demoRetentionCount || data.demoStorage?.retentionCount) || 5,
          totalBytes: Number(data.demoStorage?.totalBytes) || 0,
        });
        if (data.session?.sessionid) {
          setSessionidInput(data.session.sessionid);
        }
        setAutoScanEnabled(data.session?.autoScanEnabled !== false);
        return true;
      }
    } catch (err) {
      if (!silent) console.warn("Maçlar çekilemedi:", err);
    } finally {
      if (!silent) setLoading(false);
    }
    return false;
  }, [applyDownloadQueue]);

  useEffect(() => {
    let cancelled = false;
    let retryTimer: number | null = null;
    const loadWhenCompanionIsReady = async (attempt = 0) => {
      const loaded = await fetchMatches(attempt > 0);
      if (cancelled || loaded) return;
      // Arayüz parserdan önce açılabilir. Servis geç hazırlanırsa kullanıcıdan
      // yenileme istemeden kısa aralıklarla tekrar bağlan ve verileri getir.
      const delay = Math.min(5_000, 400 * (2 ** Math.min(attempt, 4)));
      retryTimer = window.setTimeout(() => void loadWhenCompanionIsReady(attempt + 1), delay);
    };
    void loadWhenCompanionIsReady();
    return () => {
      cancelled = true;
      if (retryTimer !== null) window.clearTimeout(retryTimer);
    };
  }, [fetchMatches]);

  useEffect(() => {
    if (historyStorage.state !== "optimizing") return;
    const poll = window.setInterval(() => void fetchMatches(true), 1_500);
    return () => window.clearInterval(poll);
  }, [fetchMatches, historyStorage.state]);

  useEffect(() => {
    const queueBusy = Boolean(downloadQueue.activeMatchId || downloadQueue.queuedMatchIds.length);
    if (!queueBusy) return;
    const poll = window.setInterval(() => {
      void (async () => {
        try {
          const response = await fetch(`${COMPANION_URL}/steam/download-queue`, { cache: "no-store", signal: AbortSignal.timeout(2500) });
          if (!response.ok) return;
          const next = await response.json() as DownloadQueueState;
          const previous = downloadQueueRef.current;
          applyDownloadQueue(next);
          if (previous.activeMatchId && previous.activeMatchId !== next.activeMatchId) {
            await fetchMatches(true);
          }
        } catch {
          // Companion kısa süre yeniden başlatılırsa mevcut kuyruk görünümünü koru.
        }
      })();
    }, 1000);
    return () => window.clearInterval(poll);
  }, [applyDownloadQueue, downloadQueue.activeMatchId, downloadQueue.queuedMatchIds.length, fetchMatches]);

  const triggerScan = useCallback(async (isManual = true) => {
    if (scanRequestBusy.current) return;
    scanRequestBusy.current = true;
    try {
      setScanStarting(true);
      const res = await fetch(`${COMPANION_URL}/steam/scan`, {
        method: "POST",
        signal: AbortSignal.timeout(3000),
      });
      if (!res.ok) throw new Error("Yerel tarama servisi yanıt vermedi.");
      setStatusMessage("Tarama arka planda başladı. Beklemeden maçlarını açabilir veya indirme sırasına ekleyebilirsin.");
      acceptSteamStatus(await res.json() as SteamSnapshot);
    } catch (err: unknown) {
      if (isManual) setStatusMessage(`Yerel servise tarama isteği iletilemedi. Çerezi değiştirme; bağlantı durumunu kontrol et. ${err instanceof Error ? err.message : ""}`);
    } finally {
      scanRequestBusy.current = false;
      setScanStarting(false);
    }
  }, [acceptSteamStatus]);

  useEffect(() => {
    if (!steamSnapshot) return;
    if (steamSnapshot.scan.finishedAt && steamSnapshot.scan.finishedAt !== completedScanRef.current) {
      completedScanRef.current = steamSnapshot.scan.finishedAt;
      void fetchMatches(true).then(() => setStatusMessage(steamSnapshot.scan.message));
    }
  }, [steamSnapshot, fetchMatches]);

  // Download & Analysis active elapsed timer
  useEffect(() => {
    if (downloadingId) {
      const updateElapsed = () => setDownloadElapsed(Math.max(0, Math.floor((Date.now() - (downloadQueue.activeStartedAt || Date.now())) / 1000)));
      updateElapsed();
      downloadTimerRef.current = setInterval(() => {
        updateElapsed();
      }, 1000);
    } else {
      if (downloadTimerRef.current) {
        clearInterval(downloadTimerRef.current);
        downloadTimerRef.current = null;
      }
    }
    return () => {
      if (downloadTimerRef.current) {
        clearInterval(downloadTimerRef.current);
      }
    };
  }, [downloadingId, downloadQueue.activeStartedAt]);

  const formatSeconds = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m}:${s < 10 ? "0" : ""}${s}`;
  };

  const handleDownloadMatch = async (e: MouseEvent, match: ScannedMatchItem) => {
    e.stopPropagation();
    try {
      const isActive = downloadQueue.activeMatchId === match.id;
      const isQueued = downloadQueue.queuedMatchIds.includes(match.id);
      setStatusMessage(isActive
        ? `de_${match.map} için etkin indirme ve analiz durduruluyor...`
        : isQueued
          ? `de_${match.map} indirme sırasından çıkarılıyor...`
          : `[${match.mode || "CS2"}] de_${match.map} sıralı indirme ve analiz kuyruğuna ekleniyor...`);

      const res = await fetch(`${COMPANION_URL}/steam/download-queue`, {
        method: "POST",
        signal: AbortSignal.timeout(5000),
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          matchId: match.id,
          replayUrl: match.replayUrl,
          matchMeta: match,
        }),
      });

      const data = (await res.json()) as {
        ok?: boolean;
        action?: "queued" | "cancelled" | "cancelling" | "unchanged";
        error?: string;
      } & DownloadQueueState;
      if (data.ok) {
        applyDownloadQueue(data);
        const queueIndex = data.queuedMatchIds?.indexOf(match.id) ?? -1;
        const aheadCount = Math.max(0, queueIndex) + (data.activeMatchId && data.activeMatchId !== match.id ? 1 : 0);
        setStatusMessage(data.action === "queued"
          ? `de_${match.map} sıraya eklendi. ${data.activeMatchId === match.id ? "İndirme başladı." : `Önünde ${aheadCount} maç var.`}`
          : data.action === "cancelling"
            ? `de_${match.map} durduruluyor; yarım dosya temizlenecek.`
            : data.action === "cancelled"
              ? `de_${match.map} indirme sırasından çıkarıldı.`
              : "İndirme sırası değişmedi.");
      } else {
        toast.error(`İndirme sırası güncellenemedi: ${data.error || "Bilinmeyen hata"}`);
        setStatusMessage(`Hata: ${data.error || "Bilinmeyen hata"}`);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error(`İndirme sırasında hata oluştu: ${message}`);
      setStatusMessage(`Hata: ${message}`);
    } finally {
      setTimeout(() => setStatusMessage(""), 7000);
    }
  };

  const handleSaveSession = async (e: FormEvent) => {
    e.preventDefault();
    setSavingSettings(true);
    try {
      const newCookie = cookieInput.trim();
      if (!hasSession && !newCookie) {
        throw new Error("İlk bağlantı için steamLoginSecure çerezini girin.");
      }
      const sessionUpdate: {
        steamLoginSecure?: string;
        sessionid?: string;
        autoScanEnabled: boolean;
      } = {
        autoScanEnabled,
      };
      // Alan boşsa kayıtlı çerezi koru. Böylece otomatik tarama ayarı veya
      // sessionid değiştirilirken kullanıcıdan gereksiz yere yeni çerez istenmez.
      if (newCookie) sessionUpdate.steamLoginSecure = newCookie;
      if (sessionidInput.trim()) sessionUpdate.sessionid = sessionidInput.trim();
      const res = await fetch(`${COMPANION_URL}/steam/session`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sessionUpdate),
        // Bu uç nokta yalnız yerel diske küçük bir JSON yazar. Uzak Steam
        // taraması bu kaydetme işleminin parçası değildir ve arayüzü kilitlemez.
        signal: AbortSignal.timeout(8_000),
      });
      const data = await res.json() as { error?: string; connection?: SteamConnection };
      if (!res.ok) {
        throw new Error(data.error || "Steam bilgileri kaydedilemedi.");
      }
      setHasSession(true);
      setSteamConnection(data.connection || { state: "unverified", message: "Steam bilgileri kaydedildi; bağlantı doğrulanıyor." });
      setSettingsOpen(false);
      setCookieInput("");
      setStatusMessage("Steam bilgileri kaydedildi. Kayıtlı maçlar kullanılabilir; yeni tarama arka planda başladı.");
      // Kaydet düğmesi yalnız yerel kaydı bekler. Steam Community yavaş veya
      // erişilemez olsa bile modal kapanır ve kullanıcı uygulamayı kullanır.
      void triggerScan(false);
    } catch (err: unknown) {
      const timedOut = err instanceof DOMException && (err.name === "TimeoutError" || err.name === "AbortError");
      toast.error(timedOut
        ? "Oturum yerel servise kaydedilemedi. TRACER’ı bir kez kapatıp yeniden açın; Steam çereziniz bu hatanın nedeni değildir."
        : `Oturum kaydedilemedi: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSavingSettings(false);
    }
  };

  const handleSelectMatch = async (match: ScannedMatchItem) => {
    if (!match.isDownloaded) return;

    if (match.fullAnalysis && hasCurrentShotSchema(match.fullAnalysis)) {
      onSelectAnalysis(match.fullAnalysis, match);
      return;
    }

    try {
      setSelectedMatchLoadingId(match.id);
      const res = await fetch(`${COMPANION_URL}/matches/detail/${match.id}`);
      if (res.ok) {
        const data = (await res.json()) as {
          analysis?: RecentMatchAnalysis;
          match?: ScannedMatchItem;
          reanalyzed?: boolean;
          needsReanalysis?: boolean;
          reanalysisError?: string;
        };
        if (data.analysis) {
          onSelectAnalysis(data.analysis, data.match || match);
          if (data.match) {
            setDownloadedMatches((current) => current.map((item) => item.id === data.match?.id ? data.match : item));
          }
          if (data.reanalyzed) {
            toast.success("Eski maç ham demo dosyasından güncel yöntemle yeniden analiz edildi.");
          } else if (data.needsReanalysis && data.reanalysisError) {
            toast.error(data.reanalysisError);
          }
        }
      }
    } catch (err: unknown) {
      toast.error(`Maç analizi açılamadı: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSelectedMatchLoadingId(null);
    }
  };

  const handleDeleteMatch = async (e: MouseEvent, match: ScannedMatchItem) => {
    e.stopPropagation();
    const hasRawDemo = match.demoAvailable !== false;
    const prompt = hasRawDemo
      ? "Bu maçın ham demo dosyasını ve korunmuş analizini silmek istediğinize emin misiniz?"
      : "Bu maçın korunmuş analiz kaydını silmek istediğinize emin misiniz? Ham demo daha önce depolama kotası gereği temizlenmiş."
    if (!(await toast.confirm(prompt))) return;
    try {
      const res = await fetch(`${COMPANION_URL}/matches/${match.id}`, { method: "DELETE" });
      if (res.ok) {
        const data = (await res.json()) as {
          matches?: ScannedMatchItem[];
          scannedMatches?: ScannedMatchItem[];
          demoStorage?: { demoCount?: number; retentionCount?: number; totalBytes?: number };
        };
        setDownloadedMatches(data.matches || []);
        setScannedMatches(data.scannedMatches || []);
        setDemoStorage({
          demoCount: Number(data.demoStorage?.demoCount) || 0,
          retentionCount: Number(data.demoStorage?.retentionCount) || demoStorage.retentionCount,
          totalBytes: Number(data.demoStorage?.totalBytes) || 0,
        });
        toast.success("Maç kaydı silindi.");
      }
    } catch (err) {
      console.error("Maç silinemedi:", err);
    }
  };

  return (
    <section className="workspace recent-matches-container">
      {/* Header */}
      <header className="recent-matches-header">
        <div>
          <div className="recent-badge-row">
            <span className="sync-chip-badge">
              <IconClock size={12} style={{ marginRight: "4px", display: "inline-block", verticalAlign: "middle" }} />
              KİŞİSEL MAÇ KÜTÜPHANESİ
            </span>
            {hasSession ? (
              <span
                className={`account-chip ${steamConnection.state === "connected" ? "connected" : steamConnection.state === "expired" || steamConnection.state === "error" ? "warning" : steamConnection.state === "unverified" ? "pending" : "idle"}`}
                title={steamConnection.message}
              >
                <span className="chip-dot" />
                {localService === "offline" ? "YEREL SERVİS ÇEVRİMDIŞI" : steamStatusLabel(steamConnection)}
              </span>
            ) : (
              <span className="account-chip idle" title="Steam Oturumu Bağlanmadı">
                <span className="chip-dot" /> STEAM OTURUMU GEREKLİ
              </span>
            )}
          </div>
          <h1 className="recent-title">Son Maçlarım</h1>
          <p className="recent-subtitle">
            Maçını bul, indirme sırasına ekle ve katkını incele. Steam’e ulaşılamasa da kayıtlı analizlerin burada kalır.
          </p>
        </div>

        <div className="recent-actions-row">
          {hasSession && (
            <div className="auto-scan-status-widget" title="Otomatik tarama yalnız yerel servis tarafından yönetilir; yeni sekmeler fazladan tarama başlatmaz.">
              {autoScanEnabled && <span className="scan-dot-pulse" />}
              <span className="scan-timer-text">
                Otomatik tarama: <b>{autoScanEnabled ? "5 dakikada bir" : "Kapalı"}</b>
              </span>
            </div>
          )}

          <button
            className={`sync-refresh-btn ${scanning ? "loading" : ""}`}
            onClick={() => hasSession ? void triggerScan(true) : setSettingsOpen(true)}
            disabled={scanning}
            title="Steam'den tüm modlardaki yeni maçlarınızı tarayın"
          >
            <IconRefresh size={14} className={scanning ? "spin-icon" : ""} />
            <span>{scanning ? "Taranıyor..." : "Şimdi Tara"}</span>
          </button>

          <button
            className="settings-toggle-btn"
            onClick={() => setSettingsOpen(true)}
            title="Steam Oturum Ayarları"
          >
            <IconSettings size={14} style={{ marginRight: "6px", display: "inline-block", verticalAlign: "middle" }} />
            Steam Bağlantısı
          </button>
        </div>
      </header>

      <div className={`library-connection-strip ${localService === "offline" ? "warning" : steamConnection.state}`} role="status">
        <span className="connection-indicator" />
        <div><b>{localService === "offline" ? "Yerel servis yeniden bekleniyor" : scanning ? "Steam arka planda taranıyor" : steamStatusLabel(steamConnection)}</b><p>{localService === "offline" ? "Bu bir Steam oturum hatası değil. Bağlantı otomatik yeniden denenecek; ekrandaki kayıtlar korunuyor." : scanning ? "Bu sayfada kalmak zorunda değilsin. Sonuçlar hazır olunca geçmişin yenilenecek." : steamConnection.message}</p></div>
        <small>Son başarılı tarama<br /><b>{scanTimeLabel(steamConnection.lastSuccessAt)}</b></small>
      </div>

      {/* Tabs Row */}
      <div className="recent-tabs-row">
        <button
          className={`recent-tab-btn ${activeTab === "all" ? "active" : ""}`}
          onClick={() => setActiveTab("all")}
        >
          <IconGame size={14} style={{ marginRight: "6px", display: "inline-block", verticalAlign: "middle" }} />
          Tüm Maçlar ({allDisplayMatches.length})
        </button>
        <button
          className={`recent-tab-btn ${activeTab === "downloaded" ? "active" : ""}`}
          onClick={() => setActiveTab("downloaded")}
        >
          <IconCheck size={14} style={{ marginRight: "6px", display: "inline-block", verticalAlign: "middle" }} />
          Analizi Hazır ({analyzedCount})
        </button>
        <button
          className={`recent-tab-btn ${activeTab === "available" ? "active" : ""}`}
          onClick={() => setActiveTab("available")}
        >
          <IconDownload size={14} style={{ marginRight: "6px", display: "inline-block", verticalAlign: "middle" }} />
          İndirilebilir Yeni Maçlar ({availableCount})
        </button>
        <span className="raw-demo-quota" title="Bu sayaç yalnızca diskte yer kaplayan ham .dem dosyalarını gösterir; analiz kayıtları kotadan bağımsız korunur.">
          HAM DEMO: <b>{demoStorage.demoCount}/{demoStorage.retentionCount}</b>
        </span>
      </div>

      <div className="library-filters" role="search" aria-label="Maç kütüphanesinde ara">
        <label className="library-search"><span>MAÇ ARA</span><input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Harita, oyuncu veya tarih…" /></label>
        <label><span>HARİTA</span><select value={mapFilter} onChange={(e) => setMapFilter(e.target.value)}><option value="all">Tüm haritalar</option>{libraryMaps.map((map) => <option key={map} value={map}>{formatMapTitle(map)}</option>)}</select></label>
        <label><span>SONUÇ</span><select value={resultFilter} onChange={(e) => setResultFilter(e.target.value)}><option value="all">Tüm sonuçlar</option><option value="win">Galibiyet</option><option value="loss">Mağlubiyet</option><option value="tie">Beraberlik</option></select></label>
        <label><span>SIRALAMA</span><select value={sort} onChange={(e) => setSort(e.target.value)}><option value="newest">En yeni önce</option><option value="oldest">En eski önce</option></select></label>
        {filtersActive && <button onClick={resetFilters}>Temizle</button>}
      </div>
      <div className="library-result-count"><span><b>{filteredMatches.length}</b> maç gösteriliyor</span><span>İstediğin kadar maçı sıraya ekle · tekrar tıklayarak iptal et</span></div>

      {(downloadQueue.activeMatchId || downloadQueue.queuedMatchIds.length > 0) && <div className="library-queue" role="status"><IconDownload size={18} /><div><b>{downloadQueue.activeMatchId ? `${formatMapTitle(allDisplayMatches.find((m) => m.id === downloadQueue.activeMatchId)?.map || "CS2")} · ${downloadQueue.items?.find((item) => item.matchId === downloadQueue.activeMatchId)?.status === "analyzing" ? "Analiz ediliyor" : "İndiriliyor"}` : "Sıra hazırlanıyor"}</b><span>{downloadQueue.queuedMatchIds.length} maç sırada · işlemler tek tek yürütülür</span></div><small>{formatSeconds(downloadElapsed)}</small></div>}

      {/* Alert / Status Bar */}
      {visibleStatusMessage && (
        <div className="sync-status-alert">
          <IconSparkles size={16} />
          <span>{visibleStatusMessage}</span>
          {downloadingId && (
            <span className="live-download-counter-badge">
              <IconClock size={13} /> Sayaç: {formatSeconds(downloadElapsed)}
            </span>
          )}
          {downloadQueue.queuedMatchIds.length > 0 && (
            <span className="live-download-counter-badge">Sırada: {downloadQueue.queuedMatchIds.length} maç</span>
          )}
        </div>
      )}

      {/* Content Area */}
      {loading ? (
        <div className="recent-loading-box">
          <div className="spinner-icon large">
            <IconRefresh size={32} />
          </div>
          <p>Maç kayıtları yükleniyor...</p>
        </div>
      ) : filteredMatches.length === 0 ? (
        <div className="recent-empty-state">
          <div className="empty-icon">
            <IconGame size={44} color="var(--acid)" />
          </div>
          <h3>
            {filtersActive ? "Bu filtrelerle eşleşen maç yok" : activeTab === "downloaded"
              ? "Henüz İndirilmiş Maç Yok"
              : activeTab === "available"
              ? "Tüm Taranan Maçlar Zaten İndirilmiş"
              : "Henüz Maç Bulunamadı"}
          </h3>
          <p>
            {filtersActive ? "Farklı bir oyuncu, harita veya sonuç dene. Filtreler hiçbir kaydı silmez." : hasSession
              ? "Steam bilgilerin kayıtlı. 'Şimdi Tara' ile geçmişi kontrol edebilirsin; bağlantı durumunu yukarıda görebilirsin."
              : "Steam'den maçlarınızı taramak ve tek tıkla indirmek için sağ üstteki 'Steam Bağlantısı' butonundan oturumunuzu bağlayın."}
          </p>
          <div className="empty-actions">
            {filtersActive ? <button className="primary-btn" onClick={resetFilters}>Filtreleri temizle</button> : hasSession ? (
              <button className="primary-btn" onClick={() => triggerScan(true)} disabled={scanning}>
                <IconZap size={14} style={{ marginRight: "6px" }} /> Maçlarımı Şimdi Tara
              </button>
            ) : (
              <button className="primary-btn" onClick={() => setSettingsOpen(true)}>
                <IconSettings size={14} style={{ marginRight: "6px" }} /> Steam Oturumunu Bağla
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="recent-matches-grid">
          {filteredMatches.map((match) => {
            const isWin = match.score.isWin;
            const isTie = match.score.isTie;
            const cardClass = isTie ? "tie" : isWin ? "win" : "loss";
            const isDownloaded = Boolean(match.isDownloaded);
            const isDownloadingThis = downloadingId === match.id;
            const queueIndex = downloadQueue.queuedMatchIds.indexOf(match.id);
            const isQueuedThis = queueIndex >= 0;
            const downloadStatus = downloadQueue.items?.find((item) => item.matchId === match.id)?.status;
            const isLoadingAnalysisThis = selectedMatchLoadingId === match.id;
            const teamRosters = matchRosters(match);

            return (
              <div
                key={match.id}
                className={`match-card ${cardClass} ${isDownloaded ? "downloaded" : "not-downloaded"}`}
                onClick={() => {
                  if (isDownloaded) handleSelectMatch(match);
                }}
                role={isDownloaded ? "button" : undefined}
                tabIndex={isDownloaded ? 0 : undefined}
                onKeyDown={(event) => {
                  if (!isDownloaded || event.target !== event.currentTarget) return;
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    void handleSelectMatch(match);
                  }
                }}
                style={{ cursor: isDownloaded ? "pointer" : "default" }}
                title={isDownloaded ? "Detaylı 3D analiz raporunu açmak için tıklayın" : "İndirmek için aşağıdaki butona basın"}
              >
                {/* Top Row: Tactical Map Emblem & Result */}
                <div className="match-card-top">
                  <div className="match-map-info">
                    <MapEmblem mapName={match.map} size={46} showBorder={true} />
                    <div>
                      <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                        <h4 className="match-map-name">{formatMapTitle(match.map)}</h4>
                        <span className="mode-pill-badge">{match.mode || "CS2"}</span>
                      </div>
                      <span className="match-date-badge" title={`Gerçek Maç Saati: ${match.rawDateGmt || match.formattedDate}`}>
                        <IconCalendar size={11} style={{ marginRight: "3px", display: "inline-block", verticalAlign: "middle" }} />
                        {match.formattedDate}
                        {match.duration ? ` · ${match.duration}` : ""}
                      </span>
                    </div>
                  </div>

                  <div className="match-result-badge-col">
                    <span className={`result-tag ${cardClass}`}>
                      {match.score.result.toUpperCase()}
                    </span>
                    <span className="match-score-text">{match.score.rawScore}</span>
                  </div>
                </div>

                {/* Source & Actions */}
                <div className="match-source-row">
                  <span className={`source-pill ${isDownloaded ? (match.demoAvailable === false ? "raw-cleaned" : "raw-stored") : ""}`}>
                    {isDownloaded ? (
                      <>
                        <IconCheck size={11} style={{ marginRight: "4px" }} />
                        {match.demoAvailable === false ? "ANALİZ HAZIR · HAM DEMO TEMİZLENDİ" : "ANALİZ HAZIR · HAM DEMO SAKLI"}
                      </>
                    ) : (
                      <>
                        <IconCloud size={11} style={{ marginRight: "4px" }} />
                        VALVE SUNUCUSU
                      </>
                    )}
                  </span>
                  {isDownloaded && (
                    <button
                      className="delete-match-btn"
                      onClick={(e) => handleDeleteMatch(e, match)}
                      title={match.demoAvailable === false ? "Korunmuş analiz kaydını sil" : "Ham demo dosyasını ve analiz kaydını sil"}
                    >
                      <IconClose size={13} />
                    </button>
                  )}
                </div>

                {teamRosters.length > 0 && (
                  <div className="match-rosters" aria-label="Maçtaki iki takımın oyuncuları">
                    {teamRosters.map((team, index) => (
                      <div className={`match-roster-team team-${index + 1}`} key={team.label}>
                        <strong>{team.label}</strong>
                        <div>{team.players.map((player) => <span key={player} title={player}>{player}</span>)}</div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Player Stats Grid */}
                <div className="match-stats-grid">
                  <div className="stat-box">
                    <span className="stat-label">K/D</span>
                    <span className="stat-val">
                      {formatMeasuredNumber(match.userStats.kd, 2)}
                    </span>
                  </div>

                  <div className="stat-box">
                    <span className="stat-label">K / D / A</span>
                    <span className="stat-val">
                      {match.userStats.kills}/{match.userStats.deaths}/{match.userStats.assists}
                    </span>
                  </div>

                  <div className="stat-box">
                    <span className="stat-label">KAFA (HS)</span>
                    <span className="stat-val">
                      {typeof match.userStats.hsPercent === "number" && Number.isFinite(match.userStats.hsPercent) ? `%${formatMeasuredNumber(match.userStats.hsPercent)}` : "—"}
                    </span>
                  </div>

                  {isDownloaded && Number.isFinite(match.userStats.movementEligibilityPercent ?? match.userStats.counterStrafePercent) ? (
                    <div className="stat-box">
                      <span className="stat-label" title="Atış tick'inde hızın silah max_speed değerinin %34 sınırında veya altında olduğu atışların payı; tuş girdisini ölçmez.">ATIŞ HIZI</span>
                      <span className="stat-val">
                        %{match.userStats.movementEligibilityPercent ?? match.userStats.counterStrafePercent}
                      </span>
                    </div>
                  ) : match.userStats.ping ? (
                    <div className="stat-box">
                      <span className="stat-label">PING</span>
                      <span className="stat-val mid">
                        {match.userStats.ping}ms
                      </span>
                    </div>
                  ) : (
                    <div className="stat-box">
                      <span className="stat-label">SKOR</span>
                      <span className="stat-val good">
                        {match.userStats.score || 0}
                      </span>
                    </div>
                  )}

                  {isDownloaded && typeof match.userStats.adr === "number" && Number.isFinite(match.userStats.adr) ? (
                    <div className="stat-box">
                      <span className="stat-label">ADR</span>
                      <span className={`stat-val ${match.userStats.adr >= 130 ? "good" : "mid"}`}>
                        {Math.round(match.userStats.adr)}
                      </span>
                    </div>
                  ) : (
                    <div className="stat-box">
                      <span className="stat-label">YILDIZ</span>
                      <span className="stat-val good" style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "2px" }}>
                        {match.userStats.stars && match.userStats.stars.includes("★") ? (
                          <>
                            <IconStar size={11} color="#f4c666" />
                            {match.userStats.stars.replace("★", "") || "1"}
                          </>
                        ) : (
                          "—"
                        )}
                      </span>
                    </div>
                  )}
                </div>

                {/* Card Action Trigger */}
                {isDownloaded ? (
                  <div className="match-open-trigger">
                    <span>
                      {isLoadingAnalysisThis ? (
                        <>
                          <IconRefresh size={13} className="spin-icon" style={{ marginRight: "6px" }} />
                          Analiz Yükleniyor...
                        </>
                      ) : (
                        <>
                          <IconZap size={13} style={{ marginRight: "6px" }} />
                          Detaylı Analiz Raporunu Aç
                        </>
                      )}
                    </span>
                    <IconArrowRight size={14} className="arrow-icon" />
                  </div>
                ) : (
                  <button
                    className={`match-download-btn ${isDownloadingThis ? "downloading" : ""} ${isQueuedThis ? "queued" : ""}`}
                    onClick={(e) => handleDownloadMatch(e, match)}
                    aria-pressed={isDownloadingThis || isQueuedThis}
                    disabled={!match.replayUrl && !isDownloadingThis && !isQueuedThis}
                    title={isDownloadingThis || isQueuedThis ? "Bir kez daha tıklayarak iptal et" : "Maçı sıralı indirme ve analiz kuyruğuna ekle"}
                  >
                    {isDownloadingThis ? (
                      <div className="download-active-state">
                        <IconRefresh size={14} className="spin-icon" />
                        <span>
                          {downloadStatus === "analyzing"
                            ? `Analiz Ediliyor · İptal Et (${formatSeconds(downloadElapsed)})`
                            : downloadStatus === "cancelling"
                              ? `Durduruluyor (${formatSeconds(downloadElapsed)})`
                              : `Demo İndiriliyor · İptal Et (${formatSeconds(downloadElapsed)})`}
                        </span>
                      </div>
                    ) : isQueuedThis ? (
                      <>
                        <IconClock size={14} />
                        <span>Sırada #{queueIndex + 1} · İptal Et</span>
                      </>
                    ) : (
                      <>
                        <IconDownload size={14} />
                        <span>{match.replayUrl ? "Sıraya Ekle & Analiz Et" : "Steam replay bağlantısı yok"}</span>
                      </>
                    )}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Steam Settings Modal */}
      {settingsOpen && (
        <div className="settings-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSettingsOpen(false); }}>
          <div className="settings-modal-card" role="dialog" aria-modal="true" aria-labelledby="steam-settings-title">
            <div className="modal-head">
              <h3 id="steam-settings-title">
                <IconSettings size={18} style={{ marginRight: "8px", verticalAlign: "middle" }} />
                Steam Maç Geçmişi Bağlantısı
              </h3>
              <button type="button" className="close-modal-btn" onClick={() => setSettingsOpen(false)} aria-label="Steam bağlantı ayarlarını kapat">
                <IconClose size={16} />
              </button>
            </div>

            <form onSubmit={handleSaveSession} className="settings-form">
              <div className="form-section">
                <h4>
                  <IconLock size={15} style={{ marginRight: "6px", verticalAlign: "middle" }} />
                  Steam Maç Geçmişini Bağlama (1 Dakika)
                </h4>
                <p className="form-tip">
                  Premier, Ranked Rekabetçi, Rekabetçi ve Yoldaş geçmişinizin tamamını tarayabilmek için tarayıcınızdaki iki Steam oturum değerini girin. Şifreniz istenmez ve kaydedilmez.
                </p>

                <p className="form-tip" style={{ borderColor: "rgba(96,165,250,.35)", color: "#bfdbfe" }}>
                  Buraya Steam Web API key değil, tarayıcı çerezi girilir. Yeni API key oluşturmak bu bağlantıyı düzeltmez; Son Maçlarım doğrudan Steam Community maç geçmişini okur.
                </p>

                <div className="form-group">
                  <label htmlFor="steam-login-secure">
                    steamLoginSecure Çerezi{hasSession ? " (Kayıtlı · yalnız yenilemek için girin)" : ""}:
                  </label>
                  <input
                    id="steam-login-secure"
                    type="password"
                    placeholder={hasSession ? "Kayıtlı çerez korunacak" : "Çerez değeri veya tam Cookie satırı"}
                    value={cookieInput}
                    onChange={(e) => setCookieInput(e.target.value)}
                    required={!hasSession}
                  />
                </div>

                <div className="form-group">
                  <label htmlFor="steam-session-id">sessionid Çerezi (tam Cookie satırı yapıştırırsanız otomatik alınır):</label>
                  <input
                    id="steam-session-id"
                    type="text"
                    placeholder="Örn: 1a2b3c4d5e6f..."
                    value={sessionidInput}
                    onChange={(e) => setSessionidInput(e.target.value)}
                  />
                </div>

                <div className="form-group checkbox-row" style={{ marginTop: "10px", display: "flex", alignItems: "center", gap: "8px" }}>
                  <input
                    type="checkbox"
                    id="autoScanToggle"
                    checked={autoScanEnabled}
                    onChange={(e) => setAutoScanEnabled(e.target.checked)}
                  />
                  <label htmlFor="autoScanToggle" style={{ fontSize: "12.5px", color: "#e2e8f0", cursor: "pointer", fontWeight: 600 }}>
                    Her 5 dakikada bir otomatik arka plan taraması yap
                  </label>
                </div>

                <div style={{ marginTop: "12px", background: "rgba(255,255,255,0.03)", padding: "10px", borderRadius: "6px", fontSize: "11.5px", color: "#94a3b8", lineHeight: "1.5" }}>
                  <IconLightbulb size={13} style={{ marginRight: "4px", verticalAlign: "middle", color: "#f4c666" }} />
                  <b>Çerezi Nasıl Alırsınız?</b><br />
                  1. Chrome veya Edge’de <a href="https://steamcommunity.com/my/gcpd/730/?tab=matchhistorypremier" target="_blank" rel="noreferrer" style={{ color: "#60a5fa" }}>Steam Maç Geçmişi</a> sayfasına gidin.<br />
                  2. Klavyeden <b>F12</b> (Geliştirici Araçları) basın - <b>Application (Uygulama)</b> sekmesine geçin.<br />
                  3. Soldan <b>Cookies - steamcommunity.com</b> seçin; <b>steamLoginSecure</b> ve <b>sessionid</b> değerlerini ilgili alanlara kopyalayın. İsterseniz Network bölümündeki bir Steam isteğinin tam <b>Cookie</b> başlığını ilk alana tek seferde yapıştırabilirsiniz.<br />
                  4. Çerez zaten kayıtlıysa bu alanı boş bırakabilirsiniz; mevcut değer silinmez. Yalnız “oturum süresi doldu” uyarısında yenileyin.<br />
                  5. Önce bağlantıdaki sayfada maçlarınızı görebildiğinizi doğrulayın. Sayfa tarayıcıda da açılmıyorsa sorun çerez değil; Steam erişimi, VPN/DNS veya güvenlik duvarıdır.
                </div>
              </div>

              <div className="modal-foot">
                <button type="button" className="ghost-btn" onClick={() => setSettingsOpen(false)}>
                  İptal
                </button>
                <button type="submit" className="primary-btn" disabled={savingSettings}>
                  {savingSettings ? "Kaydediliyor..." : "Kaydet · Arka Planda Tara"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </section>
  );
}
