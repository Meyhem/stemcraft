"""Key detection: essentia's HPCP (chroma) chain, correlated against the
Krumhansl-Kessler major/minor key profiles for all 12 tonics, ranked and
normalized into confidence percentages.

essentia.standard.Key/KeyExtractor do this same correlation internally but
only surface the single winning answer plus a strength scalar. The domain
spec (R-05) wants 2-3 ranked candidates with confidence, never one answer
presented as fact, so this module does the final ranking step itself on top
of essentia's well-tested chroma extraction.
"""

from __future__ import annotations

from pathlib import Path

import essentia.standard as es
import numpy as np
from stemcraft_lib.analysis import KeyCandidate

# essentia's HPCP bin 0 is A, ascending by semitone (verified empirically: a
# synthetic G+Bb+D chord's HPCP peaked at bins 10, 1 and 5 respectively).
_NOTE_NAMES = ["A", "A#", "B", "C", "C#", "D", "D#", "E", "F", "F#", "G", "G#"]

# Krumhansl-Kessler key profiles, indexed from the tonic (index 0 = tonic's
# own scale degree weight). Standard published values, used the same way
# essentia's own Key algorithm and most MIR key-detection work does.
_KK_MAJOR = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88])
_KK_MINOR = np.array([6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17])

# Empirical floor separating "has tonal content" from near-silence -- a
# stem's HPCP frames all near zero (see test_near_silence_raises_...).
_MIN_ENERGY = 1e-3


class InsufficientSignal(Exception):
    """Raised when the input carries no detectable tonal content (e.g. both
    the bass and other stems are near-silent) -- fail loudly (N-08) rather
    than emit meaningless confidence numbers."""


def _load_mono(path: Path, sample_rate: int) -> np.ndarray:
    return es.MonoLoader(filename=str(path), sampleRate=sample_rate)()


def _average_hpcp(audio: np.ndarray, sample_rate: int) -> np.ndarray:
    window = es.Windowing(type="hann")
    spectrum = es.Spectrum()
    spectral_peaks = es.SpectralPeaks(sampleRate=sample_rate)
    hpcp = es.HPCP(sampleRate=sample_rate)

    vectors = [
        hpcp(*spectral_peaks(spectrum(window(frame))))
        for frame in es.FrameGenerator(audio, frameSize=4096, hopSize=2048, startFromZero=True)
    ]
    if not vectors:
        return np.zeros(12)
    return np.mean(np.array(vectors), axis=0)


def detect_key(wav_paths: list[Path], *, sample_rate: int, top_n: int = 3) -> list[KeyCandidate]:
    signals = [_load_mono(p, sample_rate) for p in wav_paths]
    length = max(len(s) for s in signals)
    mixed = np.zeros(length, dtype=np.float32)
    for s in signals:
        mixed[: len(s)] += s

    chroma = _average_hpcp(mixed, sample_rate)
    if float(np.sum(chroma)) < _MIN_ENERGY:
        raise InsufficientSignal(
            f"no detectable tonal content in {[str(p) for p in wav_paths]}"
        )

    scores: list[tuple[float, str, str]] = []
    for tonic_bin, tonic_name in enumerate(_NOTE_NAMES):
        for mode, profile in (("major", _KK_MAJOR), ("minor", _KK_MINOR)):
            expected = np.roll(profile, tonic_bin)
            corr = float(np.corrcoef(chroma, expected)[0, 1])
            scores.append((corr, tonic_name, mode))
    scores.sort(key=lambda s: s[0], reverse=True)

    top = scores[:top_n]
    weights = [max(c, 0.0) for c, _, _ in top]
    total = sum(weights)
    # `total > 0.0` is false both when every clamped weight is exactly 0 (no
    # profile correlated positively -- plausible for atonal/percussive input)
    # and when total is NaN (a perfectly flat/uniform chroma makes
    # np.corrcoef's denominator zero). Do not write this as `total <= 0.0`:
    # NaN compares false against both `<=` and `>`, so that form silently
    # lets NaN through to `w / total` below -- exactly the "meaningless
    # confidence numbers" N-08 forbids.
    if not (total > 0.0):
        raise InsufficientSignal(
            f"no key profile correlated positively with the chroma extracted from "
            f"{[str(p) for p in wav_paths]}"
        )
    return [
        KeyCandidate(tonic=tonic, mode=mode, confidence=w / total)
        for (_, tonic, mode), w in zip(top, weights, strict=True)
    ]
