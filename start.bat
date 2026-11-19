@echo off
setlocal
cd /d "%~dp0"
title ClipGrab - 1440p High-Speed YouTube Clipper

echo =======================================================
echo          ClipGrab - 1440p YouTube Clipper
echo =======================================================
echo.

:: 1. Check Python
set "PY_CMD="
where python >nul 2>nul
if %errorlevel% equ 0 set "PY_CMD=python"
if not defined PY_CMD (
    where py >nul 2>nul
    if %errorlevel% equ 0 set "PY_CMD=py"
)

if not defined PY_CMD (
    echo [ERROR] Python is not installed or not in your system PATH!
    echo Please install Python 3.10+ from https://www.python.org/
    echo IMPORTANT: Make sure to check Add Python to PATH during installation.
    start https://www.python.org/downloads/
    pause
    exit /b 1
)

:: 2. Check Virtual Environment
if not exist ".venv\Scripts\python.exe" (
    echo [*] Creating virtual environment...
    %PY_CMD% -m venv .venv
    if errorlevel 1 (
        echo [ERROR] Failed to create virtual environment.
        pause
        exit /b 1
    )
)

:: 2.5 Auto-Update ClipGrab from GitHub (for non-technical users)
where git >nul 2>nul
if %errorlevel% equ 0 (
    if exist ".git" (
        echo [*] Auto-updating ClipGrab to latest version...
        git pull origin main --quiet 2>nul
    )
)

:: 3. Install & Auto-Update Dependencies
echo [*] Checking dependencies & auto-updating yt-dlp...
.venv\Scripts\python.exe -m pip install -r requirements.txt --quiet --disable-pip-version-check 2>nul
.venv\Scripts\python.exe -m pip install --upgrade yt-dlp --quiet --disable-pip-version-check 2>nul

:: 4. Check FFmpeg
if exist "bin\ffmpeg.exe" goto :start_server
where ffmpeg >nul 2>nul
if %errorlevel% equ 0 goto :start_server

echo [*] FFmpeg not found on this machine.
echo [*] Downloading portable static FFmpeg into bin folder...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup_ffmpeg.ps1"

:start_server
echo.
echo [*] Starting ClipGrab server at http://localhost:8000 ...
echo [*] Opening your browser...
echo.

start "" "http://localhost:8000"
.venv\Scripts\python.exe -m uvicorn app:app --host 127.0.0.1 --port 8000 --reload
pause
