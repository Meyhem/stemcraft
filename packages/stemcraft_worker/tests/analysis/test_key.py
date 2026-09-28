import subprocess

import pytest
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
