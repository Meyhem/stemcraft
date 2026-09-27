import sys

import pytest
from fastapi.testclient import TestClient
from stemcraft_api.app import create_app
from stemcraft_lib.song import new_song, write_song


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("STEMCRAFT_DATA_DIR", str(tmp_path / "data"))
    monkeypatch.setenv("STEMCRAFT_SONGS_DIR", str(tmp_path / "songs"))
    monkeypatch.setenv("STEMCRAFT_DIST_DIR", str(tmp_path / "nodist"))
    monkeypatch.setenv("STEMCRAFT_SKIP_BOOT_CHECKS", "1")
    return TestClient(create_app())


def test_the_api_never_imports_torch(client):
    # Invariant §4: a broken CUDA install must not take the UI down. Enforced by
    # the dependency graph (stemcraft-api does not depend on torch) and asserted
    # here so an accidental import cannot slip in.
    client.get("/api/health")
    assert "torch" not in sys.modules


def test_health_reports_every_dependency_and_the_sample_rate(client):
    body = client.get("/api/health").json()
    assert {c["name"] for c in body["deps"]} == {"ffmpeg", "yt-dlp", "data_dirs", "sqlite_wal"}
    assert body["sample_rate"] == 48000
    assert "device" in body


def test_songs_is_empty_before_anything_is_imported(client):
    assert client.get("/api/songs").json() == {"songs": []}


def test_songs_lists_a_good_song_with_derived_state(client, tmp_path):
    song = new_song(title="T", artist="A", source_kind="upload", source_value="original.mp3")
    write_song(tmp_path / "songs" / f"{song.id}-t", song)

    entry = client.get("/api/songs").json()["songs"][0]
    assert entry["song"]["title"] == "T"
    assert entry["state"] == "imported"
    assert entry["unreadable"] is None
    assert entry["files"]["has_stems"] is False


def test_one_corrupt_song_does_not_break_the_library(client, tmp_path):
    good = new_song(title="Good", artist="A", source_kind="upload", source_value="o.mp3")
    write_song(tmp_path / "songs" / f"{good.id}-good", good)
    bad_dir = tmp_path / "songs" / "01BROKEN-bad"
    bad_dir.mkdir(parents=True)
    (bad_dir / "song.json").write_text("{not json")

    entries = {e["dir"]: e for e in client.get("/api/songs").json()["songs"]}
    assert entries[f"{good.id}-good"]["song"]["title"] == "Good"
    broken = entries["01BROKEN-bad"]
    assert broken["song"] is None
    assert "invalid JSON" in broken["unreadable"]


def test_enqueue_list_and_cancel_a_job(client):
    job_id = client.post("/api/jobs", json={"kind": "probe", "payload": {"steps": 2}}).json()["id"]
    listed = client.get("/api/jobs").json()["jobs"]
    assert [j["id"] for j in listed] == [job_id]
    assert listed[0]["state"] == "queued"
    assert listed[0]["payload"] == {"steps": 2}

    assert client.post(f"/api/jobs/{job_id}/cancel").json()["state"] == "cancelled"
    assert client.get("/api/jobs").json()["jobs"][0]["state"] == "cancelled"


def test_cancelling_an_unknown_job_is_a_404(client):
    assert client.post("/api/jobs/9999/cancel").status_code == 404


def test_delete_removes_the_song_folder(client, tmp_path):
    song = new_song(title="T", artist="A", source_kind="upload", source_value="o.mp3")
    song_dir = tmp_path / "songs" / f"{song.id}-t"
    write_song(song_dir, song)
    (song_dir / "original.mp3").write_bytes(b"x")

    assert client.delete(f"/api/songs/{song.id}").status_code == 204
    assert not song_dir.exists()


def test_delete_is_blocked_while_a_job_for_the_song_is_live(client, tmp_path):
    song = new_song(title="T", artist="A", source_kind="upload", source_value="o.mp3")
    song_dir = tmp_path / "songs" / f"{song.id}-t"
    write_song(song_dir, song)
    (song_dir / "original.mp3").write_bytes(b"x")

    job_id = client.post(
        "/api/jobs", json={"kind": "probe", "song_id": song.id, "payload": {}}
    ).json()["id"]

    response = client.delete(f"/api/songs/{song.id}")
    assert response.status_code == 409
    assert str(job_id) in response.json()["detail"]
    assert song_dir.exists()


def test_delete_succeeds_when_only_finished_jobs_reference_the_song(client, tmp_path):
    song = new_song(title="T", artist="A", source_kind="upload", source_value="o.mp3")
    song_dir = tmp_path / "songs" / f"{song.id}-t"
    write_song(song_dir, song)
    (song_dir / "original.mp3").write_bytes(b"x")

    job_id = client.post(
        "/api/jobs", json={"kind": "probe", "song_id": song.id, "payload": {}}
    ).json()["id"]
    assert client.post(f"/api/jobs/{job_id}/cancel").json()["state"] == "cancelled"

    assert client.delete(f"/api/songs/{song.id}").status_code == 204
    assert not song_dir.exists()


def test_boot_refuses_to_start_when_dependencies_are_unmet(tmp_path, monkeypatch):
    monkeypatch.setenv("STEMCRAFT_DATA_DIR", str(tmp_path / "data"))
    monkeypatch.setenv("STEMCRAFT_SONGS_DIR", str(tmp_path / "songs"))
    monkeypatch.delenv("STEMCRAFT_SKIP_BOOT_CHECKS", raising=False)
    monkeypatch.setenv("PATH", str(tmp_path / "empty"))

    # N-08: loud at startup, not at first use.
    with pytest.raises(Exception) as err:  # noqa: B017 - lifespan re-raises
        with TestClient(create_app()):
            pass
    assert "ffmpeg" in str(err.value)
