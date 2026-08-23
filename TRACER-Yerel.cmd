@echo off
cd /d "%~dp0"
start "TRACER" /min powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%~dp0launcher\start-tracer.ps1"
exit /b 0
