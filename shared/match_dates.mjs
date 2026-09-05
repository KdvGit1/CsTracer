export function validMatchDate(value) {
  return typeof value === "number" && Number.isFinite(value) && value > 1 ? value : 0;
}

// The analysis payload has no calendar timestamp. Identity and played-at date
// belong to the archived match, never the moment a report is opened.
export function downloadedDemoMeta(match) {
  if (!match?.id) return null;
  return {
    matchId: match.id,
    fileName: match.fileName || `${match.map || "match"}.dem`,
    lastModified: 0,
    matchDate: validMatchDate(match.timestamp),
    size: 0,
  };
}

export function progressMatchDate(matchId, incomingDate, archived = [], scanned = [], existing = []) {
  const findDate = (items, field) => validMatchDate(items.find((item) => item.id === matchId)?.[field]);
  return findDate(scanned, "timestamp") || findDate(archived, "timestamp") || findDate(existing, "date") || validMatchDate(incomingDate);
}
