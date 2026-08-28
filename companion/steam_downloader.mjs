import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, renameSync, createWriteStream, statSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { EventEmitter } from "node:events";
import { Worker } from "node:worker_threads";
import http from "node:http";
import https from "node:https";
import bz2Stream from "unbzip2-stream";
import { isAllowedReplayUrl, replayFileBase } from "./steam_replay_url.mjs";
import { SquadStore } from "./squad/store.mjs";
import { normalizeSteamId } from "./squad/identity.mjs";
import {
  ANALYSIS_HISTORY_LIMIT,
  MatchAutomationStore,
  enforceDemoRetention,
  getDemoStorageStats,
} from "./match_automation.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const APP_ROOT = join(__dirname, "..");
const DATA_DIR = process.env.TRACER_DATA_DIR || join(process.env.LOCALAPPDATA || APP_ROOT, "TRACER", "data");
const SESSION_FILE = join(DATA_DIR, "steam_session.json");
const MATCHES_FILE = join(DATA_DIR, "recent_matches.json");
const SCANNED_FILE = join(DATA_DIR, "scanned_matches.json");
const DEMOS_DIR = join(DATA_DIR, "recent_demos");
const squadStore = new SquadStore(DATA_DIR);
const automationStore = new MatchAutomationStore(DATA_DIR);
export const steamEvents = new EventEmitter();
let gamePerformanceGuard = () => false;

export function setGamePerformanceGuard(guard) {
  gamePerformanceGuard = typeof guard === "function" ? guard : () => false;
}

function isGamePerformanceModeActive() {
  try {
    return Boolean(gamePerformanceGuard());
  } catch {
    return false;
  }
}

function performancePausedResult(message = "CS2 canlı maçta olduğu için bu ağır işlem maç sonrasına ertelendi.") {
  return {
    ok: true,
    paused: true,
    performanceMode: true,
    message,
    scannedMatches: getScannedMatches(),
    downloadedMatches: getRecentMatches(),
  };
}

// Ensure data directories
if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
if (!existsSync(DEMOS_DIR)) mkdirSync(DEMOS_DIR, { recursive: true });

// Atomik JSON yazımı: önce temp dosyaya yaz, sonra rename ile yerine koy
function atomicWriteJson(filePath, data) {
  const tmpPath = `${filePath}.tmp`;
  writeFileSync(tmpPath, JSON.stringify(data, null, 2), "utf-8");
  renameSync(tmpPath, filePath);
}

// Yarım kalmış .part dosyasını sessizce sil
function removePartialQuiet(p) {
  try { unlinkSync(p); } catch { /* ignore */ }
}

// recent_matches.json read-modify-write yarışlarını önleyen basit async kuyruk (mutex)
let recentMatchesQueue = Promise.resolve();

function enqueueRecentMatchesUpdate(fn) {
  const run = recentMatchesQueue.then(fn);
  // Kuyruk tek bir hatada kalıcı olarak kilitlenmesin
  recentMatchesQueue = run.catch(() => { });
  return run;
}

// 1. Extract SteamID64 from steamLoginSecure cookie
export function extractSteamIdFromCookie(cookie) {
  if (!cookie || typeof cookie !== "string") return "";
  const match = cookie.match(/^(\d{17})/);
  return match ? match[1] : "";
}

// 2. Session Storage
export function getSteamSession() {
  try {
    if (existsSync(SESSION_FILE)) {
      const raw = readFileSync(SESSION_FILE, "utf-8");
      const data = JSON.parse(raw);
      if (!data.steamId && data.steamLoginSecure) {
        data.steamId = extractSteamIdFromCookie(data.steamLoginSecure);
      }
      return data;
    }
  } catch (err) {
    console.error("[STEAM-GCPD] Session okuma hatası:", err.message);
  }
  return {
    steamLoginSecure: "",
    sessionid: "",
    steamId: "",
    lastSyncTime: 0,
    lastScanTime: 0,
    matchLimit: 5,
    autoScanEnabled: true,
    autoScanIntervalMinutes: 5,
  };
}

export function saveSteamSession(sessionData) {
  const current = getSteamSession();
  const merged = { ...current, ...sessionData };
  if (Object.hasOwn(sessionData || {}, "steamLoginSecure") && sessionData.steamLoginSecure !== current.steamLoginSecure) {
    merged.lastScanStatus = sessionData.steamLoginSecure ? "pending" : "disconnected";
    merged.lastScanError = "";
  }
  if (!merged.steamId && merged.steamLoginSecure) {
    merged.steamId = extractSteamIdFromCookie(merged.steamLoginSecure);
  }
  try {
    atomicWriteJson(SESSION_FILE, merged);
  } catch (err) {
    console.error("[STEAM-GCPD] Session kaydetme hatası:", err.message);
  }
  return merged;
}

export function getSteamConnectionHealth(session = getSteamSession()) {
  if (!session.steamLoginSecure) return { state: "disconnected", message: "Steam oturumu kaydedilmemiş." };
  if (session.lastScanStatus === "expired") return { state: "expired", message: session.lastScanError || "Steam oturumunun süresi dolmuş." };
  if (session.lastScanStatus === "error") return { state: "error", message: session.lastScanError || "Steam’e son bağlantı kurulamadı." };
  if (session.lastScanStatus === "success" || (!session.lastScanStatus && session.lastScanTime)) {
    return { state: "connected", message: "Steam Community bağlantısı son taramada doğrulandı." };
  }
  return { state: "unverified", message: "Steam bilgileri kayıtlı; bağlantı henüz doğrulanmadı." };
}

// 3. Recent Matches Storage (Downloaded & Fully Analyzed)
export function getRecentMatches() {
  try {
    if (existsSync(MATCHES_FILE)) {
      const raw = readFileSync(MATCHES_FILE, "utf-8");
      const list = JSON.parse(raw);
      if (Array.isArray(list)) return list;
    }
  } catch (err) {
    console.error("[STEAM-GCPD] Maç listesi okuma hatası:", err.message);
  }
  return [];
}

