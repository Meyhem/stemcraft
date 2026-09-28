import pytest
from pydantic import ValidationError
from stemcraft_lib.analysis import Analysis, BeatGrid, ChordSegment, KeyCandidate, read_analysis, write_analysis


def _sample_analysis() -> Analysis:
    return Analysis(
        key_candidates=[
            KeyCandidate(tonic="G", mode="minor", confidence=0.72),
            KeyCandidate(tonic="A#", mode="major", confidence=0.18),
            KeyCandidate(tonic="D", mode="minor", confidence=0.10),
        ],
        beat_grid=BeatGrid(bpm=120.0, beats=[1920, 25920, 49920], downbeats=[1920]),
        chords=[ChordSegment(bar=0, start_sample=1920, end_sample=25920, chord="G:min")],
    )


def test_write_then_read_round_trips(tmp_path):
    write_analysis(tmp_path, _sample_analysis())
    loaded = read_analysis(tmp_path)
    assert loaded == _sample_analysis()


def test_write_is_atomic_and_json_on_disk(tmp_path):
    write_analysis(tmp_path, _sample_analysis())
    path = tmp_path / "analysis.json"
    assert path.is_file()
    assert not list(tmp_path.glob("*.tmp"))  # no leftover temp file


def test_mode_rejects_anything_other_than_major_or_minor():
    with pytest.raises(ValidationError):
        KeyCandidate(tonic="G", mode="dorian", confidence=1.0)


def test_beat_grid_defaults_to_empty_lists():
    grid = BeatGrid(bpm=120.0)
    assert grid.beats == []
    assert grid.downbeats == []
