Set-Location $PSScriptRoot
Write-Host "Climate AR berjalan di http://localhost:8080"
Start-Process "http://localhost:8080"
python -m http.server 8080
