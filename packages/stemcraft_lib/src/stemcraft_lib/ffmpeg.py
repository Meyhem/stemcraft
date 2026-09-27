"""ffmpeg: the one audio I/O path (C-04). No format whitelist anywhere here --
every function hands ffmpeg whatever extension the input has and lets it
succeed or fail on ffmpeg's own terms, surfaced verbatim (N-08).

Callers never see ffmpeg's exit code or a generic wrapper message: FfmpegError
always carries ffmpeg's/ffprobe's own stderr, which is what makes a corrupt
import file's failure legible in the Job Queue screen instead of just "failed".
"""

from __future__ import annotations

import json
import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path

from .atomic import atomic_output
from .config import SAMPLE_RATE

# Generous but finite: a hung ffmpeg must fail loudly (N-08), not hang the
# worker's single serial queue forever.
_TIMEOUT_SECONDS = 600


class FfmpegError(Exception):
    pass


@dataclass(frozen=True)
class ProbeResult:
    duration_seconds: float
    title: str | None
    artist: str | None


def _run(args: list[str]) -> subprocess.CompletedProcess[str]:
    exe = args[0]
    if shutil.which(exe) is None:
        raise FfmpegError(f"{exe} is not on PATH (C-04: the only audio I/O path)")
    try:
        return subprocess.run(args, capture_output=True, text=True, timeout=_TIMEOUT_SECONDS)
    except subprocess.TimeoutExpired as exc:
        raise FfmpegError(f"{exe} timed out after {_TIMEOUT_SECONDS}s") from exc


def probe(path: Path) -> ProbeResult:
    """Duration and tags. Tags are best-effort -- a file with none simply
    yields Nones -- but a file ffprobe cannot read at all raises."""
    proc = _run(
        ["ffprobe", "-hide_banner", "-v", "error", "-show_format", "-of", "json", str(path)]
    )
    if proc.returncode != 0:
        raise FfmpegError(f"probe of {path} failed: {proc.stderr.strip()[-500:]}")
    fmt = json.loads(proc.stdout).get("format", {})
    tags = {k.lower(): v for k, v in fmt.get("tags", {}).items()}
    duration = fmt.get("duration")
    return ProbeResult(
        duration_seconds=float(duration) if duration is not None else 0.0,
        title=tags.get("title"),
        artist=tags.get("artist"),
    )


def decode_to_wav(src: Path, dst: Path, *, sample_rate: int = SAMPLE_RATE) -> None:
    """D-03: 48 kHz stereo, always -- never 44.1."""
    with atomic_output(dst) as tmp:
        proc = _run(
            [
                "ffmpeg", "-hide_banner", "-nostdin", "-y", "-i", str(src),
                "-ac", "2", "-ar", str(sample_rate), "-c:a", "pcm_s16le", "-f", "wav", str(tmp),
            ]
        )
        if proc.returncode != 0:
            raise FfmpegError(f"decode of {src} failed: {proc.stderr.strip()[-500:]}")


def encode_mp3(src: Path, dst: Path, *, bitrate: str = "192k") -> None:
    with atomic_output(dst) as tmp:
        proc = _run(
            [
                "ffmpeg", "-hide_banner", "-nostdin", "-y", "-i", str(src),
                "-codec:a", "libmp3lame", "-b:a", bitrate, "-f", "mp3", str(tmp),
            ]
        )
        if proc.returncode != 0:
            raise FfmpegError(f"mp3 encode of {src} failed: {proc.stderr.strip()[-500:]}")


def encode_opus(src: Path, dst: Path, *, bitrate: str = "128k") -> None:
    with atomic_output(dst) as tmp:
        proc = _run(
            [
                "ffmpeg", "-hide_banner", "-nostdin", "-y", "-i", str(src),
                "-codec:a", "libopus", "-b:a", bitrate, "-f", "opus", str(tmp),
            ]
        )
        if proc.returncode != 0:
            raise FfmpegError(f"opus encode of {src} failed: {proc.stderr.strip()[-500:]}")
