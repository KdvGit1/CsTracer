// Ses kanalında radyo. İstasyon akışı ffmpeg ile Ogg/Opus'a çevrilip @discordjs/voice ile kanala
// verilir (ayrıca Opus kütüphanesi gerekmez). Akış koparsa yeniden bağlanır, çalan şarkının adını
// (ICY) okur ve kanalda dinleyen kalmayınca kendiliğinden çıkar. Sunucu başına tek oturum.
import { spawn, spawnSync } from "node:child_process";
import http from "node:http";
import https from "node:https";
import * as voiceLib from "@discordjs/voice";
import { logger } from "../log.mjs";
import { USER_AGENT } from "./radio-catalog.mjs";

const log = logger("radyo");
const ALONE_MS = 2 * 60_000;
const META_EVERY_MS = 20_000;
const MAX_FAILURES = 5;

export class RadioError extends Error {
  constructor(message) {
    super(message);
    this.userFacing = true;
  }
}

/** Akışı Discord'un istediği 48 kHz stereo Opus'a (Ogg kabında) çeviren ffmpeg argümanları. */
export function ffmpegArgs(station) {
  return [
    "-hide_banner", "-loglevel", "error", "-nostdin",
    "-user_agent", USER_AGENT,
    // HLS (m3u8) kendi parçalarını yeniden ister; düz akışlarda kopan bağlantıyı ffmpeg toparlar.
    ...(station.hls ? [] : ["-reconnect", "1", "-reconnect_streamed", "1", "-reconnect_delay_max", "10"]),
    // Yalnız ağ: istasyon adresi yerel dosya veya başka protokol açtıramaz.
    "-protocol_whitelist", "http,https,tcp,tls,crypto",
    "-i", station.url,
    "-vn", "-ac", "2", "-ar", "48000",
    "-c:a", "libopus", "-b:a", "96k", "-application", "audio", "-frame_duration", "20",
    "-f", "ogg", "pipe:1",
  ];
}

export function checkFfmpeg(run = spawnSync) {
  const result = run("ffmpeg", ["-hide_banner", "-encoders"], { encoding: "utf8", timeout: 10_000 });
  if (result.error) return { ok: false, reason: "sunucuda ffmpeg kurulu değil (sudo apt-get install -y ffmpeg)" };
  if (!/libopus/.test(result.stdout || "")) return { ok: false, reason: "ffmpeg'de libopus kodlayıcısı yok" };
  return { ok: true, reason: "" };
}

function decodeIcy(buffer) {
  const utf8 = buffer.toString("utf8");
  if (!utf8.includes("�")) return utf8;
  // Türk istasyonlarının çoğu UTF-8 değil Windows-1254 gönderir (ş, ğ, ı).
  try { return new TextDecoder("windows-1254").decode(buffer); } catch { return buffer.toString("latin1"); }
}

/** "StreamTitle='Sanatçı - Şarkı';StreamUrl='';" → "Sanatçı - Şarkı" */
export function parseIcyMetadata(buffer) {
  const title = decodeIcy(buffer).replace(/\0+$/, "").match(/StreamTitle='(.*?)';/s)?.[1]?.trim();
  return title && !/^[-\s]*$|^unknown$/i.test(title) ? title.slice(0, 200) : null;
}

/**
 * Çalan şarkının adını okur: akışa kısa süre bağlanıp ilk ICY bloğunu alır ve bağlantıyı kapatır.
 * { supported: false } istasyonun şarkı adı göndermediğini söyler.
 */
export function readIcyTitle(url, { timeoutMs = 12_000, redirects = 3 } = {}) {
  return new Promise((resolve) => {
    let target;
    try { target = new URL(url); } catch { resolve({ supported: false, title: null }); return; }
    let settled = false;
    let request = null;
    const done = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      request?.destroy();
      resolve(result);
    };
    const timer = setTimeout(() => done({ supported: true, title: null }), timeoutMs);
    const get = target.protocol === "https:" ? https.get : http.get;
    request = get(target, { headers: { "Icy-MetaData": "1", "User-Agent": USER_AGENT } }, (response) => {
      const location = response.headers.location;
      if (response.statusCode >= 300 && response.statusCode < 400 && location && redirects > 0) {
        response.resume();
        readIcyTitle(new URL(location, target).href, { timeoutMs, redirects: redirects - 1 }).then(done);
        return;
      }
      const metaint = Number(response.headers["icy-metaint"]);
      if (response.statusCode !== 200 || !(metaint > 0)) return done({ supported: response.statusCode !== 200, title: null });
      let skip = metaint;
      let length = -1;
      let collected = 0;
      const parts = [];
      response.on("data", (chunk) => {
        let offset = 0;
        while (offset < chunk.length && !settled) {
          if (skip > 0) {
            const take = Math.min(skip, chunk.length - offset);
            skip -= take;
            offset += take;
          } else if (length < 0) {
            length = chunk[offset++] * 16;
            // Boş blok: başlık değişmemiş; bir sonraki bloğa bak.
            if (length === 0) { skip = metaint; length = -1; }
          } else {
            const take = Math.min(length - collected, chunk.length - offset);
            parts.push(chunk.subarray(offset, offset + take));
            collected += take;
            offset += take;
            if (collected === length) return done({ supported: true, title: parseIcyMetadata(Buffer.concat(parts)) });
          }
        }
      });
      response.on("end", () => done({ supported: true, title: null }));
      response.on("error", () => done({ supported: true, title: null }));
    });
    request.on("error", () => done({ supported: true, title: null }));
  });
}

