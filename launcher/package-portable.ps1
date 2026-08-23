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
$npmPath = (Get-Command npm.cmd -ErrorAction Stop).Source
& $npmPath run build
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
Copy-Item -LiteralPath (Join-Path $tracerRoot "TRACER-Yerel.cmd") -Destination $releaseRoot -Force
Copy-Item -LiteralPath (Join-Path $tracerRoot "PORTABLE.md") -Destination $releaseRoot -Force
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

$sourceLlama = Join-Path $tracerRoot "runtime\llama"
if (Test-Path -LiteralPath $sourceLlama) {
  Copy-Item -LiteralPath $sourceLlama -Destination (Join-Path $releaseRoot "runtime") -Recurse -Force
}
$sourceLlamaCuda = Join-Path $tracerRoot "runtime\llama-cuda"
if (Test-Path -LiteralPath $sourceLlamaCuda) {
  Copy-Item -LiteralPath $sourceLlamaCuda -Destination (Join-Path $releaseRoot "runtime") -Recurse -Force
}
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

Write-Host "TRACER taşınabilir klasörü hazır: $releaseRoot" -ForegroundColor Green
if ($missing.Count -gt 0) {
  Write-Warning ("Gömülü koç için eksik: " + ($missing -join ", ") + ". PORTABLE.md içindeki indirme bağlantılarını kullan.")
}
