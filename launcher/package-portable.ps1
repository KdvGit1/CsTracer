param(
  [string]$OutputDirectory = "",
  [switch]$SkipModel
)

$ErrorActionPreference = "Stop"
$tracerRoot = [System.IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
$releaseRoot = if ($OutputDirectory) { [System.IO.Path]::GetFullPath($OutputDirectory) } else { Join-Path $tracerRoot "release\TRACER-Portable" }
$expectedReleaseParent = [System.IO.Path]::GetFullPath((Join-Path $tracerRoot "release"))

if (-not $releaseRoot.StartsWith($expectedReleaseParent, [System.StringComparison]::OrdinalIgnoreCase) -and -not $OutputDirectory) {
  throw "Güvensiz paket hedefi reddedildi: $releaseRoot"
}

$nodePath = (Get-Command node.exe -ErrorAction Stop).Source
Set-Location $tracerRoot
cmd.exe /c "npm run build"
if ($LASTEXITCODE -ne 0) { throw "Üretim derlemesi başarısız." }

$standaloneRoot = Join-Path $tracerRoot "dist\standalone"
if (-not (Test-Path -LiteralPath (Join-Path $standaloneRoot "server.js"))) {
  throw "dist\standalone\server.js oluşturulmadı. next.config.ts içindeki standalone çıktısını kontrol et."
}

if (Test-Path -LiteralPath $releaseRoot) {
  $resolvedTarget = [System.IO.Path]::GetFullPath($releaseRoot)
  if ($resolvedTarget -eq $tracerRoot -or $resolvedTarget.Length -lt ($expectedReleaseParent.Length + 2)) { throw "Paket hedefi güvenli değil." }
  Get-ChildItem -LiteralPath $resolvedTarget -Force -ErrorAction SilentlyContinue | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
}

New-Item -ItemType Directory -Path $releaseRoot -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $releaseRoot "app-runtime") -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $releaseRoot "runtime") -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $releaseRoot "model") -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $releaseRoot "node_modules\@laihoe") -Force | Out-Null

Get-ChildItem -LiteralPath $standaloneRoot -Force | Copy-Item -Destination (Join-Path $releaseRoot "app-runtime") -Recurse -Force
$appNodeModules = Join-Path $releaseRoot "app-runtime\node_modules"
$essentialModules = @("react", "react-dom", "react-server-dom-webpack", "scheduler")
foreach ($module in $essentialModules) {
  $moduleSrc = Join-Path $tracerRoot "node_modules\$module"
  if (Test-Path -LiteralPath $moduleSrc) {
    Copy-Item -LiteralPath $moduleSrc -Destination $appNodeModules -Recurse -Force
  }
}

Copy-Item -LiteralPath (Join-Path $tracerRoot "companion") -Destination $releaseRoot -Recurse -Force
Copy-Item -LiteralPath (Join-Path $tracerRoot "launcher") -Destination $releaseRoot -Recurse -Force

# Geliştiriciye özel betikler oyuncu paketine girmemeli
$excludedLauncherFiles = @("publish-release.ps1", "create-patch.ps1", "download-embedded-ai.ps1", "package-portable.ps1", "sync-version-files.mjs")
foreach ($devScript in $excludedLauncherFiles) {
  $devScriptPath = Join-Path $releaseRoot "launcher\$devScript"
  if (Test-Path -LiteralPath $devScriptPath) { Remove-Item -LiteralPath $devScriptPath -Force }
}

# Dynamically copy ALL root files (*.cmd, *.bat, *.ps1, *.json, *.md, *.png, *.ico, etc.) into portable release
$excludedRootPatterns = @('^\.env', '\.tsbuildinfo$', 'package-lock\.json$', '^\.git', 'tsconfig\.json$', 'drizzle\.config\.ts$', 'next\.config\.ts$', 'vite\.config\.ts$', 'eslint\.config\.mjs$', 'postcss\.config\.mjs$', '^next-env\.d\.ts$', '^TRACER-Patch-Yayinla\.cmd$', '^cs-tracker-.*\.png$')
Get-ChildItem -LiteralPath $tracerRoot -File | ForEach-Object {
  $fileName = $_.Name
  $shouldExclude = $false
  foreach ($pattern in $excludedRootPatterns) {
    if ($fileName -match $pattern) { $shouldExclude = $true; break }
  }
  if (-not $shouldExclude) {
    Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $releaseRoot $fileName) -Force
  }
}
try {
  Copy-Item -LiteralPath $nodePath -Destination (Join-Path $releaseRoot "runtime\node.exe") -Force -ErrorAction Stop
} catch {
  if (-not (Test-Path -LiteralPath (Join-Path $releaseRoot "runtime\node.exe"))) { throw $_ }
}
try {
  Copy-Item -LiteralPath (Join-Path $tracerRoot "node_modules\@laihoe\demoparser2") -Destination (Join-Path $releaseRoot "node_modules\@laihoe") -Recurse -Force -ErrorAction Stop
  Copy-Item -LiteralPath (Join-Path $tracerRoot "node_modules\@laihoe\demoparser2-win32-x64-msvc") -Destination (Join-Path $releaseRoot "node_modules\@laihoe") -Recurse -Force -ErrorAction Stop
} catch {
  if (-not (Test-Path -LiteralPath (Join-Path $releaseRoot "node_modules\@laihoe\demoparser2-win32-x64-msvc\demoparser2.win32-x64-msvc.node"))) { throw $_ }
}

