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

export function getAngleTier(angle: number, type: "head" | "body" = "head") {
  if (type === "head") {
    if (angle <= 3.5) return { label: "Pro Seviye", tone: "pro" as const, range: "< 3.5°", hint: "Tier 1 CS2 Pro standardı" };
    if (angle <= 5.0) return { label: "İyi", tone: "good" as const, range: "3.5° - 5.0°", hint: "Faceit 8-10 / İleri seviye" };
    if (angle <= 7.0) return { label: "Normal", tone: "normal" as const, range: "5.1° - 7.0°", hint: "Ortalama, mikro düzeltme var" };
    return { label: "Geliştirilmeli", tone: "poor" as const, range: "> 7.0°", hint: "Nişangah kafa hizasından uzak" };
  } else {
    if (angle <= 5.5) return { label: "Pro Seviye", tone: "pro" as const, range: "< 5.5°", hint: "Gövde eksenine kilitli" };
    if (angle <= 8.5) return { label: "İyi", tone: "good" as const, range: "5.5° - 8.5°", hint: "Temiz gövde hizalaması" };
    if (angle <= 12.0) return { label: "Normal", tone: "normal" as const, range: "8.6° - 12.0°", hint: "Ortalama gövde sapması" };
    return { label: "Geliştirilmeli", tone: "poor" as const, range: "> 12.0°", hint: "Geniş gövde sapması" };
  }
}

export function getSprayTier(value: number, type: "overall" | "early" | "late" | "head") {
  if (type === "overall") {
    if (value >= 26) return { label: "Pro Seviye", tone: "pro" as const, hint: "CS2 Tier 1 genel isabet" };
    if (value >= 20) return { label: "İyi", tone: "good" as const, hint: "İleri seviye isabet oranı" };
    if (value >= 15) return { label: "Normal", tone: "normal" as const, hint: "Ortalama mermi isabeti" };
    return { label: "Geliştirilmeli", tone: "poor" as const, hint: "Düşük isabet, fazla spam" };
  } else if (type === "early") {
    if (value >= 50) return { label: "Pro Seviye", tone: "pro" as const, hint: "Kusursuz ilk 3 mermi burst" };
    if (value >= 40) return { label: "İyi", tone: "good" as const, hint: "Güçlü ilk temas isabeti" };
    if (value >= 28) return { label: "Normal", tone: "normal" as const, hint: "Ortalama ilk mermi başarısı" };
    return { label: "Geliştirilmeli", tone: "poor" as const, hint: "İlk mermilerde ıskalama yüksek" };
  } else if (type === "late") {
    if (value >= 35) return { label: "Pro Seviye", tone: "pro" as const, hint: "Mükemmel sprey recoil kontrolü" };
    if (value >= 25) return { label: "İyi", tone: "good" as const, hint: "Kontrollü uzun sprey" };
    if (value >= 16) return { label: "Normal", tone: "normal" as const, hint: "Ortalama sprey transferi" };
    return { label: "Geliştirilmeli", tone: "poor" as const, hint: "Recoil kontrolü dağılıyor" };
  } else {
    if (value >= 32) return { label: "Pro Seviye", tone: "pro" as const, hint: "Yüksek kafa vuruş payı" };
    if (value >= 22) return { label: "İyi", tone: "good" as const, hint: "İyi kafa hedefleme" };
    if (value >= 14) return { label: "Normal", tone: "normal" as const, hint: "Gövde odaklı isabetler" };
    return { label: "Geliştirilmeli", tone: "poor" as const, hint: "Kafaya isabet oranı düşük" };
  }
}
