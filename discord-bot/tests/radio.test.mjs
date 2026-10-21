import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdirSync, readFileSync } from "node:fs";
import http from "node:http";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import test from "node:test";
import { AudioPlayerStatus, NoSubscriberBehavior, StreamType, createAudioPlayer, createAudioResource, entersState } from "@discordjs/voice";
import { handleInteraction } from "../src/bot/router.mjs";
import { RadioError, RadioService, checkFfmpeg, ffmpegArgs, parseIcyMetadata, readIcyTitle } from "../src/services/radio.mjs";
import { RadioCatalog, fold, normalizeStations } from "../src/services/radio-catalog.mjs";
import { fakeInteraction, lastText, tempDir, testApp } from "./helpers.mjs";

const RAW = [
  { stationuuid: "a1", name: "Kral Pop", url_resolved: "http://kral.example/pop.mp3", homepage: "https://kral.example", favicon: "https://kral.example/logo.png", tags: "pop,türkçe pop", codec: "MP3", bitrate: 128, clickcount: 900, votes: 50 },
  { stationuuid: "a2", name: "KRAL  POP ", url: "http://kral.example/pop2.mp3", clickcount: 10 },
  { stationuuid: "b1", name: "TRT FM", url_resolved: "https://trt.example/fm/master.m3u8", tags: "pop", clickcount: 700 },
  { stationuuid: "c1", name: "Power Türk", url_resolved: "https://power.example/turk", tags: "türkçe pop", clickcount: 800 },
  { stationuuid: "d1", name: "Radyo Rap", url_resolved: "http://rap.example/live", homepage: "www.rap example.com", favicon: "http://rap.example/logo.png", tags: "rap,hiphop", clickcount: 100 },
  { stationuuid: "e1", name: "Bozuk", url_resolved: "ftp://bad.example/x" },
  { stationuuid: "f1", name: "  ", url_resolved: "http://empty.example" },
];

function catalogWith(raw = RAW) {
  const catalog = new RadioCatalog({ file: join(tempDir(), "radio.json") });
  catalog.replace(normalizeStations(raw), Date.now());
  return catalog;
}

test("katalog: Türkçe arama, kopyaları ayıklama ve popülerlik sırası", () => {
  assert.equal(fold("İSTANBUL Şarkı Çağ'ı"), "istanbul sarki cag i");
  const catalog = catalogWith();
  assert.deepEqual(catalog.popular().map((station) => station.name), ["Kral Pop", "Power Türk", "TRT FM", "Radyo Rap"], "bozuk ve adsızlar elenir, kopyadan çok dinlenen kalır");
  assert.equal(catalog.get("a1").url, "http://kral.example/pop.mp3");
  assert.equal(catalog.get("b1").hls, true, "m3u8 HLS olarak tanınır");
  assert.equal(catalog.get("d1").homepage, "", "bozuk ana sayfa adresi panele konmaz (Discord mesajı reddederdi)");
  assert.equal(catalog.get("d1").favicon, "", "logo yalnız https ise gösterilir");
  assert.equal(catalog.search("kral")[0].name, "Kral Pop");
  assert.equal(catalog.search("power turk")[0].name, "Power Türk", "Türkçe harfsiz yazınca da bulur");
  assert.equal(catalog.search("rap")[0].name, "Radyo Rap");
  assert.ok(catalog.search("hiphop").some((station) => station.id === "d1"), "türe göre de arar");
  assert.deepEqual(catalog.search("yok böyle bir radyo"), []);
});

test("katalog: Radio Browser'dan indirir, çalışmayan sunucuyu atlar, diske yazar", async () => {
  const dir = tempDir();
  const asked = [];
  const fetchImpl = async (url) => {
    asked.push(new URL(url).host);
    if (url.includes("bozuk.example")) throw new Error("bağlantı yok");
    const country = url.includes("countrycode=TR");
    return { ok: true, json: async () => (country ? RAW.slice(0, 3) : RAW.slice(3)) };
  };
  const catalog = new RadioCatalog({ file: join(dir, "radio.json"), fetchImpl, lookup: async () => [{ name: "bozuk.example" }] });
  assert.equal(catalog.stale(), true);
  assert.equal(await catalog.refresh(), 4);
  assert.equal(asked[0], "bozuk.example");
  assert.equal(catalog.stale(), false);
  const saved = JSON.parse(readFileSync(join(dir, "radio.json"), "utf8"));
  assert.equal(saved.stations.length, 4);
  const again = new RadioCatalog({ file: join(dir, "radio.json") });
  again.load();
  assert.equal(again.size, 4);
  const failing = new RadioCatalog({ file: join(dir, "x.json"), fetchImpl: async () => { throw new Error("kapalı"); }, lookup: async () => [] });
  await assert.rejects(failing.refresh(), /Radyo listesi alınamadı/);
});

