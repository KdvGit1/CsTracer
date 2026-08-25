import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

export const GSI_CONFIG_FILENAME = "gamestate_integration_tracer.cfg";
export const GSI_CONFIG_PROFILE = "performance-v2";

// Canlı koç yerel oyuncunun hareket/şarjör değişimini 10 Hz'de güvenilir biçimde
// izleyebilir. Önceki 20 Hz + sıfır buffer profili, CS2'ye gereksiz JSON/HTTP işi
// yaptırıyordu. allplayers_position ve allplayers_match_stats canlı oyuncu ekranında
// kullanılmıyor; özellikle gözlemci paketlerinde payload'ı ciddi büyütebiliyor.
export const GSI_CONFIG_CONTENT = `"TRACER CS2 Realtime Coach ${GSI_CONFIG_PROFILE}"
{
    "uri" "http://127.0.0.1:43119/gsi"
    "timeout" "5.0"
    "buffer"  "0.1"
    "throttle" "0.1"
    "heartbeat" "2.0"
    "output"
    {
        "precision_time" "1"
        "precision_position" "1"
        "precision_vector" "1"
    }
    "data"
    {
        "provider"              "1"
        "map"                   "1"
        "round"                 "1"
        "player_id"             "1"
        "player_state"          "1"
        "player_weapons"        "1"
        "player_match_stats"    "1"
        "player_position"       "1"
        "allplayers_id"         "1"
        "allplayers_state"      "1"
        "allplayers_weapons"    "1"
        "bomb"                  "1"
        "phase_countdowns"      "1"
    }
}
`;

function normalizeConfig(content = "") {
  return String(content).replace(/\r\n/g, "\n").trim();
}

export function isPerformanceGsiConfig(content = "") {
  return normalizeConfig(content) === normalizeConfig(GSI_CONFIG_CONTENT);
}

function getSteamPathFromRegistry() {
  if (process.platform !== "win32") return null;
  const queries = [
    { key: "HKCU\\Software\\Valve\\Steam", val: "SteamPath" },
    { key: "HKLM\\SOFTWARE\\WOW6432Node\\Valve\\Steam", val: "InstallPath" },
    { key: "HKLM\\SOFTWARE\\Valve\\Steam", val: "InstallPath" },
  ];

  for (const q of queries) {
    try {
      const res = spawnSync("reg.exe", ["query", q.key, "/v", q.val], { encoding: "utf8", windowsHide: true, timeout: 2000 });
      if (res.status === 0 && res.stdout) {
        const match = res.stdout.match(/REG_SZ\s+(.*)/i);
        if (match && match[1]) {
          const path = match[1].trim();
          if (existsSync(path)) return path;
        }
      }
    } catch { /* ignore */ }
  }
  return null;
}

function parseLibraryFolders(steamPath) {
  const libraryFolders = [steamPath];
  const vdfPath = join(steamPath, "steamapps", "libraryfolders.vdf");
  if (existsSync(vdfPath)) {
    try {
      const content = readFileSync(vdfPath, "utf8");
      const pathMatches = content.matchAll(/"path"\s+"([^"]+)"/gi);
      for (const m of pathMatches) {
        const p = m[1].replace(/\\\\/g, "\\");
        if (existsSync(p) && !libraryFolders.includes(p)) {
          libraryFolders.push(p);
        }
      }
    } catch { /* ignore */ }
  }
  return libraryFolders;
}

export function findCs2CfgDirectories() {
  const candidates = [];
  const standardDrives = ["C", "D", "E", "F", "G", "Z"];

  // 1. Check from Steam registry
  const steamPath = getSteamPathFromRegistry();
  if (steamPath) {
    const libraries = parseLibraryFolders(steamPath);
    for (const lib of libraries) {
      candidates.push(join(lib, "steamapps", "common", "Counter-Strike Global Offensive", "game", "csgo", "cfg"));
      candidates.push(join(lib, "steamapps", "common", "Counter-Strike 2", "game", "csgo", "cfg"));
    }
  }

  // 2. Check standard drive patterns
  for (const d of standardDrives) {
    candidates.push(`${d}:\\Program Files (x86)\\Steam\\steamapps\\common\\Counter-Strike Global Offensive\\game\\csgo\\cfg`);
    candidates.push(`${d}:\\Program Files\\Steam\\steamapps\\common\\Counter-Strike Global Offensive\\game\\csgo\\cfg`);
    candidates.push(`${d}:\\SteamLibrary\\steamapps\\common\\Counter-Strike Global Offensive\\game\\csgo\\cfg`);
    candidates.push(`${d}:\\Steam\\steamapps\\common\\Counter-Strike Global Offensive\\game\\csgo\\cfg`);
    candidates.push(`${d}:\\Games\\Steam\\steamapps\\common\\Counter-Strike Global Offensive\\game\\csgo\\cfg`);
    candidates.push(`${d}:\\Oyunlar\\Steam\\steamapps\\common\\Counter-Strike Global Offensive\\game\\csgo\\cfg`);
  }

  const uniqueCandidates = [...new Set(candidates)];
  const existingCfgDirs = uniqueCandidates.filter((p) => {
    try {
      return existsSync(p);
    } catch {
      return false;
    }
  });

  return existingCfgDirs;
}

