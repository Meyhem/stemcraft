"""theory.json: the Theory tab's instrument, last tool, chosen song and quiz
history (D-19). The API is its only writer (§2); the worker never reads it.
It lives in the data dir beside jobs.sqlite, not in songs/: it belongs to the
player, not to any song.

Nothing derived is stored. Quiz stats, weak spots and the heatmap are computed
in the browser from `quiz.history` on every render, like song state is derived
from which files exist.
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator, model_validator

from .atomic import atomic_write_json

SCHEMA_VERSION = 1
# The newest answers kept. Weighting only ever reads each item's last five, so
# 2,000 is ample history for the heatmap and keeps the file small.
HISTORY_CAP = 2000

Tool = Literal[
    "scale-finder",
    "chord-finder",
    "note-finder",
    "name-that-chord",
    "scale-positions",
    "triads",
    "arpeggios",
    "chords-in-key",
    "circle-of-fifths",
    "progressions",
    "scales-over-chord",
    "fretboard-quiz",
    "theory-quiz",
]

# Scientific pitch: a letter, up to two accidentals, an octave. "E1", "F#2", "Bb0".
_PITCH = re.compile(r"[A-G](#{1,2}|b{1,2})?-?\d")


class TheoryUnreadable(Exception):
    """theory.json exists but cannot be used. Surfaced verbatim (U-09); the file
    is never replaced with defaults behind the player's back (N-08)."""


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Instrument(_Strict):
    kind: Literal["bass", "guitar"] = "bass"
    strings: int = 4
    tuning: list[str] = Field(default_factory=lambda: ["E1", "A1", "D2", "G2"])
    left_handed: bool = False

    @field_validator("tuning")
    @classmethod
    def _pitches(cls, tuning: list[str]) -> list[str]:
        bad = [n for n in tuning if not _PITCH.fullmatch(n)]
        if bad:
            raise ValueError(f"not scientific pitch (like E1 or F#2): {bad}")
        return tuning

    @model_validator(mode="after")
    def _shape(self) -> Instrument:
        allowed = {"bass": (4, 5), "guitar": (6,)}[self.kind]
        if self.strings not in allowed:
            raise ValueError(
                f"a {self.kind} has {' or '.join(map(str, allowed))} strings, not {self.strings}"
            )
        if len(self.tuning) != self.strings:
            raise ValueError(f"tuning has {len(self.tuning)} notes for {self.strings} strings")
        return self


class FretboardQuizSettings(_Strict):
    mode: Literal["name-note", "find-note", "find-interval", "spell-chord"] = "find-note"
    strings: list[int] = Field(default_factory=list)  # rows, 0 = highest string; empty = all
    frets: tuple[int, int] = (0, 12)
    accidentals: bool = False

    @field_validator("frets")
    @classmethod
    def _range(cls, frets: tuple[int, int]) -> tuple[int, int]:
        lo, hi = frets
        if not 0 <= lo < hi <= 24:
            raise ValueError(f"fret range must satisfy 0 <= lo < hi <= 24, got {lo}-{hi}")
        return frets


class TheoryQuizSettings(_Strict):
    topics: list[Literal["keys", "chords", "intervals"]] = Field(
        default_factory=lambda: ["keys", "chords", "intervals"], min_length=1
    )


class QuizSettings(_Strict):
    fretboard: FretboardQuizSettings = Field(default_factory=FretboardQuizSettings)
    theory: TheoryQuizSettings = Field(default_factory=TheoryQuizSettings)


class QuizAnswer(_Strict):
    quiz: Literal["fretboard", "theory"]
    mode: str
    item: str
    correct: bool
    ms: int = Field(ge=0)
    at: str


class Quiz(_Strict):
    settings: QuizSettings = Field(default_factory=QuizSettings)
    history: list[QuizAnswer] = Field(default_factory=list)


class Theory(_Strict):
    version: Literal[1] = SCHEMA_VERSION
    instrument: Instrument = Field(default_factory=Instrument)
    last_tool: Tool = "scale-finder"
    song_id: str | None = None
    quiz: Quiz = Field(default_factory=Quiz)


def theory_path(data_dir: Path) -> Path:
    return data_dir / "theory.json"


def read_theory(data_dir: Path) -> Theory:
    """The stored document, or the defaults when there is none yet (a normal
    first run). Anything else wrong raises TheoryUnreadable with the reason."""
    path = theory_path(data_dir)
    try:
        raw = json.loads(path.read_text())
    except FileNotFoundError:
        return Theory()
    except json.JSONDecodeError as exc:
        raise TheoryUnreadable(f"{path}: invalid JSON at line {exc.lineno}: {exc.msg}") from exc
    except (OSError, UnicodeDecodeError) as exc:
        # A directory, a permissions error, bytes that are not UTF-8: still the
        # player's file, still shown verbatim rather than a bare 500 (N-08).
        raise TheoryUnreadable(f"{path}: {exc}") from exc
    try:
        return Theory.model_validate(raw)
    except ValidationError as exc:
        raise TheoryUnreadable(f"{path}: {exc.error_count()} invalid field(s): {exc}") from exc


def write_theory(data_dir: Path, theory: Theory) -> Theory:
    """Writes atomically (invariant 8), keeping only the newest HISTORY_CAP
    answers. Returns what was written."""
    history = theory.quiz.history[-HISTORY_CAP:]
    trimmed = theory.model_copy(
        update={"quiz": theory.quiz.model_copy(update={"history": history})}
    )
    data_dir.mkdir(parents=True, exist_ok=True)
    atomic_write_json(theory_path(data_dir), trimmed.model_dump(mode="json"))
    return trimmed
