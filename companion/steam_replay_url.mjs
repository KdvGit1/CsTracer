const HTTPS_DOWNLOAD_DOMAINS = [
  "steamcommunity.com",
  "steampowered.com",
  "steamcontent.com",
  "akamaihd.net",
];

export const CS2_APP_ID = "730";
const VALVE_REPLAY_HOST = /^replay\d+\.valve\.net$/i;
const VALVE_REPLAY_PATH = new RegExp(`^/${CS2_APP_ID}/[a-z0-9][a-z0-9._-]*\\.dem\\.bz2$`, "i");

export function isValveReplayUrl(url) {
  return VALVE_REPLAY_HOST.test(url.hostname) && VALVE_REPLAY_PATH.test(url.pathname);
}

export function isAllowedReplayUrl(urlString) {
  try {
    const url = new URL(urlString);
    if (url.username || url.password || url.port) return false;

    const host = url.hostname.toLowerCase();
    if (isValveReplayUrl(url)) {
      // Steam'in GCPD sayfası resmî replayNNN.valve.net adreslerini halen HTTP
      // olarak verebiliyor. HTTP yalnızca bu dar host + demo yolu için açıktır.
      return url.protocol === "http:" || url.protocol === "https:";
    }

    if (url.protocol !== "https:") return false;
    return HTTPS_DOWNLOAD_DOMAINS.some((domain) => host === domain || host.endsWith(`.${domain}`));
  } catch {
    return false;
  }
}

export function replayFileBase(urlString) {
  const url = new URL(urlString);
  const fileName = url.pathname.split("/").pop() || "";
  if (!/^[a-z0-9][a-z0-9._-]*\.dem\.bz2$/i.test(fileName)) {
    throw new Error("Replay dosya adı geçersiz.");
  }
  return fileName.slice(0, -".dem.bz2".length);
}
