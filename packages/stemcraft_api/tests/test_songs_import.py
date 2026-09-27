import shutil
import subprocess

import pytest
from fastapi.testclient import TestClient
from stemcraft_api.app import create_app


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("STEMCRAFT_DATA_DIR", str(tmp_path / "data"))
    monkeypatch.setenv("STEMCRAFT_SONGS_DIR", str(tmp_path / "songs"))
    monkeypatch.setenv("STEMCRAFT_DIST_DIR", str(tmp_path / "nodist"))
    monkeypatch.setenv("STEMCRAFT_SKIP_BOOT_CHECKS", "1")
    return TestClient(create_app())


def _song_dir(tmp_path, song_id):
    matches = list((tmp_path / "songs").glob(f"{song_id}-*"))
    assert len(matches) == 1
    return matches[0]


def test_upload_creates_song_dir_original_and_enqueues_import(client, tmp_path):
    response = client.post(
        "/api/songs/upload",
        files={"file": ("track.mp3", b"not real audio bytes", "audio/mpeg")},
        data={"title": "My Song", "artist": "Someone"},
    )
    assert response.status_code == 201
    body = response.json()
    song = body["song"]
    assert song["title"] == "My Song"
    assert song["artist"] == "Someone"
    assert song["source"] == {"kind": "upload", "value": "original.mp3"}
    assert isinstance(body["job_id"], int)

    song_dir = _song_dir(tmp_path, song["id"])
    assert (song_dir / "original.mp3").read_bytes() == b"not real audio bytes"
    assert not (song_dir / "audio.wav").exists()

    jobs = client.get("/api/jobs").json()["jobs"]
    assert jobs[0]["kind"] == "import"
    assert jobs[0]["song_id"] == song["id"]
    assert jobs[0]["state"] == "queued"


def test_upload_defaults_extensionless_filename_and_blank_title(client, tmp_path):
    response = client.post(
        "/api/songs/upload",
        files={"file": ("mystery", b"bytes", "application/octet-stream")},
    )
    assert response.status_code == 201
    song = response.json()["song"]
    assert song["source"]["value"] == "original.input"
    assert song["title"] == "mystery"

    song_dir = _song_dir(tmp_path, song["id"])
    assert (song_dir / "original.input").is_file()


@pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="ffmpeg not installed on this host")
def test_upload_prefills_title_and_artist_from_tags_when_blank(client, tmp_path):
    src = tmp_path / "tagged.mp3"
    subprocess.run(
        [
            "ffmpeg", "-hide_banner", "-nostdin", "-y", "-f", "lavfi",
            "-i", "sine=frequency=440:duration=0.2:sample_rate=44100",
            "-ac", "2", "-codec:a", "libmp3lame",
            "-metadata", "title=Tagged Title", "-metadata", "artist=Tagged Artist",
            str(src),
        ],
        check=True, capture_output=True,
    )

    response = client.post(
        "/api/songs/upload",
        files={"file": ("tagged.mp3", src.read_bytes(), "audio/mpeg")},
    )
    song = response.json()["song"]
    assert song["title"] == "Tagged Title"
    assert song["artist"] == "Tagged Artist"


@pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="ffmpeg not installed on this host")
def test_upload_user_typed_title_wins_over_tags(client, tmp_path):
    src = tmp_path / "tagged.mp3"
    subprocess.run(
        [
            "ffmpeg", "-hide_banner", "-nostdin", "-y", "-f", "lavfi",
            "-i", "sine=frequency=440:duration=0.2:sample_rate=44100",
            "-ac", "2", "-codec:a", "libmp3lame", "-metadata", "title=From Tag",
            str(src),
        ],
        check=True, capture_output=True,
    )

    response = client.post(
        "/api/songs/upload",
        files={"file": ("tagged.mp3", src.read_bytes(), "audio/mpeg")},
        data={"title": "User Typed"},
    )
    assert response.json()["song"]["title"] == "User Typed"


def test_from_url_creates_song_with_no_original_yet(client, tmp_path):
    response = client.post(
        "/api/songs/from-url",
        json={"url": "https://example.com/video", "title": "URL Song", "artist": "Band"},
    )
    assert response.status_code == 201
    song = response.json()["song"]
    assert song["source"] == {"kind": "url", "value": "https://example.com/video"}

    song_dir = _song_dir(tmp_path, song["id"])
    assert list(song_dir.glob("original.*")) == []
    assert (song_dir / "song.json").is_file()

    jobs = client.get("/api/jobs").json()["jobs"]
    assert jobs[0]["kind"] == "import"
    assert jobs[0]["song_id"] == song["id"]


def test_from_url_requires_a_title(client):
    response = client.post(
        "/api/songs/from-url", json={"url": "https://example.com/video", "title": ""}
    )
    assert response.status_code == 422


def test_from_url_missing_title_field_entirely_is_422(client):
    response = client.post("/api/songs/from-url", json={"url": "https://example.com/video"})
    assert response.status_code == 422
