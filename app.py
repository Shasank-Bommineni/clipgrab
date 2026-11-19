"""
ClipGrab FastAPI Application
REST API and SSE endpoints for 1440p YouTube clipping and system management.
"""

import asyncio
import importlib
import os
import shutil
import subprocess
import sys
import time
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Optional, Dict, Any

from fastapi import FastAPI, HTTPException, Query, Body, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

import yt_dlp

from downloader import get_video_info, get_cookie_opts, DEFAULT_DOWNLOADS
from hardware import get_system_specs
from jobs import job_manager

PROJECT_ROOT = Path(__file__).resolve().parent
STATIC_DIR = PROJECT_ROOT / "static"
STATIC_DIR.mkdir(parents=True, exist_ok=True)

# Persistent Auto-Update State
auto_update_state = {
    "enabled": True,
    "last_checked": None,
    "last_status": "Active (Checking every 12h & on startup)",
    "version": yt_dlp.version.__version__,
    "is_updating": False
}

def run_pip_update() -> Dict[str, Any]:
    """Run pip upgrade on yt-dlp in a background thread."""
    python_exe = sys.executable
    try:
        res = subprocess.run(
            [python_exe, "-m", "pip", "install", "--upgrade", "yt-dlp", "--quiet", "--disable-pip-version-check"],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            timeout=60,
            creationflags=subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0
        )
        try:
            importlib.reload(yt_dlp)
            new_v = yt_dlp.version.__version__
        except Exception:
            new_v = auto_update_state["version"]
        return {
            "success": res.returncode == 0,
            "version": new_v,
            "output": res.stdout or res.stderr
        }
    except Exception as e:
        return {"success": False, "error": str(e), "version": auto_update_state["version"]}

async def auto_update_background_loop():
    """Runs a non-blocking check shortly after boot, then every 12 hours."""
    await asyncio.sleep(5)
    while True:
        try:
            auto_update_state["is_updating"] = True
            loop = asyncio.get_running_loop()
            res = await loop.run_in_executor(None, run_pip_update)
            auto_update_state["last_checked"] = time.time()
            auto_update_state["is_updating"] = False
            if res.get("success"):
                auto_update_state["version"] = res.get("version", auto_update_state["version"])
                auto_update_state["last_status"] = f"Up to date (v{auto_update_state['version']})"
            else:
                auto_update_state["last_status"] = f"Check finished (v{auto_update_state['version']})"
        except Exception as e:
            auto_update_state["is_updating"] = False
            auto_update_state["last_status"] = f"Check skipped: {str(e)}"
        
        await asyncio.sleep(12 * 3600)

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Pre-warm hardware encoder probes and cookie discovery asynchronously
    loop = asyncio.get_running_loop()
    loop.run_in_executor(None, get_system_specs)
    loop.run_in_executor(None, get_cookie_opts)

    update_task = asyncio.create_task(auto_update_background_loop())
    yield
    update_task.cancel()
    try:
        await update_task
    except asyncio.CancelledError:
        pass

app = FastAPI(
    title="ClipGrab",
    description="High-Speed 1440p YouTube Clipper",
    version="1.0.0",
    lifespan=lifespan
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class DownloadRequest(BaseModel):
    url: str
    start: float = Field(..., ge=0, description="Start time in seconds")
    end: float = Field(..., gt=0, description="End time in seconds")
    quality: str = Field(default="1440", description="Target height or 'best'")
    mode: str = Field(default="lossless", description="'lossless' (MKV) or 'edit_ready' (MP4)")
    title: Optional[str] = None
    custom_filename: Optional[str] = None
    output_dir: Optional[str] = None

class OpenFolderRequest(BaseModel):
    file_path: Optional[str] = None

@app.get("/api/system")
def get_system_status():
    """Return hardware acceleration details and tool versions."""
    specs = get_system_specs()
    specs["ytdlp_version"] = yt_dlp.version.__version__
    specs["default_downloads"] = str(DEFAULT_DOWNLOADS)
    return specs

@app.get("/api/info")
def fetch_video_info(url: str = Query(..., description="YouTube video URL")):
    """Extract metadata, available resolutions, and thumbnail."""
    try:
        info = get_video_info(url)
        return info
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch video metadata: {str(e)}")

@app.post("/api/download")
async def start_download(req: DownloadRequest):
    """Enqueue a video clip extraction job."""
    if req.start >= req.end:
        raise HTTPException(status_code=400, detail="Start time must be less than end time.")

    # Non-blocking title resolution
    title = req.custom_filename or req.title or "YouTube Clip"
    if not req.title and not req.custom_filename:
        try:
            loop = asyncio.get_running_loop()
            info = await loop.run_in_executor(None, get_video_info, req.url)
            title = info.get("title", title)
        except Exception:
            pass

    job = job_manager.create_job(
        url=req.url,
        title=title,
        start_sec=req.start,
        end_sec=req.end,
        quality=req.quality,
        mode=req.mode,
        output_dir=req.output_dir,
        custom_filename=req.custom_filename
    )

    loop = asyncio.get_running_loop()
    job_manager.start_job(job.job_id, loop)

    return {"job_id": job.job_id, "status": "queued"}

@app.get("/api/progress/{job_id}")
async def stream_job_progress(job_id: str):
    """Server-Sent Events endpoint streaming real-time progress for a job."""
    job = job_manager.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    return StreamingResponse(
        job_manager.sse_generator(job_id),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no"
        }
    )

