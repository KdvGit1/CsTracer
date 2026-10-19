// Bot ayarları yalnız ortam değişkenlerinden (veya .env dosyasından) okunur.
// Sırlar hiçbir zaman loglara ya da Discord mesajlarına yazılmaz.
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const BOT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function loadEnvFile() {
  const path = process.env.TRACER_ENV_FILE || join(BOT_ROOT, ".env");
  if (existsSync(path) && typeof process.loadEnvFile === "function") process.loadEnvFile(path);
}

function integer(name, fallback, { min = -Infinity, max = Infinity } = {}) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) throw new Error(`${name} ${min}–${max} arasında tam sayı olmalı.`);
  return parsed;
}

function bool(name, fallback) {
  const raw = String(process.env[name] ?? "").trim().toLowerCase();
  if (!raw) return fallback;
  return ["1", "true", "evet", "yes", "on"].includes(raw);
}

// .env'deki boş satırlar (ör. "DATA_DIR=") ayarlanmamış sayılır ve varsayılan kullanılır.
function text(name, fallback = "") {
  const raw = String(process.env[name] ?? "").trim();
  return raw || String(fallback).trim();
}

function snowflakes(name) {
  return text(name).split(/[\s,]+/).filter((value) => /^\d{16,22}$/.test(value));
}

export function loadConfig({ requireToken = true } = {}) {
  loadEnvFile();
  const dataDir = resolve(text("DATA_DIR", join(BOT_ROOT, "data")));
  mkdirSync(dataDir, { recursive: true });
  const publicUrl = text("PUBLIC_URL").replace(/\/+$/, "");
  if (publicUrl && !/^https?:\/\/[^\s/]+/.test(publicUrl)) throw new Error("PUBLIC_URL http(s):// ile başlamalı.");
  const config = Object.freeze({
    token: text("DISCORD_TOKEN"),
    clientId: text("DISCORD_CLIENT_ID"),
    devGuildId: text("DEV_GUILD_ID"),
    ownerIds: snowflakes("OWNER_IDS"),
    dataDir,
    secretKey: text("BOT_SECRET_KEY"),
    steamApiKey: text("STEAM_API_KEY"),
    steamBot: {
      username: text("STEAM_BOT_USERNAME"),
      password: text("STEAM_BOT_PASSWORD"),
      sharedSecret: text("STEAM_BOT_SHARED_SECRET"),
    },
    faceitApiKey: text("FACEIT_API_KEY"),
    faceitDownloadsToken: text("FACEIT_DOWNLOADS_TOKEN"),
    publicUrl,
    httpPort: integer("HTTP_PORT", 8787, { min: 0, max: 65535 }),
    httpHost: text("HTTP_HOST", "0.0.0.0"),
    maxDemoMb: integer("MAX_DEMO_MB", 800, { min: 50, max: 2048 }),
    analysisConcurrency: integer("ANALYSIS_CONCURRENCY", 1, { min: 1, max: 4 }),
    analysisMemoryMb: integer("ANALYSIS_MEMORY_MB", 6144, { min: 1024, max: 65536 }),
    analysisTimeoutMin: integer("ANALYSIS_TIMEOUT_MIN", 15, { min: 2, max: 120 }),
    keepAnalysesPerUser: integer("KEEP_ANALYSES_PER_USER", 40, { min: 5, max: 500 }),
    keepDemos: bool("KEEP_DEMOS", false),
    freeDailyAnalyses: integer("FREE_DAILY_ANALYSES", 0, { min: 0, max: 1000 }),
    premiumSkuIds: text("PREMIUM_SKU_IDS").split(/[\s,]+/).filter(Boolean),
    supportUrl: text("SUPPORT_URL"),
    trackerIntervalMin: integer("TRACKER_INTERVAL_MIN", 20, { min: 5, max: 1440 }),
    logLevel: text("LOG_LEVEL", "info"),
  });
  if (requireToken && !config.token) throw new Error("DISCORD_TOKEN eksik. .env.example dosyasını .env olarak kopyalayıp doldur.");
  return config;
}

export function features(config) {
  return {
    faceit: Boolean(config.faceitApiKey),
    faceitDownloads: Boolean(config.faceitApiKey && config.faceitDownloadsToken),
    steam: Boolean(config.steamApiKey),
    steamDemos: Boolean(config.steamApiKey && config.steamBot.username && config.steamBot.password),
    web: Boolean(config.publicUrl && config.httpPort),
  };
}
