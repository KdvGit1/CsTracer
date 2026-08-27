import React, { useState } from "react";
import type { CoachEngine, CoachState, PlayerReport } from "../lib/types";
import { IconSparkles } from "./NavIcons";

export interface AimCoachDiagnosis {
  id: string;
  category: "preaim" | "movement" | "burst" | "recoil" | "ttd" | "hitbox";
  title: string;
  severity: "high" | "moderate" | "minor" | "good";
  evidence: string;
  rootCause: string;
  drill: {
    name: string;
    duration: string;
    target: string;
    instructions: string;
  };
}

export function evaluateAimMechanics(report: PlayerReport): {
  score: number | null;
  rating: string;
  diagnoses: AimCoachDiagnosis[];
  routine: Array<{ step: number; title: string; duration: string; drill: string; goal: string }>;
  strengths: string[];
} {
  const diagnoses: AimCoachDiagnosis[] = [];
  const strengths: string[] = [];

  const crosshair = report.crosshairStats;
  const spray = report.sprayStats;
  const duel = report.duelStats;
  const movement = report.movementProfile;

  // Kill tick'indeki hizalama ve approximate-spotted TTD yalnız bilgi olarak
  // taşınır. Harita raycast'i olmadığı için bu ikisinden pre-aim veya reaksiyon
  // seviyesi hükmü üretilmez.
  void crosshair;
  void duel;

  // Silahın demo içindeki max_speed değerinin %34 doğruluk sınırı kullanılır.
  const rifleStats = movement?.byCategory?.rifle;
  if (movement?.status === "measured" && rifleStats && rifleStats.shots >= 8 && rifleStats.movingPercent >= 20) {
    diagnoses.push({
      id: "rifle_counter_strafe",
      category: "movement",
      title: "Tüfek atışlarında doğruluk hız sınırı sık aşılıyor",
      severity: rifleStats.movingPercent >= 35 ? "high" : "moderate",
      evidence: `${rifleStats.shots} ölçülen tüfek atışının %${rifleStats.movingPercent}'inde hız, silahın max_speed değerinin %34'ünü aştı veya oyuncu havadaydı.`,
      rootCause: "Atış tick'indeki hareket, oyunun silah doğruluğunu geri kazandığı hız bandının üzerinde kalıyor.",
      drill: {
        name: "A-D Frenleme ve Atış Zamanlaması Drill'i",
        duration: "10 dk (Aim Botz veya DM)",
        target: "Sonraki demoda geçersiz hızlı tüfek atışı sayısını azaltmak",
        instructions: "Aim Botz'da sağa koşarken tam durmak için anında A tuşuna tek tık yap, hız sıfırlandığı milisaniyede 2 mermi burst sık. Ritim: D -> A-tık -> Ateş.",
      },
    });
  }

  const sniperStats = movement?.byCategory?.sniper;
  if (movement?.status === "measured" && sniperStats && sniperStats.shots >= 5 && sniperStats.movingPercent >= 20) {
    diagnoses.push({
      id: "sniper_moving",
      category: "movement",
      title: "Sniper atışlarında doğruluk hız sınırı aşılıyor",
      severity: sniperStats.movingPercent >= 40 ? "high" : "moderate",
      evidence: `${sniperStats.shots} ölçülen sniper atışının %${sniperStats.movingPercent}'inde max_speed tabanlı doğruluk sınırı aşıldı.`,
      rootCause: "Atış, silahın demo içinde bildirdiği doğruluk hızına dönmeden yapılıyor.",
      drill: {
        name: "AWP Stop-and-Shoot Disiplini",
        duration: "10 dk",
        target: "Sonraki demoda sınır üstü sniper atışlarını azaltmak",
        instructions: "Açıdan çıkış anında zıt tuşla sert fren yap, scope içindeki kırmızı nokta netleştiği an ateş et ve hemen geriye un-peek yap.",
      },
    });
  }

  // Aynı oyuncunun ilk 3 ve 4+ mermileri birbiriyle kıyaslanır; dışarıdan
  // "pro" eşiği uygulanmaz.
  const sprayCurrent = spray?.method === "bullet-damage-event-tick-v2";
  const hitboxCurrent = sprayCurrent && spray?.hitboxMethod === "player-hurt-hitgroup-v2";
  if (sprayCurrent && spray?.status === "measured") {
    if (spray.earlyAccuracy !== null && spray.lateAccuracy !== null && spray.earlyShots >= 6 && spray.lateShots >= 6 && spray.lateAccuracy < spray.earlyAccuracy * 0.5) {
      diagnoses.push({
        id: "spray_control_decay",
        category: "recoil",
        title: "Uzayan spreyde kişisel isabet belirgin düşüyor",
        severity: spray.lateAccuracy < spray.earlyAccuracy * 0.3 ? "high" : "moderate",
        evidence: `${spray.earlyShots} ilk-3 örneğinde isabet %${spray.earlyAccuracy}; ${spray.lateShots} adet 4+ mermi örneğinde %${spray.lateAccuracy}.`,
        rootCause: "Aynı maç içinde uzun sprey isabeti kısa burst isabetinin yarısından az kaldı.",
        drill: {
          name: "Recoil Master & 3-Mermi Reset Drill'i",
          duration: "12 dk",
          target: "Sonraki demoda kısa/uzun seri isabet farkını azaltmak",
          instructions: "Recoil Master haritasında AK-47 ilk 15 mermi desenini çalış. Maç içinde 3 mermide vuramazsan spreyi sürdürme; strafe atıp recoil sıfırla.",
        },
      });
    }

  }

  if (hitboxCurrent && spray?.hitboxStatus === "measured") {
    const hitboxSamples = spray.hitboxSampleCount ?? Object.values(spray.hitboxCounts).reduce((sum, count) => sum + (count || 0), 0);
    if (hitboxSamples >= 5 && spray.hitboxPercents.legs > spray.hitboxPercents.head + spray.hitboxPercents.chest) {
      diagnoses.push({
        id: "lazy_crosshair_legs",
        category: "hitbox",
        title: "Bacak isabetleri kafa ve göğüs isabetlerinin toplamını aşıyor",
        severity: "moderate",
        evidence: `İsabet eden mermilerin %${spray.hitboxPercents.legs}'i bacaklara vurdu.`,
        rootCause: "Hitgroup dağılımı bu maçta alt gövdeye yoğunlaşıyor; bunun mesafe veya hedef duruşundan kaynaklanıp kaynaklanmadığı roundda doğrulanmalı.",
        drill: {
          name: "Dikey Kafa Hizası Kilitleme Drill'i",
          duration: "10 dk",
          target: "Sonraki demoda bacak yoğunluğunu kafa+göğüs toplamının altına indirmek",
          instructions: "Harita üzerindeki kutu kenarları ve kapı çizgilerini referans alarak nişangahı daima göz hizasında taşıma alışkanlığı kazan.",
        },
      });
    }
  }

  const currentAnalysis = /^3\.(?:[1-9]|\d{2,})\./.test(report.analysisVersion || "");
  const measuredSignals = [
    movement?.status === "measured" && movement.sampleCount > 0,
    sprayCurrent && spray?.status === "measured" && spray.totalShots > 0,
    hitboxCurrent && spray?.hitboxStatus === "measured" && (spray.hitboxSampleCount || 0) > 0,
  ].filter(Boolean).length;
  const rating = !currentAnalysis
    ? "Yeniden analiz et"
    : measuredSignals === 0
    ? "Yeterli veri yok"
    : diagnoses.some((item) => item.severity === "high")
    ? "Geliştirilmeli"
    : diagnoses.some((item) => item.severity === "moderate")
    ? "Orta"
    : "İyi";
  const score = null;

  if (currentAnalysis && movement?.status === "measured" && movement.sampleCount >= 5 && movement.invalidShotPercent < 15) {
    strengths.push(`Atış öncesi duruş iyi · ${movement.sampleCount} atışta yalnız %${movement.invalidShotPercent} sınır üstü`);
  }
  if (currentAnalysis && sprayCurrent && spray?.status === "measured" && spray.totalShots >= 5 && spray.accuracyPercent !== null && spray.accuracyPercent >= 20) {
    strengths.push(`Bu maçta silahlı isabet oranı iyi · ${spray.totalHits}/${spray.totalShots}`);
  }

  // 3 Adımlı Kişiselleştirilmiş Drill Rutini
  const routine: Array<{ step: number; title: string; duration: string; drill: string; goal: string }> = [];
  const activeDrills = diagnoses.slice(0, 3);
  if (activeDrills.length > 0) {
    activeDrills.forEach((diag, idx) => {
      routine.push({
        step: idx + 1,
        title: diag.title,
        duration: diag.drill.duration,
        drill: `${diag.drill.name}: ${diag.drill.instructions}`,
        goal: diag.drill.target,
      });
    });
  } else {
    routine.push(
      { step: 1, title: "Pre-Aim & Köşe Temizliği", duration: "10 dk", drill: "Refrag veya YPrac prefire modunda harita açılarını kafa hizasında dön.", goal: "Bir sonraki demoda aynı açılardaki kill anı hizasını karşılaştır." },
      { step: 2, title: "A-D Frenleme ve Atış Zamanlaması", duration: "10 dk", drill: "Aim Botz'da A-D zıt frenleme ile 2 mermi burst çalış.", goal: "Max-speed sınırı üstündeki atış sayısını azalt." },
      { step: 3, title: "Recoil Master İlk 15 Mermi", duration: "10 dk", drill: "AK-47 ve M4 için sprey kontrol kalıbını tazele.", goal: "İlk-3 ve 4+ mermi isabet farkını azalt." }
    );
  }

  return { score, rating, diagnoses, routine, strengths };
}

