import React, { useState } from "react";
import type { CoachEngine, CoachState, PlayerReport } from "../lib/types";
import { COACH_THRESHOLDS } from "../lib/coaching";
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
  score: number;
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

  // 1. Kafa Sapması & Pre-Aim Analizi
  if (crosshair) {
    if (crosshair.headErrorAngle > COACH_THRESHOLDS.headshotAngle.warnDeg || crosshair.preAimScore < COACH_THRESHOLDS.preAimScoreMin) {
      diagnoses.push({
        id: "head_angle_high",
        category: "preaim",
        title: "Kafa Sapması Yüksek (Zayıf Pre-Aim)",
        severity: crosshair.headErrorAngle > COACH_THRESHOLDS.headshotAngle.highDeg ? "high" : "moderate",
        evidence: `Düşman kafasından ortalama sapma ${crosshair.headErrorAngle}° (Pre-Aim skoru %${crosshair.preAimScore}).`,
        rootCause: "Açılardan çıkarken (peek) crosshair doğrudan düşman kafasının bulunacağı noktada değil; temas anında büyük mikro-düzeltme (flick) gerekiyor.",
        drill: {
          name: "Refrag / YPrac Pre-Aim & Prefire",
          duration: "15 dk",
          target: "Kafa sapmasını 4.0° altına düşürmek",
          instructions: `${report.map || "Oynanan harita"} haritasında pre-aim modunu aç. Açıyı görmeden önce nişangahı duvardan kafanın çıkacağı köşeye sabitleyerek tek tek peek at.`,
        },
      });
    } else if (crosshair.headErrorAngle <= COACH_THRESHOLDS.headshotAngle.strongDeg) {
      strengths.push(`Kusursuz kafa hizası (${crosshair.headErrorAngle}° sapma, %${crosshair.preAimScore} Pre-Aim)`);
    }
  }

  // 2. Hareketli Tüfek Atışları (Counter-Strafe Hatası)
  const rifleStats = movement?.byCategory?.rifle;
  if (rifleStats && rifleStats.movingPercent >= COACH_THRESHOLDS.movingShotPercent.rifle.warn) {
    diagnoses.push({
      id: "rifle_counter_strafe",
      category: "movement",
      title: "Tüfeklerle Hareketli Atış Hatası (Eksik Counter-Strafe)",
        severity: rifleStats.movingPercent >= COACH_THRESHOLDS.movingShotPercent.rifle.high ? "high" : "moderate",
      evidence: `AK-47 / M4 ile yapılan atışların %${rifleStats.movingPercent}'inde duruş hız sınırı (75 u/s) aşıldı.`,
      rootCause: "Tetiğe basılmadan önce ters hareket tuşuna (A basılıyken D'ye) dokunarak tam sıfırlama (counter-strafe) yapılmıyor; mermiler rastgele dağılıyor.",
      drill: {
        name: "A-D Counter-Strafe Senkronizasyon Drill'i",
        duration: "10 dk (Aim Botz veya DM)",
        target: "Hareketli tüfek atış oranını %8'in altına indirmek",
        instructions: "Aim Botz'da sağa koşarken tam durmak için anında A tuşuna tek tık yap, hız sıfırlandığı milisaniyede 2 mermi burst sık. Ritim: D -> A-tık -> Ateş.",
      },
    });
  } else if (rifleStats && rifleStats.movingPercent < COACH_THRESHOLDS.movingShotPercent.rifle.strong && (rifleStats.shots || 0) > COACH_THRESHOLDS.movingShotPercent.rifle.strongMinShots) {
    strengths.push(`Disiplinli counter-strafe (Tüfekte yalnızca %${rifleStats.movingPercent} hareketli atış)`);
  }

  // 3. Keskin Nişancı (AWP) Hareket Hatası
  const sniperStats = movement?.byCategory?.sniper;
  if (sniperStats && sniperStats.movingPercent >= COACH_THRESHOLDS.movingShotPercent.sniper.warn) {
    diagnoses.push({
      id: "sniper_moving",
      category: "movement",
      title: "AWP / Sniper ile Hareket Halinde Atış",
        severity: sniperStats.movingPercent >= COACH_THRESHOLDS.movingShotPercent.sniper.high ? "high" : "moderate",
      evidence: `Sniper atışlarının %${sniperStats.movingPercent}'inde tam durmadan tetiğe basıldı.`,
      rootCause: "AWP ile peek atarken ayaklar yere tam basmadan önce atış yapılıyor; en ufak hız bile AWP mermisini saptırır.",
      drill: {
        name: "AWP Stop-and-Shoot Disiplini",
        duration: "10 dk",
        target: "AWP hareketli atış oranını %0 yapmak",
        instructions: "Açıdan çıkış anında zıt tuşla sert fren yap, scope içindeki kırmızı nokta netleştiği an ateş et ve hemen geriye un-peek yap.",
      },
    });
  }

  // 4. İlk 3 Mermi vs Uzun Sprey Kontrolü
  if (spray) {
    if (spray.earlyAccuracy >= COACH_THRESHOLDS.spray.decayEarlyMin && spray.lateAccuracy < COACH_THRESHOLDS.spray.decayLateMax && spray.totalShots > COACH_THRESHOLDS.spray.decayMinShots) {
      diagnoses.push({
        id: "spray_control_decay",
        category: "recoil",
        title: "4+ Mermi Sonrası Sprey Recoil Dağılması",
        severity: spray.lateAccuracy < COACH_THRESHOLDS.spray.decayHighLateMax ? "high" : "moderate",
        evidence: `İlk 3 mermideki isabet %${spray.earlyAccuracy} iken, 4. mermiden sonra %${spray.lateAccuracy}'ye düşüyor.`,
        rootCause: "İlk 3 mermi hedefi vurmadığında panikle sprey uzatılıyor ancak yatay recoil telafisi (sağa-sola çekiş) kaçırılıyor.",
        drill: {
          name: "Recoil Master & 3-Mermi Reset Drill'i",
          duration: "12 dk",
          target: "4+ mermi sprey isabetini %28 üzerine çıkarmak",
          instructions: "Recoil Master haritasında AK-47 ilk 15 mermi desenini çalış. Maç içinde 3 mermide vuramazsan spreyi sürdürme; strafe atıp recoil sıfırla.",
        },
      });
    } else if (spray.earlyAccuracy < COACH_THRESHOLDS.spray.weakEarlyMax && spray.totalShots > COACH_THRESHOLDS.spray.weakMinShots) {
      diagnoses.push({
        id: "early_burst_inaccurate",
        category: "burst",
        title: "Düşük İlk 3 Mermi İsabeti (Panik Taraması)",
        severity: "high",
        evidence: `İlk 3 mermi isabet oranı yalnızca %${spray.earlyAccuracy}.`,
        rootCause: "Düşman görüldüğünde crosshair tam oturtulmadan erken tetiğe basılıyor (Trigger Discipline eksikliği).",
        drill: {
          name: "1-Tap & 2-Shot Burst Deathmatch",
          duration: "15 dk FFA DM",
          target: "İlk 3 mermi isabetini %45 üzerine çıkarmak",
          instructions: "Ölüm maçında sprey atmayı tamamen bırak. Yalnızca kafa seviyesinde 2 mermilik burst atışları yap, vuramasan dahi sprey açma.",
        },
      });
    } else if (spray.earlyAccuracy >= COACH_THRESHOLDS.spray.earlyStrong) {
      strengths.push(`Ölümcül ilk temas burst isabeti (%${spray.earlyAccuracy})`);
    }

    // 5. Bacak / Alt Gövde İsabet Kayması
    if (spray.hitboxPercents.legs > COACH_THRESHOLDS.hitboxLegsPercent.warn) {
      diagnoses.push({
        id: "lazy_crosshair_legs",
        category: "hitbox",
        title: "Nişangah Yere Sarkıyor (Bacak İsabetleri Fazla)",
        severity: spray.hitboxPercents.legs > COACH_THRESHOLDS.hitboxLegsPercent.high ? "high" : "moderate",
        evidence: `İsabet eden mermilerin %${spray.hitboxPercents.legs}'i bacaklara vurdu.`,
        rootCause: "Dikey eksende crosshair yere doğru sarkık taşınıyor; düşman çıktığında göğüs/kafa yerine bacaklara isabet alınıyor.",
        drill: {
          name: "Dikey Kafa Hizası Kilitleme Drill'i",
          duration: "10 dk",
          target: "Bacak vuruş oranını %6 altına indirmek",
          instructions: "Harita üzerindeki kutu kenarları ve kapı çizgilerini referans alarak nişangahı daima göz hizasında taşıma alışkanlığı kazan.",
        },
      });
    }
  }

  // 6. Time-to-Damage & Reaksiyon Gecikmesi
  if (duel && duel.averageTTD > COACH_THRESHOLDS.ttd.warnMs) {
    diagnoses.push({
      id: "ttd_delay",
      category: "ttd",
      title: "Time-to-Damage (İlk Hasar Gecikmesi)",
        severity: duel.averageTTD > COACH_THRESHOLDS.ttd.highMs ? "high" : "moderate",
      evidence: `Düşmanı gördükten ilk hasara kadar geçen süre ortalama ${duel.averageTTD} ms (${duel.reactionRating}).`,
      rootCause: "Görsel temas sonrası karar verme ve nişangahı hedefe kilitleme (micro-flick) süresi gecikiyor.",
      drill: {
        name: "Fast Aim / Microshot Reaksiyon Drill'i",
        duration: "10 dk (Aimlabs Microshot veya CS2 Reflex Bots)",
        target: "Ortalama TTD süresini 320 ms altına indirmek",
        instructions: "Hızlı hareket eden botlara karşı mikro-düzeltme atışları çalış. Açıyı tutarken odaklanma noktanı daralt.",
      },
    });
  } else if (duel && duel.averageTTD <= COACH_THRESHOLDS.ttd.strongMs && duel.duelTotal > COACH_THRESHOLDS.ttd.strongMinDuels) {
    strengths.push(`Işık hızında reaksiyon (${duel.averageTTD} ms ortalama TTD)`);
  }

  // Genel Puan Hesaplama
  let score = 75;
  if (crosshair) score += (crosshair.preAimScore - 60) * 0.25;
  if (spray) score += (spray.accuracyPercent - 20) * 0.6;
  if (rifleStats) score -= (rifleStats.movingPercent - 10) * 0.8;
  if (duel && duel.averageTTD > 0) score -= (duel.averageTTD - 300) * 0.05;
  score = Math.max(25, Math.min(98, Math.round(score)));

  const rating = score >= 85 ? "Tier 1 Pro Standardı" : score >= 72 ? "İleri Düzey Rekabetçi" : score >= 58 ? "Ortalama / Gelişime Açık" : "Temel Mekanik Hatalar";

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
      { step: 1, title: "Pre-Aim & Köşe Temizliği", duration: "10 dk", drill: "Refrag veya YPrac prefire modunda harita açılarını kafa hizasında dön.", goal: "Kafa sapmasını < 3.5° koru." },
      { step: 2, title: "A-D Counter-Strafe Senkronizasyonu", duration: "10 dk", drill: "Aim Botz'da A-D zıt frenleme ile 2 mermi burst çalış.", goal: "Tüfek hareket oranını < %5 tut." },
      { step: 3, title: "Recoil Master İlk 15 Mermi", duration: "10 dk", drill: "AK-47 ve M4 için sprey kontrol kalıbını tazele.", goal: "Sprey isabetini %35 üzerine çıkar." }
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
          <span className="aim-coach-badge">NİŞANGAH & AİM UZMAN KOÇU</span>
          <h3>Mekanik Hata Teşhisi ve Antrenman Reçetesi</h3>
          <p>Kural motoru; nişangah kafa sapmanı, tüfek counter-strafe duruşunu, sprey dağılımını ve TTD temas hızını inceleyerek kişisel antrenman programını çıkardı.</p>
        </div>
        <div className="aim-coach-score-box">
          <span>AİM PUANI</span>
          <b>{evaluation.score}<i>/100</i></b>
          <small>{evaluation.rating}</small>
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
            <b>Tebrikler! Bu maçta belirgin mekanik ve aim hatası tespit edilmedi.</b>
            <p>Kafa sapması, duruş hızı ve sprey dengen espor standartlarında. Mevcut antrenman disiplinini koru.</p>
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
              TRACER Aim Koçu, CS2 espor mekanik standartlarını ve profesyonel drill metodolojilerini esas alır. Koçun kararlarını dayandırdığı temel kurallar:
            </p>
            <div className="rulebook-grid">
              <article>
                <b>1. Kafa Sapması & Pre-Aim Kuralı</b>
                <p>Açı sapması <code>&gt; 4.5°</code> olduğunda oyuncunun köşe çıkışlarında mikro-flick ihtiyacı artar. Refrag/YPrac prefire ile açıyı görmeden önce nişangahı kilitleme zorunluluğu koyulur.</p>
              </article>
              <article>
                <b>2. Tüfek Counter-Strafe Hız Sınırı Kuralı</b>
                <p>CS2’de AK-47/M4 için hareket hızı <code>75 u/s</code> üzerindeyken ilk mermi sapması devasa boyuta ulaşır. Tüfek hareketli atış oranı <code>&gt; %16</code> ise acil A-D zıt frenleme drill’i verilir.</p>
              </article>
              <article>
                <b>3. 3-Mermi Burst vs Sprey Dağılım Kuralı</b>
                <p>İlk 3 mermi isabeti <code>&gt; %40</code> olup 4+ mermi isabeti <code>&lt; %20</code> ise oyuncuya uzun sprey yerine 2-3 mermiden sonra strafe ile recoil sıfırlama (Recoil Reset) disiplini önerilir.</p>
              </article>
              <article>
                <b>4. Time-to-Damage (TTD) Eşik Kuralı</b>
                <p>Görsel temas ile hasar arasındaki süre <code>&gt; 380 ms</code> ise oyuncu düellolarda geç kalıyor demektir. Fast Aim Reflex ve Microshot çalışmaları atanır.</p>
              </article>
              <article>
                <b>5. Dikey Hitbox (Lazy Crosshair) Kuralı</b>
                <p>İsabet eden mermilerin <code>&gt; %12</code>’si bacaklara vuruyorsa nişangahın dikey eksende sarkık taşındığı teşhis edilir; kapı/kutu göz hizası kilitleme çalışması verilir.</p>
              </article>
              <article>
                <b>6. Keskin Nişancı (AWP) Sıfır Hız Kuralı</b>
                <p>AWP hareketli atış payı <code>&gt; %10</code> ise durmadan tetiğe basıldığı tespit edilir; scope içi kırmızı nokta netleşmeden ateş etmeme kuralı uygulanır.</p>
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
