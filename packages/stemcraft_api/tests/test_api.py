import os
import subprocess
import sys
import textwrap
import threading

import pytest
from fastapi.testclient import TestClient
from stemcraft_api.app import create_app
from stemcraft_lib import jobs as jobs_db
from stemcraft_lib.config import settings
from stemcraft_lib.song import new_song, write_song


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("STEMCRAFT_DATA_DIR", str(tmp_path / "data"))
    monkeypatch.setenv("STEMCRAFT_SONGS_DIR", str(tmp_path / "songs"))
    monkeypatch.setenv("STEMCRAFT_DIST_DIR", str(tmp_path / "nodist"))
    monkeypatch.setenv("STEMCRAFT_SKIP_BOOT_CHECKS", "1")
    return TestClient(create_app())


def test_the_api_never_imports_torch(tmp_path):
    # Invariant §4: a broken CUDA install must not take the UI down. Enforced by
    # the dependency graph (stemcraft-api does not depend on torch) and asserted
    # here so an accidental import cannot slip in.
    #
    # Runs in a fresh subprocess, not the pytest-in-flight process: stemcraft_worker's
    # own tests import torch at collection time, and pytest collects every test module
    # in one process before running any of them, so sys.modules is already polluted by
    # the time this test's own body would run in-process. That pollution isn't a real
    # invariant violation -- the API and worker are separate OS processes in
    # production -- so this test has to open its own process to mean anything.
    script = textwrap.dedent(
        """
        import sys
        from fastapi.testclient import TestClient
        from stemcraft_api.app import create_app

        client = TestClient(create_app())
        client.get("/api/health")
        assert "torch" not in sys.modules, sorted(m for m in sys.modules if "torch" in m)
        """
    )
    env = {
        **os.environ,
        "STEMCRAFT_DATA_DIR": str(tmp_path / "data"),
        "STEMCRAFT_SONGS_DIR": str(tmp_path / "songs"),
        "STEMCRAFT_DIST_DIR": str(tmp_path / "nodist"),
        "STEMCRAFT_SKIP_BOOT_CHECKS": "1",
    }
    result = subprocess.run(
        [sys.executable, "-c", script], capture_output=True, text=True, env=env, timeout=30
    )
    assert result.returncode == 0, result.stderr


def test_health_reports_every_dependency_and_the_sample_rate(client):
    body = client.get("/api/health").json()
    assert {c["name"] for c in body["deps"]} == {
        "ffmpeg", "ffmpeg_rubberband", "yt-dlp", "data_dirs", "sqlite_wal"
    }
    assert body["sample_rate"] == 48000
    assert body["device"] is None
    assert body["fallback_reason"] is None


def test_health_reports_the_workers_recorded_device(client):
    jobs_db.set_worker_status(
        jobs_db.connect(settings().jobs_db), device="cpu", fallback_reason="no cuda device found"
    )
    body = client.get("/api/health").json()
    assert body["device"] == "cpu"
    assert body["fallback_reason"] == "no cuda device found"


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


def test_song_delete_gate_sees_past_the_first_200_jobs(client, tmp_path):
    # jobs_db.list_jobs defaults to the newest 200 rows, ordered id DESC. The
    # worker is strictly serial, so a song's RUNNING job is always the OLDEST
    # row among queued-or-running jobs. Enqueue the song's own job first, then
    # bury it under 200 newer unrelated jobs: a page-limited scan of the live
    # set finds `live` empty here and rmtrees a directory the worker is
    # actively writing into. Same gate, same fix as delete_album.
    song = new_song(title="T", artist="A", source_kind="upload", source_value="o.mp3")
    song_dir = tmp_path / "songs" / f"{song.id}-t"
    write_song(song_dir, song)
    (song_dir / "original.mp3").write_bytes(b"x")

    job_id = client.post(
        "/api/jobs", json={"kind": "probe", "song_id": song.id, "payload": {}}
    ).json()["id"]
    conn = jobs_db.connect(settings().jobs_db)
    for _ in range(200):
        jobs_db.enqueue(conn, kind="probe", payload={})

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


def test_job_stats_route_reports_counts_and_averages(client):
    conn = jobs_db.connect(settings().jobs_db)
    ok = jobs_db.enqueue(conn, kind="probe")
    jobs_db.claim_next(conn, device="cuda")
    jobs_db.finish(conn, ok)
    conn.execute("UPDATE jobs SET started_at = 10.0, finished_at = 12.5 WHERE id = ?", (ok,))
    bad = jobs_db.enqueue(conn, kind="probe")
    jobs_db.claim_next(conn, device="cuda")
    jobs_db.fail(conn, bad, "boom")
    assert client.get("/api/jobs/stats").json() == {
        "passed": 1,
        "failed": 1,
        "durations": [{"kind": "probe", "device": "cuda", "count": 1, "avg_seconds": 2.5}],
    }


def _in_thread(fn):
    """Run fn in a fresh thread; return (result, exception)."""
    box = {}

    def run():
        try:
            box["result"] = fn()
        except BaseException as exc:  # noqa: BLE001 - reported to the test
            box["error"] = exc

    t = threading.Thread(target=run)
    t.start()
    t.join(5)
    assert not t.is_alive()
    return box.get("result"), box.get("error")


def test_get_conn_teardown_may_run_on_another_thread(client):
    # FastAPI runs a sync generator dependency's setup and teardown via the
    # threadpool, which may pick different threads. close() must not raise.
    from stemcraft_api.deps import get_conn

    gen = get_conn()
    next(gen)
    _, error = _in_thread(lambda: next(gen, None))
    assert error is None


def test_get_conn_connection_usable_from_another_thread(client):
    from stemcraft_api.deps import get_conn

    gen = get_conn()
    conn = next(gen)
    try:
        result, error = _in_thread(lambda: conn.execute("SELECT 1").fetchone()[0])
        assert error is None
        assert result == 1
    finally:
        gen.close()
