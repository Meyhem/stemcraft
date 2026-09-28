"""Album splitter HTTP surface. Modelled on the songs test files' idiom:
each test module owns its `client` fixture (no shared conftest.py exists in
this package), and env vars point every directory at a fresh tmp_path.

Two fixtures this module needs don't exist anywhere in stemcraft_api/tests
yet -- `albums_dir` and `conn` -- so they're added here, alongside the
`client` pattern every other module in this package already repeats
verbatim, rather than introducing a conftest.py this task wasn't asked to add.
"""

from __future__ import annotations

import json

import pytest
from fastapi.testclient import TestClient
from stemcraft_api.app import create_app
from stemcraft_lib import jobs as jobs_db
from stemcraft_lib.album import read_album
from stemcraft_lib.config import SAMPLE_RATE, settings


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("STEMCRAFT_DATA_DIR", str(tmp_path / "data"))
    monkeypatch.setenv("STEMCRAFT_SONGS_DIR", str(tmp_path / "songs"))
    monkeypatch.setenv("STEMCRAFT_ALBUMS_DIR", str(tmp_path / "albums"))
    monkeypatch.setenv("STEMCRAFT_DIST_DIR", str(tmp_path / "nodist"))
    monkeypatch.setenv("STEMCRAFT_SKIP_BOOT_CHECKS", "1")
    return TestClient(create_app())


@pytest.fixture
def albums_dir(tmp_path):
    return tmp_path / "albums"


@pytest.fixture
def conn(client):
    # settings() reads the env vars `client` just set, so `client` must run
    # first -- same connection-per-test shape as test_split_album.py's `conn`
    # fixture in the worker package, but pointed at the API's own jobs.sqlite.
    return jobs_db.connect(settings().jobs_db)


def _upload(client, name="album.flac", title="Kind of Blue", artist="Miles Davis"):
    return client.post(
        "/api/albums/upload",
        files={"file": (name, b"\x00\x01\x02", "audio/flac")},
        data={"title": title, "artist": artist},
    )


# --- upload -------------------------------------------------------------

def test_upload_creates_the_album_and_queues_its_import(client, albums_dir, conn):
    response = _upload(client)
    assert response.status_code == 201
    body = response.json()
    album_id = body["album"]["id"]
    album_dir = next(albums_dir.iterdir())
    # §5: the API owns album.json AND original.* -- the bytes are already in
    # hand, so only the slow decode is a job. Same split as song upload.
    assert (album_dir / "album.json").is_file()
    assert (album_dir / "original.flac").is_file()
    job = [j for j in conn.execute("SELECT * FROM jobs")][0]
    assert job["kind"] == "import_album"
    assert json.loads(job["payload"])["album_id"] == album_id
    # D8-07: an album is not a Song, so the Song column is null.
    assert job["song_id"] is None


def test_upload_falls_back_to_the_filename_when_no_title_is_given(client, albums_dir):
    response = _upload(client, name="Live At Leeds.wav", title="")
    assert response.json()["album"]["title"] == "Live At Leeds"


def test_an_extensionless_upload_still_gets_a_file(client, albums_dir):
    _upload(client, name="noextension")
    assert (next(albums_dir.iterdir()) / "original.input").is_file()


# --- read and autosave --------------------------------------------------

def test_get_album_reports_derived_state_not_a_stored_field(client, albums_dir):
    album_id = _upload(client).json()["album"]["id"]
    body = client.get(f"/api/albums/{album_id}").json()
    assert body["state"] == "uploaded"
    assert body["files"]["has_audio"] is False


def test_put_saves_split_points_and_titles(client, albums_dir):
    album_id = _upload(client).json()["album"]["id"]
    album = client.get(f"/api/albums/{album_id}").json()["album"]
    album["total_samples"] = 1000
    album["split_points"] = [400]
    album["tracks"] = [{"title": "So What"}, {"title": "Blue in Green"}]
    response = client.put(f"/api/albums/{album_id}", json=album)
    assert response.status_code == 200
    saved = read_album(next(albums_dir.iterdir()))
    assert saved.split_points == [400]
    assert [t.title for t in saved.tracks] == ["So What", "Blue in Green"]


def test_put_refuses_a_body_whose_id_does_not_match_the_path(client, albums_dir):
    album_id = _upload(client).json()["album"]["id"]
    album = client.get(f"/api/albums/{album_id}").json()["album"]
    album["id"] = "somethingelse"
    assert client.put(f"/api/albums/{album_id}", json=album).status_code == 409


def test_put_cannot_rewrite_provenance(client, albums_dir):
    album_id = _upload(client).json()["album"]["id"]
    album = client.get(f"/api/albums/{album_id}").json()["album"]
    original_created = album["created_at"]
    album["created_at"] = "1999-01-01T00:00:00+00:00"
    album["source_value"] = "somethingelse.mp3"
    client.put(f"/api/albums/{album_id}", json=album)
    saved = read_album(next(albums_dir.iterdir()))
    assert saved.created_at == original_created
    assert saved.source_value == "original.flac"


