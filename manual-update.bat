@echo off
title Director Assistant - Manual Update
echo.
echo ============================================================
echo   Director Assistant - Manual Update
echo ============================================================
echo.

:: ── Locate install dir ──────────────────────────────────────
set "INSTALL_DIR=%USERPROFILE%\DirectorAssistant"

:: Try source_repo.txt written by install.bat
set "SRC_FILE=%INSTALL_DIR%\source_repo.txt"
if exist "%SRC_FILE%" (
    set /p INSTALL_DIR=<"%SRC_FILE%"
)

if not exist "%INSTALL_DIR%\backend\main.py" (
    echo [ERROR] Could not find Director Assistant install at: %INSTALL_DIR%
    echo         Re-run install.bat to reinstall.
    pause & exit /b 1
)

cd /d "%INSTALL_DIR%"
echo Location: %CD%
echo.

:: ── 1. Pull latest code ─────────────────────────────────────
echo [1/4] Pulling latest code from GitHub...
if exist ".git" (
    git pull origin main
    if errorlevel 1 (
        echo [WARN] git pull failed - continuing with current files
    ) else (
        echo [OK] Code updated
    )
) else (
    echo [INFO] ZIP install detected - use the in-app Update button for code updates.
    echo        Continuing with pip/frontend steps...
)
echo.

:: ── 2. Update Python packages ────────────────────────────────
echo [2/4] Updating Python packages...
if exist "backend\.venv\Scripts\pip.exe" (
    backend\.venv\Scripts\pip.exe install -q --upgrade -r backend\requirements.txt
    echo [OK] Packages updated
) else (
    echo [WARN] venv not found - skipping pip install
)
echo.

:: ── 3. Copy frontend ────────────────────────────────────────
echo [3/4] Copying frontend...
if exist "frontend\dist" (
    if not exist "backend\static" mkdir "backend\static"
    xcopy /s /e /y "frontend\dist\*" "backend\static\" >nul
    echo [OK] Frontend copied
) else (
    echo [WARN] frontend\dist not found - skipping
)
echo.

:: ── 4. Restart app ──────────────────────────────────────────
echo [4/4] Restarting app...
taskkill /F /FI "WINDOWTITLE eq Director Assistant*" >nul 2>&1
taskkill /F /FI "IMAGENAME eq python.exe" /FI "WINDOWTITLE eq *uvicorn*" >nul 2>&1
timeout /t 3 /nobreak >nul
start /b "" "%INSTALL_DIR%\start.bat"
echo [OK] App restarted
echo.

echo ============================================================
echo   Update complete! Open: http://localhost:8000
echo ============================================================
echo.
pause
