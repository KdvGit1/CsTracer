// Kalıcı olarak saklanan kullanıcı sırları (Steam maç geçmişi kimlik kodu gibi)
// AES-256-GCM ile şifrelenir. Anahtar BOT_SECRET_KEY'den türetilir; yoksa ilk
// açılışta veri klasöründe yalnız sahibinin okuyabileceği bir anahtar üretilir.
import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const PREFIX = "v1:";

export function loadSecretKey(config) {
  if (config.secretKey) return createHash("sha256").update(`tracer-bot:${config.secretKey}`).digest();
  const path = join(config.dataDir, "secret.key");
  if (!existsSync(path)) {
    writeFileSync(path, randomBytes(32).toString("base64"), { mode: 0o600 });
  }
  try { chmodSync(path, 0o600); } catch { /* Windows */ }
  const raw = Buffer.from(readFileSync(path, "utf8").trim(), "base64");
  if (raw.length !== 32) throw new Error("data/secret.key bozuk; dosyayı silmek kayıtlı Steam kimlik kodlarını geçersiz kılar.");
  return raw;
}

export function encrypt(key, plainText) {
  const value = String(plainText ?? "");
  if (!value) return null;
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return PREFIX + Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64");
}

export function decrypt(key, stored) {
  const value = String(stored || "");
  if (!value) return "";
  if (!value.startsWith(PREFIX)) throw new Error("Şifreli değer biçimi tanınmadı.");
  const raw = Buffer.from(value.slice(PREFIX.length), "base64");
  const decipher = createDecipheriv("aes-256-gcm", key, raw.subarray(0, 12));
  decipher.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8");
}

export function randomToken(bytes = 24) {
  return randomBytes(bytes).toString("base64url");
}

export function hashToken(token) {
  return createHash("sha256").update(String(token || "")).digest("hex");
}

export function safeEqual(left, right) {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  return a.length === b.length && timingSafeEqual(a, b);
}
