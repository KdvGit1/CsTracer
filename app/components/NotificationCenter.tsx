"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { COMPANION_URL } from "../lib/config";
import { formatMapTitle } from "./MapEmblem";
import { IconBell, IconCheck, IconClose, IconRefresh, IconSettings, IconSparkles } from "./NavIcons";
import { useToast } from "./Toast";
import type { RecentMatchAnalysis } from "./RecentMatchesView";

type AutomationSettings = {
  demoRetentionCount: number;
  autoDownloadLatestMatch: boolean;
  desktopNotifications: boolean;
};

type DemoStorage = {
  retentionCount: number;
  demoCount: number;
  totalBytes: number;
  averageDemoBytes: number;
  estimatedBytes: number;
  estimateSource: "local-average" | "fallback";
};

type MatchComparison = {
  kind: "overall" | "kd";
  value: number;
  baseline?: number;
  delta?: number;
  sampleSize: number;
  sufficient: boolean;
};

type MatchNotification = {
  id: string;
  matchId: string;
  status: "detected" | "queued" | "waiting" | "downloading" | "analyzing" | "cancelling" | "cancelled" | "ready" | "failed";
  auto: boolean;
  read: boolean;
  createdAt: number;
  updatedAt: number;
  message: string;
  error?: string;
  match: {
    id: string;
    map: string;
    mode: string;
    timestamp: number;
    formattedDate?: string;
    score?: { userScore: number | null; enemyScore: number | null; result: string; rawScore: string } | null;
  };
  comparison?: MatchComparison | null;
  stats?: { kills?: number; deaths?: number; assists?: number; adr?: number } | null;
};

type AutomationState = {
  settings: AutomationSettings;
  storage: DemoStorage;
  notifications: MatchNotification[];
  unreadCount: number;
};

const DEFAULT_STATE: AutomationState = {
  settings: { demoRetentionCount: 5, autoDownloadLatestMatch: false, desktopNotifications: false },
  storage: { retentionCount: 5, demoCount: 0, totalBytes: 0, averageDemoBytes: 0, estimatedBytes: 0, estimateSource: "fallback" },
  notifications: [],
  unreadCount: 0,
};

const STATUS_LABELS: Record<MatchNotification["status"], string> = {
  detected: "Yeni maç",
  queued: "Sırada",
  waiting: "Bekliyor",
  downloading: "İndiriliyor",
  analyzing: "Analiz ediliyor",
  cancelling: "Durduruluyor",
  cancelled: "İptal edildi",
  ready: "Rapor hazır",
  failed: "Tekrar gerekli",
};

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 MB";
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  return `${Math.round(bytes / 1024 ** 2)} MB`;
}

function formatMetric(value: number, digits = 1) {
  return new Intl.NumberFormat("tr-TR", { maximumFractionDigits: digits }).format(Number(value) || 0);
}

function comparisonText(comparison?: MatchComparison | null) {
  if (!comparison) return "Kişisel kıyas tam analizden sonra hazırlanacak.";
  const unit = comparison.kind === "overall" ? "% KAST" : " K/D";
  if (!comparison.sufficient) return `${formatMetric(comparison.value)}${unit} · kıyas için ${3 - comparison.sampleSize} eski maç daha gerekli`;
  const sign = Number(comparison.delta) > 0 ? "+" : "";
  return `${formatMetric(comparison.value)}${unit} · ortalamaya göre ${sign}${formatMetric(Number(comparison.delta))}${comparison.kind === "overall" ? " yüzde puanı" : " K/D"}`;
}

function notificationActionLabel(status: MatchNotification["status"]) {
  if (status === "ready") return "Raporu aç";
  if (status === "failed") return "Tekrar dene";
  if (status === "cancelled") return "Yeniden sıraya al";
  if (status === "detected") return "İndir ve analiz et";
  return "İşleniyor";
}

