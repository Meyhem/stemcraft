import pytest
from fastapi.testclient import TestClient
from stemcraft_api.app import create_app
from stemcraft_lib.practice import practice_path


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("STEMCRAFT_DATA_DIR", str(tmp_path / "data"))
    monkeypatch.setenv("STEMCRAFT_SONGS_DIR", str(tmp_path / "songs"))
    monkeypatch.setenv("STEMCRAFT_DIST_DIR", str(tmp_path / "nodist"))
    monkeypatch.setenv("STEMCRAFT_SKIP_BOOT_CHECKS", "1")
    return TestClient(create_app())


def test_first_run_gets_defaults_without_writing(client, tmp_path):
    resp = client.get("/api/practice")
    assert resp.status_code == 200
    body = resp.json()
    assert body["version"] == 1
    assert body["bass"]["groove"]["notes"] == "root_fifth_octave"
    assert body["guitar"]["levels"]["backing"] == 0.6
    assert not practice_path(tmp_path / "data").exists()


def test_put_round_trips_and_lands_on_disk(client, tmp_path):
    doc = client.get("/api/practice").json()
    doc["instrument"] = "guitar"
    doc["guitar"]["exercise"] = "scale"
    doc["presets"] = [{"name": "Box 1", "instrument": "guitar", "settings": doc["guitar"]}]
    resp = client.put("/api/practice", json=doc)
    assert resp.status_code == 200
    assert resp.json() == doc
    assert client.get("/api/practice").json() == doc
    assert practice_path(tmp_path / "data").is_file()


def test_bad_field_is_a_422_naming_it(client):
    doc = client.get("/api/practice").json()
    doc["bass"]["bpm"] = 400
    resp = client.put("/api/practice", json=doc)
    assert resp.status_code == 422
    assert "bpm" in resp.text


def test_ramp_out_of_engine_range_is_a_422_saying_why(client):
    doc = client.get("/api/practice").json()
    doc["bass"]["ramp"] = {"on": True, "start": 80, "target": 200, "step": 5, "every_loops": 2}
    resp = client.put("/api/practice", json=doc)
    assert resp.status_code == 422
    assert "tempo range is 0.5-1.5x" in resp.text


def test_unreadable_file_is_a_500_with_the_reason_and_left_alone(client, tmp_path):
    path = practice_path(tmp_path / "data")
    path.parent.mkdir(parents=True)
    path.write_text("{nope")
    resp = client.get("/api/practice")
    assert resp.status_code == 500
    assert "invalid JSON" in resp.json()["detail"]
    assert path.read_text() == "{nope"
