"""CUDA probe and CPU fallback (§4, C-02, R-02). This module and every module that
imports it touches torch -- it must never be imported by stemcraft_lib or stemcraft_api
(§4's blast-radius boundary).

The SAME check plays two roles the tech spec asks for separately: a "small proof-of-work
op" deciding cuda vs. cpu, and "models load and one tiny inference succeeds on the
selected device" as a boot-refusal dependency check. Using the real htdemucs model for
both, instead of a synthetic op, is what catches an HTDemucs-specific kernel gap (R-02)
rather than a generic CUDA smoke test that wouldn't exercise the same code path a real
separation job does.
"""

from __future__ import annotations

from dataclasses import dataclass

import torch
from demucs.api import Separator
from stemcraft_lib.config import SAMPLE_RATE

_PROBE_FRAMES = SAMPLE_RATE // 10  # 0.1s of silence -- cheap, deterministic, real inference


class DeviceProbeError(Exception):
    """Neither CUDA nor CPU could load the model and run a tiny inference. The worker
    refuses to start (N-08) -- nothing would work anyway."""


@dataclass(frozen=True)
class WorkerState:
    device: str
    fallback_reason: str | None
    separator: Separator


def _tiny_probe(separator: Separator) -> None:
    silence = torch.zeros(2, _PROBE_FRAMES)
    separator.separate_tensor(silence, sr=SAMPLE_RATE)


def probe_and_select(*, model_name: str = "htdemucs") -> WorkerState:
    """Tries CUDA first; on any failure (missing kernels, no card, OOM -- caught broadly
    on purpose, since N-08 wants the real message either way, not a curated subset of
    exception types) falls back to CPU. Raises DeviceProbeError only if CPU also fails --
    total refusal, mirroring how a missing ffmpeg refuses the whole process rather than
    degrading one feature."""
    cuda_reason: str | None
    if torch.cuda.is_available():
        try:
            separator = Separator(model=model_name, device="cuda")
            _tiny_probe(separator)
            return WorkerState(device="cuda", fallback_reason=None, separator=separator)
        except Exception as exc:  # noqa: BLE001 -- N-08: the real message, whatever it is
            cuda_reason = f"{type(exc).__name__}: {exc}"
    else:
        cuda_reason = "torch.cuda.is_available() is False"

    try:
        separator = Separator(model=model_name, device="cpu")
        _tiny_probe(separator)
    except Exception as exc:
        raise DeviceProbeError(
            f"neither cuda ({cuda_reason}) nor cpu could load {model_name!r} and run a "
            f"tiny inference: {type(exc).__name__}: {exc}"
        ) from exc
    return WorkerState(device="cpu", fallback_reason=cuda_reason, separator=separator)
