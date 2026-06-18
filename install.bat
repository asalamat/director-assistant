@echo off
setlocal enabledelayedexpansion
title Director Assistant — Installer
chcp 65001 >nul 2>&1

:: ── Pre-define paths (avoids parens issues inside for/if blocks) ──
set "PF=%ProgramFiles%"
set "PF86=%ProgramFiles(x86)%"
set "LAPP=%LOCALAPPDATA%"

:: ── Fixed install location ────────────────────────────────────────
set "INSTALL_DIR=%USERPROFILE%\DirectorAssistant"

:: ── Detect bundled source (running from extracted ZIP or git clone) ──
set "SCRIPT_DIR=%~dp0"
if "!SCRIPT_DIR:~-1!"=="\" set "SCRIPT_DIR=!SCRIPT_DIR:~0,-1!"
set "BUNDLE_SRC="
if exist "!SCRIPT_DIR!\backend\main.py" set "BUNDLE_SRC=!SCRIPT_DIR!"

:: If running from inside a git repo, install in-place (dev workflow)
if exist "!SCRIPT_DIR!\.git" set "INSTALL_DIR=!SCRIPT_DIR!"

echo.
echo ============================================================
echo   Director Assistant ^- Windows Installer (All-in-One)
echo   Python 3.12 and Node.js 20 are auto-downloaded if missing
echo   No admin rights required.
echo ============================================================
echo.

:: ── 1. Python ────────────────────────────────────────────────────
echo [1/6] Checking Python 3.11-3.13...
call :FIND_PYTHON
if not defined PYTHON_CMD (
    echo [AUTO]  Python not found ^— downloading Python 3.12.9 ^(~25 MB^)...
    call :INSTALL_PYTHON
    call :FIND_PYTHON
)
if not defined PYTHON_CMD (
    echo.
    echo [ERROR] Python could not be installed automatically.
    echo.
    echo   Install Python 3.12 manually:
    echo   https://www.python.org/downloads/release/python-3129/
    echo   *** Check "Add Python to PATH" during install ***
    echo   Then close this window and run install.bat again.
    echo.
    pause & exit /b 1
)
echo [OK]    !PYTHON_VER!

:: Block Python 3.14+ — no pre-built Windows wheels for scipy/chromadb
echo !PYTHON_VER! | findstr /c:"3.14" /c:"3.15" /c:"3.16" /c:"3.17" /c:"3.18" /c:"3.19" >nul 2>&1
if not errorlevel 1 (
    echo.
    echo [ERROR] Python !PYTHON_VER! is not supported on Windows.
    echo         scipy and chromadb have no pre-built wheels for 3.14+.
    echo.
    echo   Install Python 3.12: https://www.python.org/downloads/release/python-3129/
    echo   Then run install.bat again.
    echo.
    pause & exit /b 1
)

:: ── 2. Node.js ───────────────────────────────────────────────────
echo [2/6] Checking Node.js 18+...
call :FIND_NODE
if not defined NODE_VER (
    echo [AUTO]  Node.js not found ^— downloading Node.js 20 LTS ^(~30 MB^)...
    call :INSTALL_NODE
    call :FIND_NODE
)
if not defined NODE_VER (
    echo.
    echo [ERROR] Node.js could not be installed automatically.
    echo   Install manually: https://nodejs.org/
    echo   Then run install.bat again.
    echo.
    pause & exit /b 1
)
echo [OK]    Node.js !NODE_VER!