function killProcess(child) {
  if (child && child.exitCode === null && !child.killed) {
    try { child.kill("SIGKILL"); } catch { /* zaten kapanmış */ }
  }
}

export class RadioService {
  constructor({ catalog, voice = voiceLib, spawnImpl = spawn, readTitle = readIcyTitle, ffmpeg = null, botId = () => "", onUpdate = () => {} } = {}) {
    this.catalog = catalog;
    this.voice = voice;
    this.spawn = spawnImpl;
    this.readTitle = readTitle;
    this.ffmpeg = ffmpeg || checkFfmpeg();
    this.botId = botId;
    this.onUpdate = onUpdate;
    this.sessions = new Map();
    this.locks = new Map();
  }

  session(guildId) {
    return this.sessions.get(String(guildId)) || null;
  }

  /** Kanalda (bot hariç) kaç kişi var. Üyesi bilinmeyen durumu insan sayar: yanlışlıkla çıkmaktan iyidir. */
  listeners(guild, channelId) {
    const botId = this.botId();
    let count = 0;
    for (const state of guild?.voiceStates?.cache?.values?.() || []) {
      if (state.channelId === channelId && state.id !== botId && !state.member?.user?.bot) count++;
    }
    return count;
  }

  /** Aynı sunucuda aynı anda gelen istekler (iki kişi aynı anda düğmeye basınca) sırayla işlenir. */
  play(options) {
    const key = String(options.guild.id);
    const run = (this.locks.get(key) || Promise.resolve()).catch(() => null).then(() => this.playNow(options));
    this.locks.set(key, run);
    run.catch(() => null).finally(() => { if (this.locks.get(key) === run) this.locks.delete(key); });
    return run;
  }

  async playNow({ guild, channel, station, userId }) {
    if (!this.ffmpeg.ok) throw new RadioError(`Radyo bu sunucuda hazır değil: ${this.ffmpeg.reason}.`);
    const { AudioPlayerStatus, VoiceConnectionStatus, entersState } = this.voice;
    const guildId = String(guild.id);
    let session = this.session(guildId);
    if (!session) {
      session = { guildId, player: this.createPlayer(guildId), generation: 0, panel: null };
      this.sessions.set(guildId, session);
    }
    clearTimeout(session.retryTimer);
    Object.assign(session, { guild, channelId: channel.id, station, startedBy: userId, title: null, failures: 0, lastError: "", stopping: false });
    session.generation++;

    const connection = this.voice.joinVoiceChannel({ channelId: channel.id, guildId, adapterCreator: guild.voiceAdapterCreator, selfDeaf: true });
    if (session.connection !== connection) {
      session.connection = connection;
      this.watchConnection(session, connection);
    }
    try {
      await entersState(connection, VoiceConnectionStatus.Ready, 20_000);
    } catch {
      this.stop(guildId, "Ses kanalına bağlanılamadı.", { silent: true });
      throw new RadioError("Ses kanalına bağlanamadım. Botun bu kanalda **Bağlan** ve **Konuş** izni olduğundan emin ol, sonra tekrar dene.");
    }
    connection.subscribe(session.player);
    this.startStream(session);
    try {
      await entersState(session.player, AudioPlayerStatus.Playing, 20_000);
    } catch {
      const detail = session.lastError ? ` (${session.lastError})` : "";
      this.stop(guildId, `${station.name} açılmadı.`, { silent: true });
      throw new RadioError(`**${station.name}** yayını şu an açılmıyor${detail}. Başka bir istasyon dene.`);
    }
    this.startMeta(session);
    this.checkAlone(session);
    log.info(`${guild.name || guildId}: ${station.name} çalıyor.`);
    return session;
  }

