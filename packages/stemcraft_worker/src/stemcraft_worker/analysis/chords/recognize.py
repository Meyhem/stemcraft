"""Frame-level chord recognition: BTC's CQT feature extraction (adapted from
utils/mir_eval_modules.py's audio_file_to_features, MIT-licensed, same source
as btc_model.py) feeds the vendored BTC_model; this module turns its
frame-by-frame class predictions into a compact list of (start, end, label)
segments covering the whole file. Bar alignment happens separately, in
align.py, so this stays testable without a beat grid at all.
"""

from __future__ import annotations

from pathlib import Path

import librosa
import numpy as np
import torch
from stemcraft_lib.config import settings

from .btc_model import BTC_model
from .weights import checkpoint_path

# Hyperparameters and preprocessing constants, transcribed from BTC-ISMIR19's
# run_config.yaml (large-vocabulary settings: num_chords=170, not the
# commented-out majmin-only 25). Hardcoded rather than loaded from YAML at
# runtime -- these are fixed by the pretrained checkpoint's architecture, and
# upstream's own HParams.load(path) calls a bare `yaml.load(f)` with no
# Loader argument, which is worth avoiding rather than reproducing.
_MP3_CONFIG = {"song_hz": 22050, "inst_len": 10.0}
_FEATURE_CONFIG = {"n_bins": 144, "bins_per_octave": 24, "hop_length": 2048}
_MODEL_CONFIG = {
    "feature_size": 144, "timestep": 108, "num_chords": 170,
    "input_dropout": 0.2, "layer_dropout": 0.2, "attention_dropout": 0.2,
    "relu_dropout": 0.2, "num_layers": 8, "num_heads": 4, "hidden_size": 128,
    "total_key_depth": 128, "total_value_depth": 128, "filter_size": 128,
    "loss": "ce", "probs_out": False,
}

_ROOTS = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
_QUALITIES = [
    "min", "maj", "dim", "aug", "min6", "maj6", "min7", "minmaj7", "maj7", "7",
    "dim7", "hdim7", "sus2", "sus4",
]


