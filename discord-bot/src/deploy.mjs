// Slash komutlarını Discord'a kaydeder. DEV_GUILD_ID varsa yalnız o sunucuya
// (anında görünür), yoksa global olarak (yayılması birkaç dakika sürebilir).
import { createHash } from "node:crypto";
import { REST, Routes } from "discord.js";
import { allCommands } from "./bot/commands.mjs";

export function commandsHash() {
  return createHash("sha256").update(JSON.stringify(allCommands())).digest("hex").slice(0, 16);
}

export async function deployCommands({ token, clientId, devGuildId = "" }) {
  if (!token || !clientId) throw new Error("Komut kaydı için DISCORD_TOKEN ve DISCORD_CLIENT_ID gerekli.");
  const rest = new REST({ version: "10" }).setToken(token);
  const route = devGuildId ? Routes.applicationGuildCommands(clientId, devGuildId) : Routes.applicationCommands(clientId);
  const result = await rest.put(route, { body: allCommands() });
  return { count: Array.isArray(result) ? result.length : 0, scope: devGuildId ? `sunucu ${devGuildId}` : "global" };
}
