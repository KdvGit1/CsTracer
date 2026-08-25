"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { COMPANION_URL } from "../lib/config";
import { formatMapTitle, MapEmblem } from "./MapEmblem";
import { IconCheck, IconMap, IconPlan, IconRefresh, IconShield, IconSparkles, IconWarning, IconWeapon, IconZap } from "./NavIcons";
import { useToast } from "./Toast";

type SquadPlayer = { steamid: string; name: string };
type SquadTeam = { id: string; label: string; players: SquadPlayer[] };
type SquadMatch = {
  id: string;
  map: string;
  timestamp: number;
  formattedDate?: string;
  score?: { rawScore?: string; result?: string } | null;
  teams: SquadTeam[];
  userStats?: SquadPlayer | null;
  matchedPlayerIds?: string[];
};
type DiscoverableSquadMatch = {
  id: string;
  map: string;
  timestamp: number;
  formattedDate?: string;
  mode?: string;
  score?: { rawScore?: string; result?: string } | null;
  matchedPlayerIds?: string[];
};
type PlayerCoverage = { player: SquadPlayer; analyzedMatches: number; analyzedMatchIds: string[]; availableMatches: number; requiredDownloads: number; eligible: boolean };
type SquadDiscoveryPayload = {
  scan: { ok: boolean; busy: boolean; cached: boolean; requiresLogin: boolean; message: string };
  candidates: SquadMatch[];
  availableMatches: DiscoverableSquadMatch[];
  coverage: PlayerCoverage[];
  ownerSteamId?: string;
  eligible: boolean;
};
type Assignment = { player: SquadPlayer; role?: string; roleLabel?: string; description?: string; position?: string; positionLabel?: string; fitScore: number; confidence?: number };
type WeaponAssignment = { player: SquadPlayer; role: string; status: string; primaryBuy: string; secondaryBuy: string; evidence: { bestCategory: string; categoryScore: number; confidence: number } };
type RouteEvidence = { zone: string; rounds: number; adjustedWinRate: number; confidence: number };
type PlayerCard = { player: SquadPlayer; confidence: { matches: number; rounds: number; confidence: number; confidenceLabel: string }; bestCTRoute: RouteEvidence | null; bestTRoute: RouteEvidence | null; bestWeapon: { label: string; kills: number; confidence: number } | null; overall: { kd: number; adr: number; openingDelta: number; utilityPerRound: number } };
type RoundPlan = { id: string; side: "CT" | "T"; buy: string; title: string; lane: string; goal: string; evidence?: { historicalScore: number; confidence: number; sampleRounds: number }; tasks: Array<{ role: string; playerName: string; text: string }> };
type SquadReport = {
  id: string;
  map: string;
  mapLabel: string;
  genericMapPlan: boolean;
  evidence: { matchIds: string[]; evidence: { matches: number; teamRounds: number; confidence: number; confidenceLabel: string }; warnings: string[] };
  assignments: { t: Assignment[]; ct: Assignment[] };
  weapons: WeaponAssignment[];
  playbook: { rules: string[]; roundPlans: RoundPlan[] };
  playerCards: PlayerCard[];
  limitations: string[];
};
type SavedSquad = { id: string; name: string; map: string; roster: SquadPlayer[]; notes: string; report: SquadReport | null; updatedAt: number };
type LiveSession = {
  updatedAt: number;
  active: boolean;
  connected: boolean;
  map: string;
  round: number;
  side: string;
  score: { CT: number; T: number };
  statusMessage?: string;
  currentPlan: (RoundPlan & { round: number; buyState: string; adaptation: string }) | null;
  history: Array<{ round: number; planId: string; title: string; lane: string; outcome: "success" | "failed"; reason: string }>;
  personalEvents: Array<{ round: number; message: string }>;
  cooldowns: Record<string, number>;
  notes: string;
  capability: { allPlayers: boolean; localPosition: boolean; mode: string; message: string };
};

