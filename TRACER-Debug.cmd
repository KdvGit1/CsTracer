@echo off
REM ============================================================
REM  TRACER-Debug.cmd  --  SORUN GIDERME KONSOLU (son kullanici)
REM  TRACER acilmazsa ya da hata verirse BU dosyayi calistirin.
REM  Tum servis mesajlari ve hata loglari bu pencerede gorunur;
REM  destek isterken bu penceredeki ciktiyi paylasin.
REM  Pencereyi kapattiginizda TRACER da kapanir.
REM ============================================================
title TRACER Debug ^& Log Konsolu
cd /d "%~dp0"
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0launcher\start-tracer.ps1" -DebugMode
if %errorlevel% neq 0 (
  echo.
  echo [HATA] TRACER calisirken bir sorun olustu.
  pause
)
