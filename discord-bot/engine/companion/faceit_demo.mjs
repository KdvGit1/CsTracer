import { createReadStream, createWriteStream } from "node:fs";
import { open, rename, rm } from "node:fs/promises";
import { Transform, Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGunzip } from "node:zlib";

const MAX_BYTES = 800 * 1024 * 1024;

export function isFaceitDownloadUrl(value) {
  try {
    const u = new URL(value);
    const host = u.hostname.toLowerCase();
    return u.protocol === "https:" && !u.username && !u.password && (!u.port || u.port === "443")
      && (host === "demos.faceit.com" || /^demos[\w-]*\.faceit\.com$/.test(host)
        || /^demos[\w-]*-faceit-cdn\.s3\.[\w-]+\.(?:backblazeb2\.com|amazonaws\.com)$/.test(host));
  } catch { return false; }
}

export async function writeFaceitDemo(stream, destination, { gzip = false, signal, maxBytes = MAX_BYTES } = {}) {
  const part = `${destination}.part`;
  let size = 0;
  const limit = new Transform({ transform(chunk, _encoding, done) {
    size += chunk.length;
    done(size > maxBytes ? new Error("Demo 800 MB sınırını aşıyor.") : null, chunk);
  } });
  try {
    await pipeline(stream, ...(gzip ? [createGunzip()] : []), limit, createWriteStream(part), { signal });
    const file = await open(part, "r");
    const signature = Buffer.alloc(8);
    try { await file.read(signature, 0, 8, 0); } finally { await file.close(); }
    if (signature.toString("ascii") !== "PBDEMS2\0") throw new Error("Dosya geçerli bir CS2 demosu değil.");
    signal?.throwIfAborted();
    await rename(part, destination);
  } finally { await rm(part, { force: true }); }
}

export async function downloadFaceitDemo(url, destination, signal, fetchImpl = fetch) {
  const boundedSignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(5 * 60 * 1000)]) : AbortSignal.timeout(5 * 60 * 1000);
  let current = url;
  for (let redirects = 0; redirects < 4; redirects++) {
    if (!isFaceitDownloadUrl(current)) throw new Error("FACEIT demo sunucusu doğrulanamadı. Maç odasından indirip Demo Yükle seçeneğini kullan.");
    // Never send the Data API key or download token to the storage host.
    const response = await fetchImpl(current, { redirect: "manual", signal: boundedSignal });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      await response.body?.cancel();
      current = new URL(response.headers.get("location"), current).href;
      continue;
    }
    if (!response.ok || !response.body) { await response.body?.cancel(); throw new Error(`FACEIT demosu indirilemedi (${response.status}). Maç odasını kontrol et.`); }
    if (Number(response.headers.get("content-length")) > MAX_BYTES) { await response.body.cancel(); throw new Error("Demo 800 MB sınırını aşıyor."); }
    await writeFaceitDemo(Readable.fromWeb(response.body), destination, { gzip: new URL(current).pathname.endsWith(".gz"), signal: boundedSignal });
    return;
  }
  throw new Error("FACEIT demo yönlendirme sınırı aşıldı.");
}

export function importFaceitDemo(path, destination, signal) {
  return writeFaceitDemo(createReadStream(path), destination, { gzip: path.endsWith(".gz"), signal });
}
