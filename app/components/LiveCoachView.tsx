"use client";

import React, { useEffect, useState, useRef } from "react";
import { IconCrosshair, IconShield, IconWeapon, IconSparkles } from "./NavIcons";

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
    allies: { name: string; health: number; armor: number; helmet: boolean; money: number; hasDefuser: boolean }[];
    totalMoney: number;
    totalUtility: { smoke: number; flash: number; molly: number; he: number };
  };
  bomb: {
    state: string;
    countdown: number | null;
    defusing: boolean;
    plantedTime: number;
  };
  diagnostics: {
    movingShots: number;
    stationaryShots: number;
    counterStrafePercent: number;
    panicSprays: number;
    reloadsInDanger: number;
    isolatedDeaths: number;
    overpeeksInAdvantage: number;
    wastedUtilityMoney: number;
    crosshairLevelScore: number;
  };
  roundMistakes: { round: number; type: string; text: string }[];
  goldenAdvice: {
    round: number;
    title: string;
    body: string;
    type: "aim" | "position" | "economy" | "discipline";
    priority: "critical" | "warning" | "positive";
    timestamp: number;
  };
  history: any[];
}

interface GsiIntegrationStatus {
  installed: boolean;
  valid: boolean;
  cfgPath: string;
  cfgDir: string;
  message: string;
}

interface LiveCoachViewProps {
  onBack: () => void;
}

const COMPANION_URL = "http://127.0.0.1:43119";

