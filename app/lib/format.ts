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
  const value = Number(angle);
  if (type === "head") {
    if (value <= 3.5) return { label: "Çok iyi hizalı", tone: "pro" as const, range: "≤ 3.5°", hint: "Kill anında çok düşük kafa açısı sapması" };
    if (value <= 5) return { label: "İyi hizalı", tone: "good" as const, range: "3.6°–5.0°", hint: "Kill anında düşük kafa açısı sapması" };
    if (value <= 7) return { label: "Orta", tone: "normal" as const, range: "5.1°–7.0°", hint: "Kill anında mikro düzeltme payı var" };
    return { label: "Geliştirilebilir", tone: "poor" as const, range: "> 7.0°", hint: "Kill anında kafa doğrultusundan geniş sapma" };
  }
  if (value <= 5.5) return { label: "Çok iyi hizalı", tone: "pro" as const, range: "≤ 5.5°", hint: "Kill anında çok düşük gövde açısı sapması" };
  if (value <= 8.5) return { label: "İyi hizalı", tone: "good" as const, range: "5.6°–8.5°", hint: "Kill anında düşük gövde açısı sapması" };
  if (value <= 12) return { label: "Orta", tone: "normal" as const, range: "8.6°–12.0°", hint: "Kill anında gövde doğrultusunda düzeltme payı var" };
  return { label: "Geliştirilebilir", tone: "poor" as const, range: "> 12.0°", hint: "Kill anında gövde doğrultusundan geniş sapma" };
}

export function getSprayTier(value: number | null, type: "overall" | "early" | "late" | "head") {
  if (!Number.isFinite(value)) return { label: "Ölçülemedi", tone: "normal" as const, hint: "Eksik bullet_damage verisi yerine değer üretilmedi" };
  const measured = Number(value);
  if (type === "overall") {
    if (measured >= 26) return { label: "Çok iyi", tone: "pro" as const, hint: "Bu maçta doğrudan isabet / silahlı atış oranı çok yüksek" };
    if (measured >= 20) return { label: "İyi", tone: "good" as const, hint: "Bu maçta doğrudan isabet / silahlı atış oranı iyi" };
    if (measured >= 15) return { label: "Orta", tone: "normal" as const, hint: "Bu maçta isabet oranı orta bantta" };
    return { label: "Geliştirilebilir", tone: "poor" as const, hint: "Bu maçta boşa giden mermi payı yüksek" };
  }
  if (type === "early") {
    if (measured >= 50) return { label: "Çok iyi", tone: "pro" as const, hint: "Bu maçta ilk üç mermi isabeti çok yüksek" };
    if (measured >= 40) return { label: "İyi", tone: "good" as const, hint: "Bu maçta ilk üç mermi isabeti iyi" };
    if (measured >= 28) return { label: "Orta", tone: "normal" as const, hint: "Bu maçta ilk üç mermi isabeti orta bantta" };
    return { label: "Geliştirilebilir", tone: "poor" as const, hint: "Bu maçta ilk üç mermide ıskalama payı yüksek" };
  }
  if (type === "late") {
    if (measured >= 35) return { label: "Çok iyi", tone: "pro" as const, hint: "Bu maçta 4+ mermi sprey isabeti çok yüksek" };
    if (measured >= 25) return { label: "İyi", tone: "good" as const, hint: "Bu maçta 4+ mermi sprey isabeti iyi" };
    if (measured >= 16) return { label: "Orta", tone: "normal" as const, hint: "Bu maçta uzun sprey isabeti orta bantta" };
    return { label: "Geliştirilebilir", tone: "poor" as const, hint: "Bu maçta uzun sprey isabeti belirgin düşüyor" };
  }
  if (measured >= 32) return { label: "Çok iyi", tone: "pro" as const, hint: "Bu maçtaki isabetlerin kafa payı çok yüksek" };
  if (measured >= 22) return { label: "İyi", tone: "good" as const, hint: "Bu maçtaki isabetlerin kafa payı iyi" };
  if (measured >= 14) return { label: "Orta", tone: "normal" as const, hint: "Bu maçta gövde ağırlıklı ama dengeli dağılım" };
  return { label: "Geliştirilebilir", tone: "poor" as const, hint: "Bu maçtaki isabetlerin kafa payı düşük" };
}

export function getKastTier(value: number | null | undefined) {
  if (!Number.isFinite(value)) return { label: "Ölçülemedi", tone: "normal" as const };
  const measured = Number(value);
  if (measured >= 80) return { label: "Çok yüksek katkı", tone: "good" as const };
  if (measured >= 70) return { label: "İyi katkı", tone: "good" as const };
  if (measured >= 60) return { label: "Orta katkı", tone: "warn" as const };
  return { label: "Geliştirilebilir", tone: "bad" as const };
}