test("ICY şarkı adı: UTF-8 ve Windows-1254 (ı, ş) çözülür", () => {
  assert.equal(parseIcyMetadata(Buffer.from("StreamTitle='Sezen Aksu - Git\\'me';StreamUrl='';\0\0\0")), "Sezen Aksu - Git\\'me");
  assert.equal(parseIcyMetadata(Buffer.from("StreamTitle='Barış Manço - Gülpembe';")), "Barış Manço - Gülpembe");
  const cp1254 = Buffer.concat([Buffer.from("StreamTitle='Bar"), Buffer.from([0xfd, 0xfe]), Buffer.from("';")]);
  assert.equal(parseIcyMetadata(cp1254), "Barış");
  assert.equal(parseIcyMetadata(Buffer.from("StreamTitle='';")), null);
  assert.equal(parseIcyMetadata(Buffer.from("StreamTitle=' - ';")), null);
});

test("ffmpeg argümanları yalnız ağ protokollerine izin verir ve Ogg/Opus üretir", () => {
  const args = ffmpegArgs({ url: "http://kral.example/pop.mp3", hls: false });
  assert.equal(args[args.indexOf("-protocol_whitelist") + 1], "http,https,tcp,tls,crypto");
  assert.equal(args[args.indexOf("-c:a") + 1], "libopus");
  assert.equal(args[args.indexOf("-ar") + 1], "48000");
  assert.ok(args.includes("-reconnect_streamed"));
  assert.ok(!ffmpegArgs({ url: "https://trt.example/a.m3u8", hls: true }).includes("-reconnect_streamed"));
});

/** Yerel sahte radyo: ICY başlıklı sonsuz MP3 akışı ve HLS dosyaları. */
async function fakeRadioServer(dir) {
  const mp3 = join(dir, "ton.mp3");
  spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=4", "-c:a", "libmp3lame", "-b:a", "128k", "-id3v2_version", "0", "-write_xing", "0", mp3]);
  mkdirSync(join(dir, "hls"));
  spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=660:duration=6", "-c:a", "aac", "-b:a", "96k", "-f", "hls", "-hls_time", "2", "-hls_list_size", "0", join(dir, "hls", "radyo.m3u8")]);
  const audio = readFileSync(mp3);
  const METAINT = 8192;
  const server = http.createServer((request, response) => {
    if (request.url.startsWith("/hls/")) {
      try {
        response.end(readFileSync(join(dir, "hls", request.url.slice(5))));
      } catch {
        response.writeHead(404).end();
      }
      return;
    }
    const icy = request.headers["icy-metadata"] === "1" && request.url === "/canli.mp3";
    response.writeHead(200, { "Content-Type": "audio/mpeg", ...(icy ? { "icy-metaint": String(METAINT) } : {}) });
    const title = Buffer.from("StreamTitle='Barış Manço - Gülpembe';");
    const block = Buffer.alloc(Math.ceil(title.length / 16) * 16);
    title.copy(block);
    const meta = Buffer.concat([Buffer.from([block.length / 16]), block]);
    let position = 0;
    let sinceMeta = 0;
    const timer = setInterval(() => {
      for (let sent = 0; sent < 32_768;) {
        if (icy && sinceMeta === METAINT) {
          response.write(meta);
          sinceMeta = 0;
        }
        const size = Math.min(icy ? METAINT - sinceMeta : 4096, audio.length - position, 4096);
        response.write(audio.subarray(position, position + size));
        position = (position + size) % audio.length;
        sinceMeta += size;
        sent += size;
      }
    }, 50);
    const stop = () => clearInterval(timer);
    request.on("close", stop);
    response.on("close", stop);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { server, base: `http://127.0.0.1:${server.address().port}` };
}

async function opusPackets(station, wanted = 25) {
  const child = (await import("node:child_process")).spawn("ffmpeg", ffmpegArgs(station), { stdio: ["ignore", "pipe", "pipe"] });
  const resource = createAudioResource(child.stdout, { inputType: StreamType.OggOpus });
  const packets = [];
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`paket gelmedi (${packets.length})`)), 20_000);
      const take = () => {
        let packet;
        while ((packet = resource.playStream.read()) !== null) {
          packets.push(packet);
          if (packets.length >= wanted) {
            clearTimeout(timer);
            resolve();
            return;
          }
        }
      };
      resource.playStream.on("readable", take);
      child.on("exit", (code) => code && reject(new Error(`ffmpeg ${code}`)));
    });
  } finally {
    child.kill("SIGKILL");
  }
  return packets;
}

