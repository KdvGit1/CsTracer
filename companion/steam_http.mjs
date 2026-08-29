import http from "node:http";
import https from "node:https";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const MAX_RESPONSE_BYTES = 16 * 1024 * 1024;
const MAX_BRIDGE_OUTPUT_BYTES = 24 * 1024 * 1024;
const __dirname = dirname(fileURLToPath(import.meta.url));

function timeoutError(timeoutMs) {
  const error = new Error(`Steam Community ${Math.round(timeoutMs / 1000)} saniye içinde yanıt vermedi.`);
  error.code = "STEAM_TIMEOUT";
  return error;
}

export function requestTextWithHardTimeout(urlValue, {
  headers = {},
  timeoutMs = 20_000,
  family,
  maxBytes = MAX_RESPONSE_BYTES,
} = {}) {
  const url = urlValue instanceof URL ? urlValue : new URL(urlValue);
  const transport = url.protocol === "http:" ? http : https;

  return new Promise((resolvePromise, rejectPromise) => {
    let settled = false;
    let request;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(hardTimer);
      if (error) rejectPromise(error);
      else resolvePromise(value);
    };
    const hardTimer = setTimeout(() => {
      const error = timeoutError(timeoutMs);
      request?.destroy(error);
      finish(error);
    }, timeoutMs);

    try {
      request = transport.request(url, {
        method: "GET",
        headers,
        family,
        agent: false,
      }, (response) => {
        const chunks = [];
        let receivedBytes = 0;
        response.on("data", (chunk) => {
          receivedBytes += chunk.length;
          if (receivedBytes > maxBytes) {
            const error = new Error("Steam Community yanıtı güvenli boyut sınırını aştı.");
            error.code = "STEAM_RESPONSE_TOO_LARGE";
            response.destroy(error);
            finish(error);
            return;
          }
          chunks.push(chunk);
        });
        response.once("error", (error) => finish(error));
        response.once("end", () => finish(null, {
          status: Number(response.statusCode) || 0,
          headers: response.headers,
          text: Buffer.concat(chunks).toString("utf8"),
        }));
      });
      request.once("error", (error) => finish(error));
      request.end();
    } catch (error) {
      finish(error);
    }
  });
}

export function validateSteamCommunityUrl(urlValue) {
  const url = urlValue instanceof URL ? urlValue : new URL(urlValue);
  if (url.protocol !== "https:" || url.hostname.toLocaleLowerCase() !== "steamcommunity.com" || url.port || url.username || url.password) {
    const error = new Error("Güvenlik: Steam Community dışındaki bağlantı reddedildi.");
    error.code = "STEAM_URL_REJECTED";
    throw error;
  }
  return url;
}

