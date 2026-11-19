@echo off
setlocal enabledelayedexpansion
title ClipGrab - 1440p High-Speed YouTube Clipper

echo =======================================================
echo          ClipGrab - 1440p YouTube Clipper
echo =======================================================
echo.

:: 1. Check Python
where python >nul 2>nul
if %errorlevel% neq 0 (
    where py >nul 2>nul
    if %errorlevel% neq 0 (
        echo [ERROR] Python is not installed or not in your system PATH!
        echo Please download Python 3.10+ from https://www.python.org/
        echo IMPORTANT: Check the box "Add Python to PATH" during installation.
        start https://www.python.org/downloads/
        pause
        exit /b 1
    ) else (
        set "PY_CMD=py"
    )
) else (
    set "PY_CMD=python"
)

:: 2. Check / Create Virtual Environment
if not exist ".venv\Scripts\python.exe" (
    echo [*] Creating virtual environment (.venv)...
    %PY_CMD% -m venv .venv
    if %errorlevel% neq 0 (
        echo [ERROR] Failed to create virtual environment.
        pause
        exit /b 1
    )
)

:: 3. Install / Verify Dependencies
echo [*] Checking dependencies...
.venv\Scripts\python.exe -m pip install -r requirements.txt --quiet --disable-pip-version-check
if %errorlevel% neq 0 (
    echo [ERROR] Failed to install dependencies.
    pause
    exit /b 1
)

:: 4. Check for FFmpeg (System PATH or local bin/ folder)
set "FFMPEG_FOUND=0"
if exist "bin\ffmpeg.exe" (
    set "FFMPEG_FOUND=1"
) else (
    where ffmpeg >nul 2>nul
    if %errorlevel% equ 0 (
        set "FFMPEG_FOUND=1"
    )
)

if "%FFMPEG_FOUND%"=="0" (
    echo [*] FFmpeg not found on this machine.
    echo [*] Automatically downloading portable static FFmpeg into bin/ folder...
    echo [*] This only happens once. Please wait 15-30 seconds...
    
    if not exist "bin" mkdir bin
    if not exist "temp" mkdir temp
    
    powershell -NoProfile -Command ^
        "$ProgressPreference = 'SilentlyContinue'; " ^
        "Write-Host 'Downloading FFmpeg essentials...'; " ^
        "Invoke-WebRequest -Uri 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip' -OutFile 'temp\ffmpeg.zip'; " ^
        "Write-Host 'Extracting binaries...'; " ^
        "Expand-Archive -Path 'temp\ffmpeg.zip' -DestinationPath 'temp\extracted' -Force; " ^
        "$binFolder = Get-ChildItem -Path 'temp\extracted' -Filter 'bin' -Recurse | Select-Object -First 1; " ^
        "Copy-Item -Path ($binFolder.FullName + '\ffmpeg.exe') -Destination 'bin\ffmpeg.exe' -Force; " ^
        "Copy-Item -Path ($binFolder.FullName + '\ffprobe.exe') -Destination 'bin\ffprobe.exe' -Force; " ^
        "Remove-Item -Recurse -Force 'temp'; " ^
        "Write-Host 'FFmpeg setup complete!'"
        
    if not exist "bin\ffmpeg.exe" (
        echo [WARNING] Automatic FFmpeg download failed. 
        echo You can manually download ffmpeg.exe and put it into the clipgrab\bin folder.
    )
)

:: 5. Launch Browser & Start Server
echo.
echo [*] Starting ClipGrab server at http://localhost:8000 ...
echo [*] Opening your browser...
echo.

start "" "http://localhost:8000"
.venv\Scripts\python.exe -m uvicorn app:app --host 127.0.0.1 --port 8000
pause
