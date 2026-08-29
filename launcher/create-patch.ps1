# TRACER Lightweight Patch Creator (~18 MB; AI modeli ve node runtime içermez)
$ErrorActionPreference = "Stop"
$root = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$releaseDir = Join-Path $root "release"
$tempPatchDir = Join-Path $releaseDir "patch-staging"

Write-Host ">>> TRACER Hafif Patch Paketi Hazırlanıyor..." -ForegroundColor Cyan

# 1. Build Standalone
Set-Location $root
cmd.exe /c "npm run build"
if ($LASTEXITCODE -ne 0) { throw "Build başarısız oldu." }

# 2. Prepare Staging
if (Test-Path -LiteralPath $tempPatchDir) { Remove-Item -LiteralPath $tempPatchDir -Recurse -Force }
New-Item -ItemType Directory -Path $tempPatchDir -Force | Out-Null

# 3. Read Version
$versionJsonPath = Join-Path $root "version.json"
$version = "0.42.0"
if (Test-Path -LiteralPath $versionJsonPath) {
  $vData = Get-Content -Raw -LiteralPath $versionJsonPath | ConvertFrom-Json
  if ($vData.version) { $version = $vData.version }
}

# 4. Copy lightweight application files & directories dynamically
# 4a. Standalone Next.js app bundle
Copy-Item -LiteralPath (Join-Path $root "dist\standalone") -Destination (Join-Path $tempPatchDir "app-runtime") -Recurse -Force

# 4b. Essential support folders (companion, launcher, etc.)
$includedFolders = @("companion", "launcher", "public", "shared")
foreach ($folder in $includedFolders) {
  $folderPath = Join-Path $root $folder
  if (Test-Path -LiteralPath $folderPath) {
    Copy-Item -LiteralPath $folderPath -Destination (Join-Path $tempPatchDir $folder) -Recurse -Force
  }
}

# Steam demo indirme modülünün üretimde ihtiyaç duyduğu küçük bağımlılık kümesi.
# Top-level node_modules güncelleme sırasında korunur; companion altındaki bu
# klasör ise patch ile eski portable kurulumlara güvenle aktarılır.
$companionNodeModules = Join-Path $tempPatchDir "companion\node_modules"
New-Item -ItemType Directory -Path $companionNodeModules -Force | Out-Null
$companionRuntimeModules = @("unbzip2-stream", "buffer", "through", "ieee754")
foreach ($module in $companionRuntimeModules) {
  $moduleSource = Join-Path $root "node_modules\$module"
  if (-not (Test-Path -LiteralPath $moduleSource)) {
    throw "Companion çalışma zamanı bağımlılığı bulunamadı: node_modules\$module"
  }
  Copy-Item -LiteralPath $moduleSource -Destination (Join-Path $companionNodeModules $module) -Recurse -Force
}

# 4c. Dynamically copy ALL root files (*.cmd, *.bat, *.ps1, *.json, *.md, *.png, *.ico, etc.)
# Exclude hidden files, temp caches, env secrets and source lockfiles
$excludedRootPatterns = @('^\.env', '\.tsbuildinfo$', 'package-lock\.json$', '^\.git', 'tsconfig\.json$', 'drizzle\.config\.ts$', 'next\.config\.ts$', 'vite\.config\.ts$', 'eslint\.config\.mjs$', 'postcss\.config\.mjs$')
Get-ChildItem -LiteralPath $root -File | ForEach-Object {
  $fileName = $_.Name
  $shouldExclude = $false
  foreach ($pattern in $excludedRootPatterns) {
    if ($fileName -match $pattern) { $shouldExclude = $true; break }
  }
  if (-not $shouldExclude) {
    Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $tempPatchDir $fileName) -Force
  }
}

$requiredPatchFiles = @(
  "app-runtime\server.js",
  "companion\analyze.mjs",
  "companion\analyze-worker.mjs",
  "companion\analysis_version.mjs",
  "companion\match_storage.mjs",
  "companion\recent-matches-compactor.mjs",
  "companion\steam_downloader.mjs",
  "companion\steam_http.mjs",
  "companion\steam_http_bridge.ps1",
  "companion\steam_replay_url.mjs",
  "companion\node_modules\unbzip2-stream\package.json",
  "companion\node_modules\buffer\node_modules\base64-js\package.json",
  "companion\node_modules\through\package.json",
  "companion\node_modules\ieee754\package.json",
  "shared\scoring.mjs",
  "version.json"
)
foreach ($requiredFile in $requiredPatchFiles) {
  if (-not (Test-Path -LiteralPath (Join-Path $tempPatchDir $requiredFile))) {
    throw "Patch çekirdek dosyası eksik: $requiredFile"
  }
}


# Patch staging klasöründeki çözümlemeyi doğrudan sınayarak eksik transitive
# bağımlılığın kullanıcıya ulaşmasını engelle.
Push-Location $tempPatchDir
try {
  & (Get-Command node.exe -ErrorAction Stop).Source --input-type=module -e "import { createRequire } from 'node:module'; const require = createRequire(new URL('./companion/steam_downloader.mjs', import.meta.url)); require('unbzip2-stream');"
  if ($LASTEXITCODE -ne 0) {
    throw "Patch companion bağımlılık smoke testi başarısız oldu."
  }
} finally {
  Pop-Location
}

# 5. Create Patch ZIP Archive
$patchZipPath = Join-Path $releaseDir "TRACER-Patch-v$version.zip"
if (Test-Path -LiteralPath $patchZipPath) { Remove-Item -LiteralPath $patchZipPath -Force }

Compress-Archive -Path "$tempPatchDir\*" -DestinationPath $patchZipPath -CompressionLevel Optimal -Force
if (-not (Test-Path -LiteralPath $patchZipPath) -or (Get-Item -LiteralPath $patchZipPath).Length -le 0) {
  throw "Patch ZIP oluşturulamadı veya boş: $patchZipPath"
}
Remove-Item -LiteralPath $tempPatchDir -Recurse -Force

$sizeMb = [Math]::Round(((Get-Item $patchZipPath).Length / 1MB), 2)
Write-Host ">>> BAŞARILI! TRACER Dinamik Patch ZIP Oluşturuldu:" -ForegroundColor Green
Write-Host "Dosya: $patchZipPath ($sizeMb MB)" -ForegroundColor Yellow
Write-Host "Tüm güncel betikler, arayüz ve versiyon dosyaları otomatik pakete dahil edildi." -ForegroundColor White
