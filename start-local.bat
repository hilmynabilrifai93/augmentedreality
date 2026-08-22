@echo off
setlocal
set PORT=8000
set "PY_CMD="
where py >nul 2>&1 && set "PY_CMD=py -3"
if not defined PY_CMD where python >nul 2>&1 && set "PY_CMD=python"
if not defined PY_CMD (
  echo [ERROR] Python 3 tidak ditemukan.
  pause
  exit /b 1
)
cd /d "%~dp0"
echo Climate AR FIXED V9 berjalan di http://localhost:%PORT%/index.html
echo Tekan Ctrl+C untuk menghentikan server.
start "" "http://localhost:%PORT%/index.html"
%PY_CMD% -m http.server %PORT% --bind 127.0.0.1
