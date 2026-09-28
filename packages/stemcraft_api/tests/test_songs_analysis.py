import pytest
from fastapi.testclient import TestClient
from stemcraft_api.app import create_app
from stemcraft_lib.analysis import Analysis, BeatGrid, ChordSegment, KeyCandidate, write_analysis
from stemcraft_lib.song import create_song_dir, new_song


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("STEMCRAFT_DATA_DIR", str(tmp_path / "data"))
    monkeypatch.setenv("STEMCRAFT_SONGS_DIR", str(tmp_path / "songs"))
    monkeypatch.setenv("STEMCRAFT_DIST_DIR", str(tmp_path / "nodist"))
    monkeypatch.setenv("STEMCRAFT_SKIP_BOOT_CHECKS", "1")
    return TestClient(create_app())


def test_get_analysis_before_it_exists_is_404(client, tmp_path):
    song = new_song(title="T", artist="A", source_kind="upload", source_value="original.mp3")
    create_song_dir(tmp_path / "songs", song)

    resp = client.get(f"/api/songs/{song.id}/analysis")
    assert resp.status_code == 404


def test_get_analysis_returns_the_written_file(client, tmp_path):
    song = new_song(title="T", artist="A", source_kind="upload", source_value="original.mp3")
    song_dir = create_song_dir(tmp_path / "songs", song)
    write_analysis(
        song_dir,
        Analysis(
            key_candidates=[KeyCandidate(tonic="G", mode="minor", confidence=1.0)],
            beat_grid=BeatGrid(bpm=120.0, beats=[1920], downbeats=[1920]),
            chords=[ChordSegment(bar=0, start_sample=1920, end_sample=48000, chord="G:min")],
        ),
    )

    resp = client.get(f"/api/songs/{song.id}/analysis")
    assert resp.status_code == 200
    body = resp.json()
    assert body["key_candidates"][0]["tonic"] == "G"
    assert body["beat_grid"]["bpm"] == 120.0
    assert body["chords"][0]["chord"] == "G:min"
