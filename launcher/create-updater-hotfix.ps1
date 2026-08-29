param(
  [string]$OutputDirectory = ""
)

$ErrorActionPreference = "Stop"
$root = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$releaseDir = if ($OutputDirectory) {
  [System.IO.Path]::GetFullPath($OutputDirectory)
} else {
  Join-Path $root "release"
}
$versionData = Get-Content -Raw -LiteralPath (Join-Path $root "version.json") | ConvertFrom-Json
$version = $versionData.version
$staging = Join-Path $releaseDir "updater-hotfix-staging"
$archive = Join-Path $releaseDir "TRACER-Guncelleyici-Duzeltmesi-v$version.zip"

if (Test-Path -LiteralPath $staging) {
  Remove-Item -LiteralPath $staging -Recurse -Force
}
New-Item -ItemType Directory -Path (Join-Path $staging "companion") -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $root "companion\updater.mjs") -Destination (Join-Path $staging "companion\updater.mjs") -Force

$instructions = @"
TRACER GUNCELLEYICI DUZELTMESI v$version

Bu paket v0.50.3 ve v0.50.4 portable kurulumlarindaki yedekleme hatasini duzeltir.
Oyuncu verilerini, analizleri, modeli veya ayarlari degistirmez.

1. TRACER-Kapat.cmd dosyasini calistirip uygulamayi tamamen kapatin.
2. Bu ZIP'in icindeki companion klasorunu mevcut TRACER klasorune cikarin.
3. Windows sorarsa companion\updater.mjs dosyasinin uzerine yazilmasini onaylayin.
4. TRACER-Yerel.cmd ile uygulamayi yeniden acin.

v0.50.3 veya v0.50.4 kullaniyorsaniz bundan sonra uygulama icinden en son surum
guncellemesini tekrar baslatin. Ara surumleri tek tek kurmaniz gerekmez.
v0.50.5 ve sonraki surumlerde bu kurtarma paketine gerek yoktur; uygulama dogrudan
en yeni yamaya guncellenebilir.
"@
$utf8Bom = New-Object System.Text.UTF8Encoding $true
[System.IO.File]::WriteAllText((Join-Path $staging "KURULUM.txt"), $instructions, $utf8Bom)

if (Test-Path -LiteralPath $archive) {
  Remove-Item -LiteralPath $archive -Force
}
Compress-Archive -Path "$staging\*" -DestinationPath $archive -CompressionLevel Optimal -Force
Remove-Item -LiteralPath $staging -Recurse -Force

if (-not (Test-Path -LiteralPath $archive) -or (Get-Item -LiteralPath $archive).Length -le 0) {
  throw "Guncelleyici duzeltme paketi olusturulamadi: $archive"
}

$hash = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash
Write-Host "Guncelleyici duzeltme paketi hazir: $archive" -ForegroundColor Green
Write-Host "SHA-256: $hash" -ForegroundColor Cyan