export function saveRecentMatches(matches) {
  // Paralel indirmelerde read-modify-write çakışmasını önlemek için yazmaları kuyrukta serileştir
  return enqueueRecentMatchesUpdate(() => {
    try {
      atomicWriteJson(MATCHES_FILE, matches);
    } catch (err) {
      console.error("[STEAM-GCPD] Maç listesi kaydetme hatası:", err.message);
    }
  }).catch(() => { });
}

// 4. Scanned Matches Storage (Metadata & Summaries found on Steam)
export function getScannedMatches() {
  try {
    if (existsSync(SCANNED_FILE)) {
      const raw = readFileSync(SCANNED_FILE, "utf-8");
      const list = JSON.parse(raw);
      if (Array.isArray(list)) return list;
    }
  } catch (err) {
    console.error("[STEAM-GCPD] Taranan maçlar okuma hatası:", err.message);
  }
  return [];
}

export function saveScannedMatches(matches) {
  try {
    atomicWriteJson(SCANNED_FILE, matches);
  } catch (err) {
    console.error("[STEAM-GCPD] Taranan maçlar kaydetme hatası:", err.message);
  }
}

export function mergeScannedMatchCache(freshMatches = [], cachedMatches = [], downloadedMatches = []) {
  const merged = [...freshMatches];
  for (const cached of cachedMatches) {
    if (merged.some((item) => item.id === cached.id || (item.replayUrl && item.replayUrl === cached.replayUrl))) continue;
    const isDownloaded = downloadedMatches.some((match) => match.id === cached.id || match.fileName === cached.fileName);
    merged.push({ ...cached, isDownloaded });
  }
  return merged.sort((left, right) => Number(right.timestamp || 0) - Number(left.timestamp || 0));
}

// 5. Ham DEM kotası analiz geçmişinden bağımsızdır. Eski fonksiyon adı
// geriye dönük uyumluluk için korunur; artık analiz kayıtlarını silmez.
export function enforceMatchLimit(matchesInput = null, limit = 5, protectedPaths = []) {
  const matches = [...(matchesInput || getRecentMatches())]
    .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
    .slice(0, ANALYSIS_HISTORY_LIMIT);
  const configuredLimit = automationStore.getSettings().demoRetentionCount || limit;
  const result = enforceDemoRetention({
    demosDir: DEMOS_DIR,
    matches,
    retentionCount: configuredLimit,
    protectedPaths,
  });
  for (const entry of result.deleted) {
    console.log(`[STEAM-GCPD] Eski ham demo diskten silindi (kullanıcı kotası): ${entry.name}`);
  }
  atomicWriteJson(MATCHES_FILE, result.matches);
  return result.matches;
}

export function getDemoStorageState() {
  const matches = getRecentMatches();
  const settings = automationStore.getSettings();
  return getDemoStorageStats(DEMOS_DIR, settings.demoRetentionCount, matches);
}

export function applyConfiguredDemoRetention(protectedPaths = []) {
  return enforceMatchLimit(getRecentMatches(), automationStore.getSettings().demoRetentionCount, protectedPaths);
}

