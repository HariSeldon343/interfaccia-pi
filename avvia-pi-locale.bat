@echo off
setlocal
chcp 65001 >nul
title pi con modello locale

set "LMS_EXE=%USERPROFILE%\.lmstudio\bin\lms.exe"
set "PI_CMD=%APPDATA%\npm\pi.cmd"
if not exist "%LMS_EXE%" (
  echo LM Studio non trovato nella cartella utente prevista.
  pause
  exit /b 1
)
if not exist "%PI_CMD%" (
  echo PI non trovato nell'installazione npm dell'utente.
  pause
  exit /b 1
)

rem ---------------------------------------------------------------
rem  Avvia pi con il modello Qwen3.8 27B che gira sul tuo computer.
rem  Uso:  avvia-pi-locale.bat  [cartella di lavoro]
rem  Se non indichi la cartella, usa quella corrente.
rem ---------------------------------------------------------------

set "CARTELLA=%~1"
if "%CARTELLA%"=="" set "CARTELLA=%CD%"

echo.
echo  [1/3] Avvio del server di LM Studio...
"%LMS_EXE%" server start
if errorlevel 1 (
  echo  ERRORE: LM Studio non risponde. Apri il programma e riprova.
  pause
  exit /b 1
)

echo.
echo  [2/3] Carico il modello in memoria. La prima volta richiede circa 10 secondi...
"%LMS_EXE%" load qwen3.8-27b -c 8192 --gpu 0.9 --parallel 1 -y
if errorlevel 1 (
  echo  ERRORE: il modello non si carica. Controlla che sia scaricato in LM Studio.
  pause
  exit /b 1
)

echo.
echo  [3/3] Avvio pi nella cartella scelta...
echo.
echo  Suggerimenti: scrivi /model per cambiare modello, /hotkeys per le
echo  scorciatoie, /quit per uscire. La guida completa si trova in GUIDA-PI.md
echo.

cd /d "%CARTELLA%"
call "%PI_CMD%" --provider lmstudio --model qwen3.8-27b

endlocal
