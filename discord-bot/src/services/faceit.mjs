// Çok kullanıcılı FACEIT servisi. Bot sahibinin tek Data API anahtarıyla her
// kullanıcının herkese açık maç geçmişini okur; masaüstündeki FaceitClient ile
// aynı normalizeFaceitMatches dönüşümünü ve hata mesajlarını kullanır.
import { normalizeFaceitMatches } from "../../engine/companion/faceit.mjs";
import { logger } from "../log.mjs";

const log = logger("faceit");
const API = "https://open.faceit.com";
const MATCH_ID = /^\d-[a-f0-9-]{36}$/i;

export class FaceitError extends Error {
  constructor(message, status = 0) {
    super(message);
    this.status = status;
    this.retryable = status >= 500 || status === 429 || status === 0;
    this.userFacing = true;
  }
}

export class FaceitService {
  constructor({ apiKey, downloadsToken = "", store, fetchImpl = fetch }) {
    this.apiKey = apiKey;
    this.downloadsToken = downloadsToken;
    this.store = store;
    this.fetch = fetchImpl;
    this.scans = new Map();
  }

  get enabled() {
    return Boolean(this.apiKey);
  }

  async request(path, { token = this.apiKey, signal, body } = {}) {
    let response;
    try {
      response = await this.fetch(`${API}${path}`, {
        method: body ? "POST" : "GET",
        redirect: "error",
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(12_000)]) : AbortSignal.timeout(12_000),
      });
    } catch (error) {
      if (signal?.aborted) throw error;
      throw new FaceitError("FACEIT zamanında yanıt vermedi. Biraz sonra tekrar dene.");
    }
    if (!response.ok) {
      const messages = {
        401: "Botun FACEIT anahtarı geçersiz; bot sahibine haber ver.",
        403: body ? "FACEIT demo indirme (Downloads API) izni yok. Maç odasından demoyu indirip /analiz ile yükle." : "FACEIT erişimi reddedildi.",
        404: "FACEIT oyuncusu, maçı veya demosu bulunamadı.",
        429: "FACEIT istek sınırına ulaşıldı. Birkaç dakika sonra tekrar dene.",
      };
      await response.body?.cancel();
      throw new FaceitError(messages[response.status] || `FACEIT servisi yanıt veremedi (${response.status}).`, response.status);
    }
    return response.json();
  }

  async findPlayer(nicknameOrId) {
    const value = String(nicknameOrId || "").trim();
    if (!value || value.length > 100 || /[\r\n/?#]/.test(value)) throw new FaceitError("Geçerli bir FACEIT kullanıcı adı yaz.");
    const fromUrl = value.match(/faceit\.com\/[a-z-]+\/players\/([^/?#]+)/i)?.[1];
    const nickname = fromUrl ? decodeURIComponent(fromUrl) : value;
    const player = /^[0-9a-f-]{36}$/i.test(nickname)
      ? await this.request(`/data/v4/players/${encodeURIComponent(nickname)}`)
      : await this.request(`/data/v4/players?nickname=${encodeURIComponent(nickname)}&game=cs2`);
    if (!player?.player_id) throw new FaceitError("FACEIT oyuncusu bulunamadı.", 404);
    return player;
  }

  static summarize(player) {
    const cs2 = player?.games?.cs2 || {};
    return {
      playerId: player.player_id,
      nickname: player.nickname,
      avatar: player.avatar || "",
      country: player.country || "",
      level: Number(cs2.skill_level) || null,
      elo: Number(cs2.faceit_elo) || null,
      region: cs2.region || "",
      steamId: /^7656119\d{10}$/.test(String(cs2.game_player_id || "")) ? String(cs2.game_player_id) : /^7656119\d{10}$/.test(String(player.steam_id_64 || "")) ? String(player.steam_id_64) : "",
      url: player.faceit_url ? String(player.faceit_url).replace("{lang}", "tr") : `https://www.faceit.com/tr/players/${encodeURIComponent(player.nickname)}`,
    };
  }

  /** Kullanıcının son 20 FACEIT maçını tarar ve hafızaya yazar. Aynı oyuncu için tek iş paylaşılır. */
  scan(playerId) {
    if (this.scans.has(playerId)) return this.scans.get(playerId);
    const job = this.performScan(playerId).finally(() => this.scans.delete(playerId));
    this.scans.set(playerId, job);
    return job;
  }

  async performScan(playerId) {
    const signal = AbortSignal.timeout(90_000);
    const request = (path) => this.request(path, { signal });
    const player = await request(`/data/v4/players/${encodeURIComponent(playerId)}`);
    const history = await request(`/data/v4/players/${encodeURIComponent(playerId)}/history?game=cs2&offset=0&limit=20`);
    if (!Array.isArray(history.items)) throw new FaceitError("FACEIT maç geçmişi okunamadı.");
    const cached = new Map(this.store.faceitMatches(playerId, 100).map((match) => [match.id, match]));
    const fresh = [];
    let partial = false;
    for (const item of history.items) {
      if (!MATCH_ID.test(item.match_id || "") || item.status !== "FINISHED") continue;
      const known = [...cached.values()].filter((match) => match.faceitMatchId === item.match_id);
      if (known.length && known.every((match) => match.statsAvailable && match.demoResource)) continue;
      try {
        const detail = await request(`/data/v4/matches/${item.match_id}`);
        let stats = null;
        try { stats = await request(`/data/v4/matches/${item.match_id}/stats`); } catch (error) { if (error.status !== 404) throw error; partial = true; }
        fresh.push(...normalizeFaceitMatches(detail, stats, player));
      } catch (error) {
        if ([401, 403, 429].includes(error.status) || signal.aborted) throw error;
        partial = true;
        if (!known.length) fresh.push(...normalizeFaceitMatches(item, null, player));
      }
    }
    if (fresh.length) this.store.saveFaceitMatches(playerId, fresh);
    const newIds = fresh.filter((match) => !cached.has(match.id)).map((match) => match.id);
    log.debug(`${player.nickname}: ${fresh.length} maç güncellendi, ${newIds.length} yeni.`);
    // İlk taramada geçmiş maçlar "yeni" sayılmaz; otomatik analiz yalnız sonrakilerde tetiklenir.
    return { player: FaceitService.summarize(player), updated: fresh.length, newIds, hadHistory: cached.size > 0, partial, matches: this.store.faceitMatches(playerId, 20) };
  }

  get canDownload() {
    return Boolean(this.downloadsToken);
  }

  /** Downloads API ile imzalı demo bağlantısı (yalnız bot sahibinin onaylı tokenı varsa). */
  async demoUrl(match, signal) {
    if (!this.downloadsToken) throw Object.assign(new FaceitError("Bu botta FACEIT otomatik demo indirme kapalı. Maç odasından demoyu indirip /analiz ile yükle (büyük dosyalar için yükleme bağlantısı verilir)."), { retryable: false });
    const detail = await this.request(`/data/v4/matches/${match.faceitMatchId}`, { signal });
    const resource = detail.demo_url?.[match.faceitMapIndex || 0];
    if (!resource) throw Object.assign(new FaceitError("FACEIT demosu henüz hazır değil veya artık saklanmıyor."), { retryable: false });
    const result = await this.request("/download/v2/demos/download", { token: this.downloadsToken, signal, body: { resource_url: resource } });
    if (!result.payload?.download_url) throw new FaceitError("FACEIT demo indirme bağlantısı alınamadı.");
    return result.payload.download_url;
  }
}
