"""song.json: metadata and the practice recipe. The API is its only writer.

Everything else about a Song — whether it is imported, separated or analyzed —
is derived from which files exist on disk, never stored.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, Field, ValidationError

from .atomic import atomic_write_json
from .ids import new_song_id

SCHEMA_VERSION = 1

# Fixed at HTDemucs v4 training time, not configured and not detected.
STEM_NAMES: tuple[str, ...] = ("vocals", "drums", "bass", "other")

SongState = Literal["imported", "separated", "analyzed"]


class SongUnreadable(Exception):
    """One bad song.json never breaks the library (§9); it is listed with this
    reason and the other songs are unaffected."""


class StemMix(BaseModel):
    gain_db: float = 0.0
    muted: bool = False


class Playback(BaseModel):
    tempo: float = 1.0
    pitch_semitones: int = 0


class Loop(BaseModel):
    name: str
    start_bar: int
    end_bar: int


class Source(BaseModel):
    kind: Literal["upload", "url"]
    value: str


class Song(BaseModel):
    schema_version: int = SCHEMA_VERSION
    id: str
    title: str
    artist: str = ""
    source: Source
    created_at: str
    last_played_at: str | None = None
    mix: dict[str, StemMix] = Field(default_factory=dict)
    playback: Playback = Field(default_factory=Playback)
    loops: list[Loop] = Field(default_factory=list)


def new_song(*, title: str, artist: str, source_kind: str, source_value: str) -> Song:
    return Song(
        id=new_song_id(),
        title=title,
        artist=artist,
        source=Source(kind=source_kind, value=source_value),
        created_at=datetime.now(UTC).isoformat(),
        mix={name: StemMix() for name in STEM_NAMES},
    )


def _migrate(raw: dict, path: Path) -> dict:
    version = raw.get("schema_version")
    if version == SCHEMA_VERSION:
        return raw
    if not isinstance(version, int):
        raise SongUnreadable(f"{path}: missing or non-integer schema_version")
    if version > SCHEMA_VERSION:
        raise SongUnreadable(
            f"{path}: schema_version {version} is newer than this build understands "
            f"({SCHEMA_VERSION}); refusing to guess"
        )
    # No older versions exist yet. When v2 lands, upgrade steps chain here and
    # write_song persists the result forward in place.
    raise SongUnreadable(f"{path}: no migration from schema_version {version}")


def read_song(song_dir: Path) -> Song:
    path = song_dir / "song.json"
    try:
        raw = json.loads(path.read_text())
    except FileNotFoundError as exc:
        raise SongUnreadable(f"{path}: missing") from exc
    except json.JSONDecodeError as exc:
        raise SongUnreadable(f"{path}: invalid JSON at line {exc.lineno}: {exc.msg}") from exc
    if not isinstance(raw, dict):
        raise SongUnreadable(f"{path}: expected an object")
    try:
        return Song.model_validate(_migrate(raw, path))
    except ValidationError as exc:
        raise SongUnreadable(f"{path}: {exc.error_count()} invalid field(s): {exc}") from exc


def write_song(song_dir: Path, song: Song) -> None:
    atomic_write_json(song_dir / "song.json", song.model_dump(mode="json"))


@dataclass(frozen=True)
class SongFiles:
    has_audio: bool
    has_peaks: bool
    has_stems: bool
    has_analysis: bool

    @property
    def state(self) -> SongState:
        if self.has_analysis:
            return "analyzed"
        if self.has_stems:
            return "separated"
        return "imported"


def derive_files(song_dir: Path) -> SongFiles:
    stems = song_dir / "stems"
    return SongFiles(
        has_audio=(song_dir / "audio.wav").is_file(),
        has_peaks=(song_dir / "peaks.json").is_file(),
        # All four, or none: a partial set is a crashed job, not a separated song.
        has_stems=all((stems / f"{name}.wav").is_file() for name in STEM_NAMES),
        has_analysis=(song_dir / "analysis.json").is_file(),
    )
