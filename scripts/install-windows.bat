@echo off
setlocal enabledelayedexpansion
REM ============================================================
REM  Director Assistant — Windows Installer
REM ============================================================
REM  Requirements: Windows 10+, Internet connection
REM  Run as Administrator if auto-install of Python/Node fails
REM ============================================================

set APP_NAME=Director Assistant
set INSTALL_DIR=%USERPROFILE%\DirectorAssistant
set PYTHON_MIN=3.11
set NODE_MIN=18

echo.
echo ============================================
echo   Director Assistant - Windows Installer
echo ============================================
echo.

REM ── 1. Check Python ──────────────────────────────────────────
echo [INFO] Checking Python %PYTHON_MIN%+...
python --version > nul 2>&1
if %errorlevel% neq 0 goto :install_python

for /f "tokens=2" %%v in ('python --version 2^>^&1') do set PYVER=%%v
for /f "tokens=1,2 delims=." %%a in ("!PYVER!") do (
    set PYMAJ=%%a & set PYMIN=%%b
)
if !PYMAJ! lss 3 goto :install_python
if !PYMAJ! equ 3 if !PYMIN! lss 11 goto :install_python
echo [OK]    Found Python !PYVER!
goto :python_ok

:install_python
echo [WARN]  Python %PYTHON_MIN%+ not found. Attempting to install via winget...
winget install -e --id Python.Python.3.13 --silent --accept-source-agreements --accept-package-agreements
if %errorlevel% neq 0 (
    echo [ERROR] Auto-install failed.
    echo         Please install Python 3.11+ from https://www.python.org/downloads/
    echo         Make sure to check "Add Python to PATH" during install.
    pause & exit /b 1
)
set PATH=%LOCALAPPDATA%\Programs\Python\Python313;%PATH%
echo [OK]    Python installed

:python_ok

REM ── 2. Check Node.js ─────────────────────────────────────────
echo [INFO] Checking Node.js %NODE_MIN%+...
node --version > nul 2>&1
if %errorlevel% neq 0 goto :install_node

for /f "tokens=1 delims=v." %%n in ('node --version') do set NODE_VER=%%n
REM strip leading v
for /f "tokens=1" %%n in ('node --version') do set NODEVER=%%n
set NODEVER=!NODEVER:v=!
for /f "tokens=1 delims=." %%n in ("!NODEVER!") do set NODEMAJ=%%n
if !NODEMAJ! lss %NODE_MIN% goto :install_node
echo [OK]    Found Node.js v!NODEVER!
goto :node_ok

:install_node
echo [WARN]  Node.js not found or version too old. Installing via winget...
winget install -e --id OpenJS.NodeJS.LTS --silent --accept-source-agreements --accept-package-agreements
if %errorlevel% neq 0 (
    echo [ERROR] Auto-install failed.
    echo         Please install Node.js 18+ from https://nodejs.org/
    pause & exit /b 1
)
echo [OK]    Node.js installed
REM Refresh PATH
set PATH=%PROGRAMFILES%\nodejs;%PATH%

:node_ok

REM ── 3. Copy app files ────────────────────────────────────────
echo [INFO] Installing to %INSTALL_DIR%...
if not exist "%INSTALL_DIR%" mkdir "%INSTALL_DIR%"
set SCRIPT_DIR=%~dp0..
xcopy /E /I /Y "%SCRIPT_DIR%" "%INSTALL_DIR%" > nul
echo [OK]    App files copied

REM ── 4. Python virtual environment ────────────────────────────
echo [INFO] Setting up Python environment...
cd /d "%INSTALL_DIR%\backend"
python -m venv .venv
call .venv\Scripts\activate.bat
pip install -q --upgrade pip
pip install -q -r requirements.txt
echo [OK]    Python dependencies installed

REM ── 5. Build frontend ────────────────────────────────────────
echo [INFO] Building frontend...
cd /d "%INSTALL_DIR%\frontend"
call npm install --silent
call npm run build
if not exist "%INSTALL_DIR%\backend\static" mkdir "%INSTALL_DIR%\backend\static"
xcopy /E /I /Y "%INSTALL_DIR%\frontend\dist\*" "%INSTALL_DIR%\backend\static\" > nul
echo [OK]    Frontend built and copied to backend\static\

REM ── 6. Create .env if missing ─────────────────────────────────
cd /d "%INSTALL_DIR%\backend"
if not exist ".env" (
    copy ".env.example" ".env" > nul
    echo.
    echo [WARN]  Created %INSTALL_DIR%\backend\.env
    echo [WARN]  IMPORTANT: Open this file and add your ANTHROPIC_API_KEY
    echo         notepad "%INSTALL_DIR%\backend\.env"
    echo.
)

REM ── 7. Create launch script ───────────────────────────────────
set LAUNCHER=%INSTALL_DIR%\scripts\launch-windows.bat
(
echo @echo off
echo cd /d "%INSTALL_DIR%\backend"
echo call .venv\Scripts\activate.bat
echo start "Director Assistant Backend" /B uvicorn main:app --host 127.0.0.1 --port 8000
echo timeout /t 4 /nobreak ^> nul
echo start "" "http://localhost:8000"
echo echo Director Assistant running at http://localhost:8000
echo echo Close this window to stop the app.
echo pause
) > "%LAUNCHER%"

REM ── 8. Create Desktop shortcut ──────────────────────────────
set SHORTCUT=%USERPROFILE%\Desktop\Director Assistant.bat
(
echo @echo off
echo call "%LAUNCHER%"
) > "%SHORTCUT%"

echo.
echo ============================================
echo   Installation complete!
echo ============================================
echo.
echo   1. Open: %INSTALL_DIR%\backend\.env
echo      Add your ANTHROPIC_API_KEY
echo.
echo   2. Double-click "Director Assistant" on your Desktop
echo.
echo   The app will open at http://localhost:8000
echo.
pause
