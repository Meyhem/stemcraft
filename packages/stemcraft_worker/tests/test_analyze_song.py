import shutil
import subprocess

import pytest
import stemcraft_worker.kinds.analyze_song  # noqa: F401  (registers on import)
from stemcraft_lib.analysis import read_analysis
from stemcraft_lib.jobs import connect, enqueue, get_job
from stemcraft_lib.song import STEM_NAMES, create_song_dir, new_song
from stemcraft_worker.main import run_one

pytestmark = pytest.mark.skipif(
    shutil.which("ffmpeg") is None, reason="ffmpeg not installed on this host"
)

SAMPLE_RATE = 48000


@pytest.fixture
def conn(tmp_path):
    return connect(tmp_path / "jobs.sqlite")


@pytest.fixture
def songs_dir(tmp_path, monkeypatch):
    d = tmp_path / "songs"
    monkeypatch.setenv("STEMCRAFT_SONGS_DIR", str(d))
    return d


@pytest.fixture
def data_dir(tmp_path, monkeypatch):
    # BTC's checkpoint cache lives under settings().data_dir/models/btc.
    d = tmp_path / "data"
    monkeypatch.setenv("STEMCRAFT_DATA_DIR", str(d))
    return d


def _click_and_chord_wav(path, *, bpm=120, seconds=12, sample_rate=SAMPLE_RATE):
    interval = 60.0 / bpm
    click_expr = f"aevalsrc=0.5*sin(2*PI*1000*t)*lt(mod(t\\,{interval})\\,0.03):d={seconds}"
    subprocess.run(
        ["ffmpeg", "-hide_banner", "-nostdin", "-y",
         "-f", "lavfi", "-i", click_expr,
         "-f", "lavfi", "-i", f"sine=frequency=196.00:duration={seconds}",
         "-f", "lavfi", "-i", f"sine=frequency=233.08:duration={seconds}",
         "-f", "lavfi", "-i", f"sine=frequency=293.66:duration={seconds}",
         "-filter_complex", "amix=inputs=4:duration=longest",
         "-ar", str(sample_rate), "-ac", "2", "-c:a", "pcm_s16le", str(path)],
        check=True, capture_output=True,
    )


def _mono_sine_wav(path, freqs, *, seconds=12, sample_rate=SAMPLE_RATE):
    inputs = []
    for f in freqs:
        inputs += ["-f", "lavfi", "-i", f"sine=frequency={f}:duration={seconds}"]
    subprocess.run(
        ["ffmpeg", "-hide_banner", "-nostdin", "-y", *inputs,
         "-filter_complex", f"amix=inputs={len(freqs)}:duration=longest",
         "-ar", str(sample_rate), "-ac", "2", "-c:a", "pcm_s16le", str(path)],
        check=True, capture_output=True,
    )


def _make_analyzable_song(songs_dir):
    song = new_song(title="T", artist="A", source_kind="upload", source_value="original.mp3")
    song_dir = create_song_dir(songs_dir, song)
    _click_and_chord_wav(song_dir / "audio.wav")
    stems_dir = song_dir / "stems"
    stems_dir.mkdir()
    _mono_sine_wav(stems_dir / "bass.wav", [196.00])
    _mono_sine_wav(stems_dir / "other.wav", [233.08, 293.66])
    for name in STEM_NAMES:
        if name in ("bass", "other"):
            continue
        _mono_sine_wav(stems_dir / f"{name}.wav", [440.0], seconds=1)
    for name in STEM_NAMES:
        (stems_dir / f"{name}.opus").write_bytes(b"")  # has_stems only checks presence
    return song, song_dir


def test_analyze_writes_analysis_json(conn, songs_dir, data_dir):
    song, song_dir = _make_analyzable_song(songs_dir)

    job_id = enqueue(conn, kind="analyze", song_id=song.id, payload={"song_id": song.id})
    assert run_one(conn, device="cpu") == job_id

    done = get_job(conn, job_id)
    assert done.state == "done", done.error
    analysis = read_analysis(song_dir)
    assert len(analysis.key_candidates) == 3
    assert analysis.beat_grid.bpm > 0
    assert len(analysis.beat_grid.beats) > 0
    assert len(analysis.chords) > 0


def test_analyze_without_stems_fails_loudly(conn, songs_dir, data_dir):
    song = new_song(title="T", artist="A", source_kind="upload", source_value="original.mp3")
    song_dir = create_song_dir(songs_dir, song)
    _click_and_chord_wav(song_dir / "audio.wav")
    # stems/ deliberately never written.

    job_id = enqueue(conn, kind="analyze", song_id=song.id, payload={"song_id": song.id})
    run_one(conn, device="cpu")

    failed = get_job(conn, job_id)
    assert failed.state == "failed"
    assert song.id in failed.error


def test_rerunning_analyze_is_idempotent(conn, songs_dir, data_dir):
    song, song_dir = _make_analyzable_song(songs_dir)

    enqueue(conn, kind="analyze", song_id=song.id, payload={"song_id": song.id})
    run_one(conn, device="cpu")
    first = (song_dir / "analysis.json").read_bytes()

    enqueue(conn, kind="analyze", song_id=song.id, payload={"song_id": song.id})
    run_one(conn, device="cpu")
    second = (song_dir / "analysis.json").read_bytes()

    assert first == second
