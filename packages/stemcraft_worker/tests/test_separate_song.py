import shutil
import subprocess
import wave

import pytest
import stemcraft_worker.kinds.separate_song  # noqa: F401  (registers on import)
from demucs.api import Separator
from stemcraft_lib import jobs as jobs_db
from stemcraft_lib.jobs import connect, enqueue, get_job
from stemcraft_lib.song import STEM_NAMES, create_song_dir, new_song
from stemcraft_worker.device import WorkerState
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


@pytest.fixture
def worker_state():
    return WorkerState(
        device="cpu", fallback_reason=None,
        separator=Separator(model="demucs_unittest", device="cpu"),
    )


def _fixture_audio_wav(path, *, seconds=0.5, sample_rate=48000):
    subprocess.run(
        [
            "ffmpeg", "-hide_banner", "-nostdin", "-y", "-f", "lavfi",
            "-i", f"sine=frequency=440:duration={seconds}:sample_rate={sample_rate}",
            "-ac", "2", "-ar", str(sample_rate), "-c:a", "pcm_s16le", "-f", "wav", str(path),
        ],
        check=True, capture_output=True,
    )


def _make_song(songs_dir, *, seconds=0.5):
    song = new_song(title="T", artist="A", source_kind="upload", source_value="original.mp3")
    song_dir = create_song_dir(songs_dir, song)
    _fixture_audio_wav(song_dir / "audio.wav", seconds=seconds)
    return song, song_dir


def test_separate_writes_all_four_wav_and_opus_stems_at_48khz(conn, songs_dir, worker_state):
    song, song_dir = _make_song(songs_dir)

    job_id = enqueue(conn, kind="separate", song_id=song.id, payload={"song_id": song.id})
    assert run_one(conn, device="cpu", worker_state=worker_state) == job_id

    done = get_job(conn, job_id)
    assert done.state == "done"
    for name in STEM_NAMES:
        wav_path = song_dir / "stems" / f"{name}.wav"
        opus_path = song_dir / "stems" / f"{name}.opus"
        with wave.open(str(wav_path), "rb") as wav_file:
            assert wav_file.getframerate() == 48000
            assert wav_file.getnchannels() == 2
        assert wav_path.stat().st_size > 0
        assert opus_path.is_file()
        assert opus_path.stat().st_size > 0


def test_separate_result_reports_near_silent_per_stem(conn, songs_dir, worker_state):
    song, _ = _make_song(songs_dir)

    job_id = enqueue(conn, kind="separate", song_id=song.id, payload={"song_id": song.id})
    run_one(conn, device="cpu", worker_state=worker_state)

    done = get_job(conn, job_id)
    assert set(done.result["near_silent"]) == set(STEM_NAMES)
    assert all(isinstance(v, bool) for v in done.result["near_silent"].values())


def test_rerunning_separate_is_idempotent(conn, songs_dir, worker_state):
    song, song_dir = _make_song(songs_dir)

    job_a = enqueue(conn, kind="separate", song_id=song.id, payload={"song_id": song.id})
    run_one(conn, device="cpu", worker_state=worker_state)
    # Drain the "analyze" job separate auto-enqueues on success, so it doesn't jump
    # ahead of job_b below (claim_next is FIFO across kinds).
    while run_one(conn, device="cpu", worker_state=worker_state) is not None:
        pass
    first_bytes = (song_dir / "stems" / "vocals.wav").read_bytes()

    job_b = enqueue(conn, kind="separate", song_id=song.id, payload={"song_id": song.id})
    run_one(conn, device="cpu", worker_state=worker_state)
    second_bytes = (song_dir / "stems" / "vocals.wav").read_bytes()

    assert get_job(conn, job_a).state == "done"
    assert get_job(conn, job_b).state == "done"
    assert first_bytes == second_bytes


def test_missing_audio_wav_fails_loudly(conn, songs_dir, worker_state):
    song = new_song(title="T", artist="A", source_kind="upload", source_value="original.mp3")
    create_song_dir(songs_dir, song)
    # audio.wav deliberately never written.

    job_id = enqueue(conn, kind="separate", song_id=song.id, payload={"song_id": song.id})
    run_one(conn, device="cpu", worker_state=worker_state)

    failed = get_job(conn, job_id)
    assert failed.state == "failed"
    assert song.id in failed.error


def test_separate_chains_into_analyze(conn, songs_dir, worker_state):
    song, _ = _make_song(songs_dir)

    job_id = enqueue(conn, kind="separate", song_id=song.id, payload={"song_id": song.id})
    run_one(conn, device="cpu", worker_state=worker_state)

    assert get_job(conn, job_id).state == "done"
    jobs = jobs_db.list_jobs(conn)
    analyze_jobs = [j for j in jobs if j.kind == "analyze"]
    assert len(analyze_jobs) == 1
    assert analyze_jobs[0].song_id == song.id


def test_cancel_mid_separation_lands_as_cancelled_not_failed(conn, songs_dir, worker_state, monkeypatch):
    song, song_dir = _make_song(songs_dir, seconds=20)

    calls = {"n": 0}
    real_is_cancel_requested = jobs_db.is_cancel_requested

    def fake_is_cancel_requested(conn_, job_id_):
        calls["n"] += 1
        if calls["n"] >= 2:
            return True
        return real_is_cancel_requested(conn_, job_id_)

    monkeypatch.setattr(jobs_db, "is_cancel_requested", fake_is_cancel_requested)

    job_id = enqueue(conn, kind="separate", song_id=song.id, payload={"song_id": song.id})
    run_one(conn, device="cpu", worker_state=worker_state)

    cancelled = get_job(conn, job_id)
    assert cancelled.state == "cancelled"
    assert not (song_dir / "stems").exists() or list((song_dir / "stems").iterdir()) == []
