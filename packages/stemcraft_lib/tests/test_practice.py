import json

import pytest
from pydantic import ValidationError
from stemcraft_lib.practice import (
    Practice,
    PracticeUnreadable,
    Ramp,
    practice_path,
    read_practice,
    write_practice,
)


def test_missing_file_reads_as_defaults(tmp_path):
    doc = read_practice(tmp_path)
    assert doc.version == 2
    assert doc.instrument == "bass"
    assert doc.bass.exercise == "groove"
    assert doc.bass.key == 7
    assert doc.bass.bpm == 100
    assert doc.bass.groove.progression == "pop"
    assert doc.guitar.groove.strum == "folk"
    assert doc.presets == []
    assert not practice_path(tmp_path).exists()


def test_write_then_read_round_trips(tmp_path):
    doc = Practice()
    doc.bass.bpm = 132
    doc.bass.scale.scale = "blues"
    write_practice(tmp_path, doc)
    assert read_practice(tmp_path) == doc
    # Atomic: no temp file left beside it.
    assert [p.name for p in tmp_path.iterdir()] == ["practice.json"]


def test_invalid_json_is_unreadable_with_the_reason(tmp_path):
    practice_path(tmp_path).write_text("{nope")
    with pytest.raises(PracticeUnreadable, match="invalid JSON at line 1"):
        read_practice(tmp_path)


def test_invalid_field_is_unreadable_not_reset(tmp_path):
    practice_path(tmp_path).write_text(json.dumps({"version": 1, "bass": {"bpm": 999}}))
    with pytest.raises(PracticeUnreadable, match="invalid field"):
        read_practice(tmp_path)
    assert "999" in practice_path(tmp_path).read_text()


def test_ramp_target_must_stay_in_the_engine_tempo_range():
    with pytest.raises(ValidationError, match=r"outside 40-120"):
        Ramp(on=True, start=80, target=130)
    assert Ramp(on=True, start=80, target=120).target == 120
    assert Ramp(on=True, start=120, target=60).target == 60


def test_preset_names_are_unique_ignoring_case():
    preset = {"name": "Blues", "instrument": "bass", "settings": {}}
    with pytest.raises(ValidationError, match="preset names must be unique"):
        Practice.model_validate({"presets": [preset, {**preset, "name": "blues"}]})


def test_unknown_values_are_rejected_not_coerced():
    with pytest.raises(ValidationError):
        Practice.model_validate({"bass": {"exercise": "solo"}})
    with pytest.raises(ValidationError):
        Practice.model_validate({"bass": {"groove": {"bars_per_chord": 3}}})
    with pytest.raises(ValidationError):
        Practice.model_validate({"bass": {"key": 12}})
    with pytest.raises(ValidationError):
        Practice.model_validate({"bass": {"drill": {"from_fret": 10}}})


def test_v1_file_reads_as_v2_with_defaults(tmp_path):
    practice_path(tmp_path).write_text(json.dumps({"version": 1, "bass": {"bpm": 90}}))
    doc = read_practice(tmp_path)
    assert doc.version == 2
    assert doc.bass.bpm == 90
    assert doc.bass.levels.drums == 0.6
    assert doc.bass.backing.drum_groove == "rock"
    assert doc.guitar.backing.chord_sound == "pad"


def test_unknown_groove_is_rejected():
    with pytest.raises(ValidationError):
        Practice.model_validate({"bass": {"backing": {"drum_groove": "polka"}}})
