import json

import pytest
from stemcraft_lib.atomic import atomic_output, atomic_write_bytes, atomic_write_json


def test_writes_content_and_creates_parents(tmp_path):
    target = tmp_path / "nested" / "f.bin"
    atomic_write_bytes(target, b"hello")
    assert target.read_bytes() == b"hello"


def test_leaves_no_temp_files_behind(tmp_path):
    atomic_write_bytes(tmp_path / "f.bin", b"x")
    assert [p.name for p in tmp_path.iterdir()] == ["f.bin"]


def test_failed_write_leaves_previous_file_intact(tmp_path, monkeypatch):
    target = tmp_path / "f.json"
    atomic_write_json(target, {"v": 1})

    def boom(*_args, **_kwargs):
        raise OSError("No space left on device")

    monkeypatch.setattr("os.replace", boom)
    with pytest.raises(OSError):
        atomic_write_json(target, {"v": 2})

    # §9 disk full: a failed write leaves the previous good file intact.
    assert json.loads(target.read_text()) == {"v": 1}
    assert [p.name for p in tmp_path.iterdir()] == ["f.json"]


def test_json_is_readable_and_stable(tmp_path):
    target = tmp_path / "f.json"
    atomic_write_json(target, {"b": 2, "a": 1})
    assert target.read_text().endswith("\n")
    assert json.loads(target.read_text()) == {"a": 1, "b": 2}


def test_atomic_output_yields_a_temp_path_in_the_same_directory(tmp_path):
    target = tmp_path / "nested" / "out.wav"
    with atomic_output(target) as tmp:
        assert tmp.parent == target.parent
        assert tmp != target
        tmp.write_bytes(b"fake wav bytes")
    assert target.read_bytes() == b"fake wav bytes"


def test_atomic_output_leaves_no_temp_files_behind(tmp_path):
    target = tmp_path / "out.wav"
    with atomic_output(target) as tmp:
        tmp.write_bytes(b"x")
    assert [p.name for p in tmp_path.iterdir()] == ["out.wav"]


def test_atomic_output_failure_leaves_no_temp_file_and_no_partial_output(tmp_path):
    target = tmp_path / "out.wav"
    with pytest.raises(RuntimeError):
        with atomic_output(target) as tmp:
            tmp.write_bytes(b"partial")
            raise RuntimeError("ffmpeg exploded")
    assert not target.exists()
    assert list(tmp_path.iterdir()) == []


def test_atomic_output_failure_leaves_previous_output_intact(tmp_path):
    target = tmp_path / "out.wav"
    target.write_bytes(b"good")
    with pytest.raises(RuntimeError):
        with atomic_output(target) as tmp:
            tmp.write_bytes(b"partial")
            raise RuntimeError("ffmpeg exploded")
    assert target.read_bytes() == b"good"
