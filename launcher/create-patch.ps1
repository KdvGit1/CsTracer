# TRACER Lightweight Patch Creator (Only ~3-4 MB without AI model or node runtime)
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

# 4. Copy ONLY changed lightweight application files (No model, no runtime)
Copy-Item -LiteralPath (Join-Path $root "dist\standalone") -Destination (Join-Path $tempPatchDir "app-runtime") -Recurse -Force
Copy-Item -LiteralPath (Join-Path $root "companion") -Destination (Join-Path $tempPatchDir "companion") -Recurse -Force
Copy-Item -LiteralPath (Join-Path $root "launcher") -Destination (Join-Path $tempPatchDir "launcher") -Recurse -Force
Copy-Item -LiteralPath (Join-Path $root "version.json") -Destination (Join-Path $tempPatchDir "version.json") -Force
if (Test-Path -LiteralPath (Join-Path $root "TRACER-Yerel.cmd")) {
  Copy-Item -LiteralPath (Join-Path $root "TRACER-Yerel.cmd") -Destination (Join-Path $tempPatchDir "TRACER-Yerel.cmd") -Force
}

# 5. Create Patch ZIP Archive
$patchZipPath = Join-Path $releaseDir "TRACER-Patch-v$version.zip"
if (Test-Path -LiteralPath $patchZipPath) { Remove-Item -LiteralPath $patchZipPath -Force }

Compress-Archive -Path "$tempPatchDir\*" -DestinationPath $patchZipPath -CompressionLevel Optimal -Force
Remove-Item -LiteralPath $tempPatchDir -Recurse -Force

$sizeMb = [Math]::Round(((Get-Item $patchZipPath).Length / 1MB), 2)
Write-Host ">>> BAŞARILI! TRACER Patch ZIP Oluşturuldu:" -ForegroundColor Green
Write-Host "Dosya: $patchZipPath ($sizeMb MB)" -ForegroundColor Yellow
Write-Host "Bu 3 MB'lık zip dosyasını GitHub Releases'e veya web sunucunuza yükleyebilirsiniz." -ForegroundColor White
