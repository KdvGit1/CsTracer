export function formatBytes(bytes: number) {
  if (!bytes) return "0 MB";
  return `${(bytes / 1024 / 1024).toFixed(bytes >= 100 * 1024 * 1024 ? 0 : 1)} MB`;
}

export function readableText(value: unknown, fallback: string) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

export function clampScore(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function getAngleTier(angle: number | null, type: "head" | "body" = "head") {
  if (!Number.isFinite(angle)) return { label: "Ölçülemedi", tone: "normal" as const, range: "—", hint: "Eksik veri yerine değer üretilmedi" };
  return {
    label: "Ölçüldü",
    tone: "normal" as const,
    range: "Kill tick'i",
    hint: type === "head" ? "Kill anı kafa açısı; pre-aim değildir" : "Kill anı gövde açısı; pre-aim değildir",
  };
}

export function getSprayTier(value: number | null, type: "overall" | "early" | "late" | "head") {
  if (!Number.isFinite(value)) return { label: "Ölçülemedi", tone: "normal" as const, hint: "Eksik bullet_damage verisi yerine değer üretilmedi" };
  const hints = {
    overall: "Doğrudan isabet eden mermi / silahlı atış",
    early: "Doğrudan eşleşen ilk 3 mermi örnekleri",
    late: "Doğrudan eşleşen 4+ mermi örnekleri",
    head: "player_hurt hitgroup dağılımındaki kafa payı",
  };
  return { label: "Ölçüldü", tone: "normal" as const, hint: hints[type] };
}
