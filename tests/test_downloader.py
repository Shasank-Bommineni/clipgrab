"""Unit tests for downloader and media inspection."""

import os
import subprocess
import pytest
from pathlib import Path

from downloader import sanitize_filename, seconds_to_hms, get_media_probe, download_clip, get_js_runtimes
from hardware import find_ffmpeg

def test_sanitize_filename():
    assert sanitize_filename("Normal Title") == "Normal Title"
    assert sanitize_filename("Video: With * Bad ? Chars /\\|<>") == "Video With Bad Chars"
    long_name = "A" * 150
    assert len(sanitize_filename(long_name)) <= 100

def test_seconds_to_hms():
    assert seconds_to_hms(45) == "00-45"
    assert seconds_to_hms(125) == "02-05"
    assert seconds_to_hms(3665) == "01-01-05"

def test_download_clip_validation():
    with pytest.raises(ValueError, match="Start time must be less than end time"):
        download_clip("https://youtube.com/watch?v=dummy", start_sec=50, end_sec=20)

    with pytest.raises(ValueError, match="Start time cannot be negative"):
        download_clip("https://youtube.com/watch?v=dummy", start_sec=-5, end_sec=20)

def test_get_media_probe_with_synthetic_file(tmp_path):
    ffmpeg_p = find_ffmpeg()
    assert ffmpeg_p is not None

    test_file = tmp_path / "test_synthetic.mp4"
    # Create 0.5s dummy MP4
    cmd = [
        ffmpeg_p,
        "-y",
        "-f", "lavfi",
        "-i", "color=c=red:s=320x240:d=0.5",
        "-f", "lavfi",
        "-i", "anullsrc=r=48000:cl=stereo",
        "-t", "0.5",
        "-c:v", "libx264",
        "-c:a", "aac",
        "-pix_fmt", "yuv420p",
        str(test_file)
    ]
    res = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    assert res.returncode == 0
    assert test_file.exists()

    probe = get_media_probe(str(test_file))
    assert probe.get("duration") is not None
    assert probe.get("width") == 320
    assert probe.get("height") == 240
    assert probe.get("video_codec") == "h264"
    assert probe.get("audio_codec") == "aac"
    assert probe.get("audio_sample_rate") == "48000"
    assert probe.get("audio_channels") == 2

def test_get_js_runtimes():
    runtimes = get_js_runtimes()
    assert isinstance(runtimes, dict)
    # At least node or bun should be detectable on system
    assert "node" in runtimes or "bun" in runtimes