test("gerçek akış: ffmpeg MP3 (ICY) ve HLS yayınını Discord'a gidecek Opus paketlerine çevirir", { skip: !checkFfmpeg().ok && "ffmpeg yok", timeout: 60_000 }, async () => {
  const dir = tempDir();
  const { server, base } = await fakeRadioServer(dir);
  try {
    const mp3 = await opusPackets({ url: `${base}/canli.mp3`, hls: false });
    assert.ok(mp3.every((packet) => Buffer.isBuffer(packet) && packet.length > 0 && packet.length < 1500));
    assert.ok(!mp3[0].subarray(0, 8).equals(Buffer.from("OpusHead")), "Ogg başlıkları ayıklanır, yalnız ses paketleri kalır");
    const hls = await opusPackets({ url: `${base}/hls/radyo.m3u8`, hls: true });
    assert.equal(hls.length, 25);
    const title = await readIcyTitle(`${base}/canli.mp3`);
    assert.deepEqual(title, { supported: true, title: "Barış Manço - Gülpembe" });
    assert.deepEqual(await readIcyTitle(`${base}/sessiz.mp3`), { supported: false, title: null }, "şarkı adı göndermeyen istasyon");

    // Gerçek Discord oynatıcısı: dinleyici bağlanmadan da çalmaya geçer, akış kesilince "bitti"ye düşer
    // (oturum yönetimi yeniden bağlanmayı bu duruma göre yapar).
    const child = (await import("node:child_process")).spawn("ffmpeg", ffmpegArgs({ url: `${base}/canli.mp3`, hls: false }), { stdio: ["ignore", "pipe", "pipe"] });
    const player = createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Play } });
    try {
      player.play(createAudioResource(child.stdout, { inputType: StreamType.OggOpus }));
      await entersState(player, AudioPlayerStatus.Playing, 20_000);
      child.kill("SIGKILL");
      await entersState(player, AudioPlayerStatus.Idle, 10_000);
    } finally {
      child.kill("SIGKILL");
      player.stop(true);
    }
  } finally {
    server.close();
  }
});

// ---------- Oturum yönetimi (Discord'suz sahte ses katmanıyla) ----------

function fakeVoice() {
  const VoiceConnectionStatus = { Ready: "ready", Signalling: "signalling", Connecting: "connecting", Disconnected: "disconnected", Destroyed: "destroyed" };
  const AudioPlayerStatus = { Idle: "idle", Buffering: "buffering", Playing: "playing" };
  const state = { joined: [], players: [], connection: null, failOn: null };
  state.voice = {
    VoiceConnectionStatus,
    AudioPlayerStatus,
    NoSubscriberBehavior: { Play: "play" },
    StreamType: { OggOpus: "ogg/opus" },
    joinVoiceChannel(config) {
      state.joined.push(config);
      state.connection ??= Object.assign(new EventEmitter(), {
        state: { status: VoiceConnectionStatus.Ready },
        subscribe(player) { this.player = player; },
        destroy() { this.state.status = VoiceConnectionStatus.Destroyed; this.emit(VoiceConnectionStatus.Destroyed); },
      });
      return state.connection;
    },
    entersState: async (target, status) => {
      if (state.failOn === status) throw new Error("zaman aşımı");
      return target;
    },
    createAudioPlayer() {
      const player = Object.assign(new EventEmitter(), { played: [], play(resource) { this.played.push(resource); }, stop() { this.stopped = true; } });
      state.players.push(player);
      return player;
    },
    createAudioResource: (stream, options) => ({ stream, options }),
  };
  return state;
}

