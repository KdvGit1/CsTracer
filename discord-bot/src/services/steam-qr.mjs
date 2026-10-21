// Steam'i QR ile bağlama. Oyuncu Steam mobil uygulamasıyla QR'ı okutup onaylar; bot bu kısa
// oturumla yalnız Steam yardım sayfasındaki maç geçmişi kimlik kodunu ve son maç kodunu okur,
// sonra oturumu Steam'de kapatır. Oturum hiçbir yere yazılmaz; saklanan tek şey kimlik kodudur
// (elle girildiğinde olduğu gibi, şifreli).
import { EAuthTokenPlatformType, LoginSession } from "steam-session";
import { encode } from "uqr";
import { logger } from "../log.mjs";

const log = logger("steam-qr");
export const AUTH_CODE_PAGE = "https://help.steampowered.com/en/wizard/HelpWithGameIssue/?appid=730&issueid=128";
const AUTH_CODE = /\b[A-Z0-9]{4}-[A-Z0-9]{5}-[A-Z0-9]{4}\b/;
const SHARE_CODE = /CSGO(?:-[A-Za-z0-9]{5}){5}/;
const QR_TIMEOUT_MS = 2 * 60_000;

export class SteamQrError extends Error {
  constructor(message) {
    super(message);
    this.userFacing = true;
  }
}

/** Yardım sayfasından (ya da oyuncunun yapıştırdığı metinden) kimlik kodu ve son maç kodu. */
export function extractMatchCodes(text) {
  const source = String(text || "");
  // Kimlik kodunu önce "Authentication Code" yazısından sonra ara; sayfadaki başka bir şeye takılmasın.
  const marker = source.search(/authentication\s*code|kimlik\s*doğrulama\s*kodu/i);
  const authCode = (marker >= 0 ? source.slice(marker).match(AUTH_CODE)?.[0] : null) || source.match(AUTH_CODE)?.[0] || null;
  return { authCode, shareCode: source.match(SHARE_CODE)?.[0] || null };
}

/** Steam çerezlerinden belli bir alan adına ait olanları "ad=değer; ..." başlığına çevirir. */
export function cookieHeader(cookies, host) {
  return cookies
    .filter((cookie) => new RegExp(`domain=${host.replace(/\./g, "\\.")}(;|$)`, "i").test(cookie))
    .map((cookie) => cookie.split(";")[0].trim())
    .join("; ");
}

/** QR'ı TRACER kartı olarak SVG'ye çizer (açık zemin üstüne koyu kare: telefonlar en kolay böyle okur). */
export function qrSvg(text) {
  const { size, data } = encode(text, { ecc: "M", border: 0 });
  const cell = 12;
  const pad = 48;
  const side = size * cell + pad * 2;
  const cells = [];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (!data[y][x]) continue;
      // Yan yana koyu kareleri tek dikdörtgende birleştir.
      let run = 1;
      while (x + run < size && data[y][x + run]) run++;
      cells.push(`<rect x="${pad + x * cell}" y="${pad + y * cell}" width="${run * cell}" height="${cell}"/>`);
      x += run - 1;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${side}" height="${side + 44}" viewBox="0 0 ${side} ${side + 44}">`
    + `<rect width="${side}" height="${side + 44}" rx="28" fill="#ffffff"/>`
    + `<g fill="#0b0f0d">${cells.join("")}</g>`
    + `<text x="${side / 2}" y="${side + 22}" text-anchor="middle" font-family="Inter" font-weight="700" font-size="22" fill="#0b0f0d">TRACER · Steam ile bağlan</text>`
    + "</svg>";
}

/** Steam'in protobuf biçimi: alan 1 = token (metin), alan 2 = iptal türü. */
function revokeRequest(token) {
  const bytes = Buffer.from(token, "utf8");
  const length = [];
  for (let value = bytes.length; ; value >>>= 7) {
    if (value < 0x80) { length.push(value); break; }
    length.push((value & 0x7f) | 0x80);
  }
  // 1 = kalıcı çıkış (bu cihazı da unut).
  return Buffer.concat([Buffer.from([0x0a, ...length]), bytes, Buffer.from([0x10, 0x01])]);
}

