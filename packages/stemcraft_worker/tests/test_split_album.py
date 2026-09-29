import shutil
import subprocess
import zipfile

import pytest
import stemcraft_worker.kinds.split_album  # noqa: F401  (registers on import)
from stemcraft_lib import ffmpeg
from stemcraft_lib.album import (
    Album,
    SplitRecipe,
    SplitTrack,
    Track,
    create_album_dir,
    new_album,
    write_album,
    zip_path,
)
from stemcraft_lib.ffmpeg import probe
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


def _ready_album(albums_dir, *, seconds=12):
    album = new_album(title="Test Album", artist="Tester", source_value="original.wav")
    album_dir = create_album_dir(albums_dir, album)
    subprocess.run(
        ["ffmpeg", "-hide_banner", "-nostdin", "-y", "-f", "lavfi",
         "-i", f"sine=frequency=440:duration={seconds}:sample_rate={SAMPLE_RATE}",
         "-ac", "2", "-c:a", "pcm_s16le", str(album_dir / "audio.wav")],
        check=True, capture_output=True,
    )
    return album, album_dir


def _recipe(album, *, boundary_s=6, total_s=12, second_title="Two", second_file="02-two.mp3"):
    return SplitRecipe(
        album_id=album.id, album_title="Test Album", artist="Tester",
        tracks=[
            SplitTrack(number=1, title="One", start_sample=0,
                       end_sample=boundary_s * SAMPLE_RATE, filename="01-one.mp3"),
            SplitTrack(number=2, title=second_title, start_sample=boundary_s * SAMPLE_RATE,
                       end_sample=total_s * SAMPLE_RATE, filename=second_file),
        ],
    )