:: ── 3. App files ─────────────────────────────────────────────────
echo [3/6] Setting up app files...
if defined BUNDLE_SRC (
    if /i "!BUNDLE_SRC!"=="!INSTALL_DIR!" (
        echo [OK]    Source already at install location: !INSTALL_DIR!
    ) else (
        echo        Copying to !INSTALL_DIR!...
        if not exist "!INSTALL_DIR!" mkdir "!INSTALL_DIR!"
        robocopy "!BUNDLE_SRC!" "!INSTALL_DIR!" /E /XD .git node_modules __pycache__ .venv static dist /NFL /NDL /NJH /NJS /MT:4 >nul
        echo [OK]    Files installed to !INSTALL_DIR!
    )
) else (
    call :FIND_GIT
    if not defined GIT_CMD (
        echo.
        echo [ERROR] No bundled source and Git not found.
        echo.
        echo   Option A ^(recommended^): Download the ZIP package:
        echo     https://github.com/asalamat/director-assistant
        echo     Code ^> Download ZIP ^> Extract ^> run install.bat from inside it
        echo.
        echo   Option B: Install Git from https://git-scm.com/download/win
        echo     Then run install.bat again.
        echo.
        pause & exit /b 1
    )
    if exist "!INSTALL_DIR!\.git" (
        echo        Updating existing installation...
        cd /d "!INSTALL_DIR!" && "!GIT_CMD!" pull --quiet
        echo [OK]    Updated to latest version
    ) else (
        echo        Cloning from GitHub...
        "!GIT_CMD!" clone https://github.com/asalamat/director-assistant.git "!INSTALL_DIR!"
        if errorlevel 1 (
            echo [ERROR] Clone failed. Check internet connection.
            pause & exit /b 1
        )
        echo [OK]    Downloaded
    )
)
set "BACKEND=!INSTALL_DIR!\backend"
set "FRONTEND=!INSTALL_DIR!\frontend"

:: ── 4. Python virtual environment + packages ─────────────────────
echo [4/6] Installing Python packages ^(first run: 2-3 min^)...
cd /d "!BACKEND!"
if not exist ".venv\Scripts\activate.bat" (
    "!PYTHON_CMD!" -m venv .venv
    if errorlevel 1 (
        echo [ERROR] Failed to create Python virtual environment.
        echo         Try Python 3.12: https://www.python.org/downloads/release/python-3129/
        pause & exit /b 1
    )
)
call "!BACKEND!\.venv\Scripts\activate.bat"
pip install -r "!BACKEND!\requirements.txt" --prefer-binary --quiet --disable-pip-version-check
if errorlevel 1 (
    echo.
    echo [ERROR] Package install failed.
    echo         Make sure Python is 3.11-3.13 (not 3.14+).
    echo         Python 3.12 download: https://www.python.org/downloads/release/python-3129/
    echo.
    pause & exit /b 1
)
echo [OK]    Python packages ready

:: ── 5. Frontend ──────────────────────────────────────────────────
echo [5/6] Building frontend ^(first run: 1-2 min^)...
cd /d "!FRONTEND!"
call npm install --silent
if errorlevel 1 (
    echo [WARN]  Retrying npm install with output...
    call npm install
    if errorlevel 1 (echo [ERROR] npm install failed & pause & exit /b 1)
)
call npm run build
if errorlevel 1 (echo [ERROR] Frontend build failed & pause & exit /b 1)
if not exist "!BACKEND!\static" mkdir "!BACKEND!\static"
xcopy /s /e /y "!FRONTEND!\dist\*" "!BACKEND!\static\" >nul
echo [OK]    Frontend built and embedded

:: ── 6. Desktop shortcut ──────────────────────────────────────────
echo [6/6] Creating Desktop shortcut...
set "SHORTCUT=%USERPROFILE%\Desktop\Director Assistant.bat"
(
    echo @echo off
    echo title Director Assistant
    echo cd /d "!INSTALL_DIR!"
    echo call start.bat
) > "!SHORTCUT!"
echo [OK]    Shortcut created: Director Assistant.bat on Desktop

