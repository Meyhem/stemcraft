"""Song identity. The id is authoritative; the slug is decoration that makes
the songs/ tree readable, and nothing ever parses it back."""

from __future__ import annotations

import re
import unicodedata

from ulid import ULID

_SLUG_STRIP = re.compile(r"[^a-z0-9]+")
_MAX_SLUG = 60


def new_song_id() -> str:
    return str(ULID())


def slugify(text: str) -> str:
    normalized = unicodedata.normalize("NFKD", text)
    ascii_only = normalized.encode("ascii", "ignore").decode("ascii")
    slug = _SLUG_STRIP.sub("-", ascii_only.lower()).strip("-")
    return slug[:_MAX_SLUG].strip("-") or "untitled"


def song_dirname(song_id: str, title: str) -> str:
    return f"{song_id}-{slugify(title)}"
