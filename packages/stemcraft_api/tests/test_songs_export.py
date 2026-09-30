import pytest
from fastapi.testclient import TestClient
from stemcraft_api.app import create_app
from stemcraft_lib.jobs import connect, get_job
from stemcraft_lib.song import STEM_NAMES, StemMix, create_song_dir, new_song, write_song


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("STEMCRAFT_DATA_DIR", str(tmp_path / "data"))
    monkeypatch.setenv("STEMCRAFT_SONGS_DIR", str(tmp_path / "songs"))
    monkeypatch.setenv("STEMCRAFT_DIST_DIR", str(tmp_path / "nodist"))
    monkeypatch.setenv("STEMCRAFT_SKIP_BOOT_CHECKS", "1")
    return TestClient(create_app())


def _separated_song(tmp_path, *, tempo=0.82, pitch=-2, gain_db=-6.0):
    """A song that looks separated to derive_files, with a practice recipe set."""
    song = new_song(title="Tightrope", artist="Walk the Moon",
                    source_kind="upload", source_value="original.mp3")
    song_dir = create_song_dir(tmp_path / "songs", song)
    stems_dir = song_dir / "stems"
    stems_dir.mkdir()
    for name in STEM_NAMES:
        for ext in ("wav", "opus"):
            (stems_dir / f"{name}.{ext}").write_bytes(b"x")
    song.playback.tempo = tempo
    song.playback.pitch_semitones = pitch
    song.mix["drums"] = StemMix(gain_db=gain_db, muted=False)
    song.mix["bass"] = StemMix(gain_db=0.0, muted=True)
    write_song(song_dir, song)
    return song, song_dir


def _payload_of(tmp_path, job_id):
    conn = connect(tmp_path / "data" / "jobs.sqlite")
    return get_job(conn, job_id).payload


def test_queue_export_snapshots_the_live_recipe_into_the_payload(client, tmp_path):
    # D7-02: the numbers travel with the job, not a pointer to song.json.
    song, _ = _separated_song(tmp_path)

    resp = client.post(f"/api/songs/{song.id}/export",
                       json={"stems": ["vocals", "drums", "other"]})

    assert resp.status_code == 201
    body = resp.json()
    assert body["name"] == "tightrope"
    assert body["file"] == "exports/tightrope.mp3"
    payload = _payload_of(tmp_path, body["job_id"])
    assert payload["tempo"] == 0.82
    assert payload["pitch_semitones"] == -2
    assert payload["title"] == "Tightrope"
    assert payload["artist"] == "Walk the Moon"
    assert payload["stems"] == [
        {"name": "vocals", "gain_db": 0.0},
        {"name": "drums", "gain_db": -6.0},
        {"name": "other", "gain_db": 0.0},
    ]


def test_the_job_row_is_an_export_job_for_this_song(client, tmp_path):
    song, _ = _separated_song(tmp_path)
    job_id = client.post(f"/api/songs/{song.id}/export",
                         json={"stems": ["bass"]}).json()["job_id"]

    conn = connect(tmp_path / "data" / "jobs.sqlite")
    job = get_job(conn, job_id)
    assert (job.kind, job.song_id, job.state) == ("export", song.id, "queued")


def test_original_toggle_neutralizes_tempo_and_pitch_but_keeps_the_mix(client, tmp_path):
    # The mockup's segmented control is labelled "tempo & pitch". Stem gains are
    # the mix, not the recipe's tempo, and stay whatever the user practised with.
    song, _ = _separated_song(tmp_path)

    job_id = client.post(
        f"/api/songs/{song.id}/export",
        json={"stems": ["vocals", "drums"], "apply_recipe": False},
    ).json()["job_id"]

    payload = _payload_of(tmp_path, job_id)
    assert payload["tempo"] == 1.0
    assert payload["pitch_semitones"] == 0
    assert payload["stems"][1] == {"name": "drums", "gain_db": -6.0}


def test_a_muted_stem_is_exported_when_explicitly_asked_for(client, tmp_path):
    # Exclusion is the picker's job (D7-03). `muted` in song.json prefills the
    # checkboxes in the UI; it is not a veto on the server.
    song, _ = _separated_song(tmp_path)
    job_id = client.post(f"/api/songs/{song.id}/export",
                         json={"stems": ["bass"]}).json()["job_id"]
    assert _payload_of(tmp_path, job_id)["stems"] == [{"name": "bass", "gain_db": 0.0}]


