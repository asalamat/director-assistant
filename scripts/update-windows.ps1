#Requires -Version 5.1
# Director Assistant - Windows Update Script
# Downloads the latest release ZIP from GitHub - no git or npm required.
# Run: powershell -ExecutionPolicy Bypass -File scripts\update-windows.ps1

param([string]$InstallDir = "")

$ErrorActionPreference = 'Stop'
$log = "$env:TEMP\director-assistant-update.log"

function Log($msg) {
    $ts = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
    Add-Content $log "$ts $msg" -ErrorAction SilentlyContinue
    Write-Host $msg
}

if (-not $InstallDir) {
    $InstallDir = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
}
Log "=== Director Assistant Update ==="
Log "Install dir: $InstallDir"

$candidates = @(
    "$InstallDir\backend\.venv\Scripts\python.exe",
    "$env:USERPROFILE\DirectorAssistant\backend\.venv\Scripts\python.exe"
)
$python = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $python) {
    Write-Host "ERROR: Python venv not found. Run install.bat first." -ForegroundColor Red
    $candidates | ForEach-Object { Write-Host "  Checked: $_" -ForegroundColor Yellow }
    Read-Host "Press Enter to exit"
    exit 1
}
Log "Python: $python"

Log "[1/4] Downloading latest release..."
$zip = "$env:TEMP\da_update.zip"
$tmp = "$env:TEMP\da_update_src"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
Invoke-WebRequest -Uri 'https://github.com/asalamat/director-assistant/archive/refs/heads/main.zip' -OutFile $zip -UseBasicParsing
Log "Downloaded"

if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force }
Expand-Archive -Path $zip -DestinationPath $tmp -Force
Remove-Item $zip -Force
$src = (Get-ChildItem $tmp -Directory | Select-Object -First 1).FullName
Log "Extracted: $src"

Log "[2/4] Updating backend files..."
robocopy "$src\backend" "$InstallDir\backend" /E /XD .venv __pycache__ /NFL /NDL /NJH /NJS | Out-Null

Log "[3/4] Installing Python packages..."
& $python -m pip install -q --upgrade -r "$InstallDir\backend\requirements.txt"
Log "Packages updated"

Log "[4/4] Updating frontend..."
$static = "$InstallDir\backend\static"
if (Test-Path $static) { Remove-Item $static -Recurse -Force }
Copy-Item "$src\frontend\dist" $static -Recurse

Copy-Item "$src\version.json" "$InstallDir\version.json" -Force
$ver = (Get-Content "$InstallDir\version.json" | ConvertFrom-Json).version
Log "Updated to v$ver"

Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue

Log "Restarting Director Assistant..."
Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -like '*uvicorn*main:app*' } | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep 3
Start-Process "$InstallDir\start.bat" -WindowStyle Hidden
Log "Restart initiated"

Write-Host ""
Write-Host "=== Update complete! v$ver ===" -ForegroundColor Green
Write-Host "Open: http://localhost:8000"
Write-Host "Log: $log"
Read-Host "Press Enter to close"