function fakeSpawner() {
  const children = [];
  const spawnImpl = (command, args) => {
    const child = Object.assign(new EventEmitter(), { command, args, stdout: new PassThrough(), stderr: new PassThrough(), exitCode: null, killed: false, kill() { this.killed = true; } });
    children.push(child);
    return child;
  };
  return { children, spawnImpl };
}

const VC = "700000000000000001";
const LISTENER = "100000000000000001";

function fakeGuild(listeners = [LISTENER]) {
  return {
    id: "500000000000000001",
    name: "Test Sunucusu",
    voiceAdapterCreator: () => ({}),
    members: { me: { id: "1" } },
    voiceStates: { cache: new Map(listeners.map((id) => [id, { id, channelId: VC, member: { user: { bot: false } } }])) },
  };
}

function radioFor(catalog, extra = {}) {
  const voice = fakeVoice();
  const spawner = fakeSpawner();
  const updates = [];
  const radio = new RadioService({
    catalog, voice: voice.voice, spawnImpl: spawner.spawnImpl, ffmpeg: { ok: true, reason: "" }, botId: () => "1",
    readTitle: async () => ({ supported: true, title: "Tarkan - Kuzu Kuzu" }),
    onUpdate: (session, event) => updates.push(event),
    ...extra,
  });
  return { radio, voice, spawner, updates };
}

test("radyo oturumu: kanala girer, akışı başlatır, kopunca yeniden bağlanır, boş kanalda çıkar", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  const catalog = catalogWith();
  const { radio, voice, spawner, updates } = radioFor(catalog);
  const guild = fakeGuild();
  const session = await radio.play({ guild, channel: { id: VC }, station: catalog.get("a1"), userId: LISTENER });
  assert.equal(voice.joined[0].channelId, VC);
  assert.equal(voice.joined[0].selfDeaf, true);
  assert.equal(voice.connection.player, session.player, "oynatıcı kanala bağlandı");
  assert.equal(spawner.children[0].args.at(spawner.children[0].args.indexOf("-i") + 1), "http://kral.example/pop.mp3");
  assert.equal(session.player.played[0].options.inputType, "ogg/opus");
  await Promise.resolve();
  assert.equal(session.title, "Tarkan - Kuzu Kuzu", "çalan şarkı okunur");
  assert.ok(updates.some((event) => event.type === "title"));

  // İstasyon değişimi: aynı bağlantı, yeni ffmpeg, eskisi kapatılır.
  await radio.play({ guild, channel: { id: VC }, station: catalog.get("c1"), userId: LISTENER });
  assert.equal(voice.joined.length, 2);
  assert.equal(spawner.children[0].killed, true);
  assert.equal(spawner.children.length, 2);

  // Yayın koptu: kısa beklemeden sonra yeniden bağlanır.
  session.player.emit("idle");
  t.mock.timers.tick(2_000);
  assert.equal(spawner.children.length, 3);

  // Kanalda kimse kalmadı: 2 dakika sonra çıkar.
  guild.voiceStates.cache.clear();
  radio.voiceStateUpdate({ guild }, { guild, id: LISTENER, channelId: null });
  t.mock.timers.tick(119_000);
  assert.ok(radio.session(guild.id));
  t.mock.timers.tick(2_000);
  assert.equal(radio.session(guild.id), null);
  assert.equal(voice.connection.state.status, "destroyed");
  assert.equal(spawner.children.at(-1).killed, true);
  assert.match(updates.at(-1).reason, /kimse kalmadığı/);
});

test("radyo oturumu: açılmayan yayın anlaşılır hata verir ve kanaldan çıkar", async () => {
  const catalog = catalogWith();
  const { radio, voice, spawner } = radioFor(catalog);
  voice.failOn = "playing";
  const guild = fakeGuild();
  await assert.rejects(radio.play({ guild, channel: { id: VC }, station: catalog.get("d1"), userId: LISTENER }), (error) => error instanceof RadioError && /Radyo Rap\*\* yayını şu an açılmıyor/.test(error.message));
  assert.equal(radio.session(guild.id), null);
  assert.equal(spawner.children[0].killed, true);
  const missing = new RadioService({ catalog, voice: voice.voice, ffmpeg: { ok: false, reason: "sunucuda ffmpeg kurulu değil" } });
  await assert.rejects(missing.play({ guild, channel: { id: VC }, station: catalog.get("a1"), userId: LISTENER }), /ffmpeg kurulu değil/);
});

