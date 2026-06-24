# Director Assistant — Windows One-Click Installer
# Usage (paste into PowerShell as Administrator or standard user):
#   powershell -ExecutionPolicy Bypass -c "irm https://raw.githubusercontent.com/asalamat/director-assistant/main/install.ps1 | iex"

$ErrorActionPreference = 'Stop'
try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch {}

$repo   = "asalamat/director-assistant"
$branch = "main"
$zipUrl = "https://github.com/$repo/archive/refs/heads/$branch.zip"
$tmp    = "$env:TEMP\DA_install_tmp"
$zip    = "$tmp\da.zip"

Write-Host ""
Write-Host "============================================================"
Write-Host "  Director Assistant - Windows One-Click Installer"
Write-Host "============================================================"
Write-Host ""

if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force }
New-Item -ItemType Directory -Path $tmp | Out-Null

Write-Host "[1/3] Downloading from GitHub..."
try {
    Invoke-WebRequest -Uri $zipUrl -OutFile $zip -UseBasicParsing
} catch {
    Write-Host "[WARN] Invoke-WebRequest failed, trying curl..."
    & curl.exe -L -o $zip $zipUrl
}
if (-not (Test-Path $zip)) { Write-Error "Download failed. Check internet connection."; exit 1 }
Write-Host "[OK]  Downloaded"

Write-Host "[2/3] Extracting..."
Expand-Archive -Path $zip -DestinationPath $tmp -Force
$src = Get-ChildItem $tmp -Directory | Where-Object { Test-Path (Join-Path $_.FullName "install.bat") } | Select-Object -First 1
if (-not $src) { Write-Error "install.bat not found in extracted archive."; exit 1 }
Write-Host "[OK]  Extracted to $($src.FullName)"

Write-Host "[3/3] Launching installer..."
Write-Host ""
$bat = Join-Path $src.FullName "install.bat"
& cmd.exe /c "`"$bat`""
