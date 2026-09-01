@echo off
setlocal enabledelayedexpansion
title Director Assistant - Manual Update
echo.
echo ============================================================
echo   Director Assistant - Manual Update
echo ============================================================
echo.

:: -- Locate install dir --------------------------------------
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

:: -- 1. Pull latest code -------------------------------------
echo [1/4] Pulling latest code from GitHub...
if exist ".git" (
    git pull origin main
    if errorlevel 1 (
        echo [WARN] git pull failed - continuing with current files
    ) else (
        echo [OK] Code updated
    )
) else (
    :: ZIP install - no .git to pull. Download the latest ZIP the same way
    :: the in-app updater does, and overwrite backend/frontend from it.
    echo [INFO] ZIP install detected - downloading latest code...
    set "UZIP=%TEMP%\da_manual_update.zip"
    set "UTMP=%TEMP%\da_manual_update_src"
    powershell -NoProfile -ExecutionPolicy Bypass -Command ^
        "[Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri 'https://github.com/asalamat/director-assistant/archive/refs/heads/main.zip' -OutFile '!UZIP!' -UseBasicParsing -Headers @{'Cache-Control'='no-cache';'Pragma'='no-cache'}"
    if not exist "!UZIP!" (
        echo [WARN] Download failed - continuing with current files
    ) else (
        if exist "!UTMP!" rmdir /s /q "!UTMP!"
        powershell -NoProfile -ExecutionPolicy Bypass -Command "Expand-Archive -Path '!UZIP!' -DestinationPath '!UTMP!' -Force"
        del "!UZIP!" >nul 2>&1
        set "USRC="
        for /f "delims=" %%D in ('dir /b /ad "!UTMP!"') do set "USRC=!UTMP!\%%D"
        if defined USRC (
            robocopy "!USRC!\backend" "!INSTALL_DIR!\backend" /E /XD .venv __pycache__ /NFL /NDL /NJH /NJS >nul
            if not exist "!INSTALL_DIR!\frontend\dist" mkdir "!INSTALL_DIR!\frontend\dist"
            robocopy "!USRC!\frontend\dist" "!INSTALL_DIR!\frontend\dist" /E /NFL /NDL /NJH /NJS >nul
            copy /y "!USRC!\version.json" "!INSTALL_DIR!\version.json" >nul
            echo [OK] Code updated
        ) else (
            echo [WARN] Could not extract download - continuing with current files
        )
        rmdir /s /q "!UTMP!" >nul 2>&1
    )
)
echo.

:: -- 2. Update Python packages --------------------------------
echo [2/4] Updating Python packages...
if exist "backend\.venv\Scripts\pip.exe" (
    backend\.venv\Scripts\pip.exe install -q --upgrade -r backend\requirements.txt
    echo [OK] Packages updated
) else (
    echo [WARN] venv not found - skipping pip install
)
echo.

:: -- 3. Copy frontend ----------------------------------------
echo [3/4] Copying frontend...
if exist "frontend\dist" (
    if not exist "backend\static" mkdir "backend\static"
    xcopy /s /e /y "frontend\dist\*" "backend\static\" >nul
    echo [OK] Frontend copied
) else (
    echo [WARN] frontend\dist not found - skipping
)
echo.

:: -- 4. Restart app ------------------------------------------
echo [4/4] Restarting app...
taskkill /F /FI "WINDOWTITLE eq Director Assistant*" >nul 2>&1
taskkill /F /FI "IMAGENAME eq python.exe" /FI "WINDOWTITLE eq *uvicorn*" >nul 2>&1
timeout /t 3 /nobreak >nul
:: /D sets the working directory on `start` itself, avoiding nested quotes
:: inside cmd /c "..." (that broke a previous version of start.bat itself).
start "Director Assistant" /D "%INSTALL_DIR%" cmd /c "start.bat"
echo [OK] App restarted
echo.

echo ============================================================
echo   Update complete! Open: http://localhost:8000
echo ============================================================
echo.
pause
