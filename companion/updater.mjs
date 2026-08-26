import { existsSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { mkdir, rm, readFile, readdir } from "node:fs/promises";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { randomUUID, createHash } from "node:crypto";
import { spawnSync, spawn } from "node:child_process";
import { pipeline } from "node:stream/promises";
import { createWriteStream } from "node:fs";
import { Transform } from "node:stream";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
export const CURRENT_VERSION = "0.49.0";

// Zip-bomb / disk doldurma koruması: indirilebilir maksimum yama boyutu
const MAX_PATCH_BYTES = 100 * 1024 * 1024;
// Yalnızca GitHub release asset'lerinden indirmeye izin ver
const ALLOWED_DOWNLOAD_HOSTS = new Set(["github.com", "api.github.com", "objects.githubusercontent.com", "release-assets.githubusercontent.com"]);
// Yama uygulanırken asla üzerine yazılmayacak yollar (oyuncu verileri ve çalışma ortamı)
const PROTECTED_PATHS = ["data", "model", "runtime", "node_modules", ".git"];

export function getLocalVersionInfo() {
  const versionFile = join(ROOT, "version.json");
  if (existsSync(versionFile)) {
    try {
      const data = JSON.parse(readFileSync(versionFile, "utf8"));
      if (data && data.version) return data;
    } catch { /* ignore */ }
  }
  return {
    version: CURRENT_VERSION,
    releaseDate: "2026-08-23",
    title: `TRACER v${CURRENT_VERSION}`,
    githubRepo: "KdvGit1/CsTracer",
  };
}

export function saveLocalVersionInfo(data) {
  const versionFile = join(ROOT, "version.json");
  try {
    const current = getLocalVersionInfo();
    const merged = { ...current, ...data };
    // Atomik yazma: önce temp dosyaya, sonra rename (crash'te bozuk version.json kalmaz)
    const tmpFile = join(ROOT, `version.json.${randomUUID()}.tmp`);
    writeFileSync(tmpFile, JSON.stringify(merged, null, 2), "utf8");
    renameSync(tmpFile, versionFile);
    return merged;
  } catch {
    return null;
  }
}

function compareSemver(v1, v2) {
  const p1 = String(v1).replace(/^v/, "").split(".").map((n) => Number.parseInt(n, 10) || 0);
  const p2 = String(v2).replace(/^v/, "").split(".").map((n) => Number.parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    const a = p1[i] || 0;
    const b = p2[i] || 0;
    if (a > b) return 1;
    if (a < b) return -1;
  }
  return 0;
}

function isAllowedDownloadUrl(rawUrl) {
  try {
    const u = new URL(rawUrl);
    if (u.protocol !== "https:") return false;
    return ALLOWED_DOWNLOAD_HOSTS.has(u.hostname);
  } catch {
    return false;
  }
}

export function selectPatchAsset(assets, remoteVersion = "") {
  const list = Array.isArray(assets) ? assets : [];
  const version = String(remoteVersion || "").replace(/^v/i, "").toLowerCase();
  const exactName = version ? `tracer-patch-v${version}.zip` : "";
  return list.find((asset) => String(asset?.name || "").toLowerCase() === exactName)
    || list.find((asset) => {
      const name = String(asset?.name || "").toLowerCase();
      return /patch/i.test(name) && /\.zip$/i.test(name) && (!version || name.includes(`v${version}`));
    })
    || null;
}

async function sha256File(filePath) {
  const buf = await readFile(filePath);
  return createHash("sha256").update(buf).digest("hex");
}

export async function checkForUpdates(customRepo) {
  const local = getLocalVersionInfo();
  const repo = (customRepo || local.githubRepo || "").trim().replace(/^https?:\/\/github\.com\//, "");

  if (!repo || !repo.includes("/")) {
    return {
      hasUpdate: false,
      currentVersion: local.version,
      latestVersion: local.version,
      githubRepo: repo,
      configured: false,
      message: "GitHub repository tanımlı değil. Lütfen 'kullanici/repo' formatında belirtin.",
    };
  }

  try {
    // 1. Check GitHub Releases API for the latest release
    const apiUrl = `https://api.github.com/repos/${repo}/releases/latest`;
    const res = await fetch(apiUrl, {
      headers: {
        "Accept": "application/vnd.github.v3+json",
        "User-Agent": `TRACER-CS2-Coach/${local.version}`,
      },
      signal: AbortSignal.timeout(8000),
    });

    if (res.status === 404) {
      return {
        hasUpdate: false,
        currentVersion: local.version,
        latestVersion: local.version,
        githubRepo: repo,
        configured: true,
        message: `'${repo}' reposunda henüz yayınlanmış (Release) bir sürüm bulunamadı.`,
      };
    }

    if (!res.ok) {
      throw new Error(`GitHub API yanıt vermedi (${res.status}).`);
    }

    const release = await res.json();
    const remoteVersion = String(release.tag_name || release.name || "").replace(/^v/, "");
    const isNewer = compareSemver(remoteVersion, local.version) > 0;

    // Find the patch zip asset in the release assets
    const assets = Array.isArray(release.assets) ? release.assets : [];
    // Aynı release'te 1.6+ GB tam portable ve küçük patch birlikte bulunur.
    // Güncelleyici asla ilk ZIP'i rastgele seçmemeli; yalnız TRACER patch'i uygulanır.
    const patchAsset = selectPatchAsset(assets, remoteVersion);

    const patchUrl = patchAsset?.browser_download_url || "";
    // GitHub API asset digest'i (örn. "sha256:...") — bütünlük doğrulaması için
    const digest = typeof patchAsset?.digest === "string" && patchAsset.digest.startsWith("sha256:")
      ? patchAsset.digest.slice("sha256:".length)
      : null;
    const sizeBytes = typeof patchAsset?.size === "number" ? patchAsset.size : null;
    const sizeMb = sizeBytes ? `~${Math.round(sizeBytes / (1024 * 1024) * 10) / 10} MB` : "";

    // Split markdown body into changelog items
    const bodyLines = String(release.body || "")
      .split("\n")
      .map((line) => line.trim().replace(/^[-*•]\s*/, ""))
      .filter((line) => line.length > 0 && !line.startsWith("#"));

    return {
      hasUpdate: isNewer,
      currentVersion: local.version,
      latestVersion: remoteVersion,
      title: release.name || `TRACER v${remoteVersion}`,
      releaseDate: release.published_at ? release.published_at.slice(0, 10) : "",
      changelog: bodyLines.length > 0 ? bodyLines : ["Hata düzeltmeleri ve performans iyileştirmeleri."],
      patchUrl,
      expectedSha256: digest,
      sizeMb,
      githubRepo: repo,
      configured: true,
      htmlUrl: release.html_url || "",
      message: isNewer && !patchAsset
        ? "Yeni sürüm yayınlanmış ancak TRACER Windows yama dosyası henüz eklenmemiş."
        : "",
    };
  } catch (err) {
    return {
      hasUpdate: false,
      currentVersion: local.version,
      latestVersion: local.version,
      githubRepo: repo,
      configured: true,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function downloadAndApplyPatch(patchUrl, options = {}) {
  if (!patchUrl) throw new Error("Yama indirme bağlantısı (patchUrl) bulunamadı.");
  if (!isAllowedDownloadUrl(patchUrl)) {
    throw new Error("Güvenlik: Yalnızca GitHub üzerinden yama indirilebilir.");
  }

  const local = getLocalVersionInfo();
  const workDir = join(tmpdir(), "tracer-update");
  const tempZipPath = join(workDir, `tracer-patch-${randomUUID()}.zip`);
  const extractDir = join(workDir, `extracted-${randomUUID()}`);
  const backupDir = join(workDir, `backup-${randomUUID()}`);
  const expectedSha256 = typeof options.expectedSha256 === "string" ? options.expectedSha256 : null;

  console.log(`[UPDATER] Yeni yama indiriliyor: ${patchUrl}`);

  try {
    await mkdir(workDir, { recursive: true });

    // 1. Yama ZIP'ini indir (redirect takibi + boyut limiti)
    const res = await fetch(patchUrl, {
      headers: { "User-Agent": `TRACER-CS2-Coach/${local.version}` },
      redirect: "follow",
      signal: AbortSignal.timeout(120000),
    });

    if (!res.ok || !res.body) {
      throw new Error(`Yama dosyası indirilemedi (${res.status}).`);
    }

    const contentLength = Number(res.headers.get("content-length") || 0);
    if (contentLength > MAX_PATCH_BYTES) {
      throw new Error("Yama dosyası çok büyük (100 MB üzeri). İndirme iptal edildi.");
    }

    let downloaded = 0;
    const limiter = new Transform({
      transform(chunk, _enc, cb) {
        downloaded += chunk.length;
        if (downloaded > MAX_PATCH_BYTES) {
          cb(new Error("Yama dosyası boyut limiti aşıldı (100 MB)."));
          return;
        }
        cb(null, chunk);
      },
    });
    await pipeline(res.body, limiter, createWriteStream(tempZipPath));
    console.log("[UPDATER] Yama zip dosyası başarıyla indirildi.");

    // 2. SHA-256 bütünlük doğrulaması (GitHub asset digest'i mevcutsa zorunlu)
    if (expectedSha256) {
      const actual = await sha256File(tempZipPath);
      if (actual.toLowerCase() !== expectedSha256.toLowerCase()) {
        throw new Error("Yama bütünlük doğrulaması BAŞARISIZ (SHA-256 uyuşmazlığı). Dosya bozuk veya değiştirilmiş olabilir; uygulama güncellenmedi.");
      }
      console.log("[UPDATER] SHA-256 bütünlük doğrulaması başarılı.");
    } else {
      console.warn("[UPDATER] Uyarı: Release asset'i için SHA-256 digest bulunamadı; bütünlük doğrulaması atlandı.");
    }

    // 3. Expand-Archive ile geçici dizine aç (zip-slip korumalı, sıfır bağımlılık)
    await mkdir(extractDir, { recursive: true });
    const extractResult = spawnSync("powershell.exe", [
      "-NoProfile",
      "-ExecutionPolicy", "Bypass",
      "-Command",
      `Expand-Archive -LiteralPath '${tempZipPath}' -DestinationPath '${extractDir}' -Force`
    ], { windowsHide: true, timeout: 60000 });

    if (extractResult.status !== 0) {
      const err = extractResult.stderr?.toString("utf8") || "Arşiv açılamadı.";
      console.error("[UPDATER] Expand-Archive hatası:", err);
      throw new Error("Yama arşivi açılamadı: " + err);
    }
    console.log("[UPDATER] Yama dosyaları geçici dizine açıldı.");

    // 4. Yedek al (rollback noktası) — yamanın değiştireceği kök seviye öğeleri kopyala
    await mkdir(backupDir, { recursive: true });
    const extractedTop = await readdir(extractDir, { withFileTypes: true });
    for (const entry of extractedTop) {
      if (PROTECTED_PATHS.includes(entry.name)) continue;
      const existing = join(ROOT, entry.name);
      if (existsSync(existing)) {
        const cp = spawnSync("robocopy.exe", [
          `"${existing}"`, `"${join(backupDir, entry.name)}"`,
          ...(entry.isDirectory() ? ["/E"] : []),
          "/NFL", "/NDL", "/NJH", "/NJS", "/NC", "/NS", "/R:1", "/W:1",
        ], { windowsHide: true, timeout: 120000 });
        if (cp.status === null || cp.status >= 8) {
          throw new Error("Yedekleme başarısız oldu; güvenlik için yama uygulanmadı.");
        }
      }
    }
    console.log("[UPDATER] Mevcut dosyalar yedeklendi (geri alma noktası oluşturuldu).");

    // 5. Korumalı yolları hariç tutarak ROOT'a uygula (robocopy /XD ile)
    const excludeDirs = PROTECTED_PATHS.map((p) => `"${join(extractDir, p)}"`);
    const copyResult = spawnSync("robocopy.exe", [
      `"${extractDir}"`, `"${ROOT}"`, "/E", "/NFL", "/NDL", "/NJH", "/NJS", "/NC", "/NS", "/R:2", "/W:2",
      "/XD", ...excludeDirs,
    ], { windowsHide: true, timeout: 180000 });

    // robocopy çıkış kodları: 0-7 başarı, >=8 hata
    if (copyResult.status === null || copyResult.status >= 8) {
      // ROLLBACK — yedeği geri yükle
      console.error("[UPDATER] Kopyalama başarısız, önceki sürüme geri dönülüyor...");
      spawnSync("robocopy.exe", [
        `"${backupDir}"`, `"${ROOT}"`, "/E", "/NFL", "/NDL", "/NJH", "/NJS", "/NC", "/NS", "/R:2", "/W:2",
      ], { windowsHide: true, timeout: 180000 });
      throw new Error("Yama dosyaları uygulanamadı; önceki sürüme otomatik geri dönüldü.");
    }

    const updatedLocal = getLocalVersionInfo();
    console.log(`[UPDATER] Yama başarıyla uygulandı! Yeni aktif sürüm: v${updatedLocal.version}`);

    return {
      ok: true,
      newVersion: updatedLocal.version,
      needsRestart: true,
      message: `Yama başarıyla uygulandı (v${updatedLocal.version})! Değişikliklerin etkinleşmesi için TRACER yeniden başlatılacak...`,
    };
  } catch (err) {
    console.error("[UPDATER] Yama uygulama hatası:", err);
    throw err;
  } finally {
    // Geçici dosyaları temizle
    await rm(tempZipPath, { force: true }).catch(() => {});
    await rm(extractDir, { recursive: true, force: true }).catch(() => {});
    await rm(backupDir, { recursive: true, force: true }).catch(() => {});
  }
}

// Yama sonrası TRACER'ı yeniden başlat: başlatıcı scripti ayrık process ile tetikle.
// Companion kendini kapatmadan önce çağrılır; launcher port temizliği yapıp servisleri taze kod ile açar.
export function restartApplication() {
  const starter = join(ROOT, "launcher", "start-tracer.ps1");
  if (!existsSync(starter)) return false;
  try {
    const child = spawn("powershell.exe", [
      "-NoProfile", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden",
      "-File", starter,
    ], { detached: true, stdio: "ignore", windowsHide: true });
    child.unref();
    return true;
  } catch {
    return false;
  }
}
