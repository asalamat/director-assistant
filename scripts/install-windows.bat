@echo off
setlocal enabledelayedexpansion
REM ============================================================
REM  Director Assistant — Windows Installer  v2.9.1
REM ============================================================
REM  Requirements: Windows 10+, Internet connection
REM  Run as Administrator if auto-install of Python/Node fails
REM ============================================================

set APP_VERSION=2.9.1
set APP_NAME=Director Assistant
set INSTALL_DIR=%USERPROFILE%\DirectorAssistant
set PYTHON_MIN=3.11
set NODE_MIN=18

echo.
echo ============================================
echo   Director Assistant %APP_VERSION% - Windows Installer
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
echo [WARN]  Python %PYTHON_MIN%+ not found. Installing via winget...
winget install -e --id Python.Python.3.13 --silent --accept-source-agreements --accept-package-agreements
if %errorlevel% neq 0 (
    echo [ERROR] Auto-install failed.
    echo         Please install Python 3.11+ from https://www.python.org/downloads/
    echo         Check "Add Python to PATH" during install.
    pause & exit /b 1
)
set PATH=%LOCALAPPDATA%\Programs\Python\Python313;%PATH%
echo [OK]    Python installed

:python_ok

REM ── 2. Check Node.js ─────────────────────────────────────────
echo [INFO] Checking Node.js %NODE_MIN%+...
node --version > nul 2>&1
if %errorlevel% neq 0 goto :install_node

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
set PATH=%PROGRAMFILES%\nodejs;%PATH%

:node_ok

REM ── 3. Copy app files ────────────────────────────────────────
echo [INFO] Installing to %INSTALL_DIR%...
if not exist "%INSTALL_DIR%" mkdir "%INSTALL_DIR%"
set SCRIPT_DIR=%~dp0..
REM Use robocopy to exclude build artifacts
robocopy "%SCRIPT_DIR%" "%INSTALL_DIR%" /E /XD .git node_modules __pycache__ .venv backend\static /NFL /NDL /NJH /NJS > nul
echo [OK]    App files copied

REM ── 4. Python virtual environment ────────────────────────────
echo [INFO] Setting up Python environment...
cd /d "%INSTALL_DIR%\backend"
python -m venv .venv
call .venv\Scripts\activate.bat
python -m pip install -q --upgrade pip
python -m pip install -q -r requirements.txt
echo [OK]    Python dependencies installed

REM ── 5. Build frontend ────────────────────────────────────────
echo [INFO] Building frontend...
cd /d "%INSTALL_DIR%\frontend"
call npm install --silent
call npm run build
if not exist "%INSTALL_DIR%\backend\static" mkdir "%INSTALL_DIR%\backend\static"
robocopy "%INSTALL_DIR%\frontend\dist" "%INSTALL_DIR%\backend\static" /E /NFL /NDL /NJH /NJS > nul
echo [OK]    Frontend built and embedded

REM ── 6. Create launch script ──────────────────────────────────
if not exist "%INSTALL_DIR%\scripts" mkdir "%INSTALL_DIR%\scripts"
set LAUNCHER=%INSTALL_DIR%\scripts\launch-windows.bat
(
echo @echo off
echo cd /d "%INSTALL_DIR%\backend"
echo call .venv\Scripts\activate.bat
echo echo Starting Director Assistant...
echo start "Director Assistant" /B uvicorn main:app --host 127.0.0.1 --port 8000
echo timeout /t 4 /nobreak ^> nul
echo start "" "http://localhost:8000"
echo echo Director Assistant running at http://localhost:8000
echo echo Close this window to stop the app.
echo pause
) > "%LAUNCHER%"

REM ── 7. Create Desktop shortcut ───────────────────────────────
set SHORTCUT=%USERPROFILE%\Desktop\Director Assistant.bat
(
echo @echo off
echo call "%LAUNCHER%"
) > "%SHORTCUT%"

REM ── 8. Auto-start on login (Startup folder + registry) ───────
echo [INFO] Configuring auto-start on login...

REM Create a VBScript launcher (hides the console window on startup)
set VBLAUNCH=%INSTALL_DIR%\scripts\launch-hidden.vbs
(
echo Set WshShell = CreateObject^("WScript.Shell"^)
echo WshShell.Run "cmd /c call ""%INSTALL_DIR%\scripts\launch-background.bat""", 0, False
) > "%VBLAUNCH%"

REM Background batch (no browser open — server only)
set BGLAUNCHER=%INSTALL_DIR%\scripts\launch-background.bat
(
echo @echo off
echo cd /d "%INSTALL_DIR%\backend"
echo call .venv\Scripts\activate.bat
echo start "" /B uvicorn main:app --host 127.0.0.1 --port 8000
) > "%BGLAUNCHER%"

REM Add to registry Run key so it starts at every login
reg add "HKCU\Software\Microsoft\Windows\CurrentVersion\Run" ^
    /v "DirectorAssistant" ^
    /t REG_SZ ^
    /d "wscript.exe \"%VBLAUNCH%\"" ^
    /f > nul 2>&1

REM Also start the server right now
start "" /B wscript.exe "%VBLAUNCH%"
timeout /t 4 /nobreak > nul
echo [OK]    Auto-start on login enabled

echo.
echo ============================================
echo   Installation complete!  v%APP_VERSION%
echo ============================================
echo.
echo   Director Assistant is now RUNNING at http://localhost:8000
echo   It will auto-start every time you log in.
echo.
echo   Open in browser: http://localhost:8000
echo   Disable auto-start: reg delete HKCU\Software\Microsoft\Windows\CurrentVersion\Run /v DirectorAssistant /f
echo.
echo   First-time setup:
echo   1. Open http://localhost:8000 in your browser
echo   2. Go to Settings ^> App Settings -- enter your API key
echo   3. Go to Settings ^> Email Accounts ^> Add Account
echo.
pause