def test_an_inconsistent_track_count_is_422_not_a_silent_fix(client, albums_dir):
    # N-08: pydantic's own message, never a clamp or a pad.
    album_id = _upload(client).json()["album"]["id"]
    album = client.get(f"/api/albums/{album_id}").json()["album"]
    album["total_samples"] = 1000
    album["split_points"] = [300, 600]
    album["tracks"] = [{"title": "only one"}]
    assert client.put(f"/api/albums/{album_id}", json=album).status_code == 422


def test_a_split_point_past_the_end_is_422(client, albums_dir):
    album_id = _upload(client).json()["album"]["id"]
    album = client.get(f"/api/albums/{album_id}").json()["album"]
    album["total_samples"] = 1000
    album["split_points"] = [5000]
    album["tracks"] = [{"title": "a"}, {"title": "b"}]
    assert client.put(f"/api/albums/{album_id}", json=album).status_code == 422


# --- proposals ----------------------------------------------------------

def test_proposals_are_404_until_the_import_job_has_written_them(client, albums_dir):
    album_id = _upload(client).json()["album"]["id"]
    assert client.get(f"/api/albums/{album_id}/proposals").status_code == 404


def test_proposals_are_served_as_written(client, albums_dir):
    album_id = _upload(client).json()["album"]["id"]
    album_dir = next(albums_dir.iterdir())
    (album_dir / "proposals.json").write_text(
        json.dumps({"total_samples": 1000, "split_points": [400, 700]})
    )
    body = client.get(f"/api/albums/{album_id}/proposals").json()
    assert body["split_points"] == [400, 700]


# --- queueing a split ---------------------------------------------------

def _ready(client, albums_dir, *, split_points=None, titles=None):
    upload = _upload(client).json()
    album_id = upload["album"]["id"]
    album_dir = next(albums_dir.iterdir())
    (album_dir / "audio.wav").write_bytes(b"")
    (album_dir / "peaks.json").write_text("{}")
    album = client.get(f"/api/albums/{album_id}").json()["album"]
    album["total_samples"] = SAMPLE_RATE * 12
    album["split_points"] = split_points if split_points is not None else [SAMPLE_RATE * 6]
    album["tracks"] = [{"title": t} for t in (titles or ["One", "Two"])]
    client.put(f"/api/albums/{album_id}", json=album)
    # The files above simulate what a completed import_album job produces, but
    # simulating them doesn't finish the job the upload actually enqueued --
    # that job is still 'queued' in jobs.sqlite (nothing here runs a worker),
    # and delete_album (like delete_song) treats any queued/running job as
    # live. A real import job would finish before these files could exist, so
    # its test double must retire the job too -- request_cancel, not finish(),
    # since finish() only moves a job out of 'running' and this one was never
    # claimed.
    jobs_db.request_cancel(jobs_db.connect(settings().jobs_db), upload["job_id"])
    return album_id, album_dir


def test_split_snapshots_the_recipe_into_the_payload(client, albums_dir, conn):
    album_id, _ = _ready(client, albums_dir)
    response = client.post(f"/api/albums/{album_id}/split")
    assert response.status_code == 201
    assert response.json()["tracks"] == 2
    job = [j for j in conn.execute("SELECT * FROM jobs WHERE kind = 'split_album'")][0]
    payload = json.loads(job["payload"])
    # D8-05: resolved at enqueue, not a pointer to album.json.
    assert payload["album_id"] == album_id
    assert payload["album_title"] == "Kind of Blue"
    assert [t["filename"] for t in payload["tracks"]] == ["01-one.mp3", "02-two.mp3"]
    assert [t["start_sample"] for t in payload["tracks"]] == [0, SAMPLE_RATE * 6]


def test_split_before_the_import_finished_is_409_naming_the_reason(client, albums_dir):
    album_id = _upload(client).json()["album"]["id"]
    response = client.post(f"/api/albums/{album_id}/split")
    assert response.status_code == 409
    assert "audio" in response.json()["detail"].lower()


def test_split_of_an_unknown_album_is_404(client, albums_dir):
    assert client.post("/api/albums/nosuchid/split").status_code == 404


def test_split_before_the_length_is_stamped_is_409_not_a_500(client, albums_dir):
    # recipe_from_album() yields no tracks while total_samples is 0, and
    # SplitRecipe requires at least one -- that must surface as a 409 naming the
    # reason, never as a pydantic traceback out of a 500.
    album_id = _upload(client).json()["album"]["id"]
    album_dir = next(albums_dir.iterdir())
    (album_dir / "audio.wav").write_bytes(b"")
    response = client.post(f"/api/albums/{album_id}/split")
    assert response.status_code == 409
    assert "length" in response.json()["detail"].lower()


# --- downloads and traversal -------------------------------------------