// 6. Parse Replay URLs from GCPD HTML
export function extractReplaysFromHtml(html) {
  const replayRegex = /(http[s]?:\/\/[^\s"'<>]+\.dem\.bz2)/gi;
  const matches = html.match(replayRegex) || [];
  return [...new Set(matches)];
}

// 7. Parse Full Match Summaries from GCPD HTML (Extracts accurate match date, scores, players, stats)
export function parseGcpdMatchesFromHtml(html, modeLabel = "Competitive", userSteamId = "") {
  const matches = [];
  if (!html || typeof html !== "string") return matches;

  const matchBlocks = html.split(/<table class="csgo_scoreboard_inner_left">/i);

  for (let i = 1; i < matchBlocks.length; i++) {
    const block = matchBlocks[i];

    // 1. Replay URL
    const replayMatch = block.match(/href="([^"]+\.dem\.bz2)"/i);
    const replayUrl = replayMatch ? replayMatch[1] : "";
    if (!replayUrl) continue;

    let fileBase;
    try {
      fileBase = replayFileBase(replayUrl);
    } catch {
      continue;
    }
    const matchId = `gcpd_${fileBase}`;

    // 2. Map & Mode from left table
    let mapName = "unknown";
    let matchMode = modeLabel;
    const mapRegex = /(Inferno|Mirage|Dust II|Dust 2|Nuke|Overpass|Ancient|Anubis|Vertigo|Office|Italy|Baggage|Shoots|Mills|Thera|Assembly|Memento|Train|Pool Day)/i;
    const mapMatch = block.match(mapRegex);
    if (mapMatch) {
      mapName = mapMatch[1].toLowerCase().replace(/\s+/g, "");
      if (mapName === "dustii") mapName = "dust2";
    }

    if (block.toLowerCase().includes("premier")) matchMode = "Premier";
    else if (block.toLowerCase().includes("wingman")) matchMode = "Yoldaş";
    else if (block.toLowerCase().includes("competitive") || block.toLowerCase().includes("rekabetçi")) matchMode = "Rekabetçi";

    // 3. Match Date & Time from Steam GCPD (e.g. 2026-08-23 20:11:09 GMT)
    const dateMatch = block.match(/<td>\s*(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}(?:\s+GMT)?)\s*<\/td>/i);
    const rawDateGmt = dateMatch ? dateMatch[1].trim() : "";
    let timestamp = rawDateGmt ? Date.parse(rawDateGmt.includes("GMT") ? rawDateGmt : `${rawDateGmt} GMT`) : Date.now();
    if (isNaN(timestamp) || timestamp <= 0) timestamp = Date.now();

    const formattedDate = new Date(timestamp).toLocaleString("tr-TR", { dateStyle: "short", timeStyle: "short" });

    // 4. Wait time & Match duration
    const waitTimeMatch = block.match(/Wait Time:\s*([\d:]+)/i);
    const waitTime = waitTimeMatch ? waitTimeMatch[1] : "";
    const durationMatch = block.match(/Match Duration:\s*([\d:]+)/i);
    const duration = durationMatch ? durationMatch[1] : "";

    // 5. Scoreboard & Players
    const scoreMatch = block.match(/class="csgo_scoreboard_score">\s*(\d+)\s*:\s*(\d+)\s*<\/td>/i);
    if (!scoreMatch) continue;
    const team1Score = scoreMatch ? parseInt(scoreMatch[1], 10) : 0;
    const team2Score = scoreMatch ? parseInt(scoreMatch[2], 10) : 0;

    const rightPart = block.split(/class="csgo_scoreboard_score"/i);
    const team1Html = rightPart[0] || "";
    const team2Html = rightPart[1] || "";

    function parsePlayers(pHtml, teamSide) {
      const pList = [];
      const rowMatches = pHtml.split(/<tr[^>]*>/i);
      for (const row of rowMatches) {
        if (row.includes("<th") || !row.includes('class="inner_name"')) continue;

        const sidMatch = row.match(/profiles\/(\d{17})/i) || row.match(/data-miniprofile="(\d+)"/i);
        const sid = normalizeSteamId(sidMatch ? sidMatch[1] : "");
        const nameMatch = row.match(/class="playerNickname[^"]*">\s*<a[^>]*>(.*?)<\/a>/i);
        const name = nameMatch ? nameMatch[1].replace(/<[^>]+>/g, "").trim() : "";
        if (!name && !sid) continue;

        // Stats columns: col[0]=name, col[1]=Ping, col[2]=K, col[3]=A, col[4]=D, col[5]=Stars, col[6]=HSP, col[7]=Score
        const cols = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((m) => m[1].replace(/<[^>]+>/g, "").trim());
        const ping = parseInt(cols[1], 10) || 0;
        const kills = parseInt(cols[2], 10) || 0;
        const assists = parseInt(cols[3], 10) || 0;
        const deaths = parseInt(cols[4], 10) || 0;
        const rawStars = cols[5] || "";
        const stars = rawStars.includes("★") ? rawStars : "";
        const hsPercent = parseInt(cols[6]?.replace("%", ""), 10) || 0;
        const score = parseInt(cols[7], 10) || 0;
        const kd = deaths > 0 ? Math.round((kills / deaths) * 100) / 100 : kills;

        pList.push({
          steamid: sid,
          name,
          team: teamSide,
          ping,
          kills,
          assists,
          deaths,
          kd,
          stars,
          hsPercent,
          score,
        });
      }
      return pList;
    }

    const team1Players = parsePlayers(team1Html, "Team 1");
    const team2Players = parsePlayers(team2Html, "Team 2");
    const allPlayers = [...team1Players, ...team2Players];

    const normalizedUserSteamId = normalizeSteamId(userSteamId);
    const userPlayer = normalizedUserSteamId
      ? allPlayers.find((p) => p.steamid === normalizedUserSteamId)
      : null;

    // Oyuncu kimliği doğrulanamıyorsa ilk satırı kullanıcı saymak sessizce yanlış
    // kişiye skor ve istatistik atıyordu. Bu maç listeye hiç alınmaz; sonraki
    // taramada SteamID eşleşmesi sağlanınca güvenli biçimde eklenir.
    if (!userPlayer) continue;

    const isUserTeam1 = userPlayer.team === "Team 1";
    const userScore = isUserTeam1 ? team1Score : team2Score;
    const enemyScore = isUserTeam1 ? team2Score : team1Score;
    const isTie = team1Score === team2Score && team1Score > 0;
    const isWin = userScore > enemyScore;
    const result = isTie ? "Beraberlik" : isWin ? "Galibiyet" : "Mağlubiyet";

    matches.push({
      id: matchId,
      source: `steam_${matchMode.toLowerCase()}`,
      mode: matchMode,
      map: mapName,
      replayUrl,
      fileName: `${fileBase}.dem`,
      timestamp,
      rawDateGmt,
      formattedDate,
      duration,
      waitTime,
      score: {
        userTeam: isUserTeam1 ? "Takım 1" : "Takım 2",
        userScore,
        enemyScore,
        result,
        isWin,
        isTie,
        rawScore: `${userScore} - ${enemyScore}`,
      },
      userStats: {
        name: userPlayer.name,
        steamid: userPlayer.steamid,
        kills: userPlayer.kills,
        deaths: userPlayer.deaths,
        assists: userPlayer.assists,
        kd: userPlayer.kd,
        hsPercent: userPlayer.hsPercent,
        score: userPlayer.score,
        ping: userPlayer.ping,
        stars: userPlayer.stars,
      },
      players: allPlayers,
    });
  }

  return matches;
}

// 8. Fetch GCPD AJAX endpoint for specific tab
async function fetchGcpdTabAjax(steamId, tab, session) {
  // Sahte sessionid gönderme: yoksa parametreyi/cookie'yi boş bırak
  const sessionId = session.sessionid || "";
  const url = `https://steamcommunity.com/profiles/${steamId}/gcpd/730?ajax=1&tab=${tab}${sessionId ? `&sessionid=${encodeURIComponent(sessionId)}` : ""}`;
  const cookieHeader = `steamLoginSecure=${session.steamLoginSecure}; ${sessionId ? `sessionid=${sessionId}; ` : ""}timezoneOffset=10800,0`;

  const resp = await fetch(url, {
    signal: AbortSignal.timeout(20000), // Tab taraması için 20sn zaman aşımı
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
      "Accept": "application/json, text/javascript, */*; q=0.01",
      "X-Requested-With": "XMLHttpRequest",
      "Referer": `https://steamcommunity.com/profiles/${steamId}/gcpd/730/?tab=${tab}`,
      "Cookie": cookieHeader,
    },
  });

  if (!resp.ok) {
    const error = new Error(`Steam AJAX isteği başarısız (HTTP ${resp.status})`);
    if (resp.status === 401 || resp.status === 403) error.code = "STEAM_AUTH_EXPIRED";
    throw error;
  }

  const responseText = await resp.text();
  let data;
  try {
    data = JSON.parse(responseText);
  } catch {
    const error = new Error("Steam beklenen maç verisi yerine oturum sayfası döndürdü.");
    if (/login|sign\s*in|g_steamid\s*=\s*false/i.test(responseText)) error.code = "STEAM_AUTH_EXPIRED";
    throw error;
  }
  if (!data.success) {
    const error = new Error(`Steam verisi alınamadı (tab: ${tab})`);
    if (data.login_required || data.requires_login) error.code = "STEAM_AUTH_EXPIRED";
    throw error;
  }

  return data.html || "";
}

