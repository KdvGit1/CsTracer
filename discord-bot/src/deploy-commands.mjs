// Elle komut kaydı: `npm run deploy-commands`
import { loadConfig } from "./config.mjs";
import { deployCommands } from "./deploy.mjs";

const config = loadConfig();
const result = await deployCommands(config);
console.log(`${result.count} komut kaydedildi (${result.scope}).`);
