"""Boot validation. Both processes refuse to start when these fail (§4, N-08).

An MP3 round trip is the check that matters, not merely `ffmpeg -version`: a
build without an MP3 encoder passes a version check and then fails at export.
"""

from __future__ import annotations

import shutil
import sqlite3
import subprocess
import tempfile
from dataclasses import dataclass
from pathlib import Path

from .config import SAMPLE_RATE, settings


class DependencyError(Exception):
    pass


@dataclass(frozen=True)
class DepCheck:
    name: str
    ok: bool
    detail: str


def _check_ffmpeg() -> DepCheck:
    exe = shutil.which("ffmpeg")
    if exe is None:
        return DepCheck("ffmpeg", False, "ffmpeg is not on PATH (C-04: the only audio I/O path)")
    with tempfile.TemporaryDirectory() as tmp:
        mp3 = Path(tmp) / "probe.mp3"
        try:
            encode = subprocess.run(
                [exe, "-hide_banner", "-nostdin", "-f", "lavfi", "-i",
                 f"sine=frequency=440:duration=0.1:sample_rate={SAMPLE_RATE}",
                 "-ac", "2", "-codec:a", "libmp3lame", "-y", str(mp3)],
                capture_output=True, text=True, timeout=30,
            )
        except subprocess.TimeoutExpired:
            return DepCheck("ffmpeg", False, "timed out after 30s waiting for ffmpeg to encode MP3")
        if encode.returncode != 0:
            return DepCheck("ffmpeg", False, f"MP3 encode failed: {encode.stderr.strip()[-500:]}")
        try:
            decode = subprocess.run(
                [exe, "-hide_banner", "-nostdin", "-i", str(mp3), "-f", "null", "-"],
                capture_output=True, text=True, timeout=30,
            )
        except subprocess.TimeoutExpired:
            return DepCheck("ffmpeg", False, "timed out after 30s waiting for ffmpeg to decode MP3")
        if decode.returncode != 0:
            return DepCheck("ffmpeg", False, f"decode failed: {decode.stderr.strip()[-500:]}")
    return DepCheck("ffmpeg", True, exe)


def _check_ffmpeg_rubberband() -> DepCheck:
    """D7-01 made librubberband a correctness floor for export, so it is checked
    the same way the MP3 encoder is: by using it. `ffmpeg -filters` would list
    a filter that fails to initialise; 0.1 s of sine through it would not."""
    exe = shutil.which("ffmpeg")
    if exe is None:
        return DepCheck("ffmpeg_rubberband", False, "ffmpeg is not on PATH")
    try:
        proc = subprocess.run(
            [exe, "-hide_banner", "-nostdin", "-f", "lavfi", "-i",
             f"sine=frequency=440:duration=0.1:sample_rate={SAMPLE_RATE}",
             "-af", "rubberband=tempo=0.8:pitch=0.9:pitchq=quality", "-f", "null", "-"],
            capture_output=True, text=True, timeout=30,
        )
    except subprocess.TimeoutExpired:
        return DepCheck("ffmpeg_rubberband", False, "timed out after 30s in the rubberband filter")
    if proc.returncode != 0:
        return DepCheck(
            "ffmpeg_rubberband",
            False,
            "this ffmpeg has no working rubberband filter (D-10/D7-01: export needs "
            f"librubberband): {proc.stderr.strip()[-500:]}",
        )
    return DepCheck("ffmpeg_rubberband", True, "rubberband filter available")


def _check_yt_dlp() -> DepCheck:
    exe = shutil.which("yt-dlp")
    if exe is None:
        # R-04: currently absent on the host. C-08 makes it refuse-to-start.
        return DepCheck("yt-dlp", False, "yt-dlp is not on PATH (C-08: required, keep it updated)")
    try:
        proc = subprocess.run([exe, "--version"], capture_output=True, text=True, timeout=30)
    except subprocess.TimeoutExpired:
        return DepCheck("yt-dlp", False, "timed out after 30s waiting for yt-dlp --version")
    if proc.returncode != 0:
        return DepCheck("yt-dlp", False, proc.stderr.strip()[-500:])
    return DepCheck("yt-dlp", True, f"{exe} ({proc.stdout.strip()})")


def _check_dirs() -> DepCheck:
    cfg = settings()
    for directory in (cfg.data_dir, cfg.songs_dir):
        try:
            directory.mkdir(parents=True, exist_ok=True)
            probe = directory / ".write-probe"
            probe.write_text("ok")
            probe.unlink()
        except OSError as exc:
            return DepCheck("data_dirs", False, f"{directory}: {exc}")
    return DepCheck("data_dirs", True, f"{cfg.data_dir}, {cfg.songs_dir}")


def _check_sqlite_wal() -> DepCheck:
    cfg = settings()
    try:
        cfg.jobs_db.parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(cfg.jobs_db)
        try:
            mode = conn.execute("PRAGMA journal_mode=WAL").fetchone()[0]
        finally:
            conn.close()
    except OSError as exc:
        return DepCheck("sqlite_wal", False, f"{cfg.jobs_db}: {exc}")
    except sqlite3.Error as exc:
        return DepCheck("sqlite_wal", False, f"{cfg.jobs_db}: {exc}")
    if str(mode).lower() != "wal":
        return DepCheck("sqlite_wal", False, f"journal_mode is {mode!r}, not wal")
    return DepCheck("sqlite_wal", True, str(cfg.jobs_db))


def check_all() -> list[DepCheck]:
    return [
        _check_ffmpeg(),
        _check_ffmpeg_rubberband(),
        _check_dirs(),
        _check_sqlite_wal(),
        _check_yt_dlp(),
    ]


def assert_ready() -> list[DepCheck]:
    checks = check_all()
    failed = [c for c in checks if not c.ok]
    if failed:
        lines = "\n".join(f"  - {c.name}: {c.detail}" for c in failed)
        raise DependencyError(f"refusing to start; unmet dependencies:\n{lines}")
    return checks
