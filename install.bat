@echo off
:: ============================================================
:: Director Assistant — Windows Installer
:: ============================================================
:: Download this file and double-click it.
:: It will clone the repo and set everything up automatically.
::
:: Prerequisites (install BEFORE running this):
::   1. Python 3.11–3.13  https://python.org/downloads
::      Check "Add Python to PATH" during install
::   2. Node.js 18+        https://nodejs.org
::   3. Git                https://git-scm.com/download/win
:: ============================================================

setlocal enabledelayedexpansion
title Director Assistant — Installer

echo.
echo ============================================================
echo   Director Assistant — Windows Installer
echo ============================================================
echo.

:: Where to install (next to this .bat file)
set "INSTALL_DIR=%~dp0director-assistant"

:: ── 1. Check Git ─────────────────────────────────────────────
echo [1/8] Checking Git...
where git >nul 2>&1
if errorlevel 1 (
    echo.
    echo [ERROR] Git not found!
    echo   Install from: https://git-scm.com/download/win
    echo   Then re-run this installer.
    echo.
    pause & exit /b 1
)
for /f "tokens=3" %%v in ('git --version 2^>^&1') do set GIT_VER=%%v
echo [OK]    Git %GIT_VER% found

:: ── 2. Check Python ──────────────────────────────────────────
echo [2/8] Checking Python...
set "PYTHON_CMD="

:: Try py launcher first (most reliable on Windows)
where py >nul 2>&1
if not errorlevel 1 (
    set "PYTHON_CMD=py"
    goto PYTHON_OK
)

:: Try python in PATH
where python >nul 2>&1
if not errorlevel 1 (
    :: Make sure it's not the Windows Store stub
    python --version >nul 2>&1
    if not errorlevel 1 (
        set "PYTHON_CMD=python"
        goto PYTHON_OK
    )
)

:: Search common install paths
for /d %%D in ("%LOCALAPPDATA%\Programs\Python\Python3*") do (
    if exist "%%D\python.exe" ( set "PYTHON_CMD=%%D\python.exe" & set "PATH=%%D;%%D\Scripts;%PATH%" & goto PYTHON_OK )
)
for /d %%D in ("%ProgramFiles%\Python3*") do (
    if exist "%%D\python.exe" ( set "PYTHON_CMD=%%D\python.exe" & set "PATH=%%D;%%D\Scripts;%PATH%" & goto PYTHON_OK )
)
for /d %%D in ("%ProgramFiles(x86)%\Python3*") do (
    if exist "%%D\python.exe" ( set "PYTHON_CMD=%%D\python.exe" & set "PATH=%%D;%%D\Scripts;%PATH%" & goto PYTHON_OK )
)

echo.
echo [ERROR] Python not found!
echo   Install Python 3.11 or 3.12 from https://python.org/downloads
echo   IMPORTANT: Check "Add Python to PATH" during installation.
echo   Then close this window and run install.bat again.
echo.
pause & exit /b 1

:PYTHON_OK
for /f %%v in ('"%PYTHON_CMD%" -c "import sys; print(sys.version.split()[0])" 2^>^&1') do set PY_VER=%%v
echo [OK]    Python %PY_VER% found (using: %PYTHON_CMD%)

:: ── 3. Check Node.js ─────────────────────────────────────────
echo [3/8] Checking Node.js...
where node >nul 2>&1
if errorlevel 1 (
    for %%P in (
        "%ProgramFiles%\nodejs\node.exe"
        "%ProgramFiles(x86)%\nodejs\node.exe"
        "%LOCALAPPDATA%\Programs\nodejs\node.exe"
    ) do if exist %%P ( for %%D in (%%P) do set "PATH=%%~dpD;%PATH%" & goto NODE_OK )
    echo.
    echo [ERROR] Node.js not found! Install from https://nodejs.org
    echo   Then close this window and run install.bat again.
    echo.
    pause & exit /b 1
)
:NODE_OK
for /f %%v in ('node --version 2^>^&1') do set NODE_VER=%%v
echo [OK]    Node.js %NODE_VER% found

