"use client";

import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import { radarMapFor, worldToRadar } from "./map-data";

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
  { label: "Rating", value: "1.08", delta: "+0.06", tone: "good" },
  { label: "ADR", value: "78.4", delta: "+4.2", tone: "good" },
  { label: "KAST", value: "%71", delta: "-%3", tone: "warn" },
  { label: "Trade", value: "%19", delta: "-%8", tone: "bad" },
];

const sampleEvidence = [
  { round: "R04", time: "01:18", text: "Flash desteği olmadan ikinci temas", type: "Pozisyon" },
  { round: "R09", time: "00:54", text: "İlk mermide 92 u/s hareket", type: "Aim" },
  { round: "R16", time: "01:22", text: "Yakın takım arkadaşı 14.8 m uzakta", type: "Trade" },
];

type Recommendation = { id: string; title: string; body: string; confidence: number };
type DeathDetail = {
  round: number; tick: number; time: number; zone: string; x: number; y: number; z: number;
  killer: string; weapon: string; nearestTeammate: number | null; usedRecentFlash: boolean; traded: boolean;
};
type PlayerReport = {
  player: { name: string; steamid: string }; map: string; rounds: number; kills: number; deaths: number;
  assists: number; adr: number; headshotPercent: number; openingKills: number; openingDeaths: number;
  utilityDamage: number; enemyBlindSeconds: number; flashesThrown: number; shots: number;
  movingShotPercent: number; tradePercent: number; topZone: string; topZoneDeaths: number;
  unflashedDeaths: number; untradedDeaths: number; impact: number; deathDetails: DeathDetail[];
  recommendations: Recommendation[];
};
type AiInsight = { title: string; diagnosis: string; action: string; confidence?: number };
type ParseStatus = "idle" | "reading" | "parsing" | "ready" | "error";

