// Takım planını Discord kanalına taşır: canlı tahta açılınca harita görselli plan
// mesajı, oyun sırasında ise round ve aşama değiştikçe düzenlenen tek bir canlı
// mesaj. Arkadaşların uygulama kurmadan Discord overlay'inden planı takip eder.
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { radarCalibration, radarFraction } from "../radar_calibration.mjs";
import { livePhaseIndex } from "./live.mjs";

const execFileAsync = promisify(execFile);
const RENDER_SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "..", "render_squad_radar.ps1");
const PLAN_IMAGE_NAME = "tracer-takim-plani.png";
const STATE_FILE = "discord_live.json";
const MIN_EDIT_INTERVAL_MS = 2_500;
const ACCENT = 0xc8f54d;

function clean(value, maximum = 1024) {
  const textValue = [...String(value ?? "")]
    .filter((character) => {
      const code = character.codePointAt(0) || 0;
      return code === 9 || code === 10 || code === 13 || (code >= 32 && code !== 127);
    })
    .join("")
    .trim();
  return textValue.length <= maximum ? textValue : `${textValue.slice(0, maximum - 1).trimEnd()}…`;
}

function phaseLines(phase) {
  const lines = [clean(phase.text, 600)];
  for (const item of phase.assignments || []) lines.push(`• **${clean(item.playerName, 40)}** — ${clean(item.text, 160)}`);
  return clean(lines.join("\n"), 1024);
}

function tPlans(report) {
  return (report?.playbook?.roundPlans || []).filter((plan) => plan.side === "T" && plan.phases?.length);
}

/** Harita görseli için dünya koordinatlarını oranlara çevirir. */
export function buildPlanImageModel(report, calibration) {
  const plan = tPlans(report)[0] || null;
  const holds = (report?.tactical?.holds || []).slice(0, 10)
    .map((hold) => ({ ...radarFraction(calibration, hold.x, hold.y), share: hold.share, zone: hold.zone }))
    .filter((item) => Number.isFinite(item.left));
  const markers = [];
  const route = [];
  const targetLane = plan?.phases?.find((phase) => phase.id === "plant")?.markers?.find((marker) => !marker.post)?.lane;
  (plan?.phases || []).forEach((phase, index) => {
    for (const marker of phase.markers || []) {
      const point = radarFraction(calibration, marker.x, marker.y);
      if (!point || markers.some((item) => item.label === marker.zone)) continue;
      const kind = marker.threat ? "threat" : marker.post ? "post" : phase.id === "plant" ? "plant" : "step";
      markers.push({ ...point, kind, label: marker.zone, badge: kind === "threat" ? "!" : kind === "plant" ? "C4" : kind === "post" ? "P" : String(index + 1) });
      if (kind !== "threat" && kind !== "post" && (!targetLane || marker.lane === targetLane)) route.push(point);
    }
  });
  return {
    kicker: `TRACER TAKIM PLANI · ${report?.tactical?.holdRounds || 0} ROUND CT VERİSİ`,
    title: `${report?.mapLabel || report?.map || "Harita"} · ${plan?.title || "Plan"}`,
    subtitle: clean(plan?.goal || "Mavi daireler rakip CT'lerin 20. saniyede bekledikleri yerler.", 140),
    mapImage: calibration?.imagePath || "",
    holds,
    markers,
    route,
    footer: "Konumlar ve yüzdeler analiz edilmiş demolardan hesaplandı. Canlı round mesajı bu kanalda güncellenir.",
  };
}

/** Maç öncesi plan mesajı: CT tutuşları, aşamalı planlar ve T öncelikleri. */
export function buildPlanMessage(report, roster = [], { withImage = false } = {}) {
  const holds = (report?.tactical?.holds || []).slice(0, 8).map((hold) => `**${clean(hold.zone, 40)}** %${hold.share}`).join(" · ");
  const fields = [];
  if (holds) fields.push({ name: "CT nerede bekliyor (20. sn)", value: clean(holds, 1024) });
  for (const plan of tPlans(report).slice(0, 3)) {
    const steps = plan.phases.map((phase, index) => `**${index + 1} · ${clean(phase.label, 40)}** (${phase.window[0]}–${phase.window[1]} sn): ${clean(phase.text, 220)}`).join("\n");
    const evidence = plan.evidence?.winRate !== undefined && plan.evidence?.winRate !== null ? ` · %${plan.evidence.winRate} kazanma, ${plan.evidence.sampleRounds} round` : "";
    fields.push({ name: clean(`${plan.title}${evidence}`, 256), value: clean(steps, 1024) });
  }
  const priorities = (report?.tSide?.cards || []).filter((card) => card.status === "problem").slice(0, 3);
  if (priorities.length) {
    fields.push({ name: "Takımın T öncelikleri", value: clean(priorities.map((card) => `**${card.title}** ${card.value} — ${card.action}`).join("\n"), 1024) });
  }
  const names = (Array.isArray(roster) ? roster : []).map((player) => player?.name).filter(Boolean).join(", ");
  return {
    username: "TRACER Takım Koçu",
    content: "",
    allowed_mentions: { parse: [] },
    embeds: [{
      title: clean(`${report?.mapLabel || report?.map || "Harita"} takım planı`, 256),
      description: clean(`${names ? `Oyuncular: ${names}\n` : ""}Maç boyunca aşağıdaki canlı mesaj her round ve aşamada güncellenir.`, 4000),
      color: ACCENT,
      fields: fields.slice(0, 6),
      ...(withImage ? { image: { url: `attachment://${PLAN_IMAGE_NAME}` } } : {}),
      footer: { text: "TRACER · plan kanıta dayalı başlangıç noktasıdır; canlı maç önceliklidir." },
    }],
  };
}

