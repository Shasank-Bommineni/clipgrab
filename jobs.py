"""
ClipGrab Job Queue & Event Stream Engine
Thread-safe background job management and Server-Sent Events (SSE) broadcasting.
"""

import asyncio
import json
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from typing import Dict, Any, Optional, List, AsyncGenerator

from downloader import download_clip

# Thread pool for non-blocking downloads
DOWNLOAD_EXECUTOR = ThreadPoolExecutor(max_workers=3)

class Job:
    def __init__(
        self,
        job_id: str,
        url: str,
        title: str,
        start_sec: float,
        end_sec: float,
        quality: str,
        mode: str,
        output_dir: Optional[str] = None,
        custom_filename: Optional[str] = None
    ):
        self.job_id = job_id
        self.url = url
        self.title = title
        self.start_sec = start_sec
        self.end_sec = end_sec
        self.quality = quality
        self.mode = mode
        self.output_dir = output_dir
        self.custom_filename = custom_filename

        self.status = "queued"
        self.percent = 0
        self.speed = ""
        self.eta = ""
        self.message = "Job queued..."
        self.file_path = None
        self.file_name = None
        self.probe = None
        self.error = None
        self.created_at = time.time()

        self._lock = threading.RLock()
        self._subscribers: List[asyncio.Queue] = []

    def to_dict(self) -> Dict[str, Any]:
        with self._lock:
            return {
                "job_id": self.job_id,
                "url": self.url,
                "title": self.title,
                "start_sec": self.start_sec,
                "end_sec": self.end_sec,
                "quality": self.quality,
                "mode": self.mode,
                "status": self.status,
                "percent": self.percent,
                "speed": self.speed,
                "eta": self.eta,
                "message": self.message,
                "file_path": self.file_path,
                "file_name": self.file_name,
                "probe": self.probe,
                "error": self.error,
                "created_at": self.created_at
            }

    def update(self, **kwargs):
        with self._lock:
            for k, v in kwargs.items():
                if hasattr(self, k):
                    setattr(self, k, v)
            data = self.to_dict()

        # Notify active SSE subscriber queues
        dead_queues = []
        for q in self._subscribers:
            try:
                q.put_nowait(data)
            except Exception:
                dead_queues.append(q)
        for dq in dead_queues:
            if dq in self._subscribers:
                self._subscribers.remove(dq)

    def add_subscriber(self, q: asyncio.Queue):
        with self._lock:
            self._subscribers.append(q)

    def remove_subscriber(self, q: asyncio.Queue):
        with self._lock:
            if q in self._subscribers:
                self._subscribers.remove(q)


class JobManager:
    def __init__(self):
        self._jobs: Dict[str, Job] = {}
        self._lock = threading.RLock()

    def create_job(
        self,
        url: str,
        title: str,
        start_sec: float,
        end_sec: float,
        quality: str = "1440",
        mode: str = "lossless",
        output_dir: Optional[str] = None,
        custom_filename: Optional[str] = None
    ) -> Job:
        job_id = uuid.uuid4().hex[:12]
        job = Job(
            job_id=job_id,
            url=url,
            title=title,
            start_sec=start_sec,
            end_sec=end_sec,
            quality=quality,
            mode=mode,
            output_dir=output_dir,
            custom_filename=custom_filename
        )
        with self._lock:
            self._jobs[job_id] = job
        return job

    def get_job(self, job_id: str) -> Optional[Job]:
        with self._lock:
            return self._jobs.get(job_id)

    def get_all_jobs(self) -> List[Dict[str, Any]]:
        with self._lock:
            # Sort newest first
            return [j.to_dict() for j in sorted(self._jobs.values(), key=lambda x: x.created_at, reverse=True)]

    def start_job(self, job_id: str, loop: asyncio.AbstractEventLoop):
        job = self.get_job(job_id)
        if not job:
            return

        def safe_update(**kwargs):
            try:
                if loop.is_closed():
                    job.update(**kwargs)
                else:
                    loop.call_soon_threadsafe(lambda: job.update(**kwargs))
            except Exception:
                job.update(**kwargs)

        def worker():
            def progress_callback(update_info: Dict[str, Any]):
                phase = update_info.get("phase", job.status)
                pct = update_info.get("percent", job.percent)
                msg = update_info.get("message", job.message)
                speed = update_info.get("speed", job.speed)
                eta = update_info.get("eta", job.eta)
                file_p = update_info.get("file_path", job.file_path)
                probe = update_info.get("probe", job.probe)

                # Threadsafe update to job and async subscribers
                safe_update(
                    status=phase,
                    percent=pct,
                    message=msg,
                    speed=speed,
                    eta=eta,
                    file_path=file_p,
                    probe=probe
                )

            try:
                safe_update(status="downloading", percent=5, message="Starting download...")
                res = download_clip(
                    url=job.url,
                    start_sec=job.start_sec,
                    end_sec=job.end_sec,
                    quality=job.quality,
                    mode=job.mode,
                    output_dir=job.output_dir,
                    custom_filename=job.custom_filename,
                    progress_callback=progress_callback
                )
                safe_update(
                    status="completed",
                    percent=100,
                    message="Clip completed!",
                    file_path=res.get("file_path"),
                    file_name=res.get("file_name"),
                    probe=res.get("probe")
                )
            except Exception as e:
                import traceback
                traceback.print_exc()
                safe_update(
                    status="error",
                    error=str(e),
                    message=f"Failed: {str(e)}"
                )

        DOWNLOAD_EXECUTOR.submit(worker)

    async def sse_generator(self, job_id: str) -> AsyncGenerator[str, None]:
        """Yield Server-Sent Events for job status updates."""
        job = self.get_job(job_id)
        if not job:
            yield f"data: {json.dumps({'error': 'Job not found'})}\n\n"
            return

        queue: asyncio.Queue = asyncio.Queue()
        job.add_subscriber(queue)

        # Send current state immediately
        yield f"data: {json.dumps(job.to_dict())}\n\n"

        try:
            while True:
                # If job is already in terminal state and queue is empty, close stream
                if job.status in ("completed", "error") and queue.empty():
                    break

                try:
                    data = await asyncio.wait_for(queue.get(), timeout=20.0)
                    yield f"data: {json.dumps(data)}\n\n"
                    if data.get("status") in ("completed", "error"):
                        break
                except asyncio.TimeoutError:
                    # Keep-alive heartbeat comment
                    yield ": ping\n\n"
        finally:
            job.remove_subscriber(queue)

# Global singleton
job_manager = JobManager()
