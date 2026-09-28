from pathlib import Path

from stemcraft_lib.config import SAMPLE_RATE, settings


def test_sample_rate_is_48k_not_441():
    assert SAMPLE_RATE == 48000


def test_defaults_put_songs_and_db_under_data_dir(monkeypatch):
    monkeypatch.delenv("STEMCRAFT_DATA_DIR", raising=False)
    s = settings()
    assert s.data_dir == Path("data").resolve()
    assert s.songs_dir == Path("songs").resolve()
    assert s.jobs_db == Path("data/jobs.sqlite").resolve()


def test_env_overrides_data_dir(monkeypatch, tmp_path):
    monkeypatch.setenv("STEMCRAFT_DATA_DIR", str(tmp_path / "d"))
    monkeypatch.setenv("STEMCRAFT_SONGS_DIR", str(tmp_path / "s"))
    s = settings()
    assert s.jobs_db == (tmp_path / "d" / "jobs.sqlite").resolve()
    assert s.songs_dir == (tmp_path / "s").resolve()


def test_binds_lan_by_default(monkeypatch):
    monkeypatch.delenv("STEMCRAFT_HOST", raising=False)
    assert settings().host == "0.0.0.0"


def test_albums_dir_defaults_beside_songs(monkeypatch):
    monkeypatch.delenv("STEMCRAFT_ALBUMS_DIR", raising=False)
    assert settings().albums_dir.name == "albums"


def test_albums_dir_is_overridable(monkeypatch, tmp_path):
    monkeypatch.setenv("STEMCRAFT_ALBUMS_DIR", str(tmp_path / "elsewhere"))
    assert settings().albums_dir == (tmp_path / "elsewhere").resolve()
