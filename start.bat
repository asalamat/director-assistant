@echo off
:: ============================================================
:: Director Assistant - Windows Start Script
:: ============================================================
:: Usage:
::   start.bat           - production mode (port 8000, built frontend)
::   start.bat dev       - dev mode (backend 8000 + frontend 5173 hot-reload)
:: ============================================================

setlocal enabledelayedexpansion

set ROOT=%~dp0
set BACKEND=%ROOT%backend
set FRONTEND=%ROOT%frontend
set MODE=%1
if "%MODE%"=="" set MODE=prod

set TOKENIZERS_PARALLELISM=false
set OMP_NUM_THREADS=1

echo.
echo ============================================
echo   Director Assistant
echo ============================================
echo.

:: -- Check prerequisites -------------------------------------

where python >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Python not found. Install from https://python.org and add to PATH.
    pause
    exit /b 1
)

:: -- Check / create virtual environment ----------------------

if not exist "%BACKEND%\.venv\Scripts\python.exe" (
    echo [INFO]  Creating Python virtual environment...
    cd /d "%BACKEND%"
    python -m venv .venv
    if errorlevel 1 (
        echo [ERROR] Failed to create virtual environment.
        pause
        exit /b 1
    )
    echo [OK]    Virtual environment created

    :: Install dependencies only when venv is freshly created
    echo [INFO]  Installing backend dependencies ^(first run only^)...
    "%BACKEND%\.venv\Scripts\pip.exe" install -r "%BACKEND%\requirements.txt" --prefer-binary --disable-pip-version-check
    if errorlevel 1 (
        echo [ERROR] Failed to install backend dependencies. See error above.
        pause
        exit /b 1
    )
    echo [OK]    Backend dependencies ready
) else (
    echo [OK]    Virtual environment ready
)

:: -- PRODUCTION MODE -----------------------------------------

if /i NOT "%MODE%"=="dev" (

    :: Build frontend if static dir is missing
    if not exist "%BACKEND%\static\index.html" (
        where node >nul 2>&1
        if errorlevel 1 (
            echo [ERROR] Frontend not built and Node.js not found. Install Node from https://nodejs.org or copy pre-built dist/ into backend\static\.
            pause
            exit /b 1
        )
        echo [INFO]  Building frontend...
        cd /d "%FRONTEND%"
        if not exist "%FRONTEND%\node_modules" (
            call npm install --silent
        )
        call npm run build
        if errorlevel 1 (
            echo [ERROR] Frontend build failed.
            pause
            exit /b 1
        )
        if not exist "%BACKEND%\static" mkdir "%BACKEND%\static"
        xcopy /s /e /y "%FRONTEND%\dist\*" "%BACKEND%\static\" >nul
        echo [OK]    Frontend built
    )

    :: Kill anything on port 8000
    for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":8000 "') do (
        taskkill /f /pid %%a >nul 2>&1
    )

    echo.
    echo ============================================
    echo   Director Assistant - Production
    echo   http://localhost:8000
    echo   Press Ctrl+C to stop
    echo ============================================
    echo.

    :: Open browser after 3 seconds
    start "" cmd /c "timeout /t 3 >nul && start http://localhost:8000"

    cd /d "%BACKEND%"
    "%BACKEND%\.venv\Scripts\python.exe" -m uvicorn main:app --host 0.0.0.0 --port 8000

) else (

    :: -- DEV MODE --------------------------------------------

    :: Kill anything on port 8000
    for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":8000 "') do (
        taskkill /f /pid %%a >nul 2>&1
    )

    where node >nul 2>&1
    if errorlevel 1 (
        echo [ERROR] Node.js not found. Dev mode requires Node. Install from https://nodejs.org
        pause
        exit /b 1
    )

    :: Install frontend deps if needed
    if not exist "%FRONTEND%\node_modules" (
        echo [INFO]  Installing frontend dependencies...
        cd /d "%FRONTEND%"
        call npm install --silent
    )

    echo.
    echo ============================================
    echo   Director Assistant - Dev Mode
    echo   Frontend: http://localhost:5173
    echo   Backend:  http://localhost:8000
    echo   Close this window to stop both
    echo ============================================
    echo.

    :: Start backend in a new window
    :: /D sets the working directory so relative venv paths work without nested quotes
    start "Director Assistant - Backend" /D "%BACKEND%" cmd /k "call .venv\Scripts\activate.bat && .venv\Scripts\python.exe -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload"

    :: Open browser after 4 seconds
    start "" cmd /c "timeout /t 4 >nul && start http://localhost:5173"

    :: Start frontend dev server (this window)
    cd /d "%FRONTEND%"
    call npm run dev

)

endlocal
