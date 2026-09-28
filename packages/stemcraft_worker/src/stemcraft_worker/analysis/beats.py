"""Beat/downbeat/BPM detection via beat_this (Q-01 -- see the phase-5 plan's
"Why beat_this, not madmom" section). Runs on the full mix (audio.wav), not
stems -- rhythm is clearest with everything present, including drums.

beat_this returns beat and downbeat times in seconds; this module is the one
place those get converted to integer sample indices at 48 kHz (D-03) -- the
only unit that ever reaches analysis.json.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import numpy as np
from beat_this.inference import File2Beats


class InsufficientBeats(Exception):
    """Raised when beat_this finds too few beats or no downbeats to build a
    usable grid (silence, a corrupt decode, or non-musical audio) -- fail
    loudly (N-08) rather than write a degenerate one-point grid Phase 6's
    looping and metronome could never resolve bars against."""


@dataclass(frozen=True)
class BeatGridRaw:
    bpm: float
    beats: list[int]
    downbeats: list[int]


def detect_beats(
    audio_wav: Path, *, sample_rate: int = 48000, checkpoint_path: str = "final0"
) -> BeatGridRaw:
    file2beats = File2Beats(checkpoint_path=checkpoint_path, device="cpu", dbn=False)
    beats_sec, downbeats_sec = file2beats(str(audio_wav))

    if len(beats_sec) < 2:
        raise InsufficientBeats(f"only {len(beats_sec)} beat(s) detected in {audio_wav}")
    if len(downbeats_sec) < 1:
        raise InsufficientBeats(f"no downbeats detected in {audio_wav}")

    bpm = 60.0 / float(np.median(np.diff(beats_sec)))
    beats = [round(float(t) * sample_rate) for t in beats_sec]
    downbeats_raw = [round(float(t) * sample_rate) for t in downbeats_sec]

    # beat_this returns beats and downbeats as two independently-rounded
    # float arrays, so a downbeat can land a sample or two off its matching
    # beat. stemcraft_lib.analysis documents downbeats as a subset of beats
    # (Phase 6's sample-accurate bar snapping and metronome depend on that
    # being exactly true), so snap each downbeat to its nearest beat here.
    downbeats = [min(beats, key=lambda b: abs(b - d)) for d in downbeats_raw]

    return BeatGridRaw(bpm=bpm, beats=beats, downbeats=downbeats)
