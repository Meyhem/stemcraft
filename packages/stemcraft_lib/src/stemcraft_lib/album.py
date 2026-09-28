"""album.json: an album being split, and the recipe a split renders from.

The API is album.json's only writer. Everything else about an album -- whether
it has been decoded, whether proposals exist, whether it has been split -- is
derived from which files exist on disk, never stored. Same rule as song.py, and
for the same reason.

Q-04 is closed here by omission: nothing in this module imports anything from
song.py, and nothing in it can create a Song. An album is a standalone tool's
document that happens to live beside the library.
"""

from __future__ import annotations

import json
import re
import zipfile
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, Field, ValidationError, model_validator

from .atomic import atomic_output, atomic_write_json
from .config import SAMPLE_RATE
from .ids import album_dirname, new_album_id, slugify

ALBUM_SCHEMA_VERSION = 1

ALBUMS_DIRNAME = "albums"
TRACKS_DIRNAME = "tracks"
ZIP_FILENAME = "album.zip"

AlbumState = Literal["uploaded", "ready", "split"]

# The only shape the track-download route will accept. Produced by
# TrackSpan.filename below and by nothing else, so a name outside this alphabet
# is a name this app never wrote -- matched rather than sanitized, exactly as
# export.NAME_PATTERN is (see the API task's traversal test).
TRACK_FILENAME_PATTERN = re.compile(r"^[0-9]{2,}-[a-z0-9][a-z0-9-]*\.mp3\Z")


class AlbumUnreadable(Exception):
    """One bad album.json never breaks the splitter; it is reported with this
    reason. Mirrors SongUnreadable."""


class Track(BaseModel):
    """A track is only its title. Its number, boundaries, duration and filename
    are all derived (track_spans), because storing them would let them disagree
    with the split points that actually define them."""

    title: str = ""


class Album(BaseModel):
    schema_version: int = ALBUM_SCHEMA_VERSION
    id: str
    title: str
    artist: str = ""
    # Only ever "upload": there is no url import for albums. Kept as a field so
    # the shape matches song.json and a future yt-dlp album import is additive.
    source_value: str
    created_at: str
    # 0 until the import job has decoded the file and measured it. Written by
    # the API from the worker's job result, never by the worker itself (§2).
    total_samples: int = 0
    # D-03/invariant 4: sample indices at 48 kHz, never float seconds.
    split_points: list[int] = Field(default_factory=list)
    tracks: list[Track] = Field(default_factory=lambda: [Track()])

    @model_validator(mode="after")
    def _consistent(self) -> Album:
        points = self.split_points
        if any(p <= 0 for p in points):
            raise ValueError(
                f"split points must be greater than 0 (a boundary at sample 0 "
                f"would make a zero-length first track); got {points}"
            )
        if any(b <= a for a, b in zip(points, points[1:], strict=False)):
            raise ValueError(
                f"split points must be strictly increasing; got {points}. "
                "Two boundaries at the same sample would make a zero-length track."
            )
        if self.total_samples and points and points[-1] >= self.total_samples:
            raise ValueError(
                f"split point {points[-1]} is at or past the end of the album "
                f"({self.total_samples} samples)"
            )
        if len(self.tracks) != len(points) + 1:
            raise ValueError(
                f"{len(self.tracks)} track(s) for {len(points)} split point(s); "
                f"D8-02 requires the track count to be exactly 1 more than the "
                f"split point count"
            )
        return self


def new_album(*, title: str, artist: str, source_value: str) -> Album:
    return Album(
        id=new_album_id(),
        title=title,
        artist=artist,
        source_value=source_value,
        created_at=datetime.now(UTC).isoformat(),
    )


def _migrate(raw: dict, path: Path) -> dict:
    version = raw.get("schema_version")
    if version == ALBUM_SCHEMA_VERSION:
        return raw
    if not isinstance(version, int):
        raise AlbumUnreadable(f"{path}: missing or non-integer schema_version")
    if version > ALBUM_SCHEMA_VERSION:
        raise AlbumUnreadable(
            f"{path}: schema_version {version} is newer than this build understands "
            f"({ALBUM_SCHEMA_VERSION}); refusing to guess"
        )
    # Only version 1 exists. A v2 migration chain goes here, mirroring song.py.
    raise AlbumUnreadable(f"{path}: no migration from schema_version {version}")


def read_album(album_dir: Path) -> Album:
    path = album_dir / "album.json"
    try:
        raw = json.loads(path.read_text())
    except FileNotFoundError as exc:
        raise AlbumUnreadable(f"{path}: missing") from exc
    except json.JSONDecodeError as exc:
        raise AlbumUnreadable(f"{path}: invalid JSON at line {exc.lineno}: {exc.msg}") from exc
    if not isinstance(raw, dict):
        raise AlbumUnreadable(f"{path}: expected an object")
    try:
        return Album.model_validate(_migrate(raw, path))
    except ValidationError as exc:
        raise AlbumUnreadable(f"{path}: {exc.error_count()} invalid field(s): {exc}") from exc


def write_album(album_dir: Path, album: Album) -> None:
    atomic_write_json(album_dir / "album.json", album.model_dump(mode="json"))


