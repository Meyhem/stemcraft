"""Runtime settings. Read from the environment on every call so tests can
monkeypatch without reloading modules."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

# D-03: one sample rate is true end to end. Opus codes only at 48 kHz, so a
# 44.1 kHz master would make server and client sample indices denote different
# instants and silently defeat N-05.
SAMPLE_RATE = 48000


@dataclass(frozen=True)
class Settings:
    data_dir: Path
    songs_dir: Path
    albums_dir: Path
    jobs_db: Path
    host: str
    port: int
    dist_dir: Path | None


def _path(env: str, default: str) -> Path:
    return Path(os.environ.get(env, default)).resolve()


def settings() -> Settings:
    data_dir = _path("STEMCRAFT_DATA_DIR", "data")
    dist = os.environ.get("STEMCRAFT_DIST_DIR", "frontend/dist")
    dist_path = Path(dist).resolve()
    return Settings(
        data_dir=data_dir,
        songs_dir=_path("STEMCRAFT_SONGS_DIR", "songs"),
        # D8-01: a sibling of songs/, not a subdirectory of it -- an album is
        # not a Song and never becomes one (Q-04).
        albums_dir=_path("STEMCRAFT_ALBUMS_DIR", "albums"),
        jobs_db=data_dir / "jobs.sqlite",
        # C-05: served over the home LAN, not just loopback.
        host=os.environ.get("STEMCRAFT_HOST", "0.0.0.0"),
        port=int(os.environ.get("STEMCRAFT_PORT", "8000")),
        dist_dir=dist_path if dist_path.is_dir() else None,
    )