export const AimCoachCard: React.FC<{
  report: PlayerReport;
  coachEngine: CoachEngine;
  coachState: CoachState;
  hasFullReport?: boolean;
  onOpenFullReport?: () => void;
  onRunAiCoach?: () => void;
}> = React.memo(function AimCoachCard({ report, coachState, hasFullReport, onOpenFullReport, onRunAiCoach }) {
  const [rulebookOpen, setRulebookOpen] = useState(false);
  const evaluation = evaluateAimMechanics(report);

  return (
    <article className="aim-coach-card">
      <header className="aim-coach-header">
        <div>
          <span className="aim-coach-badge">NİŞANGAH & MEKANİK KANITLARI</span>
          <h3>Mekanik Hata Teşhisi ve Antrenman Reçetesi</h3>
          <p>Kural motoru yalnız doğrudan ölçülen max-speed, bullet_damage ve hitgroup verilerini kullanır. Kill anı hizası ve yaklaşık TTD bilgi amaçlıdır; pre-aim ya da profesyonel seviye hükmüne çevrilmez.</p>
        </div>
        <div className="aim-coach-score-box">
          <span>MAÇ İÇİ MEKANİK YORUMU</span>
          <b>{evaluation.rating}</b>
          <small>Rastgele puan değil · doğrudan demo kanıtı</small>
        </div>
      </header>

      {/* Güçlü Yönler */}
      {evaluation.strengths.length > 0 && (
        <div className="aim-strengths-strip">
          <span>GÜÇLÜ YÖNLER</span>
          <div className="aim-strengths-tags">
            {evaluation.strengths.map((str, i) => (
              <em key={i} className="aim-strength-pill">{str}</em>
            ))}
          </div>
        </div>
      )}

      {/* Teşhis Kartları */}
      <div className="aim-diagnoses-list">
        <div className="aim-subhead">
          <span>TESPİT EDİLEN MEKANİK EKSİKLİKLER ({evaluation.diagnoses.length})</span>
        </div>
        {evaluation.diagnoses.length === 0 ? (
          <div className="aim-clean-slate">
            <b>Ölçülen doğrudan metriklerde güçlü bir tekrar bulunmadı.</b>
            <p>Bu maçın ölçülen alanları iyi görünüyor; bu profesyonel seviye hükmü değildir. Aynı metrikleri sonraki maçlarla karşılaştır.</p>
          </div>
        ) : (
          evaluation.diagnoses.map((diag) => (
            <div key={diag.id} className={`aim-diag-item ${diag.severity}`}>
              <div className="aim-diag-head">
                <b>{diag.title}</b>
                <em className={`diag-severity-pill ${diag.severity}`}>
                  {diag.severity === "high" ? "YÜKSEK ÖNCELİK" : "ORTA ÖNCELİK"}
                </em>
              </div>
              <p className="aim-diag-evidence"><strong>Kanıt:</strong> {diag.evidence}</p>
              <p className="aim-diag-root"><strong>Mekanik Sebep:</strong> {diag.rootCause}</p>
              <div className="aim-diag-drill-box">
                <div className="drill-label">
                  <span>ÖNERİLEN DRİLL</span>
                  <b>{diag.drill.name} ({diag.drill.duration})</b>
                </div>
                <p>{diag.drill.instructions}</p>
                <small><strong>Hedef:</strong> {diag.drill.target}</small>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Günlük Antrenman Rutini */}
      <div className="aim-routine-section">
        <div className="aim-subhead">
          <span>BUGÜNKÜ 30 DAKİKALIK AİM ANTRENMAN PROGRAMIN</span>
          <small>Maça girmeden önce sırayla uygula</small>
        </div>
        <div className="aim-routine-grid">
          {evaluation.routine.map((step) => (
            <div key={step.step} className="aim-routine-card">
              <header>
                <span className="routine-step-num">{step.step}</span>
                <span className="routine-dur">{step.duration}</span>
              </header>
              <b>{step.title}</b>
              <p>{step.drill}</p>
              <footer>
                <span>Hedef Ölçüt</span>
                <strong>{step.goal}</strong>
              </footer>
            </div>
          ))}
        </div>
      </div>

      {/* Kural Kitabı & Yorumlama Rehberi Accordion */}
      <div className="aim-rulebook-wrapper">
        <button
          className="aim-rulebook-toggle"
          onClick={() => setRulebookOpen(!rulebookOpen)}
          aria-expanded={rulebookOpen}
        >
          <span>AİM KOÇLUĞU KURALLARI VE VERİ YORUMLAMA REHBERİ</span>
          <b>{rulebookOpen ? "▲ Gizle" : "▼ Rehberi İncele"}</b>
        </button>

        {rulebookOpen && (
          <div className="aim-rulebook-content">
            <p className="rulebook-intro">
              Bu rehber yalnız hesaplanabilen demo kanıtlarını ve ölçüm sınırlarını açıklar:
            </p>
            <div className="rulebook-grid">
              <article>
                <b>1. Kill Anı Hizası</b>
                <p>Nişangah ile hedef kafa/gövde açısı yalnız öldürme tick’inde ölçülür. Harita geometrisi ve görüş hattı raycast’i olmadığı için bu değer pre-aim sayılmaz ve puanlanmaz.</p>
              </article>
              <article>
                <b>2. Atış Anı Hareket Uygunluğu Kuralı</b>
                <p>Her atışta demonun verdiği silah <code>max_speed</code> alanı okunur. Yatay hız bunun <code>%34</code>’ünü aşıyorsa veya oyuncu havadaysa atış sınır üstü sayılır; bu metrik tuş girdisini veya gerçek counter-strafe yapılıp yapılmadığını ölçmez.</p>
              </article>
              <article>
                <b>3. 3-Mermi Burst vs Sprey Dağılım Kuralı</b>
                <p><code>weapon_fire</code> ile <code>bullet_damage</code>, saldırgan SteamID ve normal demo tick’i üzerinden eşleştirilir. İlk 3 ile 4+ mermi grubu yalnız yeterli örnek varsa aynı oyuncunun kendi içindeki farkla kıyaslanır.</p>
              </article>
              <article>
                <b>4. Time-to-Damage (TTD) Eşik Kuralı</b>
                <p>TTD, <code>approximate_spotted_by</code> başlangıcından ilk silahlı hasara kadar ölçülür. Bu görünürlük yaklaşık olduğundan profesyonel reaksiyon eşiği veya aim puanı üretmez.</p>
              </article>
              <article>
                <b>5. Dikey Hitbox (Lazy Crosshair) Kuralı</b>
                <p>Hitgroup dağılımı doğrudan gösterilir. Bacak isabetleri kafa ve göğüs toplamını aşarsa video incelemesi önerilir; tek başına kök sebep ilan edilmez.</p>
              </article>
              <article>
                <b>6. Keskin Nişancı (AWP) Sıfır Hız Kuralı</b>
                <p>Sniper atışlarında da aynı max-speed oranı kullanılır. Sabit silah adı eşiği veya eksik veride varsayılan hız kullanılmaz.</p>
              </article>
            </div>
          </div>
        )}
      </div>

      {/* AI Koç / Full Maç Raporu Aksiyon Butonu */}
      {(onRunAiCoach || onOpenFullReport) && (
        <div className="aim-coach-footer-action">
          {hasFullReport && onOpenFullReport ? (
            <button
              className="ollama-coach-button full-report-btn"
              onClick={onOpenFullReport}
            >
              <IconSparkles size={14} style={{ marginRight: "6px" }} />
              Kapsamlı Full Maç Koçluk Raporunu Aç
            </button>
          ) : (
            <button
              className="ollama-coach-button"
              onClick={onRunAiCoach}
              disabled={coachState === "thinking"}
            >
              <IconSparkles size={14} style={{ marginRight: "6px" }} />
              {coachState === "thinking" ? "Koç tüm maç verilerini inceliyor…" : "Tek Tuşla Full Maç Analizi & Rapor Oluştur"}
            </button>
          )}
        </div>
      )}
    </article>
  );
});
