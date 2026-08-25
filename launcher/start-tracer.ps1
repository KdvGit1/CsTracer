param(
  [switch]$NoWindow,
  [int]$TestDurationSeconds = 0,
  [string]$DataRoot = "",
  [switch]$NoDialogs,
  [switch]$DebugMode
)

$ErrorActionPreference = "Stop"
# TRACER ikinci ekran yardımcısıdır; oyunla aynı anda çalışırken scheduler önceliğini
# CS2'nin altında tut. Çocuk Node/Chromium süreçleri de bu sınıfı devralır.
try {
  [System.Diagnostics.Process]::GetCurrentProcess().PriorityClass = [System.Diagnostics.ProcessPriorityClass]::BelowNormal
} catch { }
$tracerRoot = [System.IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
$appUrl = "http://127.0.0.1:43118"
$companionUrl = "http://127.0.0.1:43119/health"
$companionHeartbeatUrl = "http://127.0.0.1:43119/heartbeat"
$dataRoot = if ($DataRoot) { [System.IO.Path]::GetFullPath($DataRoot) } else { Join-Path ([Environment]::GetFolderPath("LocalApplicationData")) "TRACER" }
$logRoot = Join-Path $dataRoot "logs"
$profilePath = Join-Path $dataRoot "window-profile"
$startedProcesses = [System.Collections.Generic.List[System.Diagnostics.Process]]::new()

if ($DebugMode) {
  $host.UI.RawUI.WindowTitle = "TRACER - Canlı Hata Ayıklama & Terminal Konsolu"
  $tracerVersion = "bilinmiyor"
  $versionFilePath = Join-Path $tracerRoot "version.json"
  if (Test-Path -LiteralPath $versionFilePath) {
    try {
      $parsedVersion = Get-Content -Raw -LiteralPath $versionFilePath | ConvertFrom-Json
      if ($parsedVersion.version) { $tracerVersion = $parsedVersion.version }
    } catch { }
  }
  Write-Host "=================================================================" -ForegroundColor Cyan
  Write-Host "  TRACER v$tracerVersion - CANLI GELİŞTİRİCİ & LOG TERMİNALİ" -ForegroundColor Cyan
  Write-Host "=================================================================" -ForegroundColor Cyan
  Write-Host "Kök Dizin: $tracerRoot" -ForegroundColor Gray
  Write-Host "Log Dizini: $logRoot" -ForegroundColor Gray
  Write-Host "-----------------------------------------------------------------" -ForegroundColor DarkGray
}

# Single-instance lock: prevent duplicate background launcher scripts from piling up
$mutexName = "Global\TRACER_PORTABLE_LAUNCHER"
$createdNew = $false
$globalMutex = $null
try {
  $globalMutex = [System.Threading.Mutex]::new($true, $mutexName, [ref]$createdNew)
} catch {
  $createdNew = $true
}

if (-not $createdNew) {
  if ($DebugMode) {
    Write-Host "[BİLGİ] TRACER zaten arka planda çalışıyor. Arayüz açılıyor..." -ForegroundColor Yellow
  }
  if (-not $NoWindow) {
    Start-Process $appUrl
  }
  exit 0
}

function Show-TracerError([string]$message) {
  if ($DebugMode) {
    Write-Host "`n[HATA] $message" -ForegroundColor Red
    return
  }
  if ($NoDialogs) { Write-Error $message; return }
  try {
    Add-Type -AssemblyName PresentationFramework
    [System.Windows.MessageBox]::Show($message, "TRACER başlatılamadı", "OK", "Error") | Out-Null
  } catch { }
}

function Find-NodeRuntime {
  $bundledNode = Join-Path $tracerRoot "runtime\node.exe"
  if (Test-Path -LiteralPath $bundledNode) { return $bundledNode }
  $nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
  if ($nodeCommand) { return $nodeCommand.Source }
  throw "runtime\node.exe bulunamadı. Dağıtım klasörü eksik hazırlanmış."
}

function Wait-ForUrl([string]$url, [int]$timeoutSeconds) {
  $deadline = (Get-Date).AddSeconds($timeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    try {
      $response = Invoke-WebRequest -UseBasicParsing -Uri $url -TimeoutSec 2
      if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500) { return $true }
    } catch { }
    Start-Sleep -Milliseconds 300
  }
  return $false
}

function Start-HiddenNode([string[]]$arguments, [string]$logName) {
  $nodePath = Find-NodeRuntime
  $stdoutPath = Join-Path $logRoot "$logName.out.log"
  $stderrPath = Join-Path $logRoot "$logName.err.log"
  $argumentLine = ($arguments | ForEach-Object { '"' + ($_.Replace('"', '\"')) + '"' }) -join " "
  $process = Start-Process -FilePath $nodePath -ArgumentList $argumentLine -WorkingDirectory $tracerRoot -WindowStyle Hidden -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath -PassThru
  try { $process.PriorityClass = [System.Diagnostics.ProcessPriorityClass]::BelowNormal } catch { }
  $startedProcesses.Add($process)
  return $process
}

