"""Waveform peaks for the Library/Song-view UI (§5: the worker owns
peaks.json). Reads audio.wav directly via stdlib wave + array rather than
numpy: decode_to_wav (stemcraft_lib.ffmpeg) always produces 16-bit PCM, and
that's the only file this ever reads, so there's nothing numpy would buy
here.

Format is internal and unversioned (tech-spec §6) -- there is no external
consumer to keep compatible, only this worker and this frontend.
"""

from __future__ import annotations

import sys
import wave
from array import array
from pathlib import Path

PEAKS_VERSION = 1
_FULL_SCALE = 32768.0  # int16 range: values are normalized to roughly [-1, 1]


def compute_peaks(wav_path: Path, *, buckets_per_second: int = 100) -> dict:
    """Min/max pairs per channel at a fixed bucket rate -- the standard
    precomputed-peaks shape, accurate at any zoom level below the bucket
    resolution, unlike a single magnitude per bucket.
    """
    with wave.open(str(wav_path), "rb") as wav:
        channels = wav.getnchannels()
        sample_rate = wav.getframerate()
        sample_width = wav.getsampwidth()
        n_frames = wav.getnframes()
        if sample_width != 2:
            raise ValueError(f"{wav_path}: expected 16-bit PCM, got {sample_width * 8}-bit")
        raw = wav.readframes(n_frames)

    samples = array("h")
    samples.frombytes(raw)
    if sys.byteorder == "big":
        # array is native-endian; a WAV's data chunk is always little-endian.
        samples.byteswap()

    frames_per_bucket = max(1, round(sample_rate / buckets_per_second))
    n_buckets = -(-n_frames // frames_per_bucket) if n_frames else 0

    peaks_per_channel: list[list[float]] = [[] for _ in range(channels)]
    for bucket in range(n_buckets):
        start = bucket * frames_per_bucket
        end = min(start + frames_per_bucket, n_frames)
        for ch in range(channels):
            chunk = samples[start * channels + ch : end * channels : channels]
            lo, hi = (min(chunk), max(chunk)) if chunk else (0, 0)
            peaks_per_channel[ch].extend((lo / _FULL_SCALE, hi / _FULL_SCALE))

    return {
        "version": PEAKS_VERSION,
        "sample_rate": sample_rate,
        "length": n_frames,
        "channels": channels,
        "buckets_per_second": buckets_per_second,
        "peaks": peaks_per_channel,
    }
