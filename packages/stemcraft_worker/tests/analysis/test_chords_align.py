import pytest
from stemcraft_worker.analysis.chords.align import align_to_bars

SR = 48000


def test_one_chord_per_bar_by_majority_overlap():
    # Two one-second bars at 48kHz: [0, 48000) and [48000, 96000).
    downbeats = [0, 48000]
    total_samples = 96000
    # Bar 0 is mostly G:maj (0.0-0.9s) with a brief C:maj tail (0.9-1.0s).
    # Bar 1 is entirely D:maj.
    frame_chords = [(0.0, 0.9, "G:maj"), (0.9, 1.0, "C:maj"), (1.0, 2.0, "D:maj")]

    bars = align_to_bars(frame_chords, downbeats, total_samples, sample_rate=SR)

    assert len(bars) == 2
    assert bars[0].bar == 0 and bars[0].chord == "G:maj"
    assert bars[0].start_sample == 0 and bars[0].end_sample == 48000
    assert bars[1].bar == 1 and bars[1].chord == "D:maj"
    assert bars[1].start_sample == 48000 and bars[1].end_sample == 96000


def test_final_bar_extends_to_total_samples():
    downbeats = [0]
    frame_chords = [(0.0, 2.0, "A:min")]
    bars = align_to_bars(frame_chords, downbeats, total_samples=96000, sample_rate=SR)
    assert len(bars) == 1
    assert bars[0].start_sample == 0
    assert bars[0].end_sample == 96000


def test_no_downbeats_raises():
    with pytest.raises(ValueError):
        align_to_bars([(0.0, 1.0, "N")], [], total_samples=48000, sample_rate=SR)
