import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cleanPlayer, extractSquadMatch, findPartyCandidates, findSquadCandidates, normalizeMapName, selectionFingerprint } from "./identity.mjs";

function readJson(path, fallback) {
  try {
    if (!existsSync(path)) return fallback;
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
}

function atomicWrite(path, value) {
  const tempPath = `${path}.${process.pid}.tmp`;
  writeFileSync(tempPath, JSON.stringify(value, null, 2), "utf8");
  renameSync(tempPath, path);
}

export class SquadStore {
  constructor(dataDir) {
    if (!dataDir) throw new Error("SquadStore için veri dizini gerekli.");
    this.dir = join(dataDir, "squads");
    this.matchesPath = join(this.dir, "match_archive.json");
    this.squadsPath = join(this.dir, "squads.json");
    this.livePath = join(this.dir, "live_sessions.json");
    mkdirSync(this.dir, { recursive: true });
  }

  listMatches() {
    const value = readJson(this.matchesPath, []);
    return Array.isArray(value) ? value : [];
  }

  ingestMatch(record, metadata = null) {
    const compact = extractSquadMatch(record, metadata);
    if (!compact) return { ok: false, reason: "Maçta iki adet doğrulanmış beş kişilik takım bulunamadı." };
    const matches = this.listMatches();
    const index = matches.findIndex((match) => match.id === compact.id);
    if (index >= 0) matches[index] = compact;
    else matches.push(compact);
    matches.sort((a, b) => Number(b.timestamp || 0) - Number(a.timestamp || 0));
    atomicWrite(this.matchesPath, matches);
    return { ok: true, match: compact, updated: index >= 0 };
  }

  ingestMatches(records, metadataRecords = []) {
    const metadataById = new Map((Array.isArray(metadataRecords) ? metadataRecords : []).map((item) => [String(item?.id || ""), item]));
    const results = [];
    for (const record of Array.isArray(records) ? records : []) {
      results.push(this.ingestMatch(record, metadataById.get(String(record?.id || "")) || null));
    }
    return {
      ok: true,
      imported: results.filter((result) => result.ok).length,
      skipped: results.filter((result) => !result.ok).length,
      matches: this.listMatches(),
    };
  }

  getMatch(matchId) {
    return this.listMatches().find((match) => match.id === String(matchId || "")) || null;
  }

  candidates(roster, map) {
    return findSquadCandidates(this.listMatches(), roster, map);
  }

  partyCandidates(roster, map, ownerSteamId = "") {
    return findPartyCandidates(this.listMatches(), roster, map, ownerSteamId);
  }

  listSquads() {
    const value = readJson(this.squadsPath, []);
    return Array.isArray(value) ? value : [];
  }

  getSquad(squadId) {
    return this.listSquads().find((squad) => squad.id === String(squadId || "")) || null;
  }

  saveSquad({ roster, map, ownerSteamId = "", name = "Takımım", report = null, selectedMatchIds = [] }) {
    const fingerprint = selectionFingerprint(roster);
    const normalizedMap = normalizeMapName(map);
    if (!fingerprint || normalizedMap === "unknown") throw new Error("1–5 arasında geçerli SteamID ve harita gerekli.");
    const id = `${fingerprint}_${normalizedMap}`;
    const squads = this.listSquads();
    const index = squads.findIndex((squad) => squad.id === id);
    const previous = index >= 0 ? squads[index] : null;
    const squad = {
      schemaVersion: 1,
      id,
      name: String(name || previous?.name || "Takımım").slice(0, 300),
      map: normalizedMap,
      roster: Array.isArray(roster) ? roster.map(cleanPlayer) : [],
      ownerSteamId: String(ownerSteamId || previous?.ownerSteamId || ""),
      selectedMatchIds: [...new Set(selectedMatchIds.map(String))],
      notes: previous?.notes || "",
      report: report || previous?.report || null,
      createdAt: previous?.createdAt || Date.now(),
      updatedAt: Date.now(),
    };
    if (index >= 0) squads[index] = squad;
    else squads.push(squad);
    atomicWrite(this.squadsPath, squads);
    return squad;
  }

  updateNotes(squadId, notes) {
    const squads = this.listSquads();
    const index = squads.findIndex((squad) => squad.id === String(squadId || ""));
    if (index < 0) return null;
    squads[index] = { ...squads[index], notes: String(notes || "").slice(0, 12000), updatedAt: Date.now() };
    atomicWrite(this.squadsPath, squads);
    return squads[index];
  }

  listLiveSessions() {
    const value = readJson(this.livePath, {});
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  }

  getLiveSession(squadId) {
    return this.listLiveSessions()[String(squadId || "")] || null;
  }

  saveLiveSession(squadId, session) {
    const sessions = this.listLiveSessions();
    sessions[String(squadId)] = session;
    atomicWrite(this.livePath, sessions);
    return session;
  }
}
