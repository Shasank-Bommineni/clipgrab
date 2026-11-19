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

:: 3. Auto-Update ClipGrab & Dependencies Forever (Non-Technical Friendly)
where git >nul 2>nul
if %errorlevel% equ 0 (
    if exist ".git" (
        echo [*] Auto-updating ClipGrab app to latest version...
        git pull --quiet --ff-only 2>nul
    )
)

echo [*] Auto-updating YouTube engine (yt-dlp) to latest version...
.venv\Scripts\python.exe -m pip install --upgrade yt-dlp -r requirements.txt --quiet --disable-pip-version-check
if errorlevel 1 (
    echo [ERROR] Failed to update dependencies.
    pause
    exit /b 1
)

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
