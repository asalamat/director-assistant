@echo off
title Director Assistant - Manual Update
echo.
echo ============================================================
echo   Director Assistant - Manual Update
echo ============================================================
echo.

cd /d "%~dp0"
echo Location: %CD%
echo.

echo [1/4] Pulling latest code from GitHub...
git pull origin main
if errorlevel 1 (
    echo [WARN] git pull failed - continuing with local files
)
echo.

echo [2/4] Updating Python packages...
if exist "backend\.venv\Scripts\pip.exe" (
    backend\.venv\Scripts\pip.exe install -q --upgrade -r backend\requirements.txt
    echo [OK] Packages updated
) else (
    echo [WARN] venv not found - skipping pip install
)
echo.

echo [3/4] Copying frontend...
if exist "frontend\dist" (
    if not exist "backend\static" mkdir "backend\static"
    xcopy /s /e /y "frontend\dist\*" "backend\static\" >/dev/null
    echo [OK] Frontend copied
) else (
    echo [WARN] frontend\dist not found - skipping
)
echo.

echo [4/4] Restarting app...
taskkill /F /IM python.exe /T >/dev/null 2>&1
timeout /t 3 /nobreak >/dev/null
start /b start.bat
echo [OK] App restarted
echo.

echo ============================================================
echo   Update complete! Open: http://localhost:8000
echo ============================================================
echo.
pause