async function jsonRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${COMPANION_URL}${path}`, {
    cache: "no-store",
    ...init,
    headers: init?.body ? { "Content-Type": "application/json", ...(init.headers || {}) } : init?.headers,
  });
  const payload = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(payload.error || "Takım koçu isteği başarısız.");
  return payload;
}

function confidenceClass(value: number) {
  return value >= 82 ? "high" : value >= 65 ? "medium" : "limited";
}

function statusLabel(status: string) {
  const labels: Record<string, string> = {
    primary_awp: "Birincil AWP",
    backup_awp: "Yedek AWP",
    rifler: "Rifler",
    smg_specialist: "SMG uzmanı",
    close_range_specialist: "Yakın alan uzmanı",
  };
  return labels[status] || status;
}

function squadNames(roster: SquadPlayer[]) {
  return roster.map((player) => player.name).filter(Boolean).join(", ") || "İsimsiz takım";
}

export default function TeamCoachView() {
  const toast = useToast();
  const [matches, setMatches] = useState<SquadMatch[]>([]);
  const [savedSquads, setSavedSquads] = useState<SavedSquad[]>([]);
  const [seedId, setSeedId] = useState("");
  const [teamId, setTeamId] = useState("");
  const [selectedPlayerIds, setSelectedPlayerIds] = useState<string[]>([]);
  const [map, setMap] = useState("");
  const [candidates, setCandidates] = useState<SquadMatch[]>([]);
  const [selectedMatchIds, setSelectedMatchIds] = useState<string[]>([]);
  const [report, setReport] = useState<SquadReport | null>(null);
  const [squadId, setSquadId] = useState("");
  const [tab, setTab] = useState<"setup" | "overview" | "roles" | "playbook" | "live">("setup");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [live, setLive] = useState<LiveSession | null>(null);
  const [notes, setNotes] = useState("");
  const [focusMode, setFocusMode] = useState(false);
  const [discovering, setDiscovering] = useState(false);
  const [discoverableMatches, setDiscoverableMatches] = useState<DiscoverableSquadMatch[]>([]);
  const [coverage, setCoverage] = useState<PlayerCoverage[]>([]);
  const [discoveryDismissed, setDiscoveryDismissed] = useState(false);
  const [bulkDownloading, setBulkDownloading] = useState(false);
  const discoveryRequestRef = useRef(0);

  const seedMatch = useMemo(() => matches.find((item) => item.id === seedId) || null, [matches, seedId]);
  const selectedTeam = useMemo(() => seedMatch?.teams.find((team) => team.id === teamId) || null, [seedMatch, teamId]);
  const selectedRoster = useMemo(() => selectedTeam?.players.filter((player) => selectedPlayerIds.includes(player.steamid)) || [], [selectedPlayerIds, selectedTeam]);
  const ownerSteamId = seedMatch?.userStats?.steamid || "";
  const maps = useMemo(() => [...new Set(matches.map((item) => item.map))].sort(), [matches]);
  const selectedCoverage = useMemo(() => selectedRoster.map((player) => {
    const analyzedMatchIds = candidates
      .filter((candidate) => selectedMatchIds.includes(candidate.id) && (candidate.matchedPlayerIds || []).includes(player.steamid))
      .map((candidate) => candidate.id);
    const discovered = coverage.find((item) => item.player.steamid === player.steamid);
    return {
      player,
      analyzedMatchIds,
      analyzedMatches: analyzedMatchIds.length,
      availableMatches: discovered?.availableMatches || 0,
      requiredDownloads: Math.max(0, 3 - analyzedMatchIds.length),
      eligible: analyzedMatchIds.length >= 3,
    };
  }), [candidates, coverage, selectedMatchIds, selectedRoster]);
  const selectionEligible = selectedCoverage.length > 0 && selectedCoverage.every((item) => item.eligible);

  const loadArchive = useCallback(async () => {
    setLoading(true);
    try {
      const [matchPayload, squadPayload] = await Promise.all([
        jsonRequest<{ matches: SquadMatch[] }>("/squads/matches"),
        jsonRequest<{ squads: SavedSquad[] }>("/squads"),
      ]);
      setMatches(matchPayload.matches || []);
      setSavedSquads(squadPayload.squads || []);
      if (matchPayload.matches?.[0]) {
        setSeedId((current) => current || matchPayload.matches[0].id);
        setMap((current) => current || matchPayload.matches[0].map);
      }
      setMessage(matchPayload.matches?.length ? "" : "Takım arşivi boş. Önce Son Maçlarım bölümünden maç indirip analiz et.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Takım arşivi okunamadı.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => { void loadArchive(); }, 0);
    return () => window.clearTimeout(timer);
  }, [loadArchive]);

  const discoverSelection = useCallback(async (roster: SquadPlayer[], selectedMap: string, selectedOwnerSteamId: string, refresh = true) => {
    const requestId = ++discoveryRequestRef.current;
    setDiscovering(true);
    setDiscoveryDismissed(false);
    setMessage(`Steam geçmişinde seçilen ${roster.length} oyuncunun ${formatMapTitle(selectedMap)} maçları taranıyor…`);
    try {
      const payload = await jsonRequest<SquadDiscoveryPayload>("/squads/discover", {
        method: "POST",
        body: JSON.stringify({ roster, map: selectedMap, ownerSteamId: selectedOwnerSteamId, refresh }),
      });
      if (requestId !== discoveryRequestRef.current) return;
      const analyzed = payload.candidates || [];
      const available = payload.availableMatches || [];
      setCandidates(analyzed);
      setSelectedMatchIds(analyzed.map((item) => item.id));
      setDiscoverableMatches(available);
      setCoverage(payload.coverage || []);
      if (available.length > 0) {
        setMessage("");
      } else if (payload.eligible) {
        setMessage("");
      } else if (payload.scan.requiresLogin) {
        setMessage(`${analyzed.length} analiz edilmiş maç bulundu. Daha fazlasını otomatik aramak için Son Maçlarım bölümünden Steam bağlantısını kur.`);
      } else {
        const missing = (payload.coverage || []).filter((item) => !item.eligible).map((item) => `${item.player.name}: ${item.analyzedMatches}/3`).join(" · ");
        setMessage(`Steam taraması tamamlandı. Rapor için her seçili oyuncuda en az 3 maç gerekli${missing ? ` (${missing})` : ""}.`);
      }
    } catch (error) {
      if (requestId === discoveryRequestRef.current) {
        setMessage(error instanceof Error ? error.message : "Eşleşen maçlar bulunamadı.");
      }
    } finally {
      if (requestId === discoveryRequestRef.current) setDiscovering(false);
    }
  }, []);

  useEffect(() => {
    if (tab !== "setup" || selectedRoster.length === 0 || !map) return;
    const timer = window.setTimeout(() => {
      void discoverSelection(selectedRoster, map, ownerSteamId, true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [discoverSelection, map, ownerSteamId, selectedRoster, tab]);

  useEffect(() => {
    if (tab !== "live" || !squadId || !live?.active) return;
    const timer = window.setInterval(() => {
      void jsonRequest<{ session: LiveSession }>(`/squads/${encodeURIComponent(squadId)}/live`)
        .then((payload) => {
          setLive((current) => current?.updatedAt === payload.session.updatedAt ? current : payload.session);
        })
        .catch(() => { /* Companion geçici olarak meşgulse mevcut plan ekranda kalır. */ });
    }, 1500);
    return () => window.clearInterval(timer);
  }, [tab, squadId, live?.active]);

  function chooseSeed(matchId: string) {
    discoveryRequestRef.current += 1;
    const selected = matches.find((item) => item.id === matchId);
    setSeedId(matchId);
    setTeamId("");
    setSelectedPlayerIds([]);
    setMap(selected?.map || "");
    setCandidates([]);
    setDiscoverableMatches([]);
    setCoverage([]);
    setDiscoveryDismissed(false);
    setSelectedMatchIds([]);
    setReport(null);
    setTab("setup");
  }

  function chooseTeam(selectedTeamId: string) {
    discoveryRequestRef.current += 1;
    const team = seedMatch?.teams.find((item) => item.id === selectedTeamId);
    setTeamId(selectedTeamId);
    setSelectedPlayerIds(team?.players.map((player) => player.steamid) || []);
    setCandidates([]);
    setSelectedMatchIds([]);
    setDiscoverableMatches([]);
    setCoverage([]);
    setDiscoveryDismissed(false);
    setMessage("");
  }

  function togglePlayer(steamid: string) {
    discoveryRequestRef.current += 1;
    setSelectedPlayerIds((current) => current.includes(steamid) ? current.filter((id) => id !== steamid) : [...current, steamid]);
    setCandidates([]);
    setSelectedMatchIds([]);
    setDiscoverableMatches([]);
    setCoverage([]);
    setDiscoveryDismissed(false);
    setMessage("");
  }

  function chooseMap(selectedMap: string) {
    discoveryRequestRef.current += 1;
    setMap(selectedMap);
    setCandidates([]);
    setSelectedMatchIds([]);
    setDiscoverableMatches([]);
    setCoverage([]);
    setDiscoveryDismissed(false);
    setMessage("");
  }

  async function downloadDiscoveredMatches() {
    if (selectedRoster.length === 0 || discoverableMatches.length === 0) return;
    const requested = [...discoverableMatches];
    setBulkDownloading(true);
    setDiscoveryDismissed(false);
    setMessage(`${requested.length} demo sırayla indiriliyor ve analiz ediliyor. Bu işlem birkaç dakika sürebilir…`);
    try {
      const payload = await jsonRequest<{
        complete: boolean;
        downloaded: Array<{ id: string; message: string }>;
        failed: Array<{ id: string; message: string }>;
        candidates: SquadMatch[];
        coverage: PlayerCoverage[];
        eligible: boolean;
      }>("/squads/download", {
        method: "POST",
        body: JSON.stringify({ roster: selectedRoster, map, ownerSteamId, matchIds: requested.map((item) => item.id) }),
      });
      const completedIds = new Set((payload.downloaded || []).map((item) => item.id));
      const analyzed = payload.candidates || [];
      setCandidates(analyzed);
      setSelectedMatchIds(analyzed.map((item) => item.id));
      setCoverage(payload.coverage || []);
      setDiscoverableMatches((current) => current.filter((item) => !completedIds.has(item.id)));
      if (payload.downloaded?.length) toast.success(`${payload.downloaded.length} eşleşen maç indirildi ve takım kanıtına eklendi.`);
      if (!payload.complete) {
        const failedCount = Math.max(payload.failed?.length || 0, requested.length - (payload.downloaded?.length || 0));
        setMessage(`${failedCount} maç indirilemedi. Başarılı olanlar korundu; kalanları yeniden deneyebilirsin.`);
      } else {
        setMessage(payload.eligible ? "İndirme tamamlandı. Seçilen tüm oyuncular için yeterli maç hazır." : "İndirme tamamlandı; bazı oyuncular için hâlâ 3 analiz edilmiş maç bulunamadı.");
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Eşleşen maçlar indirilemedi.");
    } finally {
      setBulkDownloading(false);
    }
  }

  async function generateReport() {
    if (selectedRoster.length === 0 || !selectionEligible) return;
    setBusy(true);
    setMessage(`${selectedRoster.length} oyuncunun bağımsız maç kanıtları birleştiriliyor ve oyun planı hazırlanıyor…`);
    try {
      const payload = await jsonRequest<{ squad: SavedSquad; report: SquadReport }>("/squads/report", {
        method: "POST",
        body: JSON.stringify({ roster: selectedRoster, map, ownerSteamId, selectedMatchIds, name: selectedRoster.map((player) => player.name).join(", ") }),
      });
      setReport(payload.report);
      setSquadId(payload.squad.id);
      setNotes(payload.squad.notes || "");
      setTab("overview");
      setMessage("");
      toast.success("Takım koçu raporu hazır.");
      void loadArchive();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Takım raporu üretilemedi.");
    } finally {
      setBusy(false);
    }
  }

  function openSavedSquad(squad: SavedSquad) {
    if (!squad.report) return;
    setReport(squad.report);
    setSquadId(squad.id);
    setMap(squad.map);
    setNotes(squad.notes || "");
    setTab("overview");
    setMessage("");
  }

  async function startLive() {
    if (!squadId) return;
    setBusy(true);
    try {
      const payload = await jsonRequest<{ session: LiveSession }>(`/squads/${encodeURIComponent(squadId)}/live/start`, { method: "POST", body: "{}" });
      setLive(payload.session);
      setNotes(payload.session.notes || "");
      setTab("live");
      toast.success("Canlı takım tahtası başlatıldı.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Canlı takım tahtası başlatılamadı.");
    } finally {
      setBusy(false);
    }
  }

  async function sendFeedback(outcome?: "success" | "failed", personal?: boolean) {
    if (!squadId) return;
    try {
      const payload = await jsonRequest<{ session: LiveSession }>(`/squads/${encodeURIComponent(squadId)}/live/feedback`, {
        method: "POST",
        body: JSON.stringify({ outcome, personal, reason: personal ? "Bu planda kişisel uygulama sorunu yaşandı." : outcome === "success" ? "Takım planı uygulandı ve başarılı oldu." : "Takım planı uygulandı fakat rota başarısız oldu.", notes }),
      });
      setLive(payload.session);
      toast.info(personal ? "Kişisel sinyal kaydedildi; takım rotası cezalandırılmadı." : outcome === "failed" ? "Rota cooldown’a alındı." : "Başarılı plan kanıtı kaydedildi.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Geri bildirim kaydedilemedi.");
    }
  }

  async function saveNotes() {
    if (!squadId) return;
    try {
      await jsonRequest(`/squads/${encodeURIComponent(squadId)}/notes`, { method: "PUT", body: JSON.stringify({ notes }) });
      toast.success("Takım notları kaydedildi.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Notlar kaydedilemedi.");
    }
  }

  return (
    <section className={`squad-coach-workspace ${focusMode ? "squad-focus-mode" : ""} ${tab === "live" && live?.connected ? "performance-mode" : ""}`}>
      <header className="squad-coach-header">
        <div>
          <p className="eyebrow">PROFESYONEL TAKIM KOÇLUĞU</p>
          <h1>{report ? `${report.mapLabel} maç planı` : "Seçtiğin oyuncular için maç planı oluştur."}</h1>
          <p>Her oyuncu için seninle aynı takımda, aynı haritada oynanmış en az üç analiz edilmiş demo kullanılır; oyuncuların aynı maçta bulunması gerekmez.</p>
        </div>
        <div className="squad-header-actions">
          <button className="ghost-button" onClick={() => void loadArchive()} disabled={loading}><IconRefresh size={14} /> Arşivi yenile</button>
          {report && <button className="upload-button" onClick={() => void startLive()} disabled={busy}><IconZap size={14} /> Canlı tahtayı aç</button>}
        </div>
      </header>

      {savedSquads.length > 0 && tab === "setup" && (
        <div className="saved-squad-strip">
          <span>KAYITLI RAPORLAR</span>
          {savedSquads.map((squad) => <button key={squad.id} onClick={() => openSavedSquad(squad)} title={squadNames(squad.roster)}><MapEmblem mapName={squad.map} size={28} /><b>{squadNames(squad.roster)}</b><small>{formatMapTitle(squad.map)} · {new Date(squad.updatedAt).toLocaleDateString("tr-TR")}</small></button>)}
        </div>
      )}

      {report && (
        <nav className="squad-tabs" aria-label="Takım raporu bölümleri">
          <button className={tab === "setup" ? "active" : ""} onClick={() => setTab("setup")}>Yeni rapor</button>
          <button className={tab === "overview" ? "active" : ""} onClick={() => setTab("overview")}>Takım özeti</button>
          <button className={tab === "roles" ? "active" : ""} onClick={() => setTab("roles")}>Roller & silahlar</button>
          <button className={tab === "playbook" ? "active" : ""} onClick={() => setTab("playbook")}>Oyun kitabı</button>
          <button className={tab === "live" ? "active live" : "live"} onClick={() => live ? setTab("live") : void startLive()}><span /> Canlı round</button>
        </nav>
      )}

      {message && <div className="squad-message"><IconWarning size={15} /> {message}</div>}

      {tab === "setup" && (
        <div className="squad-setup-grid">
          <section className="squad-step-card">
            <div className="squad-step-title"><span>01</span><div><b>Referans maçı seç</b><small>Seçilebilir takım arkadaşlarını bu eski maçtan çıkaracağız.</small></div></div>
            {loading ? <p className="squad-empty">Takım arşivi hazırlanıyor…</p> : matches.length === 0 ? <p className="squad-empty">Henüz iki tam takımı ayrıştırılmış bir maç yok.</p> : (
              <div className="squad-match-list">{matches.map((item) => <button key={item.id} className={seedId === item.id ? "selected" : ""} onClick={() => chooseSeed(item.id)}><MapEmblem mapName={item.map} size={34} /><span><b>{formatMapTitle(item.map)}</b><small>{item.formattedDate || new Date(item.timestamp).toLocaleString("tr-TR")} · {item.score?.rawScore || "Skor yok"}</small></span>{seedId === item.id && <IconCheck size={15} />}</button>)}</div>
            )}
          </section>

          <section className="squad-step-card">
            <div className="squad-step-title"><span>02</span><div><b>Takımını ve oyuncuları seç</b><small>Yalnızca işaretlediğin 1–5 oyuncu için plan hazırlanır.</small></div></div>
            {!seedMatch ? <p className="squad-empty">Önce referans maç seç.</p> : <>
              <div className="squad-team-choices">{seedMatch.teams.map((team, index) => <button key={team.id} className={teamId === team.id ? "selected" : ""} onClick={() => chooseTeam(team.id)}><strong>Takım {index + 1}</strong>{team.players.map((player) => <span key={player.steamid}>{player.name}{player.steamid === ownerSteamId && <em>SEN</em>}<small>{player.steamid.slice(-6)}</small></span>)}</button>)}</div>
              {selectedTeam && <div className="squad-player-picker"><b>PLANLANACAK OYUNCULAR · {selectedRoster.length}</b>{selectedTeam.players.map((player) => <label key={player.steamid} className={selectedPlayerIds.includes(player.steamid) ? "selected" : ""}><input type="checkbox" checked={selectedPlayerIds.includes(player.steamid)} onChange={() => togglePlayer(player.steamid)} /><span>{player.name}{player.steamid === ownerSteamId && <small>SEN</small>}</span></label>)}</div>}
            </>}
          </section>

          <section className="squad-step-card">
            <div className="squad-step-title"><span>03</span><div><b>Haritayı ve kanıtları seç</b><small>Takımı seçince Steam geçmişi otomatik taranır.</small></div></div>
            <label className="squad-map-select"><IconMap size={15} /><select value={map} onChange={(event) => chooseMap(event.target.value)} disabled={!selectedTeam || discovering || bulkDownloading}>{maps.map((item) => <option key={item} value={item}>{formatMapTitle(item)}</option>)}</select></label>
            {discovering && (
              <div className="squad-discovery-status scanning"><IconRefresh size={14} className="spin-icon" /><span><b>Seçili oyuncular aranıyor</b><small>Her oyuncunun seninle aynı takımda olduğu Premier, Ranked, Rekabetçi ve Yoldaş maçları taranıyor…</small></span></div>
            )}
            {!discovering && discoverableMatches.length > 0 && !discoveryDismissed && (
              <div className="squad-discovery-prompt" role="alert">
                <header><IconSparkles size={15} /><div><b>{discoverableMatches.length} gerekli demo bulundu</b><small>{formatMapTitle(map)} · kişi başına 3 maç eşiğini tamamlayan en küçük indirme grubu</small></div></header>
                <div className="squad-discovery-list">
                  {discoverableMatches.slice(0, 5).map((item) => <span key={item.id}><b>{item.formattedDate || new Date(item.timestamp).toLocaleDateString("tr-TR")}</b><small>{item.mode || "CS2"} · {item.score?.rawScore || "Skor yok"} · {selectedRoster.filter((player) => item.matchedPlayerIds?.includes(player.steamid)).map((player) => player.name).join(", ")}</small></span>)}
                  {discoverableMatches.length > 5 && <em>+{discoverableMatches.length - 5} maç daha</em>}
                </div>
                <p>Bu maçlar indirilip Valve demosundan analiz edilsin ve takım raporuna eklensin mi?</p>
                <div className="squad-discovery-actions">
                  <button className="approve" onClick={() => void downloadDiscoveredMatches()} disabled={bulkDownloading}>{bulkDownloading ? "İndiriliyor ve analiz ediliyor…" : `Evet, ${discoverableMatches.length} maçı indir`}</button>
                  <button onClick={() => { setDiscoveryDismissed(true); setMessage("Bulunan maçlar indirilmedi. İstersen tekrar tarayıp onaylayabilirsin."); }} disabled={bulkDownloading}>Hayır, şimdilik geç</button>
                </div>
              </div>
            )}
            {!discovering && discoveryDismissed && discoverableMatches.length > 0 && (
              <button className="squad-discovery-reopen" onClick={() => { setDiscoveryDismissed(false); setMessage(""); }}><IconSparkles size={13} /> {discoverableMatches.length} bulunan maçı tekrar göster</button>
            )}
            {!discovering && selectedTeam && (
              <button className="squad-rescan-button" onClick={() => void discoverSelection(selectedRoster, map, ownerSteamId, true)} disabled={bulkDownloading || selectedRoster.length === 0}><IconRefresh size={12} /> Steam geçmişini yeniden tara</button>
            )}
            {selectedRoster.length > 0 && <div className="squad-player-coverage">{selectedCoverage.map((item) => <article key={item.player.steamid} className={item.eligible ? "ready" : "missing"}><span>{item.player.name}</span><b>{item.analyzedMatches}/3 analiz</b>{!item.eligible && item.availableMatches > 0 ? <small>{Math.min(item.requiredDownloads, item.availableMatches)} demo indirilebilir</small> : !item.eligible ? <small>{item.requiredDownloads} maç daha gerekli</small> : <small>Hazır</small>}</article>)}</div>}
            <div className="candidate-list">{candidates.map((candidate) => <label key={candidate.id}><input type="checkbox" checked={selectedMatchIds.includes(candidate.id)} onChange={(event) => setSelectedMatchIds((current) => event.target.checked ? [...new Set([...current, candidate.id])] : current.filter((id) => id !== candidate.id))} /><MapEmblem mapName={candidate.map} size={26} /><span><b>{candidate.formattedDate || new Date(candidate.timestamp).toLocaleDateString("tr-TR")}</b><small>{candidate.score?.rawScore || candidate.id} · {selectedRoster.filter((player) => candidate.matchedPlayerIds?.includes(player.steamid)).map((player) => player.name).join(", ")}</small></span></label>)}</div>
            <button className="squad-generate-button" disabled={!selectionEligible || busy || discovering || bulkDownloading} onClick={() => void generateReport()}><IconSparkles size={16} /> {busy ? "Analiz ediliyor…" : `${selectedRoster.length} oyuncu · ${selectedMatchIds.length} benzersiz maçtan rapor üret`}</button>
          </section>
        </div>
      )}

      {report && tab === "overview" && (
        <div className="squad-report-grid">
          <section className="squad-hero-card">
            <MapEmblem mapName={report.map} size={72} />
            <div><span>{report.evidence.evidence.matches} MAÇ · {report.evidence.evidence.teamRounds} ROUND</span><h2>{report.mapLabel} takım kimliği</h2><p>Genel kanıt güveni <b>%{report.evidence.evidence.confidence} · {report.evidence.evidence.confidenceLabel}</b>. Öneriler tek maç anekdotundan değil, seçilen maçların tamamından üretildi.</p></div>
            <em className={confidenceClass(report.evidence.evidence.confidence)}>%{report.evidence.evidence.confidence}</em>
          </section>
          <section className="squad-player-cards">{report.playerCards.map((card) => <article key={card.player.steamid}><header><b>{card.player.name}</b><span className={confidenceClass(card.confidence.confidence)}>%{card.confidence.confidence}</span></header><div><span>K/D <b>{card.overall.kd}</b></span><span>ADR <b>{card.overall.adr}</b></span><span>Opening <b>{card.overall.openingDelta > 0 ? "+" : ""}{card.overall.openingDelta}</b></span></div><p>CT: <b>{card.bestCTRoute?.zone || "yeterli rota yok"}</b>{card.bestCTRoute && ` · %${card.bestCTRoute.adjustedWinRate}`}</p><p>T: <b>{card.bestTRoute?.zone || "yeterli rota yok"}</b>{card.bestTRoute && ` · %${card.bestTRoute.adjustedWinRate}`}</p><small>{card.confidence.matches} maç / {card.confidence.rounds} round kanıtı</small></article>)}</section>
          <section className="squad-limitations"><IconShield size={16} /><div><b>Güvenlik ve gerçekçilik sınırı</b>{report.limitations.map((item) => <p key={item}>{item}</p>)}</div></section>
        </div>
      )}

      {report && tab === "roles" && (
        <div className="squad-role-layout">
          <section className="squad-report-section"><header><IconShield size={17} /><div><h2>CT bölge dağılımı</h2><p>Rota başarısı, CT K/D-ADR ve rol uyumu birlikte optimize edildi.</p></div></header><div className="assignment-list">{report.assignments.ct.map((item) => <article key={item.player.steamid}><span>{item.positionLabel}</span><b>{item.player.name}</b><small>Uyum {Math.round(item.fitScore)} · kanıt %{item.confidence}</small></article>)}</div></section>
          <section className="squad-report-section"><header><IconPlan size={17} /><div><h2>T görev dağılımı</h2><p>Seçilen oyunculara tekil görev atanır; bilinmeyen takım üyeleri için görev uydurulmaz.</p></div></header><div className="assignment-list">{report.assignments.t.map((item) => <article key={item.player.steamid}><span>{item.roleLabel}</span><b>{item.player.name}</b><small>{item.description} · uyum {Math.round(item.fitScore)}</small></article>)}</div></section>
          <section className="squad-report-section squad-weapons"><header><IconWeapon size={17} /><div><h2>Silah ekonomisi</h2><p>AWP, rifle, SMG ve yakın alan örneğine göre dağıtılır.</p></div></header><div className="weapon-assignment-list">{report.weapons.map((item) => <article key={item.player.steamid}><div><span>{statusLabel(item.status)}</span><b>{item.player.name}</b></div><p><strong>{item.primaryBuy}</strong><small>{item.secondaryBuy}</small></p><em>%{item.evidence.confidence} kanıt</em></article>)}</div></section>
        </div>
      )}

      {report && tab === "playbook" && (
        <div className="squad-playbook-layout">
          <section className="playbook-rules"><h2>Takım protokolü</h2>{report.playbook.rules.map((rule, index) => <p key={rule}><span>0{index + 1}</span>{rule}</p>)}</section>
          <section className="round-plan-list">{report.playbook.roundPlans.map((plan) => <article key={plan.id}><header><div><span>{plan.side} · {plan.buy.replaceAll("_", " ")}</span><h3>{plan.title}</h3><p>{plan.lane} · {plan.goal}</p></div>{plan.evidence && <em>%{plan.evidence.historicalScore}<small>%{plan.evidence.confidence} güven</small></em>}</header><ol>{plan.tasks.map((task, index) => <li key={`${task.playerName}-${index}`}><b>{task.playerName}</b><span>{task.text}</span></li>)}</ol></article>)}</section>
        </div>
      )}

      {report && tab === "live" && (
        <div className="squad-live-layout">
          <header className="squad-live-status"><div><span className={live?.connected ? "connected" : ""} />{live?.connected ? "GSI BAĞLI · CANLI TAKIM TAHTASI" : "GSI BEKLENİYOR"}</div><b>{live?.side || "?"} · R{live?.currentPlan?.round || live?.round || 1}</b><strong>CT {live?.score?.CT || 0} : {live?.score?.T || 0} T</strong><button onClick={() => setFocusMode((value) => !value)}>{focusMode ? "Normal görünüme dön" : "Yan ekran modu"}</button></header>
          {live?.statusMessage && <div className="squad-message"><IconWarning size={15} /> {live.statusMessage}</div>}
          <section className="current-round-plan">
            <div className="round-plan-kicker"><span>BU ROUND</span><em>{live?.currentPlan?.buyState || "ekonomi bekleniyor"}</em></div>
            <h2>{live?.currentPlan?.title || "CS2 bağlantısı ve round başlangıcı bekleniyor"}</h2>
            <p>{live?.currentPlan?.goal || "GSI yapılandırmasını Canlı Koç ekranından kurduktan sonra plan otomatik gelecek."}</p>
            {live?.currentPlan && <><div className="live-lane"><IconZap size={15} /> Ana rota: <b>{live.currentPlan.lane}</b></div><div className="live-task-grid">{live.currentPlan.tasks.map((task, index) => <article key={`${task.playerName}-${index}`}><span>{task.role}</span><b>{task.playerName}</b><p>{task.text}</p></article>)}</div><small className="adaptation-note">{live.currentPlan.adaptation}</small></>}
          </section>
          <aside className="live-coach-side">
            <section><h3>Round geri bildirimi</h3><p>Otomatik GSI sonucu gelmezse takım sonucunu elle işaretle.</p><div className="feedback-buttons"><button className="success" onClick={() => void sendFeedback("success")}>Plan başarılı</button><button className="failed" onClick={() => void sendFeedback("failed")}>Rota işlemedi</button><button onClick={() => void sendFeedback(undefined, true)}>Sadece kişisel hata</button></div></section>
            <section><h3>Takım notları</h3><textarea value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Utility sırası, rakip alışkanlığı, round çağrısı…" /><button className="ghost-button" onClick={() => void saveNotes()}>Notları kaydet</button></section>
            <section className="gsi-capability"><h3>Veri kapsamı</h3><p>{live?.capability?.message || "Canlı veri bekleniyor."}</p><small>Radmin/VPN gerekmez. Her oyuncunun aynı demo ve canlı maç verisinden deterministik plan üretmesi yeterlidir.</small></section>
          </aside>
          <section className="live-history"><h3>Son kararlar</h3>{live?.history?.length ? [...live.history].reverse().slice(0, 6).map((item) => <div key={`${item.round}-${item.planId}`} className={item.outcome}><span>R{item.round}</span><b>{item.title}</b><small>{item.outcome === "success" ? "Başarılı" : "Başarısız · cooldown"}</small></div>) : <p>Henüz tamamlanan plan yok.</p>}{live?.personalEvents?.slice(-1)[0] && <div className="personal-event"><IconWarning size={13} /> {live.personalEvents.slice(-1)[0].message}</div>}</section>
        </div>
      )}
    </section>
  );
}
