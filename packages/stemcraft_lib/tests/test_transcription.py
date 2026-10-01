import pytest
from pydantic import ValidationError
from stemcraft_lib.transcription import (
    TranscribedNote,
    Transcription,
    TranscriptionParams,
    read_transcription,
    write_transcription,
)

PARAMS = TranscriptionParams(
    fmin_hz=32.0, fmax_hz=400.0, hop_samples=480, voiced_min=0.5, gate_db=-45.0,
    jump_semitones=0.6, min_note_samples=2880,
)


def _t(notes):
    return Transcription(model="crepe-full", device="cpu", params=PARAMS, notes=notes)


def test_round_trips_atomically(tmp_path):
    t = _t([TranscribedNote(start=0, end=4800, midi=31, cents=-6.5, confidence=0.84)])
    write_transcription(tmp_path, t)
    assert read_transcription(tmp_path) == t
    assert not list(tmp_path.glob("*.tmp"))


def test_a_note_must_end_after_it_starts():
    with pytest.raises(ValidationError):
        TranscribedNote(start=100, end=100, midi=31, cents=0, confidence=1)


def test_notes_must_be_ascending_and_not_overlap():
    a = TranscribedNote(start=0, end=4800, midi=31, cents=0, confidence=1)
    b = TranscribedNote(start=4000, end=9600, midi=33, cents=0, confidence=1)
    with pytest.raises(ValidationError, match="overlaps"):
        _t([a, b])


def test_confidence_is_a_probability():
    with pytest.raises(ValidationError):
        TranscribedNote(start=0, end=10, midi=31, cents=0, confidence=1.5)
