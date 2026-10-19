// Yaklaşık iki saniyede bir çizim noktası, CS2 rota görselleştirmesi için
// yeterlidir. Kill/death ve diğer metrikler ayrı olay kayıtlarından gelir.
export const MAX_STORED_ROUTE_POINTS_PER_ROUND = 48;

function evenlySelectIndexes(indexes, limit) {
  if (indexes.length <= limit) return indexes;
  if (limit <= 1) return [indexes[0]];
  const selected = [];
  for (let slot = 0; slot < limit; slot += 1) {
    const position = Math.round((slot * (indexes.length - 1)) / (limit - 1));
    selected.push(indexes[position]);
  }
  return [...new Set(selected)];
}

export function compactRoutePoints(points, limit = MAX_STORED_ROUTE_POINTS_PER_ROUND) {
  if (!Array.isArray(points) || points.length <= limit) return Array.isArray(points) ? points : [];

  const important = new Set([0, points.length - 1]);
  let previousZone = String(points[0]?.zone || "");
  for (let index = 1; index < points.length; index += 1) {
    const zone = String(points[index]?.zone || "");
    if (zone !== previousZone) {
      important.add(index - 1);
      important.add(index);
      previousZone = zone;
    }
  }

  const importantIndexes = [...important].sort((left, right) => left - right);
  const keptImportant = evenlySelectIndexes(importantIndexes, Math.min(limit, importantIndexes.length));
  const selected = new Set(keptImportant);
  const remaining = limit - selected.size;
  if (remaining > 0) {
    const candidates = [];
    for (let index = 0; index < points.length; index += 1) {
      if (!selected.has(index)) candidates.push(index);
    }
    for (const index of evenlySelectIndexes(candidates, remaining)) selected.add(index);
  }

  return [...selected]
    .sort((left, right) => left - right)
    .map((index) => points[index]);
}

export function compactAnalysisForStorage(analysis) {
  if (!analysis || typeof analysis !== "object" || !Array.isArray(analysis.reports)) return analysis;
  for (const report of analysis.reports) {
    if (!report || !Array.isArray(report.roundPaths)) continue;
    for (const roundPath of report.roundPaths) {
      if (!roundPath || !Array.isArray(roundPath.points)) continue;
      roundPath.points = compactRoutePoints(roundPath.points);
    }
  }
  return analysis;
}

export function compactRecentMatchesForStorage(matches) {
  if (!Array.isArray(matches)) return [];
  for (const match of matches) {
    if (match?.fullAnalysis) compactAnalysisForStorage(match.fullAnalysis);
  }
  return matches;
}
