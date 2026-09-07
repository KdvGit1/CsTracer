import { mkdirSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { renderDiscordReportPng, sampleReportImageModel } from "../companion/discord_reporter.mjs";

// Synthetic fixture only; this command never sends a Discord message.
const target = resolve("work/discord-design");
mkdirSync(target, { recursive: true });
const name = process.argv[2] || "preview";
if (!/^[a-z0-9-]+$/.test(name)) throw new Error("Invalid preview name");
const model = sampleReportImageModel();
if (name === "edge") {
  model.ownRows = [{ ...model.ownRows[0], name: "Çığlık_Şampiyonu_İstanbul_😀_".repeat(8), note: "Ölçüm eksik. ".repeat(40), kast: "—", kastColor: null, spray: "—", duel: "—" }];
  model.opponentRows = [];
  model.ownSummary = "1 oyuncu · KAST ölçülemedi";
  model.opponentSummary = "Rakip özeti yok";
}
const png = await renderDiscordReportPng(model, target);
const file = join(target, `${name}.png`);
writeFileSync(file, png);
console.log(file);
