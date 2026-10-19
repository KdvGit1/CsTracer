// Botun küçük web sunucusu (yalnız PUBLIC_URL tanımlıysa açılır):
//  • /yukle/:token     Discord'un 10 MB ek sınırını aşan demolar için tek kullanımlık yükleme
//  • /steam/:token     Steam OpenID ile hesabın gerçekten sana ait olduğunu doğrulama
//  • /gsi              CS2 Game State Integration (canlı takım planı ve maç sonu tespiti)
//  • /saglik           Sistem durumu (systemd/izleme için)
import { createWriteStream } from "node:fs";
import { rm } from "node:fs/promises";
import { createServer } from "node:http";
import { join } from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { logger } from "../log.mjs";
import { hashToken } from "../secrets.mjs";

const log = logger("web");
const STEAM_OPENID = "https://steamcommunity.com/openid/login";

const page = (title, body) => `<!doctype html><html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title><style>
:root{color-scheme:dark}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0A100E;color:#EEF3F0;font:16px/1.5 system-ui,-apple-system,Segoe UI,Inter,sans-serif}
main{width:min(560px,calc(100% - 32px));background:#14201A;border:1px solid #29352F;border-radius:18px;padding:28px}
h1{margin:0 0 6px;font-size:24px}.k{color:#C8F54D;font-weight:800;letter-spacing:.12em;font-size:13px}p{color:#C9D6CC}
label{display:block;border:2px dashed #3C5037;border-radius:14px;padding:26px;text-align:center;cursor:pointer;margin:18px 0}
input{display:none}button,a.b{display:inline-block;background:#C8F54D;color:#17200D;border:0;border-radius:12px;padding:12px 18px;font-weight:800;font-size:15px;cursor:pointer;text-decoration:none}
progress{width:100%;height:12px;accent-color:#C8F54D}.m{color:#98A99E;font-size:14px}.e{color:#FF9093}.ok{color:#C8F54D}
</style></head><body><main><div class="k">TRACER</div>${body}</main></body></html>`;

const escapeHtml = (value) => String(value ?? "").replace(/[<>&"']/g, (character) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "\"": "&quot;", "'": "&#39;" })[character]);

function send(response, status, body, type = "text/html; charset=utf-8", extra = {}) {
  response.writeHead(status, {
    "Content-Type": type,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; form-action https://steamcommunity.com",
    ...extra,
  });
  response.end(body);
}

function uploadPage(token, maxMb) {
  return page("TRACER · Demo yükle", `<h1>Demo yükle</h1><p>.dem, .dem.gz veya .dem.bz2 dosyanı seç. Analiz bitince Discord'da sana haber vereceğim.</p>
<label id="drop">Dosyayı seç veya buraya sürükle<br><span class="m">En fazla ${maxMb} MB · bağlantı tek kullanımlıktır</span><input id="f" type="file" accept=".dem,.gz,.bz2"></label>
<progress id="p" max="100" value="0" hidden></progress><p id="s" class="m"></p>
<script>
const f=document.getElementById('f'),p=document.getElementById('p'),s=document.getElementById('s'),d=document.getElementById('drop');
function go(file){if(!file)return;if(file.size>${maxMb}*1048576){s.textContent='Dosya çok büyük.';s.className='e';return}
p.hidden=false;s.className='m';s.textContent='Yükleniyor…';const x=new XMLHttpRequest();x.open('PUT',location.pathname);
x.setRequestHeader('X-File-Name',encodeURIComponent(file.name));x.setRequestHeader('X-Last-Modified',String(file.lastModified||0));
x.upload.onprogress=e=>{if(e.lengthComputable){p.value=e.loaded/e.total*100;s.textContent='Yükleniyor… %'+Math.round(p.value)}};
x.onload=()=>{let r={};try{r=JSON.parse(x.responseText)}catch{}if(x.status===200){s.textContent=r.message||'Tamam';s.className='ok';d.hidden=true}else{s.textContent=r.error||'Yükleme başarısız.';s.className='e'}};
x.onerror=()=>{s.textContent='Bağlantı koptu; tekrar dene.';s.className='e'};x.send(file)}
f.onchange=()=>go(f.files[0]);d.ondragover=e=>{e.preventDefault()};d.ondrop=e=>{e.preventDefault();go(e.dataTransfer.files[0])};
</script>`);
}

export class WebServer {
  constructor({ config, store, hooks = {} }) {
    this.config = config;
    this.store = store;
    this.hooks = hooks;
    this.server = null;
    this.uploadsInFlight = 0;
  }