function windowsPowerShellPath() {
  const windowsRoot = process.env.SystemRoot || process.env.WINDIR || "C:\\Windows";
  const systemPowerShell = join(windowsRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  return existsSync(systemPowerShell) ? systemPowerShell : "powershell.exe";
}

/**
 * Windows'un sistem proxy/VPN ağ yolunu kullanır. Steam çerezi yalnızca child
 * process stdin'i üzerinden aktarılır; komut satırına veya hata metnine eklenmez.
 */
export function requestSteamCommunityViaWindows(urlValue, {
  headers = {},
  timeoutMs = 20_000,
  maxRedirects = 2,
  maxBytes = MAX_RESPONSE_BYTES,
  platform = process.platform,
} = {}) {
  const safeUrl = validateSteamCommunityUrl(urlValue);
  if (platform !== "win32") {
    const error = new Error("Windows sistem ağı bu işletim sisteminde kullanılamıyor.");
    error.code = "STEAM_WINDOWS_BRIDGE_UNAVAILABLE";
    return Promise.reject(error);
  }

  const bridgePath = join(__dirname, "steam_http_bridge.ps1");
  if (!existsSync(bridgePath)) {
    const error = new Error("Steam Windows ağ yardımcısı bulunamadı.");
    error.code = "STEAM_WINDOWS_BRIDGE_UNAVAILABLE";
    return Promise.reject(error);
  }

  const safeTimeoutMs = Math.max(1_000, Math.min(120_000, Math.trunc(Number(timeoutMs) || 20_000)));
  const safeMaxBytes = Math.max(1_024, Math.min(MAX_RESPONSE_BYTES, Math.trunc(Number(maxBytes) || MAX_RESPONSE_BYTES)));
  const safeMaxRedirects = Math.max(0, Math.min(5, Math.trunc(Number(maxRedirects) || 0)));
  const payload = JSON.stringify({
    url: safeUrl.href,
    headers,
    timeoutMs: safeTimeoutMs,
    maxBytes: safeMaxBytes,
    maxRedirects: safeMaxRedirects,
  });

  return new Promise((resolvePromise, rejectPromise) => {
    let settled = false;
    let stdout = Buffer.alloc(0);
    const child = spawn(windowsPowerShellPath(), [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy", "Bypass",
      "-File", bridgePath,
    ], {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });

    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(hardTimer);
      if (error) rejectPromise(error);
      else resolvePromise(value);
    };
    const hardTimer = setTimeout(() => {
      const error = timeoutError(safeTimeoutMs);
      child.kill();
      finish(error);
    }, safeTimeoutMs + 2_000);

    child.once("error", () => {
      const error = new Error("Windows sistem ağı başlatılamadı.");
      error.code = "STEAM_WINDOWS_BRIDGE_UNAVAILABLE";
      finish(error);
    });
    child.stdout.on("data", (chunk) => {
      if (settled) return;
      if (stdout.length + chunk.length > MAX_BRIDGE_OUTPUT_BYTES) {
        const error = new Error("Steam Community yanıtı güvenli boyut sınırını aştı.");
        error.code = "STEAM_RESPONSE_TOO_LARGE";
        child.kill();
        finish(error);
        return;
      }
      stdout = Buffer.concat([stdout, chunk]);
    });
    // stderr özellikle kullanıcı çerezlerinin yanlışlıkla loglara taşınmaması
    // için tüketilir fakat hiçbir yerde saklanmaz veya gösterilmez.
    child.stderr.resume();
    child.once("close", (exitCode) => {
      if (settled) return;
      if (exitCode !== 0) {
        const error = new Error("Windows sistem ağı Steam isteğini tamamlayamadı.");
        error.code = "STEAM_WINDOWS_NETWORK";
        finish(error);
        return;
      }
      try {
        const parsed = JSON.parse(stdout.toString("utf8").replace(/^\uFEFF/, ""));
        if (!parsed?.ok) {
          const error = new Error(parsed?.message || "Windows sistem ağı Steam isteğini tamamlayamadı.");
          error.code = parsed?.code || "STEAM_WINDOWS_NETWORK";
          finish(error);
          return;
        }
        validateSteamCommunityUrl(parsed.finalUrl || safeUrl);
        if (Buffer.byteLength(String(parsed.text || ""), "utf8") > safeMaxBytes) {
          const error = new Error("Steam Community yanıtı güvenli boyut sınırını aştı.");
          error.code = "STEAM_RESPONSE_TOO_LARGE";
          finish(error);
          return;
        }
        finish(null, {
          status: Number(parsed.status) || 0,
          headers: {},
          text: String(parsed.text || ""),
        });
      } catch (cause) {
        const error = new Error("Windows sistem ağından geçersiz yanıt alındı.");
        error.code = cause?.code || "STEAM_WINDOWS_RESPONSE_INVALID";
        finish(error);
      }
    });

    child.stdin.once("error", () => { /* process erken kapanırsa close olayı sonucu verir */ });
    child.stdin.end(payload, "utf8");
  });
}

export async function requestSteamCommunityText(urlValue, {
  headers = {},
  timeoutMs = 20_000,
  family = 4,
  maxRedirects = 2,
} = {}) {
  const startedAt = Date.now();
  let currentUrl = validateSteamCommunityUrl(urlValue);

  for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount += 1) {
    const remainingMs = Math.max(1, timeoutMs - (Date.now() - startedAt));
    const result = await requestTextWithHardTimeout(currentUrl, { headers, timeoutMs: remainingMs, family });
    const location = result.headers?.location;
    if (result.status < 300 || result.status >= 400 || !location) return result;
    if (redirectCount === maxRedirects) {
      const error = new Error("Steam Community çok fazla yönlendirme yaptı.");
      error.code = "STEAM_REDIRECT_LIMIT";
      throw error;
    }
    currentUrl = validateSteamCommunityUrl(new URL(location, currentUrl));
  }

  throw new Error("Steam Community isteği tamamlanamadı.");
}
