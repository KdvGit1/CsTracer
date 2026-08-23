param(
  [switch]$Silent
)

$ErrorActionPreference = "SilentlyContinue"

Write-Host "TRACER arka plan servisleri sonlandırılıyor..." -ForegroundColor Cyan

# 1. Kill any start-tracer PowerShell launcher processes
$currentPid = $PID
try {
  Get-CimInstance Win32_Process | Where-Object {
    $_.Name -eq 'powershell.exe' -and $_.CommandLine -like '*start-tracer.ps1*' -and $_.ProcessId -ne $currentPid
  } | ForEach-Object {
    Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
  }
} catch { }

# 2. Kill TRACER node processes
try {
  Get-CimInstance Win32_Process | Where-Object {
    $_.Name -eq 'node.exe' -and (
      $_.CommandLine -like '*companion\server.mjs*' -or
      $_.CommandLine -like '*app-runtime\server.js*' -or
      $_.CommandLine -like '*standalone\server.js*' -or
      $_.CommandLine -like '*vinext*'
    )
  } | ForEach-Object {
    Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
  }
} catch { }

# 3. Kill processes on TRACER ports (43118, 43119, 43121)
try {
  @(43118, 43119, 43121) | ForEach-Object {
    $p = $_
    $lines = netstat -ano | Select-String ":$p\s+.*LISTENING\s+(\d+)"
    foreach ($line in $lines) {
      if ($line.Matches[0].Groups[1].Value) {
        $pidToKill = [int]$line.Matches[0].Groups[1].Value
        if ($pidToKill -ne $currentPid) {
          Stop-Process -Id $pidToKill -Force -ErrorAction SilentlyContinue
        }
      }
    }
  }
} catch { }

# 4. Kill browser processes associated with TRACER window-profile
try {
  Get-CimInstance Win32_Process | Where-Object {
    ($_.Name -eq 'msedge.exe' -or $_.Name -eq 'chrome.exe') -and $_.CommandLine -like '*TRACER\window-profile*'
  } | ForEach-Object {
    Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
  }
} catch { }

# 5. Kill llama-server if running
try {
  Get-Process llama-server -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
} catch { }

if (-not $Silent) {
  Write-Host ""
  Write-Host "=========================================================" -ForegroundColor Green
  Write-Host "  [OK] TRACER ve tüm arka plan servisleri kapatıldı." -ForegroundColor Green
  Write-Host "  [OK] CS2 için tüm CPU/RAM ve GPU kaynakları serbest." -ForegroundColor Green
  Write-Host "=========================================================" -ForegroundColor Green
  Start-Sleep -Milliseconds 900
}
