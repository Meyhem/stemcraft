"""Bar-aligns BTC's frame-level chord segments to the beat grid's downbeats:
one chord label per bar, chosen by which label covers the most sample-time
within that bar. Pure and model-free -- testable with synthetic frame_chords
and no checkpoint on disk, which is why it is a separate module from
recognize.py.

Bar 0 starts at the first downbeat, not at sample 0: any lead-in audio before
the first detected beat isn't part of any bar, the same convention a DAW or a
chord chart uses (bar 1 begins on beat 1).
"""

from __future__ import annotations

from stemcraft_lib.analysis import ChordSegment


def align_to_bars(
    frame_chords: list[tuple[float, float, str]],
    downbeats: list[int],
    total_samples: int,
    *,
    sample_rate: int,
) -> list[ChordSegment]:
    if not downbeats:
        raise ValueError("cannot align chords to bars with no downbeats")

    bar_bounds = [*downbeats, total_samples]
    frame_bounds = [
        (round(start * sample_rate), round(end * sample_rate), chord)
        for start, end, chord in frame_chords
    ]

    segments: list[ChordSegment] = []
    for bar_idx in range(len(bar_bounds) - 1):
        bar_start, bar_end = bar_bounds[bar_idx], bar_bounds[bar_idx + 1]
        if bar_end <= bar_start:
            continue
        overlap: dict[str, int] = {}
        for f_start, f_end, chord in frame_bounds:
            lo, hi = max(f_start, bar_start), min(f_end, bar_end)
            if hi > lo:
                overlap[chord] = overlap.get(chord, 0) + (hi - lo)
        if not overlap:
            continue
        winner = max(overlap, key=overlap.get)
        segments.append(
            ChordSegment(bar=bar_idx, start_sample=bar_start, end_sample=bar_end, chord=winner)
        )
    return segments
