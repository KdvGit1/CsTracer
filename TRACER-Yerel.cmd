@echo off
REM ============================================================
REM  TRACER-Yerel.cmd  --  NORMAL BASLATICI (gunluk kullanim)
REM  TRACER'i arka planda sessizce baslatir ve bu pencere kapanir.
REM  Sorun yasarsaniz TRACER-Debug.cmd ile deneyin.
REM ============================================================
cd /d "%~dp0"
start "TRACER" /min powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%~dp0launcher\start-tracer.ps1"
if errorlevel 1 (
  msg %USERNAME% /TIME:20 "TRACER baslatilamadi. Lutfen TRACER-Debug.cmd ile deneyin." >nul 2>&1
  if errorlevel 1 (
    echo.
    echo [HATA] TRACER baslatilamadi. Lutfen TRACER-Debug.cmd ile deneyin.
    pause
  )
  exit /b 1
)
exit /b 0
