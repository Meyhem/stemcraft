import http.server
import shutil
import subprocess
import threading
import wave

import pytest
import stemcraft_worker.kinds.import_song  # noqa: F401  (registers on import)
from stemcraft_lib import jobs as jobs_db
from stemcraft_lib.jobs import connect, enqueue, get_job
from stemcraft_lib.song import create_song_dir, new_song
from stemcraft_worker.main import run_one

pytestmark = pytest.mark.skipif(
    shutil.which("ffmpeg") is None, reason="ffmpeg not installed on this host"
)


@pytest.fixture
def conn(tmp_path):
    return connect(tmp_path / "jobs.sqlite")


@pytest.fixture
def songs_dir(tmp_path, monkeypatch):
    d = tmp_path / "songs"
    monkeypatch.setenv("STEMCRAFT_SONGS_DIR", str(d))
    return d


def _fixture_mp3(path, *, seconds=0.5, sample_rate=44100):
    subprocess.run(
        [
            "ffmpeg", "-hide_banner", "-nostdin", "-y", "-f", "lavfi",
            "-i", f"sine=frequency=440:duration={seconds}:sample_rate={sample_rate}",
            "-ac", "2", "-codec:a", "libmp3lame", str(path),
        ],
        check=True, capture_output=True,
    )


def test_upload_source_decodes_and_computes_peaks(conn, songs_dir):
    song = new_song(title="T", artist="A", source_kind="upload", source_value="original.mp3")
    song_dir = create_song_dir(songs_dir, song)
    _fixture_mp3(song_dir / "original.mp3")

    job_id = enqueue(conn, kind="import", song_id=song.id, payload={"song_id": song.id})
    assert run_one(conn, device="cpu") == job_id

    done = get_job(conn, job_id)
    assert done.state == "done"
    assert done.result["duration_seconds"] == pytest.approx(0.5, abs=0.2)

    audio_wav = song_dir / "audio.wav"
    with wave.open(str(audio_wav), "rb") as wav:
        assert wav.getframerate() == 48000
        assert wav.getnchannels() == 2
    assert (song_dir / "peaks.json").is_file()
    # Original is untouched, never modified or deleted.
    assert (song_dir / "original.mp3").is_file()


def test_import_enqueues_a_separate_job_on_success(conn, songs_dir):
    song = new_song(title="T", artist="A", source_kind="upload", source_value="original.mp3")
    song_dir = create_song_dir(songs_dir, song)
    _fixture_mp3(song_dir / "original.mp3")

    job_id = enqueue(conn, kind="import", song_id=song.id, payload={"song_id": song.id})
    run_one(conn, device="cpu")
    assert get_job(conn, job_id).state == "done"

    queued = jobs_db.list_jobs(conn, states=("queued",))
    assert len(queued) == 1
    assert queued[0].kind == "separate"
    assert queued[0].payload == {"song_id": song.id}


def test_a_failed_import_does_not_enqueue_separation(conn, songs_dir):
    song = new_song(title="T", artist="A", source_kind="upload", source_value="original.mp3")
    song_dir = create_song_dir(songs_dir, song)
    (song_dir / "original.mp3").write_bytes(b"not actually audio")

    job_id = enqueue(conn, kind="import", song_id=song.id, payload={"song_id": song.id})
    run_one(conn, device="cpu")
    assert get_job(conn, job_id).state == "failed"

    assert jobs_db.list_jobs(conn, states=("queued",)) == []


def test_upload_source_with_no_original_fails_loudly(conn, songs_dir):
    song = new_song(title="T", artist="A", source_kind="upload", source_value="original.mp3")
    create_song_dir(songs_dir, song)
    # original.mp3 deliberately never written -- simulates an inconsistent state.

    job_id = enqueue(conn, kind="import", song_id=song.id, payload={"song_id": song.id})
    run_one(conn, device="cpu")

    failed = get_job(conn, job_id)
    assert failed.state == "failed"
    assert song.id in failed.error


