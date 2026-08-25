@echo off
REM ============================================================
REM  TRACER-Terminal.cmd  --  GELISTIRICI / TANILAMA TERMINALI
REM  TRACER-Debug.cmd ile ayni sekilde calisir: servisler bu
REM  pencerede canli log ve hata ayiklama ciktisi ile baslar.
REM  Normal kullanim icin TRACER-Yerel.cmd yeterlidir; bu dosya
REM  teknik tanilama gerektiginde kullanilir.
REM  Pencereyi kapattiginizda TRACER da kapanir.
REM ============================================================
title TRACER Gelistirici ve Hata Ayiklama Terminali
cd /d "%~dp0"
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0launcher\start-tracer.ps1" -DebugMode
if %errorlevel% neq 0 (
  echo.
  echo [HATA] TRACER calisirken bir sorun olustu.
  pause
)
