import pytest
from fastapi.testclient import TestClient
from stemcraft_api.app import create_app


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("STEMCRAFT_DATA_DIR", str(tmp_path / "data"))
    monkeypatch.setenv("STEMCRAFT_SONGS_DIR", str(tmp_path / "songs"))
    monkeypatch.setenv("STEMCRAFT_SKIP_BOOT_CHECKS", "1")
    return TestClient(create_app())


def test_sends_a_snapshot_on_connect(client):
    with client.websocket_connect("/api/ws") as ws:
        first = ws.receive_json()
        assert first["type"] == "jobs"
        assert first["jobs"] == []


def test_pushes_after_a_job_is_enqueued(client):
    with client.websocket_connect("/api/ws") as ws:
        ws.receive_json()
        job_id = client.post("/api/jobs", json={"kind": "probe"}).json()["id"]
        message = ws.receive_json()
        assert [j["id"] for j in message["jobs"]] == [job_id]
        assert message["jobs"][0]["state"] == "queued"


def test_pushes_again_when_state_changes(client):
    with client.websocket_connect("/api/ws") as ws:
        ws.receive_json()
        job_id = client.post("/api/jobs", json={"kind": "probe"}).json()["id"]
        ws.receive_json()
        client.post(f"/api/jobs/{job_id}/cancel")
        assert ws.receive_json()["jobs"][0]["state"] == "cancelled"
