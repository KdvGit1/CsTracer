// Steam tarafı: profil çözümleme, resmî maç geçmişi API'si (kimlik kodu +
// paylaşım kodu) ve isteğe bağlı oyun koordinatörü (GC) ile paylaşım kodundan
// demo bağlantısı alma. Kullanıcıların Steam çerezi/oturumu hiçbir zaman istenmez.
import { logger } from "../log.mjs";

const log = logger("steam");
const DICTIONARY = "ABCDEFGHJKLMNOPQRSTUVWXYZabcdefhijkmnopqrstuvwxyz23456789";
const SHARE_CODE = /^CSGO(-[A-Za-z0-9]{5}){5}$/;
const AUTH_CODE = /^[A-Z0-9]{4}-[A-Z0-9]{5}-[A-Z0-9]{4}$/;
const STEAM_ID64 = /^7656119\d{10}$/;
const ACCOUNT_BASE = 76561197960265728n;

export class SteamError extends Error {
  constructor(message, { status = 0, retryable = false } = {}) {
    super(message);
    this.status = status;
    this.retryable = retryable;
    this.userFacing = true;
  }
}

export function isShareCode(value) {
  return SHARE_CODE.test(String(value || "").trim());
}

export function isAuthCode(value) {
  return AUTH_CODE.test(String(value || "").trim().toUpperCase());
}

/** CSGO-xxxxx-... paylaşım kodunu maç kimliğine çevirir. */
export function decodeShareCode(value) {
  const code = String(value || "").trim();
  if (!isShareCode(code)) throw new SteamError("Paylaşım kodu CSGO-xxxxx-xxxxx-xxxxx-xxxxx-xxxxx biçiminde olmalı.");
  const characters = [...code.replace(/^CSGO|-/g, "")].reverse();
  let big = 0n;
  for (const character of characters) {
    const index = DICTIONARY.indexOf(character);
    if (index < 0) throw new SteamError("Paylaşım kodunda geçersiz karakter var.");
    big = big * 57n + BigInt(index);
  }
  const bytes = new Array(18).fill(0);
  for (let index = 17; index >= 0; index--) {
    bytes[index] = Number(big & 0xffn);
    big >>= 8n;
  }
  const little = (slice) => slice.reduceRight((sum, byte) => (sum << 8n) + BigInt(byte), 0n);
  return {
    matchId: little(bytes.slice(0, 8)).toString(),
    outcomeId: little(bytes.slice(8, 16)).toString(),
    token: bytes[16] | (bytes[17] << 8),
  };
}

export function parseSteamInput(value) {
  const input = String(value || "").trim();
  if (STEAM_ID64.test(input)) return { steamId: input };
  const profile = input.match(/steamcommunity\.com\/profiles\/(7656119\d{10})/i);
  if (profile) return { steamId: profile[1] };
  const steam3 = input.match(/^\[?U:1:(\d{1,10})\]?$/i);
  if (steam3) return { steamId: String(ACCOUNT_BASE + BigInt(steam3[1])) };
  const steam2 = input.match(/^STEAM_[01]:([01]):(\d{1,10})$/i);
  if (steam2) return { steamId: String(ACCOUNT_BASE + BigInt(steam2[2]) * 2n + BigInt(steam2[1])) };
  const vanity = input.match(/steamcommunity\.com\/id\/([\w-]{2,32})/i)?.[1] || (/^[\w-]{2,32}$/.test(input) ? input : "");
  if (vanity) return { vanity };
  return null;
}

export class SteamService {
  constructor({ apiKey, bot = {}, fetchImpl = fetch }) {
    this.apiKey = apiKey;
    this.botConfig = bot;
    this.fetch = fetchImpl;
    this.gc = null;
    this.gcReady = null;
  }

  get enabled() {
    return Boolean(this.apiKey);
  }

  canResolveShareCodes() {
    return Boolean(this.botConfig?.username && this.botConfig?.password);
  }

  async api(path, params = {}, { allowStatus = [] } = {}) {
    if (!this.apiKey) throw new SteamError("Bu botta Steam Web API anahtarı tanımlı değil.");
    const url = new URL(`https://api.steampowered.com/${path}`);
    url.searchParams.set("key", this.apiKey);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
    let response;
    try {
      response = await this.fetch(url, { signal: AbortSignal.timeout(12_000), headers: { Accept: "application/json" } });
    } catch {
      throw new SteamError("Steam'e ulaşılamadı. Biraz sonra tekrar dene.", { retryable: true });
    }
    if (allowStatus.includes(response.status)) {
      await response.body?.cancel();
      return { status: response.status };
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new SteamError(`Steam API hatası (${response.status}).`, { status: response.status, retryable: response.status >= 500 || response.status === 429 });
    }
    return { status: response.status, body: await response.json() };
  }

  async resolveSteamId(input) {
    const parsed = parseSteamInput(input);
    if (!parsed) throw new SteamError("Steam profil bağlantısı, SteamID64 veya özel profil adı yaz.");
    if (parsed.steamId) return parsed.steamId;
    const { body } = await this.api("ISteamUser/ResolveVanityURL/v1/", { vanityurl: parsed.vanity });
    if (body?.response?.success !== 1 || !STEAM_ID64.test(String(body.response.steamid || ""))) throw new SteamError("Bu Steam özel profil adı bulunamadı.");
    return String(body.response.steamid);
  }

