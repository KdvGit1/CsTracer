export function normalizeMapKey(mapName?: string): string {
  if (!mapName) return "unknown";
  const clean = mapName.toLowerCase().replace(/^.*\//, "").replace(/\.vpk$/, "").trim();
  if (clean.includes("dust2") || clean.includes("dust_2") || clean.includes("dust 2") || clean.includes("dustii") || clean.includes("dust")) return "dust2";
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
  if (clean.includes("thera")) return "thera";
  if (clean.includes("mills")) return "mills";
  if (clean.includes("assembly")) return "assembly";
  if (clean.includes("memento")) return "memento";
  if (clean.includes("poolday") || clean.includes("pool_day")) return "poolday";
  if (clean.includes("baggage")) return "baggage";
  if (clean.includes("shoots")) return "shoots";
  return clean;
}

const MAP_ID_BY_KEY: Record<string, string> = {
  dust2: "de_dust2",
  mirage: "de_mirage",
  inferno: "de_inferno",
  nuke: "de_nuke",
  ancient: "de_ancient",
  anubis: "de_anubis",
  vertigo: "de_vertigo",
  overpass: "de_overpass",
  train: "de_train",
  office: "cs_office",
  italy: "cs_italy",
};

export function inferMapFromName(name: string): string {
  return MAP_ID_BY_KEY[normalizeMapKey(name)] || "";
}
