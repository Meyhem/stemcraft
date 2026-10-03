"""practice.json: the Practice tab's settings per instrument and its named
presets (D-22). The API is its only writer (§2); the worker never reads it.
It lives in the data dir beside theory.json: it belongs to the player, not to
any song.

Nothing derived is stored. Notes, audio and grids are regenerated in the
browser from these settings and the seed, like Play along's patterns (D-18).
"""

from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator, model_validator

from .atomic import atomic_write_json

SCHEMA_VERSION = 2
PRESET_CAP = 100

# music/progressions.ts PROGRESSIONS ids, in its order.
ProgressionId = Literal[
    "pop",
    "fifties",
    "two-five-one",
    "one-four-five",
    "twelve-bar",
    "minor-blues",
    "sensitive",
    "andalusian",
    "minor-one-four-five",
    "mixolydian",
    "minor-two-five-one",
    "canon",
    "one-four-six-five",
    "epic-minor",
    "one-three-four-five",
    "jazz-blues",
    "rhythm-changes",
    "minor-standard",
    "circle-fifths",
]
# music/spell.ts SCALES ids, in its order.
ScaleId = Literal[
    "major",
    "minor",
    "major-pentatonic",
    "minor-pentatonic",
    "blues",
    "dorian",
    "phrygian",
    "lydian",
    "mixolydian",
    "locrian",
    "harmonic-minor",
    "melodic-minor",
    "whole-tone",
    "diminished",
]
LineRhythm = Literal["quarter", "eighth", "triplet", "sixteenth"]
BarsPerChord = Literal[1, 2, 4]


class PracticeUnreadable(Exception):
    """practice.json exists but cannot be used. Surfaced verbatim (U-09); the
    file is never replaced with defaults behind the player's back (N-08)."""


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Ramp(_Strict):
    on: bool = False
    start: int = Field(80, ge=40, le=220)
    target: int = Field(120, ge=40, le=220)
    step: int = Field(5, ge=1, le=20)
    every_loops: int = Field(2, ge=1, le=8)

    @model_validator(mode="after")
    def _engine_range(self) -> Ramp:
        # The ramp is the engine's tempo ratio over the rendered start BPM, and
        # the engine's ratio range is 0.5-1.5 (N-04, engine/types.ts TEMPO_*).
        lo, hi = math.ceil(self.start * 0.5), math.floor(self.start * 1.5)
        if not lo <= self.target <= hi:
            raise ValueError(
                f"target {self.target} bpm is outside {lo}-{hi}: the engine's tempo range "
                f"is 0.5-1.5x of the start ({self.start} bpm)"
            )
        return self


class Levels(_Strict):
    click: float = Field(0.7, ge=0, le=1)
    click_muted: bool = False
    ref: float = Field(0.8, ge=0, le=1)
    ref_muted: bool = False
    backing: float = Field(0.6, ge=0, le=1)
    backing_muted: bool = False
    # Phase B (v2): the band. Chords play in bass mode only (in guitar mode the
    # reference guitar is the chords); drums in both.
    chords: float = Field(0.5, ge=0, le=1)
    chords_muted: bool = False
    drums: float = Field(0.6, ge=0, le=1)
    drums_muted: bool = False


class Groove(_Strict):
    progression: ProgressionId = "pop"
    bars_per_chord: BarsPerChord = 1
    # Bass (D-18's PatternNotes / PatternRhythm / PatternApproach).
    notes: Literal[
        "root",
        "root_fifth",
        "root_fifth_octave",
        "octave_pump",
        "triad_chord",
        "triad_diatonic",
        "seventh",
    ] = "root_fifth_octave"
    rhythm: Literal["whole", "half", "quarter", "eighth"] = "quarter"
    approach: Literal["none", "chromatic", "scale", "fifth"] = "chromatic"
    # Guitar (D-20's style / strum / position).
    style: Literal["open", "barre", "power", "triad"] = "open"
    strum: Literal["whole", "half", "quarters", "eighths", "folk", "push"] = "folk"
    position: Literal["auto", "low", "mid"] = "auto"


class Scale(_Strict):
    scale: ScaleId = "minor-pentatonic"
    shape: Literal["position", "two_octaves"] = "position"
    from_fret: int = Field(5, ge=0, le=12)
    path: Literal["up", "down", "up_down", "thirds", "groups3", "groups4"] = "up_down"
    rhythm: LineRhythm = "eighth"


