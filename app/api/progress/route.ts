import { env } from "cloudflare:workers";
import { getChatGPTUser } from "../../chatgpt-auth";

const PROFILE_TABLE = `CREATE TABLE IF NOT EXISTS tracer_profiles (
  owner_id TEXT PRIMARY KEY NOT NULL,
  steam_id TEXT NOT NULL,
  player_name TEXT NOT NULL,
  updated_at INTEGER NOT NULL
)`;
const MATCH_TABLE = `CREATE TABLE IF NOT EXISTS tracer_match_summaries (
  owner_id TEXT NOT NULL,
  match_id TEXT NOT NULL,
  match_date INTEGER NOT NULL,
  file_name TEXT NOT NULL,
  map_name TEXT NOT NULL,
  player_steam_id TEXT NOT NULL,
  player_name TEXT NOT NULL,
  summary_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (owner_id, match_id)
)`;
const MATCH_INDEX = "CREATE INDEX IF NOT EXISTS idx_tracer_match_owner_date ON tracer_match_summaries(owner_id, match_date)";

type CompactSummary = {
  overall: number | null;
  dimensions: Record<string, number | null>;
  stats: Record<string, number | null>;
  weapons: Array<{ weapon: string; label: string; score: number | null; kills: number; shots: number }>;
};

type ProgressInput = {
  matchId?: string;
  matchDate?: number;
  fileName?: string;
  map?: string;
  player?: { steamid?: string; name?: string };
  summary?: CompactSummary;
};

async function ownerId() {
  const user = await getChatGPTUser();
  return user?.userId || "local-device";
}

type Db = NonNullable<typeof env.DB>;
let dbReadyPromise: Promise<Db> | null = null;

function readyDb(): Promise<Db> {
  const db = env.DB;
  if (!db) throw new Error("DB_UNAVAILABLE");
  if (!dbReadyPromise) {
    const promise = db.batch([
      db.prepare(PROFILE_TABLE),
      db.prepare(MATCH_TABLE),
      db.prepare(MATCH_INDEX),
    ]).then(() => db).catch((error: unknown) => {
      dbReadyPromise = null;
      throw error;
    });
    dbReadyPromise = promise;
    return promise;
  }
  return dbReadyPromise;
}

function safeJson(value: string) {
  try { return JSON.parse(value); } catch { return null; }
}

function validSummary(summary: CompactSummary | undefined) {
  const validMetric = (value: number | null) => value === null || (Number.isFinite(value) && value >= 0 && value <= 100);
  if (!summary || !validMetric(summary.overall)) return false;
  const dimensions = Object.values(summary.dimensions || {});
  if (dimensions.length !== 6 || dimensions.some((score) => !validMetric(score))) return false;
  return Array.isArray(summary.weapons) && summary.weapons.length <= 10;
}

export async function GET() {
  try {
    const db = await readyDb();
    const owner = await ownerId();
    const profile = await db.prepare("SELECT steam_id AS steamid, player_name AS name, updated_at AS updatedAt FROM tracer_profiles WHERE owner_id = ?")
      .bind(owner).first<{ steamid: string; name: string; updatedAt: number }>();
    const baseQuery = `SELECT match_id AS id, match_date AS date, file_name AS fileName, map_name AS map,
      player_steam_id AS playerSteamId, player_name AS playerName, summary_json AS summary
      FROM tracer_match_summaries WHERE owner_id = ?`;
    const result = !profile
      ? { results: [] }
      : profile.steamid
        ? await db.prepare(`${baseQuery} AND player_steam_id = ? ORDER BY match_date DESC LIMIT 90`).bind(owner, profile.steamid).all()
        : await db.prepare(`${baseQuery} AND player_name = ? ORDER BY match_date DESC LIMIT 90`).bind(owner, profile.name).all();
    const matches = (result.results || []).map((row: Record<string, unknown>) => ({ ...row, summary: safeJson(String(row.summary || "")) })).filter((row: { summary?: unknown }) => row.summary);
    return Response.json({ profile, matches, limit: 90 });
  } catch (error) {
    return Response.json({ error: error instanceof Error && error.message === "DB_UNAVAILABLE" ? "Gelişim hafızası bu ortamda bağlı değil." : "Gelişim geçmişi okunamadı." }, { status: 503 });
  }
}