// 9. Download and Decompress .dem.bz2 (Atomik .part + Retry/Backoff + Güvenli Redirect)
const MAX_REDIRECTS = 5;
const MAX_DOWNLOAD_RETRIES = 3;
const DOWNLOAD_TIMEOUT_MS = 180000;

function cancelledError() {
  return Object.assign(new Error("İndirme ve analiz kullanıcı tarafından iptal edildi."), { name: "AbortError", code: "DOWNLOAD_CANCELLED" });
}

function throwIfCancelled(signal) {
  if (signal?.aborted) throw cancelledError();
}

function sleep(ms, signal) {
  return new Promise((resolvePromise, rejectPromise) => {
    if (signal?.aborted) {
      rejectPromise(cancelledError());
      return;
    }
    const timer = setTimeout(resolvePromise, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      rejectPromise(cancelledError());
    }, { once: true });
  });
}

// 4xx kalıcı hata: retry YAPMA. 5xx ve ağ/timeout hataları: retry yap.
function isRetryableDownloadError(err) {
  if (err && typeof err.httpStatus === "number") {
    return err.httpStatus >= 500;
  }
  return true;
}

// Tek denemelik indirme (redirect takibi recursion yerine döngüyle, stack overflow olmaz)
function downloadAndDecompressBz2Once(url, partPath, signal) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let currentRequest = null;
    let activeWriteStream = null;
    let activeDecompressor = null;

    // Timeout ve hata yollarında tüm stream'leri temizle (stream leak önleme)
    const onAbort = () => fail(cancelledError());
    const fail = (err) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", onAbort);
      try { activeWriteStream?.destroy(); } catch { /* ignore */ }
      try { activeDecompressor?.destroy?.(); } catch { /* ignore */ }
      try { currentRequest?.destroy(); } catch { /* ignore */ }
      removePartialQuiet(partPath);
      reject(err);
    };

    let redirectCount = 0;
    let currentUrl = url;
    if (signal?.aborted) return fail(cancelledError());
    signal?.addEventListener("abort", onAbort, { once: true });

    const openNext = () => {
      if (settled) return;

      const currentProtocol = new URL(currentUrl).protocol;
      const transport = currentProtocol === "http:" ? http : https;
      currentRequest = transport.get(currentUrl, { headers: { "User-Agent": "Mozilla/5.0" } }, (response) => {
        if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          response.resume();
          redirectCount++;
          if (redirectCount > MAX_REDIRECTS) {
            return fail(new Error(`Çok fazla yönlendirme (limit: ${MAX_REDIRECTS}).`));
          }
          let nextUrl;
          try {
            nextUrl = new URL(response.headers.location, currentUrl).toString();
          } catch {
            return fail(new Error("Geçersiz yönlendirme adresi alındı."));
          }
          // HTTPS bağlantısını HTTP'ye düşürme. Başlangıçta HTTP'ye yalnızca
          // Steam'in resmî replayNNN.valve.net adresleri için izin verilir.
          if (currentProtocol === "https:" && new URL(nextUrl).protocol === "http:") {
            return fail(new Error("Güvenlik: https dışına yönlendirme reddedildi."));
          }
          // Yalnızca Steam/Valve host'larına izin ver
          if (!isAllowedReplayUrl(nextUrl)) {
            return fail(new Error(`Yönlendirme izin verilmeyen sunucuya reddedildi: ${nextUrl}`));
          }
          currentUrl = nextUrl;
          return openNext();
        }

        if (response.statusCode !== 200) {
          const err = new Error(`Replay indirme başarısız (HTTP ${response.statusCode})`);
          err.httpStatus = response.statusCode;
          response.resume();
          return fail(err);
        }

        activeWriteStream = createWriteStream(partPath);
        activeDecompressor = bz2Stream();

        response.on("error", (err) => fail(err));
        activeWriteStream.on("error", (err) => fail(err));
        activeDecompressor.on("error", (err) => fail(err));

        activeWriteStream.on("finish", () => {
          if (settled) return;
          settled = true;
          signal?.removeEventListener("abort", onAbort);
          activeWriteStream.close();
          resolve(partPath);
        });

        response.pipe(activeDecompressor).pipe(activeWriteStream);
      });

      currentRequest.on("error", (err) => fail(err));

      currentRequest.setTimeout(DOWNLOAD_TIMEOUT_MS, () => {
        fail(new Error("Demo indirme zaman aşımına uğradı (180s)."));
      });
    };

    openNext();
  });
}

// Geçici ağ/5xx hatalarında üstel backoff (1sn, 2sn, 4sn) ile en fazla 3 deneme
function downloadAndDecompressBz2(url, destDemPath, signal) {
  return (async () => {
    throwIfCancelled(signal);
    if (!isAllowedReplayUrl(url)) {
      throw new Error(`Replay adresi izin verilen Steam/Valve sunucularından değil: ${url}`);
    }

    const partPath = `${destDemPath}.part`;
    // Önceki yarım kalmış .part kalıntısını temizle
    removePartialQuiet(partPath);

    let lastErr = null;
    for (let attempt = 1; attempt <= MAX_DOWNLOAD_RETRIES; attempt++) {
      try {
        await downloadAndDecompressBz2Once(url, partPath, signal);
        throwIfCancelled(signal);
        // İndirme + bunzip başarıyla bitti: atomik rename ile .dem yap
        renameSync(partPath, destDemPath);
        return destDemPath;
      } catch (err) {
        lastErr = err;
        removePartialQuiet(partPath);
        if (!isRetryableDownloadError(err) || attempt === MAX_DOWNLOAD_RETRIES) {
          throw err;
        }
        const backoffMs = 1000 * Math.pow(2, attempt - 1); // 1sn, 2sn, 4sn
        console.warn(`[STEAM-GCPD] İndirme denemesi ${attempt}/${MAX_DOWNLOAD_RETRIES} başarısız: ${err.message} — ${backoffMs / 1000}sn sonra tekrar denenecek.`);
        await sleep(backoffMs, signal);
      }
    }
    throw lastErr;
  })();
}

