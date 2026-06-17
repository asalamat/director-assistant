@echo off
setlocal enabledelayedexpansion
title Director Assistant - Installer
chcp 65001 >nul 2>&1

:: Pre-define paths with parentheses before ANY if/for blocks
set "PF=%ProgramFiles%"
set "PF86=%ProgramFiles(x86)%"
set "LAPP=%LOCALAPPDATA%"

:: Default install dir is a sub-folder beside this script
set "INSTALL_DIR=%~dp0director-assistant"

:: Safety check: never install into Windows system directories.
:: Running install.bat from System32 / SysWOW64 / Program Files causes
:: 32-to-64-bit path redirection that breaks venv and pip.
echo "%INSTALL_DIR%" | findstr /i "\\Windows\\System32 \\Windows\\SysWOW64 \\Program Files" >nul 2>&1
if not errorlevel 1 (
    echo.
    echo [WARN]  install.bat is running from a system-protected folder:
    echo         %~dp0
    echo         Redirecting install to your user profile instead.
    echo.
    set "INSTALL_DIR=%USERPROFILE%\DirectorAssistant"
)

echo.
echo ============================================================
echo   Director Assistant - Windows Installer
echo ============================================================
echo.

:: ==== 1. GIT ====================================================
echo [1/8] Checking Git...
set "GIT_CMD=git"
where git >nul 2>&1
if not errorlevel 1 goto GIT_OK

if exist "!PF!\Git\cmd\git.exe"   set "PATH=!PF!\Git\cmd;!PATH!" & set "GIT_CMD=!PF!\Git\cmd\git.exe" & goto GIT_OK
if exist "!PF86!\Git\cmd\git.exe" set "PATH=!PF86!\Git\cmd;!PATH!" & set "GIT_CMD=!PF86!\Git\cmd\git.exe" & goto GIT_OK
if exist "!LAPP!\Programs\Git\cmd\git.exe" set "PATH=!LAPP!\Programs\Git\cmd;!PATH!" & goto GIT_OK
if exist "!PF!\Git\bin\git.exe"   set "PATH=!PF!\Git\bin;!PATH!" & goto GIT_OK

echo.
echo [ERROR] Git not found!
echo.
echo   OPTION A: Install Git from https://git-scm.com/download/win
echo             then close and re-run this file.
echo.
echo   OPTION B: Skip Git - download ZIP manually:
echo             1. Go to https://github.com/asalamat/director-assistant
echo             2. Click Code ^> Download ZIP
echo             3. Extract and run install.bat from inside that folder
echo.
pause & exit /b 1

:GIT_OK
for /f "tokens=3" %%v in ('git --version 2^>^&1') do set GIT_VER=%%v
echo [OK]    Git !GIT_VER! found

:: ==== 2. PYTHON =================================================
echo [2/8] Checking Python...
set "PYTHON_CMD="

:: Use py launcher to find the REAL python.exe path (avoids Store stub)
where py >nul 2>&1
if not errorlevel 1 (
    for /f "tokens=*" %%P in ('py -c "import sys; print(sys.executable)" 2^>^&1') do set "PYTHON_CMD=%%P"
    if defined PYTHON_CMD goto PYTHON_OK
)