  async summary(steamId) {
    if (!this.apiKey) return { steamId, name: "", avatar: "", public: null };
    const { body } = await this.api("ISteamUser/GetPlayerSummaries/v2/", { steamids: steamId });
    const player = body?.response?.players?.[0];
    if (!player) throw new SteamError("Steam profili bulunamadı.", { status: 404 });
    return { steamId, name: player.personaname || "", avatar: player.avatarfull || player.avatarmedium || "", public: player.communityvisibilitystate === 3, profileUrl: player.profileurl || "" };
  }

  /**
   * Resmî maç geçmişi API'si: bilinen koddan sonraki paylaşım kodunu döndürür.
   * 202 = yeni maç yok. Kimlik kodu yalnız maç geçmişini okumaya izin verir.
   */
  async nextShareCode(steamId, authCode, knownCode) {
    const { status, body } = await this.api("ICSGOPlayers_730/GetNextMatchSharingCode/v1", { steamid: steamId, steamidkey: authCode, knowncode: knownCode }, { allowStatus: [202, 403, 412] });
    if (status === 202) return null;
    if (status === 403) throw new SteamError("Steam maç geçmişi kimlik kodu geçersiz. /hesap steam ile yenisini gir.", { status });
    if (status === 412) throw new SteamError("Son paylaşım kodu Steam tarafından tanınmadı. /hesap steam ile en son maçının paylaşım kodunu gir.", { status });
    const next = body?.result?.nextcode;
    return next && next !== "n/a" && isShareCode(next) ? next : null;
  }

  /** Bilinen koddan itibaren en fazla `limit` yeni paylaşım kodu. */
  async newShareCodes(steamId, authCode, knownCode, limit = 5) {
    const codes = [];
    let current = knownCode;
    for (let index = 0; index < limit; index++) {
      const next = await this.nextShareCode(steamId, authCode, current);
      if (!next) break;
      codes.push(next);
      current = next;
    }
    return codes;
  }

  async ensureGc() {
    if (!this.canResolveShareCodes()) throw new SteamError("Paylaşım kodundan demo almak için STEAM_BOT_USERNAME/PASSWORD gerekli.");
    if (this.gcReady) return this.gcReady;
    this.gcReady = (async () => {
      const [{ default: SteamUser }, { default: GlobalOffensive }, totp] = await Promise.all([
        import("steam-user"), import("globaloffensive"), import("steam-totp").catch(() => null),
      ]);
      const user = new SteamUser({ autoRelogin: true, renewRefreshTokens: true });
      const csgo = new GlobalOffensive(user);
      const ready = new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new SteamError("Steam oyun koordinatörüne bağlanılamadı (zaman aşımı).", { retryable: true })), 60_000);
        csgo.once("connectedToGC", () => { clearTimeout(timer); resolve(); });
        user.once("error", (error) => { clearTimeout(timer); reject(new SteamError(`Steam bot girişi başarısız: ${error.message}`)); });
      });
      user.on("loggedOn", () => {
        log.info("Steam bot hesabı giriş yaptı; CS2 koordinatörüne bağlanılıyor.");
        user.setPersona(SteamUser.EPersonaState.Online);
        user.gamesPlayed([730]);
      });
      user.on("error", (error) => {
        log.warn(`Steam bot hatası: ${error.message}`);
        this.gcReady = null;
      });
      csgo.on("disconnectedFromGC", () => log.warn("CS2 koordinatör bağlantısı koptu; Steam yeniden bağlanacak."));
      const details = { accountName: this.botConfig.username, password: this.botConfig.password };
      if (this.botConfig.sharedSecret && totp?.default?.generateAuthCode) details.twoFactorCode = totp.default.generateAuthCode(this.botConfig.sharedSecret);
      user.logOn(details);
      await ready;
      this.gc = { user, csgo };
      return this.gc;
    })().catch((error) => {
      this.gcReady = null;
      throw error;
    });
    return this.gcReady;
  }

  /** Paylaşım kodundan Valve replay bağlantısı ve maç zamanı. */
  async resolveShareCode(shareCode, signal) {
    const decoded = decodeShareCode(shareCode);
    const { csgo } = await this.ensureGc();
    const match = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { cleanup(); reject(new SteamError("Steam bu paylaşım kodu için yanıt vermedi.", { retryable: true })); }, 30_000);
      const onList = (matches) => {
        const found = (matches || []).find((item) => String(item.matchid) === decoded.matchId) || matches?.[0];
        if (!found) return;
        cleanup();
        resolve(found);
      };
      const onAbort = () => { cleanup(); reject(new SteamError("İşlem iptal edildi.")); };
      const cleanup = () => { clearTimeout(timer); csgo.removeListener("matchList", onList); signal?.removeEventListener("abort", onAbort); };
      csgo.on("matchList", onList);
      signal?.addEventListener("abort", onAbort, { once: true });
      csgo.requestGame(decoded);
    });
    const rounds = Array.isArray(match.roundstatsall) ? match.roundstatsall : [];
    const url = [...rounds].reverse().map((round) => round?.map).find((value) => typeof value === "string" && value.endsWith(".dem.bz2"));
    if (!url) throw new SteamError("Bu maçın demosu Valve sunucularında artık yok (demolar ~2-4 hafta saklanır).");
    const reservation = [...rounds].reverse().find((round) => round?.reservation)?.reservation;
    const gameType = Number(reservation?.game_type || 0);
    return {
      matchId: decoded.matchId,
      url,
      matchTime: Number(match.matchtime) > 0 ? Number(match.matchtime) * 1000 : null,
      mode: gameType ? `Valve maçı (${gameType})` : "Premier / Rekabetçi",
    };
  }

  close() {
    try { this.gc?.user?.logOff(); } catch { /* yok say */ }
  }
}