class Arpeggio(_Strict):
    over: Literal["chord", "progression"] = "progression"
    # The one chord's root is the key; this is its quality.
    quality: Literal["maj", "min", "7", "maj7", "min7", "dim", "hdim7"] = "maj7"
    progression: ProgressionId = "two-five-one"
    bars_per_chord: BarsPerChord = 1
    tones: Literal["triad", "seventh"] = "seventh"
    path: Literal["up", "down", "up_down", "inversions"] = "up"
    rhythm: LineRhythm = "quarter"


class Drill(_Strict):
    drill: Literal["chromatic", "permutations", "spider", "crossing", "octaves"] = "chromatic"
    # Index finger's fret; the pinky lands three higher, so 9 keeps it on the neck.
    from_fret: int = Field(5, ge=1, le=9)
    direction: Literal["up", "up_back"] = "up_back"
    rhythm: LineRhythm = "eighth"


class Backing(_Strict):
    chord_sound: Literal["pad", "keys"] = "pad"
    drum_groove: Literal["rock", "shuffle", "half_time", "funk", "four_floor"] = "rock"


class InstrumentSettings(_Strict):
    exercise: Literal["groove", "scale", "arpeggio", "drill"] = "groove"
    key: int = Field(7, ge=0, le=11)  # pitch class of the tonic; 7 = G
    bpm: int = Field(100, ge=40, le=220)
    count_in_bars: Literal[0, 1, 2] = 1
    seed: int = Field(1, ge=0, le=2**31 - 1)
    ramp: Ramp = Field(default_factory=Ramp)
    levels: Levels = Field(default_factory=Levels)
    groove: Groove = Field(default_factory=Groove)
    scale: Scale = Field(default_factory=Scale)
    arpeggio: Arpeggio = Field(default_factory=Arpeggio)
    drill: Drill = Field(default_factory=Drill)
    backing: Backing = Field(default_factory=Backing)


class Preset(_Strict):
    name: str = Field(min_length=1, max_length=60)
    instrument: Literal["bass", "guitar"]
    settings: InstrumentSettings = Field(default_factory=InstrumentSettings)

    @field_validator("name")
    @classmethod
    def _trimmed(cls, name: str) -> str:
        name = name.strip()
        if not name:
            raise ValueError("a preset needs a name")
        return name


class Practice(_Strict):
    version: Literal[2] = SCHEMA_VERSION

    @model_validator(mode="before")
    @classmethod
    def _upgrade(cls, raw: object) -> object:
        # v1 -> v2 is additive: the new fields take their defaults.
        if isinstance(raw, dict) and raw.get("version") == 1:
            return {**raw, "version": 2}
        return raw
    instrument: Literal["bass", "guitar"] = "bass"
    bass: InstrumentSettings = Field(default_factory=InstrumentSettings)
    guitar: InstrumentSettings = Field(default_factory=InstrumentSettings)
    presets: list[Preset] = Field(default_factory=list, max_length=PRESET_CAP)

    @model_validator(mode="after")
    def _unique_names(self) -> Practice:
        seen: set[str] = set()
        for preset in self.presets:
            key = preset.name.casefold()
            if key in seen:
                raise ValueError(f"preset names must be unique: {preset.name!r} appears twice")
            seen.add(key)
        return self


def practice_path(data_dir: Path) -> Path:
    return data_dir / "practice.json"


def read_practice(data_dir: Path) -> Practice:
    """The stored document, or the defaults when there is none yet (a normal
    first run). Anything else wrong raises PracticeUnreadable with the reason."""
    path = practice_path(data_dir)
    try:
        raw = json.loads(path.read_text())
    except FileNotFoundError:
        return Practice()
    except json.JSONDecodeError as exc:
        raise PracticeUnreadable(f"{path}: invalid JSON at line {exc.lineno}: {exc.msg}") from exc
    except (OSError, UnicodeDecodeError) as exc:
        raise PracticeUnreadable(f"{path}: {exc}") from exc
    try:
        return Practice.model_validate(raw)
    except ValidationError as exc:
        raise PracticeUnreadable(f"{path}: {exc.error_count()} invalid field(s): {exc}") from exc


def write_practice(data_dir: Path, practice: Practice) -> Practice:
    """Writes atomically (invariant 8). Returns what was written."""
    data_dir.mkdir(parents=True, exist_ok=True)
    atomic_write_json(practice_path(data_dir), practice.model_dump(mode="json"))
    return practice