export async function PUT(request: Request) {
  try {
    const body = await request.json() as { steamid?: string; name?: string };
    const steamid = String(body.steamid || "").trim();
    const name = String(body.name || "").trim().slice(0, 80);
    if (!name || (steamid && !/^\d{17}$/.test(steamid))) return Response.json({ error: "Geçerli bir demo oyuncusu seç." }, { status: 400 });
    const db = await readyDb();
    const owner = await ownerId();
    await db.prepare(`INSERT INTO tracer_profiles (owner_id, steam_id, player_name, updated_at) VALUES (?, ?, ?, ?)
      ON CONFLICT(owner_id) DO UPDATE SET steam_id = excluded.steam_id, player_name = excluded.player_name, updated_at = excluded.updated_at`)
      .bind(owner, steamid, name, Date.now()).run();
    return Response.json({ profile: { steamid, name } });
  } catch {
    return Response.json({ error: "Oyuncu profili kaydedilemedi." }, { status: 503 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as ProgressInput;
    const matchId = String(body.matchId || "").trim().slice(0, 240);
    const fileName = String(body.fileName || "").trim().slice(0, 180);
    const map = String(body.map || "").trim().slice(0, 64);
    const playerSteamId = String(body.player?.steamid || "").trim();
    const playerName = String(body.player?.name || "").trim().slice(0, 80);
    const matchDate = Number(body.matchDate);
    if (!matchId || !fileName || !map || !playerName || !Number.isFinite(matchDate) || !validSummary(body.summary)) {
      return Response.json({ error: "Maç özeti geçersiz." }, { status: 400 });
    }
    const summaryJson = JSON.stringify(body.summary);
    if (summaryJson.length > 12_000) return Response.json({ error: "Maç özeti boyut sınırını aşıyor." }, { status: 413 });
    const db = await readyDb();
    const owner = await ownerId();
    const profile = await db.prepare("SELECT steam_id AS steamid, player_name AS name FROM tracer_profiles WHERE owner_id = ?").bind(owner).first<{ steamid: string; name: string }>();
    if (!profile) return Response.json({ error: "Önce demodaki kendi oyuncunu seç." }, { status: 409 });
    const samePlayer = profile.steamid ? profile.steamid === playerSteamId : profile.name === playerName;
    if (!samePlayer) return Response.json({ error: "Bu özet seçili kullanıcıya ait değil; kaydedilmedi." }, { status: 409 });
    await db.prepare(`INSERT INTO tracer_match_summaries
      (owner_id, match_id, match_date, file_name, map_name, player_steam_id, player_name, summary_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(owner_id, match_id) DO UPDATE SET match_date = excluded.match_date, file_name = excluded.file_name,
      map_name = excluded.map_name, player_steam_id = excluded.player_steam_id, player_name = excluded.player_name,
      summary_json = excluded.summary_json, created_at = excluded.created_at`)
      .bind(owner, matchId, matchDate, fileName, map, playerSteamId, playerName, summaryJson, Date.now()).run();
    if (profile.steamid) {
      await db.prepare(`DELETE FROM tracer_match_summaries WHERE owner_id = ? AND player_steam_id = ? AND match_id NOT IN (
        SELECT match_id FROM tracer_match_summaries WHERE owner_id = ? AND player_steam_id = ? ORDER BY match_date DESC LIMIT 90
      )`).bind(owner, profile.steamid, owner, profile.steamid).run();
    } else {
      await db.prepare(`DELETE FROM tracer_match_summaries WHERE owner_id = ? AND player_name = ? AND match_id NOT IN (
        SELECT match_id FROM tracer_match_summaries WHERE owner_id = ? AND player_name = ? ORDER BY match_date DESC LIMIT 90
      )`).bind(owner, profile.name, owner, profile.name).run();
    }
    return Response.json({ saved: true });
  } catch {
    return Response.json({ error: "Maç özeti gelişim hafızasına kaydedilemedi." }, { status: 503 });
  }
}