def create_album_dir(albums_dir: Path, album: Album) -> Path:
    album_dir = albums_dir / album_dirname(album.id, album.title)
    album_dir.mkdir(parents=True)
    write_album(album_dir, album)
    return album_dir


def find_album_dir(albums_dir: Path, album_id: str) -> Path | None:
    """The id, not the slug, is authoritative -- the slug is decoration and is
    never parsed back except for this prefix match. Mirrors find_song_dir, and
    returns None rather than raising so each caller picks its own error."""
    if not albums_dir.is_dir():
        return None
    for candidate in albums_dir.iterdir():
        if candidate.name.split("-", 1)[0] == album_id and (candidate / "album.json").is_file():
            return candidate
    return None


@dataclass(frozen=True)
class AlbumFiles:
    has_audio: bool
    has_peaks: bool
    has_proposals: bool
    has_tracks: bool
    has_zip: bool

    @property
    def state(self) -> AlbumState:
        if self.has_zip:
            return "split"
        if self.has_audio and self.has_peaks:
            return "ready"
        return "uploaded"


def derive_album_files(album_dir: Path) -> AlbumFiles:
    tracks = album_dir / TRACKS_DIRNAME
    return AlbumFiles(
        has_audio=(album_dir / "audio.wav").is_file(),
        has_peaks=(album_dir / "peaks.json").is_file(),
        has_proposals=(album_dir / "proposals.json").is_file(),
        has_tracks=tracks.is_dir() and any(tracks.glob("*.mp3")),
        has_zip=(album_dir / ZIP_FILENAME).is_file(),
    )


@dataclass(frozen=True)
class TrackSpan:
    number: int
    title: str
    start_sample: int
    end_sample: int  # exclusive
    filename: str

    @property
    def start_seconds(self) -> float:
        return self.start_sample / SAMPLE_RATE

    @property
    def duration_seconds(self) -> float:
        return (self.end_sample - self.start_sample) / SAMPLE_RATE


def _track_filename(number: int, title: str) -> str:
    slug = slugify(title) if title.strip() else f"track-{number}"
    return f"{number:02d}-{slug}.mp3"


def track_spans(album: Album) -> list[TrackSpan]:
    """D8-02: split points are boundaries, so the spans are contiguous and
    together cover every sample exactly once. Empty until total_samples is
    known, because a span needs an end."""
    if album.total_samples <= 0:
        return []
    edges = [0, *album.split_points, album.total_samples]
    spans = []
    for index, track in enumerate(album.tracks):
        number = index + 1
        spans.append(
            TrackSpan(
                number=number,
                title=track.title,
                start_sample=edges[index],
                end_sample=edges[index + 1],
                filename=_track_filename(number, track.title),
            )
        )
    return spans


class SplitTrack(BaseModel):
    number: int
    title: str
    start_sample: int
    end_sample: int
    filename: str


class SplitRecipe(BaseModel):
    """A split, fully determined. Every value is a number or a string; nothing
    here points at album.json (D8-05), because album.json is autosaved as the
    user drags markers and §6 requires a job's inputs never to change under it."""

    album_id: str
    album_title: str
    artist: str = ""
    tracks: list[SplitTrack] = Field(min_length=1)


def recipe_from_album(album: Album) -> SplitRecipe:
    return SplitRecipe(
        album_id=album.id,
        album_title=album.title,
        artist=album.artist,
        tracks=[
            SplitTrack(
                number=span.number,
                title=span.title,
                start_sample=span.start_sample,
                end_sample=span.end_sample,
                filename=span.filename,
            )
            for span in track_spans(album)
        ],
    )


def tracks_dir(album_dir: Path) -> Path:
    return album_dir / TRACKS_DIRNAME


def track_path(album_dir: Path, filename: str) -> Path:
    return tracks_dir(album_dir) / filename


def zip_path(album_dir: Path) -> Path:
    return album_dir / ZIP_FILENAME


def list_tracks(album_dir: Path) -> list[dict]:
    """Derived from the directory, in track order. Unlike list_exports (D7-08,
    newest first), an album has an intended sequence and the zero-padded number
    prefix means a plain name sort is that sequence."""
    directory = tracks_dir(album_dir)
    if not directory.is_dir():
        return []
    return [
        {
            "name": path.name,
            "file": f"{TRACKS_DIRNAME}/{path.name}",
            "bytes": path.stat().st_size,
        }
        for path in sorted(directory.glob("*.mp3"), key=lambda p: p.name)
    ]


def write_album_zip(album_dir: Path, filenames: list[str]) -> Path:
    """D8-09: stored, not deflated. A missing track raises rather than producing
    a short zip (N-08) -- and atomic_output removes the temp file on the way out,
    so a failed run leaves no partial album.zip and no stray .tmp."""
    destination = zip_path(album_dir)
    with atomic_output(destination) as tmp:
        with zipfile.ZipFile(tmp, "w", compression=zipfile.ZIP_STORED) as archive:
            for filename in filenames:
                source = track_path(album_dir, filename)
                if not source.is_file():
                    raise FileNotFoundError(f"track {filename} is missing from {album_dir}")
                archive.write(source, arcname=filename)
    return destination
