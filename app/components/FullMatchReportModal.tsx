"use client";

import { useEffect, useState } from "react";
import { SEVERITY_LABEL } from "../lib/coaching";
import { formatReportAsMarkdown } from "../lib/report";
import type { CoachState, FullMatchReport, PlayerReport } from "../lib/types";
import { MapEmblem } from "./MapEmblem";
import {
  IconCheck,
  IconClose,
  IconCopy,
  IconRefresh,
  IconSparkles,
} from "./NavIcons";

function percentMetric(value: number | null) {
  return value === null ? "—" : `%${value}`;
}

function decimalMetric(value: number | null) {
  return value === null ? "—" : value.toFixed(1);
}

export default function FullMatchReportModal({
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

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

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
        <button className="modal-close" onClick={onClose} aria-label="Raporu kapat">
          <IconClose size={16} />
        </button>

        <header className="report-hero-head">
          <div className="report-hero-title">
            <MapEmblem mapName={playerReport.map || "unknown"} size={52} />
            <div className="report-hero-meta">
              <p className="eyebrow" style={{ color: "var(--acid)" }}>
                <IconSparkles size={12} style={{ display: "inline-block", verticalAlign: "middle", marginRight: "4px" }} />
                TRACER KAPSAMLI MAÇ KOÇLUK RAPORU
              </p>
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
              <IconRefresh size={14} className={coachState === "thinking" ? "spin-icon" : ""} style={{ marginRight: "6px" }} />
              {coachState === "thinking" ? "Analiz ediliyor…" : "Yeniden Analiz Et"}
            </button>
          </div>
        </header>

        {/* Doğrudan maç metrikleri */}
        <div className="report-scorecard-grid">
          <div className="scorecard-hero">
            <span>KAST ROUND KATKISI</span>
            <strong>{percentMetric(card.overallScore)}</strong>
            <em className="scorecard-grade-badge">{card.grade}</em>
            <small style={{ color: "#798c82", fontSize: "11px" }}>{card.sampleCount} round · {card.method}</small>
            <small style={{ color: "#9eaaa3", fontSize: "11px", lineHeight: 1.45 }}>KAST = Kill, Assist, Survived, Traded; en az birinin gerçekleştiği roundların yüzdesi.</small>
          </div>
          <div className="scorecard-dimensions">
            <div className="scorecard-dim-box">
              <span>KAST</span>
              <b>{percentMetric(card.impactScore)}</b>
              <i><em style={{ width: `${card.impactScore ?? 0}%`, background: "var(--acid)" }} /></i>
            </div>
            <div className="scorecard-dim-box">
              <span>Headshot Oranı</span>
              <b>{percentMetric(card.aimScore)}</b>
              <i><em style={{ width: `${card.aimScore ?? 0}%`, background: "#52e389" }} /></i>
            </div>
            <div className="scorecard-dim-box">
              <span>Atış Anı Hareket Uygunluğu</span>
              <b>{percentMetric(card.movementScore)}</b>
              <i><em style={{ width: `${card.movementScore ?? 0}%`, background: "#68d4ff" }} /></i>
            </div>
            <div className="scorecard-dim-box">
              <span>Takım & Trade</span>
              <b>{percentMetric(card.teamworkScore)}</b>
              <i><em style={{ width: `${card.teamworkScore ?? 0}%`, background: "#b99cff" }} /></i>
            </div>
            <div className="scorecard-dim-box">
              <span>Utility Etkili Round</span>
              <b>{percentMetric(card.utilityScore)}</b>
              <i><em style={{ width: `${card.utilityScore ?? 0}%`, background: "#ffb761" }} /></i>
            </div>
            <div className="scorecard-dim-box">
              <span>Hayatta Kalma</span>
              <b>{percentMetric(card.positionScore)}</b>
              <i><em style={{ width: `${card.positionScore ?? 0}%`, background: "#ff7e85" }} /></i>
            </div>
          </div>
        </div>

        {/* 2. Koç Başlığı & Kapsamlı Özeti */}
        <article className="report-verdict-box">
          <div className="report-verdict-head">
            <span>
              <IconSparkles size={12} style={{ display: "inline-block", verticalAlign: "middle", marginRight: "4px" }} />
              {reportData.isAiGenerated ? "YEREL AI KOÇ SENTEZİ & KURAL MOTORU" : "KANITA DAYALI KURAL MOTORU RAPORU"}
            </span>
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
              <b>{reportData.sideReview.ctAdr !== null || reportData.sideReview.tAdr !== null ? "Taraf Verisi Hazır" : "Ölçülemedi"}</b>
            </div>
            <div className="side-mini-row">
              <div className="side-mini-box ct">
                <span>SAVUNMA (CT)</span>
                <b>{reportData.sideReview.ctKills} K / {reportData.sideReview.ctDeaths} D · {decimalMetric(reportData.sideReview.ctAdr)} ADR</b>
              </div>
              <div className="side-mini-box t">
                <span>HÜCUM (T)</span>
                <b>{reportData.sideReview.tKills} K / {reportData.sideReview.tDeaths} D · {decimalMetric(reportData.sideReview.tAdr)} ADR</b>
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
                <span>En Yüksek Kayıtlı Katkı</span>
                <b>{reportData.weaponVerdict.strongWeapon}</b>
              </div>
              <div className="weapon-verdict-item">
                <span>En Düşük Hasar/Atış Karşılaştırması</span>
                <b>{reportData.weaponVerdict.developWeapon}</b>
              </div>
            </div>
            <p style={{ margin: 0, fontSize: "11.5px", color: "#b3c3bb", lineHeight: "1.45" }}>
              <strong>Ölçüm notu:</strong> {reportData.weaponVerdict.tip}
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
                <em key={i} className="aim-strength-pill" style={{ borderColor: "#2d4e38", color: "#85e8a5" }}>
                  <IconCheck size={11} style={{ display: "inline-block", verticalAlign: "middle", marginRight: "3px" }} />
                  {str}
                </em>
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
