// Kart SVG'lerini ayrı bir çizim sürecinde PNG'ye çevirir. Süreç ölürse bekleyen
// istekler hata ile döner ve sonraki istekte yeni süreç açılır.
import { fork } from "node:child_process";
import { fileURLToPath } from "node:url";
import { logger } from "../log.mjs";
import { renderPng } from "./png.mjs";

const log = logger("render");
const WORKER = fileURLToPath(new URL("./render-worker.mjs", import.meta.url));
const TIMEOUT_MS = 30_000;

export class Renderer {
  constructor({ inProcess = false } = {}) {
    this.inProcess = inProcess;
    this.child = null;
    this.pending = new Map();
    this.sequence = 0;
  }

  ensureChild() {
    if (this.child && this.child.connected) return this.child;
    const child = fork(WORKER, [], { serialization: "advanced", stdio: ["ignore", "inherit", "inherit", "ipc"], execArgv: ["--max-old-space-size=512"] });
    child.on("message", (message) => {
      const request = this.pending.get(message?.id);
      if (!request) return;
      this.pending.delete(message.id);
      clearTimeout(request.timer);
      if (message.ok) request.resolve(Buffer.from(message.png));
      else request.reject(new Error(message.error || "Görsel oluşturulamadı."));
    });
    child.on("exit", (code, signal) => {
      if (this.child === child) this.child = null;
      if (this.pending.size) log.warn(`Çizim süreci kapandı (${signal || code}); ${this.pending.size} istek iptal edildi.`);
      for (const [id, request] of this.pending) {
        clearTimeout(request.timer);
        request.reject(new Error("Görsel oluşturulurken çizici beklenmedik biçimde kapandı."));
        this.pending.delete(id);
      }
    });
    this.child = child;
    return child;
  }

  render(svg, { width = 0 } = {}) {
    if (this.inProcess) return renderPng(svg, { width });
    const child = this.ensureChild();
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("Görsel oluşturma zaman aşımına uğradı."));
        child.kill("SIGKILL");
      }, TIMEOUT_MS);
      this.pending.set(id, { resolve, reject, timer });
      child.send({ id, svg, width });
    });
  }

  close() {
    this.child?.kill();
    this.child = null;
  }
}
