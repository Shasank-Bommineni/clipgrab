"""Unit tests for JobManager and SSE event streaming."""

import asyncio
import json
from jobs import JobManager, Job

def test_job_lifecycle():
    manager = JobManager()
    job = manager.create_job(
        url="https://youtube.com/watch?v=dummy",
        title="Test Video",
        start_sec=10.0,
        end_sec=25.0,
        quality="1440",
        mode="lossless"
    )

    assert job.job_id is not None
    assert job.status == "queued"
    assert job.percent == 0

    # Test update
    job.update(status="downloading", percent=45, speed="15 MB/s")
    assert job.status == "downloading"
    assert job.percent == 45
    assert job.speed == "15 MB/s"

    job_dict = job.to_dict()
    assert job_dict["job_id"] == job.job_id
    assert job_dict["title"] == "Test Video"

def test_job_manager_retrieval():
    manager = JobManager()
    job1 = manager.create_job("url1", "Video 1", 0, 10)
    job2 = manager.create_job("url2", "Video 2", 10, 20)

    assert manager.get_job(job1.job_id) is job1
    assert manager.get_job(job2.job_id) is job2
    assert manager.get_job("non-existent") is None

    all_jobs = manager.get_all_jobs()
    assert len(all_jobs) == 2

def test_sse_generator():
    async def run_test():
        manager = JobManager()
        job = manager.create_job("url", "Test SSE", 0, 30)

        gen = manager.sse_generator(job.job_id)

        # Initial event
        first_event = await gen.__anext__()
        assert first_event.startswith("data: ")
        payload = json.loads(first_event.replace("data: ", "").strip())
        assert payload["status"] == "queued"

        # Push update
        job.update(status="completed", percent=100, message="Done")
        second_event = await gen.__anext__()
        payload2 = json.loads(second_event.replace("data: ", "").strip())
        assert payload2["status"] == "completed"
        assert payload2["percent"] == 100

    asyncio.run(run_test())

def test_start_job_execution(monkeypatch):
    from unittest.mock import MagicMock
    mock_download = MagicMock(return_value={
        "file_path": "test.mkv",
        "file_name": "test.mkv",
        "probe": {"duration": 15}
    })
    monkeypatch.setattr("jobs.download_clip", mock_download)

    async def run_test():
        manager = JobManager()
        job = manager.create_job("url", "Test Start Job", 0, 15)
        loop = asyncio.get_running_loop()
        manager.start_job(job.job_id, loop)

        for _ in range(20):
            await asyncio.sleep(0.1)
            if job.status == "completed":
                break

        assert job.status == "completed"
        assert job.percent == 100
        assert job.file_path == "test.mkv"

    asyncio.run(run_test())
