"""CREPE pitch tracking for the bass transcription (D-21). Touches torch, so it lives in
the worker only, and torchcrepe is imported inside `track` -- a broken model fails the
job, not worker boot (§7, as for analyze).

Only the network comes from torchcrepe. Its decoders add random dither to the pitch
(convert.dither), so two runs of the same audio differ by ~10 cents, which breaks
re-derivation (§6). `decode` is ours: Viterbi over the bins with CREPE's own
triangular transition (librosa's implementation, deterministic), then the
probability-weighted mean in cents over the chosen bin +-4 -- no dither.

Frames are 10 ms (hop 160 at 16 kHz), centred: frame t is sample t*480 at 48 kHz.
"""

from __future__ import annotations

from collections.abc import Callable
from functools import cache

import librosa
import numpy as np

CENTS_PER_BIN = 20.0
CENTS_OF_BIN0 = 1997.3794084376191  # relative to 10 Hz, from CREPE
N_BINS = 360
CREPE_MIN_HZ = 10.0 * 2 ** (CENTS_OF_BIN0 / 1200)  # 31.66 Hz
CREPE_SR = 16000
CREPE_HOP = 160
_MIDI_OF_10HZ = 69 - 1200 * np.log2(440.0 / 10.0) / 100


def _bin_of(hz: float) -> float:
    return (1200 * np.log2(hz / 10.0) - CENTS_OF_BIN0) / CENTS_PER_BIN


@cache
def _transition() -> np.ndarray:
    xx, yy = np.meshgrid(range(N_BINS), range(N_BINS))
    t = np.maximum(12 - np.abs(xx - yy), 0).astype(float)
    return t / t.sum(axis=1, keepdims=True)


def decode(probs: np.ndarray, fmin_hz: float, fmax_hz: float) -> tuple[np.ndarray, np.ndarray]:
    """probs: (frames, 360) network outputs. Returns (midi float, periodicity) per frame."""
    if fmin_hz < CREPE_MIN_HZ:
        raise ValueError(
            f"fmin {fmin_hz} Hz is below CREPE's lowest bin ({CREPE_MIN_HZ:.2f} Hz); "
            "every bin would be masked and the track would be a flat line"
        )
    p = np.array(probs, dtype=np.float64)
    if len(p) == 0:
        return np.zeros(0), np.zeros(0)
    lo, hi = int(np.ceil(_bin_of(fmin_hz))), int(np.floor(_bin_of(fmax_hz)))
    p[:, :lo] = 0.0
    p[:, hi + 1 :] = 0.0
    obs = p / np.maximum(p.sum(axis=1, keepdims=True), 1e-12)
    bins = librosa.sequence.viterbi(obs.T, _transition()).astype(int)
    frames = np.arange(len(bins))
    periodicity = p[frames, bins]
    cents_axis = CENTS_PER_BIN * np.arange(N_BINS) + CENTS_OF_BIN0
    cents = np.empty(len(bins))
    for t, b in enumerate(bins):
        s, e = max(0, b - 4), min(N_BINS, b + 5)
        w = p[t, s:e]
        total = w.sum()
        cents[t] = (w * cents_axis[s:e]).sum() / total if total > 0 else cents_axis[b]
    return _MIDI_OF_10HZ + cents / 100.0, periodicity


def track(
    mono48: np.ndarray,
    *,
    device: str,
    fmin_hz: float = 32.0,
    fmax_hz: float = 400.0,
    batch_size: int = 512,
    progress: Callable[[float], None] | None = None,
) -> tuple[np.ndarray, np.ndarray]:
    import torch
    import torchcrepe

    audio = librosa.resample(
        np.asarray(mono48, dtype=np.float32), orig_sr=48000, target_sr=CREPE_SR
    )
    x = torch.from_numpy(np.ascontiguousarray(audio, dtype=np.float32))[None]
    total = 1 + len(audio) // CREPE_HOP
    batches = max(1, -(-total // batch_size))
    backends = torch.backends
    saved = (backends.cudnn.allow_tf32, backends.cuda.matmul.allow_tf32,
             backends.cudnn.deterministic, backends.cudnn.benchmark)
    # Re-derivation (§6): the same stem must give the same file on a retry.
    backends.cudnn.allow_tf32 = False
    backends.cuda.matmul.allow_tf32 = False
    backends.cudnn.deterministic = True
    backends.cudnn.benchmark = False
    try:
        out = []
        with torch.no_grad():
            frames_iter = torchcrepe.preprocess(x, CREPE_SR, CREPE_HOP, batch_size, device, True)
            for i, frames in enumerate(frames_iter):
                out.append(torchcrepe.infer(frames, "full", device).float().cpu().numpy())
                if progress:
                    progress((i + 1) / batches)
    finally:
        (backends.cudnn.allow_tf32, backends.cuda.matmul.allow_tf32,
         backends.cudnn.deterministic, backends.cudnn.benchmark) = saved
    return decode(np.concatenate(out), fmin_hz, fmax_hz)
