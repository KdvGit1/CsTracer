param(
  [switch]$NoWindow,
  [int]$TestDurationSeconds = 0,
  [string]$DataRoot = "",
  [switch]$NoDialogs
)

$ErrorActionPreference = "Stop"
$tracerRoot = [System.IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
$appUrl = "http://127.0.0.1:43118"
$companionUrl = "http://127.0.0.1:43119/health"
$companionHeartbeatUrl = "http://127.0.0.1:43119/heartbeat"
$dataRoot = if ($DataRoot) { [System.IO.Path]::GetFullPath($DataRoot) } else { Join-Path ([Environment]::GetFolderPath("LocalApplicationData")) "TRACER" }
$logRoot = Join-Path $dataRoot "logs"
$profilePath = Join-Path $dataRoot "window-profile"
$startedProcesses = [System.Collections.Generic.List[System.Diagnostics.Process]]::new()

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
  # An instance of TRACER is already running. Exit cleanly without duplicating processes.
  exit 0
}

function Show-TracerError([string]$message) {
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

function Wait-ForAppBrowser([string]$browserPath, [string]$profilePath, [System.Diagnostics.Process]$starterProcess) {
  Start-Sleep -Seconds 2

  while ($true) {
    # 1. Did the starter process exit?
    if ($starterProcess -and $starterProcess.HasExited) {
      return
    }

    # 2. Check if companion server has stopped or been told to shutdown
    try {
      $healthCheck = Invoke-WebRequest -UseBasicParsing -Uri $companionHeartbeatUrl -TimeoutSec 1 -ErrorAction Stop
      if ($healthCheck.StatusCode -ne 200) { return }
    } catch {
      return
    }

    Start-Sleep -Milliseconds 800
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

  Start-HiddenNode @((Join-Path $tracerRoot "companion\server.mjs")) "companion" | Out-Null

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
      $windowProcess = Start-Process -FilePath $browser -ArgumentList $browserArgumentLine -PassThru
      Wait-ForAppBrowser $browser $profilePath $windowProcess
    } else {
      Start-Process $appUrl
      Show-TracerError "TRACER normal tarayıcıda açıldı. Yerel servisleri kapatmak için TRACER-Kapat.cmd kullanabilirsin."
      while ($true) {
        try {
          $healthCheck = Invoke-WebRequest -UseBasicParsing -Uri $companionHeartbeatUrl -TimeoutSec 1 -ErrorAction Stop
          if ($healthCheck.StatusCode -ne 200) { break }
        } catch { break }
        Start-Sleep -Seconds 2
      }
    }
  }
} catch {
  Show-TracerError $_.Exception.Message
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
