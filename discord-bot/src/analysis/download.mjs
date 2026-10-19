// Demo indirme ve açma. Yalnız izin verilen sunuculardan (Discord eki, Valve
// replay, FACEIT demo deposu) indirilir; her yönlendirme yeniden doğrulanır.
// .dem, .dem.gz ve .dem.bz2 içerik imzasından tanınır; sonuç CS2 imzası
// (PBDEMS2) ve boyut sınırıyla doğrulanır.
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { open, rename, rm, stat } from "node:fs/promises";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGunzip } from "node:zlib";
import { isFaceitDownloadUrl } from "../../engine/companion/faceit_demo.mjs";
import { isAllowedReplayUrl } from "../../engine/companion/steam_replay_url.mjs";

const DISCORD_CDN = /^(cdn\.discordapp\.com|media\.discordapp\.net)$/i;
const DEMO_MAGIC = "PBDEMS2\0";
const MAX_REDIRECTS = 5;

export class DemoError extends Error {
  constructor(message, { retryable = false } = {}) {
    super(message);
    this.retryable = retryable;
  }
}

export function classifyDemoUrl(value) {
  let url;
  try { url = new URL(String(value || "").trim()); } catch { return null; }
  if (url.username || url.password) return null;
  if (url.protocol === "https:" && DISCORD_CDN.test(url.hostname) && (!url.port || url.port === "443")) return { kind: "discord", url: url.href };
  if (isFaceitDownloadUrl(url.href)) return { kind: "faceit", url: url.href };
  if (isAllowedReplayUrl(url.href)) return { kind: "valve", url: url.href };
  return null;
}

function limiter(maxBytes, label) {
  let size = 0;
  return new Transform({
    transform(chunk, _encoding, done) {
      size += chunk.length;
      done(size > maxBytes ? new DemoError(`${label} ${Math.round(maxBytes / 1024 / 1024)} MB sınırını aşıyor.`) : null, chunk);
    },
  });
}

async function readMagic(path) {
  const file = await open(path, "r");
  try {
    const buffer = Buffer.alloc(8);
    await file.read(buffer, 0, 8, 0);
    return buffer;
  } finally {
    await file.close();
  }
}

export function detectFormat(magic) {
  if (magic.toString("binary", 0, 8) === DEMO_MAGIC) return "dem";
  if (magic[0] === 0x1f && magic[1] === 0x8b) return "gz";
  if (magic.toString("ascii", 0, 3) === "BZh") return "bz2";
  if (magic.toString("ascii", 0, 2) === "PK") return "zip";
  if (magic.toString("ascii", 0, 7) === "PBDEMS\0" || magic.toString("ascii", 0, 6) === "HL2DEM") return "legacy";
  return "unknown";
}

let bz2Factory = null;
async function bunzip() {
  if (!bz2Factory) bz2Factory = (await import("unbzip2-stream")).default;
  return bz2Factory();
}

/** bz2 açıcı klasik (through) stream olduğundan pipe ile bağlanır. */
function pipeBz2(source, destination, maxBytes, signal) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", onAbort);
      if (error) {
        source.destroy();
        destination.destroy();
        reject(error);
      } else resolve();
    };
    const onAbort = () => finish(new DemoError("İşlem iptal edildi."));
    signal?.addEventListener("abort", onAbort, { once: true });
    bunzip().then((decompressor) => {
      const limit = limiter(maxBytes, "Açılmış demo");
      for (const stream of [source, decompressor, limit, destination]) stream.on("error", (error) => finish(error instanceof DemoError ? error : new DemoError(`Demo açılamadı: ${error.message}`)));
      destination.on("finish", () => finish());
      source.pipe(decompressor).pipe(limit).pipe(destination);
    }, (error) => finish(error));
  });
}

