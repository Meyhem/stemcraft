"""Silence detection: ffmpeg's silencedetect filter, parsed, turned into
proposed split points.

Proposals only. The worker writes them to proposals.json and the user applies
them with an explicit action (D8-04) -- nothing here ever edits album.json, and
re-running detection therefore cannot overwrite the boundaries someone dragged.

Parsing is a pure function of ffmpeg's stderr text so the interesting half needs
no audio to test.
"""

from __future__ import annotations

import re
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path

from .config import SAMPLE_RATE
from .ffmpeg import FfmpegError, _run

# -50 dBFS for 1.5 s. Between-track gaps on a CD rip are digital black; gaps on
# a vinyl or tape transfer are surface noise well under -50 dB. 1.5 s is longer
# than a musical rest and shorter than the shortest real gap.
DEFAULT_NOISE_DB = -50.0
DEFAULT_MIN_SILENCE_SECONDS = 1.5

# Silence within this far of either end is the lead-in or the run-out, not a
# boundary between two tracks.
EDGE_GUARD_SECONDS = 5.0

_START = re.compile(r"silence_start:\s*(-?[\d.]+)")
_END = re.compile(r"silence_end:\s*(-?[\d.]+)")


@dataclass(frozen=True)
class SilenceInterval:
    start_sample: int
    end_sample: int


def build_silencedetect_args(
    src: Path,
    *,
    noise_db: float = DEFAULT_NOISE_DB,
    min_silence_seconds: float = DEFAULT_MIN_SILENCE_SECONDS,
) -> list[str]:
    """Pure, so the filter string is testable as text."""
    return [
        "ffmpeg", "-hide_banner", "-nostdin", "-i", str(src),
        "-af", f"silencedetect=noise={noise_db}dB:d={min_silence_seconds}",
        # The filter's report on stderr is the only thing wanted; -f null
        # discards the decoded audio instead of re-encoding 70 minutes of it.
        "-f", "null", "-",
    ]


def parse_silencedetect(stderr: str, *, total_samples: int) -> list[SilenceInterval]:
    """silencedetect reports a start and its end on separate lines, interleaved
    with the rest of ffmpeg's log. A start with no end means the file ended
    inside the silence -- closed at the album's end rather than dropped."""
    intervals: list[SilenceInterval] = []
    pending: int | None = None
    for line in stderr.splitlines():
        start = _START.search(line)
        if start:
            pending = max(0, int(float(start.group(1)) * SAMPLE_RATE))
            continue
        end = _END.search(line)
        if end and pending is not None:
            intervals.append(SilenceInterval(pending, int(float(end.group(1)) * SAMPLE_RATE)))
            pending = None
    if pending is not None:
        intervals.append(SilenceInterval(pending, total_samples))
    return intervals


def propose_split_points(
    intervals: Sequence[SilenceInterval], *, total_samples: int
) -> list[int]:
    """The midpoint of each silence, minus the lead-in and run-out.

    The midpoint rather than either edge: cutting at silence_start clips the
    previous track's decay, cutting at silence_end drops the next track's
    attack. The midpoint leaves a symmetric gap on both sides, which is what a
    listener expects between tracks.
    """
    if total_samples <= 0:
        return []
    guard = int(EDGE_GUARD_SECONDS * SAMPLE_RATE)
    points = set()
    for interval in intervals:
        midpoint = (interval.start_sample + interval.end_sample) // 2
        if guard < midpoint < total_samples - guard:
            points.add(midpoint)
    # Album.split_points requires strictly increasing; a set plus sorted is
    # exactly that, and de-duplicates two silences that round to one sample.
    return sorted(points)


def detect_split_points(
    src: Path,
    *,
    total_samples: int,
    noise_db: float = DEFAULT_NOISE_DB,
    min_silence_seconds: float = DEFAULT_MIN_SILENCE_SECONDS,
) -> list[int]:
    proc = _run(
        build_silencedetect_args(
            src, noise_db=noise_db, min_silence_seconds=min_silence_seconds
        )
    )
    if proc.returncode != 0:
        # N-08: ffmpeg's own words, not a wrapper's summary.
        raise FfmpegError(f"silence detection on {src} failed: {proc.stderr.strip()[-500:]}")
    return propose_split_points(
        parse_silencedetect(proc.stderr, total_samples=total_samples),
        total_samples=total_samples,
    )