export default function LiveCoachView({ onBack }: LiveCoachViewProps) {
  const [liveState, setLiveState] = useState<LiveGsiState | null>(null);
  const [integration, setIntegration] = useState<GsiIntegrationStatus | null>(null);
  const [installing, setInstalling] = useState(false);
  const [installMessage, setInstallMessage] = useState("");
  const pollTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Poll GSI integration status
  async function refreshGsiStatus() {
    try {
      const res = await fetch(`${COMPANION_URL}/gsi/status`);
      if (res.ok) {
        const data = (await res.json()) as GsiIntegrationStatus;
        setIntegration(data);
      }
    } catch { /* companion might be offline */ }
  }

  // 1-Click Install GSI Config
  async function handleAutoInstall() {
    setInstalling(true);
    setInstallMessage("");
    try {
      const res = await fetch(`${COMPANION_URL}/gsi/install`, { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        setInstallMessage(data.message || "CS2 GSI yapılandırması başarıyla kuruldu!");
        await refreshGsiStatus();
      } else {
        setInstallMessage(data.error || "GSI kurulumu başarısız.");
      }
    } catch (err) {
      setInstallMessage(err instanceof Error ? err.message : "Yerel parser ile bağlantı kurulamadı.");
    } finally {
      setInstalling(false);
    }
  }

  // Poll Live GSI State every 400ms for smooth real-time feedback
  useEffect(() => {
    void refreshGsiStatus();

    const fetchLiveState = async () => {
      try {
        const res = await fetch(`${COMPANION_URL}/gsi/state`);
        if (res.ok) {
          const data = (await res.json()) as LiveGsiState;
          setLiveState(data);
        }
      } catch { /* ignore */ }
    };

    void fetchLiveState();
    pollTimerRef.current = setInterval(fetchLiveState, 450);

    return () => {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    };
  }, []);

  const isLiveConnected = liveState?.connected && (liveState?.packetCount || 0) > 0;
  const isFreezetime = liveState?.round.phase === "freezetime";
  const isLiveCombat = liveState?.round.phase === "live";
  const mapName = liveState?.map.name ? liveState.map.name.toUpperCase() : "CS2 LOBİ";
  const currentRound = liveState?.map.round || 1;
  const hasShots = ((liveState?.diagnostics.stationaryShots || 0) + (liveState?.diagnostics.movingShots || 0)) > 0;
  const csPercent = hasShots ? (liveState?.diagnostics.counterStrafePercent ?? 100) : null;
  const advice = liveState?.goldenAdvice;

  return (
    <section className="workspace live-workspace" id="live-coach">
      {/* Top Header */}
      <header className="topbar">
        <div>
          <div className="live-header-badge-row">
            <span className={`live-status-indicator ${isLiveConnected ? "connected" : "waiting"}`}>
              <span className="live-pulse" />
              {isLiveConnected ? (isFreezetime ? "🟡 SATIN ALMA (FREEZETIME)" : "🔴 MAÇ CANLI AKIYOR") : "⚪ CS2 BAĞLANTISI BEKLENİYOR"}
            </span>
            <span className="live-mode-tag">REALTIME GSI V0.42</span>
          </div>
          <h1>{isLiveConnected ? `${mapName} · R0${currentRound} Canlı Koçluk` : "Canlı CS2 Maç Koçluğu"}</h1>
        </div>

        <div className="top-actions">
          <button className="ghost-button live-back-btn" onClick={onBack}>
            <span>◀</span> Demo Analizine Dön
          </button>
        </div>
      </header>

      {/* 1-Click CS2 Integration Status Card (If not installed or configured) */}
      <div className={`live-integration-banner ${integration?.installed ? "installed" : "pending"}`}>
        <div className="integration-info">
          <span className="banner-icon">{integration?.installed ? "✓" : "⚙"}</span>
          <div>
            <b>{integration?.installed ? "CS2 Entegrasyonu Etkin" : "CS2 Otomatik Entegrasyonu Gerekli"}</b>
            <p>
              {integration?.installed
                ? `Bağlantı dosyası hazır (${integration.cfgPath}). CS2 açıkken oyun içi telemetri anlık olarak bu ekrana akar.`
                : integration?.message || "CS2 oynarken anlık koçluk alabilmek için 1-tık kurulum yapın (Ban riski %0 Valve GSI)."}
            </p>
            {installMessage && <span className="install-feedback-msg">{installMessage}</span>}
          </div>
        </div>

        {!integration?.installed && (
          <button className="primary-action-btn btn-one-click" onClick={() => void handleAutoInstall()} disabled={installing}>
            <span>✦</span> {installing ? "Kuruluyor..." : "CS2'ye 1-Tıkla Bağla"}
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
            Counter-Strike 2'yi başlatıp bir <b>Premier</b>, <b>Rekabetçi</b> veya <b>Faceit</b> maçına girdiğinizde bu ekran otomatik olarak canlı koçluk moduna geçecektir.
          </p>
          <div className="live-feature-pills">
            <span>✦ Counter-Strafe & Duruş Hatası Tespiti</span>
            <span>✦ Şarjör Bağımlılığı Yakalama</span>
            <span>✦ 15s Freezetime Altın Tavsiye Kartı</span>
            <span>✦ Takas (Trade) & İzolasyon Uyarısı</span>
          </div>
        </div>
      )}

      {/* When CS2 IS CONNECTED (Live Match Active) */}
      {isLiveConnected && (
        <div className="live-grid-container">
          {/* 1. MATCH STRIP (HUD BAR) */}
          <div className="live-match-strip">
            <div className="live-team-badge ct">
              <span>CT</span>
              <b>{liveState?.map.scoreCT}</b>
            </div>
            <div className="live-score-middle">
              <span className="live-map-title">{mapName}</span>
              <span className="live-round-title">ROUND {currentRound}</span>
              <small className="live-round-phase">{isFreezetime ? "Satın Alma Süresi" : "Canlı Çatışma"}</small>
            </div>
            <div className="live-team-badge t">
              <b>{liveState?.map.scoreT}</b>
              <span>T</span>
            </div>
          </div>

          {/* 2. FREEZETIME GOLDEN ADVICE CARD (HER ROUND BAŞI 15s ODAK KARTI) */}
          {advice ? (
            <div className={`golden-advice-card priority-${advice.priority || "positive"}`}>
              <div className="advice-badge-row">
                <span className="advice-type-badge">
                  {advice.type === "aim" ? "🎯 AIM & MEKANİK" : advice.type === "discipline" ? "⚡ DİSİPLİN & ALIŞKANLIK" : advice.type === "economy" ? "💰 EKONOMİ & BUY" : "🛡️ POZİSYON & TAKTİK"}
                </span>
                <span className="advice-round-chip">ROUND {advice.round} KOÇ ODAĞI</span>
              </div>
              <h2 className="advice-title">{advice.title}</h2>
              <p className="advice-body">{advice.body}</p>
            </div>
          ) : (
            <div className="golden-advice-card priority-positive">
              <div className="advice-badge-row">
                <span className="advice-type-badge">🛡️ CANLI KOÇ HAZIR</span>
                <span className="advice-round-chip">ROUND 1 BAŞLANGICI</span>
              </div>
              <h2 className="advice-title">İlk Round: Odak ve Pre-Aim</h2>
              <p className="advice-body">Pistol roundunda kafaya odaklan, gereksiz hareket etmeden sakin kalarak ilk mermiyi kafa hizasına bırak.</p>
            </div>
          )}

          {/* 3. CANLI BİYOMETRİ & DAVRANIŞ KARTLARI (LIVE TELEMETRY CARDS) */}
          <div className="live-telemetry-grid">
            {/* Kart 1: Counter-Strafe & Mekanik */}
            <div className="telemetry-card">
              <div className="telemetry-head">
                <span className="card-icon"><IconCrosshair size={16} /></span>
                <div>
                  <span className="telemetry-label">HAREKET & COUNTER-STRAFE</span>
                  <h4>Tam Durarak Ateş Etme</h4>
                </div>
                <b className={`telemetry-score ${csPercent === null ? "neutral" : csPercent >= 80 ? "good" : csPercent >= 60 ? "warn" : "bad"}`}>
                  {csPercent === null ? "—" : `%${csPercent}`}
                </b>
              </div>

              <div className="telemetry-meter-track">
                <div
                  className={`telemetry-meter-fill ${csPercent === null ? "neutral" : csPercent >= 80 ? "good" : csPercent >= 60 ? "warn" : "bad"}`}
                  style={{ width: `${csPercent ?? 0}%` }}
                />
              </div>

              <div className="telemetry-stats-row">
                <div>
                  <span>Duruş Başarısı</span>
                  <b>{liveState?.diagnostics.stationaryShots} vuruş</b>
                </div>
                <div>
                  <span>Hareketli Sapma</span>
                  <b className={liveState?.diagnostics.movingShots ? "bad-text" : "good-text"}>
                    {liveState?.diagnostics.movingShots} hata
                  </b>
                </div>
                <div>
                  <span>Anlık Hız</span>
                  <b>{liveState?.player.speed} u/s</b>
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
                  ? "✓ Şarjöründe mermi varken açık alanda reload yapmıyorsun."
                  : `⚠ Maç boyunca ${liveState?.diagnostics.reloadsInDanger} kez yüksek mermi varken tehlikeli alanda reload yaptın.`}
              </p>

              <div className="telemetry-stats-row">
                <div>
                  <span>Aktif Silah</span>
                  <b>{liveState?.player.activeWeapon || "Silah yok"}</b>
                </div>
                <div>
                  <span>Şarjör</span>
                  <b>{liveState?.player.clip} / {liveState?.player.reserve}</b>
                </div>
                <div>
                  <span>Can / Zırh</span>
                  <b>{liveState?.player.health} HP {liveState?.player.helmet ? "🛡️" : ""}</b>
                </div>
              </div>
            </div>

            {/* Kart 3: Takım & Utility Dashboard */}
            <div className="telemetry-card">
              <div className="telemetry-head">
                <span className="card-icon"><IconShield size={16} /></span>
                <div>
                  <span className="telemetry-label">TAKIM VE MÜHİMMAT</span>
                  <h4>Takım Utility Envanteri</h4>
                </div>
                <b className="telemetry-score good">
                  ${(liveState?.team.totalMoney || 0).toLocaleString("tr-TR")}
                </b>
              </div>

              <div className="utility-badge-row">
                <span className="util-chip smoke">💨 {liveState?.team.totalUtility.smoke} Smoke</span>
                <span className="util-chip flash">⚡ {liveState?.team.totalUtility.flash} Flash</span>
                <span className="util-chip molly">🔥 {liveState?.team.totalUtility.molly} Molly</span>
                <span className="util-chip he">💣 {liveState?.team.totalUtility.he} HE</span>
              </div>

              <div className="telemetry-stats-row">
                <div>
                  <span>Takım Parası</span>
                  <b>${liveState?.team.totalMoney}</b>
                </div>
                <div>
                  <span>Senin Paran</span>
                  <b>${liveState?.player.money}</b>
                </div>
                <div>
                  <span>Defuse Kiti</span>
                  <b>{liveState?.player.hasDefuser ? "Var (5s)" : "Yok (10s)"}</b>
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
                <span className="clean-spark">✦</span>
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
                    <span className="mistake-icon">{m.type === "counter_strafe" ? "⚠️" : "⚡"}</span>
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
