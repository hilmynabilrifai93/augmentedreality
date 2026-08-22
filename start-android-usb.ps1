$ErrorActionPreference = "Stop"
$Port = 8000
Write-Host "Climate AR - Android USB Camera Test" -ForegroundColor Green
if (-not (Get-Command adb -ErrorAction SilentlyContinue)) {
  Write-Host "adb tidak ditemukan di PATH. Gunakan Android SDK platform-tools (tersedia jika Android Build Support/SDK terpasang)." -ForegroundColor Red
  Read-Host "Enter untuk keluar"; exit 1
}
if (-not (Get-Command python -ErrorAction SilentlyContinue)) {
  Write-Host "Python tidak ditemukan di PATH." -ForegroundColor Red
  Read-Host "Enter untuk keluar"; exit 1
}
adb devices
adb reverse "tcp:$Port" "tcp:$Port"
Start-Process powershell -ArgumentList '-NoExit','-Command',"Set-Location '$PSScriptRoot'; python -m http.server $Port --bind 127.0.0.1"
Start-Sleep -Seconds 2
adb shell am start -a android.intent.action.VIEW -d "http://localhost:$Port/"
Write-Host "Buka http://localhost:$Port di Chrome Android dan izinkan kamera." -ForegroundColor Cyan
Read-Host "Enter untuk selesai"
