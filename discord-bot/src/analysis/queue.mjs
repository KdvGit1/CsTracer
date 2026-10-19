// Kalıcı analiz kuyruğu. İşler SQLite'ta tutulur; bot yeniden başlarsa kaldığı
// yerden devam eder. Aynı anda varsayılan olarak tek demo analiz edilir
// (Oracle Always Free ARM için güvenli bellek kullanımı).
import { fork } from "node:child_process";
import { existsSync, mkdirSync, statSync } from "node:fs";
import { rename, rm } from "node:fs/promises";
import { freemem } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { ANALYSIS_VERSION } from "../../engine/companion/analysis_version.mjs";
import { logger } from "../log.mjs";
import { decodeShareCode } from "../services/steam.mjs";
import { DemoError, downloadRaw, normalizeDemoFile } from "./download.mjs";
import { attachPlayerToUser, persistAnalysis, readAnalysis } from "./pipeline.mjs";

const log = logger("queue");
const WORKER = fileURLToPath(new URL("./analyze-process.mjs", import.meta.url));

export const STAGES = {
  queued: "Sırada bekliyor",
  resolving: "Demo bağlantısı alınıyor",
  downloading: "Demo indiriliyor",
  unpacking: "Demo açılıyor ve doğrulanıyor",
  analyzing: "Demo analiz ediliyor (tam maç 1–4 dk sürebilir)",
  saving: "Sonuçlar kaydediliyor",
};

export class AnalysisQueue {
  constructor({ store, config, faceit = null, steam = null, hooks = {} }) {
    this.store = store;
    this.config = config;
    this.faceit = faceit;
    this.steam = steam;
    this.hooks = hooks;
    this.running = new Map();
    this.timer = null;
    this.stopped = false;
    this.tmpDir = join(config.dataDir, "tmp");
    this.analysisDir = join(config.dataDir, "analyses");
    this.demoDir = join(config.dataDir, "demos");
    for (const dir of [this.tmpDir, this.analysisDir, this.demoDir]) mkdirSync(dir, { recursive: true });
  }

