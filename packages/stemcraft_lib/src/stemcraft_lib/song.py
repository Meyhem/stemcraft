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
from .ids import new_song_id, song_dirname

SCHEMA_VERSION = 2

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
    # v2 (Phase 6). The A-B loop the user is currently practising, distinct from
    # `loops` (the named ones they saved). Stored as bar numbers like every other
    # loop, because bars are user-meaningful and survive a re-analysis that moves
    # the sample indices under them (tech spec §5).
    active_loop: Loop | None = None
    metronome: bool = False
    count_in_bars: int = 0


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
    if version == 1:
        # v1 -> v2 (Phase 6) is purely additive: active_loop, metronome and
        # count_in_bars take their pydantic defaults. Nothing is renamed or
        # dropped, so the only work is stamping the version forward; the file
        # itself is rewritten on the next write_song (§5: migrated in place).
        raw = {**raw, "schema_version": 2}
        version = 2
    if version == SCHEMA_VERSION:
        return raw
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


def create_song_dir(songs_dir: Path, song: Song) -> Path:
    """Allocate a Song's folder and write its song.json. The only place a new
    Song's directory is created, so the API's upload/url-import routes and
    any future creation path share one naming rule with find_song_dir below.
    """
    song_dir = songs_dir / song_dirname(song.id, song.title)
    song_dir.mkdir(parents=True)
    write_song(song_dir, song)
    return song_dir


def find_song_dir(songs_dir: Path, song_id: str) -> Path | None:
    """D-01: the id, not the slug, is authoritative -- the slug in a folder
    name is decoration and is never parsed back except for this prefix
    match. Returns None rather than raising so each caller (API 404 vs.
    worker job failure) picks its own error.
    """
    if not songs_dir.is_dir():
        return None
    for candidate in songs_dir.iterdir():
        if candidate.name.split("-", 1)[0] == song_id and (candidate / "song.json").is_file():
            return candidate
    return None


def derive_files(song_dir: Path) -> SongFiles:
    stems = song_dir / "stems"
    return SongFiles(
        has_audio=(song_dir / "audio.wav").is_file(),
        has_peaks=(song_dir / "peaks.json").is_file(),
        # All four .wav *and* .opus, or none (D-04): a partial set is a crashed or
        # still-running job, not a separated song. .opus is the only thing ever served
        # for playback, so a Song with WAVs but no Opus copies isn't playable yet.
        has_stems=all(
            (stems / f"{name}.{ext}").is_file() for name in STEM_NAMES for ext in ("wav", "opus")
        ),
        has_analysis=(song_dir / "analysis.json").is_file(),
    )