:: ── 4. Clone or update repo ───────────────────────────────────
echo [4/8] Setting up repository...
if exist "%INSTALL_DIR%\.git" (
    echo [OK]    Repository already exists — pulling latest...
    cd /d "%INSTALL_DIR%"
    git pull --quiet
) else (
    echo        Cloning from GitHub (this takes ~1 minute)...
    git clone https://github.com/asalamat/director-assistant.git "%INSTALL_DIR%"
    if errorlevel 1 (
        echo [ERROR] Clone failed. Check your internet connection.
        pause & exit /b 1
    )
    echo [OK]    Repository cloned
)

set "BACKEND=%INSTALL_DIR%\backend"
set "FRONTEND=%INSTALL_DIR%\frontend"

:: ── 5. Create virtual environment ─────────────────────────────
echo [5/8] Creating Python virtual environment...
cd /d "%BACKEND%"
if exist ".venv\Scripts\activate.bat" (
    echo [OK]    Virtual environment already exists
) else (
    "%PYTHON_CMD%" -m venv .venv
    if errorlevel 1 (
        echo.
        echo [ERROR] Failed to create virtual environment.
        echo   If Python 3.14 is installed, try Python 3.11 or 3.12 instead.
        echo   Multiple Python versions can coexist on Windows.
        echo.
        pause & exit /b 1
    )
    echo [OK]    Virtual environment created
)

:: ── 6. Install Python packages ────────────────────────────────
echo [6/8] Installing Python packages (2-3 minutes)...
call "%BACKEND%\.venv\Scripts\activate.bat"
pip install -r "%BACKEND%\requirements.txt" --disable-pip-version-check
if errorlevel 1 (
    echo.
    echo [ERROR] Package install failed.
    echo   If you see a build error, Python 3.14 may lack pre-built wheels.
    echo   Install Python 3.12 from python.org and run this again.
    echo.
    pause & exit /b 1
)
echo [OK]    Python packages installed

:: ── 7. Install + build frontend ───────────────────────────────
echo [7/8] Building frontend...
cd /d "%FRONTEND%"
call npm install --silent
if errorlevel 1 ( echo [ERROR] npm install failed & pause & exit /b 1 )
call npm run build
if errorlevel 1 ( echo [ERROR] Frontend build failed & pause & exit /b 1 )
if not exist "%BACKEND%\static" mkdir "%BACKEND%\static"
xcopy /s /e /y "%FRONTEND%\dist\*" "%BACKEND%\static\" >nul
echo [OK]    Frontend built

:: ── 8. Create Desktop shortcut ────────────────────────────────
echo [8/8] Creating Desktop shortcut...
set "SHORTCUT=%USERPROFILE%\Desktop\Director Assistant.bat"
(
    echo @echo off
    echo title Director Assistant
    echo cd /d "%INSTALL_DIR%"
    echo call start.bat
) > "%SHORTCUT%"
echo [OK]    Shortcut created on Desktop

:: ── Done ──────────────────────────────────────────────────────
echo.
echo ============================================================
echo   Installation complete!
echo ============================================================
echo.
echo   App installed to: %INSTALL_DIR%
echo   Desktop shortcut: Director Assistant.bat
echo.
echo   NEXT STEPS:
echo   1. Double-click "Director Assistant.bat" on your Desktop
echo   2. Open http://localhost:8000 in your browser
echo   3. Settings ^> App Settings ^> add Anthropic API key
echo      (free at https://console.anthropic.com)
echo   4. Settings ^> Email Accounts ^> connect Gmail or Microsoft 365
echo.
echo ============================================================
echo.
set /p LAUNCH="Launch Director Assistant now? (Y/N): "
if /i "!LAUNCH!"=="Y" (
    cd /d "%INSTALL_DIR%"
    call start.bat
)

endlocal
