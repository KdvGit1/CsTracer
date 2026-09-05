const finite = (value) => typeof value === "number" && Number.isFinite(value);
const mean = (values) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;

export function formatMeasuredNumber(value, digits = 1) {
  return finite(value) ? new Intl.NumberFormat("tr-TR", { maximumFractionDigits: digits }).format(value) : "—";
}

export function movementEvidence(profile) {
  const measured = profile?.status === "measured" && profile.sampleCount > 0 && finite(profile.invalidShotPercent);
  const category = (name) => {
    const sample = profile?.byCategory?.[name];
    return sample?.shots > 0 && finite(sample.movingPercent) ? `%${formatMeasuredNumber(sample.movingPercent)} (${sample.shots} atış)` : "ölçüm yok";
  };
  return { measured, invalidPerTen: measured ? Math.max(0, Math.min(10, Math.round(profile.invalidShotPercent / 10))) : null, rifle: category("rifle"), sniper: category("sniper"), smg: category("smg") };
}

// Only compare measured values. A missing sample is never a zero.
export function summarizeProgress(matches = []) {
  const ordered = [...matches].filter((m) => m?.summary && finite(m.date) && m.date > 1).sort((a, b) => b.date - a.date || String(a.id).localeCompare(String(b.id)));
  const recent = ordered.slice(0, 5);
  const previous = ordered.slice(5, 10);
  const metric = (read) => {
    const values = recent.map(read).filter(finite);
    const baseline = previous.map(read).filter(finite);
    return {
      value: mean(values), count: values.length,
      delta: values.length >= 3 && baseline.length >= 3 ? mean(values) - mean(baseline) : null,
    };
  };
  return {
    recent,
    adr: metric((m) => m.summary.stats?.adr),
    kast: metric((m) => m.summary.scoreMethod === "kast-round-contribution-v1" ? m.summary.overall : null),
    hs: metric((m) => m.summary.stats?.headshotPercent),
  };
}

export function filterMatchLibrary(matches, { search = "", map = "all", result = "all", sort = "newest", tab = "all" } = {}) {
  const query = search.trim().toLocaleLowerCase("tr-TR");
  return matches.filter((match) => {
    if (tab === "downloaded" && !match.isDownloaded) return false;
    if (tab === "available" && (match.isDownloaded || !match.replayUrl)) return false;
    if (map !== "all" && match.map !== map) return false;
    const outcome = match.score?.isTie ? "tie" : match.score?.isWin ? "win" : match.score?.isWin === false ? "loss" : "unknown";
    if (result !== "all" && result !== outcome) return false;
    const haystack = [match.map, match.mode, match.formattedDate, match.userStats?.name, ...(match.players || []).map((p) => p.name)].filter(Boolean).join(" ").toLocaleLowerCase("tr-TR");
    return !query || haystack.includes(query);
  }).sort((a, b) => (sort === "oldest" ? 1 : -1) * ((a.timestamp || 0) - (b.timestamp || 0)) || String(a.id).localeCompare(String(b.id)));
}

export function reportCoverage(report) {
  const spray = report?.sprayStats;
  const movement = report?.movementProfile;
  const duel = report?.duelStats;
  const items = [
    { key: "rounds", label: "Round katkısı", available: finite(report?.kastPercent) && report.rounds > 0, count: report?.rounds, unit: "round", reason: "KAST için round olayları gerekli.", target: "dashboard" },
    { key: "spray", label: "Sprey / burst", available: spray?.method === "bullet-damage-event-tick-v2" && spray.status === "measured" && finite(spray.accuracyPercent) && spray.totalShots > 0, count: spray?.totalShots, unit: "mermi", reason: spray?.reason || "Atış–hasar eşleşmesi yok ya da eski analiz. Sıfır isabet demek değildir.", target: "aim-precision" },
    { key: "movement", label: "Atışta hareket", available: movement?.status === "measured" && movement.sampleCount > 0, count: movement?.sampleCount, unit: "atış", reason: movement?.reason || "Silah hızıyla eşleşen atış örneği gerekli.", target: "aim-precision" },
    { key: "duel", label: "Karşılıklı düello", available: duel?.duelMethod === "mutual-spotted-death-v2" && duel.duelStatus === "measured" && finite(duel.duelWinrate) && duel.duelTotal > 0, count: duel?.duelTotal, unit: "temas", reason: duel?.duelReason || "Karşılıklı görünürlük ve ölümle sonuçlanan temas gerekli.", target: "duel-reaction" },
  ];
  return items.map((item) => ({ ...item, count: finite(item.count) ? item.count : 0 }));
}
