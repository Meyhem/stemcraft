"""Frames -> notes for the bass transcription (D-21). Pure numpy, no model, so the
rules are tested on synthetic tracks.

A note is a run of voiced frames (periodic enough AND loud enough). A run splits
where the pitch leaves its running median by more than `jump_semitones` for
`jump_frames` frames in a row (a one-frame glitch does not split it), and where
an onset falls inside it (a repeated note) -- but only once the note has lasted
`min_repeat_frames`: a second onset peak just after the attack is the same pluck,
not a new one (90 ms is a sixteenth at 166 bpm). A fragment shorter than
`min_note_frames` merges into an adjacent note of the same pitch before it, and
is dropped otherwise.
"""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass

import numpy as np


@dataclass(frozen=True)
class SegmentParams:
    voiced_min: float = 0.5
    gate_db: float = -45.0
    jump_semitones: float = 0.6
    jump_frames: int = 3
    min_note_frames: int = 6
    min_repeat_frames: int = 9


@dataclass(frozen=True)
class RawNote:
    start_frame: int
    end_frame: int  # exclusive
    midi: int
    cents: float
    confidence: float


def segment(
    midi: np.ndarray,
    periodicity: np.ndarray,
    rms_db: np.ndarray,
    onsets: Iterable[int],
    params: SegmentParams = SegmentParams(),  # noqa: B008 -- frozen, so sharing it is safe
) -> list[RawNote]:
    n = len(midi)
    voiced = (periodicity >= params.voiced_min) & (rms_db >= params.gate_db)
    onset_set = {int(o) for o in onsets}

    spans: list[tuple[int, int]] = []
    start: int | None = None
    for t in range(n):
        if not voiced[t]:
            if start is not None:
                spans.append((start, t))
            start = None
            continue
        if start is None:
            start = t
            continue
        repeat = t in onset_set and t - start >= params.min_repeat_frames
        if repeat or _jumps(midi, voiced, t, float(np.median(midi[start:t])), params):
            spans.append((start, t))
            start = t
    if start is not None:
        spans.append((start, n))

    notes: list[RawNote] = []
    for s, e in spans:
        note = _note(midi, periodicity, s, e)
        if e - s >= params.min_note_frames:
            notes.append(note)
        elif notes and notes[-1].end_frame == s and notes[-1].midi == note.midi:
            notes[-1] = _note(midi, periodicity, notes[-1].start_frame, e)
    return notes


def _jumps(midi: np.ndarray, voiced: np.ndarray, t: int, ref: float, params: SegmentParams) -> bool:
    end = t + params.jump_frames
    if end > len(midi) or not voiced[t:end].all():
        return False
    return bool(np.all(np.abs(midi[t:end] - ref) > params.jump_semitones))


def _note(midi: np.ndarray, periodicity: np.ndarray, s: int, e: int) -> RawNote:
    med = float(np.median(midi[s:e]))
    rounded = int(round(med))
    return RawNote(
        start_frame=s,
        end_frame=e,
        midi=rounded,
        cents=(med - rounded) * 100.0,
        confidence=float(np.mean(periodicity[s:e])),
    )
