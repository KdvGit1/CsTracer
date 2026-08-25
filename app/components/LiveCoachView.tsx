"use client";

import { useEffect, useState, useRef } from "react";
import {
  IconCrosshair,
  IconShield,
  IconWeapon,
  IconSparkles,
  IconWarning,
  IconCheck,
  IconSettings,
  IconZap,
  IconTarget,
  IconEconomy,
  IconChevronDown,
} from "./NavIcons";
import { COMPANION_URL } from "../lib/config";

export interface LiveGsiState {
  connected: boolean;
  lastPacketTime: number;
  packetCount: number;
  phase: string;
  map: {
    name: string;
    mode: string;
    phase: string;
    round: number;
    scoreCT: number;
    scoreT: number;
  };
  round: {
    phase: string;
    winTeam: string;
    bomb: string;
  };
  player: {
    name: string;
    steamid: string;
    team: "CT" | "T";
    health: number;
    armor: number;
    helmet: boolean;
    flashed: number;
    smoked: number;
    money: number;
    roundKills: number;
    roundKillHs?: number;
    roundDamage: number;
    kills: number;
    deaths: number;
    assists: number;
    mvps: number;
    score: number;
    activeWeapon: string;
    activeWeaponType: string;
    clip: number;
    reserve: number;
    weapons: { name: string; type: string; clip: number; reserve: number; isCurrent: boolean }[];
    grenades: { name: string; type: string; count: number }[];
    hasDefuser: boolean;
    speed: number;
    position: { x: number; y: number; z: number };
  };
  team: {
    totalMoney: number;
    aliveCountCT: number;
    aliveCountT: number;
    totalUtility: {
      smoke: number;
      flash: number;
      molly: number;
      he: number;
    };
  };
  diagnostics: {
    movingShots: number;
    stationaryShots: number;
    reloadsInDanger: number;
    lastCounterStrafeError: number;
  };
  activeAdvice?: {
    title: string;
    body: string;
    priority: "urgent" | "moderate" | "positive";
    round: number;
    type: "aim" | "discipline" | "economy" | "position";
  };
  roundMistakes: Array<{
    round: number;
    type: string;
    text: string;
    time: number;
  }>;
}

interface LiveCoachViewProps {
  onBack: () => void;
}

function liveUiSignature(state: LiveGsiState) {
  return JSON.stringify({
    connected: state.connected,
    phase: state.phase,
    map: state.map,
    round: state.round,
    player: {
      name: state.player.name,
      team: state.player.team,
      health: state.player.health,
      armor: state.player.armor,
      helmet: state.player.helmet,
      money: state.player.money,
      roundKills: state.player.roundKills,
      roundKillHs: state.player.roundKillHs,
      roundDamage: state.player.roundDamage,
      kills: state.player.kills,
      deaths: state.player.deaths,
      score: state.player.score,
      activeWeapon: state.player.activeWeapon,
      clip: state.player.clip,
      reserve: state.player.reserve,
      hasDefuser: state.player.hasDefuser,
    },
    team: state.team,
    diagnostics: state.diagnostics,
    activeAdvice: state.activeAdvice,
    roundMistakes: state.roundMistakes,
  });
}