def test_the_name_is_slugified_and_defaults_to_the_title(client, tmp_path):
    song, _ = _separated_song(tmp_path)

    named = client.post(f"/api/songs/{song.id}/export",
                        json={"stems": ["bass"], "name": "Tightrope — no bass, 82%"})
    assert named.json()["name"] == "tightrope-no-bass-82"

    blank = client.post(f"/api/songs/{song.id}/export",
                        json={"stems": ["bass"], "name": "   "})
    assert blank.json()["name"] == "tightrope"


def test_no_stems_picked_is_422(client, tmp_path):
    song, _ = _separated_song(tmp_path)
    resp = client.post(f"/api/songs/{song.id}/export", json={"stems": []})
    assert resp.status_code == 422
    assert "stem" in resp.text


def test_an_unknown_stem_name_is_422(client, tmp_path):
    song, _ = _separated_song(tmp_path)
    resp = client.post(f"/api/songs/{song.id}/export", json={"stems": ["guitar"]})
    assert resp.status_code == 422
    assert "guitar" in resp.text


def test_exporting_an_unseparated_song_is_409_with_a_real_reason(client, tmp_path):
    song = new_song(title="T", artist="A", source_kind="upload", source_value="original.mp3")
    create_song_dir(tmp_path / "songs", song)

    resp = client.post(f"/api/songs/{song.id}/export", json={"stems": ["bass"]})
    assert resp.status_code == 409
    assert "separated" in resp.text


def test_exporting_an_unknown_song_is_404(client, tmp_path):
    resp = client.post("/api/songs/01NOPE/export", json={"stems": ["bass"]})
    assert resp.status_code == 404


def test_a_recipe_outside_the_allowed_range_is_422_not_a_500(client, tmp_path):
    # N-08: a song.json carrying a tempo the Song view could not have produced
    # surfaces as a refusal naming the field, never as a traceback or a clamp.
    song, _ = _separated_song(tmp_path, tempo=1.6)
    resp = client.post(f"/api/songs/{song.id}/export", json={"stems": ["bass"]})
    assert resp.status_code == 422
    assert "tempo" in resp.text


def test_exports_listing_is_empty_before_anything_is_rendered(client, tmp_path):
    song, _ = _separated_song(tmp_path)
    resp = client.get(f"/api/songs/{song.id}/exports")
    assert resp.status_code == 200
    assert resp.json() == {"exports": []}


def test_exports_listing_is_derived_from_the_directory(client, tmp_path):
    song, song_dir = _separated_song(tmp_path)
    (song_dir / "exports").mkdir()
    (song_dir / "exports" / "tightrope-82.mp3").write_bytes(b"ID3" + b"\x00" * 40)

    entries = client.get(f"/api/songs/{song.id}/exports").json()["exports"]
    assert len(entries) == 1
    assert entries[0]["name"] == "tightrope-82"
    assert entries[0]["file"] == "exports/tightrope-82.mp3"
    assert entries[0]["bytes"] == 43


def test_download_serves_the_bytes_as_an_attachment(client, tmp_path):
    song, song_dir = _separated_song(tmp_path)
    (song_dir / "exports").mkdir()
    (song_dir / "exports" / "tightrope-82.mp3").write_bytes(b"ID3-bytes")

    resp = client.get(f"/api/songs/{song.id}/exports/tightrope-82.mp3")
    assert resp.status_code == 200
    assert resp.content == b"ID3-bytes"
    assert resp.headers["content-type"] == "audio/mpeg"
    assert "attachment" in resp.headers["content-disposition"]
    assert "tightrope-82.mp3" in resp.headers["content-disposition"]


def test_download_of_a_name_that_is_not_a_slug_is_404_and_never_leaves_exports(client, tmp_path):
    song, song_dir = _separated_song(tmp_path)
    (song_dir / "exports").mkdir()

    for name in ("..%2F..%2Fsong.json", "../song", "Tightrope", "with.dot", "with_underscore"):
        resp = client.get(f"/api/songs/{song.id}/exports/{name}.mp3")
        assert resp.status_code == 404, name


def test_download_of_a_missing_export_is_404(client, tmp_path):
    song, _ = _separated_song(tmp_path)
    resp = client.get(f"/api/songs/{song.id}/exports/never-rendered.mp3")
    assert resp.status_code == 404
