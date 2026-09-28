"""analysis.json: key candidates, beat grid and chord chart. The worker is the
only writer (§2), same as stems/ -- the API only reads this to serve it to the
frontend, the same pattern derive_files/has_analysis already uses for presence.

The beat grid is integer sample indices at 48 kHz (D-03), never float seconds:
loops and the metronome need sample-accurate positions, and a float round trip
through JSON would not guarantee that two reads of the same value agree.
"""

from __future__ import annotations

from pathlib import Path
from typing import Literal

from pydantic import BaseModel, Field

from .atomic import atomic_write_json

SCHEMA_VERSION = 1


class KeyCandidate(BaseModel):
    # One of the 12 sharp-spelled pitch-class names -- "G", "A#", never "Ab".
    # The frontend re-spells for display (flats where a key's family calls for
    # them); the wire format stays a single canonical form.
    tonic: str
    mode: Literal["major", "minor"]
    confidence: float  # 0..1; a song's candidates sum to 1.0


class BeatGrid(BaseModel):
    bpm: float = 0.0
    beats: list[int] = Field(default_factory=list)  # sample indices @ 48 kHz, ascending
    downbeats: list[int] = Field(default_factory=list)  # subset of beats: bar starts


class ChordSegment(BaseModel):
    bar: int  # 0-indexed, counted from the first downbeat
    start_sample: int
    end_sample: int
    chord: str  # e.g. "G:min", "C:maj7", "N" (no chord), "X" (BTC: unclassifiable)


class Analysis(BaseModel):
    schema_version: int = SCHEMA_VERSION
    key_candidates: list[KeyCandidate] = Field(default_factory=list)
    beat_grid: BeatGrid = Field(default_factory=BeatGrid)
    chords: list[ChordSegment] = Field(default_factory=list)


def read_analysis(song_dir: Path) -> Analysis:
    return Analysis.model_validate_json((song_dir / "analysis.json").read_text())


def write_analysis(song_dir: Path, analysis: Analysis) -> None:
    atomic_write_json(song_dir / "analysis.json", analysis.model_dump(mode="json"))