@app.get("/api/jobs")
def list_jobs():
    """List all recent jobs with their statuses and probe info."""
    return job_manager.get_all_jobs()

@app.post("/api/jobs/{job_id}/cancel")
def cancel_job(job_id: str):
    """Cancel an active or queued download job."""
    success = job_manager.cancel_job(job_id)
    if not success:
        raise HTTPException(status_code=404, detail="Job not found")
    return {"success": True, "job_id": job_id, "status": "cancelled"}

@app.delete("/api/jobs/{job_id}")
def delete_job(job_id: str):
    """Dismiss a completed, cancelled, or error job from the queue."""
    success = job_manager.remove_job(job_id)
    if not success:
        raise HTTPException(status_code=404, detail="Job not found")
    return {"success": True, "job_id": job_id}

@app.post("/api/jobs/clear")
def clear_finished_jobs():
    """Clear all finished/cancelled jobs from the queue."""
    cleared = job_manager.clear_finished_jobs()
    return {"cleared": cleared}

@app.get("/api/system/autoupdate")
def get_autoupdate_status():
    """Get the persistent auto-update status."""
    return auto_update_state

@app.post("/api/system/autoupdate/check")
async def trigger_autoupdate_check():
    """Force an immediate check for yt-dlp updates."""
    loop = asyncio.get_running_loop()
    res = await loop.run_in_executor(None, run_pip_update)
    auto_update_state["last_checked"] = time.time()
    if res.get("success"):
        auto_update_state["version"] = res.get("version", auto_update_state["version"])
        auto_update_state["last_status"] = f"Up to date (v{auto_update_state['version']})"
    return auto_update_state

@app.post("/api/update-ytdlp")
def update_ytdlp():
    """Update yt-dlp to latest version to handle YouTube extraction changes."""
    python_exe = sys.executable
    try:
        res = subprocess.run(
            [python_exe, "-m", "pip", "install", "--upgrade", "yt-dlp"],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            timeout=45,
            creationflags=subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0
        )
        return {
            "success": res.returncode == 0,
            "output": res.stdout or res.stderr,
            "current_version": yt_dlp.version.__version__
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Update failed: {str(e)}")

@app.post("/api/open-folder")
def open_folder(req: OpenFolderRequest = Body(default_factory=OpenFolderRequest)):
    """Reveal a completed file or the downloads directory in Windows File Explorer."""
    path_to_open = req.file_path or str(DEFAULT_DOWNLOADS)
    if not os.path.exists(path_to_open):
        path_to_open = str(DEFAULT_DOWNLOADS)

    if sys.platform == "win32":
        try:
            if os.path.isfile(path_to_open):
                subprocess.Popen(f'explorer.exe /select,"{os.path.abspath(path_to_open)}"')
            else:
                subprocess.Popen(f'explorer.exe "{os.path.abspath(path_to_open)}"')
            return {"success": True, "opened": path_to_open}
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))
    elif sys.platform == "darwin":
        subprocess.Popen(["open", "-R", path_to_open] if os.path.isfile(path_to_open) else ["open", path_to_open])
        return {"success": True, "opened": path_to_open}
    else:
        subprocess.Popen(["xdg-open", os.path.dirname(path_to_open) if os.path.isfile(path_to_open) else path_to_open])
        return {"success": True, "opened": path_to_open}

# Mount static frontend
if STATIC_DIR.exists():
    app.mount("/", StaticFiles(directory=str(STATIC_DIR), html=True), name="static")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app:app", host="127.0.0.1", port=8000, reload=True)
