import shutil
import subprocess

import pytest
import stemcraft_worker.kinds.export_song  # noqa: F401  (registers on import)
from stemcraft_lib.export import ExportRecipe, ExportStem
from stemcraft_lib.ffmpeg import probe
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


def _sine_wav(path, freq, *, seconds=2.0):
    subprocess.run(
        ["ffmpeg", "-hide_banner", "-nostdin", "-y", "-f", "lavfi",
         "-i", f"sine=frequency={freq}:duration={seconds}:sample_rate={SAMPLE_RATE}",
         "-ac", "2", "-c:a", "pcm_s16le", str(path)],
        check=True, capture_output=True,
    )


def _make_separated_song(songs_dir, *, seconds=2.0):
    song = new_song(title="Tightrope", artist="Walk the Moon",
                    source_kind="upload", source_value="original.mp3")
    song_dir = create_song_dir(songs_dir, song)
    stems_dir = song_dir / "stems"
    stems_dir.mkdir()
    for index, name in enumerate(STEM_NAMES):
        _sine_wav(stems_dir / f"{name}.wav", 220 * (index + 1), seconds=seconds)
        (stems_dir / f"{name}.opus").write_bytes(b"")  # presence only; never read here
    return song, song_dir


def _recipe(song, **overrides) -> ExportRecipe:
    base = dict(
        song_id=song.id,
        name="tightrope-no-bass-82",
        stems=[ExportStem(name="vocals"), ExportStem(name="drums"), ExportStem(name="other")],
        tempo=0.82,
        pitch_semitones=-2,
        title=song.title,
        artist=song.artist,
    )
    return ExportRecipe(**{**base, **overrides})


def _queue(conn, song, recipe):
    return enqueue(conn, kind="export", song_id=song.id,
                   payload=recipe.model_dump(mode="json"))


def test_export_writes_the_mp3_and_reports_its_real_duration(conn, songs_dir):
    song, song_dir = _make_separated_song(songs_dir)

    job_id = _queue(conn, song, _recipe(song))
    assert run_one(conn, device="cpu") == job_id

    done = get_job(conn, job_id)
    assert done.state == "done", done.error
    mp3 = song_dir / "exports" / "tightrope-no-bass-82.mp3"
    assert mp3.is_file()
    assert done.result["file"] == "exports/tightrope-no-bass-82.mp3"
    assert done.result["bytes"] == mp3.stat().st_size
    assert done.result["stems"] == ["vocals", "drums", "other"]
    # 2 s at 82 % is 2.44 s: the exported file is longer than the song, which is
    # the whole point of "matches what you practised to".
    assert done.result["duration_seconds"] == pytest.approx(2.44, abs=0.2)
    assert probe(mp3).title == "Tightrope"


def test_export_at_original_tempo_matches_the_source_length(conn, songs_dir):
    song, song_dir = _make_separated_song(songs_dir)

    job_id = _queue(conn, song, _recipe(song, name="full", tempo=1.0, pitch_semitones=0))
    run_one(conn, device="cpu")

    done = get_job(conn, job_id)
    assert done.state == "done", done.error
    assert done.result["duration_seconds"] == pytest.approx(2.0, abs=0.2)


def test_export_never_reads_song_json_for_the_recipe(conn, songs_dir):
    """D7-02: the payload is the input. A song.json that moved after enqueue --
    exactly what Phase 6's autosave does -- must not change the render."""
    song, song_dir = _make_separated_song(songs_dir)
    recipe = _recipe(song, tempo=0.5, pitch_semitones=0)
    job_id = _queue(conn, song, recipe)

    written = (song_dir / "song.json").read_text().replace('"tempo": 1.0', '"tempo": 0.9')
    (song_dir / "song.json").write_text(written)
    run_one(conn, device="cpu")

    done = get_job(conn, job_id)
    assert done.state == "done", done.error
    # 0.5 from the payload, not 0.9 from the file.
    assert done.result["duration_seconds"] == pytest.approx(4.0, abs=0.2)


def test_rerunning_an_export_reproduces_the_same_bytes(conn, songs_dir):
    """§6: idempotent by re-derivation. This is what makes a lease reclaim safe."""
    song, song_dir = _make_separated_song(songs_dir)
    mp3 = song_dir / "exports" / "tightrope-no-bass-82.mp3"

    _queue(conn, song, _recipe(song))
    run_one(conn, device="cpu")
    first = mp3.read_bytes()

    _queue(conn, song, _recipe(song))
    run_one(conn, device="cpu")

    assert mp3.read_bytes() == first


def test_export_of_one_stem_alone(conn, songs_dir):
    song, song_dir = _make_separated_song(songs_dir)

    job_id = _queue(conn, song, _recipe(song, name="bass-only",
                                       stems=[ExportStem(name="bass")]))
    run_one(conn, device="cpu")

    assert get_job(conn, job_id).state == "done"
    assert (song_dir / "exports" / "bass-only.mp3").stat().st_size > 0


def test_export_with_a_missing_stem_master_fails_loudly(conn, songs_dir):
    song, song_dir = _make_separated_song(songs_dir)
    (song_dir / "stems" / "drums.wav").unlink()

    job_id = _queue(conn, song, _recipe(song))
    run_one(conn, device="cpu")

    failed = get_job(conn, job_id)
    assert failed.state == "failed"
    assert "drums.wav" in failed.error
    assert not (song_dir / "exports").exists()


def test_export_for_an_unknown_song_fails_loudly(conn, songs_dir):
    songs_dir.mkdir(parents=True, exist_ok=True)
    job_id = enqueue(conn, kind="export", song_id="01NOPE", payload={
        "song_id": "01NOPE", "name": "x", "stems": [{"name": "bass", "gain_db": 0.0}],
    })
    run_one(conn, device="cpu")

    failed = get_job(conn, job_id)
    assert failed.state == "failed"
    assert "01NOPE" in failed.error


def test_a_malformed_payload_fails_loudly_rather_than_rendering_something(conn, songs_dir):
    song, _ = _make_separated_song(songs_dir)
    job_id = enqueue(conn, kind="export", song_id=song.id,
                     payload={"song_id": song.id, "name": "x", "stems": []})
    run_one(conn, device="cpu")

    failed = get_job(conn, job_id)
    assert failed.state == "failed"
    assert "stems" in failed.error


def test_a_cancelled_export_leaves_no_file(conn, songs_dir):
    """Called directly rather than through run_one: request_cancel on a *queued*
    job marks it cancelled outright, so run_one would never claim it and the
    render would never start. What needs exercising is the flag being seen
    mid-render (D7-07), which means setting it on a row that is already running."""
    from stemcraft_lib import jobs as jobs_db
    from stemcraft_worker.kinds.export_song import run
    from stemcraft_worker.registry import JobCancelled, JobContext

    song, song_dir = _make_separated_song(songs_dir)
    recipe = _recipe(song)
    job_id = _queue(conn, song, recipe)
    # The flag the kind polls, set before the render starts.
    conn.execute("UPDATE jobs SET state = 'running', cancel_requested = 1 WHERE id = ?", (job_id,))
    ctx = JobContext(conn=conn, job_id=job_id, payload=recipe.model_dump(mode="json"),
                     device="cpu")

    with pytest.raises(JobCancelled):
        run(ctx)

    assert not (song_dir / "exports" / "tightrope-no-bass-82.mp3").exists()
    assert list((song_dir / "exports").iterdir()) == []
    assert jobs_db.get_job(conn, job_id).state == "running"  # run_one owns the transition
