import pytest
import torch
from stemcraft_worker import device as device_module
from stemcraft_worker.device import DeviceProbeError, probe_and_select


def test_cpu_probe_succeeds_when_cuda_is_unavailable(monkeypatch):
    monkeypatch.setattr(torch.cuda, "is_available", lambda: False)
    state = probe_and_select(model_name="demucs_unittest")
    assert state.device == "cpu"
    assert state.fallback_reason is not None
    assert "is_available" in state.fallback_reason


@pytest.mark.skipif(not torch.cuda.is_available(), reason="no CUDA device on this host")
def test_cuda_probe_succeeds_when_available():
    state = probe_and_select(model_name="demucs_unittest")
    assert state.device == "cuda"
    assert state.fallback_reason is None


def test_falls_back_to_cpu_when_cuda_raises(monkeypatch):
    monkeypatch.setattr(torch.cuda, "is_available", lambda: True)

    class FakeSeparator:
        def __init__(self, model, device):
            self.device = device

        def separate_tensor(self, wav, sr):
            if self.device == "cuda":
                raise RuntimeError("no kernel image is available for execution on the device")
            return None, {}

    monkeypatch.setattr(device_module, "Separator", FakeSeparator)
    state = probe_and_select(model_name="demucs_unittest")
    assert state.device == "cpu"
    assert "no kernel image is available" in state.fallback_reason


def test_raises_when_neither_device_works(monkeypatch):
    monkeypatch.setattr(torch.cuda, "is_available", lambda: True)

    class AlwaysFailsSeparator:
        def __init__(self, model, device):
            self.device = device

        def separate_tensor(self, wav, sr):
            raise RuntimeError(f"boom on {self.device}")

    monkeypatch.setattr(device_module, "Separator", AlwaysFailsSeparator)
    with pytest.raises(DeviceProbeError) as err:
        probe_and_select(model_name="demucs_unittest")
    assert "boom on cuda" in str(err.value)
    assert "boom on cpu" in str(err.value)
