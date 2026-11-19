$ProgressPreference = 'SilentlyContinue'
$ErrorActionPreference = 'Stop'

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$binDir = Join-Path $scriptDir "bin"
$tempDir = Join-Path $scriptDir "temp"
$zipPath = Join-Path $tempDir "ffmpeg.zip"

if (-not (Test-Path $binDir)) {
    New-Item -ItemType Directory -Path $binDir -Force | Out-Null
}
if (-not (Test-Path $tempDir)) {
    New-Item -ItemType Directory -Path $tempDir -Force | Out-Null
}

try {
    Write-Host "Downloading FFmpeg essentials..."
    Invoke-WebRequest -Uri "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip" -OutFile $zipPath
    
    Write-Host "Extracting binaries..."
    $extractPath = Join-Path $tempDir "extracted"
    Expand-Archive -Path $zipPath -DestinationPath $extractPath -Force
    
    $binFolder = Get-ChildItem -Path $extractPath -Filter "bin" -Recurse | Select-Object -First 1
    if ($binFolder) {
        Copy-Item -Path (Join-Path $binFolder.FullName "ffmpeg.exe") -Destination (Join-Path $binDir "ffmpeg.exe") -Force
        Copy-Item -Path (Join-Path $binFolder.FullName "ffprobe.exe") -Destination (Join-Path $binDir "ffprobe.exe") -Force
        Write-Host "FFmpeg setup complete!"
    }
} catch {
    Write-Warning "Auto-download of FFmpeg failed: $_"
} finally {
    if (Test-Path $tempDir) {
        Remove-Item -Recurse -Force $tempDir -ErrorAction SilentlyContinue
    }
}