function Find-AppBrowser {
  $candidates = @(
    (Join-Path ${env:ProgramFiles(x86)} "Microsoft\Edge\Application\msedge.exe"),
    (Join-Path $env:ProgramFiles "Microsoft\Edge\Application\msedge.exe"),
    (Join-Path $env:ProgramFiles "Google\Chrome\Application\chrome.exe"),
    (Join-Path ${env:ProgramFiles(x86)} "Google\Chrome\Application\chrome.exe")
  )
  foreach ($candidate in $candidates) {
    if ($candidate -and (Test-Path -LiteralPath $candidate)) { return $candidate }
  }
  return $null
}

function Get-AppBrowserProcesses([string]$browserPath, [string]$profilePath) {
  $browserName = [System.IO.Path]::GetFileName($browserPath)
  try {
    return @(Get-CimInstance Win32_Process -Filter ("Name='" + $browserName.Replace("'", "''") + "'") -ErrorAction SilentlyContinue | Where-Object {
      $_.CommandLine -and $_.CommandLine.IndexOf($profilePath, [System.StringComparison]::OrdinalIgnoreCase) -ge 0
    })
  } catch {
    return @()
  }
}

function Wait-ForAppBrowser([string]$browserPath, [string]$profilePath, [System.Diagnostics.Process]$companionProc) {
  Start-Sleep -Seconds 3
  $prioritizedBrowserIds = [System.Collections.Generic.HashSet[int]]::new()

  while ($true) {
    # 1. Check if any browser window using our profile directory is still open
    $runningBrowsers = Get-AppBrowserProcesses $browserPath $profilePath
    if ($runningBrowsers.Count -eq 0) {
      if ($DebugMode) { Write-Host "[BİLGİ] TRACER penceresi kapatıldı, servisler durduruluyor..." -ForegroundColor Yellow }
      return
    }

    # Chromium yeni renderer/GPU süreçlerini sonradan açabilir. Her TRACER profil
    # süreci yalnızca bir kez BelowNormal yapılır; diğer Edge/Chrome pencerelerine dokunulmaz.
    foreach ($browserProcess in $runningBrowsers) {
      $browserPid = [int]$browserProcess.ProcessId
      if ($prioritizedBrowserIds.Add($browserPid)) {
        try {
          (Get-Process -Id $browserPid -ErrorAction Stop).PriorityClass = [System.Diagnostics.ProcessPriorityClass]::BelowNormal
        } catch { }
      }
    }

    # 2. Check if companion process itself has crashed / exited (never rely on HTTP network timeout under heavy demo parsing load)
    if ($companionProc -and $companionProc.HasExited) {
      if ($DebugMode) { Write-Host "[BİLGİ] Companion servisi durduruldu." -ForegroundColor Yellow }
      return
    }

    Start-Sleep -Milliseconds 1000
  }
}

