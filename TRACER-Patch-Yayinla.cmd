@echo off
chcp 65001 >nul
title TRACER - Sürüm & Yama Yayınlayıcı
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0launcher\publish-release.ps1"
pause
