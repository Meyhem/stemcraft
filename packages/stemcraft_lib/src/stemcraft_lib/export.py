"""The export recipe: what a rendered file is made of, resolved to numbers.

D7-02 is the reason this module exists in stemcraft_lib rather than in either
process. The API builds an ExportRecipe by reading song.json and puts it in the
job payload; the worker validates the same model back out of that payload and
renders from it, and never reads song.json itself. §6 requires every job to be
idempotent by re-derivation from inputs that never change -- song.json is
autosaved on every slider drag, so it is not one of those inputs. The stems and
this payload are.

Nothing here touches ffmpeg or torch: both processes import it (§4).
"""

from __future__ import annotations

import re
from pathlib import Path

from pydantic import BaseModel, Field, field_validator

from .ids import slugify
from .song import STEM_NAMES

EXPORTS_DIRNAME = "exports"

# D7-09: one format, one bitrate, deliberately not a field on the recipe.
EXPORT_BITRATE = "320k"

# The alphabet slugify() produces, and therefore the only shape the download
# route will accept. `name` is user-typed and lands in a filesystem path, so the
# route matches it against this instead of sanitizing -- a name that does not
# match is a name this app never wrote (see the API task's traversal test).
NAME_PATTERN = re.compile(r"^[a-z0-9][a-z0-9-]*$")


class ExportStem(BaseModel):
    name: str
    gain_db: float = 0.0

    @field_validator("name")
    @classmethod
    def _known_stem(cls, value: str) -> str:
        if value not in STEM_NAMES:
            raise ValueError(f"{value!r} is not one of {STEM_NAMES}")
        return value


class ExportRecipe(BaseModel):
    """A render, fully determined. Every value here is a number or a string --
    there is no reference to anything that can change under the job."""

    song_id: str
    name: str
    stems: list[ExportStem] = Field(min_length=1)
    # Domain spec: tempo 50-100%, pitch in semitones. Out of range is rejected,
    # never clamped (N-08) -- a recipe the Song view could not have produced
    # means the caller is wrong, and a clamp would hide that behind audio.
    tempo: float = Field(default=1.0, gt=0.0, le=1.0)
    pitch_semitones: int = Field(default=0, ge=-12, le=12)
    # D7-06: ID3, snapshotted with everything else.
    title: str = ""
    artist: str = ""

    @field_validator("stems")
    @classmethod
    def _unique_and_canonically_ordered(cls, stems: list[ExportStem]) -> list[ExportStem]:
        names = [s.name for s in stems]
        if len(set(names)) != len(names):
            raise ValueError(f"duplicate stem(s) in {names}")
        # Canonical order, so the same selection always produces the same
        # filtergraph and therefore the same bytes regardless of the order the
        # checkboxes were ticked in (the idempotency claim in §6).
        return sorted(stems, key=lambda s: STEM_NAMES.index(s.name))

    @property
    def is_identity(self) -> bool:
        """D7-05: nothing for a time-stretcher to do, so it is left out."""
        return self.tempo == 1.0 and self.pitch_semitones == 0

    @property
    def pitch_scale(self) -> float:
        """rubberband's `pitch` is a frequency ratio, not semitones."""
        return 2.0 ** (self.pitch_semitones / 12.0)


def export_name(raw: str, *, fallback: str) -> str:
    """The user's file name, reduced to NAME_PATTERN's alphabet. `fallback` is
    used when what is left is empty, so a name is never absent."""
    slug = slugify(raw) if raw.strip() else ""
    return slug if slug and slug != "untitled" else slugify(fallback)


def exports_dir(song_dir: Path) -> Path:
    return song_dir / EXPORTS_DIRNAME


def export_path(song_dir: Path, name: str) -> Path:
    return exports_dir(song_dir) / f"{name}.mp3"


def stem_wav_paths(song_dir: Path, recipe: ExportRecipe) -> list[Path]:
    """D-04/D7-03: the immutable WAV masters, in the recipe's own order -- the
    render's input order has to match the recipe's stem order, because the
    filtergraph maps input N to stems[N]'s gain."""
    return [song_dir / "stems" / f"{stem.name}.wav" for stem in recipe.stems]


def list_exports(song_dir: Path) -> list[dict]:
    """D7-08: derived from the directory, newest first. There is no stored list
    of exports anywhere for this to disagree with."""
    directory = exports_dir(song_dir)
    if not directory.is_dir():
        return []
    entries = []
    for path in directory.glob("*.mp3"):
        stat = path.stat()
        entries.append(
            {
                "name": path.stem,
                "file": f"{EXPORTS_DIRNAME}/{path.name}",
                "bytes": stat.st_size,
                "modified_at": stat.st_mtime,
            }
        )
    return sorted(entries, key=lambda e: e["modified_at"], reverse=True)
