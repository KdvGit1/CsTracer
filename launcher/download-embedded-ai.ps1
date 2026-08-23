param([switch]$Force)

$ErrorActionPreference = "Stop"
$tracerRoot = [System.IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
$runtimeRoot = Join-Path $tracerRoot "runtime"
$cpuTarget = Join-Path $runtimeRoot "llama"
$cudaTarget = Join-Path $runtimeRoot "llama-cuda"
$modelTarget = Join-Path $tracerRoot "model\coach.gguf"
$modelUrl = "https://huggingface.co/ggml-org/Qwen3-1.7B-GGUF/resolve/main/Qwen3-1.7B-Q4_K_M.gguf?download=true"
$modelSha256 = "d2387ca2dbfee2ffabce7120d3770dadca0b293052bc2f0e138fdc940d9bc7b5"
$tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("tracer-ai-" + [Guid]::NewGuid().ToString("N"))

function Test-ModelReady {
  if (-not (Test-Path -LiteralPath $modelTarget)) { return $false }
  if ((Get-Item -LiteralPath $modelTarget).Length -lt 1GB) { return $false }
  return (Get-FileHash -LiteralPath $modelTarget -Algorithm SHA256).Hash.ToLowerInvariant() -eq $modelSha256
}

function Test-CudaReady {
  return (Test-Path -LiteralPath (Join-Path $cudaTarget "llama-server.exe")) `
    -and (Test-Path -LiteralPath (Join-Path $cudaTarget "ggml-cuda.dll")) `
    -and (@(Get-ChildItem -LiteralPath $cudaTarget -File -Filter "cudart64_*.dll" -ErrorAction SilentlyContinue).Count -gt 0)
}

function Reset-RuntimeDirectory([string]$target) {
  $resolvedTarget = [System.IO.Path]::GetFullPath($target)
  $resolvedRuntimeRoot = [System.IO.Path]::GetFullPath($runtimeRoot) + [System.IO.Path]::DirectorySeparatorChar
  if (-not $resolvedTarget.StartsWith($resolvedRuntimeRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Güvensiz runtime hedefi reddedildi: $resolvedTarget"
  }
  if (Test-Path -LiteralPath $resolvedTarget) { Remove-Item -LiteralPath $resolvedTarget -Recurse -Force }
  New-Item -ItemType Directory -Path $resolvedTarget -Force | Out-Null
}

function Download-VerifiedAsset($asset, [string]$destination) {
  if (-not $asset.digest -or -not $asset.digest.StartsWith("sha256:")) {
    throw ("GitHub SHA-256 özeti eksik: " + $asset.name)
  }
  Invoke-WebRequest -UseBasicParsing -Uri $asset.browser_download_url -OutFile $destination
  $expected = $asset.digest.Substring(7).ToLowerInvariant()
  $actual = (Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($actual -ne $expected) { throw ("SHA-256 doğrulaması başarısız: " + $asset.name) }
}

$cpuReady = Test-Path -LiteralPath (Join-Path $cpuTarget "llama-server.exe")
$cudaReady = Test-CudaReady
$modelReady = Test-ModelReady
if ($cpuReady -and $cudaReady -and $modelReady -and -not $Force) {
  Write-Host "Gömülü AI dosyaları CPU + CUDA desteğiyle hazır." -ForegroundColor Green
  exit 0
}

try {
  New-Item -ItemType Directory -Path $tempRoot -Force | Out-Null
  New-Item -ItemType Directory -Path $runtimeRoot -Force | Out-Null
  New-Item -ItemType Directory -Path (Split-Path -Parent $modelTarget) -Force | Out-Null

  if ((-not $cpuReady) -or (-not $cudaReady) -or $Force) {
    Write-Host "Aynı llama.cpp sürümüne ait CPU, CUDA 12.4 ve CUDA runtime paketleri bulunuyor…"
    $releases = Invoke-RestMethod -Headers @{ "User-Agent" = "TRACER-Portable-Builder" } -Uri "https://api.github.com/repos/ggml-org/llama.cpp/releases?per_page=20"
    $cpuAsset = $null
    $cudaAsset = $null
    $cudartAsset = $null
    foreach ($release in $releases) {
      $candidateCpu = $release.assets | Where-Object { $_.name -match "llama-b\d+-bin-win-cpu-x64\.zip$" } | Select-Object -First 1
      $candidateCuda = $release.assets | Where-Object { $_.name -match "llama-b\d+-bin-win-cuda-12\.4-x64\.zip$" } | Select-Object -First 1
      $candidateCudart = $release.assets | Where-Object { $_.name -eq "cudart-llama-bin-win-cuda-12.4-x64.zip" } | Select-Object -First 1
      if ($candidateCpu -and $candidateCuda -and $candidateCudart) {
        $cpuAsset = $candidateCpu
        $cudaAsset = $candidateCuda
        $cudartAsset = $candidateCudart
        break
      }
    }
    if (-not $cpuAsset -or -not $cudaAsset -or -not $cudartAsset) { throw "Uyumlu llama.cpp CPU + CUDA 12.4 paketi bulunamadı." }

    if ((-not $cpuReady) -or $Force) {
      Write-Host ("CPU motoru indiriliyor: " + $cpuAsset.name)
      $cpuZip = Join-Path $tempRoot $cpuAsset.name
      Download-VerifiedAsset $cpuAsset $cpuZip
      $cpuExtract = Join-Path $tempRoot "cpu"
      Expand-Archive -LiteralPath $cpuZip -DestinationPath $cpuExtract -Force
      $cpuServer = Get-ChildItem -LiteralPath $cpuExtract -Recurse -File -Filter "llama-server.exe" | Select-Object -First 1
      if (-not $cpuServer) { throw "CPU paketinde llama-server.exe bulunamadı." }
      Reset-RuntimeDirectory $cpuTarget
      Get-ChildItem -LiteralPath $cpuServer.Directory.FullName -Force | Copy-Item -Destination $cpuTarget -Recurse -Force
    }

    if ((-not $cudaReady) -or $Force) {
      Write-Host ("CUDA motoru indiriliyor: " + $cudaAsset.name)
      $cudaZip = Join-Path $tempRoot $cudaAsset.name
      $cudartZip = Join-Path $tempRoot $cudartAsset.name
      Download-VerifiedAsset $cudaAsset $cudaZip
      Write-Host ("CUDA 12.4 DLL'leri indiriliyor: " + $cudartAsset.name)
      Download-VerifiedAsset $cudartAsset $cudartZip
      $cudaExtract = Join-Path $tempRoot "cuda"
      $cudartExtract = Join-Path $tempRoot "cudart"
      Expand-Archive -LiteralPath $cudaZip -DestinationPath $cudaExtract -Force
      Expand-Archive -LiteralPath $cudartZip -DestinationPath $cudartExtract -Force
      $cudaServer = Get-ChildItem -LiteralPath $cudaExtract -Recurse -File -Filter "llama-server.exe" | Select-Object -First 1
      if (-not $cudaServer) { throw "CUDA paketinde llama-server.exe bulunamadı." }
      Reset-RuntimeDirectory $cudaTarget
      Get-ChildItem -LiteralPath $cudaServer.Directory.FullName -Force | Copy-Item -Destination $cudaTarget -Recurse -Force
      Get-ChildItem -LiteralPath $cudartExtract -Recurse -File | Copy-Item -Destination $cudaTarget -Force
      if (-not (Test-CudaReady)) { throw "CUDA çalışma dizini eksik oluşturuldu." }
    }
  }

  if ((-not $modelReady) -or $Force) {
    Write-Host "Qwen3 1.7B Q4_K_M modelinin yaklaşık 1.28 GB dosyası indiriliyor…"
    $modelTemp = Join-Path $tempRoot "coach.gguf"
    & curl.exe --location --fail --retry 3 --connect-timeout 30 --output $modelTemp $modelUrl
    if ($LASTEXITCODE -ne 0) { throw "Model indirmesi başarısız (curl kodu: $LASTEXITCODE)." }
    if ((Get-Item -LiteralPath $modelTemp).Length -lt 1GB) { throw "Model dosyası beklenenden küçük; indirme tamamlanmamış olabilir." }
    $downloadedHash = (Get-FileHash -LiteralPath $modelTemp -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($downloadedHash -ne $modelSha256) { throw "Model SHA-256 doğrulaması başarısız; dosya kullanılmadı." }
    Move-Item -LiteralPath $modelTemp -Destination $modelTarget -Force
  }

  Write-Host "Gömülü koç CPU yedeği ve otomatik NVIDIA CUDA desteğiyle hazır." -ForegroundColor Green
} finally {
  if (Test-Path -LiteralPath $tempRoot) {
    $resolvedTemp = [System.IO.Path]::GetFullPath($tempRoot)
    $systemTemp = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
    if ($resolvedTemp.StartsWith($systemTemp, [System.StringComparison]::OrdinalIgnoreCase) -and (Split-Path -Leaf $resolvedTemp).StartsWith("tracer-ai-")) {
      Remove-Item -LiteralPath $resolvedTemp -Recurse -Force
    }
  }
}
