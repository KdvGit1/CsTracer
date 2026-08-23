import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { pipeline } from "node:stream/promises";
import { createWriteStream } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
export const CURRENT_VERSION = "0.42.0";

export function getLocalVersionInfo() {
  const versionFile = join(ROOT, "version.json");
  if (existsSync(versionFile)) {
    try {
      return JSON.parse(readFileSync(versionFile, "utf8"));
    } catch { /* ignore */ }
  }
  return {
    version: CURRENT_VERSION,
    releaseDate: "2026-08-23",
    title: "TRACER v0.42.0",
    githubRepo: "KdvGit1/CsTracer",
  };
}

export function saveLocalVersionInfo(data) {
  const versionFile = join(ROOT, "version.json");
  try {
    const current = getLocalVersionInfo();
    const merged = { ...current, ...data };
    writeFileSync(versionFile, JSON.stringify(merged, null, 2), "utf8");
    return merged;
  } catch (err) {
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
    const patchAsset = assets.find((a) => a.name.toLowerCase().endsWith(".zip") || a.name.toLowerCase().includes("patch")) || assets[0];

    const patchUrl = patchAsset?.browser_download_url || release.zipball_url || "";
    const sizeMb = patchAsset?.size ? `~${Math.round(patchAsset.size / (1024 * 1024) * 10) / 10} MB` : "~3.5 MB";

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
      sizeMb,
      githubRepo: repo,
      configured: true,
      htmlUrl: release.html_url || "",
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

export async function downloadAndApplyPatch(patchUrl) {
  if (!patchUrl) throw new Error("Yama indirme bağlantısı (patchUrl) bulunamadı.");

  const local = getLocalVersionInfo();
  const workDir = join(tmpdir(), "tracer-update");
  const tempZipPath = join(workDir, `tracer-patch-${randomUUID()}.zip`);
  const extractDir = join(workDir, `extracted-${randomUUID()}`);

  try {
    await mkdir(workDir, { recursive: true });

    // 1. Download Patch ZIP (following redirects automatically)
    const res = await fetch(patchUrl, {
      headers: { "User-Agent": `TRACER-CS2-Coach/${local.version}` },
      redirect: "follow",
      signal: AbortSignal.timeout(90000),
    });

    if (!res.ok || !res.body) {
      throw new Error(`Yama dosyası indirilemedi (${res.status}).`);
    }

    await pipeline(res.body, createWriteStream(tempZipPath));

    // 2. Extract Patch ZIP using PowerShell built-in Expand-Archive (zero dependencies)
    await mkdir(extractDir, { recursive: true });
    const extractResult = spawnSync("powershell.exe", [
      "-NoProfile",
      "-ExecutionPolicy", "Bypass",
      "-Command",
      `Expand-Archive -LiteralPath '${tempZipPath}' -DestinationPath '${extractDir}' -Force`
    ], { windowsHide: true, timeout: 35000 });

    if (extractResult.status !== 0) {
      throw new Error("Yama arşivi açılamadı: " + (extractResult.stderr?.toString("utf8") || "Arşiv hatası"));
    }

    // 3. Copy extracted files into ROOT
    const copyResult = spawnSync("powershell.exe", [
      "-NoProfile",
      "-ExecutionPolicy", "Bypass",
      "-Command",
      `Copy-Item -Path '${extractDir}\\*' -Destination '${ROOT}' -Recurse -Force`
    ], { windowsHide: true, timeout: 35000 });

    if (copyResult.status !== 0) {
      throw new Error("Yama dosyaları uygulanamadı: " + (copyResult.stderr?.toString("utf8") || "Kopyalama hatası"));
    }

    return {
      ok: true,
      message: "Yama başarıyla uygulandı! Uygulama yenileniyor...",
    };
  } finally {
    // Cleanup temporary files
    await rm(tempZipPath, { force: true }).catch(() => {});
    await rm(extractDir, { recursive: true, force: true }).catch(() => {});
  }
}
