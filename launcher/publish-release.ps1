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

# 3b. updater, package.json ve package-lock.json sürümlerini senkronize et
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

$pkgLockPath = Join-Path $root "package-lock.json"
if (Test-Path -LiteralPath $pkgLockPath) {
  # package-lock.json içindeki packages[""] anahtarı PowerShell nesnesinde
  # desteklenmez; Hashtable boş anahtarı güvenle korur.
  $lockData = Get-Content -Raw -LiteralPath $pkgLockPath | ConvertFrom-Json -AsHashtable
  $lockData["version"] = $targetVersion
  if ($lockData.ContainsKey("packages") -and $lockData["packages"].ContainsKey("")) {
    $lockData["packages"][""]["version"] = $targetVersion
  }
  Write-Utf8NoBom $pkgLockPath ($lockData | ConvertTo-Json -Depth 100)
}

Write-Host "`n[1/4] version.json ve kod tabanı güncellendi: v$targetVersion" -ForegroundColor Green

# 4. Patch ZIP Paketini Oluştur
Write-Host "[2/4] Hafif Yama Paketi (TRACER-Patch-v$targetVersion.zip) oluşturuluyor..." -ForegroundColor Yellow
& (Join-Path $PSScriptRoot "create-patch.ps1")

$patchZip = Join-Path $root "release\TRACER-Patch-v$targetVersion.zip"
if (-not (Test-Path -LiteralPath $patchZip)) {
  throw "Yama zip dosyası oluşturulamadı: $patchZip"
}

# 4b. İlk kurulum için model dahil tam portable ve GitHub asset'i hazırla
Write-Host "Taşınabilir tam klasör (model dahil) güncelleniyor..." -ForegroundColor Yellow
& (Join-Path $PSScriptRoot "package-portable.ps1")

$portableDir = Join-Path $root "release\TRACER-Portable"
$portableArchive = Join-Path $root "release\TRACER-Portable-v$targetVersion.rar"
$rarCandidates = @(
  (Get-Command rar.exe -ErrorAction SilentlyContinue).Source,
  "C:\Program Files\WinRAR\Rar.exe"
) | Where-Object { $_ -and (Test-Path -LiteralPath $_) }
$rarPath = $rarCandidates | Select-Object -First 1
if (-not $rarPath) { throw "Tam ilk kurulum paketini oluşturmak için WinRAR/Rar.exe bulunamadı." }
if (Test-Path -LiteralPath $portableArchive) { Remove-Item -LiteralPath $portableArchive -Force }
Write-Host "İlk kurulum arşivi oluşturuluyor: TRACER-Portable-v$targetVersion.rar" -ForegroundColor Yellow
& $rarPath a -idq -r -ep1 -m3 $portableArchive "$portableDir\*"
if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $portableArchive)) {
  throw "Tam portable RAR paketi oluşturulamadı."
}
$portableBytes = (Get-Item -LiteralPath $portableArchive).Length
if ($portableBytes -ge [long]2GB) {
  throw "Tam portable arşivi GitHub'ın dosya başına 2 GiB sınırını aşıyor: $portableBytes bayt."
}
$portableMb = [Math]::Round($portableBytes / 1MB, 2)
Write-Host "İlk kurulum paketi hazır: $portableArchive ($portableMb MB)" -ForegroundColor Green

# 5. Git Commit & Tag oluştur
Write-Host "`n[3/4] Git commit ve sürüm etiketi (tag) hazırlanıyor..." -ForegroundColor Yellow
Set-Location $root

# .gitignore oyuncu verilerini, paket çıktılarını, runtime ve modeli dışarıda tutar.
# Ignore edilmiş yolları negatif pathspec olarak vermek bazı Git sürümlerinde
# exit 1 ürettiği için yalnız çalışma ağacını stage ediyor, hemen ardından
# açık bir güvenlik kontrolü uyguluyoruz.
git add -A -- .
if ($LASTEXITCODE -ne 0) { throw "git add başarısız oldu (çıkış kodu $LASTEXITCODE)." }

# Güvenlik kontrolü: staging alanında hassas/büyük dosya varsa commit'ten ÖNCE dur
$stagedFiles = @(git diff --cached --name-only)
if ($LASTEXITCODE -ne 0) { throw "git diff --cached başarısız oldu (çıkış kodu $LASTEXITCODE)." }
$forbiddenStaged = @($stagedFiles | Where-Object {
  $_ -match '(^|/)(data|release|runtime|model|TEMP|work)/' -or
  $_ -match '(^|/)\.env' -or
  $_ -match 'steam_session\.json$' -or
  $_ -match '\.dem(\.bz2)?$' -or
  $_ -match '\.rar$'
})
if ($forbiddenStaged.Count -gt 0) {
  git reset | Out-Null
  throw "GÜVENLİK HATASI: Commit'e hassas dosya karıştı: $($forbiddenStaged -join ', '). Staging geri alındı, commit iptal edildi."
}

