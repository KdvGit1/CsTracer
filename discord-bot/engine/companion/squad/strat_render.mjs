// Strateji görseli ve Discord mesajı. Görsel uygulamadaki önizleme ile
// Discord'a gönderilen PNG için aynıdır.
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { radarCalibration, radarFraction } from "../radar_calibration.mjs";

const execFileAsync = promisify(execFile);
const RENDER_SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "..", "render_strat.ps1");
export const STRAT_IMAGE_NAME = "tracer-t-taktigi.png";
const UTILITY_WORD = { smoke: "Smoke", molotov: "Molotov", flash: "Flash", he: "HE" };

function clean(value, maximum = 1024) {
  const text = String(value ?? "").trim();
  return text.length <= maximum ? text : `${text.slice(0, maximum - 1).trimEnd()}…`;
}

export function buildStrategyImageModel(strategy, { map, mapLabel = "" } = {}) {
  const calibration = radarCalibration(map);
  const project = (item) => (item ? radarFraction(calibration, item.x, item.y) : null);
  const withFraction = (item, extra = {}) => {
    const fraction = project(item);
    return fraction ? { ...fraction, ...extra } : null;
  };
  return {
    kicker: `TRACER T TAKTİĞİ · ${strategy.evidence?.samples || 0} TAKIM GİRİŞİ · %${strategy.evidence?.winRate ?? "—"} KAZANMA`,
    title: `${mapLabel || map} · ${strategy.title}`,
    subtitle: `${strategy.summary} Utility ${strategy.timing.utility}. sn, giriş ${strategy.timing.execute}. sn, kurulum en geç ${strategy.timing.plantBy}. sn.`,
    mapImage: calibration?.imagePath || "",
    angles: (strategy.angles || []).map((angle) => withFraction(angle, { share: angle.share })).filter(Boolean),
    players: strategy.players.map((player) => ({
      name: player.name,
      role: player.role,
      color: player.color,
      task: player.task,
      path: player.path.map((step) => project(step)).filter(Boolean),
    })).filter((player) => player.path.length),
    utility: (strategy.utility || []).map((item) => withFraction(item, { kind: item.kind, time: item.time, thrower: item.thrower, throwerColor: item.throwerColor || "#EEF3F0" })).filter(Boolean),
    plant: withFraction(strategy.plant),
    footer: "Mavi daireler rakip CT'lerin 20. saniyede durduğu açılar (analiz edilmiş maçlarından). Rotalar ve roller oyuncuların kendi T geçmişinden seçildi.",
  };
}

export async function renderStrategyPng(model, dataDir) {
  const renderDir = join(dataDir, `strat-render-${randomUUID()}`);
  const inputPath = join(renderDir, "strat.json");
  const outputPath = join(renderDir, STRAT_IMAGE_NAME);
  mkdirSync(renderDir, { recursive: true });
  try {
    writeFileSync(inputPath, JSON.stringify(model), "utf8");
    await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", RENDER_SCRIPT, "-InputJson", inputPath, "-OutputPng", outputPath], { windowsHide: true, timeout: 25_000, maxBuffer: 512 * 1024 });
    const image = readFileSync(outputPath);
    if (image.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") throw new Error("Taktik görseli geçerli PNG değil.");
    return image;
  } finally {
    rmSync(renderDir, { recursive: true, force: true });
  }
}

/** Discord mesajı: görsel + kim ne yapacak + utility zaman çizelgesi. */
export function buildStrategyMessage(strategy, { mapLabel = "", withImage = true, approvedBy = "" } = {}) {
  const players = strategy.players.map((player, index) => `**${index + 1}. ${clean(player.name, 40)}** · ${player.role}\n${clean(player.task, 220)}`).join("\n");
  const utility = [...(strategy.utility || [])]
    .sort((a, b) => a.time - b.time)
    .map((item) => `\`${String(item.time).padStart(2, " ")} sn\` ${UTILITY_WORD[item.kind] || item.kind} → ${clean(item.label, 70)} · **${clean(item.thrower || "—", 30)}**`)
    .join("\n");
  const angles = (strategy.angles || []).map((angle) => `${angle.zone} ${angle.side} (CT %${angle.share})`).join(" · ");
  const trade = strategy.players.find((player) => player.slot === "entry") && strategy.players.find((player) => player.slot === "trader")
    ? `${strategy.players.find((player) => player.slot === "entry").name} girer, ${strategy.players.find((player) => player.slot === "trader").name} takaslar.`
    : "";
  const fields = [
    { name: "Kim ne yapacak", value: clean(players, 1024) },
    ...(utility ? [{ name: "Utility zamanlaması", value: clean(utility, 1024) }] : []),
    { name: "Zamanlama", value: clean(`0–20 sn alanı al · ${strategy.timing.utility}. sn utility · **${strategy.timing.execute}. sn giriş** · en geç ${strategy.timing.plantBy}. sn kurulum${trade ? `\nTakas çifti: ${trade}` : ""}`, 1024) },
    ...(angles ? [{ name: "Sitede CT'nin beklediği açılar", value: clean(angles, 1024) }] : []),
  ];
  return {
    username: "TRACER Takım Koçu",
    content: "",
    allowed_mentions: { parse: [] },
    embeds: [{
      title: clean(`${mapLabel ? `${mapLabel} · ` : ""}T taktiği: ${strategy.title}`, 256),
      description: clean(`${strategy.summary}${approvedBy ? `\nOnaylayan: ${approvedBy}` : ""}`, 4000),
      color: 0xc8f54d,
      fields,
      ...(withImage ? { image: { url: `attachment://${STRAT_IMAGE_NAME}` } } : {}),
      footer: { text: `TRACER · ${strategy.evidence?.samples || 0} takım girişi, %${strategy.evidence?.winRate ?? "—"} kazanma verisinden` },
    }],
  };
}