// 10. Process Downloaded Demo into Recent Matches with Real Match Date
export async function processDownloadedDemo(
  demPath,
  source = "steam_gcpd",
  externalId = "",
  customTimestamp = null,
  customFormattedDate = null,
  customMap = null,
  options = {}
) {
  if (!existsSync(demPath)) throw new Error(`Demo dosyası bulunamadı: ${demPath}`);

  const fileBase = basename(demPath, ".dem");
  const matchId = externalId || `gcpd_${fileBase}`;

  console.log(`[STEAM-GCPD] CS2 Demo analiz ediliyor (${source}): ${basename(demPath)}...`);
  const analysis = await analyzeDemoInWorker(demPath, options.signal);

  const reports = analysis.reports || [];
  const session = getSteamSession();
  const normalizedSessionSteamId = normalizeSteamId(session.steamId);

  const userReport = normalizedSessionSteamId
    ? reports.find((r) => normalizeSteamId(r.player?.steamid) === normalizedSessionSteamId)
    : null;
  if (!userReport) {
    throw new Error("Demo içindeki oyuncu SteamID'si aktif Steam oturumuyla eşleşmedi; başka bir oyuncuya ait değerler kullanıcıya atanmadı.");
  }

  const scannedMetadata = getScannedMatches().find((item) => item.id === matchId || item.fileName === basename(demPath));

  const header = analysis.header || {};
  const mapName = (header.map_name || customMap || userReport?.map || "de_unknown").replace(/^de_/, "");

  const roundPaths = Array.isArray(userReport.roundPaths) ? userReport.roundPaths : [];
  const measuredUserScore = roundPaths.filter((round) => round.won).length;
  const measuredEnemyScore = roundPaths.filter((round) => !round.won).length;
  const scannedUserScore = Number(scannedMetadata?.score?.userScore);
  const scannedEnemyScore = Number(scannedMetadata?.score?.enemyScore);
  const hasScannedScore = Number.isFinite(scannedUserScore) && Number.isFinite(scannedEnemyScore);
  const hasRoundScore = roundPaths.length > 0;
  if (!hasScannedScore && !hasRoundScore) {
    throw new Error("Maç sonucu demo round verisinden veya Steam skor kartından doğrulanamadı.");
  }

  const userTeam = hasScannedScore ? String(scannedMetadata.score.userTeam || "Karma") : "Karma";
  const userScore = hasScannedScore ? scannedUserScore : measuredUserScore;
  const enemyScore = hasScannedScore ? scannedEnemyScore : measuredEnemyScore;
  const isWin = userScore > enemyScore;
  const isTie = userScore === enemyScore;

  const kills = userReport?.kills || 0;
  const deaths = userReport.deaths || 0;
  const assists = userReport?.assists || 0;
  const kd = deaths > 0 ? Math.round((kills / deaths) * 100) / 100 : null;
  const hsPercent = userReport?.headshotPercent || 0;
  const movementEligibilityPercent = userReport.movementProfile?.status === "measured"
    && Number.isFinite(userReport.movementProfile.invalidShotPercent)
    ? Math.round((100 - userReport.movementProfile.invalidShotPercent) * 10) / 10
    : null;
  const adr = userReport?.adr || 0;

  // Determine actual match timestamp (Real Match Date!)
  let matchTimestamp = customTimestamp;
  if (!matchTimestamp) {
    // Check scanned matches cache for exact GMT match date
    const scanned = getScannedMatches();
    const foundScanned = scanned.find((s) => s.id === matchId || s.fileName === basename(demPath));
    if (foundScanned?.timestamp) {
      matchTimestamp = foundScanned.timestamp;
    }
  }
  if (!matchTimestamp) {
    try {
      const stats = statSync(demPath);
      matchTimestamp = stats.mtimeMs || stats.birthtimeMs || Date.now();
    } catch {
      matchTimestamp = Date.now();
    }
  }

  const formattedDate = customFormattedDate || new Date(matchTimestamp).toLocaleString("tr-TR", { dateStyle: "short", timeStyle: "short" });

  const newMatchRecord = {
    id: matchId,
    source,
    fileName: basename(demPath),
    demoPath: demPath,
    map: mapName,
    timestamp: matchTimestamp,
    formattedDate,
    score: {
      userTeam,
      userScore,
      enemyScore,
      result: isTie ? "Beraberlik" : isWin ? "Galibiyet" : "Mağlubiyet",
      isWin,
      isTie,
      rawScore: `${userScore} - ${enemyScore}`,
    },
    userStats: {
      name: userReport?.player?.name || "Sen",
      steamid: userReport?.player?.steamid || session.steamId || "",
      kills,
      deaths,
      assists,
      kd,
      hsPercent,
      movementEligibilityPercent,
      counterStrafePercent: movementEligibilityPercent,
      adr,
    },
    fullAnalysis: analysis,
  };

  // Son maç ekranının beş maçlık disk kotasından bağımsız, koordinatsız kompakt
  // takım kanıtını sakla. Böylece demo sonradan temizlense bile aynı beşlinin
  // geçmişi takım koçluğu raporunda kullanılabilir.
  try {
    const squadArchiveResult = squadStore.ingestMatch(newMatchRecord, scannedMetadata || null);
    if (!squadArchiveResult.ok) {
      console.warn(`[TAKIM-KOÇU] ${basename(demPath)} arşivlenemedi: ${squadArchiveResult.reason}`);
    }
  } catch (error) {
    // Takım arşivi ikincil bir kompakt kopyadır. Geçici dosya kilidi veya izin
    // sorunu ana oyuncu analizini ve recent_matches güncellemesini iptal etmemeli.
    console.warn(`[TAKIM-KOÇU] ${basename(demPath)} arşiv yazımı atlandı: ${error instanceof Error ? error.message : String(error)}`);
  }

  // Paralel indirmelerde getRecentMatches→değiştir→saveRecentMatches yarışını önlemek için kuyruk üzerinden serileştir
  await enqueueRecentMatchesUpdate(() => {
    const existingMatches = getRecentMatches();
    const existingIndex = existingMatches.findIndex((m) => m.id === matchId || m.fileName === basename(demPath));

    if (existingIndex >= 0) {
      existingMatches[existingIndex] = newMatchRecord;
    } else {
      existingMatches.unshift(newMatchRecord);
    }

    return enforceMatchLimit(existingMatches, session.matchLimit || 5, [demPath]);
  });

  // Update scanned_matches.json to reflect isDownloaded
  const scannedList = getScannedMatches();
  const scIdx = scannedList.findIndex((s) => s.id === matchId || s.fileName === basename(demPath));
  if (scIdx >= 0) {
    scannedList[scIdx].isDownloaded = true;
    saveScannedMatches(scannedList);
  }

  console.log(`[STEAM-GCPD] Maç başarıyla analiz edildi: de_${mapName} (${newMatchRecord.score.result}) - Tarih: ${formattedDate}`);
  return newMatchRecord;
}

