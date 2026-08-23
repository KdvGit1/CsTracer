@echo off
title TRACER Kapat
cd /d "%~dp0"
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0launcher\stop-tracer.ps1"
exit /b 0
