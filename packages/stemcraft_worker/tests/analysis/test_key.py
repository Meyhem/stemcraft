import subprocess

import numpy as np
import pytest
from stemcraft_worker.analysis import key as key_module
from stemcraft_worker.analysis.key import InsufficientSignal, detect_key

SAMPLE_RATE = 48000


def _sine_mix(path, freqs, seconds=4, sample_rate=SAMPLE_RATE):
    inputs = []
    for f in freqs:
        inputs += ["-f", "lavfi", "-i", f"sine=frequency={f}:duration={seconds}"]
    n = len(freqs)
    subprocess.run(
        ["ffmpeg", "-hide_banner", "-nostdin", "-y", *inputs,
         "-filter_complex", f"amix=inputs={n}:duration=longest",
         "-ar", str(sample_rate), "-ac", "1", str(path)],
        check=True, capture_output=True,
    )


def test_g_minor_triad_ranks_g_minor_in_top_candidates(tmp_path):
    # G3, Bb3, D4 -- a G minor triad.
    wav = tmp_path / "chord.wav"
    _sine_mix(wav, [196.00, 233.08, 293.66])

    candidates = detect_key([wav], sample_rate=SAMPLE_RATE)

    assert len(candidates) == 3
    assert abs(sum(c.confidence for c in candidates) - 1.0) < 1e-6
    top_pairs = {(c.tonic, c.mode) for c in candidates}
    assert ("G", "minor") in top_pairs


def test_two_stems_are_mixed_together(tmp_path):
    bass = tmp_path / "bass.wav"
    other = tmp_path / "other.wav"
    _sine_mix(bass, [196.00])       # G
    _sine_mix(other, [233.08, 293.66])  # Bb, D

    candidates = detect_key([bass, other], sample_rate=SAMPLE_RATE)
    assert ("G", "minor") in {(c.tonic, c.mode) for c in candidates}


def test_near_silence_raises_insufficient_signal(tmp_path):
    silence = tmp_path / "silence.wav"
    subprocess.run(
        ["ffmpeg", "-hide_banner", "-nostdin", "-y", "-f", "lavfi",
         "-i", f"anullsrc=r={SAMPLE_RATE}:cl=mono", "-t", "2", str(silence)],
        check=True, capture_output=True,
    )
    with pytest.raises(InsufficientSignal):
        detect_key([silence], sample_rate=SAMPLE_RATE)


def test_no_positive_correlation_raises_insufficient_signal(tmp_path, monkeypatch):
    # A perfectly flat/uniform chroma -- equal energy in all 12 pitch classes,
    # plausible for atonal or purely percussive input -- has zero variance, so
    # np.corrcoef against every one of the 24 K-K profile rotations returns
    # NaN. Verified directly: all 24 correlations are NaN for this vector,
    # and its sum (24.0) clears _MIN_ENERGY, so we reach the correlation step
    # rather than tripping the near-silence check. With the old
    # `total = sum(weights) or 1.0` fallback (and even with a naive
    # `total <= 0.0` guard, since NaN compares false to both `<=` and `>`)
    # this would have silently produced NaN/0.0 confidences instead of
    # failing loudly (N-08).
    uniform_chroma = np.ones(12) * 2.0
    assert all(
        np.isnan(np.corrcoef(uniform_chroma, np.roll(profile, k))[0, 1])
        for k in range(12)
        for profile in (key_module._KK_MAJOR, key_module._KK_MINOR)
    )
    monkeypatch.setattr(key_module, "_average_hpcp", lambda audio, sample_rate: uniform_chroma)

    # Content doesn't matter -- _average_hpcp is monkeypatched -- just needs
    # to be a real, loadable, non-silent file so we reach the correlation step.
    wav = tmp_path / "chord.wav"
    _sine_mix(wav, [196.00, 233.08, 293.66])

    with pytest.raises(InsufficientSignal):
        detect_key([wav], sample_rate=SAMPLE_RATE)