// 11. Scan Steam GCPD for Match Summaries (Ranked, Premier, Rekabetçi, Yoldaş)
let scanRunning = false;

export async function scanSteamGcpdMatches() {
  if (scanRunning) {
    return {
      ok: true,
      busy: true,
      message: "Tarama işlemi arka planda zaten devam ediyor.",
      scannedMatches: getScannedMatches(),
      downloadedMatches: getRecentMatches(),
    };
  }

  const session = getSteamSession();
  const previouslyScanned = getScannedMatches();
  if (!session.steamLoginSecure) {
    return {
      ok: false,
      requiresLogin: true,
      message: "Steam oturumu bağlı değil. Lütfen 'Steam Oturumu Bağla' bölümünden çerezinizi girin.",
      scannedMatches: getScannedMatches(),
      downloadedMatches: getRecentMatches(),
    };
  }

  const steamId = session.steamId || extractSteamIdFromCookie(session.steamLoginSecure);
  if (!steamId) {
    return {
      ok: false,
      requiresLogin: true,
      message: "Steam ID çerezden okunamadı. Lütfen çerezinizi kontrol edin.",
      scannedMatches: getScannedMatches(),
      downloadedMatches: getRecentMatches(),
    };
  }

  if (isGamePerformanceModeActive()) {
    return performancePausedResult("CS2 canlı maçta: Steam geçmişi taraması maç sonrasına ertelendi.");
  }

  scanRunning = true;
  console.log(`[STEAM-GCPD] >>> Steam CS2 Maç Geçmişi Taranıyor (SteamID: ${steamId}) <<<`);

  try {
    const MODES = [
      { tab: "matchhistorycompetitivepermap", label: "Ranked Rekabetçi" },
      { tab: "matchhistorypremier", label: "Premier" },
      { tab: "matchhistorycompetitive", label: "Rekabetçi" },
      { tab: "matchhistorywingman", label: "Yoldaş" },
    ];

    const allFound = [];
    const downloadedMatches = getRecentMatches();
    const successfulModes = new Set();
    const scanErrors = [];

    for (const mode of MODES) {
      if (isGamePerformanceModeActive()) {
        console.log("[PERF] CS2 maçı başladı; Steam taramasının kalan bölümü ertelendi.");
        return performancePausedResult("CS2 maçı başladığı için Steam taramasının kalan bölümü ertelendi.");
      }
      try {
        console.log(`[STEAM-GCPD] ${mode.label} maçları sorgulanıyor...`);
        const html = await fetchGcpdTabAjax(steamId, mode.tab, session);
        const parsed = parseGcpdMatchesFromHtml(html, mode.label, steamId);
        successfulModes.add(mode.label);
        console.log(`[STEAM-GCPD] ${mode.label} modunda ${parsed.length} maç bulundu.`);

        for (const item of parsed) {
          if (!allFound.some((existing) => existing.id === item.id || existing.replayUrl === item.replayUrl)) {
            const isDl = downloadedMatches.some((dm) => dm.id === item.id || dm.fileName === item.fileName);
            item.isDownloaded = isDl;
            allFound.push(item);
          }
        }
      } catch (err) {
        scanErrors.push({ mode: mode.label, message: err.message, code: err.code || "" });
        console.warn(`[STEAM-GCPD] ${mode.label} sorgusu atlandı:`, err.message);
      }
    }

    if (successfulModes.size === 0) {
      const authExpired = scanErrors.some((error) => error.code === "STEAM_AUTH_EXPIRED");
      const lastError = scanErrors.map((error) => `${error.mode}: ${error.message}`).join(" · ").slice(0, 1000)
        || "Steam’den hiçbir maç geçmişi sekmesi okunamadı.";
      saveSteamSession({
        lastScanTime: Date.now(),
        lastScanStatus: authExpired ? "expired" : "error",
        lastScanError: lastError,
      });
      return {
        ok: false,
        requiresLogin: authExpired,
        connectionState: authExpired ? "expired" : "error",
        message: authExpired
          ? "Steam oturumunun süresi dolmuş. Bağlantı çerezini yenile; kayıtlı maçların korunuyor."
          : "Steam’e şu anda erişilemedi. Kayıtlı maçların korundu; daha sonra yeniden tarayabilirsin.",
        scannedMatches: previouslyScanned,
        downloadedMatches: getRecentMatches(),
      };
    }

    if (allFound.length === 0 && previouslyScanned.length > 0) {
      const message = "Steam yanıt verdi ancak maç satırları okunamadı. Önceki maçların korundu; bağlantı/HTML biçimi yeniden doğrulanmalı.";
      saveSteamSession({ lastScanTime: Date.now(), lastScanStatus: "error", lastScanError: message });
      return {
        ok: false,
        connectionState: "error",
        message,
        scannedMatches: previouslyScanned,
        downloadedMatches: getRecentMatches(),
      };
    }

    // Steam sekmelerinden biri geçici olarak yanıt vermediğinde veya açılış
    // taraması kısmi kaldığında daha önce bulunan maçları boş/kısmi sonuçla
    // ezme. Yeni veriyi öne al, önbellekteki benzersiz kayıtları koru.
    const mergedMatches = mergeScannedMatchCache(allFound, previouslyScanned, downloadedMatches);

    saveScannedMatches(mergedMatches);
    saveSteamSession({
      lastScanTime: Date.now(),
      lastSuccessfulScanTime: Date.now(),
      lastScanStatus: "success",
      lastScanError: scanErrors.length
        ? `${scanErrors.length} Steam sekmesi geçici olarak okunamadı; önbellekteki maçlar korundu.`
        : "",
    });

    // İlk bağlantıda geçmişi bildirim yağmuruna çevirmiyoruz. Sonraki
    // taramalarda daha önce görülmeyen maçlar otomasyon akışına girer.
    if (previouslyScanned.length > 0) {
      const known = new Set(previouslyScanned.flatMap((item) => [item.id, item.replayUrl]).filter(Boolean));
      const discovered = mergedMatches.filter((item) => !known.has(item.id) && !known.has(item.replayUrl));
      if (discovered.length > 0) steamEvents.emit("matches-discovered", discovered);
    }
    steamEvents.emit("scan-complete", mergedMatches);

    console.log(`[STEAM-GCPD] Toplam ${mergedMatches.length} maç özeti hazırlandı (${mergedMatches.filter((m) => m.isDownloaded).length} indirilmiş).`);

    return {
      ok: true,
      message: `${mergedMatches.length} maç tarandı ve güncellendi.`,
      connectionState: "connected",
      scannedMatches: mergedMatches,
      downloadedMatches: getRecentMatches(),
      lastScanTime: Date.now(),
    };
  } catch (err) {
    console.error("[STEAM-GCPD] Tarama hatası:", err.message);
    return {
      ok: false,
      message: `Tarama hatası: ${err.message}`,
      scannedMatches: getScannedMatches(),
      downloadedMatches: getRecentMatches(),
    };
  } finally {
    scanRunning = false;
  }
}