  url(path) {
    return `${this.config.publicUrl}${path}`;
  }

  start() {
    if (!this.config.publicUrl || !this.config.httpPort) return Promise.resolve(false);
    this.server = createServer((request, response) => {
      this.route(request, response).catch((error) => {
        log.warn("İstek işlenemedi", error?.message || error);
        if (!response.headersSent) send(response, 500, JSON.stringify({ error: "Sunucu hatası." }), "application/json");
        else response.destroy();
      });
    });
    this.server.requestTimeout = 0;
    this.server.headersTimeout = 30_000;
    return new Promise((resolve, reject) => {
      this.server.once("error", reject);
      this.server.listen(this.config.httpPort, this.config.httpHost, () => {
        log.info(`Web sunucusu ${this.config.httpHost}:${this.config.httpPort} üzerinde (${this.config.publicUrl}).`);
        resolve(true);
      });
    });
  }

  stop() {
    this.server?.close();
  }

  async route(request, response) {
    const url = new URL(request.url, "http://localhost");
    const path = url.pathname;
    if (path === "/" || path === "/saglik") {
      const health = this.hooks.health?.() || { ok: true };
      return send(response, 200, JSON.stringify(health), "application/json");
    }
    const upload = path.match(/^\/yukle\/([\w-]{20,64})$/);
    if (upload) return this.handleUpload(request, response, upload[1]);
    const steam = path.match(/^\/steam\/([\w-]{20,64})$/);
    if (steam) return this.handleSteamStart(response, steam[1]);
    const steamReturn = path.match(/^\/steam\/([\w-]{20,64})\/donus$/);
    if (steamReturn) return this.handleSteamReturn(response, steamReturn[1], url);
    if (path === "/gsi" && request.method === "POST") return this.handleGsi(request, response);
    return send(response, 404, page("Bulunamadı", "<h1>Bulunamadı</h1><p>Bu bağlantı geçersiz.</p>"));
  }

  tokenFor(raw, kind) {
    const token = this.store.getToken(hashToken(raw), kind);
    if (!token || token.used_at || token.expires_at < Date.now()) return null;
    return token;
  }

  async handleUpload(request, response, raw) {
    const token = this.tokenFor(raw, "upload");
    if (!token) return send(response, request.method === "GET" ? 410 : 410, request.method === "GET" ? page("Bağlantı geçersiz", "<h1>Bağlantının süresi doldu</h1><p>Discord'da <b>/analiz</b> yazarak yeni bir yükleme bağlantısı al.</p>") : JSON.stringify({ error: "Bağlantının süresi doldu veya zaten kullanıldı." }), request.method === "GET" ? undefined : "application/json");
    if (request.method === "GET") return send(response, 200, uploadPage(raw, this.config.maxDemoMb));
    if (request.method !== "PUT" && request.method !== "POST") return send(response, 405, JSON.stringify({ error: "Desteklenmeyen yöntem." }), "application/json");
    const maxBytes = this.config.maxDemoMb * 1024 * 1024;
    if (Number(request.headers["content-length"]) > maxBytes) return send(response, 413, JSON.stringify({ error: "Dosya boyut sınırını aşıyor." }), "application/json");
    if (this.uploadsInFlight >= 3) return send(response, 503, JSON.stringify({ error: "Sunucu şu an meşgul, bir dakika sonra tekrar dene." }), "application/json");
    if (!this.store.useToken(token.token_hash)) return send(response, 410, JSON.stringify({ error: "Bu bağlantı zaten kullanıldı." }), "application/json");
    const path = join(this.config.dataDir, "tmp", `upload-${token.token_hash.slice(0, 16)}.raw`);
    let size = 0;
    const limit = new Transform({ transform(chunk, _encoding, done) { size += chunk.length; done(size > maxBytes ? new Error("too-large") : null, chunk); } });
    this.uploadsInFlight++;
    try {
      await pipeline(request, limit, createWriteStream(path));
    } catch (error) {
      await rm(path, { force: true });
      return send(response, error.message === "too-large" ? 413 : 400, JSON.stringify({ error: error.message === "too-large" ? "Dosya boyut sınırını aşıyor." : "Yükleme yarıda kesildi; Discord'dan yeni bağlantı al." }), "application/json");
    } finally {
      this.uploadsInFlight--;
    }
    const fileName = (() => { try { return decodeURIComponent(String(request.headers["x-file-name"] || "")).slice(0, 120); } catch { return ""; } })();
    const lastModified = Number(request.headers["x-last-modified"]) || 0;
    try {
      const result = await this.hooks.onUpload?.({ token, path, size, fileName, lastModified });
      return send(response, 200, JSON.stringify({ ok: true, message: result?.message || "Yüklendi! Analiz sıraya alındı; sonuç Discord'a gelecek." }), "application/json");
    } catch (error) {
      await rm(path, { force: true });
      return send(response, 400, JSON.stringify({ error: error.message || "Yükleme işlenemedi." }), "application/json");
    }
  }