def test_track_download_serves_the_file(client, albums_dir):
    album_id, album_dir = _ready(client, albums_dir)
    tracks = album_dir / "tracks"
    tracks.mkdir()
    (tracks / "01-one.mp3").write_bytes(b"audio")
    response = client.get(f"/api/albums/{album_id}/tracks/01-one.mp3")
    assert response.status_code == 200
    assert response.headers["content-type"] == "audio/mpeg"


def test_zip_download_serves_the_archive(client, albums_dir):
    album_id, album_dir = _ready(client, albums_dir)
    (album_dir / "album.zip").write_bytes(b"PK\x03\x04")
    response = client.get(f"/api/albums/{album_id}/album.zip")
    assert response.status_code == 200
    assert response.headers["content-type"] == "application/zip"
    assert "attachment" in response.headers["content-disposition"]


def test_zip_before_a_split_is_404(client, albums_dir):
    album_id, _ = _ready(client, albums_dir)
    assert client.get(f"/api/albums/{album_id}/album.zip").status_code == 404


@pytest.mark.parametrize(
    "name",
    [
        # NOTE: these two never reach TRACK_FILENAME_PATTERN at all -- Starlette's
        # own routing rejects a raw "../" or an encoded "..%2F" before the request
        # gets to download_track. They stay in this list as a routing-level
        # regression pin, but they do not exercise the pattern check itself.
        "../album.json",
        "..%2F..%2Falbum.json",
        "01-ONE.mp3",        # uppercase is outside the pattern the app writes
        "1-one.mp3",         # unpadded number
        "01-one.wav",        # wrong extension
        "missing.mp3",
        # These two DO reach TRACK_FILENAME_PATTERN, and are the actual reason
        # it is anchored with \Z rather than $: `$` matches just before a
        # trailing newline, so "01-one.mp3\n" would satisfy a `$`-anchored
        # pattern while still being a different, attacker-chosen string handed
        # to the filesystem layer below. \Z has no such exception. Do not
        # "simplify" these away -- they are what actually pins the \Z choice;
        # without them the traversal test suite would pass just as well with
        # `$` in TRACK_FILENAME_PATTERN.
        "01-one.mp3%0A",     # trailing newline -- what \Z (not $) defends against
        "01-one.mp3%00",     # embedded null byte
    ],
)
def test_track_download_rejects_anything_the_app_never_wrote(client, albums_dir, name):
    # The filename is matched against TRACK_FILENAME_PATTERN rather than
    # sanitized: a name outside that alphabet is a name this app never produced.
    album_id, _ = _ready(client, albums_dir)
    assert client.get(f"/api/albums/{album_id}/tracks/{name}").status_code == 404


# --- delete -------------------------------------------------------------

def test_delete_removes_the_whole_album(client, albums_dir):
    album_id, album_dir = _ready(client, albums_dir)
    assert client.delete(f"/api/albums/{album_id}").status_code == 204
    assert not album_dir.exists()


def test_delete_is_blocked_by_a_live_job(client, albums_dir, conn):
    album_id, _ = _ready(client, albums_dir)
    client.post(f"/api/albums/{album_id}/split")
    response = client.delete(f"/api/albums/{album_id}")
    assert response.status_code == 409
    assert "job" in response.json()["detail"].lower()


def test_delete_is_blocked_by_the_uploads_own_still_queued_import_job(client, albums_dir):
    # Only the split_album path was covered above. An upload's import_album
    # job is just as live and must block delete on its own, with nothing else
    # queued behind it.
    album_id = _upload(client).json()["album"]["id"]
    response = client.delete(f"/api/albums/{album_id}")
    assert response.status_code == 409
    assert "job" in response.json()["detail"].lower()


def test_delete_gate_sees_past_the_first_200_jobs(client, albums_dir, conn):
    # jobs_db.list_jobs defaults to the newest 200 rows, ordered id DESC. The
    # worker is strictly serial, so an album's RUNNING job is always the
    # OLDEST row among queued-or-running jobs. Enqueue the album's own job
    # first, then bury it under 200 newer unrelated jobs, and delete must
    # still see it and refuse -- a page-limited scan of the live set would
    # find `live` empty here and let rmtree race the worker.
    album_id, _ = _ready(client, albums_dir)
    client.post(f"/api/albums/{album_id}/split")
    for _ in range(200):
        jobs_db.enqueue(conn, kind="probe", payload={})
    response = client.delete(f"/api/albums/{album_id}")
    assert response.status_code == 409
    assert "job" in response.json()["detail"].lower()


def test_one_unreadable_album_does_not_break_the_list(client, albums_dir):
    _upload(client)
    bad = albums_dir / "01BAD-broken"
    bad.mkdir()
    (bad / "album.json").write_text("{not json")
    body = client.get("/api/albums").json()
    assert len(body["albums"]) == 2
    assert sum(1 for a in body["albums"] if a["unreadable"]) == 1
