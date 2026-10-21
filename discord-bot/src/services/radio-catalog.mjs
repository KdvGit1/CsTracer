// Türk radyo istasyonları kataloğu. Kaynak: Radio Browser (radio-browser.info), topluluğun
// sürdürdüğü açık radyo veritabanı. Liste data/radio-stations.json'da saklanır ve günde bir
// yenilenir; Radio Browser geçici olarak ulaşılamazsa da kayıtlı listeyle çalışmaya devam eder.
import { resolveSrv } from "node:dns/promises";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { logger } from "../log.mjs";

const log = logger("radyo");
const FALLBACK_HOSTS = ["de1.api.radio-browser.info", "de2.api.radio-browser.info", "fi1.api.radio-browser.info"];
// Türkiye'deki istasyonlar ve yurt dışındaki Türkçe yayınlar (KKTC, Almanya…).
const QUERIES = ["countrycode=TR", "language=turkish"];
const REFRESH_MS = 24 * 3_600_000;
export const USER_AGENT = "TRACER-Discord-Bot/1.0 (+https://github.com/KdvGit1/CsTracer)";

const TURKISH = { ı: "i", ş: "s", ğ: "g", ü: "u", ö: "o", ç: "c", â: "a", î: "i", û: "u" };

/** Arama için sadeleştirir: küçük harf, Türkçe harfler düz, noktalama yerine boşluk. */
export function fold(text) {
  return String(text || "")
    .toLocaleLowerCase("tr")
    .replace(/[ışğüöçâîû]/g, (letter) => TURKISH[letter])
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Geçerli http(s) adresi ya da "". Discord bozuk embed/küçük resim adresi olan mesajı tümden reddeder. */
function safeUrl(value, { httpsOnly = false } = {}) {
  try {
    const url = new URL(String(value || "").trim());
    const allowed = httpsOnly ? url.protocol === "https:" : url.protocol === "https:" || url.protocol === "http:";
    return allowed && url.hostname && url.href.length <= 1000 ? url.href : "";
  } catch {
    return "";
  }
}
const popularity = (station) => station.clicks + station.votes * 2;

/** Radio Browser kayıtlarını sadeleştirir; aynı adlı kopyalardan en çok dinleneni kalır. */
export function normalizeStations(raw) {
  const best = new Map();
  for (const item of raw || []) {
    const url = safeUrl(item?.url_resolved || item?.url);
    const name = String(item?.name || "").replace(/\s+/g, " ").trim();
    const key = fold(name);
    if (!key || !url || !item?.stationuuid) continue;
    const station = {
      id: String(item.stationuuid),
      name: name.slice(0, 80),
      url,
      homepage: safeUrl(item.homepage),
      favicon: safeUrl(item.favicon, { httpsOnly: true }),
      tags: String(item.tags || "").split(",").map((tag) => tag.trim()).filter(Boolean).slice(0, 4),
      codec: String(item.codec || "").toUpperCase(),
      bitrate: Number(item.bitrate) || 0,
      hls: Number(item.hls) === 1 || /\.m3u8(\?|$)/i.test(url),
      clicks: Number(item.clickcount) || 0,
      votes: Number(item.votes) || 0,
    };
    const current = best.get(key);
    if (!current || popularity(station) > popularity(current)) best.set(key, station);
  }
  return [...best.values()].sort((a, b) => popularity(b) - popularity(a) || a.name.localeCompare(b.name, "tr"));
}

export class RadioCatalog {
  constructor({ file, fetchImpl = fetch, lookup = resolveSrv, now = Date.now } = {}) {
    this.file = file;
    this.fetch = fetchImpl;
    this.lookup = lookup;
    this.now = now;
    this.refreshing = null;
    this.replace([], 0);
  }

  get size() {
    return this.stations.length;
  }

  replace(stations, updatedAt) {
    this.stations = stations;
    this.byId = new Map(stations.map((station) => [station.id, station]));
    this.updatedAt = updatedAt;
  }

  load() {
    if (!this.file || !existsSync(this.file)) return;
    try {
      const data = JSON.parse(readFileSync(this.file, "utf8"));
      this.replace(Array.isArray(data.stations) ? data.stations : [], Number(data.updatedAt) || 0);
    } catch (error) {
      log.warn(`Kayıtlı radyo listesi okunamadı: ${error.message}`);
    }
  }

  stale() {
    return !this.stations.length || this.now() - this.updatedAt > REFRESH_MS;
  }

  /** Aynı anda tek indirme; çağıranlar aynı sözü bekler. */
  refresh() {
    this.refreshing ??= this.download().finally(() => { this.refreshing = null; });
    return this.refreshing;
  }

  async hosts() {
    // Radio Browser'ın önerdiği yol: sunucu listesini DNS SRV kaydından al.
    try {
      const records = await this.lookup("_api._tcp.radio-browser.info");
      const names = records.map((record) => record.name).filter(Boolean).sort(() => Math.random() - 0.5);
      return [...new Set([...names, ...FALLBACK_HOSTS])];
    } catch {
      return FALLBACK_HOSTS;
    }
  }

  async download() {
    let lastError = null;
    for (const host of await this.hosts()) {
      try {
        const lists = await Promise.all(QUERIES.map(async (query) => {
          const response = await this.fetch(`https://${host}/json/stations/search?${query}&hidebroken=true&order=clickcount&reverse=true&limit=3000`, {
            headers: { "User-Agent": USER_AGENT },
            signal: AbortSignal.timeout(20_000),
          });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          return response.json();
        }));
        const stations = normalizeStations(lists.flat());
        if (!stations.length) throw new Error("boş liste");
        this.replace(stations, this.now());
        this.save();
        log.info(`${stations.length} Türk radyo istasyonu yüklendi (${host}).`);
        return stations.length;
      } catch (error) {
        lastError = error;
      }
    }
    throw new Error(`Radyo listesi alınamadı: ${lastError?.message || "sunucu yok"}`);
  }

  save() {
    if (!this.file) return;
    const temp = `${this.file}.tmp`;
    writeFileSync(temp, JSON.stringify({ updatedAt: this.updatedAt, stations: this.stations }));
    renameSync(temp, this.file);
  }

  get(id) {
    return this.byId.get(String(id)) || null;
  }

  popular(limit = 25) {
    return this.stations.slice(0, limit);
  }

  /** Ada ve türe göre arar; tam/baştan eşleşme önce, sonra popülerlik. */
  search(query, limit = 25) {
    const wanted = fold(query);
    if (!wanted) return this.popular(limit);
    const words = wanted.split(" ");
    const scored = [];
    for (const station of this.stations) {
      const name = fold(station.name);
      const haystack = `${name} ${fold(station.tags.join(" "))}`;
      if (!words.every((word) => haystack.includes(word))) continue;
      const score = name === wanted ? 4 : name.startsWith(wanted) ? 3 : ` ${name}`.includes(` ${words[0]}`) ? 2 : name.includes(wanted) ? 1 : 0;
      scored.push({ score, station });
    }
    // Liste zaten popülerliğe göre sıralı; kararlı sıralama eşitlerde bunu korur.
    return scored.sort((a, b) => b.score - a.score).slice(0, limit).map((item) => item.station);
  }

  random(pool = 60) {
    const list = this.popular(pool);
    return list.length ? list[Math.floor(Math.random() * list.length)] : null;
  }
}
