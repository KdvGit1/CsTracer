@echo off
title TRACER Debug & Log Konsolu
cd /d "%~dp0"
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0launcher\start-tracer.ps1" -DebugMode
if %errorlevel% neq 0 (
  echo.
  echo [HATA] TRACER calisirken bir sorun olustu.
  pause
)
