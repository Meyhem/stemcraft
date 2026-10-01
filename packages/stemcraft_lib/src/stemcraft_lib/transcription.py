"""transcription.json: the bass line the worker transcribed from stems/bass.wav (D-21).

The worker is the only writer (§2); the API only reads it to serve it. A pure
re-derivation of stems/bass.wav, which never changes, so re-running the job
reproduces it. Times are integer sample indices at 48 kHz (D-03), end exclusive;
`midi` is the pitch as recorded -- the pitch shift is applied in the browser.
The time it was written is not stored: the API derives it from the file's mtime.
"""

from __future__ import annotations

from pathlib import Path
from typing import Literal

from pydantic import BaseModel, Field, model_validator

from .atomic import atomic_write_json

SCHEMA_VERSION = 1


class TranscribedNote(BaseModel):
    start: int = Field(ge=0)
    end: int
    midi: int = Field(ge=0, le=127)
    cents: float  # the median pitch's deviation from `midi`, -50..50
    confidence: float = Field(ge=0.0, le=1.0)  # mean CREPE periodicity over the note

    @model_validator(mode="after")
    def _ends_after_start(self) -> TranscribedNote:
        if self.end <= self.start:
            raise ValueError(f"note ends at {self.end}, not after its start {self.start}")
        return self


class TranscriptionParams(BaseModel):
    fmin_hz: float
    fmax_hz: float
    hop_samples: int
    voiced_min: float
    gate_db: float
    jump_semitones: float
    min_note_samples: int
    # Added after the first files were written; absent there, which meant no floor.
    min_repeat_samples: int = 0


class Transcription(BaseModel):
    schema_version: int = SCHEMA_VERSION
    source: Literal["bass"] = "bass"
    model: str
    device: str
    params: TranscriptionParams
    notes: list[TranscribedNote] = Field(default_factory=list)

    @model_validator(mode="after")
    def _monophonic(self) -> Transcription:
        for prev, note in zip(self.notes, self.notes[1:], strict=False):
            if note.start < prev.end:
                raise ValueError(
                    f"note at {note.start} overlaps the one before it (ends {prev.end}); "
                    "a bass transcription is monophonic and ascending"
                )
        return self


def read_transcription(song_dir: Path) -> Transcription:
    return Transcription.model_validate_json((song_dir / "transcription.json").read_text())


def write_transcription(song_dir: Path, transcription: Transcription) -> None:
    atomic_write_json(song_dir / "transcription.json", transcription.model_dump(mode="json"))