const sampleMapDeaths = [
  { round: 4, tick: 18120, zone: "A Short", x: 515, y: 1810, z: 128 },
  { round: 9, tick: 42780, zone: "A Short", x: 610, y: 1905, z: 128 },
  { round: 16, tick: 79140, zone: "A Short", x: 675, y: 2010, z: 128 },
  { round: 19, tick: 94820, zone: "A Short", x: 760, y: 2110, z: 128 },
];

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
  const [steamAuthCode, setSteamAuthCode] = useState("");
  const [steamKnownCode, setSteamKnownCode] = useState("");
  const [faceitNickname, setFaceitNickname] = useState("");
  const [sourceMessage, setSourceMessage] = useState("");
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [demoDirectory, setDemoDirectory] = useState<LocalDirectoryHandle | null>(null);
  const [demoFiles, setDemoFiles] = useState<DemoFileEntry[]>([]);
  const [archiveMessage, setArchiveMessage] = useState("");
  const [archiveBusy, setArchiveBusy] = useState(false);
  const [companionState, setCompanionState] = useState<CompanionState>("checking");

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
  const insight = report?.recommendations[0];
  const metrics = report ? [
    { label: "K / D", value: `${report.kills} / ${report.deaths}`, delta: `${report.assists} asist`, tone: report.kills >= report.deaths ? "good" : "warn" },
    { label: "ADR", value: report.adr.toFixed(1), delta: report.adr >= 75 ? "iyi" : "geliştir", tone: report.adr >= 75 ? "good" : "warn" },
    { label: "HS", value: `%${report.headshotPercent}`, delta: `${report.openingKills}-${report.openingDeaths} opening`, tone: report.headshotPercent >= 45 ? "good" : "warn" },
    { label: "Trade", value: `%${report.tradePercent}`, delta: `${report.untradedDeaths} çevrilmedi`, tone: report.tradePercent >= 45 ? "good" : "bad" },
  ] : sampleMetrics;
  const evidence = report ? report.deathDetails.slice(0, 3).map((item) => ({
    round: `R${String(item.round || 0).padStart(2, "0")}`,
    time: `T${item.tick}`,
    text: `${item.zone} · ${item.usedRecentFlash ? "yakın flash var" : "yakın flash yok"}${item.nearestTeammate ? ` · takım ${item.nearestTeammate}u` : ""}`,
    type: item.traded ? "Trade" : "Pozisyon",
  })) : sampleEvidence;
  const deathsOnMap = report?.deathDetails.slice(0, 24) || sampleMapDeaths;
  const radarMap = radarMapFor(report?.map || "de_dust2");
  const visibleDeaths = deathsOnMap.filter((death) => {
    if (!radarMap?.lowerImage || radarMap.lowerMaxZ === undefined) return true;
    return mapLevel === "lower" ? death.z < radarMap.lowerMaxZ : death.z >= radarMap.lowerMaxZ;
  });
  const radarImage = mapLevel === "lower" && radarMap?.lowerImage ? radarMap.lowerImage : radarMap?.image;

  function playerKey(item: PlayerReport) {
    return item.player.steamid || item.player.name;
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
    if (!report) return;
    setOllamaState("thinking");
    setError("");
    const compactReport = { ...report, deathDetails: report.deathDetails.slice(0, 12) };
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
            { role: "system", content: "Sen profesyonel CS2 performans koçusun. Yalnızca verilen ölçümleri kullan. Nedeni kanıtlanmayan hatalarda kesin konuşma; 'olabilir' de. Türkçe, kısa ve uygulanabilir yaz. JSON döndür: title, diagnosis, action, confidence." },
            { role: "user", content: JSON.stringify(compactReport) },
          ],
        }),
      });
      if (!response.ok) throw new Error(`Ollama ${response.status} döndürdü`);
      const payload = await response.json();
      const content = payload.message?.content || payload.response;
      setAiInsight(typeof content === "string" ? JSON.parse(content) : content);
      await verifyOllamaReleased();
    } catch (aiError) {
      setOllamaState("offline");
      setError(`Ollama analizi alınamadı. ${aiError instanceof Error ? aiError.message : "Bağlantıyı kontrol et."}`);
    }
  }

  async function checkSteamMatch() {
    setSourceMessage("Valve maç geçmişi kontrol ediliyor…");
    try {
      const response = await fetch("/api/steam/next", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ steamid: steamId, authCode: steamAuthCode, knownCode: steamKnownCode }) });
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
      const response = await fetch(`/api/faceit/player?nickname=${encodeURIComponent(faceitNickname)}`);
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
          <a className="nav-item active" href="#dashboard"><span>⌁</span> Genel bakış</a>
          <a className="nav-item" href="#matches"><span>▤</span> Maçlar</a>
          <a className="nav-item" href="#maps"><span>⌖</span> Haritalar</a>
          <a className="nav-item" href="#training"><span>↗</span> Gelişim planı</a>
        </nav>
        <div className="sidebar-spacer" />
        <button className={`ai-status ${ollamaState}`} onClick={() => setSettingsOpen(true)}>
          <span className="pulse" />
          <div><b>{ollamaState === "released" ? "KAYNAKLAR BIRAKILDI" : ollamaState === "online" ? "OLLAMA BAĞLI" : ollamaState === "thinking" ? "OLLAMA DÜŞÜNÜYOR" : "OLLAMA AYARLA"}</b><small>{ollamaModel} · yerel</small></div>
        </button>
        <div className="player-card">
          <div className="avatar">KD</div>
          <div><b>{report?.player.name || "KDV"}</b><small>{report ? `${report.map || "CS2"} · ${report.rounds} round` : "Premier · 18,742"}</small></div>
          <span>•••</span>
        </div>
      </aside>

      <section className="workspace" id="dashboard">
        <header className="topbar">
          <div>
            <p className="eyebrow">PERFORMANS MERKEZİ</p>
            <h1>{report ? `${report.player.name} için analiz hazır.` : "Tekrar hoş geldin, KDV."}</h1>
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
          <div><p>{report ? "YÜKLENEN DEMO" : "SON ANALİZ"}</p><b>{report ? `${report.map || "Bilinmeyen harita"} · ${fileName}` : "Dust II · Premier"}</b></div>
          <span className="win-pill">{report ? `${report.rounds} ROUND` : "GALİBİYET"}</span>
          <b className="score">{report ? report.kills : 13} <i>:</i> {report ? report.deaths : 9}</b>
          <div className="match-meta"><span>{report ? "Tarayıcıda yerel analiz" : "Bugün, 21:42"}</span><span>{report ? `${report.assists} asist · ${report.adr} ADR` : "41 dk · CT 7:5 / T 6:4"}</span></div>
          <button className="icon-button" aria-label="Yerel maç arşivini aç" onClick={() => { setArchiveOpen(true); void refreshCompanion(); }}>⌄</button>
        </div>

        {(status === "reading" || status === "parsing" || status === "ready" || status === "error") && (
          <div className={`analysis-progress ${status}`} role="status">
            <div><span>{status === "error" ? "!" : status === "ready" ? "✓" : "↻"}</span><b>{status === "error" ? error : progressLabel}</b><small>{status === "ready" ? "Veri cihazından ayrılmadı." : status === "error" ? "Dosyayı kontrol edip yeniden dene." : `${progress}%`}</small></div>
            <div className="progress-track"><i style={{ width: `${status === "error" ? 100 : progress}%` }} /></div>
            {status === "ready" && reports.length > 1 && (
              <label className="player-select">Oyuncu
                <select value={selectedPlayer} onChange={(event) => { setSelectedPlayer(event.target.value); setAiInsight(null); }}>
                  {reports.map((item) => <option key={playerKey(item)} value={playerKey(item)}>{item.player.name}</option>)}
                </select>
              </label>
            )}
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
            <div><strong>{report?.impact ?? 74}</strong><small>/100</small></div>
            <div className="score-line"><i style={{ width: `${report?.impact ?? 74}%` }} /></div>
          </article>
        </div>

        <div className="dashboard-grid">
          <article className="coach-card">
            <div className="card-kicker"><span className="spark">✦</span> {aiInsight ? "OLLAMA KOÇ" : "KURAL MOTORU"} · ÖNCELİKLİ BULGU <em>%{aiInsight?.confidence ?? insight?.confidence ?? 87} güven</em></div>
            <h2>{aiInsight?.title || insight?.title || "A Short savunmanda"}<br/><span>{report ? "ölçümlere dayalı gelişim alanı." : "aynı hata tekrarlanıyor."}</span></h2>
            <p className="coach-copy">
              {aiInsight?.diagnosis || insight?.body || <>A site tutarken short temaslarında <b>4 kez öldün.</b> Üçünde rakip görüşüne flash desteği olmadan çıktın; ikisinde ilk mermi anında hâlâ hareket ediyordun.</>}
            </p>
            <div className="recommendation">
              <span>01</span>
              <div><b>Sonraki maç hedefin</b><p>{aiInsight?.action || (report ? "Öncelikli bulgunun geçtiği roundları aç, aynı pozisyonda flash veya geri düşme planını önceden belirle." : "Short temasından önce pop-flash iste; ikinci peek yerine rampaya geri düş.")}</p></div>
            </div>
            {report && <button className="ollama-coach-button" onClick={runAiCoach} disabled={ollamaState === "thinking"}>{ollamaState === "thinking" ? "Ollama analiz ediyor…" : "✦ Ollama ile derinleştir"}</button>}
            <div className="evidence-list">
              {evidence.map((item) => (
                <button className="evidence-item" key={item.round}>
                  <span className="round-tag">{item.round}</span>
                  <b>{item.time}</b>
                  <p>{item.text}</p>
                  <em>{item.type}</em>
                  <i>›</i>
                </button>
              ))}
            </div>
          </article>

          <article className="map-card">
            <div className="section-head">
              <div><p>KONUMLANDIRMA</p><h3>Ölüm yoğunluğu</h3></div>
              {radarMap?.lowerImage && <div className="segmented"><button className={mapLevel === "upper" ? "selected" : ""} onClick={() => setMapLevel("upper")}>ÜST</button><button className={mapLevel === "lower" ? "selected" : ""} onClick={() => setMapLevel("lower")}>ALT</button></div>}
            </div>
            <div className="radar" role="img" aria-label={`${report?.map || "Dust II"} üzerinde ölüm noktaları`}>
              {radarImage && <img className="radar-image" src={radarImage} alt="" draggable="false" />}
              {!radarMap && <div className="radar-unavailable">Bu harita için radar kalibrasyonu henüz yok.</div>}
              {radarMap && visibleDeaths.map((item, index) => {
                const point = worldToRadar(item.x, item.y, radarMap);
                if (point.left < 0 || point.left > 100 || point.top < 0 || point.top > 100) return null;
                return <span key={`${item.tick}-${index}`} className="death dynamic-death" style={{ left: `${point.left}%`, top: `${point.top}%` }} title={`R${item.round} · ${item.zone} · ${Math.round(item.x)}, ${Math.round(item.y)}`}>×</span>;
              })}
              <div className="map-callout"><b>{report ? `${report.topZoneDeaths} ölüm` : "4 ölüm"}</b><span>{report ? report.topZone : "A Short · 37 m² alan"}</span></div>
            </div>
            <div className="map-legend"><span><i className="red-dot"/>Ölüm</span><span>{radarMap?.label || report?.map || "Bilinmeyen harita"}</span><button>Valve radar · gerçek dünya koordinatı</button></div>
          </article>
        </div>

        <section className="lower-grid">
          <article className="breakdown-card">
            <div className="section-head"><div><p>MEKANİK</p><h3>Çatışma profili</h3></div><span className="versus">Son 10 maç</span></div>
            <div className="bar-row"><span>Opening düello</span><div><i style={{width:`${report ? Math.min(100, 50+(report.openingKills-report.openingDeaths)*10) : 78}%`}}/></div><b>{report ? `${report.openingKills}-${report.openingDeaths}` : "78"}</b></div>
            <div className="bar-row"><span>Counter-strafe</span><div><i className="orange" style={{width:`${report ? 100-report.movingShotPercent : 54}%`}}/></div><b>{report ? 100-report.movingShotPercent : 54}</b></div>
            <div className="bar-row"><span>Utility hasarı</span><div><i style={{width:`${report ? Math.min(100, report.utilityDamage/2) : 69}%`}}/></div><b>{report?.utilityDamage ?? 69}</b></div>
            <div className="bar-row"><span>Flash süresi</span><div><i className="orange" style={{width:`${report ? Math.min(100, report.enemyBlindSeconds*4) : 61}%`}}/></div><b>{report ? `${report.enemyBlindSeconds}s` : "61"}</b></div>
          </article>
          <article className="timeline-card">
            <div className="section-head"><div><p>ROUND AKIŞI</p><h3>Etki zaman çizgisi</h3></div><span className="versus">13–9</span></div>
            <div className="round-bars">
              {[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22].map((round) => (
                <span key={round} className={[4,9,16,19].includes(round) ? "lost bad-round" : [2,5,7,12,15,18,21].includes(round) ? "impact" : round % 3 === 0 ? "lost" : "neutral"} title={`Round ${round}`} />
              ))}
            </div>
            <div className="timeline-note"><span>✦</span><p><b>{report ? `${report.topZone} tekrar ediyor` : "CT tarafında erken düşüş"}</b> · {report ? `${report.topZoneDeaths} ölüm, ${report.unflashedDeaths} tanesinde yakın flash yok.` : "İlk ölüm olduğun 5 roundun 4'ü kaybedildi."}</p></div>
          </article>
        </section>

        <section className="analysis-matrix" id="training">
          <div className="matrix-title"><div><p className="eyebrow">TAM ANALİZ SETİ</p><h2>Tek maçta dört performans katmanı</h2></div><span>{report ? "Gerçek demo verisi" : "Örnek görünüm"}</span></div>
          <div className="analysis-cards">
            <article><header><span>01</span><div><b>Aim & hareket</b><small>Atış anındaki davranış</small></div></header><dl><div><dt>Hareketli atış</dt><dd>%{report?.movingShotPercent ?? 18}</dd></div><div><dt>Headshot</dt><dd>%{report?.headshotPercent ?? 48}</dd></div><div><dt>Toplam atış</dt><dd>{report?.shots ?? 286}</dd></div></dl></article>
            <article><header><span>02</span><div><b>Pozisyon & trade</b><small>Harita ve takım mesafesi</small></div></header><dl><div><dt>Yoğun ölüm alanı</dt><dd>{report?.topZone ?? "A Short"}</dd></div><div><dt>Trade oranı</dt><dd>%{report?.tradePercent ?? 19}</dd></div><div><dt>Çevrilmeyen ölüm</dt><dd>{report?.untradedDeaths ?? 4}</dd></div></dl></article>
            <article><header><span>03</span><div><b>Utility etkisi</b><small>Flash ve alan hasarı</small></div></header><dl><div><dt>Utility hasarı</dt><dd>{report?.utilityDamage ?? 78}</dd></div><div><dt>Rakip kör süresi</dt><dd>{report?.enemyBlindSeconds ?? 12.4}s</dd></div><div><dt>Atılan flash</dt><dd>{report?.flashesThrown ?? 7}</dd></div></dl></article>
            <article><header><span>04</span><div><b>Round etkisi</b><small>Açılış ve sürdürülebilirlik</small></div></header><dl><div><dt>Opening</dt><dd>{report ? `${report.openingKills}-${report.openingDeaths}` : "3-2"}</dd></div><div><dt>ADR</dt><dd>{report?.adr ?? 78.4}</dd></div><div><dt>Etki skoru</dt><dd>{report?.impact ?? 74}/100</dd></div></dl></article>
          </div>
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
          <section className="settings-modal" role="dialog" aria-modal="true" aria-labelledby="settings-title">
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
            <details className="source-details">
              <summary className="source-row"><div><b>Valve Premier / Competitive</b><span>Game Authentication Code + son match token</span></div><em>Yapılandır →</em></summary>
              <div className="source-form">
                <input aria-label="SteamID64" placeholder="SteamID64 (17 hane)" value={steamId} onChange={(event) => setSteamId(event.target.value)} />
                <input aria-label="Game Authentication Code" type="password" placeholder="Game Authentication Code" value={steamAuthCode} onChange={(event) => setSteamAuthCode(event.target.value)} />
                <input aria-label="Son match token" placeholder="CSGO-xxxxx-… son match token" value={steamKnownCode} onChange={(event) => setSteamKnownCode(event.target.value)} />
                <button className="ghost-button" onClick={checkSteamMatch}>Sonraki maçı kontrol et</button>
              </div>
            </details>
            <details className="source-details">
              <summary className="source-row"><div><b>FACEIT</b><span>Maç geçmişi ve demo URL senkronizasyonu</span></div><em>Yapılandır →</em></summary>
              <div className="source-form source-form-faceit"><input aria-label="FACEIT kullanıcı adı" placeholder="FACEIT kullanıcı adı" value={faceitNickname} onChange={(event) => setFaceitNickname(event.target.value)} /><button className="ghost-button" onClick={checkFaceit}>Profili kontrol et</button></div>
            </details>
            {sourceMessage && <div className="connection-result">{sourceMessage}</div>}
          </section>
        </div>
      )}
    </main>
  );
}