export function checkGsiStatus(customPath = "") {
  const pathsToCheck = customPath ? [customPath, ...findCs2CfgDirectories()] : findCs2CfgDirectories();
  
  for (const cfgDir of pathsToCheck) {
    const targetFile = cfgDir.endsWith(".cfg") ? cfgDir : join(cfgDir, GSI_CONFIG_FILENAME);
    const parentDir = cfgDir.endsWith(".cfg") ? resolve(cfgDir, "..") : cfgDir;
    
    if (existsSync(targetFile)) {
      try {
        const content = readFileSync(targetFile, "utf8");
        const hasTracerUri = content.includes("127.0.0.1:43119/gsi") || content.includes("localhost:43119/gsi");
        const performanceOptimized = hasTracerUri && isPerformanceGsiConfig(content);
        return {
          installed: true,
          valid: hasTracerUri,
          performanceOptimized,
          profile: performanceOptimized ? GSI_CONFIG_PROFILE : "legacy",
          cfgPath: targetFile,
          cfgDir: parentDir,
          message: hasTracerUri
            ? (performanceOptimized ? "CS2 GSI entegrasyonu performans profiliyle etkin." : "CS2 GSI entegrasyonu etkin; performans profili güncellenecek.")
            : "GSI dosyası mevcut ancak port ayarı farklı.",
        };
      } catch (err) {
        return { installed: true, valid: false, cfgPath: targetFile, cfgDir: parentDir, message: String(err) };
      }
    } else if (existsSync(parentDir)) {
      return {
        installed: false,
        valid: false,
        cfgPath: targetFile,
        cfgDir: parentDir,
        message: "CS2 klasörü bulundu, 1-tık kurulum bekleniyor.",
      };
    }
  }

  return {
    installed: false,
    valid: false,
    cfgPath: "",
    cfgDir: "",
    message: "CS2 klasörü otomatik bulunamadı. Lütfen CS2 'game/csgo/cfg' klasörünü seçin.",
  };
}

// Kullanıcının verdiği özel yol yalnızca CS2'nin cfg dizini olabilir — aksi halde
// HTTP body'sinden gelen bir yol ile keyfi dizine dosya yazmak mümkün olurdu.
function isLegitCs2CfgPath(candidate) {
  const normalized = resolve(candidate).toLowerCase().replace(/\//g, "\\");
  return /counter-strike.*\\game\\csgo\\cfg$/.test(normalized) || /\\game\\csgo\\cfg$/.test(normalized);
}

export async function installGsiConfig(targetDirOrPath = "") {
  let targetFile = "";
  if (targetDirOrPath) {
    const cleaned = String(targetDirOrPath).slice(0, 500);
    const asDir = cleaned.toLowerCase().endsWith(".cfg") ? resolve(cleaned, "..") : cleaned;
    if (!isLegitCs2CfgPath(asDir)) {
      throw new Error("Güvenlik: Yalnızca CS2'nin 'game/csgo/cfg' klasörüne kurulum yapılabilir.");
    }
    if (!existsSync(asDir)) {
      throw new Error("Belirtilen cfg klasörü mevcut değil. CS2 en az bir kez çalıştırılmış olmalı.");
    }
    targetFile = cleaned.toLowerCase().endsWith(".cfg") ? cleaned : join(cleaned, GSI_CONFIG_FILENAME);
  } else {
    const status = checkGsiStatus();
    if (status.cfgPath) {
      targetFile = status.cfgPath;
    } else {
      const foundDirs = findCs2CfgDirectories();
      if (foundDirs.length > 0) {
        targetFile = join(foundDirs[0], GSI_CONFIG_FILENAME);
      }
    }
  }

  if (!targetFile) {
    throw new Error("CS2 cfg klasörü bulunamadı. Lütfen CS2 'game/csgo/cfg' klasörünü manuel belirtin.");
  }

  const dir = resolve(targetFile, "..");
  await mkdir(dir, { recursive: true });
  await writeFile(targetFile, GSI_CONFIG_CONTENT, "utf8");

  return {
    ok: true,
    profile: GSI_CONFIG_PROFILE,
    performanceOptimized: true,
    needsGameRestart: true,
    cfgPath: targetFile,
    message: `Performans odaklı GSI yapılandırması oluşturuldu: ${targetFile}. CS2 açıksa yeniden başlatın.`,
  };
}

// TRACER'ın daha önce kurduğu geçerli dosyayı yerinde yükselt. Kullanıcının başka
// bir GSI entegrasyonuna veya farklı porta ait dosyasına dokunulmaz.
export async function optimizeInstalledGsiConfig() {
  const status = checkGsiStatus();
  if (!status.installed || !status.valid || !status.cfgPath) {
    return { ok: true, updated: false, status };
  }
  if (status.performanceOptimized) {
    return { ok: true, updated: false, status };
  }

  await writeFile(status.cfgPath, GSI_CONFIG_CONTENT, "utf8");
  return {
    ok: true,
    updated: true,
    needsGameRestart: true,
    status: checkGsiStatus(status.cfgPath),
  };
}