def _idx2voca_chord() -> dict[int, str]:
    # Ported from utils/mir_eval_modules.py's idx2voca_chord().
    mapping: dict[int, str] = {169: "N", 168: "X"}
    for i in range(168):
        root = _ROOTS[i // 14]
        quality = _QUALITIES[i % 14]
        mapping[i] = root if i % 14 == 1 else f"{root}:{quality}"
    return mapping


_IDX2VOCA = _idx2voca_chord()


def _predictions_to_segments(
    predictions: list[int], total_frames: int, feature_per_second: float
) -> list[tuple[float, float, str]]:
    """Turns a flat, frame-indexed list of predicted chord-class indices into
    run-length (start, end, label) segments.

    `predictions` may be longer than `total_frames` -- BTC always predicts
    across its whole fixed-size window, including any zero-padded tail frames
    added just to fill that window (see recognize_frames). Frames at or past
    `total_frames` are padding artifacts, not real chord content, and are
    never attended to here: real frame indices are exactly [0, total_frames),
    including the final real frame at index `total_frames - 1`.

    Pulled out as its own pure function (no torch, no I/O) specifically so
    this boundary behavior can be pinned with a synthetic `predictions` list
    in a test, without depending on what the model actually predicts on real
    audio -- see test_chords_recognize.py's boundary regression test (fix
    round 2). Before this fix, the equivalent inline loop computed its
    "total frames" bound only after already appending a segment for a
    transition found inside the padding, which could emit a final segment
    with start_time > end_time -- see task-5-report.md.
    """
    segments: list[tuple[float, float, str]] = []
    start_time = 0.0
    prev_chord: int | None = None
    for global_i, idx in enumerate(predictions):
        if global_i >= total_frames:
            break
        if prev_chord is None:
            prev_chord = idx
            continue
        if idx != prev_chord:
            end_time = feature_per_second * global_i
            segments.append((start_time, end_time, _IDX2VOCA[prev_chord]))
            start_time = end_time
            prev_chord = idx

    end_time = feature_per_second * total_frames
    if end_time > start_time:
        # Only emit the trailing segment if it has positive duration. If the
        # last real frame was already consumed as the end of a prior segment
        # (start_time == end_time), there is nothing left to append.
        segments.append((start_time, end_time, _IDX2VOCA[prev_chord]))
    return segments


def _audio_file_to_features(audio_file: Path) -> tuple[np.ndarray, float]:
    # Ported from utils/mir_eval_modules.py's audio_file_to_features(), minus
    # the song_length_second return value this module doesn't need.
    song_hz = _MP3_CONFIG["song_hz"]
    inst_len = _MP3_CONFIG["inst_len"]
    original_wav, sr = librosa.load(str(audio_file), sr=song_hz, mono=True)

    chunks = []
    cursor = 0
    chunk_frames = int(song_hz * inst_len)
    while len(original_wav) > cursor + chunk_frames:
        chunk = original_wav[cursor : cursor + chunk_frames]
        chunks.append(
            librosa.cqt(chunk, sr=sr, n_bins=_FEATURE_CONFIG["n_bins"],
                        bins_per_octave=_FEATURE_CONFIG["bins_per_octave"],
                        hop_length=_FEATURE_CONFIG["hop_length"])
        )
        cursor += chunk_frames
    chunks.append(
        librosa.cqt(original_wav[cursor:], sr=sr, n_bins=_FEATURE_CONFIG["n_bins"],
                    bins_per_octave=_FEATURE_CONFIG["bins_per_octave"],
                    hop_length=_FEATURE_CONFIG["hop_length"])
    )
    feature = np.concatenate(chunks, axis=1)
    feature = np.log(np.abs(feature) + 1e-6)
    feature_per_second = inst_len / _MODEL_CONFIG["timestep"]
    return feature, feature_per_second


def recognize_frames(audio_wav: Path) -> list[tuple[float, float, str]]:
    device = torch.device("cpu")
    cache_dir = settings().data_dir / "models" / "btc"
    ckpt = torch.load(checkpoint_path(cache_dir), map_location=device, weights_only=False)

    model = BTC_model(config=_MODEL_CONFIG).to(device)
    model.load_state_dict(ckpt["model"])
    model.eval()
    mean, std = ckpt["mean"], ckpt["std"]

    feature, feature_per_second = _audio_file_to_features(audio_wav)
    feature = feature.T
    feature = (feature - mean) / std

    n_timestep = _MODEL_CONFIG["timestep"]
    num_pad = n_timestep - (feature.shape[0] % n_timestep)
    feature = np.pad(feature, ((0, num_pad), (0, 0)), mode="constant", constant_values=0)
    num_instance = feature.shape[0] // n_timestep

    # `num_pad` zero-pads the input up to a whole multiple of `n_timestep` so
    # it fits BTC's fixed-size window; `total_frames` is the count of real
    # (non-padded) frames, i.e. the boundary _predictions_to_segments must
    # never attend past.
    total_frames = num_instance * n_timestep - num_pad

    predictions: list[int] = []
    with torch.no_grad():
        feature_t = torch.tensor(feature, dtype=torch.float32).unsqueeze(0).to(device)
        for t in range(num_instance):
            if n_timestep * t >= total_frames:
                # This whole window is zero-padding (only reachable when the
                # real frame count divides n_timestep exactly, so num_pad
                # pads on one entire extra window) -- nothing real left to
                # run the model on.
                break
            window = feature_t[:, n_timestep * t : n_timestep * (t + 1), :]
            self_attn_output, _ = model.self_attn_layers(window)
            prediction, _ = model.output_layer(self_attn_output)
            prediction = prediction.squeeze()
            predictions.extend(int(prediction[i].item()) for i in range(n_timestep))

    return _predictions_to_segments(predictions, total_frames, feature_per_second)
