"""
ClipGrab Download & Processing Pipeline
Handles yt-dlp segment fetching, stream extraction, and FFmpeg muxing/transcoding.
"""

import os
import re
import sys
import json
import shutil
import subprocess
from pathlib import Path
from typing import Dict, Any, Optional, Callable, List

import time
import threading
import yt_dlp
from yt_dlp.utils import download_range_func, DownloadCancelled

from hardware import find_ffmpeg, find_ffprobe, detect_hardware_encoder

PROJECT_ROOT = Path(__file__).resolve().parent
DEFAULT_DOWNLOADS = PROJECT_ROOT / "downloads"

def sanitize_filename(name: str) -> str:
    """Sanitize strings for Windows filenames and limit length."""
    # Replace illegal characters
    cleaned = re.sub(r'[\\/*?:"<>|]', '', name)
    cleaned = re.sub(r'\s+', ' ', cleaned).strip()
    return cleaned[:100] if len(cleaned) > 100 else cleaned

def seconds_to_hms(seconds: float) -> str:
    """Convert seconds to HH-MM-SS string for filenames."""
    s = int(seconds)
    h = s // 3600
    m = (s % 3600) // 60
    sec = s % 60
    if h > 0:
        return f"{h:02d}-{m:02d}-{sec:02d}"
    return f"{m:02d}-{sec:02d}"

def get_js_runtimes() -> Dict[str, Any]:
    """Find installed JS runtimes (Node, Bun) to prevent yt-dlp extraction warnings and speed up extraction."""
    runtimes = {}
    node_path = shutil.which("node")
    if node_path:
        runtimes["node"] = {"path": node_path}
    bun_path = Path.home() / ".bun" / "bin" / ("bun.exe" if sys.platform == "win32" else "bun")
    if bun_path.exists():
        runtimes["bun"] = {"path": str(bun_path)}
    elif shutil.which("bun"):
        runtimes["bun"] = {"path": shutil.which("bun")}
    return runtimes

def get_video_info(url: str) -> Dict[str, Any]:
    """
    Extract video metadata, available qualities, and thumbnail.
    """
    ffmpeg_path = find_ffmpeg()
    ydl_opts: Dict[str, Any] = {
        'skip_download': True,
        'quiet': True,
        'no_warnings': True,
    }
    if ffmpeg_path:
        ydl_opts['ffmpeg_location'] = os.path.dirname(ffmpeg_path)

    js_runtimes = get_js_runtimes()
    if js_runtimes:
        ydl_opts['js_runtimes'] = js_runtimes

    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        info = ydl.extract_info(url, download=False)
        if not info:
            raise ValueError("Could not extract video metadata from URL.")

        if info.get('is_live'):
            raise ValueError("Livestreams and premieres are not supported for clipping.")

        duration = info.get('duration') or 0
        formats = info.get('formats', [])

        # Collect available video resolutions (heights)
        heights = set()
        for f in formats:
            h = f.get('height')
            vcodec = f.get('vcodec', 'none')
            if h and vcodec != 'none':
                heights.add(int(h))

        sorted_heights = sorted(list(heights), reverse=True)
        # Filter common editorial resolutions
        target_resolutions = [h for h in [2160, 1440, 1080, 720, 480, 360] if h in sorted_heights]
        if not target_resolutions and sorted_heights:
            target_resolutions = sorted_heights

        has_2160p = any(h >= 2160 for h in sorted_heights)
        has_1440p = any(h >= 1440 for h in sorted_heights)
        has_1080p = any(h >= 1080 for h in sorted_heights)
        
        default_q = "2160" if has_2160p else ("1440" if has_1440p else ("1080" if has_1080p else (str(sorted_heights[0]) if sorted_heights else "720")))

        return {
            "id": info.get("id"),
            "title": info.get("title", "YouTube Video"),
            "clean_title": sanitize_filename(info.get("title", "YouTube Video")),
            "duration": float(duration),
            "thumbnail": info.get("thumbnail"),
            "channel": info.get("uploader") or info.get("channel") or "Unknown Channel",
            "available_heights": target_resolutions,
            "has_2160p": has_2160p,
            "has_1440p": has_1440p,
            "has_1080p": has_1080p,
            "default_quality": default_q,
        }