// 12. On-Demand Single Match Downloader
let downloadRunningMatchId = null;
const activeDownloadControllers = new Map();

function analyzeDemoInWorker(filePath, signal) {
  return new Promise((resolvePromise, rejectPromise) => {
    throwIfCancelled(signal);
    const workerPath = join(__dirname, "analyze-worker.mjs");
    const worker = new Worker(workerPath, { workerData: { filePath } });
    let settled = false;
    const timer = setTimeout(() => finish(new Error("Demo analizi zaman aşımına uğradı (5 dk).")), 5 * 60 * 1000);
    const onAbort = () => finish(cancelledError());
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      if (error) {
        void worker.terminate();
        rejectPromise(error);
      } else {
        resolvePromise(result);
      }
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    worker.once("message", (message) => message?.ok
      ? finish(null, message.result)
      : finish(new Error(message?.error || "Demo analizi başarısız oldu.")));
    worker.once("error", (error) => finish(error));
    worker.once("exit", (code) => {
      if (!settled && code !== 0) finish(new Error(`Analiz iş parçacığı beklenmedik şekilde kapandı (${code}).`));
    });
  });
}

export function cancelSingleMatch(matchId) {
  const controller = activeDownloadControllers.get(String(matchId || ""));
  if (!controller) return false;
  controller.abort();
  return true;
}

export function getActiveDownloadMatchId() {
  return downloadRunningMatchId;
}

export async function downloadSingleMatch(matchId, replayUrl = "", matchMeta = {}) {
  if (isGamePerformanceModeActive()) {
    steamEvents.emit("download-status", { matchId, status: "waiting", message: "CS2 canlı: indirme maç sonrasına ertelendi." });
    return {
      ok: false,
      paused: true,
      performanceMode: true,
      message: "CS2 canlı maçta: replay indirme ve demo analizi maç sonrasına ertelendi.",
    };
  }
  if (downloadRunningMatchId) {
    return { ok: false, busy: true, activeMatchId: downloadRunningMatchId, message: "Başka bir maç indiriliyor; bu maç sırada beklemeli." };
  }

  let finalReplayUrl = replayUrl;
  let finalMeta = { ...matchMeta };

  if (!finalReplayUrl) {
    const scanned = getScannedMatches();
    const found = scanned.find((s) => s.id === matchId);
    if (found) {
      finalReplayUrl = found.replayUrl;
      finalMeta = { ...found, ...matchMeta };
    }
  }

  if (!finalReplayUrl) {
    return { ok: false, message: "Maçın replay indirme bağlantısı bulunamadı." };
  }

  let fileBase;
  try {
    fileBase = replayFileBase(finalReplayUrl);
  } catch (err) {
    return { ok: false, message: err.message };
  }

  downloadRunningMatchId = matchId;
  const controller = new AbortController();
  activeDownloadControllers.set(matchId, controller);
  const signal = controller.signal;
  const targetDem = join(DEMOS_DIR, `${fileBase}.dem`);
  const demoAlreadyExisted = existsSync(targetDem);

  console.log(`[STEAM-GCPD] Seçilen maç indiriliyor: ${fileBase}.dem.bz2...`);
  steamEvents.emit("download-status", { matchId, status: "downloading", message: "Replay indiriliyor." });

  try {
    // Yarım kalmış .part kalıntısını temizle ki existsSync kontrolü yarım dosyayı "indirilmiş" saymasın
    removePartialQuiet(`${targetDem}.part`);

    if (!existsSync(targetDem)) {
      await downloadAndDecompressBz2(finalReplayUrl, targetDem, signal);
    }
    throwIfCancelled(signal);

    if (isGamePerformanceModeActive()) {
      console.log("[PERF] CS2 maçı başladı; indirilen demonun analizi maç sonrasına ertelendi.");
      steamEvents.emit("download-status", { matchId, status: "waiting", message: "Replay indirildi; analiz maç sonrasına ertelendi." });
      return {
        ok: false,
        paused: true,
        performanceMode: true,
        message: "Replay indirildi; CS2 maçı başladığı için demo analizi maç sonrasına ertelendi.",
      };
    }

    steamEvents.emit("download-status", { matchId, status: "analyzing", message: "Replay indirildi; demo analiz ediliyor." });
    const processed = await processDownloadedDemo(
      targetDem,
      finalMeta.source || "steam_gcpd",
      matchId,
      finalMeta.timestamp || null,
      finalMeta.formattedDate || null,
      finalMeta.map || null,
      { signal }
    );
    steamEvents.emit("download-status", { matchId, status: "ready", message: "Maç indirildi ve tam analiz hazır.", match: processed });

    return {
      ok: true,
      message: "Maç başarıyla indirildi ve analiz edildi!",
      match: processed,
      matches: getRecentMatches(),
      scannedMatches: getScannedMatches(),
      demoStorage: getDemoStorageState(),
    };
  } catch (err) {
    if (err?.name === "AbortError" || err?.code === "DOWNLOAD_CANCELLED") {
      if (!demoAlreadyExisted) removePartialQuiet(targetDem);
      removePartialQuiet(`${targetDem}.part`);
      steamEvents.emit("download-status", { matchId, status: "cancelled", message: "İndirme ve analiz iptal edildi." });
      return { ok: false, cancelled: true, message: "İndirme ve analiz iptal edildi." };
    }
    console.error(`[STEAM-GCPD] Tek maç indirme hatası (${fileBase}):`, err.message);
    steamEvents.emit("download-status", { matchId, status: "failed", message: `İndirme veya analiz başarısız: ${err.message}` });
    return { ok: false, message: `İndirme hatası: ${err.message}` };
  } finally {
    activeDownloadControllers.delete(matchId);
    downloadRunningMatchId = null;
  }
}

