"use client";

import { useState, useEffect, useMemo, useRef, type FormEvent, type MouseEvent } from "react";
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
    adr?: number;
  };
  players?: MatchPlayerSummary[];
  isDownloaded?: boolean;
  demoAvailable?: boolean;
  demoPath?: string;
  fullAnalysis?: RecentMatchAnalysis;
}

interface RecentMatchesViewProps {
  onSelectAnalysis: (analysis: RecentMatchAnalysis) => void;
}

const AUTO_SCAN_INTERVAL = 300; // 5 minutes in seconds

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
  const [scanning, setScanning] = useState(false);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [downloadElapsed, setDownloadElapsed] = useState(0);
  const [statusMessage, setStatusMessage] = useState("");
  const [hasSession, setHasSession] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [cookieInput, setCookieInput] = useState("");
  const [sessionidInput, setSessionidInput] = useState("");
  const [savingSettings, setSavingSettings] = useState(false);
  const [selectedMatchLoadingId, setSelectedMatchLoadingId] = useState<string | null>(null);
  const [countdown, setCountdown] = useState(AUTO_SCAN_INTERVAL);
  const [autoScanEnabled, setAutoScanEnabled] = useState(true);
  const [demoStorage, setDemoStorage] = useState({ demoCount: 0, retentionCount: 5, totalBytes: 0 });

  const downloadTimerRef = useRef<NodeJS.Timeout | null>(null);

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
        });
      } else {
        map.set(sm.id, { ...sm, isDownloaded: false });
      }
    }

    return Array.from(map.values()).sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
  }, [downloadedMatches, scannedMatches]);

  const filteredMatches = useMemo(() => {
    if (activeTab === "downloaded") return allDisplayMatches.filter((m) => m.isDownloaded);
    if (activeTab === "available") return allDisplayMatches.filter((m) => !m.isDownloaded);
    return allDisplayMatches;
  }, [allDisplayMatches, activeTab]);

  const availableCount = allDisplayMatches.filter((m) => !m.isDownloaded).length;
  const analyzedCount = allDisplayMatches.filter((m) => m.isDownloaded).length;

  const fetchMatches = async () => {
    try {
      setLoading(true);
      const res = await fetch(`${COMPANION_URL}/matches/recent`);
      if (res.ok) {
        const data = (await res.json()) as {
          matches?: ScannedMatchItem[];
          scannedMatches?: ScannedMatchItem[];
          hasSession?: boolean;
          session?: { sessionid?: string };
          demoStorage?: { demoCount?: number; retentionCount?: number; totalBytes?: number };
          demoRetentionCount?: number;
        };
        setDownloadedMatches(data.matches || []);
        if (Array.isArray(data.scannedMatches)) {
          setScannedMatches(data.scannedMatches);
        }
        setHasSession(data.hasSession ?? false);
        setDemoStorage({
          demoCount: Number(data.demoStorage?.demoCount) || 0,
          retentionCount: Number(data.demoRetentionCount || data.demoStorage?.retentionCount) || 5,
          totalBytes: Number(data.demoStorage?.totalBytes) || 0,
        });
        if (data.session?.sessionid) {
          setSessionidInput(data.session.sessionid);
        }
      }
    } catch (err) {
      console.warn("Maçlar çekilemedi:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const initialFetch = window.setTimeout(() => void fetchMatches(), 0);
    return () => window.clearTimeout(initialFetch);
  }, []);

  // 5-minute Auto-Scan Countdown Timer
  useEffect(() => {
    if (!hasSession || !autoScanEnabled) return;

    const timer = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      setCountdown((prev) => {
        if (prev <= 1) {
          void triggerScan(false);
          return AUTO_SCAN_INTERVAL;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [hasSession, autoScanEnabled]);

  // Download & Analysis active elapsed timer
  useEffect(() => {
    if (downloadingId) {
      downloadTimerRef.current = setInterval(() => {
        setDownloadElapsed((prev) => prev + 1);
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
  }, [downloadingId]);

  const formatSeconds = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m}:${s < 10 ? "0" : ""}${s}`;
  };

  const triggerScan = async (isManual = true) => {
    try {
      setScanning(true);
      if (isManual) {
        setStatusMessage("Steam maç geçmişiniz (Ranked, Premier, Rekabetçi, Yoldaş) taranıyor...");
      }
      const res = await fetch(`${COMPANION_URL}/steam/scan-now`, { method: "POST" });
      const data = (await res.json()) as {
        ok?: boolean;
        scannedMatches?: ScannedMatchItem[];
        downloadedMatches?: ScannedMatchItem[];
        message?: string;
        requiresLogin?: boolean;
      };
      if (data.ok) {
        if (Array.isArray(data.scannedMatches)) {
          setScannedMatches(data.scannedMatches);
        }
        if (Array.isArray(data.downloadedMatches)) {
          setDownloadedMatches(data.downloadedMatches);
        }
        setStatusMessage(data.message || "Tarama tamamlandı.");
        setCountdown(AUTO_SCAN_INTERVAL);
      } else {
        if (data.requiresLogin && isManual) {
          setSettingsOpen(true);
        }
        setStatusMessage(data.message || "Tarama başarısız.");
      }
    } catch (err: unknown) {
      if (isManual) setStatusMessage(`Tarama hatası: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setScanning(false);
      setTimeout(() => setStatusMessage(""), 7000);
    }
  };

  const handleDownloadMatch = async (e: MouseEvent, match: ScannedMatchItem) => {
    e.stopPropagation();
    try {
      setDownloadElapsed(0);
      setDownloadingId(match.id);
      setStatusMessage(`[${match.mode || "CS2"}] de_${match.map} maçı indiriliyor ve Valve CS2 motoruyla analiz ediliyor...`);

      const res = await fetch(`${COMPANION_URL}/steam/download-match`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          matchId: match.id,
          replayUrl: match.replayUrl,
          matchMeta: match,
        }),
      });

      const data = (await res.json()) as {
        ok?: boolean;
        matches?: ScannedMatchItem[];
        scannedMatches?: ScannedMatchItem[];
        match?: { fullAnalysis?: RecentMatchAnalysis };
        demoStorage?: { demoCount?: number; retentionCount?: number; totalBytes?: number };
        message?: string;
        error?: string;
      };
      if (data.ok) {
        setStatusMessage(`de_${match.map} maçı başarıyla indirildi ve analiz edildi! Raporu açabilirsiniz.`);
        if (Array.isArray(data.matches)) {
          setDownloadedMatches(data.matches);
        }
        if (Array.isArray(data.scannedMatches)) {
          setScannedMatches(data.scannedMatches);
        }
        if (data.match?.fullAnalysis) {
          onSelectAnalysis(data.match.fullAnalysis);
        }
        if (data.demoStorage) {
          setDemoStorage({
            demoCount: Number(data.demoStorage.demoCount) || 0,
            retentionCount: Number(data.demoStorage.retentionCount) || 5,
            totalBytes: Number(data.demoStorage.totalBytes) || 0,
          });
        }
      } else {
        toast.error(`İndirme başarısız: ${data.message || data.error}`);
        setStatusMessage(`Hata: ${data.message || data.error}`);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error(`İndirme sırasında hata oluştu: ${message}`);
      setStatusMessage(`Hata: ${message}`);
    } finally {
      setDownloadingId(null);
      setTimeout(() => setStatusMessage(""), 7000);
    }
  };

  const handleSaveSession = async (e: FormEvent) => {
    e.preventDefault();
    setSavingSettings(true);
    try {
      const res = await fetch(`${COMPANION_URL}/steam/session`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          steamLoginSecure: cookieInput.trim(),
          sessionid: sessionidInput.trim(),
          autoScanEnabled,
        }),
      });
      if (res.ok) {
        setHasSession(true);
        setSettingsOpen(false);
        setCookieInput("");
        setStatusMessage("Steam oturumu başarıyla bağlandı! Maç geçmişiniz taranıyor...");
        await triggerScan(true);
      }
    } catch (err: unknown) {
      toast.error(`Oturum kaydedilemedi: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSavingSettings(false);
    }
  };

  const handleSelectMatch = async (match: ScannedMatchItem) => {
    if (!match.isDownloaded) return;

    if (match.fullAnalysis) {
      onSelectAnalysis(match.fullAnalysis);
      return;
    }

    try {
      setSelectedMatchLoadingId(match.id);
      const res = await fetch(`${COMPANION_URL}/matches/detail/${match.id}`);
      if (res.ok) {
        const data = (await res.json()) as { analysis?: RecentMatchAnalysis };
        if (data.analysis) {
          onSelectAnalysis(data.analysis);
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
              OTOMATİK MAÇ TARAYICI (5 DK)
            </span>
            {hasSession ? (
              <span className="account-chip connected" title="Steam Oturumu Aktif">
                <span className="chip-dot" /> STEAM COMMUNITY BAĞLI
              </span>
            ) : (
              <span className="account-chip idle" title="Steam Oturumu Bağlanmadı">
                <span className="chip-dot" /> STEAM OTURUMU GEREKLİ
              </span>
            )}
          </div>
          <h1 className="recent-title">Son Maçlarım</h1>
          <p className="recent-subtitle">
            Premier, Ranked, Rekabetçi veya Yoldaş maçların; ham demo kotası artık Bildirimler içindeki depolama ayarından yönetilir.
          </p>
        </div>

        <div className="recent-actions-row">
          {hasSession && (
            <div className="auto-scan-status-widget" title="Her 5 dakikada bir arka planda otomatik yeni maç taraması yapılır">
              <span className="scan-dot-pulse" />
              <span className="scan-timer-text">
                Otomatik Tarama: <b>{formatSeconds(countdown)}</b>
              </span>
            </div>
          )}

          <button
            className={`sync-refresh-btn ${scanning ? "loading" : ""}`}
            onClick={() => triggerScan(true)}
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

      {/* Alert / Status Bar */}
      {statusMessage && (
        <div className="sync-status-alert">
          <IconSparkles size={16} />
          <span>{statusMessage}</span>
          {downloadingId && (
            <span className="live-download-counter-badge">
              <IconClock size={13} /> Sayaç: {formatSeconds(downloadElapsed)}
            </span>
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
            {activeTab === "downloaded"
              ? "Henüz İndirilmiş Maç Yok"
              : activeTab === "available"
              ? "Tüm Taranan Maçlar Zaten İndirilmiş"
              : "Henüz Maç Bulunamadı"}
          </h3>
          <p>
            {hasSession
              ? "Steam oturumunuz bağlı. Yukarıdaki 'Şimdi Tara' butonuna basarak maç geçmişinizi güncelleyebilirsiniz."
              : "Steam'den maçlarınızı taramak ve tek tıkla indirmek için sağ üstteki 'Steam Bağlantısı' butonundan oturumunuzu bağlayın."}
          </p>
          <div className="empty-actions">
            {hasSession ? (
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
                      {match.userStats.kd ?? "—"}
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
                      %{match.userStats.hsPercent}
                    </span>
                  </div>

                  {isDownloaded && Number.isFinite(match.userStats.counterStrafePercent) ? (
                    <div className="stat-box">
                      <span className="stat-label">DURUŞ</span>
                      <span className="stat-val">
                        %{match.userStats.counterStrafePercent}
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

                  {isDownloaded && match.userStats.adr ? (
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
                    className={`match-download-btn ${isDownloadingThis ? "downloading" : ""}`}
                    onClick={(e) => handleDownloadMatch(e, match)}
                    disabled={isDownloadingThis}
                  >
                    {isDownloadingThis ? (
                      <div className="download-active-state">
                        <IconRefresh size={14} className="spin-icon" />
                        <span>
                          {downloadElapsed < 6
                            ? `Demo İndiriliyor (${formatSeconds(downloadElapsed)})...`
                            : `3D Valve Analizi Yapılıyor (${formatSeconds(downloadElapsed)})...`}
                        </span>
                      </div>
                    ) : (
                      <>
                        <IconDownload size={14} />
                        <span>Bu Maçı İndir & Analiz Et</span>
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
                Steam Otomatik Tarayıcı Bağlantısı
              </h3>
              <button type="button" className="close-modal-btn" onClick={() => setSettingsOpen(false)} aria-label="Steam bağlantı ayarlarını kapat">
                <IconClose size={16} />
              </button>
            </div>

            <form onSubmit={handleSaveSession} className="settings-form">
              <div className="form-section">
                <h4>
                  <IconLock size={15} style={{ marginRight: "6px", verticalAlign: "middle" }} />
                  Steam Çerezini Bağlama (1 Dakika)
                </h4>
                <p className="form-tip">
                  Valve’ın Premier, Ranked Rekabetçi ve Yoldaş maç geçmişinizi otomatik okuyabilmesi için tarayıcınızdaki Steam oturum çerezinizi buraya yapıştırın. Şifreniz asla kaydedilmez.
                </p>

                <div className="form-group">
                  <label htmlFor="steam-login-secure">steamLoginSecure Çerezi:</label>
                  <input
                    id="steam-login-secure"
                    type="password"
                    placeholder="Örn: 76561198113042361%7C%7CeyAid..."
                    value={cookieInput}
                    onChange={(e) => setCookieInput(e.target.value)}
                    required
                  />
                </div>

                <div className="form-group">
                  <label htmlFor="steam-session-id">sessionid Çerezi (Opsiyonel):</label>
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
                  3. Soldan <b>Cookies - steamcommunity.com</b> seçin ve <b>steamLoginSecure</b> değerini kopyalayıp yukarıya yapıştırın.
                </div>
              </div>

              <div className="modal-foot">
                <button type="button" className="ghost-btn" onClick={() => setSettingsOpen(false)}>
                  İptal
                </button>
                <button type="submit" className="primary-btn" disabled={savingSettings}>
                  {savingSettings ? "Kaydediliyor..." : "Bağlantıyı Kaydet & Tara"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </section>
  );
}
