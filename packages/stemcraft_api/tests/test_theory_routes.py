from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from stemcraft_api.app import create_app
from stemcraft_lib.theory import HISTORY_CAP, theory_path


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("STEMCRAFT_DATA_DIR", str(tmp_path / "data"))
    monkeypatch.setenv("STEMCRAFT_SONGS_DIR", str(tmp_path / "songs"))
    monkeypatch.setenv("STEMCRAFT_DIST_DIR", str(tmp_path / "nodist"))
    monkeypatch.setenv("STEMCRAFT_SKIP_BOOT_CHECKS", "1")
    return TestClient(create_app())


def _answer(i: int) -> dict:
    return {
        "quiz": "theory",
        "mode": "keys",
        "item": f"v:{i}",
        "correct": i % 2 == 0,
        "ms": 900,
        "at": "2026-09-29T00:00:00Z",
    }


def test_first_run_gets_defaults_without_writing(client, tmp_path):
    resp = client.get("/api/theory")
    assert resp.status_code == 200
    body = resp.json()
    assert body["version"] == 1
    assert body["instrument"] == {
        "kind": "bass",
        "strings": 4,
        "tuning": ["E1", "A1", "D2", "G2"],
        "left_handed": False,
    }
    assert body["last_tool"] == "scale-finder"
    assert body["quiz"]["history"] == []
    assert not theory_path(tmp_path / "data").exists()


def test_put_round_trips_and_lands_on_disk(client, tmp_path):
    doc = client.get("/api/theory").json()
    doc["instrument"] = {
        "kind": "guitar",
        "strings": 6,
        "tuning": ["E2", "A2", "D3", "G3", "B3", "E4"],
        "left_handed": True,
    }
    doc["last_tool"] = "chord-finder"
    doc["quiz"]["history"] = [_answer(1)]
    resp = client.put("/api/theory", json=doc)
    assert resp.status_code == 200
    assert resp.json() == doc
    assert client.get("/api/theory").json() == doc
    assert theory_path(tmp_path / "data").is_file()


def test_put_caps_history(client):
    doc = client.get("/api/theory").json()
    doc["quiz"]["history"] = [_answer(i) for i in range(HISTORY_CAP + 3)]
    body = client.put("/api/theory", json=doc).json()
    assert len(body["quiz"]["history"]) == HISTORY_CAP
    assert body["quiz"]["history"][0]["item"] == "v:3"


def test_put_rejects_an_invalid_body_naming_the_field(client):
    doc = client.get("/api/theory").json()
    doc["instrument"]["strings"] = 7
    resp = client.put("/api/theory", json=doc)
    assert resp.status_code == 422
    assert "strings" in resp.text


def test_corrupt_file_is_a_500_with_the_reason_and_is_not_overwritten(client, tmp_path):
    path = theory_path(tmp_path / "data")
    path.parent.mkdir(parents=True)
    path.write_text('{"version": 1, "last_tool": "tab-reader"}')
    resp = client.get("/api/theory")
    assert resp.status_code == 500
    assert "last_tool" in resp.json()["detail"]
    assert path.read_text() == '{"version": 1, "last_tool": "tab-reader"}'


def test_the_worker_never_touches_theory_json():
    # §2: theory.json has one writer, the API, and the worker has no reason to read
    # it. A plain source scan: the worker's tests import torch, so importing the
    # package here to inspect it would be slow and prove less.
    worker_src = Path(__file__).resolve().parents[2] / "stemcraft_worker" / "src"
    assert worker_src.is_dir()
    assert [p for p in worker_src.rglob("*.py") if "theory" in p.read_text()] == []