# Yalnızca koç sunucusu için gerekli dosyalar: llama-server.exe + tüm DLL'ler.
# llama-bench, llama-perplexity vb. geliştirme araç exe'leri pakete girmemeli.
function Copy-LlamaRuntime([string]$sourceDir, [string]$targetDir) {
  if (-not (Test-Path -LiteralPath $sourceDir)) { return }
  New-Item -ItemType Directory -Path $targetDir -Force | Out-Null
  Get-ChildItem -LiteralPath $sourceDir -File | Where-Object {
    $_.Name -ieq "llama-server.exe" -or $_.Extension -ieq ".dll"
  } | Copy-Item -Destination $targetDir -Force
}
Copy-LlamaRuntime (Join-Path $tracerRoot "runtime\llama") (Join-Path $releaseRoot "runtime\llama")
Copy-LlamaRuntime (Join-Path $tracerRoot "runtime\llama-cuda") (Join-Path $releaseRoot "runtime\llama-cuda")

$sourceModel = Join-Path $tracerRoot "model\coach.gguf"
if ((-not $SkipModel) -and (Test-Path -LiteralPath $sourceModel)) {
  Copy-Item -LiteralPath $sourceModel -Destination (Join-Path $releaseRoot "model\coach.gguf") -Force
}

$missing = @()
if (-not (Test-Path -LiteralPath (Join-Path $releaseRoot "runtime\llama\llama-server.exe"))) { $missing += "runtime\llama\llama-server.exe" }
if (-not (Test-Path -LiteralPath (Join-Path $releaseRoot "runtime\llama-cuda\llama-server.exe"))) { $missing += "runtime\llama-cuda\llama-server.exe" }
if (-not (Test-Path -LiteralPath (Join-Path $releaseRoot "runtime\llama-cuda\ggml-cuda.dll"))) { $missing += "runtime\llama-cuda\ggml-cuda.dll" }
if (-not (Get-ChildItem -LiteralPath (Join-Path $releaseRoot "runtime\llama-cuda") -Filter "cudart64_*.dll" -File -ErrorAction SilentlyContinue | Select-Object -First 1)) { $missing += "runtime\llama-cuda\cudart64_*.dll" }
if ((-not $SkipModel) -and -not (Test-Path -LiteralPath (Join-Path $releaseRoot "model\coach.gguf"))) { $missing += "model\coach.gguf" }

# GÜVENLİK DOĞRULAMASI: Oyuncu verileri (data\) asla pakete girmemeli.
# Paketleme yalnızca açık include listesiyle çalışır (data\ listede yoktur); burada sonucu da doğruluyoruz.
# Oyuncu verileri %LOCALAPPDATA%\TRACER altında tutulur.
if (Test-Path -LiteralPath (Join-Path $releaseRoot "data")) {
  throw "GÜVENLİK HATASI: Pakete 'data' klasörü kopyalanmış! Oyuncu verileri pakete girmemeli. Paketleme durduruldu."
}
$leakedSession = @(Get-ChildItem -LiteralPath $releaseRoot -Recurse -Filter "steam_session.json" -File -Force -ErrorAction SilentlyContinue)
if ($leakedSession.Count -gt 0) {
  throw "GÜVENLİK HATASI: Pakete Steam oturum dosyası sızmış: $($leakedSession[0].FullName). Paketleme durduruldu."
}

# Paket özeti
$allFiles = @(Get-ChildItem -LiteralPath $releaseRoot -Recurse -File -Force)
$totalBytes = ($allFiles | Measure-Object -Property Length -Sum).Sum
if (-not $totalBytes) { $totalBytes = 0 }
$totalMb = [Math]::Round(($totalBytes / 1MB), 2)

Write-Host "TRACER taşınabilir klasörü hazır: $releaseRoot" -ForegroundColor Green
Write-Host ("Paket özeti: {0} dosya, toplam {1} MB" -f $allFiles.Count, $totalMb) -ForegroundColor Cyan
if ($missing.Count -gt 0) {
  Write-Warning ("Gömülü koç için eksik: " + ($missing -join ", ") + ". PORTABLE.md içindeki indirme bağlantılarını kullan.")
}
