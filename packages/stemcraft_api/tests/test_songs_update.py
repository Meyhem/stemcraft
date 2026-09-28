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


def _create(client: TestClient) -> dict:
    response = client.post(
        "/api/songs/from-url",
        json={"url": "https://example.invalid/x", "title": "Test Song"},
    )
    assert response.status_code == 201
    return response.json()["song"]


def test_put_round_trips_the_whole_recipe(client: TestClient):
    song = _create(client)
    song["mix"] = {"vocals": {"gain_db": -6.0, "muted": True}}
    song["playback"] = {"tempo": 0.75, "pitch_semitones": -2}
    song["active_loop"] = {"name": "A-B", "start_bar": 8, "end_bar": 16}
    song["metronome"] = True
    song["count_in_bars"] = 2
    song["last_played_at"] = "2026-09-28T12:00:00+00:00"

    response = client.put(f"/api/songs/{song['id']}", json=song)
    assert response.status_code == 200
    assert response.json()["song"]["active_loop"]["end_bar"] == 16

    # And it is on disk, not just echoed back.
    reread = client.get(f"/api/songs/{song['id']}").json()["song"]
    assert reread["playback"]["tempo"] == 0.75
    assert reread["mix"]["vocals"]["muted"] is True
    assert reread["metronome"] is True


def test_put_returns_the_same_shape_as_get(client: TestClient):
    song = _create(client)
    put = client.put(f"/api/songs/{song['id']}", json=song).json()
    get = client.get(f"/api/songs/{song['id']}").json()
    assert put.keys() == get.keys()
    assert put["state"] == get["state"]


def test_put_with_a_mismatched_id_is_rejected(client: TestClient):
    song = _create(client)
    song["id"] = "someoneelse"
    response = client.put(f"/api/songs/{song['id']}", json=song)
    # The path id no longer exists, so this is a 404 before it is anything else.
    assert response.status_code == 404

    other = _create(client)
    body = {**other, "id": song["id"]}
    response = client.put(f"/api/songs/{other['id']}", json=body)
    assert response.status_code == 409
    assert other["id"] in response.text


def test_put_cannot_rewrite_immutable_provenance(client: TestClient):
    song = _create(client)
    body = {
        **song,
        "created_at": "1999-01-01T00:00:00+00:00",
        "source": {"kind": "upload", "value": "hacked.mp3"},
    }
    response = client.put(f"/api/songs/{song['id']}", json=body)
    assert response.status_code == 200
    stored = response.json()["song"]
    assert stored["created_at"] == song["created_at"]
    assert stored["source"] == song["source"]


def test_last_write_wins_with_no_version_check(client: TestClient):
    # §5 / C-01: two tabs clobber each other and that is the accepted design.
    song = _create(client)
    first = {**song, "playback": {"tempo": 0.5, "pitch_semitones": 0}}
    second = {**song, "playback": {"tempo": 0.9, "pitch_semitones": 0}}
    assert client.put(f"/api/songs/{song['id']}", json=first).status_code == 200
    assert client.put(f"/api/songs/{song['id']}", json=second).status_code == 200
    assert client.get(f"/api/songs/{song['id']}").json()["song"]["playback"]["tempo"] == 0.9


def test_put_to_an_unknown_song_404s(client: TestClient):
    song = _create(client)
    song["id"] = "nope"
    response = client.put(f"/api/songs/nope", json=song)
    assert response.status_code == 404