:: Try python directly (only if it's not the Store stub)
where python >nul 2>&1
if not errorlevel 1 (
    for /f "tokens=*" %%P in ('python -c "import sys; print(sys.executable)" 2^>^&1') do set "PYTHON_CMD=%%P"
    if defined PYTHON_CMD (
        echo !PYTHON_CMD! | findstr /i "WindowsApps" >nul 2>&1
        if errorlevel 1 goto PYTHON_OK
        set "PYTHON_CMD="
    )
)

for /d %%D in ("!LAPP!\Programs\Python\Python3*") do (
    if exist "%%D\python.exe" set "PATH=%%D;%%D\Scripts;!PATH!" & set "PYTHON_CMD=%%D\python.exe" & goto PYTHON_OK
)
for /d %%D in ("!PF!\Python3*") do (
    if exist "%%D\python.exe" set "PATH=%%D;%%D\Scripts;!PATH!" & set "PYTHON_CMD=%%D\python.exe" & goto PYTHON_OK
)
for /d %%D in ("!PF86!\Python3*") do (
    if exist "%%D\python.exe" set "PATH=%%D;%%D\Scripts;!PATH!" & set "PYTHON_CMD=%%D\python.exe" & goto PYTHON_OK
)

echo.
echo [ERROR] Python not found!
echo   Install Python 3.11 or 3.12 from https://python.org/downloads
echo   Check "Add Python to PATH" during install.
echo   Then close this window and run again.
echo.
pause & exit /b 1

:PYTHON_OK
if not defined PYTHON_CMD set "PYTHON_CMD=python"
for /f "tokens=*" %%v in ('"!PYTHON_CMD!" -c "import sys; print(sys.version.split()[0])" 2^>nul') do set PY_VER=%%v
if not defined PY_VER set PY_VER=(version unknown)

:: Python 3.14+ has no pre-built wheels for scipy/chromadb on Windows.
:: Abort early with a clear message instead of a confusing compile error.
for /f "tokens=1,2 delims=." %%a in ("!PY_VER!") do (
    set PY_MAJ=%%a & set PY_MIN=%%b
)
if defined PY_MAJ if defined PY_MIN (
    if !PY_MAJ! EQU 3 if !PY_MIN! GEQ 14 (
        echo.
        echo [ERROR] Python !PY_VER! is too new for some dependencies.
        echo.
        echo   Some packages (scipy, chromadb) do not yet have pre-built
        echo   Windows binaries for Python 3.14+.
        echo.
        echo   Please install Python 3.12 from:
        echo     https://www.python.org/downloads/release/python-3129/
        echo.
        echo   Check "Add Python to PATH" during install, then run this
        echo   installer again.
        echo.
        pause & exit /b 1
    )
)
echo [OK]    Python !PY_VER! found

:: ==== 3. NODE.JS ================================================
echo [3/8] Checking Node.js...
where node >nul 2>&1
if not errorlevel 1 goto NODE_OK

if exist "!PF!\nodejs\node.exe"           set "PATH=!PF!\nodejs;!PATH!" & goto NODE_OK
if exist "!PF86!\nodejs\node.exe"         set "PATH=!PF86!\nodejs;!PATH!" & goto NODE_OK
if exist "!LAPP!\Programs\nodejs\node.exe" set "PATH=!LAPP!\Programs\nodejs;!PATH!" & goto NODE_OK

echo.
echo [ERROR] Node.js not found! Install from https://nodejs.org
echo   Then close this window and run again.
echo.
pause & exit /b 1

:NODE_OK
for /f "tokens=*" %%v in ('node --version 2^>^&1') do set NODE_VER=%%v
echo [OK]    Node.js !NODE_VER! found

:: ==== 4. CLONE / UPDATE REPO ====================================
echo [4/8] Setting up repository...
if exist "!INSTALL_DIR!\.git" (
    echo [OK]    Repository exists - updating...
    cd /d "!INSTALL_DIR!"
    "!GIT_CMD!" pull --quiet
) else (
    echo        Cloning from GitHub...
    "!GIT_CMD!" clone https://github.com/asalamat/director-assistant.git "!INSTALL_DIR!"
    if errorlevel 1 (
        echo [ERROR] Clone failed. Check internet connection.
        pause & exit /b 1
    )
)
set "BACKEND=!INSTALL_DIR!\backend"
set "FRONTEND=!INSTALL_DIR!\frontend"
echo [OK]    Repository ready

:: Self-update: if the repo has a newer install.bat than what the user ran,
:: copy it and exit — the user re-runs and gets all the latest fixes.
if exist "!INSTALL_DIR!\install.bat" (
    if /i not "%~f0"=="!INSTALL_DIR!\install.bat" (
        copy /y "!INSTALL_DIR!\install.bat" "%~f0" >nul 2>&1
        if not errorlevel 1 (
            echo.
            echo [INFO]   install.bat has been updated to the latest version.
            echo          Please run install.bat again to continue.
            echo.
            pause & exit /b 0
        )
    )
)

:: ==== 5. PYTHON VENV ============================================
echo [5/8] Creating Python virtual environment...
cd /d "!BACKEND!"
if exist ".venv\Scripts\activate.bat" (
    echo [OK]    Virtual environment exists
) else (
    "!PYTHON_CMD!" -m venv .venv
    if errorlevel 1 (
        echo [ERROR] venv failed. Try Python 3.11 or 3.12 from python.org
        pause & exit /b 1
    )
    echo [OK]    Virtual environment created
)

:: ==== 6. PYTHON PACKAGES ========================================
echo [6/8] Installing Python packages (2-3 min)...
call "!BACKEND!\.venv\Scripts\activate.bat"
pip install -r "!BACKEND!\requirements.txt" --prefer-binary --disable-pip-version-check
if errorlevel 1 (
    echo.
    echo [ERROR] Package install failed  (Python !PY_VER!^).
    echo.
    echo   Python 3.14+ does not have pre-built Windows packages for scipy/chromadb.
    echo   Install Python 3.12 from:
    echo     https://www.python.org/downloads/release/python-3129/
    echo   Check "Add Python to PATH" during install, then run this installer again.
    echo.
    pause & exit /b 1
)
echo [OK]    Python packages installed

:: ==== 7. FRONTEND ===============================================
echo [7/8] Building frontend...
cd /d "!FRONTEND!"
call npm install --silent
if errorlevel 1 (echo [ERROR] npm install failed & pause & exit /b 1)
call npm run build
if errorlevel 1 (echo [ERROR] Frontend build failed & pause & exit /b 1)
if not exist "!BACKEND!\static" mkdir "!BACKEND!\static"
xcopy /s /e /y "!FRONTEND!\dist\*" "!BACKEND!\static\" >nul
echo [OK]    Frontend built

:: ==== 8. DESKTOP SHORTCUT =======================================
echo [8/8] Creating Desktop shortcut...
set "SHORTCUT=!USERPROFILE!\Desktop\Director Assistant.bat"
(
    echo @echo off
    echo title Director Assistant
    echo cd /d "!INSTALL_DIR!"
    echo call start.bat
) > "!SHORTCUT!"
echo [OK]    Shortcut created on Desktop

:: ==== DONE ======================================================
echo.
echo ============================================================
echo   Installation complete!
echo ============================================================
echo.
echo   Installed to: !INSTALL_DIR!
echo   Desktop shortcut: Director Assistant.bat
echo.
echo   NEXT STEPS:
echo   1. Double-click "Director Assistant.bat" on Desktop
echo   2. Open http://localhost:8000 in browser
echo   3. Settings ^> App Settings ^> add Anthropic API key
echo      (free at https://console.anthropic.com^)
echo   4. Settings ^> Email Accounts ^> connect Gmail or M365
echo.
echo ============================================================
echo.

set /p "LAUNCH=Launch Director Assistant now? (Y/N): "
if /i "!LAUNCH!"=="Y" (
    cd /d "!INSTALL_DIR!"
    call start.bat
)

endlocal