def _three_track_recipe(album, *, total_s=12):
    """Three equal tracks: a mid-run cancel needs at least one track after the
    checkpoint that fires."""
    step = (total_s // 3) * SAMPLE_RATE
    names = [(1, "One", "01-one.mp3"), (2, "Two", "02-two.mp3"), (3, "Three", "03-three.mp3")]
    return SplitRecipe(
        album_id=album.id, album_title="Test Album", artist="Tester",
        tracks=[
            SplitTrack(number=n, title=t, start_sample=i * step,
                       end_sample=(i + 1) * step, filename=f)
            for i, (n, t, f) in enumerate(names)
        ],
    )


def _queue(conn, recipe):
    return enqueue(conn, kind="split_album", song_id=None,
                   payload=recipe.model_dump(mode="json"))


def test_split_renders_every_track_and_the_zip(conn, albums_dir):
    album, album_dir = _ready_album(albums_dir)
    job_id = _queue(conn, _recipe(album))
    assert run_one(conn, device="cpu") == job_id

    done = get_job(conn, job_id)
    assert done.state == "done", done.error
    assert (album_dir / "tracks" / "01-one.mp3").is_file()
    assert (album_dir / "tracks" / "02-two.mp3").is_file()
    assert [t["filename"] for t in done.result["tracks"]] == ["01-one.mp3", "02-two.mp3"]
    with zipfile.ZipFile(zip_path(album_dir)) as zf:
        assert zf.namelist() == ["01-one.mp3", "02-two.mp3"]
    steps = get_job(conn, job_id).steps
    assert [(s["id"], s["state"]) for s in steps] == [("tracks", "done"), ("zip", "done")]
    assert steps[0]["detail"].endswith("rendered")


def test_the_tracks_have_the_durations_the_boundaries_asked_for(conn, albums_dir):
    album, album_dir = _ready_album(albums_dir)
    _queue(conn, _recipe(album, boundary_s=4))
    run_one(conn, device="cpu")
    # 50 ms tolerance: MP3 framing is not sample-exact, but a boundary that is
    # wrong by a track length is caught easily.
    one = probe(album_dir / "tracks" / "01-one.mp3").duration_seconds
    two = probe(album_dir / "tracks" / "02-two.mp3").duration_seconds
    assert one == pytest.approx(4.0, abs=0.05)
    assert two == pytest.approx(8.0, abs=0.05)


def test_the_tracks_carry_album_and_track_number_tags(conn, albums_dir):
    # D8-08. ProbeResult exposes album and track precisely so this can assert
    # what its name claims: before, it could only reach title and artist, and
    # deleting -metadata album= / -metadata track= left it green.
    album, album_dir = _ready_album(albums_dir)
    _queue(conn, _recipe(album))
    run_one(conn, device="cpu")
    tags = probe(album_dir / "tracks" / "01-one.mp3")
    assert tags.title == "One"
    assert tags.artist == "Tester"
    assert tags.album == "Test Album"
    # ffprobe reports the ID3 track frame as written: "N/total".
    assert tags.track == "1/2"
    second = probe(album_dir / "tracks" / "02-two.mp3")
    assert second.track == "2/2"


def test_split_follows_the_payload_when_album_json_disagrees(conn, albums_dir):
    # A stronger proof of D8-05 than deleting album.json: the document is left
    # in place but its content actively disagrees with the payload -- a
    # different boundary and different titles. If the job ever started
    # reading album.json it would render at the *document's* boundary/titles
    # instead of the payload's, silently -- a deletion test cannot catch that
    # regression, because a job that reads the document works fine right up
    # until the document is missing.
    album, album_dir = _ready_album(albums_dir)
    contradictory = Album(
        **{
            **album.model_dump(),
            "split_points": [3 * SAMPLE_RATE],
            "tracks": [Track(title="Wrong One"), Track(title="Wrong Two")],
        }
    )
    write_album(album_dir, contradictory)

    job_id = _queue(conn, _recipe(album))  # boundary_s=6, titles One/Two
    run_one(conn, device="cpu")
    done = get_job(conn, job_id)
    assert done.state == "done", done.error

    one = probe(album_dir / "tracks" / "01-one.mp3")
    two = probe(album_dir / "tracks" / "02-two.mp3")
    assert one.duration_seconds == pytest.approx(6.0, abs=0.05)
    assert two.duration_seconds == pytest.approx(6.0, abs=0.05)
    assert one.title == "One"
    assert two.title == "Two"


def test_rerunning_overwrites_its_own_output(conn, albums_dir):
    # §6. Byte-identical is deliberately not asserted: LAME writes an encoder
    # delay that is stable in practice but not guaranteed across builds.
    album, album_dir = _ready_album(albums_dir)
    for _ in range(2):
        _queue(conn, _recipe(album))
        run_one(conn, device="cpu")
    assert len(list((album_dir / "tracks").glob("*.mp3"))) == 2
    with zipfile.ZipFile(zip_path(album_dir)) as zf:
        assert zf.namelist() == ["01-one.mp3", "02-two.mp3"]


def test_a_stale_track_from_an_earlier_split_leaves_neither_the_zip_nor_the_disk(
    conn, albums_dir
):
    # Renaming a track and re-splitting must not leave the old filename in the
    # zip -- the zip is built from the recipe, not from a directory listing --
    # and must not leave the old FILE either: list_tracks globs the directory,
    # so an orphan shows up in GET /api/albums/{id}/tracks as a thirteenth
    # track of a twelve-track album, disagreeing with the zip beside it.
    album, album_dir = _ready_album(albums_dir)
    _queue(conn, _recipe(album))
    run_one(conn, device="cpu")
    assert (album_dir / "tracks" / "02-two.mp3").is_file()

    _queue(conn, _recipe(album, second_title="Renamed", second_file="02-renamed.mp3"))
    run_one(conn, device="cpu")
    with zipfile.ZipFile(zip_path(album_dir)) as zf:
        assert zf.namelist() == ["01-one.mp3", "02-renamed.mp3"]
    # §6: after the job, the recipe fully determines tracks/.
    assert not (album_dir / "tracks" / "02-two.mp3").exists()
    assert sorted(p.name for p in (album_dir / "tracks").glob("*.mp3")) == [
        "01-one.mp3",
        "02-renamed.mp3",
    ]


def test_a_missing_audio_wav_fails_loudly(conn, albums_dir):
    album, album_dir = _ready_album(albums_dir)
    (album_dir / "audio.wav").unlink()
    job_id = _queue(conn, _recipe(album))
    run_one(conn, device="cpu")
    done = get_job(conn, job_id)
    assert done.state == "failed"
    assert "audio.wav" in done.error


def test_a_cancel_before_the_job_is_claimed_never_runs_it(conn, albums_dir):
    # request_cancel on a QUEUED row transitions it straight to `cancelled`,
    # and claim_next only selects state='queued' -- so run_one claims nothing
    # and split_album.run is never entered. That is worth pinning (the queue
    # must not resurrect a cancelled row) but it exercises no code in this
    # module; the in-loop checkpoints are covered by the two tests below.
    album, album_dir = _ready_album(albums_dir)
    job_id = _queue(conn, _recipe(album))
    request_cancel(conn, job_id)
    assert run_one(conn, device="cpu") is None
    assert get_job(conn, job_id).state == "cancelled"
    assert not (album_dir / "tracks").exists()
    assert not zip_path(album_dir).exists()


def _cancel_after_nth_render(conn, monkeypatch, job_id_box, *, after):
    """Patch render_track so the Nth completed track cancels the running job --
    a real mid-run cancel, unlike cancelling a row that was never claimed."""
    real = ffmpeg.render_track
    rendered = []

    def cancelling_render_track(*args, **kwargs):
        real(*args, **kwargs)
        rendered.append(1)
        if len(rendered) == after:
            request_cancel(conn, job_id_box[0])

    monkeypatch.setattr(ffmpeg, "render_track", cancelling_render_track)
    return rendered


def test_a_cancel_between_tracks_stops_the_render_and_writes_no_zip(
    conn, albums_dir, monkeypatch
):
    # D8-06: the checkpoint is between tracks. Cancelling after track 1 of 3
    # must leave exactly that one track, no zip, and no temp file anywhere.
    album, album_dir = _ready_album(albums_dir)
    box = [_queue(conn, _three_track_recipe(album))]
    rendered = _cancel_after_nth_render(conn, monkeypatch, box, after=1)

    assert run_one(conn, device="cpu") == box[0]
    assert get_job(conn, box[0]).state == "cancelled", get_job(conn, box[0]).error
    assert len(rendered) == 1
    assert sorted(p.name for p in (album_dir / "tracks").glob("*.mp3")) == ["01-one.mp3"]
    assert not zip_path(album_dir).exists()
    assert list(album_dir.glob("**/*.tmp")) == []
    assert [s["state"] for s in get_job(conn, box[0]).steps] == ["cancelled", "pending"]


def test_a_cancel_during_the_last_track_still_writes_no_zip(conn, albums_dir, monkeypatch):
    # The post-loop checkpoint, which the between-tracks test above cannot
    # reach: cancelling during the final render leaves the loop with nothing
    # left to check, so only the check before write_album_zip stops the zip.
    album, album_dir = _ready_album(albums_dir)
    box = [_queue(conn, _three_track_recipe(album))]
    rendered = _cancel_after_nth_render(conn, monkeypatch, box, after=3)

    run_one(conn, device="cpu")
    assert get_job(conn, box[0]).state == "cancelled"
    assert len(rendered) == 3
    assert not zip_path(album_dir).exists()
    assert list(album_dir.glob("**/*.tmp")) == []


def test_a_payload_that_is_not_a_recipe_fails_with_pydantics_message(conn, albums_dir):
    job_id = enqueue(conn, kind="split_album", song_id=None, payload={"nonsense": True})
    run_one(conn, device="cpu")
    done = get_job(conn, job_id)
    assert done.state == "failed"
    assert "album_id" in done.error
