// Ayrı süreçte çalışan PNG çizici. resvg (Rust) beklenmedik bir veride çökerse
// yalnız bu süreç ölür; bot çalışmaya devam eder ve çizici yeniden başlatılır.
import { renderPng } from "./png.mjs";

process.on("message", async (message) => {
  if (!message || typeof message !== "object" || typeof message.svg !== "string") return;
  try {
    const png = await renderPng(message.svg, { width: message.width || 0 });
    process.send({ id: message.id, ok: true, png });
  } catch (error) {
    process.send({ id: message.id, ok: false, error: error instanceof Error ? error.message : String(error) });
  }
});

process.on("disconnect", () => process.exit(0));