if ($stagedFiles.Count -gt 0) {
  git commit -m "Release v$targetVersion"
  if ($LASTEXITCODE -ne 0) { throw "git commit başarısız oldu (çıkış kodu $LASTEXITCODE)." }
} else {
  Write-Host "Commit'lenecek yeni değişiklik yok, mevcut kodla devam ediliyor." -ForegroundColor Gray
}

git rev-parse -q --verify "refs/tags/v$targetVersion" | Out-Null
if ($LASTEXITCODE -eq 0) {
  Write-Host "Etiket v$targetVersion zaten mevcut, yeniden oluşturulmuyor." -ForegroundColor Gray
} else {
  git tag -a "v$targetVersion" -m "TRACER v$targetVersion"
  if ($LASTEXITCODE -ne 0) { throw "git tag başarısız oldu (çıkış kodu $LASTEXITCODE)." }
}

Write-Host "Değişiklikler GitHub'a gönderiliyor (git push)..." -ForegroundColor Yellow
git push origin main --tags
if ($LASTEXITCODE -ne 0) { throw "git push başarısız oldu (çıkış kodu $LASTEXITCODE). Yayınlama durduruldu; sürüm HENÜZ yayınlanmadı." }

# 6. GitHub Release oluştur: gh CLI varsa otomatik, yoksa manuel tarayıcı akışı
$tag = "v$targetVersion"
$ghCommand = Get-Command gh -ErrorAction SilentlyContinue
$ghPath = if ($ghCommand) {
  $ghCommand.Source
} elseif (Test-Path -LiteralPath "C:\Program Files\GitHub CLI\gh.exe") {
  "C:\Program Files\GitHub CLI\gh.exe"
} else {
  $null
}
if ($ghPath) {
  Write-Host "`n[4/4] GitHub CLI bulundu, release otomatik oluşturuluyor..." -ForegroundColor Green
  & $ghPath release create $tag "$patchZip" "$portableArchive" --repo $repo --title "TRACER v$targetVersion Güncellemesi" --generate-notes --latest
  if ($LASTEXITCODE -ne 0) { throw "gh release create başarısız oldu (çıkış kodu $LASTEXITCODE). Etiket GitHub'da zaten yayınlanmış olabilir." }

  Write-Host "`n=====================================================" -ForegroundColor Green
  Write-Host "  TEBRİKLER! v$targetVersion GITHUB'DA YAYINLANDI." -ForegroundColor Green
  Write-Host "=====================================================" -ForegroundColor Green
  Write-Host "Release sayfası: https://github.com/$repo/releases/tag/$tag" -ForegroundColor Cyan
  Write-Host "`nTüm arkadaşlarınız anında bu güncellemeyi tek tıkla alacaktır.`n" -ForegroundColor Cyan
} else {
  Write-Host "`n[4/4] 'gh' CLI bulunamadı, manuel yayınlama sayfası açılıyor..." -ForegroundColor Green
  $title = [System.Uri]::EscapeDataString("TRACER v$targetVersion Güncellemesi")
  $releaseUrl = "https://github.com/$repo/releases/new?tag=$tag&title=$title"

  Start-Process $releaseUrl

  # Dosyayı Windows Gezgini'nde seçili olarak aç
  Start-Process "explorer.exe" -ArgumentList "/select,`"$patchZip`""

  Write-Host "`n=====================================================" -ForegroundColor Green
  Write-Host "  TEBRİKLER! YENİ SÜRÜM HAZIRLANDI." -ForegroundColor Green
  Write-Host "=====================================================" -ForegroundColor Green
  Write-Host "1. Tarayıcınızda açılan GitHub Releases sayfasına gidin." -ForegroundColor White
  Write-Host "2. Aşağıdaki iki dosyayı release'e ekleyin:" -ForegroundColor Yellow
  Write-Host "   - TRACER-Patch-v$targetVersion.zip (mevcut kullanıcıların tek tık güncellemesi)" -ForegroundColor Yellow
  Write-Host "   - TRACER-Portable-v$targetVersion.rar (ilk kurulum)" -ForegroundColor Yellow
  Write-Host "3. 'Publish Release' butonuna basın!" -ForegroundColor Yellow
  Write-Host "`nİPUCU: 'gh' CLI kurarsanız (winget install GitHub.cli) bu adım tamamen otomatikleşir." -ForegroundColor Gray
  Write-Host "`nTüm arkadaşlarınız anında bu güncellemeyi tek tıkla alacaktır.`n" -ForegroundColor Cyan
}