  start() {
    const recovered = this.store.recoverJobs();
    if (recovered) log.info(`${recovered} yarım kalan analiz kuyruğa geri alındı.`);
    this.stopped = false;
    this.kick();
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.timer);
    for (const { controller } of this.running.values()) controller.abort();
  }

  enqueue(options) {
    const result = this.store.enqueueJob(options);
    this.kick();
    return { ...result, position: result.job ? this.store.queuePosition(result.job.id) : 0 };
  }

  cancel(jobId, userId) {
    const job = this.store.getJob(jobId);
    if (!job || (userId && job.user_id !== userId)) return false;
    if (job.status === "queued") {
      this.store.updateJob(jobId, { status: "failed", error: "Kullanıcı iptal etti.", finished_at: Date.now() });
      return true;
    }
    const running = this.running.get(Number(jobId));
    if (running) {
      running.controller.abort();
      return true;
    }
    return false;
  }

  kick() {
    if (this.stopped) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.drain(), 50);
  }

  async drain() {
    while (!this.stopped && this.running.size < this.config.analysisConcurrency) {
      const job = this.store.claimNextJob();
      if (!job) break;
      const controller = new AbortController();
      const task = this.process(job, controller.signal).finally(() => {
        this.running.delete(job.id);
        this.kick();
      });
      this.running.set(job.id, { controller, task });
    }
  }

  async progress(job, stage) {
    this.store.updateJob(job.id, { progress: stage });
    try { await this.hooks.onProgress?.(this.store.getJob(job.id), stage); } catch (error) { log.debug("İlerleme bildirimi gönderilemedi", error); }
  }

  analysisPath(matchId) {
    return join(this.analysisDir, `${String(matchId).replace(/[^\w.-]/g, "_")}.json.gz`);
  }

  /** Aynı maçın güncel analizi zaten varsa yeniden indirmeden kullan. */
  reusable(match) {
    return Boolean(match?.analysis_file && match.analysis_version === ANALYSIS_VERSION && existsSync(match.analysis_file));
  }

  /** Kaynağın maç kimliği ağ isteği olmadan biliniyorsa (FACEIT, paylaşım kodu). */
  knownMatchId(source) {
    if (source?.type === "faceit") return source.id || null;
    if (source?.type === "sharecode") {
      try { return `steam_${decodeShareCode(source.shareCode).matchId}`; } catch { return null; }
    }
    return null;
  }

  async resolveSource(job, signal) {
    const source = job.source;
    if (source.type === "url" || source.type === "file") return { ...source };
    if (source.type === "faceit") {
      if (!this.faceit) throw new DemoError("FACEIT bağlantısı bu botta etkin değil.");
      const match = this.store.faceitMatch(source.id);
      if (!match) throw new DemoError("FACEIT maçı bulunamadı; önce /faceit ile geçmişi yenile.");
      const url = await this.faceit.demoUrl(match, signal);
      return { type: "url", url, matchId: match.id, playedAt: match.timestamp, meta: { mode: "FACEIT", faceit: match, faceitUrl: match.faceitUrl }, source: "faceit" };
    }
    if (source.type === "sharecode") {
      if (!this.steam?.canResolveShareCodes()) throw new DemoError("Paylaşım kodundan demo almak için botun Steam hesabı yapılandırılmamış. Demo dosyasını /analiz ile yükleyebilirsin.");
      const resolved = await this.steam.resolveShareCode(source.shareCode, signal);
      return { type: "url", url: resolved.url, matchId: `steam_${resolved.matchId}`, playedAt: resolved.matchTime, meta: { mode: resolved.mode || "Premier / Rekabetçi", shareCode: source.shareCode }, source: "steam" };
    }
    throw new DemoError("Bilinmeyen demo kaynağı.");
  }

  async process(job, signal) {
    const started = Date.now();
    const raw = join(this.tmpDir, `job-${job.id}.raw`);
    const dem = join(this.tmpDir, `job-${job.id}.dem`);
    let keepDemo = false;
    try {
      await this.progress(job, "resolving");
      // Aynı maç (ör. aynı Premier maçını oynayan beş arkadaş) yalnız bir kez analiz edilir.
      const known = this.knownMatchId(job.source);
      const knownMatch = known ? this.store.getMatch(known) : null;
      if (knownMatch && this.reusable(knownMatch)) return await this.finishReused(job, knownMatch);
      const source = await this.resolveSource(job, signal);
      let matchId = source.matchId || null;
      const existing = matchId ? this.store.getMatch(matchId) : null;
      if (existing && this.reusable(existing)) {
        return await this.finishReused(job, existing);
      }

      let origin = source.source || "upload";
      if (source.type === "url") {
        await this.progress(job, "downloading");
        const downloaded = await downloadRaw(source.url, raw, { maxBytes: this.config.maxDemoMb * 1024 * 1024, signal });
        if (!source.source) origin = downloaded.kind === "valve" ? "steam" : downloaded.kind === "faceit" ? "faceit" : "upload";
      } else {
        if (!source.path || !existsSync(source.path)) throw new DemoError("Yüklenen dosya sunucuda bulunamadı (bot yeniden başlamış olabilir). /analiz ile yeni bağlantı alıp tekrar yükle.");
        await rename(source.path, raw);
      }
      await this.progress(job, "unpacking");
      const demo = await normalizeDemoFile(raw, dem, { maxBytes: this.config.maxDemoMb * 1024 * 1024, signal });
      const bySha = this.store.matchBySha(demo.sha256);
      if (bySha && this.reusable(bySha)) return await this.finishReused(job, bySha);
      matchId = matchId || bySha?.id || `demo_${demo.sha256.slice(0, 20)}`;

      await this.progress(job, "analyzing");
      const memoryGb = freemem() / 1024 ** 3;
      if (memoryGb < 1.2) log.warn(`Boş bellek düşük (${memoryGb.toFixed(1)} GB); analiz yine de deneniyor.`);
      const outPath = this.analysisPath(matchId);
      const stats = await this.runWorker(dem, `${outPath}.part`, signal);
      await rename(`${outPath}.part`, outPath);

      await this.progress(job, "saving");
      const analysis = readAnalysis(outPath);
      const playedAt = source.playedAt || (Number(source.lastModified) > 1 ? Number(source.lastModified) : job.created_at);
      const result = persistAnalysis({
        store: this.store,
        matchId,
        source: origin,
        analysis,
        analysisFile: outPath,
        sha256: bySha && bySha.id !== matchId ? null : demo.sha256,
        playedAt,
        meta: { mode: "CS2", fileName: source.fileName || "", dateSource: source.playedAt ? "source" : Number(source.lastModified) > 1 ? "file" : "upload", ...(source.meta || {}) },
        requesterId: job.user_id,
        playerHint: job.player_hint,
      });
      if (source.meta?.faceit?.id) this.store.markFaceitAnalyzed(source.meta.faceit.id, matchId);
      if (this.config.keepDemos) {
        await rename(dem, join(this.demoDir, `${matchId}.dem`));
        keepDemo = true;
      }
      this.store.updateJob(job.id, { status: "done", match_id: matchId, finished_at: Date.now(), progress: "done" });
      log.info(`İş #${job.id} tamamlandı: ${matchId} (${Math.round((Date.now() - started) / 1000)} sn, analiz ${Math.round(stats.durationMs / 1000)} sn)`);
      await this.safeHook("onDone", this.store.getJob(job.id), { ...result, analysis, reused: false });
    } catch (error) {
      const known = error instanceof DemoError || Boolean(error?.userFacing);
      const message = signal.aborted ? "Analiz iptal edildi." : known ? error.message : `Beklenmeyen hata: ${error?.message || error}`;
      if (!known && !signal.aborted) log.error(`İş #${job.id} başarısız`, error?.stack || error);
      this.store.updateJob(job.id, { status: "failed", error: message, finished_at: Date.now() });
      await this.safeHook("onFailed", this.store.getJob(job.id), { message, retryable: Boolean(error?.retryable) });
    } finally {
      await rm(raw, { force: true });
      if (!keepDemo) await rm(dem, { force: true });
      if (job.source?.type === "file" && job.source.path) await rm(job.source.path, { force: true });
    }
  }

  async finishReused(job, match) {
    await this.progress(job, "saving");
    const analysis = readAnalysis(match.analysis_file);
    const requester = this.store.getUser(job.user_id);
    let requesterReport = null;
    if (requester?.steam_id) requesterReport = attachPlayerToUser({ store: this.store, match, analysis, userId: job.user_id, steamid: requester.steam_id });
    if (!requesterReport && job.player_hint) requesterReport = attachPlayerToUser({ store: this.store, match, analysis, userId: job.user_id, steamid: job.player_hint });
    this.store.updateJob(job.id, { status: "done", match_id: match.id, finished_at: Date.now(), progress: "done" });
    await this.safeHook("onDone", this.store.getJob(job.id), { match, analysis, participants: [], requesterReport, needsPlayerChoice: !requesterReport, reused: true });
  }

  async safeHook(name, ...args) {
    try { await this.hooks[name]?.(...args); } catch (error) { log.warn(`${name} bildirimi başarısız`, error?.stack || error); }
  }

  runWorker(demoPath, outPath, signal) {
    return new Promise((resolve, reject) => {
      const child = fork(WORKER, [], {
        execArgv: [`--max-old-space-size=${this.config.analysisMemoryMb}`, "--disable-warning=ExperimentalWarning"],
        stdio: ["ignore", "inherit", "inherit", "ipc"],
      });
      let settled = false;
      const finish = (error, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal.removeEventListener("abort", onAbort);
        if (child.exitCode === null) child.kill("SIGKILL");
        if (error) reject(error); else resolve(value);
      };
      const onAbort = () => finish(new DemoError("Analiz iptal edildi."));
      const timer = setTimeout(() => finish(new DemoError(`Analiz ${this.config.analysisTimeoutMin} dakikada bitmedi; demo çok büyük olabilir.`)), this.config.analysisTimeoutMin * 60_000);
      signal.addEventListener("abort", onAbort, { once: true });
      child.once("message", (message) => {
        if (message?.ok && existsSync(outPath) && statSync(outPath).size > 0) finish(null, message);
        else finish(new DemoError(message?.error || "Analiz sonucu yazılamadı."));
      });
      child.once("exit", (code, exitSignal) => {
        if (!settled) finish(new DemoError(exitSignal === "SIGKILL" || code === 137 ? "Analiz süreci bellek yetersizliğinden kapatıldı. Sunucuda en az 4 GB boş RAM gerekir." : `Analiz süreci beklenmedik biçimde kapandı (${exitSignal || code}).`));
      });
      child.send({ demoPath, outPath });
    });
  }
}