  createPlayer(guildId) {
    const { AudioPlayerStatus, NoSubscriberBehavior, createAudioPlayer } = this.voice;
    const player = createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Play } });
    player.on(AudioPlayerStatus.Idle, () => this.streamEnded(guildId));
    player.on("error", (error) => {
      const session = this.session(guildId);
      if (session) session.lastError = error.message;
    });
    return player;
  }

  watchConnection(session, connection) {
    const { VoiceConnectionStatus, entersState } = this.voice;
    connection.on(VoiceConnectionStatus.Disconnected, async () => {
      try {
        // Kanal değişimi veya kısa kopma: Discord birkaç saniye içinde yeniden bağlar.
        await Promise.race([
          entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
          entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
        ]);
      } catch {
        if (session.connection === connection && !session.stopping) this.stop(session.guildId, "Ses kanalından çıkarıldım.");
      }
    });
    connection.on(VoiceConnectionStatus.Destroyed, () => {
      if (session.connection === connection && !session.stopping) this.stop(session.guildId, "Ses bağlantısı kapandı.");
    });
    connection.on("error", (error) => log.warn(`Ses bağlantısı hatası: ${error.message}`));
  }

  startStream(session) {
    const { StreamType, createAudioResource } = this.voice;
    const previous = session.ffmpeg;
    const child = this.spawn("ffmpeg", ffmpegArgs(session.station), { stdio: ["ignore", "pipe", "pipe"] });
    session.ffmpeg = child;
    session.streamStartedAt = Date.now();
    child.on("error", (error) => { session.lastError = error.code === "ENOENT" ? "ffmpeg bulunamadı" : error.message; });
    child.stderr?.on("data", (chunk) => {
      const line = String(chunk).trim().split("\n").pop();
      if (line) session.lastError = line.slice(0, 160);
    });
    // Önce yeni akışı ver, sonra eskisini kapat: oynatıcı arada boşa düşüp "bitti" sanmasın.
    session.player.play(createAudioResource(child.stdout, { inputType: StreamType.OggOpus }));
    killProcess(previous);
  }

  streamEnded(guildId) {
    const session = this.session(guildId);
    if (!session || session.stopping) return;
    // Uzun süre çaldıktan sonraki kopma yeni bir arızadır; art arda hızlı kopmalar yayının açılmadığını gösterir.
    session.failures = Date.now() - session.streamStartedAt > 60_000 ? 1 : session.failures + 1;
    if (session.failures > MAX_FAILURES) {
      this.stop(guildId, `**${session.station.name}** yayını koptu ve geri gelmedi${session.lastError ? ` (${session.lastError})` : ""}.`);
      return;
    }
    clearTimeout(session.retryTimer);
    session.retryTimer = setTimeout(() => {
      if (this.session(guildId) === session && !session.stopping) this.startStream(session);
    }, Math.min(15_000, 1_000 * 2 ** session.failures));
  }

  startMeta(session) {
    clearInterval(session.metaTimer);
    if (session.station.hls) return;
    const generation = session.generation;
    let misses = 0;
    const poll = async () => {
      const result = await this.readTitle(session.station.url).catch(() => ({ supported: true, title: null }));
      if (this.session(session.guildId) !== session || session.generation !== generation || session.stopping) return;
      if (!result.supported) return clearInterval(session.metaTimer);
      if (!result.title) {
        // Hiç şarkı adı göndermeyen istasyonu boşuna yoklama.
        if (++misses >= 3 && !session.title) clearInterval(session.metaTimer);
        return;
      }
      misses = 0;
      if (result.title !== session.title) {
        session.title = result.title;
        this.emit(session, { type: "title" });
      }
    };
    session.metaTimer = setInterval(poll, META_EVERY_MS);
    session.metaTimer.unref?.();
    void poll();
  }

  checkAlone(session) {
    if (this.listeners(session.guild, session.channelId) > 0) {
      clearTimeout(session.aloneTimer);
      session.aloneTimer = null;
      return;
    }
    session.aloneTimer ??= setTimeout(() => this.stop(session.guildId, "Kanalda kimse kalmadığı için radyoyu kapattım."), ALONE_MS);
  }

  voiceStateUpdate(oldState, newState) {
    const guild = newState?.guild || oldState?.guild;
    const session = guild ? this.session(guild.id) : null;
    if (!session) return;
    session.guild = guild;
    if (newState?.id === this.botId() && newState.channelId && newState.channelId !== session.channelId) {
      // Biri botu başka kanala taşıdı: oradan çalmaya devam et.
      session.channelId = newState.channelId;
      this.emit(session, { type: "moved" });
    }
    this.checkAlone(session);
  }

  emit(session, event) {
    try { this.onUpdate(session, event); } catch (error) { log.warn(`Radyo paneli güncellenemedi: ${error.message}`); }
  }

  stop(guildId, reason = "Radyo kapatıldı.", { silent = false } = {}) {
    const session = this.session(guildId);
    if (!session) return null;
    session.stopping = true;
    this.sessions.delete(String(guildId));
    clearTimeout(session.retryTimer);
    clearTimeout(session.aloneTimer);
    clearInterval(session.metaTimer);
    try { session.player.stop(true); } catch { /* yok say */ }
    killProcess(session.ffmpeg);
    try {
      if (session.connection && session.connection.state?.status !== this.voice.VoiceConnectionStatus.Destroyed) session.connection.destroy();
    } catch { /* zaten kapalı */ }
    session.stopReason = reason;
    if (!silent) this.emit(session, { type: "stopped", reason });
    return session;
  }

  stopAll() {
    for (const guildId of [...this.sessions.keys()]) this.stop(guildId, "Bot yeniden başlatılıyor.", { silent: true });
  }
}
