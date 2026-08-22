@echo off
setlocal EnableExtensions EnableDelayedExpansion
set PORT=8000
set "ADB="
set "PY_CMD="

echo ======================================================
echo  Climate AR FIXED V9 - Android USB Camera Test
echo ======================================================
echo.

rem ------------------------------------------------------
rem Locate ADB. Prefer PATH, then common Unity Hub SDK paths.
rem ------------------------------------------------------
for /f "delims=" %%A in ('where adb 2^>nul') do if not defined ADB set "ADB=%%A"

if not defined ADB (
  for /d %%E in ("%ProgramFiles%\Unity\Hub\Editor\*") do (
    if exist "%%~fE\Editor\Data\PlaybackEngines\AndroidPlayer\SDK\platform-tools\adb.exe" (
      set "ADB=%%~fE\Editor\Data\PlaybackEngines\AndroidPlayer\SDK\platform-tools\adb.exe"
    )
  )
)

if not defined ADB (
  for /d %%E in ("%ProgramFiles%\Unity Hub\Editor\*") do (
    if exist "%%~fE\Editor\Data\PlaybackEngines\AndroidPlayer\SDK\platform-tools\adb.exe" (
      set "ADB=%%~fE\Editor\Data\PlaybackEngines\AndroidPlayer\SDK\platform-tools\adb.exe"
    )
  )
)

if not defined ADB if exist "%LOCALAPPDATA%\Android\Sdk\platform-tools\adb.exe" set "ADB=%LOCALAPPDATA%\Android\Sdk\platform-tools\adb.exe"

if not defined ADB (
  echo [ERROR] adb tidak ditemukan.
  echo.
  echo Solusi cepat:
  echo  1. Pastikan Unity Android Build Support + Android SDK sudah terpasang, atau
  echo  2. Install Android SDK Platform Tools.
  echo.
  echo Script ini sudah mencoba PATH, Unity Hub SDK, dan %%LOCALAPPDATA%%\Android\Sdk.
  pause
  exit /b 1
)

echo [OK] ADB: "%ADB%"

rem ------------------------------------------------------
rem Locate Python. Windows launcher 'py' is preferred.
rem ------------------------------------------------------
where py >nul 2>&1 && set "PY_CMD=py -3"
if not defined PY_CMD where python >nul 2>&1 && set "PY_CMD=python"
if not defined PY_CMD (
  echo [ERROR] Python tidak ditemukan di PATH.
  echo Install Python 3 atau jalankan server statis lain pada port %PORT%.
  pause
  exit /b 1
)

echo [OK] Python: %PY_CMD%
echo.

echo [1/5] Memeriksa perangkat Android...
"%ADB%" start-server >nul 2>&1
"%ADB%" devices
for /f "skip=1 tokens=1,2" %%A in ('"%ADB%" devices') do (
  if "%%B"=="device" set "DEVICE_FOUND=1"
  if "%%B"=="unauthorized" set "DEVICE_UNAUTHORIZED=1"
)

if defined DEVICE_UNAUTHORIZED (
  echo.
  echo [ERROR] HP terdeteksi tetapi belum memberi izin USB debugging.
  echo Buka layar HP, pilih Allow / Izinkan pada dialog RSA, lalu jalankan script lagi.
  pause
  exit /b 1
)
if not defined DEVICE_FOUND (
  echo.
  echo [ERROR] Tidak ada perangkat Android berstatus "device".
  echo Aktifkan Developer Options + USB Debugging, sambungkan kabel data, lalu coba lagi.
  pause
  exit /b 1
)

echo [2/5] Membersihkan reverse port lama...
"%ADB%" reverse --remove tcp:%PORT% >nul 2>&1

echo [3/5] Membuat jalur aman Android localhost:%PORT% ^-^> laptop:%PORT%...
"%ADB%" reverse tcp:%PORT% tcp:%PORT%
if errorlevel 1 (
  echo [ERROR] adb reverse gagal.
  pause
  exit /b 1
)

echo [4/5] Menjalankan server Climate AR...
start "Climate AR FIXED V9 Local Server" /D "%~dp0" cmd /k "%PY_CMD% -m http.server %PORT% --bind 127.0.0.1"
timeout /t 2 /nobreak >nul

echo [5/5] Membuka Chrome Android pada localhost...
"%ADB%" shell am start -a android.intent.action.VIEW -d "http://localhost:%PORT%/index.html"

echo.
echo ======================================================
echo  SIAP TES
 echo ======================================================
echo 1. Di HP: tekan Mulai Eksplorasi ^> Mulai AR.
echo 2. Tekan Aktifkan Kamera AR dan pilih Izinkan kamera.
echo 3. Tampilkan/cetak assets\climate-qr-marker.png pada layar/kertas lain.
echo 4. Tahap 4: drag Panel Surya, Ruang Hijau, Mobil Listrik, Hemat Air, dan Kelola Sampah.
echo 5. 1 jari = rotate 360 derajat, 2 jari = zoom.
echo.
echo Jika Chrome pernah menolak kamera:
echo Settings Android ^> Apps ^> Chrome ^> Permissions ^> Camera ^> Allow.
echo.
pause
