import numpy as np
import pytest
import soundfile as sf
import stemcraft_worker.kinds.transcribe_song  # noqa: F401  (registers on import)
from stemcraft_lib.jobs import connect, enqueue, get_job
from stemcraft_lib.song import STEM_NAMES, create_song_dir, new_song
from stemcraft_lib.transcription import read_transcription
from stemcraft_worker.main import run_one

SR = 48000
# The "click track" for this feature: a known bass line, rendered, must come back.
LINE = [(33, 0.40), (36, 0.40), (38, 0.40), (40, 0.40), (31, 0.60), (31, 0.40), (43, 0.40)]


def _pluck(midi, seconds):
    t = np.arange(int(seconds * SR)) / SR
    f = 440.0 * 2 ** ((midi - 69) / 12)
    tone = sum(np.sin(2 * np.pi * f * k * t) / k for k in range(1, 6))  # a few harmonics
    env = np.exp(-t * 3.0) * np.minimum(1.0, t / 0.005)
    return 0.3 * tone * env


def _render():
    gap = np.zeros(int(0.05 * SR))
    parts, onsets, at = [np.zeros(int(0.3 * SR))], [], int(0.3 * SR)
    for midi, secs in LINE:
        onsets.append(at)
        note = _pluck(midi, secs)
        parts += [note, gap]
        at += len(note) + len(gap)
    parts.append(np.zeros(int(0.3 * SR)))
    mono = np.concatenate(parts).astype(np.float32)
    return np.stack([mono, mono], axis=1), onsets


@pytest.fixture
def song_dir(tmp_path, monkeypatch):
    monkeypatch.setenv("STEMCRAFT_SONGS_DIR", str(tmp_path / "songs"))
    song = new_song(title="Line", artist="", source_kind="upload", source_value="original.mp3")
    d = create_song_dir(tmp_path / "songs", song)
    (d / "stems").mkdir()
    for name in STEM_NAMES:
        (d / "stems" / f"{name}.opus").write_bytes(b"")
        if name != "bass":
            (d / "stems" / f"{name}.wav").write_bytes(b"")
    audio, onsets = _render()
    sf.write(d / "stems" / "bass.wav", audio, SR, subtype="PCM_16")
    return d, song.id, onsets


def test_transcribes_a_known_line(song_dir, tmp_path):
    d, song_id, onsets = song_dir
    conn = connect(tmp_path / "jobs.sqlite")
    job_id = enqueue(conn, kind="transcribe", song_id=song_id, payload={"song_id": song_id})
    run_one(conn, device="cpu")
    job = get_job(conn, job_id)
    assert job.state == "done", job.error
    t = read_transcription(d)
    assert t.device == "cpu" and t.model == "crepe-full"
    assert [n.midi for n in t.notes] == [m for m, _ in LINE]
    for note, expected in zip(t.notes, onsets, strict=True):
        assert abs(note.start - expected) <= 0.03 * SR
    assert job.result == {"notes": len(LINE)}


def test_refuses_a_song_without_stems(tmp_path, monkeypatch):
    monkeypatch.setenv("STEMCRAFT_SONGS_DIR", str(tmp_path / "songs"))
    song = new_song(title="X", artist="", source_kind="upload", source_value="original.mp3")
    create_song_dir(tmp_path / "songs", song)
    conn = connect(tmp_path / "jobs.sqlite")
    job_id = enqueue(conn, kind="transcribe", song_id=song.id, payload={"song_id": song.id})
    run_one(conn, device="cpu")
    job = get_job(conn, job_id)
    assert job.state == "failed" and "no separated stems" in job.error
