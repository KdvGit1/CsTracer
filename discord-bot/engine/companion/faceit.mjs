import { EventEmitter } from "node:events";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const API = "https://open.faceit.com";
const MATCH_ID = /^\d-[a-f0-9-]{36}$/i;
const steamId = (value) => /^7656119\d{10}$/.test(String(value || "")) ? String(value) : "";
const roster = (team) => team?.roster || team?.players || [];
const number = (value) => value !== undefined && value !== null && value !== "" && Number.isFinite(Number(value)) ? Number(value) : null;

function readJson(path, fallback) {
  try { return JSON.parse(readFileSync(path, "utf8")); } catch { return fallback; }
}

export function normalizeFaceitMatches(match, stats, player) {
  if (!MATCH_ID.test(match?.match_id || "") || (match.game || match.game_id) !== "cs2" || match.status !== "FINISHED") return [];
  const ownTeam = Object.entries(match.teams || {}).find(([, team]) => roster(team).some((p) => p.player_id === player.player_id));
  if (!ownTeam) return [];
  const [teamKey, team] = ownTeam;
  const enemyKey = Object.keys(match.teams).find((key) => key !== teamKey);
  const timestamp = Number(match.started_at || match.finished_at) * 1000;
  if (!Number.isFinite(timestamp) || timestamp <= 0) return [];
  const rounds = stats?.rounds?.length ? stats.rounds : [null];
  return rounds.map((round, index) => {
    const ownStatsTeam = round?.teams?.find((t) => t.players?.some((p) => p.player_id === player.player_id))
      || round?.teams?.find((t) => t.team_id && (t.team_id === team.faction_id || t.team_id === team.team_id));
    const enemyStatsTeam = ownStatsTeam ? round?.teams?.find((t) => t !== ownStatsTeam) : null;
    const ownStats = ownStatsTeam?.players?.find((p) => p.player_id === player.player_id)?.player_stats || {};
    const userScore = number(ownStatsTeam?.team_stats?.["Final Score"] ?? (rounds.length === 1 ? match.results?.score?.[teamKey] : null));
    const enemyScore = number(enemyStatsTeam?.team_stats?.["Final Score"] ?? (rounds.length === 1 ? match.results?.score?.[enemyKey] : null));
    const knownScore = userScore !== null && enemyScore !== null;
    const isTie = knownScore && userScore === enemyScore;
    const isWin = knownScore ? userScore > enemyScore : match.results?.winner === teamKey;
    const kills = number(ownStats.Kills), deaths = number(ownStats.Deaths);
    const map = String(round?.round_stats?.Map || match.voting?.map?.pick?.[index] || "unknown").replace(/^de_/, "");
    const demoResource = match.demo_url?.[index] || "";
    return {
      id: `faceit_${match.match_id}_${index}`, source: "faceit", mode: "FACEIT", faceitMatchId: match.match_id,
      faceitMapIndex: index, faceitPlayerId: player.player_id, faceitUrl: `https://www.faceit.com/en/cs2/room/${match.match_id}`,
      demoResource, replayUrl: "", fileName: `faceit_${match.match_id}_${index}.dem`, map, timestamp,
      rawDateGmt: new Date(timestamp).toISOString(), formattedDate: new Date(timestamp).toLocaleString("tr-TR", { dateStyle: "short", timeStyle: "short" }),
      duration: match.finished_at > match.started_at ? `${Math.round((match.finished_at - match.started_at) / 60)} dk` : "",
      statsAvailable: Boolean(ownStatsTeam?.players?.some((p) => p.player_id === player.player_id)),
      score: { userTeam: team.name || team.nickname || teamKey, userScore, enemyScore, isWin, isTie,
        result: isTie ? "Beraberlik" : isWin ? "Galibiyet" : "Mağlubiyet", rawScore: knownScore ? `${userScore} - ${enemyScore}` : "—" },
      userStats: { name: player.nickname, steamid: steamId(player.games?.cs2?.game_player_id) || steamId(player.steam_id_64),
        kills, deaths, assists: number(ownStats.Assists), kd: kills !== null && deaths > 0 ? Math.round(kills / deaths * 100) / 100 : null,
        hsPercent: number(ownStats["Headshots %"]), adr: number(ownStats.ADR) },
      players: Object.entries(match.teams).flatMap(([key, t]) => roster(t).map((p) => ({
        steamid: steamId(p.game_player_id), name: p.nickname || p.game_player_name || "", team: t.name || t.nickname || key,
      }))),
    };
  });
}