  handleSteamStart(response, raw) {
    const token = this.tokenFor(raw, "steam-login");
    if (!token) return send(response, 410, page("Bağlantı geçersiz", "<h1>Bağlantının süresi doldu</h1><p>Discord'da <b>/hesap steam</b> ile yeni bağlantı al.</p>"));
    const returnTo = this.url(`/steam/${raw}/donus`);
    const params = new URLSearchParams({
      "openid.ns": "http://specs.openid.net/auth/2.0",
      "openid.mode": "checkid_setup",
      "openid.return_to": returnTo,
      "openid.realm": this.config.publicUrl,
      "openid.identity": "http://specs.openid.net/auth/2.0/identifier_select",
      "openid.claimed_id": "http://specs.openid.net/auth/2.0/identifier_select",
    });
    return send(response, 200, page("TRACER · Steam doğrulama", `<h1>Steam hesabını doğrula</h1><p>Steam'in resmî giriş sayfasına yönlendirileceksin. TRACER şifreni görmez; yalnız Steam kimliğini (SteamID64) öğrenir.</p><p><a class="b" href="${STEAM_OPENID}?${params}">Steam ile giriş yap</a></p><p class="m">Bu bağlantı 15 dakika geçerlidir.</p>`));
  }

  async handleSteamReturn(response, raw, url) {
    const token = this.tokenFor(raw, "steam-login");
    if (!token) return send(response, 410, page("Bağlantı geçersiz", "<h1>Bağlantının süresi doldu</h1>"));
    const params = Object.fromEntries(url.searchParams.entries());
    const claimed = String(params["openid.claimed_id"] || "");
    const steamId = claimed.match(/^https:\/\/steamcommunity\.com\/openid\/id\/(7656119\d{10})$/)?.[1];
    if (params["openid.mode"] !== "id_res" || !steamId || params["openid.return_to"] !== this.url(`/steam/${raw}/donus`)) {
      return send(response, 400, page("Doğrulama başarısız", "<h1>Doğrulama tamamlanamadı</h1><p>Discord'dan yeni bağlantı alıp tekrar dene.</p>"));
    }
    // Steam'e imzayı doğrulat (OpenID 2.0 check_authentication).
    const verify = new URLSearchParams({ ...params, "openid.mode": "check_authentication" });
    let valid = false;
    try {
      const result = await fetch(STEAM_OPENID, { method: "POST", body: verify, headers: { "Content-Type": "application/x-www-form-urlencoded" }, signal: AbortSignal.timeout(10_000) });
      valid = /is_valid\s*:\s*true/i.test(await result.text());
    } catch {
      valid = false;
    }
    if (!valid || !this.store.useToken(token.token_hash)) return send(response, 400, page("Doğrulama başarısız", "<h1>Steam doğrulaması reddedildi</h1><p>Tekrar dene.</p>"));
    try {
      const result = await this.hooks.onSteamVerified?.({ userId: token.user_id, steamId, data: token.data });
      return send(response, 200, page("TRACER · Doğrulandı", `<h1 class="ok">Steam hesabın doğrulandı ✓</h1><p>${escapeHtml(result?.name || steamId)} artık Discord hesabına bağlı. Bu sekmeyi kapatabilirsin.</p>`));
    } catch (error) {
      return send(response, 400, page("Hata", `<h1>Bağlanamadı</h1><p>${escapeHtml(error.message)}</p>`));
    }
  }

  async handleGsi(request, response) {
    let size = 0;
    const chunks = [];
    for await (const chunk of request) {
      size += chunk.length;
      if (size > 256 * 1024) return send(response, 413, "");
      chunks.push(chunk);
    }
    let payload;
    try { payload = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { return send(response, 400, ""); }
    const raw = String(payload?.auth?.token || "");
    const token = /^[\w-]{20,64}$/.test(raw) ? this.store.getToken(hashToken(raw), "gsi") : null;
    if (!token || token.expires_at < Date.now()) return send(response, 401, "");
    send(response, 200, "", "text/plain");
    try { await this.hooks.onGsi?.(token.user_id, payload); } catch (error) { log.debug("GSI paketi işlenemedi", error?.message); }
  }
}
