import json
import shutil
import subprocess

import pytest
import stemcraft_worker.kinds.import_album  # noqa: F401  (registers on import)
from stemcraft_lib.album import create_album_dir, new_album, read_album
from stemcraft_lib.jobs import connect, enqueue, get_job, request_cancel
from stemcraft_worker.main import run_one

pytestmark = pytest.mark.skipif(
    shutil.which("ffmpeg") is None, reason="ffmpeg not installed on this host"
)

SAMPLE_RATE = 48000


@pytest.fixture
def conn(tmp_path):
    return connect(tmp_path / "jobs.sqlite")


@pytest.fixture
def albums_dir(tmp_path, monkeypatch):
    d = tmp_path / "albums"
    monkeypatch.setenv("STEMCRAFT_ALBUMS_DIR", str(d))
    return d


def _make_album(albums_dir):
    """A synthetic album: 5 s tone, 2 s silence, 5 s tone. The gap is a known
    boundary, which is what makes the proposal assertable rather than a
    judgement call -- the same trick Phase 3 used with a click track."""
    album = new_album(title="Test Album", artist="Tester", source_value="original.wav")
    album_dir = create_album_dir(albums_dir, album)
    subprocess.run(
        ["ffmpeg", "-hide_banner", "-nostdin", "-y",
         "-f", "lavfi", "-i", f"sine=frequency=440:duration=5:sample_rate={SAMPLE_RATE}",
         "-f", "lavfi", "-i", f"anullsrc=r={SAMPLE_RATE}:cl=stereo",
         "-f", "lavfi", "-i", f"sine=frequency=660:duration=5:sample_rate={SAMPLE_RATE}",
         "-filter_complex",
         "[0]aformat=cl=stereo[a];[1]atrim=duration=2,aformat=cl=stereo[g];"
         "[2]aformat=cl=stereo[b];[a][g][b]concat=n=3:v=0:a=1[out]",
         "-map", "[out]", "-ac", "2", "-c:a", "pcm_s16le",
         str(album_dir / "original.wav")],
        check=True, capture_output=True,
    )
    return album, album_dir


def _queue(conn, album):
    return enqueue(conn, kind="import_album", song_id=None, payload={"album_id": album.id})


def test_import_album_writes_the_three_worker_owned_files(conn, albums_dir):
    album, album_dir = _make_album(albums_dir)
    job_id = _queue(conn, album)
    assert run_one(conn, device="cpu") == job_id

    done = get_job(conn, job_id)
    assert done.state == "done", done.error
    assert (album_dir / "audio.wav").is_file()
    assert (album_dir / "peaks.json").is_file()
    assert (album_dir / "proposals.json").is_file()
    assert done.result["duration_seconds"] == pytest.approx(12.0, abs=0.1)
    assert done.result["total_samples"] == pytest.approx(12 * SAMPLE_RATE, rel=0.01)


def test_import_album_never_writes_album_json(conn, albums_dir):
    # Invariant 2 / D8-04, asserted directly: the API owns album.json.
    album, album_dir = _make_album(albums_dir)
    before = (album_dir / "album.json").read_bytes()
    _queue(conn, album)
    run_one(conn, device="cpu")
    assert (album_dir / "album.json").read_bytes() == before
    # In particular the length is reported, not stamped -- the API does that.
    assert read_album(album_dir).total_samples == 0


def test_the_proposal_lands_in_the_silent_gap(conn, albums_dir):
    album, album_dir = _make_album(albums_dir)
    job_id = _queue(conn, album)
    run_one(conn, device="cpu")

    done = get_job(conn, job_id)
    points = json.loads((album_dir / "proposals.json").read_text())["split_points"]
    assert done.result["proposed_split_points"] == points
    assert len(points) == 1
    # The gap runs 5.0 s -> 7.0 s, so its midpoint is 6.0 s. Half a second of
    # tolerance for the detector's own threshold ramp.
    assert points[0] / SAMPLE_RATE == pytest.approx(6.0, abs=0.5)


def test_the_original_is_never_modified(conn, albums_dir):
    # Invariant 9.
    album, album_dir = _make_album(albums_dir)
    before = (album_dir / "original.wav").read_bytes()
    _queue(conn, album)
    run_one(conn, device="cpu")
    assert (album_dir / "original.wav").read_bytes() == before


def test_rerunning_reproduces_the_same_proposals(conn, albums_dir):
    # §6: idempotent by re-derivation. A lease reclaim re-runs this from the top.
    album, _ = _make_album(albums_dir)
    first_id = _queue(conn, album)
    run_one(conn, device="cpu")
    second_id = _queue(conn, album)
    run_one(conn, device="cpu")
    assert get_job(conn, first_id).result == get_job(conn, second_id).result


def test_a_missing_album_fails_loudly_naming_the_id(conn, albums_dir):
    job_id = enqueue(conn, kind="import_album", song_id=None, payload={"album_id": "nosuchid"})
    run_one(conn, device="cpu")
    done = get_job(conn, job_id)
    assert done.state == "failed"
    # N-08: the id is in the message, not buried in a traceback.
    assert "nosuchid" in done.error


def test_a_cancel_requested_before_the_job_runs_ends_as_cancelled(conn, albums_dir):
    album, album_dir = _make_album(albums_dir)
    job_id = _queue(conn, album)
    request_cancel(conn, job_id)
    run_one(conn, device="cpu")
    done = get_job(conn, job_id)
    assert done.state == "cancelled"
    assert done.error is None  # a cancel is not a failure