// ---------- /radyo komutu ----------

function radioApp() {
  const { app } = testApp();
  const catalog = catalogWith();
  const parts = radioFor(catalog);
  app.radio = parts.radio;
  return { app, ...parts };
}

function inVoice(interaction, guild = fakeGuild()) {
  interaction.guild = guild;
  interaction.guildId = guild.id;
  interaction.member = { voice: { channelId: VC, channel: { id: VC, type: 2, full: false, permissionsFor: () => ({ has: () => true }) } } };
  return interaction;
}

test("/radyo cal: ses kanalı ister, istasyonu adla bulur ve panel gösterir", async () => {
  const { app } = radioApp();
  const outside = fakeInteraction({ commandName: "radyo", subcommand: "cal", guildId: "500000000000000001", options: { istasyon: "kral" } });
  outside.guild = fakeGuild();
  await handleInteraction(app, outside);
  assert.match(lastText(outside), /Önce bir ses kanalına gir/);

  const play = inVoice(fakeInteraction({ commandName: "radyo", subcommand: "cal", options: { istasyon: "kral" } }));
  await handleInteraction(app, play);
  const panel = play.calls.find((call) => call.type === "editReply").payload;
  assert.equal(panel.embeds[0].title, "Kral Pop");
  assert.match(panel.embeds[0].description, new RegExp(`<#${VC}>`));
  assert.equal(panel.embeds[0].thumbnail.url, "https://kral.example/logo.png");
  assert.equal(panel.components[0].components[0].custom_id, "radio:pick");
  assert.equal(panel.components[1].components[0].custom_id, "radio:stop");
  assert.ok(app.radio.session("500000000000000001"));

  const unknown = inVoice(fakeInteraction({ commandName: "radyo", subcommand: "cal", options: { istasyon: "olmayan radyo" } }));
  await handleInteraction(app, unknown);
  assert.match(lastText(unknown), /bulamadım/);

  const link = inVoice(fakeInteraction({ commandName: "radyo", subcommand: "cal", options: { istasyon: "http://169.254.169.254/latest" } }));
  await handleInteraction(app, link);
  assert.match(lastText(link), /yalnız bot sahibi/, "başkaları kendi bağlantısını çaldıramaz");
});

test("/radyo: boşken popüler menüsü, öneriler ve durdur düğmesi", async () => {
  const { app, updates } = radioApp();
  const picker = inVoice(fakeInteraction({ commandName: "radyo", subcommand: "cal" }));
  await handleInteraction(app, picker);
  const menu = picker.calls[0].payload;
  assert.match(menu.embeds[0].description, /4\*\* Türk radyosu hazır/);
  assert.deepEqual(menu.components[0].components[0].options.map((option) => option.label), ["Kral Pop", "Power Türk", "TRT FM", "Radyo Rap"]);

  const suggest = fakeInteraction({ commandName: "radyo", kind: "autocomplete", options: { focused: "trt" } });
  await handleInteraction(app, suggest);
  assert.deepEqual(suggest.calls[0].payload, [{ name: "TRT FM · pop", value: "b1" }]);

  const pick = inVoice(fakeInteraction({ kind: "select", customId: "radio:pick", values: ["b1"] }));
  await handleInteraction(app, pick);
  assert.equal(pick.calls[0].type, "deferUpdate");
  assert.equal(pick.calls.at(-1).payload.embeds[0].title, "TRT FM");

  const stop = inVoice(fakeInteraction({ kind: "button", customId: "radio:stop" }));
  await handleInteraction(app, stop);
  assert.equal(app.radio.session("500000000000000001"), null);
  assert.match(lastText(stop), /Radyo kapatıldı: \*\*TRT FM/);
  assert.equal(updates.at(-1).type, "stopped");

  const again = inVoice(fakeInteraction({ kind: "button", customId: "radio:stop" }));
  await handleInteraction(app, again);
  assert.match(lastText(again), /zaten kapalı/);
});
