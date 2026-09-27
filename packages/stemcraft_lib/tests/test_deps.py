import pytest
from stemcraft_lib.deps import DependencyError, assert_ready, check_all


def test_reports_one_check_per_dependency(monkeypatch, tmp_path):
    monkeypatch.setenv("STEMCRAFT_DATA_DIR", str(tmp_path / "data"))
    monkeypatch.setenv("STEMCRAFT_SONGS_DIR", str(tmp_path / "songs"))
    names = {c.name for c in check_all()}
    assert names == {"ffmpeg", "yt-dlp", "data_dirs", "sqlite_wal"}


def test_missing_ffmpeg_fails_loudly_with_the_real_reason(monkeypatch, tmp_path):
    monkeypatch.setenv("STEMCRAFT_DATA_DIR", str(tmp_path / "data"))
    monkeypatch.setenv("STEMCRAFT_SONGS_DIR", str(tmp_path / "songs"))
    monkeypatch.setenv("PATH", str(tmp_path / "empty"))
    checks = {c.name: c for c in check_all()}
    assert checks["ffmpeg"].ok is False
    assert "not on PATH" in checks["ffmpeg"].detail

    # N-08: refuse to start, and name every failure, not just the first.
    with pytest.raises(DependencyError) as err:
        assert_ready()
    assert "ffmpeg" in str(err.value)
    assert "yt-dlp" in str(err.value)


def test_unwritable_data_dir_is_a_failure(monkeypatch, tmp_path):
    blocked = tmp_path / "ro"
    blocked.mkdir(mode=0o500)
    monkeypatch.setenv("STEMCRAFT_DATA_DIR", str(blocked / "data"))
    monkeypatch.setenv("STEMCRAFT_SONGS_DIR", str(tmp_path / "songs"))
    checks = {c.name: c for c in check_all()}
    assert checks["data_dirs"].ok is False


@pytest.mark.skipif(
    __import__("shutil").which("ffmpeg") is None, reason="ffmpeg not installed on this host"
)
def test_real_ffmpeg_can_decode_and_encode_mp3(monkeypatch, tmp_path):
    monkeypatch.setenv("STEMCRAFT_DATA_DIR", str(tmp_path / "data"))
    monkeypatch.setenv("STEMCRAFT_SONGS_DIR", str(tmp_path / "songs"))
    checks = {c.name: c for c in check_all()}
    assert checks["ffmpeg"].ok is True, checks["ffmpeg"].detail
    assert checks["sqlite_wal"].ok is True, checks["sqlite_wal"].detail
