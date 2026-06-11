@echo off
:: ============================================================
:: Director Assistant — Windows First-Time Installer
:: ============================================================
:: Run this ONCE after cloning the repo.
:: It installs all dependencies, builds the frontend,
:: then launches the app.
::
:: Requirements (install manually first):
::   - Python 3.11+  https://python.org      (check "Add to PATH")
::   - Node.js 18+   https://nodejs.org
::   - Git            https://git-scm.com
:: ============================================================

setlocal enabledelayedexpansion
set ROOT=%~dp0
set BACKEND=%ROOT%backend
set FRONTEND=%ROOT%frontend

echo.
echo ============================================================
echo   Director Assistant — First-Time Setup for Windows 11
echo ============================================================
echo.

:: ── 1. Check Python ─────────────────────────────────────────
echo [1/7] Checking Python...
where python >nul 2>&1
if errorlevel 1 (
    echo.
    echo [ERROR] Python not found!
    echo.
    echo   Please install Python 3.11 or higher:
    echo   https://python.org/downloads
    echo.
    echo   IMPORTANT: Check "Add Python to PATH" during installation.
    echo.
    pause
    exit /b 1
)
for /f "tokens=2" %%v in ('python --version 2^>^&1') do set PY_VER=%%v
echo [OK]    Python %PY_VER% found

:: ── 2. Check Node.js ────────────────────────────────────────
echo [2/7] Checking Node.js...
where node >nul 2>&1
if errorlevel 1 (
    echo.
    echo [ERROR] Node.js not found!
    echo.
    echo   Please install Node.js 18 or higher:
    echo   https://nodejs.org/en/download
    echo.
    pause
    exit /b 1
)
for /f "tokens=1" %%v in ('node --version 2^>^&1') do set NODE_VER=%%v
echo [OK]    Node.js %NODE_VER% found

:: ── 3. Create Python virtual environment ────────────────────
echo [3/7] Creating Python virtual environment...
cd /d "%BACKEND%"
if exist ".venv\Scripts\activate.bat" (
    echo [OK]    Virtual environment already exists
) else (
    python -m venv .venv
    if errorlevel 1 (
        echo [ERROR] Failed to create virtual environment.
        pause
        exit /b 1
    )
    echo [OK]    Virtual environment created
)

:: ── 4. Install Python dependencies ──────────────────────────
echo [4/7] Installing Python dependencies (this may take 2-3 minutes)...
call "%BACKEND%\.venv\Scripts\activate.bat"
pip install -r "%BACKEND%\requirements.txt" --quiet --disable-pip-version-check
if errorlevel 1 (
    echo [ERROR] Failed to install Python dependencies.
    echo         Try running: pip install -r backend\requirements.txt
    pause
    exit /b 1
)
echo [OK]    Python dependencies installed

:: ── 5. Install Node.js dependencies ─────────────────────────
echo [5/7] Installing Node.js dependencies (this may take 1-2 minutes)...
cd /d "%FRONTEND%"
call npm install --silent
if errorlevel 1 (
    echo [ERROR] Failed to install Node.js dependencies.
    pause
    exit /b 1
)
echo [OK]    Node.js dependencies installed

:: ── 6. Build the frontend ────────────────────────────────────
echo [6/7] Building frontend...
call npm run build
if errorlevel 1 (
    echo [ERROR] Frontend build failed.
    pause
    exit /b 1
)
if not exist "%BACKEND%\static" mkdir "%BACKEND%\static"
xcopy /s /e /y "%FRONTEND%\dist\*" "%BACKEND%\static\" >nul
echo [OK]    Frontend built and copied to backend/static

:: ── 7. Create desktop shortcut ──────────────────────────────
echo [7/7] Creating desktop shortcut...
set SHORTCUT=%USERPROFILE%\Desktop\Director Assistant.bat
(
    echo @echo off
    echo cd /d "%ROOT%"
    echo call start.bat
) > "%SHORTCUT%"
echo [OK]    Desktop shortcut created: "Director Assistant.bat"

:: ── Done ─────────────────────────────────────────────────────
echo.
echo ============================================================
echo   Setup complete!
echo ============================================================
echo.
echo   Next steps:
echo   1. Double-click "Director Assistant.bat" on your Desktop
echo      (or run: start.bat from this folder)
echo.
echo   2. Open http://localhost:8000 in your browser
echo.
echo   3. Go to Settings ^> App Settings and add your
echo      Anthropic API key (get one free at console.anthropic.com)
echo.
echo   4. Go to Settings ^> Email Accounts and connect your
echo      Gmail or Microsoft 365 account
echo.
echo ============================================================
echo.

set /p LAUNCH="Launch Director Assistant now? (Y/N): "
if /i "%LAUNCH%"=="Y" (
    cd /d "%ROOT%"
    call start.bat
)

endlocal