export class SteamQrLinker {
  constructor({ createSession = () => new LoginSession(EAuthTokenPlatformType.WebBrowser), fetchImpl = fetch, timeoutMs = QR_TIMEOUT_MS } = {}) {
    this.createSession = createSession;
    this.fetch = fetchImpl;
    this.timeoutMs = timeoutMs;
  }

  /**
   * QR'ı başlatır ve onayı bekler. onChallenge(url) QR değiştikçe, onScanned() telefonda açılınca çağrılır.
   * Sonuç: { steamId, authCode, shareCode } (kodlar Steam'de yoksa null).
   */
  async link({ onChallenge, onScanned = () => {}, signal } = {}) {
    const session = this.createSession();
    session.loginTimeout = this.timeoutMs;
    let started;
    try {
      started = await session.startWithQR();
    } catch (error) {
      throw new SteamQrError(`Steam'e ulaşılamadı (${error.message}). Birazdan tekrar dene.`);
    }
    try {
      await new Promise((resolve, reject) => {
        const fail = (message) => { session.cancelLoginAttempt?.(); reject(new SteamQrError(message)); };
        if (signal?.aborted) return fail("QR iptal edildi.");
        signal?.addEventListener("abort", () => fail("Yeni bir QR istendiği için bu QR iptal edildi."), { once: true });
        session.on("authenticated", resolve);
        session.on("timeout", () => fail("QR'ın süresi doldu. `/hesap steam` ile yenisini al."));
        session.on("error", (error) => fail(`Steam girişi tamamlanamadı (${error.message}). Tekrar dene.`));
        session.on("remoteInteraction", () => void Promise.resolve(onScanned()).catch(() => null));
        // Steam QR'ı arada yenileyebilir; yenisini göster ki eski kod boşa okutulmasın.
        session.on("debug", (message, data) => {
          if (message === "poll response" && data?.newChallengeUrl) void Promise.resolve(onChallenge(data.newChallengeUrl)).catch(() => null);
        });
        Promise.resolve(onChallenge(started.qrChallengeUrl)).catch((error) => fail(error.message));
      });
      const steamId = session.steamID?.getSteamID64?.() || String(session.steamID || "");
      if (!/^\d{17}$/.test(steamId)) throw new SteamQrError("Steam hesabın okunamadı. Tekrar dene.");
      const cookie = cookieHeader(await session.getWebCookies(), "help.steampowered.com");
      if (!cookie) log.warn("help.steampowered.com çerezi gelmedi; kod sayfası misafir olarak açılacak.");
      const page = await this.fetch(AUTH_CODE_PAGE, {
        headers: { Cookie: cookie, "Accept-Language": "en-US,en;q=0.9" },
        signal: AbortSignal.timeout(20_000),
      });
      const html = page.ok ? await page.text() : "";
      const codes = extractMatchCodes(html);
      // Sayfa içeriği kişisel veri; günlüğe yalnız teşhis için gereken özet yazılır.
      if (!codes.authCode) log.warn(`Kod sayfasında kimlik kodu yok (HTTP ${page.status}, ${html.length} bayt, oturum ${html.includes(steamId) ? "açık" : "görünmüyor"}).`);
      return { steamId, ...codes };
    } finally {
      await this.signOut(session);
    }
  }

  /** Bu kısa oturumu Steam'de kapatır; hesap "yetkili cihazlar" listesinde kalmaz. */
  async signOut(session) {
    try { session.cancelLoginAttempt?.(); } catch { /* zaten bitti */ }
    if (!session.refreshToken || !session.accessToken) return false;
    try {
      const form = new FormData();
      form.append("input_protobuf_encoded", revokeRequest(session.refreshToken).toString("base64"));
      const response = await this.fetch(`https://api.steampowered.com/IAuthenticationService/RevokeToken/v1/?access_token=${encodeURIComponent(session.accessToken)}`, {
        method: "POST",
        body: form,
        signal: AbortSignal.timeout(10_000),
      });
      const result = response.headers.get("x-eresult");
      if (response.ok && (result === null || result === "1")) return true;
      log.warn(`QR oturumu Steam'de kapatılamadı (HTTP ${response.status}, sonuç ${result}); oturum zaten saklanmıyor.`);
    } catch (error) {
      log.warn(`QR oturumu Steam'de kapatılamadı: ${error.message}; oturum zaten saklanmıyor.`);
    }
    return false;
  }
}
