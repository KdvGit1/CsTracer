// Botun kalıcı hafızası: Node'un yerleşik SQLite'ı (node:sqlite). Yerel derleme
// gerektirmediği için Oracle ARM sunucularında ek paket kurmadan çalışır.
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";

const SCHEMA_VERSION = 1;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  first_seen INTEGER NOT NULL,
  last_seen INTEGER NOT NULL,
  visits INTEGER NOT NULL DEFAULT 0,
  steam_id TEXT,
  steam_verified INTEGER NOT NULL DEFAULT 0,
  steam_name TEXT,
  steam_avatar TEXT,
  match_auth_code TEXT,
  last_share_code TEXT,
  faceit_nickname TEXT,
  faceit_player_id TEXT,
  faceit_elo INTEGER,
  faceit_level INTEGER,
  faceit_avatar TEXT,
  faceit_country TEXT,
  settings TEXT NOT NULL DEFAULT '{}',
  premium_until INTEGER NOT NULL DEFAULT 0,
  last_match_id TEXT,
  last_tracked_at INTEGER NOT NULL DEFAULT 0,
  track_error TEXT
);
CREATE INDEX IF NOT EXISTS users_steam ON users(steam_id);
CREATE INDEX IF NOT EXISTS users_faceit ON users(faceit_player_id);