export function NotificationCenter({
  onSelectAnalysis,
  onProgressChange,
}: {
  onSelectAnalysis: (analysis: RecentMatchAnalysis) => void;
  onProgressChange?: () => void;
}) {
  const toast = useToast();
  const [state, setState] = useState<AutomationState>(DEFAULT_STATE);
  const [open, setOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsDraft, setSettingsDraft] = useState(DEFAULT_STATE.settings);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [actingId, setActingId] = useState("");
  const lastDesktopKey = useRef("");
  const lastReadyProgressKey = useRef("");

  const fetchState = useCallback(async () => {
    try {
      const response = await fetch(`${COMPANION_URL}/automation/state`, { cache: "no-store" });
      const payload = await response.json() as Partial<AutomationState> & { error?: string };
      if (!response.ok) throw new Error(payload.error || "Bildirim merkezi okunamadı.");
      const next = { ...DEFAULT_STATE, ...payload } as AutomationState;
      setState(next);
      setSettingsDraft(next.settings);

      // Arka planda tamamlanan analiz gelişim hafızasına companion tarafından
      // yazılır. Hazır bildirim değiştiğinde ana ekran yerel hafızayı tazeler.
      const readyProgressKey = next.notifications
        .filter((item) => item.status === "ready")
        .map((item) => `${item.matchId}:${item.updatedAt}`)
        .join("|");
      if (readyProgressKey && readyProgressKey !== lastReadyProgressKey.current) {
        lastReadyProgressKey.current = readyProgressKey;
        onProgressChange?.();
      }

      const latestUnread = next.notifications.find((item) => !item.read);
      const desktopKey = latestUnread ? `${latestUnread.id}:${latestUnread.status}:${latestUnread.updatedAt}` : "";
      if (
        latestUnread
        && desktopKey
        && desktopKey !== lastDesktopKey.current
        && next.settings.desktopNotifications
        && typeof window !== "undefined"
        && "Notification" in window
        && window.Notification.permission === "granted"
      ) {
        const systemNotification = new window.Notification(
          latestUnread.status === "ready" ? "TRACER · Maç raporun hazır" : "TRACER · Yeni CS2 maçı",
          { body: `${formatMapTitle(latestUnread.match.map)} · ${latestUnread.message}`, tag: latestUnread.id },
        );
        systemNotification.onclick = () => {
          window.focus();
          setOpen(true);
        };
      }
      lastDesktopKey.current = desktopKey;
    } catch (error) {
      console.warn(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  }, [onProgressChange]);

  useEffect(() => {
    const initialFetch = window.setTimeout(() => void fetchState(), 0);
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void fetchState();
    }, 8_000);
    return () => {
      window.clearTimeout(initialFetch);
      window.clearInterval(timer);
    };
  }, [fetchState]);

  const openCenter = () => {
    setOpen(true);
    setSettingsOpen(false);
  };

  const handleNotification = async (item: MatchNotification) => {
    if (["queued", "waiting", "downloading", "analyzing", "cancelling"].includes(item.status)) return;
    setActingId(item.id);
    try {
      const response = await fetch(`${COMPANION_URL}/notifications/${encodeURIComponent(item.id)}/action`, { method: "POST" });
      const payload = await response.json() as { error?: string; analysis?: RecentMatchAnalysis; ready?: boolean };
      if (!response.ok) throw new Error(payload.error || "Bildirim işlemi başlatılamadı.");
      if (payload.ready && payload.analysis) {
        onSelectAnalysis(payload.analysis);
        setOpen(false);
      } else {
        toast.success(item.status === "failed" || item.status === "cancelled" ? "Maç yeniden sıraya alındı." : "Maç indiriliyor ve analiz ediliyor.");
      }
      await fetchState();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Bildirim işlemi başarısız.");
    } finally {
      setActingId("");
    }
  };

  const saveSettings = async () => {
    setSaving(true);
    try {
      let desktopNotifications = settingsDraft.desktopNotifications;
      if (desktopNotifications && "Notification" in window && window.Notification.permission !== "granted") {
        const permission = await window.Notification.requestPermission();
        desktopNotifications = permission === "granted";
        if (!desktopNotifications) toast.error("Windows bildirimi izni verilmedi; uygulama içi bildirimler çalışmaya devam edecek.");
      }
      const response = await fetch(`${COMPANION_URL}/automation/settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...settingsDraft, desktopNotifications }),
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error || "Ayarlar kaydedilemedi.");
      toast.success("Depolama ve otomasyon ayarları kaydedildi.");
      setSettingsOpen(false);
      await fetchState();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Ayarlar kaydedilemedi.");
    } finally {
      setSaving(false);
    }
  };

  const markAllRead = async () => {
    await fetch(`${COMPANION_URL}/notifications/read-all`, { method: "POST" });
    await fetchState();
  };

  return <>
    <button className="notification-trigger" onClick={openCenter} aria-label={`Bildirimler${state.unreadCount ? `, ${state.unreadCount} okunmamış` : ""}`}>
      <IconBell size={17} />
      <span>Bildirimler</span>
      {state.unreadCount > 0 && <b>{state.unreadCount > 9 ? "9+" : state.unreadCount}</b>}
    </button>

    {open && <div className="notification-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) setOpen(false);
    }}>
      <aside className="notification-drawer" aria-label="Maç bildirim merkezi">
        <header className="notification-head">
          <div><span>MAÇ SONU MERKEZİ</span><h2>{settingsOpen ? "Depolama ve Otomasyon" : "Bildirimler"}</h2></div>
          <div>
            <button onClick={() => setSettingsOpen((value) => !value)} title="Depolama ve otomasyon ayarları"><IconSettings size={16} /></button>
            <button onClick={() => setOpen(false)} title="Kapat"><IconClose size={17} /></button>
          </div>
        </header>

        {settingsOpen ? <div className="automation-settings">
          <section>
            <label htmlFor="demo-retention">Ham demo saklama adedi</label>
            <div className="retention-input-row">
              <input
                id="demo-retention"
                type="number"
                min={3}
                max={50}
                value={settingsDraft.demoRetentionCount}
                onChange={(event) => setSettingsDraft((current) => ({ ...current, demoRetentionCount: Math.max(3, Math.min(50, Number(event.target.value) || 3)) }))}
              />
              <b>maç</b>
            </div>
            <div className="storage-estimate">
              <span><strong>≈ {formatBytes(state.storage.averageDemoBytes * settingsDraft.demoRetentionCount)}</strong> tahmini üst kullanım</span>
              <small>{state.storage.demoCount} ham demo şu an {formatBytes(state.storage.totalBytes)} · {state.storage.estimateSource === "local-average" ? "kendi dosya ortalaman kullanıldı" : "ilk demo gelene kadar güvenli varsayım"}</small>
            </div>
            <p>En az 3 demo korunur. Kota yalnızca büyük <code>.dem</code> dosyalarına uygulanır; küçük analiz geçmişi ve Takım Koçu kanıtları silinmez.</p>
          </section>

          <div className="automation-toggle">
            <input id="auto-download-latest" type="checkbox" checked={settingsDraft.autoDownloadLatestMatch} onChange={(event) => setSettingsDraft((current) => ({ ...current, autoDownloadLatestMatch: event.target.checked }))} />
            <span><label htmlFor="auto-download-latest">Son maçı her zaman otomatik indir</label><small>CS2 kapandıktan sonra replay indirilir, analiz edilir ve durum bildirimi güncellenir.</small></span>
          </div>
          <div className="automation-toggle">
            <input id="desktop-notifications" type="checkbox" checked={settingsDraft.desktopNotifications} onChange={(event) => setSettingsDraft((current) => ({ ...current, desktopNotifications: event.target.checked }))} />
            <span><label htmlFor="desktop-notifications">Windows bildirimi göster</label><small>Uygulama içi bildirim merkezi bu seçenek kapalıyken de çalışır.</small></span>
          </div>
          <div className="automation-actions"><button onClick={() => setSettingsOpen(false)}>Vazgeç</button><button className="save" onClick={saveSettings} disabled={saving}>{saving ? "Kaydediliyor…" : "Ayarları kaydet"}</button></div>
        </div> : <>
          <div className="notification-summary">
            <span><i /> {state.settings.autoDownloadLatestMatch ? "OTOMATİK İNDİRME AÇIK" : "TIKLA, İNDİR VE ANALİZ ET"}</span>
            {state.unreadCount > 0 && <button onClick={markAllRead}>Tümünü okundu say</button>}
          </div>
          <div className="notification-list">
            {loading ? <div className="notification-empty"><IconRefresh className="spin-icon" size={22} /><b>Bildirimler yükleniyor…</b></div>
              : state.notifications.length === 0 ? <div className="notification-empty"><IconBell size={25} /><b>Henüz maç bildirimi yok</b><p>Yeni Steam maçı algılandığında kısa özet burada kalıcı olarak görünür.</p></div>
              : state.notifications.map((item) => {
                const busy = ["queued", "waiting", "downloading", "analyzing", "cancelling"].includes(item.status);
                return <article key={item.id} className={`match-notification ${item.read ? "read" : "unread"} ${item.status}`}>
                  <header>
                    <div><span>{formatMapTitle(item.match.map)}</span><small>{item.match.mode || "CS2"} · {item.match.formattedDate || new Date(item.match.timestamp).toLocaleString("tr-TR")}</small></div>
                    <em>{item.auto && "OTO · "}{STATUS_LABELS[item.status]}</em>
                  </header>
                  <p>{item.message}</p>
                  {item.stats && <div className="notification-stats"><b>{item.stats.kills ?? 0}/{item.stats.deaths ?? 0}/{item.stats.assists ?? 0} K/D/A</b>{Number(item.stats.adr) > 0 && <span>{formatMetric(Number(item.stats.adr))} ADR</span>}</div>}
                  <div className={`notification-comparison ${item.comparison?.sufficient ? (Number(item.comparison.delta) >= 0 ? "positive" : "negative") : "neutral"}`}><IconSparkles size={13} /> {comparisonText(item.comparison)}</div>
                  <button onClick={() => handleNotification(item)} disabled={busy || actingId === item.id}>
                    {item.status === "ready" && <IconCheck size={13} />}
                    {busy && <IconRefresh size={13} className={item.status === "waiting" ? "" : "spin-icon"} />}
                    {actingId === item.id ? "Başlatılıyor…" : notificationActionLabel(item.status)}
                  </button>
                </article>;
              })}
          </div>
        </>}
      </aside>
    </div>}
  </>;
}
