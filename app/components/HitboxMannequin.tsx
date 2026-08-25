"use client";

import React from "react";

export type HitboxData = {
  head: number;
  chest: number;
  stomach: number;
  arms: number;
  legs: number;
};

export type HitboxPercents = {
  head: number;
  chest: number;
  stomach: number;
  arms: number;
  legs: number;
};

export const HitboxMannequin = React.memo(function HitboxMannequin({
  counts,
  percents,
  totalHits,
}: {
  counts?: HitboxData;
  percents?: HitboxPercents;
  totalHits?: number;
}) {
  const c = counts || { head: 0, chest: 0, stomach: 0, arms: 0, legs: 0 };
  const p = percents || { head: 0, chest: 0, stomach: 0, arms: 0, legs: 0 };
  const total = totalHits || (c.head + c.chest + c.stomach + c.arms + c.legs);

  const getTheme = (pct: number, baseColor: string) => {
    if (pct === 0) {
      return {
        fill: "#141c18",
        stroke: "#26362f",
        accent: baseColor,
        glow: "none",
      };
    }
    if (pct >= 35) {
      return {
        fill: "rgba(255, 59, 71, 0.45)",
        stroke: "#ff3b47",
        accent: "#ff3b47",
        glow: "rgba(255, 59, 71, 0.7)",
      };
    }
    if (pct >= 20) {
      return {
        fill: "rgba(255, 158, 61, 0.45)",
        stroke: "#ff9e3d",
        accent: "#ff9e3d",
        glow: "rgba(255, 158, 61, 0.6)",
      };
    }
    if (pct >= 10) {
      return {
        fill: "rgba(224, 212, 85, 0.4)",
        stroke: "#e0d455",
        accent: "#e0d455",
        glow: "rgba(224, 212, 85, 0.5)",
      };
    }
    return {
      fill: "rgba(107, 196, 230, 0.35)",
      stroke: "#6bc4e6",
      accent: "#6bc4e6",
      glow: "rgba(107, 196, 230, 0.4)",
    };
  };

  const headTheme = getTheme(p.head, "#ff3b47");
  const chestTheme = getTheme(p.chest, "#ff9e3d");
  const stomachTheme = getTheme(p.stomach, "#e0d455");
  const armsTheme = getTheme(p.arms, "#6bc4e6");
  const legsTheme = getTheme(p.legs, "#8a9690");

  return (
    <div className="hitbox-mannequin-container">
      {/* SOL: TAKTİKSEL CS2 OPERATÖR HEDEF SİLUETİ */}
      <div className="mannequin-visual">
        <svg viewBox="0 0 260 380" className="mannequin-svg" role="img" aria-label="CS2 Hedef İnsan Maketi">
          <defs>
            <pattern id="targetGrid" width="20" height="20" patternUnits="userSpaceOnUse">
              <path d="M 20 0 L 0 0 0 20" fill="none" stroke="#16221d" strokeWidth="0.75" />
            </pattern>
            <filter id="glowHead" x="-20%" y="-20%" width="140%" height="140%">
              <feDropShadow dx="0" dy="0" stdDeviation="6" floodColor={headTheme.glow} />
            </filter>
            <filter id="glowChest" x="-20%" y="-20%" width="140%" height="140%">
              <feDropShadow dx="0" dy="0" stdDeviation="6" floodColor={chestTheme.glow} />
            </filter>
            <filter id="glowStomach" x="-20%" y="-20%" width="140%" height="140%">
              <feDropShadow dx="0" dy="0" stdDeviation="6" floodColor={stomachTheme.glow} />
            </filter>
            <filter id="glowArms" x="-20%" y="-20%" width="140%" height="140%">
              <feDropShadow dx="0" dy="0" stdDeviation="6" floodColor={armsTheme.glow} />
            </filter>
            <filter id="glowLegs" x="-20%" y="-20%" width="140%" height="140%">
              <feDropShadow dx="0" dy="0" stdDeviation="6" floodColor={legsTheme.glow} />
            </filter>
          </defs>

          {/* Arka Plan Izgarası ve Taktik Nişangah Kılavuzları */}
          <rect x="4" y="4" width="252" height="372" rx="10" fill="#070c0a" stroke="#1c2923" strokeWidth="1.2" />
          <rect x="4" y="4" width="252" height="372" fill="url(#targetGrid)" rx="10" opacity="0.6" />

          {/* Nişangah Kılavuz Çemberleri */}
          <circle cx="130" cy="180" r="115" fill="none" stroke="#14211a" strokeWidth="1.2" strokeDasharray="4 4" />
          <circle cx="130" cy="180" r="65" fill="none" stroke="#182922" strokeWidth="1.2" strokeDasharray="3 3" />
          <line x1="130" y1="12" x2="130" y2="368" stroke="#15241d" strokeWidth="1.2" />
          <line x1="12" y1="180" x2="248" y2="180" stroke="#15241d" strokeWidth="1.2" />

          {/* 1. KAFA (HEAD & HELMET) */}
          <g className="body-part head-group" filter={p.head > 0 ? "url(#glowHead)" : undefined}>
            <path
              d="M 112 32 C 112 18, 148 18, 148 32 C 154 44, 152 64, 130 68 C 108 64, 106 44, 112 32 Z"
              fill={headTheme.fill}
              stroke={headTheme.stroke}
              strokeWidth="2.5"
            />
            {/* Kask / Vizör Detayı */}
            <path d="M 114 42 Q 130 48 146 42" fill="none" stroke={headTheme.stroke} strokeWidth="2" opacity="0.9" />
            <circle cx="130" cy="45" r="3" fill="#ffffff" opacity="0.9" />
            {/* Net Kafa Değeri */}
            <rect x="110" y="74" width="40" height="20" rx="4" fill="#1b0e10" stroke={headTheme.stroke} strokeWidth="1.2" />
            <text x="130" y="88" textAnchor="middle" fill="#ffffff" fontSize="13" fontWeight="900" fontFamily="system-ui, -apple-system, sans-serif">
              %{p.head}
            </text>
          </g>

          {/* Boyun */}
          <rect x="123" y="68" width="14" height="8" rx="2" fill="#121a16" stroke="#25352c" strokeWidth="1" />

          {/* 2. GÖĞÜS (CHEST / VEST) */}
          <g className="body-part chest-group" filter={p.chest > 0 ? "url(#glowChest)" : undefined}>
            <path
              d="M 94 96 L 166 96 L 158 160 L 102 160 Z"
              fill={chestTheme.fill}
              stroke={chestTheme.stroke}
              strokeWidth="2.5"
            />
            {/* Taktik Göğüs Deseni */}
            <line x1="130" y1="98" x2="130" y2="158" stroke={chestTheme.stroke} strokeWidth="1.5" strokeDasharray="3 3" opacity="0.6" />
            {/* Net Göğüs Değeri */}
            <rect x="108" y="118" width="44" height="24" rx="4" fill="#24160a" stroke={chestTheme.stroke} strokeWidth="1.4" />
            <text x="130" y="135" textAnchor="middle" fill="#ffffff" fontSize="14" fontWeight="900" fontFamily="system-ui, -apple-system, sans-serif">
              %{p.chest}
            </text>
          </g>

          {/* 3. KARIN (STOMACH / PELVIS) */}
          <g className="body-part stomach-group" filter={p.stomach > 0 ? "url(#glowStomach)" : undefined}>
            <path
              d="M 103 164 L 157 164 L 150 210 L 110 210 Z"
              fill={stomachTheme.fill}
              stroke={stomachTheme.stroke}
              strokeWidth="2.5"
            />
            {/* Taktik Kemer */}
            <rect x="107" y="198" width="46" height="10" rx="2" fill="#141e19" stroke={stomachTheme.stroke} strokeWidth="1.2" />
            {/* Net Karın Değeri */}
            <rect x="108" y="172" width="44" height="22" rx="4" fill="#21200a" stroke={stomachTheme.stroke} strokeWidth="1.4" />
            <text x="130" y="188" textAnchor="middle" fill="#ffffff" fontSize="13" fontWeight="900" fontFamily="system-ui, -apple-system, sans-serif">
              %{p.stomach}
            </text>
          </g>

          {/* 4. KOLLAR (ARMS) - Sol ve Sağ */}
          <g className="body-part arms-group" filter={p.arms > 0 ? "url(#glowArms)" : undefined}>
            {/* Sol Kol & Omuzluk */}
            <path
              d="M 92 98 L 68 110 L 58 168 L 72 172 L 82 126 L 92 116 Z"
              fill={armsTheme.fill}
              stroke={armsTheme.stroke}
              strokeWidth="2.5"
            />
            {/* Sol El */}
            <rect x="56" y="172" width="16" height="16" rx="4" fill="#131c17" stroke={armsTheme.stroke} strokeWidth="1.5" />
            {/* Sol Kol Badge */}
            <rect x="22" y="132" width="42" height="22" rx="4" fill="#0d1c22" stroke={armsTheme.stroke} strokeWidth="1.2" />
            <text x="43" y="148" textAnchor="middle" fill="#8ad8f7" fontSize="12" fontWeight="900" fontFamily="system-ui, sans-serif">
              %{p.arms}
            </text>

            {/* Sağ Kol & Omuzluk */}
            <path
              d="M 168 98 L 192 110 L 202 168 L 188 172 L 178 126 L 168 116 Z"
              fill={armsTheme.fill}
              stroke={armsTheme.stroke}
              strokeWidth="2.5"
            />
            {/* Sağ El */}
            <rect x="188" y="172" width="16" height="16" rx="4" fill="#131c17" stroke={armsTheme.stroke} strokeWidth="1.5" />
            {/* Sağ Kol Badge */}
            <rect x="196" y="132" width="42" height="22" rx="4" fill="#0d1c22" stroke={armsTheme.stroke} strokeWidth="1.2" />
            <text x="217" y="148" textAnchor="middle" fill="#8ad8f7" fontSize="12" fontWeight="900" fontFamily="system-ui, sans-serif">
              %{p.arms}
            </text>
          </g>

          {/* 5. BACAKLAR (LEGS) - Sol ve Sağ */}
          <g className="body-part legs-group" filter={p.legs > 0 ? "url(#glowLegs)" : undefined}>
            {/* Sol Bacak */}
            <path
              d="M 110 214 L 128 214 L 124 295 L 122 348 L 102 348 L 106 295 Z"
              fill={legsTheme.fill}
              stroke={legsTheme.stroke}
              strokeWidth="2.5"
            />
            {/* Sol Bot */}
            <path d="M 102 348 L 122 348 L 122 366 L 94 366 Z" fill="#131c18" stroke={legsTheme.stroke} strokeWidth="2" />

            {/* Sağ Bacak */}
            <path
              d="M 132 214 L 150 214 L 154 295 L 158 348 L 138 348 L 136 295 Z"
              fill={legsTheme.fill}
              stroke={legsTheme.stroke}
              strokeWidth="2.5"
            />
            {/* Sağ Bot */}
            <path d="M 138 348 L 158 348 L 166 366 L 138 366 Z" fill="#131c18" stroke={legsTheme.stroke} strokeWidth="2" />

            {/* Bacaklar Değeri */}
            <rect x="108" y="270" width="44" height="24" rx="4" fill="#121815" stroke={legsTheme.stroke} strokeWidth="1.4" />
            <text x="130" y="287" textAnchor="middle" fill="#ffffff" fontSize="13" fontWeight="900" fontFamily="system-ui, -apple-system, sans-serif">
              %{p.legs}
            </text>
          </g>
        </svg>
      </div>

      {/* SAĞ: BÜYÜK FONT VE YÜKSEK KONTRASTLI HITBOX LİSTESİ */}
      <div className="mannequin-stats-legend">
        <div className="legend-item head">
          <span className="legend-dot" />
          <div className="legend-copy">
            <b>Kafa (Head)</b>
            <small>{c.head} isabetli vuruş</small>
          </div>
          <div className="legend-score-col">
            <strong>%{p.head}</strong>
            <div className="legend-bar"><i style={{ width: `${p.head}%`, background: "#ff3b47" }} /></div>
          </div>
        </div>

        <div className="legend-item chest">
          <span className="legend-dot" />
          <div className="legend-copy">
            <b>Göğüs (Chest)</b>
            <small>{c.chest} isabetli vuruş</small>
          </div>
          <div className="legend-score-col">
            <strong>%{p.chest}</strong>
            <div className="legend-bar"><i style={{ width: `${p.chest}%`, background: "#ff9e3d" }} /></div>
          </div>
        </div>

        <div className="legend-item stomach">
          <span className="legend-dot" />
          <div className="legend-copy">
            <b>Karın (Stomach)</b>
            <small>{c.stomach} isabetli vuruş</small>
          </div>
          <div className="legend-score-col">
            <strong>%{p.stomach}</strong>
            <div className="legend-bar"><i style={{ width: `${p.stomach}%`, background: "#e0d455" }} /></div>
          </div>
        </div>

        <div className="legend-item arms">
          <span className="legend-dot" />
          <div className="legend-copy">
            <b>Kollar (Arms)</b>
            <small>{c.arms} isabetli vuruş</small>
          </div>
          <div className="legend-score-col">
            <strong>%{p.arms}</strong>
            <div className="legend-bar"><i style={{ width: `${p.arms}%`, background: "#6bc4e6" }} /></div>
          </div>
        </div>

        <div className="legend-item legs">
          <span className="legend-dot" />
          <div className="legend-copy">
            <b>Bacaklar (Legs)</b>
            <small>{c.legs} isabetli vuruş</small>
          </div>
          <div className="legend-score-col">
            <strong>%{p.legs}</strong>
            <div className="legend-bar"><i style={{ width: `${p.legs}%`, background: "#8a9690" }} /></div>
          </div>
        </div>

        <div className="mannequin-total-banner">
          <span>TOPLAM İSABET</span>
          <b>{total} Mermi</b>
        </div>
      </div>
    </div>
  );
});
