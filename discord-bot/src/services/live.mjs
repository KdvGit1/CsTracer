// CS2 Game State Integration (GSI) verisini kullanıcı başına tutar. Her oyuncu
// kendi cfg dosyasındaki gizli anahtarla bulut botuna veri gönderir. Kullanımlar:
//  • /canli durum kartı
//  • maç bitince (gameover) otomatik demo taraması
//  • takım koçunun Discord'da round round güncellenen canlı planı
import { randomToken } from "../secrets.mjs";

const STALE_MS = 30_000;
const MAX_USERS = 500;

function position(value) {
  if (!value) return null;
  const parts = typeof value === "string" ? value.split(",").map((part) => Number(part.trim())) : [Number(value.x ?? value[0]), Number(value.y ?? value[1]), Number(value.z ?? value[2] ?? 0)];
  return parts.length >= 2 && Number.isFinite(parts[0]) && Number.isFinite(parts[1]) ? { x: parts[0], y: parts[1], z: Number.isFinite(parts[2]) ? parts[2] : 0 } : null;
}

/** GSI paketini masaüstü gsi.mjs'in getLiveState() biçimine (squad/live.mjs'in beklediği) çevirir. */
export function normalizeGsi(previous, payload, now = Date.now()) {
  const state = previous ? structuredClone(previous) : {
    connected: true, lastPacketTime: 0, packetCount: 0,
    map: { name: "", mode: "", phase: "", round: 0, scoreCT: 0, scoreT: 0 },
    round: { phase: "", winTeam: "", bomb: "", phaseEndsIn: null },
    player: { name: "", steamid: "", activity: "", team: "", health: 100, money: 0, kills: 0, deaths: 0, assists: 0, mvps: 0, position: null },
    team: { allies: [], totalMoney: 0 },
    bomb: { state: "" },
    matchKey: "",
  };
  state.lastPacketTime = now;
  state.packetCount++;
  if (payload.map) {
    const name = String(payload.map.name || "").replace(/^de_/, "");
    const phase = String(payload.map.phase || "");
    if (name && (name !== state.map.name || (phase === "warmup" && state.map.phase === "gameover"))) state.matchKey = `${name}:${now}`;
    state.map = {
      name, mode: String(payload.map.mode || ""), phase,
      round: Number(payload.map.round || 0),
      scoreCT: Number(payload.map.team_ct?.score || 0), scoreT: Number(payload.map.team_t?.score || 0),
    };
  }
  if (payload.round) state.round = { ...state.round, phase: String(payload.round.phase || ""), winTeam: String(payload.round.win_team || ""), bomb: String(payload.round.bomb || "") };
  if (payload.phase_countdowns) {
    const phase = String(payload.phase_countdowns.phase || "");
    if (phase) state.round.phase = phase;
    state.round.phaseEndsIn = payload.phase_countdowns.phase_ends_in ? Number(payload.phase_countdowns.phase_ends_in) : null;
  }
  if (payload.bomb) state.bomb = { state: String(payload.bomb.state || "") };
  const player = payload.player;
  if (player) {
    const stats = player.state || {};
    const match = player.match_stats || {};
    const team = String(player.team || "").toUpperCase();
    state.player = {
      ...state.player,
      name: String(player.name || state.player.name),
      steamid: String(player.steamid || state.player.steamid),
      activity: String(player.activity || state.player.activity || ""),
      team: team === "CT" || team === "3" ? "CT" : team === "T" || team === "2" ? "T" : state.player.team,
      health: stats.health !== undefined ? Number(stats.health) : state.player.health,
      money: stats.money !== undefined ? Number(stats.money) : state.player.money,
      kills: match.kills !== undefined ? Number(match.kills) : state.player.kills,
      deaths: match.deaths !== undefined ? Number(match.deaths) : state.player.deaths,
      assists: match.assists !== undefined ? Number(match.assists) : state.player.assists,
      mvps: match.mvps !== undefined ? Number(match.mvps) : state.player.mvps,
      position: position(player.position) || state.player.position,
    };
  }
  if (payload.allplayers && typeof payload.allplayers === "object") {
    const allies = Object.entries(payload.allplayers).filter(([id, item]) => id !== state.player.steamid && String(item?.team || "").toUpperCase() === state.player.team);
    state.team = { allies: allies.map(([id, item]) => ({ steamid: id, name: item.name, position: position(item.position) })), totalMoney: allies.reduce((sum, [, item]) => sum + Number(item?.state?.money || 0), state.player.money || 0) };
  }
  return state;
}

export function gsiConfig(publicUrl, token) {
  return `"TRACER Discord Bot"
{
    "uri" "${publicUrl}/gsi"
    "timeout" "5.0"
    "buffer"  "0.5"
    "throttle" "1.0"
    "heartbeat" "15.0"
    "auth"
    {
        "token" "${token}"
    }
    "data"
    {
        "provider"              "1"
        "map"                   "1"
        "round"                 "1"
        "player_id"             "1"
        "player_state"          "1"
        "player_match_stats"    "1"
        "player_position"       "1"
        "bomb"                  "1"
        "phase_countdowns"      "1"
    }
}
`;
}

export class LiveService {
  constructor({ hooks = {}, now = () => Date.now() } = {}) {
    this.states = new Map();
    this.hooks = hooks;
    this.now = now;
    this.endedMatches = new Set();
  }

  newToken() {
    return randomToken(24);
  }

  ingest(userId, payload) {
    const now = this.now();
    const previous = this.states.get(userId);
    const state = normalizeGsi(previous?.state, payload, now);
    if (!previous && this.states.size >= MAX_USERS) {
      const oldest = [...this.states.entries()].sort((a, b) => a[1].state.lastPacketTime - b[1].state.lastPacketTime)[0];
      if (oldest) this.states.delete(oldest[0]);
    }
    this.states.set(userId, { state });
    const ended = state.map.phase === "gameover" && previous?.state?.map?.phase !== "gameover";
    if (ended && state.matchKey && !this.endedMatches.has(`${userId}:${state.matchKey}`)) {
      this.endedMatches.add(`${userId}:${state.matchKey}`);
      if (this.endedMatches.size > 5000) this.endedMatches.clear();
      this.hooks.onMatchEnd?.(userId, state);
    }
    this.hooks.onUpdate?.(userId, state);
    return state;
  }

  get(userId) {
    const entry = this.states.get(userId);
    if (!entry) return null;
    return { ...entry.state, connected: this.now() - entry.state.lastPacketTime <= STALE_MS };
  }
}
