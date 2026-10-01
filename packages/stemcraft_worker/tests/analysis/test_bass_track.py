import numpy as np
import pytest
from stemcraft_worker.analysis.bass.track import CREPE_MIN_HZ, decode, track

CENTS_OF_BIN0 = 1997.3794084376191


def _bin_of(hz):
    return (1200 * np.log2(hz / 10.0) - CENTS_OF_BIN0) / 20.0


def test_decode_reads_a_clean_peak_as_its_pitch():
    probs = np.zeros((10, 360))
    b = int(round(_bin_of(110.0)))
    probs[:, b] = 0.9
    midi, per = decode(probs, 32.0, 400.0)
    assert np.allclose(per, 0.9)
    assert np.all(np.abs(midi - 45.0) < 0.15)  # A2 = MIDI 45


def test_decode_is_deterministic():
    rng = np.random.default_rng(0)
    probs = rng.random((50, 360)) ** 8
    a = decode(probs, 32.0, 400.0)
    b = decode(probs, 32.0, 400.0)
    assert np.array_equal(a[0], b[0]) and np.array_equal(a[1], b[1])


def test_decode_ignores_bins_outside_the_range():
    probs = np.zeros((5, 360))
    probs[:, int(round(_bin_of(800.0)))] = 1.0  # above fmax
    probs[:, int(round(_bin_of(55.0)))] = 0.3
    midi, _ = decode(probs, 32.0, 400.0)
    assert np.all(np.abs(midi - 33.0) < 0.15)  # A1


def test_fmin_below_crepes_lowest_bin_is_refused():
    with pytest.raises(ValueError, match="lowest"):
        decode(np.zeros((1, 360)), CREPE_MIN_HZ - 1, 400.0)


def test_track_finds_a_sine_on_cpu():
    t = np.arange(48000) / 48000
    midi, per = track((0.5 * np.sin(2 * np.pi * 55.0 * t)).astype(np.float32), device="cpu")
    mid = slice(20, 80)
    assert np.median(per[mid]) > 0.5
    assert abs(np.median(midi[mid]) - 33.0) < 0.3
    assert len(midi) == 101  # 1 s at 100 frames/s, centred frames incl. both ends
