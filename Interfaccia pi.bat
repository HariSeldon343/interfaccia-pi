@echo off
cd /d "%~dp0"
chcp 65001 >nul
title Interfaccia pi
set "NODE_EXE="
if exist "%ProgramFiles%\nodejs\node.exe" set "NODE_EXE=%ProgramFiles%\nodejs\node.exe"
if not defined NODE_EXE for /f "delims=" %%I in ('%SystemRoot%\System32\where.exe "$PATH:node.exe" 2^>nul') do if not defined NODE_EXE set "NODE_EXE=%%I"
if not defined NODE_EXE (
  echo Node.js non trovato. Installalo e riprova.
  pause
  exit /b 1
)
"%NODE_EXE%" "%~dp0avvia.mjs"
