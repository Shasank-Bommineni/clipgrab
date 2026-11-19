"""Integration tests for FastAPI endpoints."""

from fastapi.testclient import TestClient
from app import app
from jobs import job_manager

client = TestClient(app)

def test_system_status_endpoint():
    response = client.get("/api/system")
    assert response.status_code == 200
    data = response.json()
    assert "ffmpeg_installed" in data
    assert "encoder" in data
    assert "ytdlp_version" in data
    assert "default_downloads" in data

def test_download_endpoint_validation():
    # End <= Start
    res = client.post("/api/download", json={
        "url": "https://youtube.com/watch?v=dummy",
        "start": 50,
        "end": 20,
        "quality": "1440",
        "mode": "lossless"
    })
    assert res.status_code == 400

    # Negative start
    res2 = client.post("/api/download", json={
        "url": "https://youtube.com/watch?v=dummy",
        "start": -5,
        "end": 20,
        "quality": "1440",
        "mode": "lossless"
    })
    assert res2.status_code == 422

def test_download_job_submission():
    res = client.post("/api/download", json={
        "url": "https://youtube.com/watch?v=dummy",
        "start": 10,
        "end": 25,
        "quality": "1440",
        "mode": "lossless",
        "custom_filename": "Test Submission"
    })
    assert res.status_code == 200
    data = res.json()
    assert "job_id" in data
    job_id = data["job_id"]

    # Check job is in list
    jobs_res = client.get("/api/jobs")
    assert jobs_res.status_code == 200
    all_jobs = jobs_res.json()
    assert any(j["job_id"] == job_id for j in all_jobs)

def test_progress_404():
    res = client.get("/api/progress/nonexistent_id")
    assert res.status_code == 404

def test_static_index_served():
    res = client.get("/")
    assert res.status_code == 200
    assert "ClipGrab" in res.text
    assert "text/html" in res.headers["content-type"]

def test_job_cancel_and_management_endpoints():
    # Submit job
    res = client.post("/api/download", json={
        "url": "https://youtube.com/watch?v=dummy",
        "title": "Cancel Test",
        "start": 0,
        "end": 10,
        "quality": "720",
        "mode": "lossless"
    })
    assert res.status_code == 200
    job_id = res.json()["job_id"]

    # Cancel endpoint
    cancel_res = client.post(f"/api/jobs/{job_id}/cancel")
    assert cancel_res.status_code == 200
    assert cancel_res.json()["status"] == "cancelled"

    # Delete endpoint
    del_res = client.delete(f"/api/jobs/{job_id}")
    assert del_res.status_code == 200

    # Clear endpoint
    clear_res = client.post("/api/jobs/clear")
    assert clear_res.status_code == 200

def test_autoupdate_endpoint():
    res = client.get("/api/system/autoupdate")
    assert res.status_code == 200
    data = res.json()
    assert data["enabled"] is True
    assert "version" in data
    assert "last_status" in data

def test_open_folder_endpoint():
    res = client.post("/api/open-folder", json={})
    assert res.status_code == 200
    assert res.json()["success"] is True
    assert "downloads" in res.json()["opened"].lower()

    res2 = client.post("/api/open-folder", json={"file_path": "downloads"})
    assert res2.status_code == 200
    assert res2.json()["success"] is True