def test_corrupt_original_fails_with_ffmpegs_message_and_original_survives(conn, songs_dir):
    song = new_song(title="T", artist="A", source_kind="upload", source_value="original.mp3")
    song_dir = create_song_dir(songs_dir, song)
    (song_dir / "original.mp3").write_bytes(b"not actually audio")

    job_id = enqueue(conn, kind="import", song_id=song.id, payload={"song_id": song.id})
    run_one(conn, device="cpu")

    failed = get_job(conn, job_id)
    assert failed.state == "failed"
    assert "decode" in failed.error.lower()
    assert (song_dir / "original.mp3").read_bytes() == b"not actually audio"
    assert not (song_dir / "audio.wav").exists()


def test_rerunning_import_is_idempotent(conn, songs_dir):
    song = new_song(title="T", artist="A", source_kind="upload", source_value="original.mp3")
    song_dir = create_song_dir(songs_dir, song)
    _fixture_mp3(song_dir / "original.mp3")

    job_a = enqueue(conn, kind="import", song_id=song.id, payload={"song_id": song.id})
    run_one(conn, device="cpu")
    # Drain the "separate" job import auto-enqueues on success, so it doesn't jump
    # ahead of job_b below (claim_next is FIFO across kinds).
    while run_one(conn, device="cpu") is not None:
        pass
    first_bytes = (song_dir / "audio.wav").read_bytes()

    job_b = enqueue(conn, kind="import", song_id=song.id, payload={"song_id": song.id})
    run_one(conn, device="cpu")
    second_bytes = (song_dir / "audio.wav").read_bytes()

    assert get_job(conn, job_a).state == "done"
    assert get_job(conn, job_b).state == "done"
    assert first_bytes == second_bytes


def test_unknown_song_id_fails_loudly(conn, songs_dir):
    songs_dir.mkdir(parents=True, exist_ok=True)
    job_id = enqueue(conn, kind="import", payload={"song_id": "does-not-exist"})
    run_one(conn, device="cpu")
    failed = get_job(conn, job_id)
    assert failed.state == "failed"
    assert "does-not-exist" in failed.error


@pytest.fixture
def http_fixture_server(tmp_path):
    handler = lambda *args, **kw: http.server.SimpleHTTPRequestHandler(  # noqa: E731
        *args, directory=str(tmp_path), **kw
    )
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{server.server_port}"
    finally:
        server.shutdown()
        thread.join(timeout=5)


@pytest.mark.skipif(shutil.which("yt-dlp") is None, reason="yt-dlp not installed on this host")
def test_url_source_downloads_then_decodes(conn, songs_dir, http_fixture_server, tmp_path):
    _fixture_mp3(tmp_path / "served.mp3")
    song = new_song(
        title="T", artist="A", source_kind="url",
        source_value=f"{http_fixture_server}/served.mp3",
    )
    song_dir = create_song_dir(songs_dir, song)

    job_id = enqueue(conn, kind="import", song_id=song.id, payload={"song_id": song.id})
    run_one(conn, device="cpu")

    done = get_job(conn, job_id)
    assert done.state == "done"
    assert list(song_dir.glob("original.*"))
    assert (song_dir / "audio.wav").is_file()
    assert (song_dir / "peaks.json").is_file()
    assert [s["state"] for s in get_job(conn, job_id).steps] == ["done", "done", "done"]


def test_an_upload_import_skips_download_and_runs_the_rest(conn, songs_dir):
    song = new_song(title="T", artist="A", source_kind="upload", source_value="original.mp3")
    song_dir = create_song_dir(songs_dir, song)
    _fixture_mp3(song_dir / "original.mp3")

    job_id = enqueue(conn, kind="import", song_id=song.id, payload={"song_id": song.id})
    run_one(conn, device="cpu")

    steps = get_job(conn, job_id).steps
    assert [(s["id"], s["state"]) for s in steps] == [
        ("download", "skipped"), ("decode", "done"), ("peaks", "done"),
    ]
    assert steps[0]["detail"] == "uploaded file"


def test_an_import_for_a_missing_song_fails_on_its_first_step(conn, songs_dir):
    job_id = enqueue(conn, kind="import", song_id="nope", payload={"song_id": "nope"})
    run_one(conn, device="cpu")
    job = get_job(conn, job_id)
    assert job.state == "failed"
    assert job.steps[0]["state"] == "failed"