/** Oyun sırasında düzenlenen tek canlı mesajın içeriği. */
export function buildRoundMessage(report, session, now = Date.now()) {
  const plan = session?.currentPlan || null;
  const score = `CT ${session?.score?.CT ?? 0} : ${session?.score?.T ?? 0} T`;
  const last = (session?.history || []).at(-1);
  const lastLine = last ? `Son round: R${last.round} ${clean(last.title, 80)} → ${last.outcome === "success" ? "işledi" : "işlemedi"}` : "";
  if (!plan) {
    return {
      username: "TRACER Takım Koçu",
      content: "",
      allowed_mentions: { parse: [] },
      embeds: [{
        title: clean(`${report?.mapLabel || "Maç"} · round bekleniyor`, 256),
        description: clean([session?.connected === false ? "CS2 bağlantısı bekleniyor." : "Sonraki round planı freeze time bitince gelir.", lastLine].filter(Boolean).join("\n"), 4000),
        color: 0x5d6b64,
        footer: { text: `${score} · TRACER canlı takım planı` },
      }],
    };
  }
  const active = livePhaseIndex(plan, session?.clock, now);
  const phases = Array.isArray(plan.phases) ? plan.phases : [];
  const fields = phases.length
    ? phases.map((phase, index) => ({
      name: clean(`${index === active ? "▶ ŞİMDİ · " : index < active ? "✓ " : ""}${index + 1} · ${phase.label} · ${phase.window[0]}–${phase.window[1]} sn`, 256),
      value: index === active || active < 0 ? phaseLines(phase) : clean(phase.text, 300),
    }))
    : (plan.tasks || []).slice(0, 5).map((task) => ({ name: clean(`${task.playerName} · ${task.role}`, 256), value: clean(task.text, 1024) }));
  return {
    username: "TRACER Takım Koçu",
    content: "",
    allowed_mentions: { parse: [] },
    embeds: [{
      title: clean(`R${plan.round} · ${plan.side} · ${plan.title}`, 256),
      description: clean([plan.goal, active >= 0 && phases[active] ? `**Şimdi:** ${phases[active].label}` : "", lastLine].filter(Boolean).join("\n"), 4000),
      color: ACCENT,
      fields: fields.slice(0, 6),
      footer: { text: clean(`${score} · ${plan.buyState || ""} · TRACER canlı takım planı`, 2048) },
    }],
  };
}

/** Mesajı yeniden göndermeyi tetikleyen durum anahtarı. */
export function roundMessageKey(session, now = Date.now()) {
  const plan = session?.currentPlan;
  const last = (session?.history || []).at(-1);
  return [
    plan ? `${plan.round}:${plan.id}:${livePhaseIndex(plan, session?.clock, now)}` : "none",
    session?.connected === false ? "offline" : "online",
    last ? `${last.round}:${last.outcome}` : "",
    `${session?.score?.CT ?? 0}-${session?.score?.T ?? 0}`,
  ].join("|");
}

