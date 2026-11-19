"""Unit tests for hardware auto-detection."""

import os
from hardware import find_ffmpeg, find_ffprobe, get_available_encoders, detect_hardware_encoder, get_system_specs

def test_find_ffmpeg():
    path = find_ffmpeg()
    assert path is not None
    assert os.path.exists(path)

def test_find_ffprobe():
    path = find_ffprobe()
    assert path is not None
    assert os.path.exists(path)

def test_get_available_encoders():
    encoders = get_available_encoders()
    assert isinstance(encoders, list)
    assert len(encoders) > 0
    # Should at least have common encoders
    assert any("264" in enc for enc in encoders)

def test_detect_hardware_encoder():
    info = detect_hardware_encoder()
    assert "encoder" in info
    assert "name" in info
    assert "flags" in info
    assert "is_hardware" in info
    assert info["operational"] is True
    assert len(info["flags"]) > 0

def test_get_system_specs():
    specs = get_system_specs()
    assert specs["ffmpeg_installed"] is True
    assert specs["ffprobe_installed"] is True
    assert isinstance(specs["encoder"], str)
    assert isinstance(specs["python_version"], str)
