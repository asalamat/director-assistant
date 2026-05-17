@echo off
REM Build Director Assistant Windows .exe installer
REM Run from repo root: packaging\build_win.bat

setlocal enabledelayedexpansion

set REPO_ROOT=%~dp0..
set VENV=%REPO_ROOT%\backend\.venv
set DIST=%REPO_ROOT%\dist

echo =^> Checking environment
if not exist "%VENV%\Scripts\python.exe" (
    echo ERROR: virtualenv not found at %VENV%
    echo        Run: cd backend ^&^& python -m venv .venv ^&^& .venv\Scripts\pip install -r requirements.txt
    exit /b 1
)

set PYTHON=%VENV%\Scripts\python.exe
set PIP=%VENV%\Scripts\pip.exe
set PYINSTALLER=%VENV%\Scripts\pyinstaller.exe

echo =^> Installing/upgrading PyInstaller
"%PIP%" install --quiet --upgrade pyinstaller

echo =^> Building frontend
cd "%REPO_ROOT%\frontend"
call npm ci --silent
call npm run build
if errorlevel 1 (
    echo ERROR: Frontend build failed
    exit /b 1
)

echo =^> Copying frontend build to backend\static
rmdir /s /q "%REPO_ROOT%\backend\static\assets" 2>nul
xcopy /e /i /y "%REPO_ROOT%\frontend\dist" "%REPO_ROOT%\backend\static\"

echo =^> Running PyInstaller
cd "%REPO_ROOT%"
"%PYINSTALLER%" ^
  --noconfirm ^
  --clean ^
  "packaging\director_assistant.spec"

set EXE_DIR=%DIST%\DirectorAssistant
if not exist "%EXE_DIR%\DirectorAssistant.exe" (
    echo ERROR: Executable not found at %EXE_DIR%\DirectorAssistant.exe
    exit /b 1
)

echo =^> Executable created: %EXE_DIR%\DirectorAssistant.exe

REM ---- optional: create installer with NSIS (if installed) ----
where makensis >nul 2>&1
if %errorlevel% equ 0 (
    echo =^> Building NSIS installer
    if exist "%REPO_ROOT%\packaging\installer.nsi" (
        makensis "%REPO_ROOT%\packaging\installer.nsi"
        echo =^> Installer created in %DIST%
    ) else (
        echo NOTE: installer.nsi not found — skipping installer creation.
    )
) else (
    echo NOTE: NSIS not found — skipping installer. Distribute the folder: %EXE_DIR%
)

echo.
echo Done! Distribute the folder '%EXE_DIR%' or zip it.
echo Users double-click DirectorAssistant.exe to launch.