export default function LiveCoachView({ onBack }: LiveCoachViewProps) {
  const [liveState, setLiveState] = useState<LiveGsiState | null>(null);
  const [integration, setIntegration] = useState<{ installed: boolean; performanceOptimized?: boolean; profile?: string; cfgPath?: string; message?: string } | null>(null);
  const [installing, setInstalling] = useState(false);
  const [installMessage, setInstallMessage] = useState("");
  const pollTimerRef = useRef<number | null>(null);
  const pollInFlightRef = useRef(false);
  const uiSignatureRef = useRef("");

  // Check integration status
  const checkIntegration = async () => {
    try {
      const res = await fetch(`${COMPANION_URL}/gsi/status`);
      if (res.ok) {
        const data = (await res.json()) as { installed: boolean; performanceOptimized?: boolean; profile?: string; cfgPath?: string; message?: string };
        setIntegration(data);
      }
    } catch {
      setIntegration({ installed: false, message: "Yerel TRACER servisi kapalı" });
    }
  };

  // Görsel ekran 1 Hz'de yeterlidir; GSI teşhisi companion içinde 10 Hz çalışmaya
  // devam eder. Aynı görünen veri tekrar geldiyse React ağacı yeniden çizilmez.
  const pollLiveGsi = async () => {
    if (document.visibilityState !== "visible" || pollInFlightRef.current) return;
    pollInFlightRef.current = true;
    try {
      const res = await fetch(`${COMPANION_URL}/gsi/state`);
      if (res.ok) {
        const data = (await res.json()) as LiveGsiState;
        const signature = liveUiSignature(data);
        if (signature !== uiSignatureRef.current) {
          uiSignatureRef.current = signature;
          setLiveState(data);
        }
      }
    } catch {
      // offline
    } finally {
      pollInFlightRef.current = false;
    }
  };

  useEffect(() => {
    const initialPoll = window.setTimeout(() => {
      void checkIntegration();
      void pollLiveGsi();
    }, 0);
    pollTimerRef.current = window.setInterval(() => {
      void pollLiveGsi();
    }, 1000);

    return () => {
      window.clearTimeout(initialPoll);
      if (pollTimerRef.current) window.clearInterval(pollTimerRef.current);
    };
  }, []);

  const handleAutoInstall = async () => {
    setInstalling(true);
    setInstallMessage("");
    try {
      const res = await fetch(`${COMPANION_URL}/gsi/install`, { method: "POST" });
      const data = (await res.json()) as { ok?: boolean; message?: string; error?: string };
      if (res.ok && data.ok) {
        setInstallMessage(data.message || "CS2 GSI Entegrasyonu Başarıyla Kuruldu!");
        void checkIntegration();
      } else {
        setInstallMessage(`Kurulum Başarısız: ${data.error || "Bilinmeyen hata"}`);
      }
    } catch (err: unknown) {
      setInstallMessage(`Hata: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setInstalling(false);
    }
  };

  const isLiveConnected = Boolean(liveState && liveState.connected);
  const mapName = liveState?.map.name ? liveState.map.name.replace(/^de_/, "").toUpperCase() : "HARİTA BEKLENİYOR";
  const currentRound = liveState?.map.round || 1;
  const isFreezetime = liveState?.round.phase === "freezetime";
  const advice = liveState?.activeAdvice;

  // Aim / Warmup / Workshop detection
  const isTrainingMode = liveState?.map.mode === "custom" ||
    (liveState?.map.name || "").includes("aim") ||
    (liveState?.map.name || "").includes("warmup") ||
    (liveState?.map.name || "").includes("bot") ||
    (liveState?.map.name || "").includes("workshop");

  const formatWeaponName = (name?: string) => {
    if (!name) return "—";
    return name.replace(/^weapon_/, "").toUpperCase();
  };

  return (
    <section className={`workspace live-coach-workspace ${isLiveConnected ? "performance-mode" : ""}`}>
      {/* Top Header */}
      <header className="live-header">
        <div>
          <div className="live-header-badge-row">
            <span className={`live-status-indicator ${isLiveConnected ? "connected" : "waiting"}`}>
              <span className="live-pulse" />
              {isLiveConnected
                ? (isTrainingMode ? "ANTRENMAN / AIM MODU" : (isFreezetime ? "SATIN ALMA (FREEZETIME)" : "MAÇ CANLI AKIYOR"))
                : "CS2 BAĞLANTISI BEKLENİYOR"}
            </span>
            <span className="live-mode-tag">
              <IconTarget size={11} style={{ marginRight: "4px", display: "inline-block", verticalAlign: "middle" }} />
              {isLiveConnected ? "OYUN PERFORMANS MODU · GSI 10 HZ" : (isTrainingMode ? "AIM TRAINING GSI" : "REALTIME GSI V0.46")}
            </span>
          </div>
          <h1>{isLiveConnected ? `${mapName} · ${isTrainingMode ? "Aim & Refleks Antrenmanı" : `R0${currentRound} Canlı Koçluk`}` : "Canlı CS2 Maç Koçluğu"}</h1>
        </div>

        <div className="top-actions">
          <button className="ghost-button live-back-btn" onClick={onBack}>
            <IconChevronDown size={14} style={{ transform: "rotate(90deg)", marginRight: "6px", display: "inline-block", verticalAlign: "middle" }} />
            Demo Analizine Dön
          </button>
        </div>
      </header>

      {/* 1-Click CS2 Integration Status Card */}
      <div className={`live-integration-banner ${integration?.installed ? "installed" : "pending"}`}>
        <div className="integration-info">
          <span className="banner-icon">
              {integration?.installed && integration.performanceOptimized ? <IconCheck size={16} /> : <IconSettings size={16} />}
          </span>
          <div>
              <b>{integration?.installed ? (integration.performanceOptimized ? "CS2 Entegrasyonu · Performans Profili" : "CS2 Entegrasyonu Güncelleniyor") : "CS2 Otomatik Entegrasyonu Gerekli"}</b>
            <p>
              {integration?.installed
                ? `${integration.performanceOptimized ? "10 Hz düşük yük profili hazır" : "Eski profil algılandı; TRACER yeniden açıldığında otomatik güncellenir"} (${integration.cfgPath}). Profil değiştiyse CS2'yi bir kez yeniden başlat.`
                : integration?.message || "CS2 oynarken anlık koçluk alabilmek için 1-tık kurulum yapın (Ban riski %0 Valve GSI)."}
            </p>
            {installMessage && <span className="install-feedback-msg">{installMessage}</span>}
          </div>
        </div>

        {!integration?.installed && (
          <button className="primary-action-btn btn-one-click" onClick={() => void handleAutoInstall()} disabled={installing}>
            <IconSparkles size={14} style={{ marginRight: "6px" }} />
            {installing ? "Kuruluyor..." : "CS2'ye 1-Tıkla Bağla"}
          </button>
        )}
      </div>

      {/* When CS2 is NOT sending data (Idle / Waiting State) */}
      {!isLiveConnected && (
        <div className="live-waiting-card">
          <div className="live-radar-scanner">
            <div className="scanner-circle" />
            <div className="scanner-line" />
            <span className="scanner-dot" />
          </div>
          <h3>CS2 Maçı Aranıyor...</h3>
          <p>
            Counter-Strike 2’yi başlatıp bir <b>Premier</b>, <b>Rekabetçi</b>, <b>Faceit</b> veya <b>Aim Haritasına</b> girdiğinizde bu ekran otomatik olarak canlı koçluk moduna geçecektir.
          </p>
          <div className="live-feature-pills">
            <span><IconSparkles size={12} style={{ marginRight: "4px", display: "inline-block", verticalAlign: "middle" }} /> Counter-Strafe & Duruş Hatası Tespiti</span>
            <span><IconSparkles size={12} style={{ marginRight: "4px", display: "inline-block", verticalAlign: "middle" }} /> Şarjör Bağımlılığı Yakalama</span>
            <span><IconSparkles size={12} style={{ marginRight: "4px", display: "inline-block", verticalAlign: "middle" }} /> 15s Freezetime Altın Tavsiye Kartı</span>
            <span><IconSparkles size={12} style={{ marginRight: "4px", display: "inline-block", verticalAlign: "middle" }} /> Takas (Trade) & İzolasyon Uyarısı</span>
          </div>
        </div>
      )}

      {/* When CS2 IS CONNECTED (Live Match Active) */}
      {isLiveConnected && (
        <div className="live-grid-container">
          {/* 1. MATCH STRIP (HUD BAR) */}
          <div className="live-match-strip">
            <div className="live-team-badge ct">
              <span>{isTrainingMode ? "HEDEF" : "CT"}</span>
              <b>{isTrainingMode ? (liveState?.player.kills || 0) : liveState?.map.scoreCT}</b>
            </div>
            <div className="live-score-middle">
              <span className="live-map-title">{mapName}</span>
              <span className="live-round-title">{isTrainingMode ? "SERBEST AIM MODU" : `ROUND ${currentRound}`}</span>
                <small className="live-round-phase">{isTrainingMode ? "Ekonomi ve takım utility’si kapalıdır" : (isFreezetime ? "Satın Alma Süresi" : "Canlı Çatışma")}</small>
            </div>
            <div className="live-team-badge t">
              <b>{isTrainingMode ? (liveState?.player.deaths || 0) : liveState?.map.scoreT}</b>
              <span>{isTrainingMode ? "ÖLÜM" : "T"}</span>
            </div>
          </div>

          {/* 2. FREEZETIME / FOCUS ADVICE CARD */}
          {advice ? (
            <div className={`golden-advice-card priority-${advice.priority || "positive"}`}>
              <div className="advice-badge-row">
                <span className="advice-type-badge">
                  {advice.type === "aim" ? (
                    <><IconTarget size={12} style={{ marginRight: "4px", display: "inline-block", verticalAlign: "middle" }} /> AIM & MEKANİK</>
                  ) : advice.type === "discipline" ? (
                    <><IconZap size={12} style={{ marginRight: "4px", display: "inline-block", verticalAlign: "middle" }} /> DİSİPLİN & ALIŞKANLIK</>
                  ) : advice.type === "economy" ? (
                    <><IconEconomy size={12} style={{ marginRight: "4px", display: "inline-block", verticalAlign: "middle" }} /> EKONOMİ & BUY</>
                  ) : (
                    <><IconShield size={12} style={{ marginRight: "4px", display: "inline-block", verticalAlign: "middle" }} /> POZİSYON & TAKTİK</>
                  )}
                </span>
                <span className="advice-round-chip">{isTrainingMode ? "ANTRENMAN ODAĞI" : `ROUND ${advice.round} KOÇ ODAĞI`}</span>
              </div>
              <h2 className="advice-title">{advice.title}</h2>
              <p className="advice-body">{advice.body}</p>
            </div>
          ) : (
            <div className="golden-advice-card priority-positive">
              <div className="advice-badge-row">
                <span className="advice-type-badge">
                  {isTrainingMode ? (
                    <><IconTarget size={12} style={{ marginRight: "4px", display: "inline-block", verticalAlign: "middle" }} /> AIM ANTREMANI</>
                  ) : (
                    <><IconShield size={12} style={{ marginRight: "4px", display: "inline-block", verticalAlign: "middle" }} /> CANLI KOÇ HAZIR</>
                  )}
                </span>
                <span className="advice-round-chip">{isTrainingMode ? "MEKANİK ODAĞI" : "ROUND 1 BAŞLANGICI"}</span>
              </div>
              <h2 className="advice-title">{isTrainingMode ? "Duruş ve İlk Mermi Hassasiyeti" : "İlk Round: Odak ve Pre-Aim"}</h2>
              <p className="advice-body">
                {isTrainingMode
                  ? "Botlara sıkarken her atış öncesi tam duruş (counter-strafe) yap ve tetiğe basmadan önce crosshair'in kafa hizasında sabitlendiğinden emin ol."
                  : "Pistol roundunda kafaya odaklan, gereksiz hareket etmeden sakin kalarak ilk mermiyi kafa hizasına bırak."}
              </p>
            </div>
          )}

          {/* 3. CANLI BİYOMETRİ & DAVRANIŞ KARTLARI */}
          <div className="live-telemetry-grid">
            {/* Kart 1: Atış & Tetik Disiplini */}
            <div className="telemetry-card">
              <div className="telemetry-head">
                <span className="card-icon"><IconCrosshair size={16} /></span>
                <div>
                  <span className="telemetry-label">{isTrainingMode ? "HEDEF & ATIŞ TAKİBİ" : "ATIŞ VE TETİK DİSİPLİNİ"}</span>
                  <h4>{isTrainingMode ? "Vuruş & Mermi Analizi" : "Kontrollü Burst & Hasar"}</h4>
                </div>
                <b className="telemetry-score good">
                  {((liveState?.player.roundKills || 0) > 0) ? `${liveState?.player.roundKills} KILL` : "CANLI"}
                </b>
              </div>

              <p className="telemetry-desc">
                {isTrainingMode
                  ? "Bot antrenmanında tek tek kafa vuruşları (tap) veya 2-3 mermilik kısa burst'ler ile kas hafızası oluşturun."
                  : "Çatışmada panik yapmadan crosshair'i kafa hizasında tutarak kontrollü burst sıkın."}
              </p>

              <div className="telemetry-stats-row">
                <div>
                  <span>Atılan Mermi</span>
                  <b>{((liveState?.diagnostics.stationaryShots || 0) + (liveState?.diagnostics.movingShots || 0))} Atış</b>
                </div>
                <div>
                  <span>Round Hasarı</span>
                  <b>{liveState?.player.roundDamage || 0} DMG</b>
                </div>
                <div>
                  <span>Kafadan Vuruş</span>
                  <b>{liveState?.player.roundKillHs || 0} HS Kill</b>
                </div>
              </div>
            </div>

            {/* Kart 2: Şarjör & Refleks Disiplini */}
            <div className="telemetry-card">
              <div className="telemetry-head">
                <span className="card-icon"><IconWeapon size={16} /></span>
                <div>
                  <span className="telemetry-label">ALIŞKANLIK DİSİPLİNİ</span>
                  <h4>Gereksiz Reload Bağımlılığı</h4>
                </div>
                <b className={`telemetry-score ${liveState?.diagnostics.reloadsInDanger === 0 ? "good" : "warn"}`}>
                  {liveState?.diagnostics.reloadsInDanger === 0 ? "KUSURSUZ" : `${liveState?.diagnostics.reloadsInDanger} HATA`}
                </b>
              </div>

              <p className="telemetry-desc">
                {liveState?.diagnostics.reloadsInDanger === 0
                  ? "Şarjöründe mermi varken açık alanda reload yapmıyorsun."
                  : `Maç boyunca ${liveState?.diagnostics.reloadsInDanger} kez yüksek mermi varken tehlikeli alanda reload yaptın.`}
              </p>

              <div className="telemetry-stats-row">
                <div>
                  <span>Aktif Silah</span>
                  <b>{formatWeaponName(liveState?.player.activeWeapon)}</b>
                </div>
                <div>
                  <span>Şarjör</span>
                  <b>{(liveState?.player.clip ?? -1) < 0 ? "—" : `${liveState?.player.clip} / ${liveState?.player.reserve}`}</b>
                </div>
                <div>
                  <span>Can / Zırh</span>
                  <b>
                    {liveState?.player.health ?? 100} HP
                    {liveState?.player.helmet ? (
                      <IconShield size={12} style={{ display: "inline-block", marginLeft: "4px", verticalAlign: "middle", color: "#52e389" }} />
                    ) : ""}
                  </b>
                </div>
              </div>
            </div>

            {/* Kart 3: Takım / Antrenman Dashboard */}
            <div className="telemetry-card">
              <div className="telemetry-head">
                <span className="card-icon"><IconShield size={16} /></span>
                <div>
                  <span className="telemetry-label">{isTrainingMode ? "ANTRENMAN PERFORMANSI" : "TAKIM VE MÜHİMMAT"}</span>
                  <h4>{isTrainingMode ? "Aim & Skor Sayacı" : "Takım Utility Envanteri"}</h4>
                </div>
                <b className="telemetry-score good">
                  {isTrainingMode ? `${liveState?.player.kills || 0} KILL` : `$${(liveState?.team.totalMoney || 0).toLocaleString("tr-TR")}`}
                </b>
              </div>

              {isTrainingMode ? (
                <div className="utility-badge-row">
                  <span className="util-chip smoke">
                    <IconTarget size={12} style={{ marginRight: "4px", display: "inline-block", verticalAlign: "middle" }} />
                    {liveState?.player.kills || 0} Hedef Vuruldu
                  </span>
                  <span className="util-chip flash">
                    <IconZap size={12} style={{ marginRight: "4px", display: "inline-block", verticalAlign: "middle" }} />
                    {liveState?.player.score || 0} Puan
                  </span>
                  <span className="util-chip molly">
                    <IconShield size={12} style={{ marginRight: "4px", display: "inline-block", verticalAlign: "middle" }} />
                    Sonsuz Mühimmat
                  </span>
                </div>
              ) : (
                <div className="utility-badge-row">
                  <span className="util-chip smoke">{liveState?.team.totalUtility.smoke} Smoke</span>
                  <span className="util-chip flash">{liveState?.team.totalUtility.flash} Flash</span>
                  <span className="util-chip molly">{liveState?.team.totalUtility.molly} Molly</span>
                  <span className="util-chip he">{liveState?.team.totalUtility.he} HE</span>
                </div>
              )}

              <div className="telemetry-stats-row">
                <div>
                  <span>{isTrainingMode ? "Toplam Skor" : "Takım Parası"}</span>
                  <b>{isTrainingMode ? `${liveState?.player.score || 0} Puan` : `$${liveState?.team.totalMoney}`}</b>
                </div>
                <div>
                  <span>{isTrainingMode ? "Ölüm" : "Senin Paran"}</span>
                  <b>{isTrainingMode ? `${liveState?.player.deaths || 0} Kez` : `$${liveState?.player.money}`}</b>
                </div>
                <div>
                  <span>{isTrainingMode ? "Mod" : "Defuse Kiti"}</span>
                  <b>{isTrainingMode ? "Aim/Workshop" : (liveState?.player.hasDefuser ? "Var (5s)" : "Yok (10s)")}</b>
                </div>
              </div>
            </div>
          </div>

          {/* 4. CANLI ROUND HATALARI & TEŞHİS GÜNLÜĞÜ (MISTAKES LOG) */}
          <div className="live-log-card">
            <div className="section-head">
              <div>
                <p>CANLI KOÇ TEŞHİS AKIŞI</p>
                <h3>Bu Maçta Tespit Edilen Mikro Davranışlar</h3>
              </div>
            </div>

            {(!liveState?.roundMistakes || liveState.roundMistakes.length === 0) ? (
              <div className="live-clean-feedback">
                <span className="clean-spark"><IconSparkles size={16} /></span>
                <div>
                  <b>Harika gidiyorsun!</b>
                  <p>Bu round henüz kritik bir mekanik veya pozisyon hatası tespit edilmedi. Duruşunu ve pre-aim odağını koru.</p>
                </div>
              </div>
            ) : (
              <div className="mistakes-list">
                {liveState.roundMistakes.map((m, idx) => (
                  <div className="mistake-item" key={idx}>
                    <span className="mistake-badge">R0{m.round}</span>
                    <span className="mistake-icon">
                      {m.type === "counter_strafe" ? (
                        <IconWarning size={14} color="#ffb761" />
                      ) : (
                        <IconZap size={14} color="#60a5fa" />
                      )}
                    </span>
                    <p>{m.text}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