:: ── Done ─────────────────────────────────────────────────────────
echo.
echo ============================================================
echo   Installation complete!
echo ============================================================
echo.
echo   Installed to : !INSTALL_DIR!
echo   Open browser : http://localhost:8000
echo   Desktop icon : Director Assistant.bat
echo.
echo   NEXT STEPS:
echo   1. Double-click "Director Assistant.bat" on your Desktop
echo   2. Go to Settings ^> App Settings ^> enter your API key
echo      (free key: https://console.anthropic.com)
echo   3. Settings ^> Email Accounts ^> connect Gmail or Microsoft 365
echo.
echo ============================================================
echo.
set /p "LAUNCH=Launch Director Assistant now? (Y/N): "
if /i "!LAUNCH!"=="Y" (
    cd /d "!INSTALL_DIR!"
    call start.bat
)
endlocal
goto :EOF


:: ============================================================
::  SUBROUTINES
:: ============================================================

:: ── Find Python (sets PYTHON_CMD and PYTHON_VER) ─────────────────
:FIND_PYTHON
set "PYTHON_CMD="
set "PYTHON_VER="
:: 1. py launcher (preferred on Windows)
where py >nul 2>&1
if not errorlevel 1 (
    where py > "%TEMP%\da_pyfind.tmp" 2>nul
    set /p PYTHON_CMD= < "%TEMP%\da_pyfind.tmp"
    del "%TEMP%\da_pyfind.tmp" >nul 2>&1
)
:: 2. python command (skip Windows Store stub)
if not defined PYTHON_CMD (
    where python >nul 2>&1
    if not errorlevel 1 (
        where python > "%TEMP%\da_pyfind.tmp" 2>nul
        set /p PYTHON_CMD= < "%TEMP%\da_pyfind.tmp"
        del "%TEMP%\da_pyfind.tmp" >nul 2>&1
        echo !PYTHON_CMD! | findstr /i "WindowsApps" >nul 2>&1
        if not errorlevel 1 set "PYTHON_CMD="
    )
)
:: 3. Scan known install locations
if not defined PYTHON_CMD if exist "!LAPP!\Programs\Python\Python313\python.exe" set "PYTHON_CMD=!LAPP!\Programs\Python\Python313\python.exe" & set "PATH=!LAPP!\Programs\Python\Python313;!LAPP!\Programs\Python\Python313\Scripts;!PATH!"
if not defined PYTHON_CMD if exist "!LAPP!\Programs\Python\Python312\python.exe" set "PYTHON_CMD=!LAPP!\Programs\Python\Python312\python.exe" & set "PATH=!LAPP!\Programs\Python\Python312;!LAPP!\Programs\Python\Python312\Scripts;!PATH!"
if not defined PYTHON_CMD if exist "!LAPP!\Programs\Python\Python311\python.exe" set "PYTHON_CMD=!LAPP!\Programs\Python\Python311\python.exe" & set "PATH=!LAPP!\Programs\Python\Python311;!LAPP!\Programs\Python\Python311\Scripts;!PATH!"
if not defined PYTHON_CMD if exist "!PF!\Python313\python.exe" set "PYTHON_CMD=!PF!\Python313\python.exe" & set "PATH=!PF!\Python313;!PF!\Python313\Scripts;!PATH!"
if not defined PYTHON_CMD if exist "!PF!\Python312\python.exe" set "PYTHON_CMD=!PF!\Python312\python.exe" & set "PATH=!PF!\Python312;!PF!\Python312\Scripts;!PATH!"
if not defined PYTHON_CMD if exist "!PF!\Python311\python.exe" set "PYTHON_CMD=!PF!\Python311\python.exe" & set "PATH=!PF!\Python311;!PF!\Python311\Scripts;!PATH!"
:: Capture version string
if defined PYTHON_CMD (
    "!PYTHON_CMD!" --version > "%TEMP%\da_pyver.tmp" 2>&1
    set /p PYTHON_VER= < "%TEMP%\da_pyver.tmp"
    del "%TEMP%\da_pyver.tmp" >nul 2>&1
)
goto :EOF

:: ── Download and silently install Python 3.12.9 (no admin needed) ──
:INSTALL_PYTHON
set "PY_URL=https://www.python.org/ftp/python/3.12.9/python-3.12.9-amd64.exe"
set "PY_EXE=%TEMP%\da_python312_setup.exe"
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
    "[Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri '!PY_URL!' -OutFile '!PY_EXE!' -UseBasicParsing" 2>nul
if not exist "!PY_EXE!" (
    echo [WARN]  PowerShell download failed. Trying curl...
    curl -L --silent --show-error -o "!PY_EXE!" "!PY_URL!" 2>nul
)
if exist "!PY_EXE!" (
    echo [AUTO]  Installing Python 3.12.9 ^(InstallAllUsers=0, no admin^)...
    "!PY_EXE!" /quiet InstallAllUsers=0 PrependPath=1 Include_test=0 Include_doc=0 Include_launcher=1
    del "!PY_EXE!" >nul 2>&1
    :: Add expected path for current session
    set "PATH=!LAPP!\Programs\Python\Python312;!LAPP!\Programs\Python\Python312\Scripts;!PATH!"
    echo [OK]    Python 3.12.9 installed
) else (
    echo [WARN]  Download failed. Check internet connection.
)
goto :EOF

:: ── Find Node.js (sets NODE_VER) ─────────────────────────────────
:FIND_NODE
set "NODE_VER="
set "NODE_EXE="
where node >nul 2>&1
if not errorlevel 1 (
    for /f "tokens=*" %%v in ('node --version 2^>^&1') do set "NODE_VER=%%v"
    goto :EOF
)
if exist "!PF!\nodejs\node.exe" set "NODE_EXE=!PF!\nodejs\node.exe" & set "PATH=!PF!\nodejs;!PATH!"
if not defined NODE_EXE if exist "!PF86!\nodejs\node.exe" set "NODE_EXE=!PF86!\nodejs\node.exe" & set "PATH=!PF86!\nodejs;!PATH!"
if not defined NODE_EXE if exist "!LAPP!\Programs\nodejs\node.exe" set "NODE_EXE=!LAPP!\Programs\nodejs\node.exe" & set "PATH=!LAPP!\Programs\nodejs;!PATH!"
if defined NODE_EXE (
    for /f "tokens=*" %%v in ('"!NODE_EXE!" --version 2^>^&1') do set "NODE_VER=%%v"
)
goto :EOF

:: ── Download and extract Node.js 20 LTS portable (no admin needed) ──
:INSTALL_NODE
set "NODE_VER_NUM=20.19.2"
set "NODE_FOLDER=node-v!NODE_VER_NUM!-win-x64"
set "NODE_URL=https://nodejs.org/dist/v!NODE_VER_NUM!/!NODE_FOLDER!.zip"
set "NODE_ZIP=%TEMP%\da_node20.zip"
set "NODE_DEST=!LAPP!\Programs\nodejs"
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
    "[Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri '!NODE_URL!' -OutFile '!NODE_ZIP!' -UseBasicParsing" 2>nul
if not exist "!NODE_ZIP!" (
    echo [WARN]  PowerShell download failed. Trying curl...
    curl -L --silent --show-error -o "!NODE_ZIP!" "!NODE_URL!" 2>nul
)
if exist "!NODE_ZIP!" (
    echo [AUTO]  Extracting Node.js !NODE_VER_NUM! to !LAPP!\Programs ...
    powershell -NoProfile -ExecutionPolicy Bypass -Command ^
        "Expand-Archive -Path '!NODE_ZIP!' -DestinationPath '!LAPP!\Programs' -Force"
    del "!NODE_ZIP!" >nul 2>&1
    if exist "!LAPP!\Programs\!NODE_FOLDER!" (
        if exist "!NODE_DEST!" rmdir /s /q "!NODE_DEST!" 2>nul
        ren "!LAPP!\Programs\!NODE_FOLDER!" "nodejs"
    )
    set "PATH=!NODE_DEST!;!PATH!"
    echo [OK]    Node.js !NODE_VER_NUM! installed ^(portable, no admin needed^)
) else (
    echo [WARN]  Download failed. Check internet connection.
)
goto :EOF

:: ── Find Git (sets GIT_CMD) ───────────────────────────────────────
:FIND_GIT
set "GIT_CMD="
where git >nul 2>&1
if not errorlevel 1 set "GIT_CMD=git" & goto :EOF
if exist "!PF!\Git\cmd\git.exe" set "GIT_CMD=!PF!\Git\cmd\git.exe" & set "PATH=!PF!\Git\cmd;!PATH!" & goto :EOF
if exist "!PF86!\Git\cmd\git.exe" set "GIT_CMD=!PF86!\Git\cmd\git.exe" & set "PATH=!PF86!\Git\cmd;!PATH!" & goto :EOF
if exist "!LAPP!\Programs\Git\cmd\git.exe" set "GIT_CMD=!LAPP!\Programs\Git\cmd\git.exe" & set "PATH=!LAPP!\Programs\Git\cmd;!PATH!" & goto :EOF
goto :EOF
