// Basit seviye tabanlı günlük. Token, webhook, API anahtarı ve imzalı indirme
// bağlantıları gibi sırlar satıra yazılmadan önce maskelenir.
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
let threshold = LEVELS.info;
const secrets = new Set();

const PATTERNS = [
  [/[MNO][A-Za-z\d_-]{23,27}\.[A-Za-z\d_-]{6}\.[A-Za-z\d_-]{27,}/g, "[discord-token]"],
  [/discord(?:app)?\.com\/api\/webhooks\/\d+\/[\w-]+/gi, "discord.com/api/webhooks/[gizli]"],
  [/([?&](?:key|token|signature|X-Amz-Signature|Authorization|steamidkey|code)=)[^&\s"]+/gi, "$1[gizli]"],
  [/(Bearer\s+)[\w.-]+/gi, "$1[gizli]"],
  [/\b[A-Z0-9]{4}-[A-Z0-9]{5}-[A-Z0-9]{4}\b/g, "[kimlik-kodu]"],
];

export function setLogLevel(level) {
  threshold = LEVELS[String(level).toLowerCase()] ?? LEVELS.info;
}

export function registerSecret(value) {
  const secret = String(value || "");
  if (secret.length >= 6) secrets.add(secret);
}

export function redact(value) {
  let output = value instanceof Error ? `${value.message}` : typeof value === "string" ? value : safeJson(value);
  for (const secret of secrets) output = output.split(secret).join("[gizli]");
  for (const [pattern, replacement] of PATTERNS) output = output.replace(pattern, replacement);
  return output;
}

function safeJson(value) {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function write(level, scope, message, meta) {
  if (LEVELS[level] < threshold) return;
  const line = `${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} [${scope}] ${redact(message)}${meta === undefined ? "" : ` ${redact(meta)}`}`;
  (level === "error" || level === "warn" ? process.stderr : process.stdout).write(`${line}\n`);
}

export function logger(scope) {
  return {
    debug: (message, meta) => write("debug", scope, message, meta),
    info: (message, meta) => write("info", scope, message, meta),
    warn: (message, meta) => write("warn", scope, message, meta),
    error: (message, meta) => write("error", scope, message, meta),
  };
}