try {
  New-Item -ItemType Directory -Path $logRoot -Force | Out-Null
  $env:TRACER_DATA_DIR = Join-Path $dataRoot "data"

  # Clean up any lingering zombie node processes on ports 43118, 43119, 43121 to guarantee clean start
  try {
    @(43118, 43119, 43121) | ForEach-Object {
      $p = $_
      $lines = netstat -ano | Select-String ":$p\s+.*LISTENING\s+(\d+)"
      foreach ($line in $lines) {
        if ($line.Matches[0].Groups[1].Value) {
          $pidToKill = [int]$line.Matches[0].Groups[1].Value
          if ($pidToKill -ne $PID) {
            Stop-Process -Id $pidToKill -Force -ErrorAction SilentlyContinue
          }
        }
      }
    }
  } catch { }

  Start-Sleep -Milliseconds 200

  if ($DebugMode) { Write-Host "[1/3] Companion & Demo Parser servisi başlatılıyor (Port 43119)..." -ForegroundColor Yellow }
  $companionProc = Start-HiddenNode @((Join-Path $tracerRoot "companion\server.mjs")) "companion"

  if ($DebugMode) { Write-Host "[2/3] Web Arayüz servisi başlatılıyor (Port 43118)..." -ForegroundColor Yellow }
  $standaloneServer = Join-Path $tracerRoot "app-runtime\server.js"
  if (-not (Test-Path -LiteralPath $standaloneServer)) {
    $standaloneServer = Join-Path $tracerRoot "dist\standalone\server.js"
  }
  if (Test-Path -LiteralPath $standaloneServer) {
    $env:PORT = "43118"
    $env:HOST = "127.0.0.1"
    Start-HiddenNode @($standaloneServer) "app" | Out-Null
  } else {
    $vinextCli = Join-Path $tracerRoot "node_modules\vinext\dist\cli.js"
    if (-not (Test-Path -LiteralPath $vinextCli)) { throw "Uygulama çalışma dosyaları bulunamadı." }
    Start-HiddenNode @($vinextCli, "start", "--port", "43118", "--hostname", "127.0.0.1") "app" | Out-Null
  }

  if (-not (Wait-ForUrl $companionUrl 35)) { throw "Demo parser 35 saniye içinde hazır olmadı. Log: $logRoot" }
  if (-not (Wait-ForUrl $appUrl 45)) { throw "Arayüz 45 saniye içinde hazır olmadı. Log: $logRoot" }

  if ($DebugMode) {
    Write-Host "[3/3] Servisler hazır! TRACER açılıyor..." -ForegroundColor Green
    Write-Host "-----------------------------------------------------------------" -ForegroundColor DarkGray
    Write-Host ">> Arayüz:    $appUrl" -ForegroundColor Cyan
    Write-Host ">> Companion: http://127.0.0.1:43119" -ForegroundColor Cyan
    Write-Host ">> GSI Port:  http://127.0.0.1:43119/gsi" -ForegroundColor Cyan
    Write-Host "-----------------------------------------------------------------" -ForegroundColor DarkGray
    Write-Host "Konsol açık kaldığı sürece tüm işlemler ve loglar canlı izlenir.`n" -ForegroundColor White
  }

  if ($TestDurationSeconds -gt 0) {
    Start-Sleep -Seconds $TestDurationSeconds
  } elseif (-not $NoWindow) {
    $browser = Find-AppBrowser
    if ($browser) {
      New-Item -ItemType Directory -Path $profilePath -Force | Out-Null
      $browserArgs = @(
        "--app=$appUrl",
        "--user-data-dir=$profilePath",
        "--new-window",
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-background-mode",
        "--disable-background-networking",
        "--disable-component-update",
        "--disable-sync",
        "--disable-extensions",
        "--disable-features=Translate,OptimizationHints,MediaRouter,EdgeStartupBoost",
        "--no-service-autorun"
      )
      $browserArgumentLine = ($browserArgs | ForEach-Object { '"' + ($_.Replace('"', '\"')) + '"' }) -join " "
      $appBrowserProcess = Start-Process -FilePath $browser -ArgumentList $browserArgumentLine -PassThru
      try { $appBrowserProcess.PriorityClass = [System.Diagnostics.ProcessPriorityClass]::BelowNormal } catch { }
      Wait-ForAppBrowser $browser $profilePath $companionProc
    } else {
      Start-Process $appUrl
      if (-not $DebugMode) {
        Show-TracerError "TRACER normal tarayıcıda açıldı. Yerel servisleri kapatmak için TRACER-Kapat.cmd kullanabilirsin."
      }
      while ($companionProc -and -not $companionProc.HasExited) {
        Start-Sleep -Seconds 2
      }
    }
  }
} catch {
  Show-TracerError $_.Exception.Message
  if ($DebugMode) {
    Write-Host "`nKapatmak için Enter tuşuna basın..." -ForegroundColor Yellow
    [void][System.Console]::ReadLine()
  }
  exit 1
} finally {
  # 1. Stop all node processes started by this session
  foreach ($process in $startedProcesses) {
    try {
      if ($process -and -not $process.HasExited) { Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue }
    } catch { }
  }

  # 2. Stop any remaining processes listening on TRACER ports
  try {
    @(43118, 43119, 43121) | ForEach-Object {
      $p = $_
      $lines = netstat -ano | Select-String ":$p\s+.*LISTENING\s+(\d+)"
      foreach ($line in $lines) {
        if ($line.Matches[0].Groups[1].Value) {
          $pidToKill = [int]$line.Matches[0].Groups[1].Value
          if ($pidToKill -ne $PID) {
            Stop-Process -Id $pidToKill -Force -ErrorAction SilentlyContinue
          }
        }
      }
    }
  } catch { }

  # 3. Clean up any leftover browser profile helper processes (storage, crashpad, utility)
  if ($profilePath) {
    try {
      Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
        ($_.Name -eq 'msedge.exe' -or $_.Name -eq 'chrome.exe') -and $_.CommandLine -like "*$profilePath*"
      } | ForEach-Object {
        Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
      }
    } catch { }
  }

  # 4. Stop llama-server if running
  try {
    Get-Process llama-server -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
  } catch { }

  # 5. Release single-instance Mutex
  if ($globalMutex) {
    try {
      $globalMutex.ReleaseMutex()
      $globalMutex.Dispose()
    } catch { }
  }
}
