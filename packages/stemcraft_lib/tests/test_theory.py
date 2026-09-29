import json

import pytest
from stemcraft_lib.theory import (
    HISTORY_CAP,
    QuizAnswer,
    Theory,
    TheoryUnreadable,
    read_theory,
    theory_path,
    write_theory,
)


def _answer(i: int) -> QuizAnswer:
    return QuizAnswer(
        quiz="fretboard",
        mode="name-note",
        item=f"s0f{i % 12}",
        correct=True,
        ms=1000,
        at="2026-09-29T00:00:00Z",
    )


def test_missing_file_reads_as_defaults(tmp_path):
    theory = read_theory(tmp_path)
    assert theory == Theory()
    assert theory.instrument.tuning == ["E1", "A1", "D2", "G2"]
    assert theory.last_tool == "scale-finder"
    assert theory.quiz.settings.fretboard.frets == (0, 12)
    assert not theory_path(tmp_path).exists()  # reading never writes


def test_write_then_read_round_trips(tmp_path):
    theory = Theory.model_validate(
        {
            "instrument": {
                "kind": "guitar",
                "strings": 6,
                "tuning": ["D2", "A2", "D3", "G3", "B3", "E4"],
            },
            "last_tool": "chords-in-key",
            "song_id": "01SONG",
        }
    )
    write_theory(tmp_path / "data", theory)
    assert read_theory(tmp_path / "data") == theory


def test_history_is_capped_to_the_newest(tmp_path):
    theory = Theory()
    theory.quiz.history = [_answer(i) for i in range(HISTORY_CAP + 5)]
    written = write_theory(tmp_path, theory)
    assert len(written.quiz.history) == HISTORY_CAP
    assert written.quiz.history[0] == _answer(5)
    assert len(read_theory(tmp_path).quiz.history) == HISTORY_CAP


def test_invalid_json_is_loud(tmp_path):
    theory_path(tmp_path).write_text("{nope")
    with pytest.raises(TheoryUnreadable, match="invalid JSON at line 1"):
        read_theory(tmp_path)


def test_invalid_field_is_loud_and_names_it(tmp_path):
    raw = Theory().model_dump(mode="json")
    raw["quiz"]["history"] = [
        {
            "quiz": "fretboard",
            "mode": "name-note",
            "item": "s0f1",
            "correct": True,
            "ms": "fast",
            "at": "x",
        }
    ]
    theory_path(tmp_path).write_text(json.dumps(raw))
    with pytest.raises(TheoryUnreadable, match=r"quiz\.history\.0\.ms"):
        read_theory(tmp_path)


@pytest.mark.parametrize(
    "instrument, message",
    [
        ({"kind": "bass", "strings": 6, "tuning": ["E1"] * 6}, "a bass has 4 or 5 strings"),
        (
            {"kind": "guitar", "strings": 6, "tuning": ["E2", "A2", "D3", "G3", "B3"]},
            "tuning has 5 notes",
        ),
        ({"kind": "bass", "strings": 4, "tuning": ["E", "A", "D", "G"]}, "not scientific pitch"),
    ],
)
def test_instrument_is_validated(instrument, message):
    with pytest.raises(ValueError, match=message):
        Theory.model_validate({"instrument": instrument})


def test_unknown_fields_and_tools_are_refused():
    with pytest.raises(ValueError):
        Theory.model_validate({"surprise": 1})
    with pytest.raises(ValueError):
        Theory.model_validate({"last_tool": "tab-reader"})
    with pytest.raises(ValueError, match="fret range"):
        Theory.model_validate({"quiz": {"settings": {"fretboard": {"frets": [12, 3]}}}})
