export type RadarMap = {
  name: string;
  label: string;
  image: string;
  posX: number;
  posY: number;
  scale: number;
  lowerImage?: string;
  lowerMaxZ?: number;
};

const RADAR_MAPS: Record<string, RadarMap> = {
  de_dust2: { name: "de_dust2", label: "Dust II", image: "/maps/de_dust2.png", posX: -2476, posY: 3239, scale: 4.4 },
  de_mirage: { name: "de_mirage", label: "Mirage", image: "/maps/de_mirage.png", posX: -3230, posY: 1713, scale: 5 },
  de_inferno: { name: "de_inferno", label: "Inferno", image: "/maps/de_inferno.png", posX: -2087, posY: 3870, scale: 4.9 },
  de_ancient: { name: "de_ancient", label: "Ancient", image: "/maps/de_ancient.png", posX: -2953, posY: 2164, scale: 5 },
  de_anubis: { name: "de_anubis", label: "Anubis", image: "/maps/de_anubis.png", posX: -2796, posY: 3328, scale: 5.22 },
  de_nuke: { name: "de_nuke", label: "Nuke", image: "/maps/de_nuke.png", lowerImage: "/maps/de_nuke_lower.png", lowerMaxZ: -495, posX: -3453, posY: 2887, scale: 7 },
  de_overpass: { name: "de_overpass", label: "Overpass", image: "/maps/de_overpass.png", posX: -4831, posY: 1781, scale: 5.2 },
  de_train: { name: "de_train", label: "Train", image: "/maps/de_train.png", lowerImage: "/maps/de_train_lower.png", lowerMaxZ: -50, posX: -2308, posY: 2078, scale: 4.082077 },
  de_vertigo: { name: "de_vertigo", label: "Vertigo", image: "/maps/de_vertigo.png", lowerImage: "/maps/de_vertigo_lower.png", lowerMaxZ: 11700, posX: -3168, posY: 1762, scale: 4 },
};

export function radarMapFor(rawName?: string): RadarMap | undefined {
  const normalized = (rawName || "")
    .toLowerCase()
    .replace(/\\/g, "/")
    .split("/")
    .pop()
    ?.replace(/\.(vpk|bsp)$/i, "") || "";
  return RADAR_MAPS[normalized] || RADAR_MAPS[`de_${normalized}`];
}

export function worldToRadar(x: number, y: number, map: RadarMap) {
  const fullScale = map.scale * 1024;
  return {
    left: ((x - map.posX) / fullScale) * 100,
    top: ((map.posY - y) / fullScale) * 100,
  };
}
