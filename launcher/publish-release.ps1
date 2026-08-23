# TRACER Otomatik Sürüm & Yama Yayınlayıcı (1-Tık GitHub Release Publisher)
param(
  [string]$NewVersion = ""
)

$ErrorActionPreference = "Stop"
$root = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$versionFile = Join-Path $root "version.json"

Write-Host "=====================================================" -ForegroundColor Cyan
Write-Host "  TRACER OTOMATİK SÜRÜM & YAMA YAYINLAYICI (v1.0)" -ForegroundColor Cyan
Write-Host "=====================================================" -ForegroundColor Cyan

# 1. Mevcut sürümü oku
$vData = @{ version = "0.42.0"; githubRepo = "KdvGit1/CsTracer" }
if (Test-Path -LiteralPath $versionFile) {
  $vData = Get-Content -Raw -LiteralPath $versionFile | ConvertFrom-Json
}
$currentVersion = $vData.version
$repo = if ($vData.githubRepo) { $vData.githubRepo } else { "KdvGit1/CsTracer" }

Write-Host "Şu anki sürüm: v$currentVersion" -ForegroundColor Gray
Write-Host "Hedef GitHub Reposu: $repo" -ForegroundColor Gray

# 2. Yeni sürüm numarasını belirle
$targetVersion = $NewVersion
if (-not $targetVersion) {
  $prompt = Read-Host "Yeni sürüm numarasını girin [Varsayılan: $currentVersion]"
  if ($prompt) { $targetVersion = $prompt.Trim().Replace("v", "") }
  else { $targetVersion = $currentVersion }
}

# Helper: Write UTF-8 WITHOUT BOM (Node.js JSON.parse compatibility)
function Write-Utf8NoBom([string]$filePath, [string]$fileContent) {
  $utf8NoBom = New-Object System.Text.UTF8Encoding $false
  [System.IO.File]::WriteAllText($filePath, $fileContent, $utf8NoBom)
}

# 3. version.json dosyasını güncelle
$vData.version = $targetVersion
$vData.releaseDate = (Get-Date -Format "yyyy-MM-dd")
$versionJsonStr = $vData | ConvertTo-Json -Depth 5
Write-Utf8NoBom $versionFile $versionJsonStr

# 3b. companion/updater.mjs ve package.json içindeki sürümü de senkronize et
$updaterMjsPath = Join-Path $root "companion\updater.mjs"
if (Test-Path -LiteralPath $updaterMjsPath) {
  $content = Get-Content -Raw -LiteralPath $updaterMjsPath
  $content = $content -replace 'export const CURRENT_VERSION = ".*?";', "export const CURRENT_VERSION = `"$targetVersion`";"
  Write-Utf8NoBom $updaterMjsPath $content
}

$pkgJsonPath = Join-Path $root "package.json"
if (Test-Path -LiteralPath $pkgJsonPath) {
  $pkgData = Get-Content -Raw -LiteralPath $pkgJsonPath | ConvertFrom-Json
  $pkgData.version = $targetVersion
  $pkgJsonStr = $pkgData | ConvertTo-Json -Depth 5
  Write-Utf8NoBom $pkgJsonPath $pkgJsonStr
}

Write-Host "`n[1/4] version.json ve kod tabanı güncellendi: v$targetVersion" -ForegroundColor Green

# 4. Patch ZIP Paketini Oluştur
Write-Host "[2/4] Hafif Yama Paketi (TRACER-Patch-v$targetVersion.zip) oluşturuluyor..." -ForegroundColor Yellow
& (Join-Path $PSScriptRoot "create-patch.ps1")

$patchZip = Join-Path $root "release\TRACER-Patch-v$targetVersion.zip"
if (-not (Test-Path -LiteralPath $patchZip)) {
  throw "Yama zip dosyası oluşturulamadı: $patchZip"
}

# 5. Git Commit & Tag oluştur
Write-Host "`n[3/4] Git commit ve sürüm etiketi (tag) hazırlanıyor..." -ForegroundColor Yellow
Set-Location $root
cmd.exe /c "git add . && git commit -m `"Release v$targetVersion`" && git tag -a v$targetVersion -m `"TRACER v$targetVersion`""
Write-Host "Değişiklikler GitHub'a gönderiliyor (git push)..." -ForegroundColor Yellow
cmd.exe /c "git push origin main --tags"

# 6. GitHub Releases sayfasını aç ve dosyayı Explorer'da göster
Write-Host "`n[4/4] Yayınlama Sayfası Açılıyor..." -ForegroundColor Green
$tag = "v$targetVersion"
$title = [System.Uri]::EscapeDataString("TRACER v$targetVersion Güncellemesi")
$releaseUrl = "https://github.com/$repo/releases/new?tag=$tag&title=$title"

Start-Process $releaseUrl

# Dosyayı Windows Gezgini'nde seçili olarak aç
Start-Process "explorer.exe" -ArgumentList "/select,`"$patchZip`""

Write-Host "`n=====================================================" -ForegroundColor Green
Write-Host "  TEBRİKLER! YENİ SÜRÜM HAZIRLANDI." -ForegroundColor Green
Write-Host "=====================================================" -ForegroundColor Green
Write-Host "1. Tarayıcınızda açılan GitHub Releases sayfasına gidin." -ForegroundColor White
Write-Host "2. Önünüzde açılan klasördeki 'TRACER-Patch-v$targetVersion.zip' dosyasını" -ForegroundColor Yellow
Write-Host "   tarayıcıya sürükleyip bırakın ve 'Publish Release' butonuna basın!" -ForegroundColor Yellow
Write-Host "`nTüm arkadaşlarınız anında bu güncellemeyi tek tıkla alacaktır.`n" -ForegroundColor Cyan