/** Ham dosyayı (dem/gz/bz2) doğrulanmış .dem dosyasına çevirir ve SHA-256 döndürür. */
export async function normalizeDemoFile(rawPath, demPath, { maxBytes, signal } = {}) {
  const format = detectFormat(await readMagic(rawPath));
  if (format === "zip") throw new DemoError("ZIP arşivi desteklenmiyor; .dem, .dem.gz veya .dem.bz2 gönder.");
  if (format === "legacy") throw new DemoError("Bu bir CS:GO (Source 1) demosu. TRACER yalnız CS2 demolarını analiz eder.");
  if (format === "unknown") throw new DemoError("Dosya bir CS2 demosu değil (.dem, .dem.gz veya .dem.bz2 bekleniyordu).");
  const part = `${demPath}.part`;
  try {
    if (format === "dem") {
      await rename(rawPath, part);
    } else if (format === "gz") {
      await pipeline(createReadStream(rawPath), createGunzip(), limiter(maxBytes, "Açılmış demo"), createWriteStream(part), { signal });
    } else {
      await pipeBz2(createReadStream(rawPath), createWriteStream(part), maxBytes, signal);
    }
    if (detectFormat(await readMagic(part)) !== "dem") throw new DemoError("Açılan dosya geçerli bir CS2 demosu değil.");
    const info = await stat(part);
    if (info.size > maxBytes) throw new DemoError("Demo boyut sınırını aşıyor.");
    if (info.size < 1024 * 64) throw new DemoError("Demo dosyası eksik veya çok küçük; maç bittikten sonra oluşan tam demoyu gönder.");
    const sha256 = await hashFile(part);
    await rename(part, demPath);
    return { path: demPath, size: info.size, sha256, format };
  } finally {
    await rm(part, { force: true });
    if (format !== "dem") await rm(rawPath, { force: true });
  }
}

export async function hashFile(path) {
  const hash = createHash("sha256");
  await pipeline(createReadStream(path), hash);
  return hash.digest("hex");
}

/** İzinli bir bağlantıdan ham dosyayı indirir (yönlendirmeler yeniden doğrulanır). */
export async function downloadRaw(urlValue, rawPath, { maxBytes, signal, fetchImpl = fetch, timeoutMs = 10 * 60 * 1000 } = {}) {
  let current = classifyDemoUrl(urlValue);
  if (!current) throw new DemoError("Bu bağlantıdan demo indirilemez. Discord eki, Valve replay (replayNNN.valve.net) veya FACEIT demo bağlantısı gönder.");
  const bounded = signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs);
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects++) {
    let response;
    try {
      response = await fetchImpl(current.url, { redirect: "manual", signal: bounded, headers: { "User-Agent": "TRACER-Discord-Bot/1.0" } });
    } catch (error) {
      if (signal?.aborted) throw new DemoError("İşlem iptal edildi.");
      throw new DemoError(`Demo sunucusuna ulaşılamadı: ${error.message}`, { retryable: true });
    }
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      await response.body?.cancel();
      const next = new URL(response.headers.get("location") || "", current.url).href;
      const classified = classifyDemoUrl(next);
      if (!classified) throw new DemoError("Demo bağlantısı izin verilmeyen bir sunucuya yönlendirdi.");
      if (current.url.startsWith("https:") && next.startsWith("http:")) throw new DemoError("Güvenlik: HTTPS'ten HTTP'ye yönlendirme reddedildi.");
      current = classified;
      continue;
    }
    if (!response.ok || !response.body) {
      await response.body?.cancel();
      const expired = response.status === 403 || response.status === 404 || response.status === 410;
      throw new DemoError(expired ? "Demo bulunamadı veya bağlantının süresi dolmuş (Valve demoları ~2-4 hafta saklanır)." : `Demo indirilemedi (HTTP ${response.status}).`, { retryable: response.status >= 500 || response.status === 429 });
    }
    const declared = Number(response.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > maxBytes) {
      await response.body.cancel();
      throw new DemoError(`Demo ${Math.round(maxBytes / 1024 / 1024)} MB sınırını aşıyor.`);
    }
    await pipeline(Readable.fromWeb(response.body), limiter(maxBytes, "İndirilen dosya"), createWriteStream(rawPath), { signal: bounded }).catch(async (error) => {
      await rm(rawPath, { force: true });
      if (error instanceof DemoError) throw error;
      throw new DemoError(bounded.aborted && !signal?.aborted ? "Demo indirme zaman aşımına uğradı." : `Demo indirilemedi: ${error.message}`, { retryable: !signal?.aborted });
    });
    return { kind: current.kind, url: current.url };
  }
  throw new DemoError("Demo bağlantısı çok fazla yönlendirme yaptı.");
}
