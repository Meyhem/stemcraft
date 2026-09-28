from __future__ import annotations

import json

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


def _make_song(songs_dir, song_id: str = "abc123"):
    """A song folder with a stems/ set and a peaks.json, no worker involved."""
    song_dir = songs_dir / f"{song_id}-test-song"
    (song_dir / "stems").mkdir(parents=True)
    (song_dir / "song.json").write_text(
        json.dumps(
            {
                "schema_version": 1,
                "id": song_id,
                "title": "Test Song",
                "artist": "",
                "source": {"kind": "upload", "value": "original.mp3"},
                "created_at": "2026-09-28T00:00:00+00:00",
            }
        )
    )
    for name in ("vocals", "drums", "bass", "other"):
        (song_dir / "stems" / f"{name}.opus").write_bytes(b"OggS-fake-" + name.encode())
    (song_dir / "peaks.json").write_text(json.dumps({"version": 1, "length": 4}))
    (song_dir / "audio.wav").write_bytes(b"RIFF-fake")
    return song_dir


def test_stem_is_served_with_its_bytes(client: TestClient, tmp_path):
    songs_dir = tmp_path / "songs"
    _make_song(songs_dir)
    response = client.get("/api/songs/abc123/stems/bass.opus")
    assert response.status_code == 200
    assert response.content == b"OggS-fake-bass"
    assert response.headers["content-type"].startswith("audio/ogg")


def test_unknown_stem_name_is_rejected_without_touching_the_filesystem(
    client: TestClient, tmp_path
):
    songs_dir = tmp_path / "songs"
    _make_song(songs_dir)
    response = client.get("/api/songs/abc123/stems/guitar.opus")
    assert response.status_code == 404
    assert "guitar" in response.text


@pytest.mark.parametrize("attack", ["..%2F..%2Fsong.json", "....//song.json"])
def test_path_traversal_in_the_stem_name_never_escapes_the_song_folder(
    client: TestClient, tmp_path, attack: str
):
    songs_dir = tmp_path / "songs"
    _make_song(songs_dir)
    response = client.get(f"/api/songs/abc123/stems/{attack}.opus")
    assert response.status_code == 404
    assert b"schema_version" not in response.content


def test_missing_stem_file_404s_with_a_real_message(client: TestClient, tmp_path):
    songs_dir = tmp_path / "songs"
    song_dir = _make_song(songs_dir)
    (song_dir / "stems" / "vocals.opus").unlink()
    response = client.get("/api/songs/abc123/stems/vocals.opus")
    assert response.status_code == 404
    assert "vocals" in response.text


def test_peaks_are_served_as_json(client: TestClient, tmp_path):
    songs_dir = tmp_path / "songs"
    _make_song(songs_dir)
    response = client.get("/api/songs/abc123/peaks")
    assert response.status_code == 200
    assert response.json() == {"version": 1, "length": 4}


def test_audio_wav_is_served(client: TestClient, tmp_path):
    songs_dir = tmp_path / "songs"
    _make_song(songs_dir)
    response = client.get("/api/songs/abc123/audio.wav")
    assert response.status_code == 200
    assert response.content == b"RIFF-fake"


def test_media_for_an_unknown_song_404s(client: TestClient, tmp_path):
    songs_dir = tmp_path / "songs"
    response = client.get("/api/songs/nope/stems/bass.opus")
    assert response.status_code == 404