CREATE TABLE IF NOT EXISTS guilds (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  joined_at INTEGER NOT NULL,
  report_channel_id TEXT,
  report_thread_id TEXT,
  notify_role_id TEXT,
  auto_report INTEGER NOT NULL DEFAULT 1,
  leaderboard INTEGER NOT NULL DEFAULT 1,
  premium_until INTEGER NOT NULL DEFAULT 0,
  settings TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS guild_members (
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  first_seen INTEGER NOT NULL,
  last_seen INTEGER NOT NULL,
  PRIMARY KEY (guild_id, user_id)
);
CREATE INDEX IF NOT EXISTS guild_members_user ON guild_members(user_id);

CREATE TABLE IF NOT EXISTS matches (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  map TEXT NOT NULL,
  played_at INTEGER,
  analyzed_at INTEGER NOT NULL,
  demo_sha256 TEXT,
  rounds INTEGER,
  meta TEXT NOT NULL DEFAULT '{}',
  analysis_file TEXT,
  analysis_version TEXT,
  requested_by TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS matches_sha ON matches(demo_sha256) WHERE demo_sha256 IS NOT NULL;
CREATE INDEX IF NOT EXISTS matches_played ON matches(played_at DESC);

CREATE TABLE IF NOT EXISTS user_matches (
  user_id TEXT NOT NULL,
  match_id TEXT NOT NULL,
  steam_id TEXT,
  player_name TEXT NOT NULL DEFAULT '',
  played_at INTEGER,
  map TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'demo',
  result TEXT,
  user_score INTEGER,
  enemy_score INTEGER,
  kills INTEGER, deaths INTEGER, assists INTEGER,
  adr REAL, hs REAL, kast REAL,
  summary TEXT,
  added_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, match_id)
);
CREATE INDEX IF NOT EXISTS user_matches_date ON user_matches(user_id, played_at DESC);
CREATE INDEX IF NOT EXISTS user_matches_match ON user_matches(match_id);

CREATE TABLE IF NOT EXISTS faceit_matches (
  id TEXT PRIMARY KEY,
  player_id TEXT NOT NULL,
  faceit_match_id TEXT NOT NULL,
  map_index INTEGER NOT NULL DEFAULT 0,
  played_at INTEGER NOT NULL,
  data TEXT NOT NULL,
  analyzed_match_id TEXT,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS faceit_matches_player ON faceit_matches(player_id, played_at DESC);

CREATE TABLE IF NOT EXISTS jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  status TEXT NOT NULL,
  user_id TEXT NOT NULL,
  guild_id TEXT,
  channel_id TEXT,
  source TEXT NOT NULL,
  reply TEXT NOT NULL DEFAULT '{}',
  player_hint TEXT,
  dedupe_key TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  match_id TEXT,
  progress TEXT,
  created_at INTEGER NOT NULL,
  started_at INTEGER,
  finished_at INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS jobs_active_dedupe ON jobs(dedupe_key) WHERE status IN ('queued', 'running') AND dedupe_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS jobs_status ON jobs(status, id);

CREATE TABLE IF NOT EXISTS outbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  thread_id TEXT,
  match_id TEXT NOT NULL,
  user_id TEXT,
  kind TEXT NOT NULL,
  status TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at INTEGER NOT NULL,
  error TEXT,
  created_at INTEGER NOT NULL,
  UNIQUE (guild_id, match_id, kind)
);
CREATE INDEX IF NOT EXISTS outbox_due ON outbox(status, next_attempt_at);

CREATE TABLE IF NOT EXISTS squads (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL,
  name TEXT NOT NULL,
  map TEXT NOT NULL,
  roster TEXT NOT NULL,
  owner_user_id TEXT NOT NULL,
  owner_steam_id TEXT,
  report TEXT,
  assignments TEXT NOT NULL DEFAULT '{}',
  notes TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS squads_scope ON squads(scope, updated_at DESC);

CREATE TABLE IF NOT EXISTS squad_matches (
  id TEXT PRIMARY KEY,
  map TEXT NOT NULL,
  played_at INTEGER,
  steam_ids TEXT NOT NULL,
  data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS squad_matches_map ON squad_matches(map, played_at DESC);

CREATE TABLE IF NOT EXISTS live_sessions (
  squad_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  guild_id TEXT,
  channel_id TEXT NOT NULL,
  round_message_id TEXT,
  session TEXT NOT NULL,
  message_key TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS live_sessions_user ON live_sessions(user_id, active);

CREATE TABLE IF NOT EXISTS tokens (
  token_hash TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  user_id TEXT NOT NULL,
  data TEXT NOT NULL DEFAULT '{}',
  expires_at INTEGER NOT NULL,
  used_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS tokens_user ON tokens(user_id, kind);

CREATE TABLE IF NOT EXISTS usage (
  user_id TEXT NOT NULL,
  day TEXT NOT NULL,
  analyses INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, day)
);

CREATE TABLE IF NOT EXISTS premium_grants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  until INTEGER NOT NULL,
  source TEXT NOT NULL,
  note TEXT,
  created_at INTEGER NOT NULL
);
`;

const json = (value, fallback) => {
  if (value === null || value === undefined || value === "") return fallback;
  try { return JSON.parse(value); } catch { return fallback; }
};
const plain = (row) => (row ? { ...row } : null);

export const DEFAULT_USER_SETTINGS = Object.freeze({
  dmNotify: true,
  autoAnalyze: true,
  publicProfile: true,
  autoTrack: true,
});

export class Store {
  constructor(dataDir, { path = join(dataDir, "tracer-bot.sqlite"), now = () => Date.now() } = {}) {
    this.now = now;
    this.db = new DatabaseSync(path);
    this.db.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
    this.db.exec(SCHEMA);
    this.db.prepare("INSERT INTO meta(key, value) VALUES ('schema_version', ?) ON CONFLICT(key) DO NOTHING").run(String(SCHEMA_VERSION));
    this.statements = new Map();
  }

  sql(text) {
    let statement = this.statements.get(text);
    if (!statement) {
      statement = this.db.prepare(text);
      this.statements.set(text, statement);
    }
    return statement;
  }

  transaction(work) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = work();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  close() {
    this.db.close();
  }

  getMeta(key) {
    return this.sql("SELECT value FROM meta WHERE key = ?").get(String(key))?.value ?? null;
  }

  setMeta(key, value) {
    this.sql("INSERT INTO meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(String(key), String(value));
  }

  // ---------- Kullanıcılar ----------

  /** Her etkileşimde çağrılır: kişiyi hatırlar ve ziyaret sayısını artırır. */
  touchUser(id, name = "") {
    const now = this.now();
    const previous = this.getUser(id);
    this.sql(`INSERT INTO users (id, name, first_seen, last_seen, visits) VALUES (?, ?, ?, ?, 1)
      ON CONFLICT(id) DO UPDATE SET name = CASE WHEN excluded.name <> '' THEN excluded.name ELSE users.name END,
      last_seen = excluded.last_seen, visits = users.visits + 1`).run(String(id), String(name || "").slice(0, 80), now, now);
    return { user: this.getUser(id), previous };
  }

  getUser(id) {
    const row = plain(this.sql("SELECT * FROM users WHERE id = ?").get(String(id)));
    if (!row) return null;
    row.settings = { ...DEFAULT_USER_SETTINGS, ...json(row.settings, {}) };
    return row;
  }

  usersBySteamId(steamId) {
    return this.sql("SELECT id FROM users WHERE steam_id = ?").all(String(steamId)).map((row) => this.getUser(row.id));
  }

  updateUser(id, patch) {
    const allowed = ["name", "steam_id", "steam_verified", "steam_name", "steam_avatar", "match_auth_code", "last_share_code",
      "faceit_nickname", "faceit_player_id", "faceit_elo", "faceit_level", "faceit_avatar", "faceit_country",
      "premium_until", "last_match_id", "last_tracked_at", "track_error"];
    const entries = Object.entries(patch).filter(([key]) => allowed.includes(key));
    if (!entries.length) return this.getUser(id);
    const assignments = entries.map(([key]) => `${key} = ?`).join(", ");
    this.db.prepare(`UPDATE users SET ${assignments} WHERE id = ?`).run(...entries.map(([, value]) => value ?? null), String(id));
    return this.getUser(id);
  }

  updateUserSettings(id, patch) {
    const user = this.getUser(id);
    if (!user) return null;
    const next = { ...user.settings };
    for (const [key, value] of Object.entries(patch)) if (key in DEFAULT_USER_SETTINGS && typeof value === "boolean") next[key] = value;
    this.sql("UPDATE users SET settings = ? WHERE id = ?").run(JSON.stringify(next), String(id));
    return this.getUser(id);
  }

  /** Steam doğrulandıysa aynı SteamID'yi doğrulanmamış biçimde tutan diğer hesaplardan kaldırır. */
  claimSteamId(userId, steamId, { verified }) {
    return this.transaction(() => {
      if (verified) {
        this.sql("UPDATE users SET steam_id = NULL, steam_verified = 0, match_auth_code = NULL, last_share_code = NULL WHERE steam_id = ? AND id <> ?").run(String(steamId), String(userId));
      } else {
        const owner = this.sql("SELECT id FROM users WHERE steam_id = ? AND steam_verified = 1 AND id <> ?").get(String(steamId), String(userId));
        if (owner) throw Object.assign(new Error("Bu Steam hesabı başka bir Discord kullanıcısı tarafından doğrulanmış."), { code: "STEAM_TAKEN" });
      }
      return this.updateUser(userId, { steam_id: String(steamId), steam_verified: verified ? 1 : 0 });
    });
  }

  trackableUsers(limit = 25) {
    return this.sql(`SELECT id FROM users WHERE ((steam_id IS NOT NULL AND match_auth_code IS NOT NULL AND last_share_code IS NOT NULL)
      OR faceit_player_id IS NOT NULL) ORDER BY last_tracked_at ASC LIMIT ?`).all(limit).map((row) => this.getUser(row.id))
      .filter((user) => user?.settings.autoTrack);
  }

  /** KVKK/GDPR: kullanıcının bütün kişisel kayıtlarını siler. Paylaşılan maç analizleri diğer oyuncular için kalır. */
  deleteUser(id) {
    const userId = String(id);
    return this.transaction(() => {
      const squads = this.sql("SELECT id FROM squads WHERE owner_user_id = ?").all(userId).map((row) => row.id);
      for (const squadId of squads) this.sql("DELETE FROM live_sessions WHERE squad_id = ?").run(squadId);
      this.sql("DELETE FROM squads WHERE owner_user_id = ?").run(userId);
      this.sql("DELETE FROM user_matches WHERE user_id = ?").run(userId);
      this.sql("DELETE FROM guild_members WHERE user_id = ?").run(userId);
      this.sql("DELETE FROM tokens WHERE user_id = ?").run(userId);
      this.sql("DELETE FROM usage WHERE user_id = ?").run(userId);
      this.sql("DELETE FROM jobs WHERE user_id = ? AND status IN ('queued', 'failed', 'done')").run(userId);
      this.sql("DELETE FROM premium_grants WHERE target_type = 'user' AND target_id = ?").run(userId);
      this.sql("DELETE FROM users WHERE id = ?").run(userId);
      return { squads: squads.length };
    });
  }

  // ---------- Sunucular ----------

  touchGuild(id, name = "") {
    this.sql(`INSERT INTO guilds (id, name, joined_at) VALUES (?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET name = CASE WHEN excluded.name <> '' THEN excluded.name ELSE guilds.name END`).run(String(id), String(name || "").slice(0, 100), this.now());
    return this.getGuild(id);
  }

  getGuild(id) {
    const row = plain(this.sql("SELECT * FROM guilds WHERE id = ?").get(String(id)));
    if (row) row.settings = json(row.settings, {});
    return row;
  }

  updateGuild(id, patch) {
    const allowed = ["report_channel_id", "report_thread_id", "notify_role_id", "auto_report", "leaderboard", "premium_until"];
    const entries = Object.entries(patch).filter(([key]) => allowed.includes(key));
    if (entries.length) {
      this.db.prepare(`UPDATE guilds SET ${entries.map(([key]) => `${key} = ?`).join(", ")} WHERE id = ?`)
        .run(...entries.map(([, value]) => (typeof value === "boolean" ? (value ? 1 : 0) : value ?? null)), String(id));
    }
    return this.getGuild(id);
  }

  removeGuild(id) {
    this.transaction(() => {
      this.sql("DELETE FROM guild_members WHERE guild_id = ?").run(String(id));
      this.sql("DELETE FROM outbox WHERE guild_id = ?").run(String(id));
      this.sql("UPDATE live_sessions SET active = 0 WHERE guild_id = ?").run(String(id));
      this.sql("DELETE FROM guilds WHERE id = ?").run(String(id));
    });
  }

  touchMember(guildId, userId) {
    const now = this.now();
    this.sql(`INSERT INTO guild_members (guild_id, user_id, first_seen, last_seen) VALUES (?, ?, ?, ?)
      ON CONFLICT(guild_id, user_id) DO UPDATE SET last_seen = excluded.last_seen`).run(String(guildId), String(userId), now, now);
  }

  guildsOfUser(userId) {
    return this.sql(`SELECT g.* FROM guild_members m JOIN guilds g ON g.id = m.guild_id WHERE m.user_id = ?`).all(String(userId)).map(plain);
  }

  guildMemberIds(guildId) {
    return this.sql("SELECT user_id FROM guild_members WHERE guild_id = ?").all(String(guildId)).map((row) => row.user_id);
  }

  // ---------- Maçlar ve kişisel geçmiş ----------

  getMatch(id) {
    const row = plain(this.sql("SELECT * FROM matches WHERE id = ?").get(String(id)));
    if (row) row.meta = json(row.meta, {});
    return row;
  }

  matchBySha(sha) {
    const row = plain(this.sql("SELECT * FROM matches WHERE demo_sha256 = ?").get(String(sha)));
    if (row) row.meta = json(row.meta, {});
    return row;
  }

  saveMatch(match) {
    this.sql(`INSERT INTO matches (id, source, map, played_at, analyzed_at, demo_sha256, rounds, meta, analysis_file, analysis_version, requested_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET source = excluded.source, map = excluded.map, played_at = COALESCE(excluded.played_at, matches.played_at),
      analyzed_at = excluded.analyzed_at, demo_sha256 = COALESCE(excluded.demo_sha256, matches.demo_sha256), rounds = excluded.rounds,
      meta = excluded.meta, analysis_file = excluded.analysis_file, analysis_version = excluded.analysis_version`).run(
      match.id, match.source, match.map, match.played_at ?? null, match.analyzed_at ?? this.now(), match.demo_sha256 ?? null,
      match.rounds ?? null, JSON.stringify(match.meta || {}), match.analysis_file ?? null, match.analysis_version ?? null, match.requested_by ?? null);
    return this.getMatch(match.id);
  }

  upsertUserMatch(entry) {
    this.sql(`INSERT INTO user_matches (user_id, match_id, steam_id, player_name, played_at, map, source, result, user_score, enemy_score,
      kills, deaths, assists, adr, hs, kast, summary, added_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id, match_id) DO UPDATE SET steam_id = excluded.steam_id, player_name = excluded.player_name,
      played_at = COALESCE(excluded.played_at, user_matches.played_at), map = excluded.map, source = excluded.source, result = excluded.result,
      user_score = excluded.user_score, enemy_score = excluded.enemy_score, kills = excluded.kills, deaths = excluded.deaths,
      assists = excluded.assists, adr = excluded.adr, hs = excluded.hs, kast = excluded.kast,
      summary = COALESCE(excluded.summary, user_matches.summary)`).run(
      String(entry.user_id), String(entry.match_id), entry.steam_id ?? null, String(entry.player_name || ""), entry.played_at ?? null,
      String(entry.map || "unknown"), String(entry.source || "demo"), entry.result ?? null, entry.user_score ?? null, entry.enemy_score ?? null,
      entry.kills ?? null, entry.deaths ?? null, entry.assists ?? null, entry.adr ?? null, entry.hs ?? null, entry.kast ?? null,
      entry.summary ? JSON.stringify(entry.summary) : null, this.now());
  }

  userMatches(userId, { limit = 90, offset = 0, map = "", result = "", source = "", search = "", sort = "newest", analyzedOnly = false } = {}) {
    const where = ["um.user_id = ?"];
    const params = [String(userId)];
    if (map) { where.push("um.map = ?"); params.push(map); }
    if (result) { where.push("um.result = ?"); params.push(result); }
    if (source) { where.push("um.source = ?"); params.push(source); }
    if (analyzedOnly) where.push("m.analysis_file IS NOT NULL");
    if (search) { where.push("(um.map LIKE ? OR um.player_name LIKE ? OR m.meta LIKE ?)"); const like = `%${search.replace(/[%_]/g, "")}%`; params.push(like, like, like); }
    const order = sort === "oldest" ? "um.played_at ASC" : "um.played_at DESC";
    const rows = this.db.prepare(`SELECT um.*, m.analysis_file, m.meta AS match_meta FROM user_matches um LEFT JOIN matches m ON m.id = um.match_id
      WHERE ${where.join(" AND ")} ORDER BY ${order}, um.match_id LIMIT ? OFFSET ?`).all(...params, limit, offset);
    return rows.map((row) => ({ ...row, summary: json(row.summary, null), match_meta: json(row.match_meta, {}) }));
  }

  countUserMatches(userId, filters = {}) {
    return this.userMatches(userId, { ...filters, limit: 10_000 }).length;
  }

  userMatch(userId, matchId) {
    const row = plain(this.sql("SELECT * FROM user_matches WHERE user_id = ? AND match_id = ?").get(String(userId), String(matchId)));
    if (row) row.summary = json(row.summary, null);
    return row;
  }

  userMaps(userId) {
    return this.sql("SELECT map, COUNT(*) AS count FROM user_matches WHERE user_id = ? GROUP BY map ORDER BY count DESC").all(String(userId)).map(plain);
  }

  matchParticipants(matchId) {
    return this.sql("SELECT user_id, steam_id FROM user_matches WHERE match_id = ?").all(String(matchId)).map(plain);
  }

  /** Kullanıcının son N analizinin dışında kalan ve kimsenin geçmişinde tutulmayan dosyaları döndürür. */
  prunableAnalysisFiles(keepPerUser, olderThanMs) {
    const rows = this.sql(`SELECT m.id, m.analysis_file, m.analyzed_at FROM matches m WHERE m.analysis_file IS NOT NULL AND m.analyzed_at < ?`).all(this.now() - olderThanMs);
    const keep = new Set(this.sql(`SELECT match_id FROM (SELECT match_id, ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY played_at DESC) AS position
      FROM user_matches) WHERE position <= ?`).all(keepPerUser).map((row) => row.match_id));
    return rows.filter((row) => !keep.has(row.id)).map(plain);
  }

  clearAnalysisFile(matchId) {
    this.sql("UPDATE matches SET analysis_file = NULL WHERE id = ?").run(String(matchId));
  }

  // ---------- FACEIT geçmişi ----------

  saveFaceitMatches(playerId, matches) {
    const now = this.now();
    this.transaction(() => {
      for (const match of matches) {
        this.sql(`INSERT INTO faceit_matches (id, player_id, faceit_match_id, map_index, played_at, data, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET data = excluded.data, played_at = excluded.played_at, updated_at = excluded.updated_at`)
          .run(match.id, String(playerId), match.faceitMatchId, Number(match.faceitMapIndex || 0), Number(match.timestamp || 0), JSON.stringify(match), now);
      }
    });
  }

  faceitMatches(playerId, limit = 20) {
    return this.sql("SELECT * FROM faceit_matches WHERE player_id = ? ORDER BY played_at DESC LIMIT ?").all(String(playerId), limit)
      .map((row) => ({ ...json(row.data, {}), analyzedMatchId: row.analyzed_match_id || null }));
  }

  faceitMatch(id) {
    const row = plain(this.sql("SELECT * FROM faceit_matches WHERE id = ?").get(String(id)));
    return row ? { ...json(row.data, {}), analyzedMatchId: row.analyzed_match_id || null } : null;
  }

  markFaceitAnalyzed(id, matchId) {
    this.sql("UPDATE faceit_matches SET analyzed_match_id = ? WHERE id = ?").run(String(matchId), String(id));
  }

  // ---------- Analiz kuyruğu ----------

  enqueueJob({ kind = "analyze", userId, guildId = null, channelId = null, source, reply = {}, playerHint = null, dedupeKey = null }) {
    try {
      const row = this.sql(`INSERT INTO jobs (kind, status, user_id, guild_id, channel_id, source, reply, player_hint, dedupe_key, created_at)
        VALUES (?, 'queued', ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`).get(kind, String(userId), guildId, channelId, JSON.stringify(source), JSON.stringify(reply), playerHint, dedupeKey, this.now());
      return { job: this.getJob(row.id), duplicate: false };
    } catch (error) {
      if (dedupeKey && /UNIQUE/i.test(String(error?.message))) {
        const existing = plain(this.sql("SELECT id FROM jobs WHERE dedupe_key = ? AND status IN ('queued', 'running')").get(dedupeKey));
        return { job: existing ? this.getJob(existing.id) : null, duplicate: true };
      }
      throw error;
    }
  }

  getJob(id) {
    const row = plain(this.sql("SELECT * FROM jobs WHERE id = ?").get(Number(id)));
    if (!row) return null;
    row.source = json(row.source, {});
    row.reply = json(row.reply, {});
    return row;
  }

  claimNextJob() {
    return this.transaction(() => {
      const row = this.sql("SELECT id FROM jobs WHERE status = 'queued' ORDER BY id LIMIT 1").get();
      if (!row) return null;
      this.sql("UPDATE jobs SET status = 'running', started_at = ?, attempts = attempts + 1 WHERE id = ?").run(this.now(), row.id);
      return this.getJob(row.id);
    });
  }

  updateJob(id, patch) {
    const allowed = ["status", "error", "match_id", "progress", "finished_at", "source", "reply"];
    const entries = Object.entries(patch).filter(([key]) => allowed.includes(key))
      .map(([key, value]) => [key, key === "source" || key === "reply" ? JSON.stringify(value) : value]);
    if (entries.length) this.db.prepare(`UPDATE jobs SET ${entries.map(([key]) => `${key} = ?`).join(", ")} WHERE id = ?`).run(...entries.map(([, value]) => value ?? null), Number(id));
    return this.getJob(id);
  }

  /** Yeniden başlatmada yarım kalan işler kuyruğa geri döner (en fazla 3 deneme). */
  recoverJobs() {
    this.sql("UPDATE jobs SET status = 'failed', error = 'Bot yeniden başlarken iş üç kez yarıda kaldı.', finished_at = ? WHERE status = 'running' AND attempts >= 3").run(this.now());
    return this.sql("UPDATE jobs SET status = 'queued' WHERE status = 'running'").run().changes;
  }

  queuePosition(id) {
    return Number(this.sql("SELECT COUNT(*) AS count FROM jobs WHERE status IN ('queued', 'running') AND id < ?").get(Number(id)).count) + 1;
  }

  activeJobsForUser(userId) {
    return this.sql("SELECT id, status, source, created_at, progress FROM jobs WHERE user_id = ? AND status IN ('queued', 'running') ORDER BY id").all(String(userId))
      .map((row) => ({ ...row, source: json(row.source, {}) }));
  }

  queueLength() {
    return Number(this.sql("SELECT COUNT(*) AS count FROM jobs WHERE status IN ('queued', 'running')").get().count);
  }

  pruneJobs(olderThanMs) {
    return this.sql("DELETE FROM jobs WHERE status IN ('done', 'failed') AND COALESCE(finished_at, created_at) < ?").run(this.now() - olderThanMs).changes;
  }

  // ---------- Kanal raporu kutusu ----------

  enqueueOutbox({ guildId, channelId, threadId = null, matchId, userId = null, kind = "match-report" }) {
    const result = this.sql(`INSERT INTO outbox (guild_id, channel_id, thread_id, match_id, user_id, kind, status, next_attempt_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?) ON CONFLICT(guild_id, match_id, kind) DO NOTHING`)
      .run(String(guildId), String(channelId), threadId, String(matchId), userId, kind, this.now(), this.now());
    return result.changes > 0;
  }

  dueOutbox(limit = 5) {
    return this.sql("SELECT * FROM outbox WHERE status = 'pending' AND next_attempt_at <= ? ORDER BY next_attempt_at LIMIT ?").all(this.now(), limit).map(plain);
  }

  updateOutbox(id, patch) {
    const entries = Object.entries(patch).filter(([key]) => ["status", "attempts", "next_attempt_at", "error"].includes(key));
    if (entries.length) this.db.prepare(`UPDATE outbox SET ${entries.map(([key]) => `${key} = ?`).join(", ")} WHERE id = ?`).run(...entries.map(([, value]) => value ?? null), Number(id));
  }

  outboxStats(guildId) {
    return this.sql("SELECT status, COUNT(*) AS count, MAX(error) AS error FROM outbox WHERE guild_id = ? GROUP BY status").all(String(guildId)).map(plain);
  }

  // ---------- Takım koçu ----------

  saveSquadMatch(compact) {
    const ids = new Set();
    for (const team of compact.teams || []) for (const player of team.players || []) if (player.steamid) ids.add(player.steamid);
    this.sql(`INSERT INTO squad_matches (id, map, played_at, steam_ids, data) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET map = excluded.map, played_at = excluded.played_at, steam_ids = excluded.steam_ids, data = excluded.data`)
      .run(compact.id, compact.map, Number(compact.timestamp || 0), `,${[...ids].join(",")},`, JSON.stringify(compact));
  }

  /** Haritada en az bir roster oyuncusunun bulunduğu kompakt maçlar. */
  squadMatchesFor(map, steamIds, limit = 120) {
    const ids = [...new Set(steamIds.filter(Boolean))];
    if (!ids.length) return [];
    const clauses = ids.map(() => "steam_ids LIKE ?").join(" OR ");
    const params = ids.map((id) => `%,${id},%`);
    const sql = map ? `SELECT data FROM squad_matches WHERE map = ? AND (${clauses}) ORDER BY played_at DESC LIMIT ?` : `SELECT data FROM squad_matches WHERE ${clauses} ORDER BY played_at DESC LIMIT ?`;
    return this.db.prepare(sql).all(...(map ? [map] : []), ...params, limit).map((row) => json(row.data, null)).filter(Boolean);
  }

  saveSquad(squad) {
    const now = this.now();
    this.sql(`INSERT INTO squads (id, scope, name, map, roster, owner_user_id, owner_steam_id, report, assignments, notes, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET name = excluded.name, map = excluded.map, roster = excluded.roster, owner_steam_id = excluded.owner_steam_id,
      report = excluded.report, assignments = excluded.assignments, notes = excluded.notes, updated_at = excluded.updated_at`).run(
      squad.id, squad.scope, squad.name, squad.map, JSON.stringify(squad.roster), squad.owner_user_id, squad.owner_steam_id ?? null,
      squad.report ? JSON.stringify(squad.report) : null, JSON.stringify(squad.assignments || {}), String(squad.notes || ""), squad.created_at || now, now);
    return this.getSquad(squad.id);
  }

  getSquad(id) {
    const row = plain(this.sql("SELECT * FROM squads WHERE id = ?").get(String(id)));
    if (!row) return null;
    return { ...row, roster: json(row.roster, []), report: json(row.report, null), assignments: json(row.assignments, {}) };
  }

  squadsInScope(scope) {
    return this.sql("SELECT id FROM squads WHERE scope = ? ORDER BY updated_at DESC LIMIT 25").all(String(scope)).map((row) => this.getSquad(row.id));
  }

  deleteSquad(id) {
    this.sql("DELETE FROM live_sessions WHERE squad_id = ?").run(String(id));
    this.sql("DELETE FROM squads WHERE id = ?").run(String(id));
  }

  saveLiveSession({ squadId, userId, guildId = null, channelId, roundMessageId = null, session, messageKey = null, active = true }) {
    this.sql(`INSERT INTO live_sessions (squad_id, user_id, guild_id, channel_id, round_message_id, session, message_key, active, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(squad_id) DO UPDATE SET user_id = excluded.user_id, guild_id = excluded.guild_id,
      channel_id = excluded.channel_id, round_message_id = excluded.round_message_id, session = excluded.session,
      message_key = excluded.message_key, active = excluded.active, updated_at = excluded.updated_at`)
      .run(String(squadId), String(userId), guildId, String(channelId), roundMessageId, JSON.stringify(session), messageKey, active ? 1 : 0, this.now());
  }

  liveSessionsForUser(userId) {
    return this.sql("SELECT * FROM live_sessions WHERE user_id = ? AND active = 1").all(String(userId)).map((row) => ({ ...row, session: json(row.session, {}) }));
  }

  liveSession(squadId) {
    const row = plain(this.sql("SELECT * FROM live_sessions WHERE squad_id = ?").get(String(squadId)));
    return row ? { ...row, session: json(row.session, {}) } : null;
  }

  stopLiveSession(squadId) {
    this.sql("UPDATE live_sessions SET active = 0, updated_at = ? WHERE squad_id = ?").run(this.now(), String(squadId));
  }

  // ---------- Tek kullanımlık bağlantılar ----------

  saveToken({ tokenHash, kind, userId, data = {}, ttlMs }) {
    this.sql("INSERT INTO tokens (token_hash, kind, user_id, data, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(tokenHash, kind, String(userId), JSON.stringify(data), this.now() + ttlMs, this.now());
  }

  getToken(tokenHash, kind) {
    const row = plain(this.sql("SELECT * FROM tokens WHERE token_hash = ? AND kind = ?").get(String(tokenHash), kind));
    if (!row) return null;
    return { ...row, data: json(row.data, {}) };
  }

  useToken(tokenHash) {
    return this.sql("UPDATE tokens SET used_at = ? WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?").run(this.now(), String(tokenHash), this.now()).changes > 0;
  }

  revokeTokens(userId, kind) {
    this.sql("DELETE FROM tokens WHERE user_id = ? AND kind = ?").run(String(userId), kind);
  }

  pruneTokens() {
    return this.sql("DELETE FROM tokens WHERE expires_at < ?").run(this.now()).changes;
  }

  // ---------- Kullanım ve premium ----------

  usageToday(userId, day) {
    return Number(this.sql("SELECT analyses FROM usage WHERE user_id = ? AND day = ?").get(String(userId), day)?.analyses || 0);
  }

  addUsage(userId, day) {
    this.sql(`INSERT INTO usage (user_id, day, analyses) VALUES (?, ?, 1) ON CONFLICT(user_id, day) DO UPDATE SET analyses = usage.analyses + 1`).run(String(userId), day);
  }

  grantPremium({ targetType, targetId, until, source, note = "" }) {
    this.sql("INSERT INTO premium_grants (target_type, target_id, until, source, note, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(targetType, String(targetId), Number(until), source, note, this.now());
    if (targetType === "user") this.sql("UPDATE users SET premium_until = MAX(premium_until, ?) WHERE id = ?").run(Number(until), String(targetId));
    if (targetType === "guild") this.sql("UPDATE guilds SET premium_until = MAX(premium_until, ?) WHERE id = ?").run(Number(until), String(targetId));
  }

  stats() {
    const count = (table, where = "") => Number(this.db.prepare(`SELECT COUNT(*) AS count FROM ${table} ${where}`).get().count);
    return {
      users: count("users"),
      steamLinked: count("users", "WHERE steam_id IS NOT NULL"),
      faceitLinked: count("users", "WHERE faceit_player_id IS NOT NULL"),
      guilds: count("guilds"),
      matches: count("matches"),
      analyzedFiles: count("matches", "WHERE analysis_file IS NOT NULL"),
      queued: count("jobs", "WHERE status IN ('queued', 'running')"),
      failed24h: Number(this.sql("SELECT COUNT(*) AS count FROM jobs WHERE status = 'failed' AND finished_at > ?").get(this.now() - 86_400_000).count),
      squads: count("squads"),
      premiumUsers: Number(this.sql("SELECT COUNT(*) AS count FROM users WHERE premium_until > ?").get(this.now()).count),
    };
  }
}