def get_media_probe(filepath: str) -> Dict[str, Any]:
    """
    Run ffprobe on an output file to extract verified technical specifications.
    """
    ffprobe_path = find_ffprobe()
    if not ffprobe_path or not os.path.exists(filepath):
        return {"error": "ffprobe not found or file does not exist"}

    try:
        cmd = [
            ffprobe_path,
            "-v", "quiet",
            "-print_format", "json",
            "-show_format",
            "-show_streams",
            filepath
        ]
        result = subprocess.run(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            timeout=10,
            creationflags=subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0
        )
        data = json.loads(result.stdout)
        
        format_info = data.get("format", {})
        streams = data.get("streams", [])

        v_stream = next((s for s in streams if s.get("codec_type") == "video"), {})
        a_stream = next((s for s in streams if s.get("codec_type") == "audio"), {})

        # Calculate FPS from r_frame_rate e.g. "60/1"
        fps = 0.0
        r_rate = v_stream.get("r_frame_rate", "0/1")
        if "/" in r_rate:
            num, den = r_rate.split("/")
            if float(den) > 0:
                fps = round(float(num) / float(den), 2)

        return {
            "duration": round(float(format_info.get("duration", 0)), 2),
            "size_mb": round(float(format_info.get("size", 0)) / (1024 * 1024), 2),
            "bitrate_kbps": round(float(format_info.get("bit_rate", 0)) / 1000, 1) if format_info.get("bit_rate") else None,
            "video_codec": v_stream.get("codec_name", "unknown"),
            "width": v_stream.get("width"),
            "height": v_stream.get("height"),
            "fps": fps,
            "audio_codec": a_stream.get("codec_name", "unknown"),
            "audio_sample_rate": a_stream.get("sample_rate"),
            "audio_channels": a_stream.get("channels"),
        }
    except Exception as e:
        return {"error": str(e)}