export class FaceitClient extends EventEmitter {
  constructor(dataDir, { fetchImpl = fetch } = {}) {
    super();
    mkdirSync(dataDir, { recursive: true });
    this.configPath = join(dataDir, "faceit_config.json");
    this.matchesPath = join(dataDir, "faceit_matches.json");
    this.config = readJson(this.configPath, {});
    this.matches = readJson(this.matchesPath, []);
    if (!Array.isArray(this.matches)) this.matches = [];
    this.fetch = fetchImpl;
    this.job = null;
    this.revision = 0;
    this.scanState = { running: false, finishedAt: 0, ok: null, message: "FACEIT henüz taranmadı." };
  }
  write(path, data) {
    const temp = `${path}.${process.pid}.tmp`;
    writeFileSync(temp, JSON.stringify(data), { mode: 0o600 });
    renameSync(temp, path);
  }
  status() {
    return { configured: Boolean(this.config.apiKey && this.config.nickname), nickname: this.config.nickname || "",
      hasDownloadToken: Boolean(this.config.downloadToken), autoScanEnabled: this.config.autoScanEnabled !== false,
      lastScanTime: this.config.lastScanTime || 0, scan: { ...this.scanState } };
  }
  save(input = {}) {
    const next = { ...this.config };
    for (const field of ["apiKey", "downloadToken", "nickname"]) {
      if (typeof input[field] === "string" && input[field].trim()) {
        const value = input[field].trim();
        if (value.length > (field === "nickname" ? 100 : 4096) || /[\r\n]/.test(value)) throw new Error("FACEIT bağlantı bilgisi geçersiz.");
        next[field] = value;
      }
    }
    if (input.clearDownloadToken === true) delete next.downloadToken;
    if (typeof input.autoScanEnabled === "boolean") next.autoScanEnabled = input.autoScanEnabled;
    if (!next.apiKey || !next.nickname) throw new Error("FACEIT Data API key ve kullanıcı adı gerekli.");
    if (next.nickname !== this.config.nickname) { delete next.player; delete next.lastScanTime; }
    this.write(this.configPath, next);
    this.config = next;
    this.revision++;
    return this.status();
  }
  disconnect() {
    this.write(this.configPath, {});
    this.config = {};
    this.revision++;
    return this.status();
  }
  getMatches() {
    return this.matches.map((m) => ({ ...m, replayUrl: m.demoResource && this.config.downloadToken && this.config.player?.player_id === m.faceitPlayerId ? m.demoResource : "" }));
  }
  async request(path, { token = this.config.apiKey, signal, body } = {}) {
    let response;
    try {
      response = await this.fetch(`${API}${path}`, { method: body ? "POST" : "GET", redirect: "error",
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}), signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(12000)]) : AbortSignal.timeout(12000) });
    } catch (error) {
      if (signal?.aborted) throw error;
      throw new Error("FACEIT zamanında yanıt vermedi. Kayıtlı maçların korundu.");
    }
    if (!response.ok) {
      const messages = { 401: "FACEIT anahtarı veya tokenı geçersiz; bağlantı bilgilerini yenile.", 403: body ? "FACEIT Downloads API izni yok. Maç odasından demoyu indirip Demo Yükle ile analiz et." : "FACEIT Data API erişimi reddedildi.", 404: "FACEIT oyuncusu, maç veya demo bulunamadı.", 429: "FACEIT istek sınırına ulaşıldı. Birkaç dakika sonra yeniden tara." };
      const error = new Error(messages[response.status] || `FACEIT servisi yanıt veremedi (${response.status}).`);
      error.status = response.status;
      error.retryable = response.status >= 500 || response.status === 429;
      throw error;
    }
    return response.json();
  }
  scan() {
    if (this.job) return this.job;
    if (!this.status().configured) return Promise.resolve({ ok: false, message: "Önce FACEIT bağlantısını kaydet." });
    this.scanState = { ...this.scanState, running: true, ok: null, message: "FACEIT maçları taranıyor…" };
    const revision = this.revision;
    this.job = this.performScan().finally(() => {
      this.scanState.running = false; this.job = null;
      if (revision !== this.revision && this.status().configured) void this.scan();
    });
    return this.job;
  }
  async performScan() {
    const revision = this.revision, config = { ...this.config }, signal = AbortSignal.timeout(90000);
    const request = (path) => this.request(path, { token: config.apiKey, signal });
    try {
      const player = await request(`/data/v4/players?nickname=${encodeURIComponent(config.nickname)}&game=cs2`);
      if (!player.player_id || !(steamId(player.games?.cs2?.game_player_id) || steamId(player.steam_id_64))) throw new Error("FACEIT profilinde bağlı CS2 SteamID bulunamadı.");
      const history = await request(`/data/v4/players/${encodeURIComponent(player.player_id)}/history?game=cs2&from=0&offset=0&limit=20`);
      if (!Array.isArray(history.items)) throw new Error("FACEIT maç geçmişi okunamadı; kayıtlı maçların korundu.");
      const fresh = [];
      let partial = false;
      for (const item of history.items) {
        if (!MATCH_ID.test(item.match_id || "") || item.status !== "FINISHED") continue;
        const cached = this.matches.filter((m) => m.faceitMatchId === item.match_id && m.faceitPlayerId === player.player_id);
        if (cached.length && cached.every((m) => m.statsAvailable && m.demoResource)) { fresh.push(...cached); continue; }
        try {
          const detail = await request(`/data/v4/matches/${item.match_id}`);
          let stats = null;
          try { stats = await request(`/data/v4/matches/${item.match_id}/stats`); }
          catch (error) { if (error.status !== 404) throw error; partial = true; }
          fresh.push(...normalizeFaceitMatches(detail, stats, player));
        } catch (error) {
          if ([401, 403, 429].includes(error.status) || signal.aborted) throw error;
          partial = true;
          fresh.push(...(cached.length ? cached : normalizeFaceitMatches(item, null, player)));
        }
      }
      if (revision !== this.revision) throw new Error("FACEIT bağlantısı değişti; yeniden tara.");
      const known = new Set(this.matches.map((m) => m.id));
      const merged = new Map(this.matches.map((m) => [m.id, m]));
      for (const match of fresh) merged.set(match.id, match);
      const matches = [...merged.values()].sort((a, b) => b.timestamp - a.timestamp).slice(0, 90);
      this.write(this.matchesPath, matches);
      this.matches = matches;
      this.config = { ...this.config, player: { player_id: player.player_id, nickname: player.nickname }, lastScanTime: Date.now() };
      this.write(this.configPath, this.config);
      this.scanState = { running: true, finishedAt: Date.now(), ok: true, message: `${fresh.length} FACEIT maç kaydı güncellendi.${partial ? " Bazı maç ayrıntıları henüz hazır değil; sonraki taramada tekrar denenecek." : ""}` };
      if (known.size) this.emit("matches-discovered", this.getMatches().filter((m) => !known.has(m.id)));
      this.emit("scan-complete", this.getMatches());
      return { ok: true, message: this.scanState.message };
    } catch (error) {
      this.scanState = { running: true, finishedAt: Date.now(), ok: false, message: error.message };
      return { ok: false, message: error.message };
    }
  }
  async demoUrl(match, signal) {
    if (!this.config.downloadToken) throw Object.assign(new Error("Otomatik indirme için Downloads API tokenı gerekli. Maç odasından demoyu indirip Demo Yükle ile analiz et."), { retryable: false });
    const detail = await this.request(`/data/v4/matches/${match.faceitMatchId}`, { signal });
    const resource = detail.demo_url?.[match.faceitMapIndex || 0];
    if (!resource) throw Object.assign(new Error("FACEIT demosu henüz hazır değil veya artık saklanmıyor. Maç odasını kontrol et."), { retryable: false });
    const result = await this.request("/download/v2/demos/download", { token: this.config.downloadToken, signal, body: { resource_url: resource } });
    if (!result.payload?.download_url) throw new Error("FACEIT demo indirme bağlantısı alınamadı.");
    return result.payload.download_url;
  }
}
