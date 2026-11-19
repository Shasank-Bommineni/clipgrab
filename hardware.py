"""
ClipGrab Hardware & FFmpeg Auto-Detection Engine
Detects FFmpeg, FFprobe, and selects the fastest operational video encoder
(NVIDIA NVENC -> Intel QSV -> AMD AMF -> CPU libx264 fallback).
"""

import os
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Dict, Any, Optional, List

PROJECT_ROOT = Path(__file__).resolve().parent

def find_ffmpeg() -> Optional[str]:
    """Locate ffmpeg binary in local bin/ or system PATH."""
    local_bin = PROJECT_ROOT / "bin" / ("ffmpeg.exe" if sys.platform == "win32" else "ffmpeg")
    if local_bin.exists():
        return str(local_bin)
    system_path = shutil.which("ffmpeg")
    return system_path

def find_ffprobe() -> Optional[str]:
    """Locate ffprobe binary in local bin/ or system PATH."""
    local_bin = PROJECT_ROOT / "bin" / ("ffprobe.exe" if sys.platform == "win32" else "ffprobe")
    if local_bin.exists():
        return str(local_bin)
    system_path = shutil.which("ffprobe")
    return system_path

def test_encoder_operational(ffmpeg_path: str, encoder_name: str) -> bool:
    """Test encode a single dummy frame to verify driver and hardware readiness."""
    try:
        cmd = [
            ffmpeg_path,
            "-hide_banner",
            "-loglevel", "error",
            "-f", "lavfi",
            "-i", "color=c=black:s=64x64:d=0.04",
            "-c:v", encoder_name,
            "-f", "null",
            "-"
        ]
        result = subprocess.run(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=5,
            creationflags=subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0
        )
        return result.returncode == 0
    except Exception:
        return False

def get_available_encoders(ffmpeg_path: Optional[str] = None) -> List[str]:
    """Parse output of ffmpeg -encoders to find compiled video encoders."""
    if not ffmpeg_path:
        ffmpeg_path = find_ffmpeg()
    if not ffmpeg_path:
        return []

    try:
        result = subprocess.run(
            [ffmpeg_path, "-encoders", "-hide_banner"],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            timeout=5,
            creationflags=subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0
        )
        encoders = []
        for line in result.stdout.splitlines():
            line = line.strip()
            if line.startswith("V") and len(line.split()) >= 2:
                # Format: V..... encoder_name description
                parts = line.split()
                encoders.append(parts[1])
        return encoders
    except Exception:
        return []

def detect_hardware_encoder(ffmpeg_path: Optional[str] = None) -> Dict[str, Any]:
    """
    Detect the best operational encoder on this machine.
    Hierarchy:
      1. NVIDIA NVENC (h264_nvenc) - Ultra fast (200-300+ FPS)
      2. Intel QuickSync (h264_qsv) - Very fast (100-180 FPS)
      3. AMD AMF (h264_amf) - Fast (100+ FPS)
      4. CPU libx264 - Reliable fallback
    """
    if not ffmpeg_path:
        ffmpeg_path = find_ffmpeg()

    if not ffmpeg_path:
        return {
            "encoder": "libx264",
            "name": "CPU (FFmpeg Missing)",
            "is_hardware": False,
            "flags": ["-preset", "veryfast", "-crf", "17"],
            "operational": False,
            "error": "FFmpeg not found on system"
        }

    available = get_available_encoders(ffmpeg_path)

    # Candidate list in priority order
    candidates = [
        {
            "encoder": "h264_nvenc",
            "name": "NVIDIA NVENC (GPU Accelerated)",
            "is_hardware": True,
            "flags": ["-c:v", "h264_nvenc", "-preset", "p6", "-tune", "hq", "-rc", "vbr", "-cq", "16", "-b:v", "0"]
        },
        {
            "encoder": "h264_qsv",
            "name": "Intel QuickSync (GPU Accelerated)",
            "is_hardware": True,
            "flags": ["-c:v", "h264_qsv", "-global_quality", "16", "-preset", "veryfast"]
        },
        {
            "encoder": "h264_amf",
            "name": "AMD AMF (GPU Accelerated)",
            "is_hardware": True,
            "flags": ["-c:v", "h264_amf", "-rc", "cqp", "-qp_p", "16", "-qp_i", "16", "-quality", "speed"]
        },
        {
            "encoder": "libx264",
            "name": "CPU libx264 (Software)",
            "is_hardware": False,
            "flags": ["-c:v", "libx264", "-preset", "veryfast", "-crf", "17"]
        }
    ]

    for candidate in candidates:
        enc_id = candidate["encoder"]
        if enc_id in available:
            # Verify driver/hardware readiness
            if test_encoder_operational(ffmpeg_path, enc_id):
                return {
                    "encoder": enc_id,
                    "name": candidate["name"],
                    "is_hardware": candidate["is_hardware"],
                    "flags": candidate["flags"],
                    "operational": True
                }

    # Ultimate fallback
    return {
        "encoder": "libx264",
        "name": "CPU libx264 (Software)",
        "is_hardware": False,
        "flags": ["-c:v", "libx264", "-preset", "veryfast", "-crf", "17"],
        "operational": True
    }

def get_system_specs() -> Dict[str, Any]:
    """Return complete system hardware diagnostic information."""
    ffmpeg_p = find_ffmpeg()
    ffprobe_p = find_ffprobe()
    encoder_info = detect_hardware_encoder(ffmpeg_p)

    ffmpeg_version = "Unknown"
    if ffmpeg_p:
        try:
            res = subprocess.run(
                [ffmpeg_p, "-version"],
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                timeout=3,
                creationflags=subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0
            )
            ffmpeg_version = res.stdout.splitlines()[0] if res.stdout else "Unknown"
        except Exception:
            pass

    return {
        "ffmpeg_installed": ffmpeg_p is not None,
        "ffmpeg_path": ffmpeg_p,
        "ffprobe_installed": ffprobe_p is not None,
        "ffprobe_path": ffprobe_p,
        "ffmpeg_version": ffmpeg_version,
        "encoder": encoder_info["encoder"],
        "encoder_name": encoder_info["name"],
        "is_hardware": encoder_info["is_hardware"],
        "python_version": sys.version.split()[0],
    }

if __name__ == "__main__":
    import json
    print(json.dumps(get_system_specs(), indent=2))