def download_clip(
    url: str,
    start_sec: float,
    end_sec: float,
    quality: str = "1440",
    mode: str = "lossless",
    output_dir: Optional[str] = None,
    custom_filename: Optional[str] = None,
    progress_callback: Optional[Callable[[Dict[str, Any]], None]] = None,
    cancel_event: Optional[Any] = None,
    process_tracker: Optional[Callable[[Optional[subprocess.Popen]], None]] = None
) -> Dict[str, Any]:
    """
    Download a precise section of a YouTube video using segment fetching.
    Modes:
      - 'lossless': Stream-copy directly into .mkv (instant, zero re-encode).
      - 'edit_ready': Hardware accelerated transcode into .mp4 (H.264 + 48kHz AAC).
    """
    if start_sec >= end_sec:
        raise ValueError("Start time must be less than end time.")
    if start_sec < 0:
        raise ValueError("Start time cannot be negative.")

    target_dir = Path(output_dir) if output_dir else DEFAULT_DOWNLOADS
    target_dir.mkdir(parents=True, exist_ok=True)

    ffmpeg_path = find_ffmpeg()
    if not ffmpeg_path:
        raise RuntimeError("FFmpeg is required for segment cutting but was not found.")

    ffmpeg_dir = os.path.dirname(ffmpeg_path)

    # 1. Fetch metadata
    if progress_callback:
        progress_callback({"phase": "initializing", "percent": 5, "message": "Fetching stream metadata..."})

    info = get_video_info(url)
    clean_title = sanitize_filename(custom_filename or info["clean_title"])
    time_tag = f"{seconds_to_hms(start_sec)}_to_{seconds_to_hms(end_sec)}"
    base_name = f"{clean_title}_{time_tag}"

    def cleanup_files():
        """Clean up partial files if cancelled or failed."""
        for p in target_dir.glob(f"{base_name}*"):
            try:
                if p.is_file():
                    p.unlink(missing_ok=True)
            except Exception:
                pass

    # Check for early cancellation
    if cancel_event and cancel_event.is_set():
        cleanup_files()
        return {"success": False, "cancelled": True, "message": "Download cancelled"}

    # Format selector: Prioritize rate-bypassed HLS streams for 30x+ download speeds,
    # falling back to highest available DASH streams.
    if quality == "best":
        fmt = (
            "bestvideo[protocol^=m3u8]+bestaudio[protocol^=m3u8]/"
            "best[protocol^=m3u8]/"
            "bv*+ba/b"
        )
    else:
        fmt = (
            f"bestvideo[protocol^=m3u8][height<={quality}]+bestaudio[protocol^=m3u8]/"
            f"best[protocol^=m3u8][height<={quality}]/"
            f"bv*[height<={quality}]+ba/b"
        )

    # Sorting preference: resolution, VP9/AV1, Opus audio
    format_sort = [f"res:{quality}", "vcodec:vp9", "vcodec:av01", "acodec:opus", "abr"]

    # Progress hook adapter for yt-dlp
    def ytdl_hook(d: Dict[str, Any]):
        if cancel_event and cancel_event.is_set():
            raise yt_dlp.utils.DownloadCancelled("Download cancelled by user")

        if not progress_callback:
            return
        status = d.get("status")
        if status == "downloading":
            speed = d.get("_speed_str") or "Downloading..."
            eta = d.get("_eta_str") or ""
            
            # Check fragment count if DASH/HLS
            if d.get("fragment_count") and d.get("fragment_index"):
                f_idx = d["fragment_index"]
                f_cnt = d["fragment_count"]
                pct = min(88, max(10, int((f_idx / f_cnt) * 78) + 10))
                msg = f"Fetching fragments ({f_idx}/{f_cnt}) • {speed}"
            else:
                total = d.get("total_bytes") or d.get("total_bytes_estimate") or 1
                downloaded = d.get("downloaded_bytes", 0)
                pct = min(88, max(10, int((downloaded / total) * 78) + 10))
                msg = f"Fetching stream ({speed})"

            progress_callback({
                "phase": "downloading",
                "percent": pct,
                "speed": speed,
                "eta": eta,
                "message": msg
            })
        elif status == "finished":
            progress_callback({
                "phase": "processing",
                "percent": 88,
                "message": "Finalizing media muxing..."
            })

    js_runtimes = get_js_runtimes()

    clip_dur = max(1.0, end_sec - start_sec)
    target_height = int(quality) if quality.isdigit() else (2160 if info.get("has_2160p") else (1440 if info.get("has_1440p") else 1080))
    mb_per_sec = 3.8 if target_height >= 2160 else (2.0 if target_height >= 1440 else (0.9 if target_height >= 1080 else 0.4))
    estimated_total_bytes = max(1024 * 1024, int(clip_dur * mb_per_sec * 1024 * 1024))

    # Active monitor during yt-dlp download to provide continuous progress updates
    def run_with_monitor(ydl_instance, target_url):
        stop_mon = threading.Event()

        def monitor_task():
            last_sz = 0
            last_t = time.time()
            smooth_speed_mb = 0.0

            while not stop_mon.wait(0.4):
                if cancel_event and cancel_event.is_set():
                    break
                part_files = list(target_dir.glob(f"{base_name}*"))
                if part_files and progress_callback:
                    try:
                        active_parts = [p for p in part_files if p.name.endswith(".part")]
                        target_p = active_parts[0] if active_parts else part_files[0]
                        cur_sz = target_p.stat().st_size
                        now = time.time()
                        dt = now - last_t
                        if dt >= 0.35 and cur_sz > 0:
                            inst_speed_bps = (cur_sz - last_sz) / dt if cur_sz >= last_sz else 0
                            inst_speed_mb = inst_speed_bps / (1024 * 1024)

                            if smooth_speed_mb == 0.0:
                                smooth_speed_mb = inst_speed_mb
                            else:
                                smooth_speed_mb = 0.65 * smooth_speed_mb + 0.35 * inst_speed_mb

                            size_mb = cur_sz / (1024 * 1024)
                            speed_str = f"{smooth_speed_mb:.1f} MiB/s" if smooth_speed_mb >= 1.0 else f"{int(smooth_speed_mb * 1024)} KiB/s"

                            pct_ratio = min(0.98, cur_sz / float(estimated_total_bytes))
                            pct = min(88, max(10, int(10 + pct_ratio * 78)))

                            rem_bytes = max(0, estimated_total_bytes - cur_sz)
                            smooth_speed_bps = smooth_speed_mb * 1024 * 1024
                            if smooth_speed_bps > 50000 and rem_bytes > 0:
                                eta_sec = int(rem_bytes / smooth_speed_bps)
                                if eta_sec > 60:
                                    eta_str = f"{eta_sec // 60}m {eta_sec % 60}s"
                                else:
                                    eta_str = f"{eta_sec}s"
                            else:
                                eta_str = ""

                            progress_callback({
                                "phase": "downloading",
                                "percent": pct,
                                "speed": speed_str,
                                "eta": eta_str,
                                "message": f"Fetching stream ({pct}% • {size_mb:.1f} MB • {speed_str}{f' • ETA: {eta_str}' if eta_str else ''})"
                            })
                            last_sz = cur_sz
                            last_t = now
                    except Exception:
                        pass

        mon_thread = threading.Thread(target=monitor_task, daemon=True)
        mon_thread.start()
        try:
            ydl_instance.download([target_url])
        finally:
            stop_mon.set()
            mon_thread.join(timeout=1.0)

    try:
        # Execute based on mode
        if mode == "lossless":
            final_file = target_dir / f"{base_name}.mkv"
            ydl_opts: Dict[str, Any] = {
                'format': fmt,
                'format_sort': format_sort,
                'download_ranges': download_range_func(None, [(start_sec, end_sec)]),
                'force_keyframes_at_cuts': False,
                'concurrent_fragment_downloads': 8,
                'buffersize': 1024 * 1024,
                'http_chunk_size': 10485760,
                'outtmpl': str(target_dir / f"{base_name}.%(ext)s"),
                'merge_output_format': 'mkv',
                'ffmpeg_location': ffmpeg_dir,
                'downloader_args': {'ffmpeg_i': ['-reconnect', '1', '-reconnect_streamed', '1', '-reconnect_delay_max', '5']},
                'progress_hooks': [ytdl_hook],
                'quiet': True,
                'overwrites': True,
            }
            if js_runtimes:
                ydl_opts['js_runtimes'] = js_runtimes

            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                run_with_monitor(ydl, url)

            if cancel_event and cancel_event.is_set():
                cleanup_files()
                return {"success": False, "cancelled": True, "message": "Download cancelled"}

            if not final_file.exists():
                candidates = list(target_dir.glob(f"{base_name}.*"))
                if candidates:
                    final_file = candidates[0]

        else:
            # Edit-Ready Mode: Download with 3s padding, then frame-accurate transcode via GPU
            pad_start = max(0.0, start_sec - 3.0)
            pad_end = end_sec + 3.0
            offset_trim = start_sec - pad_start
            clip_duration = end_sec - start_sec

            temp_file = target_dir / f"{base_name}_temp.mkv"
            final_file = target_dir / f"{base_name}.mp4"

            ydl_opts = {
                'format': fmt,
                'format_sort': format_sort,
                'download_ranges': download_range_func(None, [(pad_start, pad_end)]),
                'force_keyframes_at_cuts': False,
                'concurrent_fragment_downloads': 8,
                'buffersize': 1024 * 1024,
                'http_chunk_size': 10485760,
                'outtmpl': str(target_dir / f"{base_name}_temp.%(ext)s"),
                'merge_output_format': 'mkv',
                'ffmpeg_location': ffmpeg_dir,
                'downloader_args': {'ffmpeg_i': ['-reconnect', '1', '-reconnect_streamed', '1', '-reconnect_delay_max', '5']},
                'progress_hooks': [ytdl_hook],
                'quiet': True,
                'overwrites': True,
            }
            if js_runtimes:
                ydl_opts['js_runtimes'] = js_runtimes

            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                run_with_monitor(ydl, url)

            if cancel_event and cancel_event.is_set():
                cleanup_files()
                return {"success": False, "cancelled": True, "message": "Download cancelled"}

            if not temp_file.exists():
                candidates = list(target_dir.glob(f"{base_name}_temp.*"))
                if candidates:
                    temp_file = candidates[0]

            if progress_callback:
                progress_callback({
                    "phase": "transcoding",
                    "percent": 88,
                    "message": "GPU Transcoding to Edit-Ready MP4..."
                })

            # Hardware transcode
            enc_info = detect_hardware_encoder(ffmpeg_path)
            enc_flags = enc_info["flags"]

            cmd = [
                ffmpeg_path,
                "-y",
                "-hwaccel", "auto",
                "-ss", f"{offset_trim:.3f}",
                "-i", str(temp_file),
                "-t", f"{clip_duration:.3f}",
                *enc_flags,
                "-pix_fmt", "yuv420p",
                "-c:a", "aac",
                "-b:a", "320k",
                "-ar", "48000",
                "-progress", "pipe:1",
                "-nostats",
                "-movflags", "+faststart",
                str(final_file)
            ]

            proc = subprocess.Popen(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                creationflags=subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0
            )
            if process_tracker:
                process_tracker(proc)

            last_output_lines = []
            try:
                for line in proc.stdout:
                    if cancel_event and cancel_event.is_set():
                        proc.terminate()
                        try:
                            proc.wait(timeout=2)
                        except Exception:
                            proc.kill()
                        cleanup_files()
                        return {"success": False, "cancelled": True, "message": "Transcode cancelled"}

                    line = line.strip()
                    last_output_lines.append(line)
                    if len(last_output_lines) > 25:
                        last_output_lines.pop(0)

                    if line.startswith("out_time_us="):
                        try:
                            us = int(line.split("=")[1])
                            sec = us / 1_000_000
                            if clip_duration > 0:
                                t_pct = min(100, max(0, int((sec / clip_duration) * 100)))
                                overall_pct = min(97, 88 + int(t_pct * 0.09))
                                if progress_callback:
                                    progress_callback({
                                        "phase": "transcoding",
                                        "percent": overall_pct,
                                        "speed": "GPU Accelerated",
                                        "message": f"GPU Transcoding to Edit-Ready MP4 ({t_pct}%)..."
                                    })
                        except Exception:
                            pass

                proc.wait()
                if proc.returncode != 0 and (not cancel_event or not cancel_event.is_set()):
                    err_msg = "\n".join(last_output_lines)
                    raise RuntimeError(f"FFmpeg transcode failed: {err_msg}")
            finally:
                if process_tracker:
                    process_tracker(None)
                if temp_file.exists():
                    temp_file.unlink(missing_ok=True)

            if cancel_event and cancel_event.is_set():
                cleanup_files()
                return {"success": False, "cancelled": True, "message": "Transcode cancelled"}

    except yt_dlp.utils.DownloadCancelled:
        cleanup_files()
        return {"success": False, "cancelled": True, "message": "Download cancelled by user"}

    # Final probe report
    if progress_callback:
        progress_callback({"phase": "verifying", "percent": 98, "message": "Auditing stream quality..."})

    probe_data = get_media_probe(str(final_file))

    if progress_callback:
        progress_callback({
            "phase": "completed",
            "percent": 100,
            "message": "Clip saved successfully!",
            "file_path": str(final_file),
            "probe": probe_data
        })

    return {
        "success": True,
        "file_path": str(final_file),
        "file_name": final_file.name,
        "mode": mode,
        "probe": probe_data
    }
