import React from "react";

export interface MapEmblemProps {
  mapName?: string;
  size?: number;
  className?: string;
  showBorder?: boolean;
}

export function normalizeMapKey(mapName?: string): string {
  if (!mapName) return "unknown";
  const clean = mapName.toLowerCase().replace(/^.*\//, "").replace(/\.vpk$/, "").trim();
  if (clean.includes("dust2") || clean.includes("dust_2") || clean.includes("dust 2") || clean.includes("dustii")) return "dust2";
  if (clean.includes("mirage")) return "mirage";
  if (clean.includes("inferno")) return "inferno";
  if (clean.includes("nuke")) return "nuke";
  if (clean.includes("ancient")) return "ancient";
  if (clean.includes("anubis")) return "anubis";
  if (clean.includes("vertigo")) return "vertigo";
  if (clean.includes("overpass")) return "overpass";
  if (clean.includes("train")) return "train";
  if (clean.includes("office")) return "office";
  if (clean.includes("italy")) return "italy";
  if (clean.includes("cache")) return "cache";
  if (clean.includes("cbble") || clean.includes("cobble")) return "cobblestone";
  return clean;
}

export function formatMapTitle(mapName?: string): string {
  const key = normalizeMapKey(mapName);
  switch (key) {
    case "dust2": return "Dust II";
    case "mirage": return "Mirage";
    case "inferno": return "Inferno";
    case "nuke": return "Nuke";
    case "ancient": return "Ancient";
    case "anubis": return "Anubis";
    case "vertigo": return "Vertigo";
    case "overpass": return "Overpass";
    case "train": return "Train";
    case "office": return "Office";
    case "italy": return "Italy";
    case "cache": return "Cache";
    case "cobblestone": return "Cobblestone";
    default:
      if (!mapName) return "Bilinmeyen Harita";
      return mapName.replace(/^de_|^cs_/, "").replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  }
}

export const MapEmblem: React.FC<MapEmblemProps> = ({ mapName, size = 44, className = "", showBorder = true }) => {
  const key = normalizeMapKey(mapName);

  const getEmblemContent = () => {
    switch (key) {
      case "dust2":
        return {
          bg: "linear-gradient(135deg, #3d2f19, #1c150b)",
          border: "#c49a45",
          accent: "#f4c666",
          svg: (
            <svg viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg" className="emblem-svg">
              <path d="M50 8 L85 24 V65 L50 92 L15 65 V24 Z" fill="#241a0e" stroke="#f4c666" strokeWidth="3" />
              {/* Dust 2 Kemer & Roma Rakamı II */}
              <path d="M30 70 V42 C30 32 70 32 70 42 V70" stroke="#f4c666" strokeWidth="3" strokeLinecap="round" />
              <rect x="40" y="44" width="6" height="24" rx="2" fill="#f4c666" />
              <rect x="54" y="44" width="6" height="24" rx="2" fill="#f4c666" />
              <path d="M36 40 H64 M36 72 H64" stroke="#f4c666" strokeWidth="3" strokeLinecap="round" />
              <circle cx="50" cy="24" r="5" fill="#f4c666" />
            </svg>
          ),
        };

      case "mirage":
        return {
          bg: "linear-gradient(135deg, #3b203c, #160c18)",
          border: "#b862bb",
          accent: "#e58fed",
          svg: (
            <svg viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg" className="emblem-svg">
              <path d="M50 8 L88 30 L74 85 L26 85 L12 30 Z" fill="#251226" stroke="#e58fed" strokeWidth="3" />
              {/* Saray Kubbesi ve Palmiye Silueti */}
              <path d="M50 25 C40 38 35 48 35 60 C35 70 65 70 65 60 C65 48 60 38 50 25 Z" fill="#e58fed" opacity="0.3" stroke="#e58fed" strokeWidth="2.5" />
              <path d="M50 18 V25 M50 25 L50 72" stroke="#e58fed" strokeWidth="3" strokeLinecap="round" />
              <path d="M50 48 C42 42 34 46 28 52 M50 42 C40 32 30 35 24 40" stroke="#e58fed" strokeWidth="2.5" strokeLinecap="round" />
              <path d="M50 48 C58 42 66 46 72 52 M50 42 C60 32 70 35 76 40" stroke="#e58fed" strokeWidth="2.5" strokeLinecap="round" />
              <line x1="28" y1="72" x2="72" y2="72" stroke="#e58fed" strokeWidth="3" strokeLinecap="round" />
            </svg>
          ),
        };

      case "inferno":
        return {
          bg: "linear-gradient(135deg, #421a14, #180907)",
          border: "#e65539",
          accent: "#ff7b5a",
          svg: (
            <svg viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg" className="emblem-svg">
              <path d="M50 6 C75 6 90 25 90 55 C90 78 72 94 50 94 C28 94 10 78 10 55 C10 25 25 6 50 6 Z" fill="#290e0a" stroke="#ff7b5a" strokeWidth="3" />
              {/* Çan Kulesi ve Alevler */}
              <path d="M50 20 L62 38 H38 Z" fill="#ff7b5a" />
              <rect x="42" y="38" width="16" height="34" fill="#ff7b5a" opacity="0.8" />
              <path d="M50 44 C47 44 45 47 45 50 V58 H55 V50 C55 47 53 44 50 44 Z" fill="#180907" />
              {/* Alev kanatları */}
              <path d="M26 68 C22 55 30 45 34 40 C34 50 40 54 36 68" fill="#ffaa44" />
              <path d="M74 68 C78 55 70 45 66 40 C66 50 60 54 64 68" fill="#ffaa44" />
              <line x1="30" y1="76" x2="70" y2="76" stroke="#ff7b5a" strokeWidth="3" strokeLinecap="round" />
            </svg>
          ),
        };

      case "nuke":
        return {
          bg: "linear-gradient(135deg, #443c10, #171404)",
          border: "#e5c824",
          accent: "#ffea47",
          svg: (
            <svg viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg" className="emblem-svg">
              <circle cx="50" cy="50" r="42" fill="#221d06" stroke="#ffea47" strokeWidth="3" />
              {/* Radyasyon Simgesi (☢ Trefoil) */}
              <circle cx="50" cy="50" r="10" fill="#ffea47" />
              <path d="M50 35 L40 18 A34 34 0 0 1 60 18 Z" fill="#ffea47" />
              <path d="M37 57 L21 68 A34 34 0 0 1 11 50 Z" fill="#ffea47" />
              <path d="M63 57 L79 68 A34 34 0 0 0 89 50 Z" fill="#ffea47" />
              <circle cx="50" cy="50" r="4" fill="#171404" />
            </svg>
          ),
        };

      case "ancient":
        return {
          bg: "linear-gradient(135deg, #173b22, #08170d)",
          border: "#38b868",
          accent: "#52e389",
          svg: (
            <svg viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg" className="emblem-svg">
              <path d="M50 8 L90 40 L75 90 L25 90 L10 40 Z" fill="#0d2415" stroke="#52e389" strokeWidth="3" />
              {/* Maya Taş Tapınağı & Maskesi */}
              <path d="M28 75 L36 45 H64 L72 75 Z" fill="#52e389" opacity="0.3" stroke="#52e389" strokeWidth="2.5" />
              <rect x="42" y="32" width="16" height="13" fill="#52e389" />
              <line x1="20" y1="75" x2="80" y2="75" stroke="#52e389" strokeWidth="3" />
              <circle cx="42" cy="56" r="4" fill="#52e389" />
              <circle cx="58" cy="56" r="4" fill="#52e389" />
              <rect x="44" y="64" width="12" height="4" rx="1" fill="#52e389" />
            </svg>
          ),
        };

      case "anubis":
        return {
          bg: "linear-gradient(135deg, #16383b, #071517)",
          border: "#30b6c4",
          accent: "#56dfee",
          svg: (
            <svg viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg" className="emblem-svg">
              <path d="M50 6 L88 28 V72 L50 94 L12 72 V28 Z" fill="#0b2022" stroke="#56dfee" strokeWidth="3" />
              {/* Anubis Çakal Başı Silueti */}
              <path d="M30 18 L42 45 L36 76 L50 82 L64 76 L58 45 L70 18 L58 32 L50 25 L42 32 Z" fill="#56dfee" opacity="0.35" stroke="#56dfee" strokeWidth="2.5" strokeLinejoin="round" />
              <circle cx="44" cy="48" r="3" fill="#56dfee" />
              <circle cx="56" cy="48" r="3" fill="#56dfee" />
              <path d="M48 64 L50 67 L52 64" stroke="#56dfee" strokeWidth="2" />
            </svg>
          ),
        };

      case "vertigo":
        return {
          bg: "linear-gradient(135deg, #3d2f14, #171105)",
          border: "#dca12b",
          accent: "#ffc247",
          svg: (
            <svg viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg" className="emblem-svg">
              <rect x="14" y="14" width="72" height="72" rx="8" fill="#241a09" stroke="#ffc247" strokeWidth="3" />
              {/* Vinç ve İnşaat Kirişleri */}
              <path d="M30 80 V28 L74 28" stroke="#ffc247" strokeWidth="3.5" strokeLinecap="round" />
              <path d="M30 28 L74 72 M30 52 L52 74 M52 28 L74 50" stroke="#ffc247" strokeWidth="2" strokeDasharray="3 3" opacity="0.7" />
              <line x1="74" y1="28" x2="74" y2="46" stroke="#ffc247" strokeWidth="2" />
              <rect x="70" y="46" width="8" height="8" rx="1" fill="#ffc247" />
              <line x1="20" y1="80" x2="80" y2="80" stroke="#ffc247" strokeWidth="3.5" strokeLinecap="round" />
            </svg>
          ),
        };

      case "overpass":
        return {
          bg: "linear-gradient(135deg, #1b3834, #081715)",
          border: "#2cb89d",
          accent: "#4de7c9",
          svg: (
            <svg viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg" className="emblem-svg">
              <path d="M50 10 L88 32 L78 86 L22 86 L12 32 Z" fill="#0c211e" stroke="#4de7c9" strokeWidth="3" />
              {/* Üst Geçit Köprüsü ve Berlin Grafiti Canavarı */}
              <path d="M18 52 C35 44 65 44 82 52" stroke="#4de7c9" strokeWidth="3.5" strokeLinecap="round" />
              <path d="M34 52 V78 M66 52 V78" stroke="#4de7c9" strokeWidth="3" strokeLinecap="round" />
              <path d="M40 32 C45 26 55 26 60 32 C58 40 42 40 40 32 Z" fill="#4de7c9" />
              <circle cx="46" cy="32" r="2" fill="#081715" />
              <circle cx="54" cy="32" r="2" fill="#081715" />
            </svg>
          ),
        };

      case "train":
        return {
          bg: "linear-gradient(135deg, #3d1c1a, #170908)",
          border: "#c44139",
          accent: "#f55f55",
          svg: (
            <svg viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg" className="emblem-svg">
              <rect x="15" y="15" width="70" height="70" rx="12" fill="#240e0c" stroke="#f55f55" strokeWidth="3" />
              {/* Tren Lokomotifi Ön Görünümü */}
              <path d="M32 30 H68 V68 H32 Z" fill="#f55f55" opacity="0.3" stroke="#f55f55" strokeWidth="2.5" />
              <rect x="38" y="36" width="10" height="10" rx="1" fill="#f55f55" />
              <rect x="52" y="36" width="10" height="10" rx="1" fill="#f55f55" />
              <circle cx="40" cy="58" r="4" fill="#f55f55" />
              <circle cx="60" cy="58" r="4" fill="#f55f55" />
              <line x1="22" y1="74" x2="78" y2="74" stroke="#f55f55" strokeWidth="3.5" strokeLinecap="round" />
            </svg>
          ),
        };

      case "office":
        return {
          bg: "linear-gradient(135deg, #172d42, #07121c)",
          border: "#3d96e0",
          accent: "#66baff",
          svg: (
            <svg viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg" className="emblem-svg">
              <circle cx="50" cy="50" r="42" fill="#0b1b28" stroke="#66baff" strokeWidth="3" />
              {/* Kar Tanesi ve Ofis Gökdeleni */}
              <rect x="38" y="30" width="24" height="42" fill="#66baff" opacity="0.3" stroke="#66baff" strokeWidth="2.5" />
              <line x1="50" y1="18" x2="50" y2="82" stroke="#66baff" strokeWidth="2.5" strokeLinecap="round" />
              <line x1="18" y1="50" x2="82" y2="50" stroke="#66baff" strokeWidth="2.5" strokeLinecap="round" />
              <line x1="28" y1="28" x2="72" y2="72" stroke="#66baff" strokeWidth="2" strokeLinecap="round" />
              <line x1="28" y1="72" x2="72" y2="28" stroke="#66baff" strokeWidth="2" strokeLinecap="round" />
            </svg>
          ),
        };

      case "italy":
        return {
          bg: "linear-gradient(135deg, #2f3818, #111508)",
          border: "#90ba32",
          accent: "#b7ea48",
          svg: (
            <svg viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg" className="emblem-svg">
              <path d="M50 8 C72 8 88 22 88 48 C88 74 65 92 50 92 C35 92 12 74 12 48 C12 22 28 8 50 8 Z" fill="#18200b" stroke="#b7ea48" strokeWidth="3" />
              {/* İtalyan Çizmesi ve Kalkan */}
              <path d="M42 24 H56 V48 L64 62 L54 72 L42 56 Z" fill="#b7ea48" opacity="0.4" stroke="#b7ea48" strokeWidth="2.5" strokeLinejoin="round" />
              <circle cx="50" cy="34" r="3" fill="#b7ea48" />
            </svg>
          ),
        };

      default:
        return {
          bg: "linear-gradient(135deg, #202b18, #0e140b)",
          border: "#4b6826",
          accent: "#c8f54d",
          svg: (
            <svg viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg" className="emblem-svg">
              <rect x="14" y="14" width="72" height="72" rx="10" fill="#121a0e" stroke="#c8f54d" strokeWidth="3" />
              <path d="M50 24 L72 72 L50 60 L28 72 Z" fill="#c8f54d" opacity="0.75" />
              <circle cx="50" cy="50" r="28" stroke="#c8f54d" strokeWidth="2" strokeDasharray="4 4" />
            </svg>
          ),
        };
    }
  };

  const content = getEmblemContent();

  return (
    <div
      className={`map-emblem-badge ${className}`}
      style={{
        width: `${size}px`,
        height: `${size}px`,
        minWidth: `${size}px`,
        background: content.bg,
        border: showBorder ? `1.5px solid ${content.border}` : "none",
        borderRadius: "8px",
        display: "grid",
        placeItems: "center",
        padding: "4px",
        boxShadow: `0 3px 12px rgba(0,0,0,0.5), inset 0 0 12px ${content.border}33`,
        position: "relative",
        overflow: "hidden",
      }}
      title={formatMapTitle(mapName)}
    >
      <div style={{ width: "100%", height: "100%", display: "grid", placeItems: "center" }}>
        {content.svg}
      </div>
    </div>
  );
};