// 13. Auto-Repair Existing Match Dates in recent_matches.json
export function repairExistingMatchDates() {
  const matches = getRecentMatches();
  const scanned = getScannedMatches();
  let modified = false;

  for (const m of matches) {
    const foundScanned = scanned.find((s) =>
      (Boolean(s.id) && Boolean(m.id) && s.id === m.id)
      || (Boolean(s.fileName) && Boolean(m.fileName) && s.fileName === m.fileName));
    if (foundScanned && foundScanned.timestamp && Math.abs(foundScanned.timestamp - m.timestamp) > 120000) {
      console.log(`[STEAM-GCPD] Tarih onarımı: ${m.fileName} ${m.formattedDate} -> ${foundScanned.formattedDate}`);
      m.timestamp = foundScanned.timestamp;
      m.formattedDate = foundScanned.formattedDate;
      modified = true;
    }
  }

  if (modified) {
    saveRecentMatches(matches);
  }
  return matches;
}

// 14. Background Periodic Auto-Scan Scheduler (Every 5 minutes)
let autoScanTimer = null;

export function startAutoScanScheduler(intervalMs = 5 * 60 * 1000) {
  if (autoScanTimer) {
    clearInterval(autoScanTimer);
    autoScanTimer = null;
  }

  console.log(`[STEAM-GCPD] 5 dakikalık otomatik maç tarayıcısı başlatıldı (${intervalMs / 1000} saniye).`);

  // Run initial scan after 10 seconds if session is active
  setTimeout(() => {
    const session = getSteamSession();
    if (session.steamLoginSecure) {
      scanSteamGcpdMatches().catch((e) => console.warn("[STEAM-GCPD] Başlangıç taraması hatası:", e.message));
    }
  }, 10000);

  autoScanTimer = setInterval(() => {
    const session = getSteamSession();
    if (isGamePerformanceModeActive()) {
      console.log("[PERF] CS2 canlı maçta; periyodik Steam taraması bu tur atlandı.");
    } else if (session.steamLoginSecure && session.autoScanEnabled !== false) {
      console.log("[STEAM-GCPD] ⏰ Periyodik 5 dakikalık otomatik tarama çalışıyor...");
      scanSteamGcpdMatches().catch((e) => console.warn("[STEAM-GCPD] Periyodik tarama hatası:", e.message));
    }
  }, intervalMs);
}

// 15. Manual Delete Single Match
export async function deleteSteamMatch(matchId) {
  const matches = getRecentMatches();
  const index = matches.findIndex((m) => m.id === matchId);
  if (index === -1) return false;

  const [removed] = matches.splice(index, 1);
  if (removed.demoPath && existsSync(removed.demoPath)) {
    try {
      unlinkSync(removed.demoPath);
    } catch { /* ignore */ }
  }

  await saveRecentMatches(matches);

  const scannedList = getScannedMatches();
  const scIdx = scannedList.findIndex((s) => s.id === matchId || s.fileName === removed.fileName);
  if (scIdx >= 0) {
    scannedList[scIdx].isDownloaded = false;
    saveScannedMatches(scannedList);
  }

  return true;
}

// 16. Legacy Sync (Downloads first N matches if requested)
export async function syncSteamGcpdMatches() {
  const scanRes = await scanSteamGcpdMatches(true);
  if (!scanRes.ok || scanRes.paused) return scanRes;

  const scanned = scanRes.scannedMatches || [];
  const existingMatches = getRecentMatches();
  const session = getSteamSession();
  const downloadLimit = session.matchLimit || 5;

  let addedCount = 0;
  for (const item of scanned.slice(0, downloadLimit)) {
    if (!existingMatches.some((m) => m.id === item.id || m.fileName === item.fileName)) {
      try {
        await downloadSingleMatch(item.id, item.replayUrl, item);
        addedCount++;
      } catch (err) {
        console.warn("[STEAM-GCPD] Otomatik indirme hatası:", err.message);
      }
    }
  }

  return {
    ok: true,
    message: addedCount > 0
      ? `${addedCount} yeni maç indirildi ve analiz edildi!`
      : "Tüm maçlarınız güncel.",
    matches: getRecentMatches(),
    scannedMatches: getScannedMatches(),
  };
}