async function renderPlanImage(model, dataDir) {
  const renderDir = join(dataDir, `discord-render-${randomUUID()}`);
  const inputPath = join(renderDir, "plan.json");
  const outputPath = join(renderDir, PLAN_IMAGE_NAME);
  mkdirSync(renderDir, { recursive: true });
  try {
    writeFileSync(inputPath, JSON.stringify(model), "utf8");
    await execFileAsync("powershell.exe", [
      "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
      "-File", RENDER_SCRIPT, "-InputJson", inputPath, "-OutputPng", outputPath,
    ], { windowsHide: true, timeout: 20_000, maxBuffer: 512 * 1024 });
    const image = readFileSync(outputPath);
    if (image.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") throw new Error("Plan görseli geçerli PNG değil.");
    return image;
  } finally {
    rmSync(renderDir, { recursive: true, force: true });
  }
}

export class SquadDiscordLive {
  constructor(dataDir, reporter, { now = () => Date.now(), imageRenderer = null, schedule = setTimeout } = {}) {
    this.dir = join(dataDir, "squads");
    this.statePath = join(this.dir, STATE_FILE);
    this.reporter = reporter;
    this.now = now;
    this.imageRenderer = imageRenderer || ((model) => renderPlanImage(model, dataDir));
    this.scheduleImpl = schedule;
    this.pending = new Map();
    this.inFlight = new Set();
    mkdirSync(this.dir, { recursive: true });
    this.state = this.readState();
  }

  readState() {
    try {
      if (!existsSync(this.statePath)) return {};
      const value = JSON.parse(readFileSync(this.statePath, "utf8"));
      return value && typeof value === "object" && !Array.isArray(value) ? value : {};
    } catch {
      return {};
    }
  }

  persist() {
    const temporary = `${this.statePath}.${process.pid}.tmp`;
    writeFileSync(temporary, JSON.stringify(this.state, null, 2), "utf8");
    renameSync(temporary, this.statePath);
  }

  status(squadId) {
    const entry = this.state[squadId] || {};
    return {
      enabled: entry.enabled === true,
      ready: this.reporter.isReady(),
      planPostedAt: Number(entry.planPostedAt) || 0,
      lastSentAt: Number(entry.lastSentAt) || 0,
      lastError: String(entry.lastError || ""),
    };
  }

  update(squadId, patch) {
    this.state[squadId] = { ...(this.state[squadId] || {}), ...patch };
    this.persist();
    return this.status(squadId);
  }

  async setEnabled(squad, enabled) {
    if (enabled && !this.reporter.isReady()) throw new Error("Önce Bildirimler > Depolama ve Otomasyon ekranından Discord webhook adresini ekleyip gönderimi aç.");
    this.update(squad.id, { enabled: Boolean(enabled), lastError: "" });
    if (enabled) await this.publishPlan(squad);
    return this.status(squad.id);
  }

  /** Plan mesajını görselle gönderir; canlı round mesajı bundan sonra yeniden açılır. */
  async publishPlan(squad) {
    if (!squad?.report) throw new Error("Önce takım raporu oluşturulmalı.");
    let image = null;
    const calibration = radarCalibration(squad.report.map);
    if (calibration?.imagePath && squad.report.tactical?.holdRounds) {
      try {
        image = await this.imageRenderer(buildPlanImageModel(squad.report, calibration));
      } catch (error) {
        this.update(squad.id, { lastError: `Harita görseli oluşturulamadı, plan görselsiz gönderildi: ${clean(error?.message, 200)}` });
      }
    }
    try {
      await this.reporter.sendLiveMessage(buildPlanMessage(squad.report, squad.roster, { withImage: Boolean(image) }), { image, imageName: PLAN_IMAGE_NAME });
      return this.update(squad.id, { planPostedAt: this.now(), roundMessageId: "", lastKey: "", ...(image ? { lastError: "" } : {}) });
    } catch (error) {
      this.update(squad.id, { lastError: clean(error?.message, 300) });
      throw error;
    }
  }

  /** Her GSI güncellemesinden sonra çağrılır; yalnız durum değiştiyse gönderir. */
  notify(squad, session) {
    const entry = this.state[squad?.id];
    if (!entry?.enabled || !session?.active || !this.reporter.isReady()) return;
    const key = roundMessageKey(session, this.now());
    if (key === entry.lastKey && !this.pending.has(squad.id)) return;
    // Bekleyen gönderim varsa yalnız içeriği tazelenir; zamanlayıcı korunur.
    this.pending.set(squad.id, { squad, session, key, timer: this.pending.get(squad.id)?.timer });
    this.flushSoon(squad.id);
  }

  flushSoon(squadId) {
    if (this.inFlight.has(squadId) || this.pending.get(squadId)?.timer) return;
    const wait = Math.max(0, MIN_EDIT_INTERVAL_MS - (this.now() - (Number(this.state[squadId]?.lastSentAt) || 0)));
    const job = this.pending.get(squadId);
    job.timer = this.scheduleImpl(() => { void this.flush(squadId); }, wait);
    if (typeof job.timer?.unref === "function") job.timer.unref();
  }

  async flush(squadId) {
    const job = this.pending.get(squadId);
    if (!job) return;
    this.pending.delete(squadId);
    const entry = this.state[squadId] || {};
    if (job.key === entry.lastKey) return;
    this.inFlight.add(squadId);
    try {
      const message = buildRoundMessage(job.squad.report, job.session, this.now());
      let result;
      try {
        result = await this.reporter.sendLiveMessage(message, { editMessageId: entry.roundMessageId || "" });
      } catch (error) {
        // Mesaj elle silinmişse yeni canlı mesaj açılır.
        if (!entry.roundMessageId || !/bulunamadı/.test(String(error?.message))) throw error;
        result = await this.reporter.sendLiveMessage(message);
      }
      this.update(squadId, { roundMessageId: String(result?.id || entry.roundMessageId || ""), lastKey: job.key, lastSentAt: this.now(), lastError: "" });
    } catch (error) {
      const retryMs = Number(error?.retryAfterMs);
      this.update(squadId, { lastError: clean(error?.message, 300), lastSentAt: this.now() });
      if (Number.isFinite(retryMs) && !this.pending.has(squadId)) {
        this.pending.set(squadId, { ...job, timer: undefined });
      }
    } finally {
      this.inFlight.delete(squadId);
      if (this.pending.has(squadId)) this.flushSoon(squadId);
    }
  }
}
