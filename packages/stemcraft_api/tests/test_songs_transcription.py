import pytest
from fastapi.testclient import TestClient
from stemcraft_api.app import create_app
from stemcraft_lib.jobs import connect, list_jobs
from stemcraft_lib.song import STEM_NAMES, create_song_dir, new_song
from stemcraft_lib.transcription import (
    TranscribedNote,
    Transcription,
    TranscriptionParams,
    write_transcription,
)


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("STEMCRAFT_DATA_DIR", str(tmp_path / "data"))
    monkeypatch.setenv("STEMCRAFT_SONGS_DIR", str(tmp_path / "songs"))
    monkeypatch.setenv("STEMCRAFT_DIST_DIR", str(tmp_path / "nodist"))
    monkeypatch.setenv("STEMCRAFT_SKIP_BOOT_CHECKS", "1")
    return TestClient(create_app())


def _song(tmp_path, *, stems=True):
    song = new_song(title="T", artist="A", source_kind="upload", source_value="original.mp3")
    d = create_song_dir(tmp_path / "songs", song)
    if stems:
        (d / "stems").mkdir()
        for name in STEM_NAMES:
            for ext in ("wav", "opus"):
                (d / "stems" / f"{name}.{ext}").write_bytes(b"")
    return song.id, d


def _jobs(tmp_path):
    conn = connect(tmp_path / "data" / "jobs.sqlite")
    return [j for j in list_jobs(conn, limit=None) if j.kind == "transcribe"]


def test_transcribe_enqueues_one_job(client, tmp_path):
    song_id, _ = _song(tmp_path)
    resp = client.post(f"/api/songs/{song_id}/transcribe")
    assert resp.status_code == 201
    (job,) = _jobs(tmp_path)
    assert job.id == resp.json()["job_id"] and job.payload == {"song_id": song_id}


def test_transcribe_without_stems_is_409(client, tmp_path):
    song_id, _ = _song(tmp_path, stems=False)
    resp = client.post(f"/api/songs/{song_id}/transcribe")
    assert resp.status_code == 409 and "stems" in resp.json()["detail"]


def test_a_second_transcribe_while_one_is_live_is_409(client, tmp_path):
    song_id, _ = _song(tmp_path)
    assert client.post(f"/api/songs/{song_id}/transcribe").status_code == 201
    resp = client.post(f"/api/songs/{song_id}/transcribe")
    assert resp.status_code == 409 and "already" in resp.json()["detail"]


def test_transcription_is_404_until_written_then_served_with_written_at(client, tmp_path):
    song_id, d = _song(tmp_path)
    assert client.get(f"/api/songs/{song_id}/transcription").status_code == 404
    assert client.get(f"/api/songs/{song_id}").json()["files"]["has_transcription"] is False
    write_transcription(d, Transcription(
        model="crepe-full", device="cuda",
        params=TranscriptionParams(fmin_hz=32, fmax_hz=400, hop_samples=480, voiced_min=0.5,
                                   gate_db=-45, jump_semitones=0.6, min_note_samples=2880),
        notes=[TranscribedNote(start=0, end=4800, midi=31, cents=0, confidence=0.9)],
    ))
    body = client.get(f"/api/songs/{song_id}/transcription").json()
    assert body["notes"][0]["midi"] == 31 and body["written_at"].startswith("20")
    assert client.get(f"/api/songs/{song_id}").json()["files"]["has_transcription"] is True


def test_an_unreadable_transcription_is_500_with_the_reason(client, tmp_path):
    song_id, d = _song(tmp_path)
    (d / "transcription.json").write_text('{"notes": "nope"}')
    resp = client.get(f"/api/songs/{song_id}/transcription")
    assert resp.status_code == 500 and "transcription.json" in resp.json()["detail"]
