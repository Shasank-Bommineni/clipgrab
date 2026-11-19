# ⚡ ClipGrab: 1440p High-Speed YouTube Clipper

> **A local, fast, uncompromisingly high-quality YouTube clipping studio for video editors.**  
> Downloads only the exact segment you select (never the full 4-hour video), with zero generation loss and automatic GPU acceleration.

---

## 🚀 1-Click Launch (For Freelancers & Friends)

No complex setup, no terminal commands required.

1. **Download / Clone** this repository:
   ```bash
   git clone https://github.com/<your-username>/clipgrab.git
   ```
   *(Or click **Code** → **Download ZIP** on GitHub and extract the folder).*
2. **Double-click `start.bat`**.
3. That's it! The launcher automatically:
   - Sets up the isolated Python virtual environment.
   - Installs required dependencies.
   - Automatically provisions portable FFmpeg if missing.
   - Launches your default browser to `http://localhost:8000`.

---

## 🎯 Why ClipGrab is Different

### 1. ⏱️ Segment-Only Fetching (Never Wait for Full 4-Hour Videos)
Traditional downloaders force you to download the entire 6–10 GB file just to grab 30 seconds.  
ClipGrab uses `yt-dlp`'s chunk-range downloader with **8 concurrent streams** to fetch **only the requested byte range** directly from YouTube's CDN. A 30-second cut from a 3-hour 1440p video downloads in **10–25 seconds**.

### 2. 💎 Two Precision Export Modes

| Mode | Format | Re-encode Time | Quality | Best Used For |
| :--- | :--- | :--- | :--- | :--- |
| **⚡ Original Lossless** *(Default)* | `.mkv` | **0 Seconds (~2s to save)** | **100% Bit-for-Bit** (VP9/AV1 + Opus) | DaVinci Resolve Studio, VLC, pristine archiving |
| **🎬 Edit-Ready Fast** | `.mp4` | **~20–30s (200+ FPS via GPU)** | **High Profile H.264 + 48kHz AAC** | Premiere Pro, After Effects, Final Cut Pro |

### 3. 🏎️ Universal Hardware Acceleration Auto-Detection
ClipGrab detects your specific laptop's hardware on startup and picks the fastest operational encoder:
- **NVIDIA GPU**: `h264_nvenc` (P6 High Quality, CQ 16)
- **Intel CPU / Iris / UHD**: `h264_qsv` (Intel QuickSync)
- **AMD Radeon / APU**: `h264_amf` (AMD Video Coding Engine)
- **CPU Fallback**: `libx264` (Preset veryfast)

### 4. 🎛️ Triple-Tier Precision Scrubbing
On a 3–4 hour video, a standard slider has 1 pixel representing 15+ seconds. ClipGrab solves this with:
1. **Macro Dual-Handle Scrubber**: Navigate the whole video from 0 to Duration.
2. **Precision Zoom Scrubber**: Automatically magnifies a **±60-second window** around your active handle so 1 pixel is ~0.1s.
3. **Nudge Buttons**: Step forward or backward by `±0.1s`, `±1s`, or `±5s`.
4. **Direct H:M:S.ms Inputs**: Enter exact Hours, Minutes, Seconds, and Milliseconds.
5. **Interactive Preview**: YouTube IFrame Player with instant frame seeking and **"▶ Preview Selection"** looping.

### 5. 🔍 Post-Download Technical Quality Audit
After each cut, ClipGrab runs an automated `ffprobe` inspection badge showing:
- Verified Resolution (e.g. `2560x1440`)
- Codec (`VP9` or `H.264`)
- Real Frame Rate (`60 fps`)
- Audio Sample Rate (`48000 Hz Stereo`)
- Exact Duration and File Size

### 6. 🔄 One-Click yt-dlp Auto-Updater
YouTube changes its streaming algorithms frequently. When downloads slow down or break, simply click the **"🔄 Update yt-dlp"** button in the header to pull the newest extraction patches directly.

---

## 🛠️ Tech Stack
- **Backend**: Python 3.10+, FastAPI, Uvicorn
- **Streaming Engine**: `yt-dlp` (segment ranges + concurrent fragment downloads)
- **Muxing & Transcoding**: FFmpeg & FFprobe (with NVENC, QuickSync, AMF support)
- **Live Progress**: Server-Sent Events (SSE)
- **Frontend**: Vanilla HTML5, Studio Dark CSS, Vanilla ES6 JS (No build tools, instant load)

---

## 📁 Project Structure

```text
clipgrab/
├── app.py                # FastAPI routes & SSE progress broadcaster
├── downloader.py         # yt-dlp segment fetcher & FFmpeg GPU pipeline
├── jobs.py               # Thread-safe in-memory job queue
├── hardware.py           # Universal GPU hardware acceleration detector
├── requirements.txt      # Python dependencies
├── start.bat             # 1-click Windows double-click launcher
├── static/
│   ├── index.html        # Single-page studio interface
│   ├── app.js            # Scrubber sync engine & IFrame player controller
│   └── style.css         # Dark studio theme
└── tests/                # Automated pytest suite
```

---

## 🧪 Running Automated Tests

To run the complete test suite:
```bash
.venv\Scripts\python.exe -m pytest
```

---

## 📄 License
MIT License. Built for creators and editors.
