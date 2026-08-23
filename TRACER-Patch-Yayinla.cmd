@echo off
title TRACER Surum ve Yama Yayimlayici
cd /d "%~dp0"
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0launcher\publish-release.ps1"
if %errorlevel% neq 0 (
  echo.
  echo [HATA] Surum yayinlama sirasinda bir hata olustu.
)
pause
