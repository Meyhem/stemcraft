"""The `separate` job kind: HTDemucs v4 (torch, this module only -- never
stemcraft_lib or stemcraft_api, per §4) turns audio.wav into four immutable stems
(§5) plus their Opus delivery copies (D-04).

Idempotent by re-derivation (§6): every stem file lands atomically via
stemcraft_lib.ffmpeg, so a crash mid-separation never leaves a half-written stem, and
a retry after a lease reclaim just redoes the whole separation from audio.wav and
overwrites. `shifts=0` is passed explicitly -- demucs's own default (`shifts=1`)
applies one *random* time-shift-and-average pass, which would make two runs on
identical input produce slightly different (though still valid) output, undermining
the idempotency guarantee this relies on. The tiny SDR cost demucs.api.Separator's own
docstring documents for shifts=0 is worth that guarantee.
"""

from __future__ import annotations

import array
import tempfile
import wave
from pathlib import Path

import torch
from stemcraft_lib import ffmpeg
from stemcraft_lib import jobs as jobs_db
from stemcraft_lib.config import SAMPLE_RATE, settings
from stemcraft_lib.song import STEM_NAMES, find_song_dir, read_song

from ..registry import JobCancelled, JobContext, register

# ~-34 dBFS. A starting guess, not a measured result (same status as A-05's crossfade
# ms) -- Task 11 tunes this by ear against a real song with a genuinely absent stem.
NEAR_SILENT_THRESHOLD = 0.02


def _load_wav_tensor(path: Path) -> torch.Tensor:
    with wave.open(str(path), "rb") as wav_file:
        channels = wav_file.getnchannels()
        sample_width = wav_file.getsampwidth()
        if sample_width != 2:
            raise ValueError(f"{path}: expected 16-bit PCM, got {sample_width * 8}-bit")
        raw = wav_file.readframes(wav_file.getnframes())
    flat = torch.frombuffer(bytearray(raw), dtype=torch.int16)
    return flat.view(-1, channels).t().contiguous().to(torch.float32) / 32768.0


def _write_stem_wav(tensor: torch.Tensor, src_rate: int, dst: Path) -> None:
    """`tensor` is (channels, frames) float32 in [-1, 1] at `src_rate` (the model's
    native rate -- 44100 for every HTDemucs variant). Writes a temp WAV at src_rate,
    then hands off to ffmpeg.decode_to_wav for the atomic resample to SAMPLE_RATE
    (D-03's 48 kHz round trip) -- the exact function Phase 2's import already tests
    at 48 kHz stereo, rather than a second hand-rolled resampling path."""
    ints = (tensor.clamp(-1, 1) * 32767.0).round().to(torch.int16)
    interleaved = ints.t().contiguous().reshape(-1)
    pcm_bytes = array.array("h", interleaved.tolist()).tobytes()
    with tempfile.TemporaryDirectory() as tmp_dir:
        tmp_wav = Path(tmp_dir) / "stem.wav"
        with wave.open(str(tmp_wav), "wb") as wav_file:
            wav_file.setnchannels(tensor.shape[0])
            wav_file.setsampwidth(2)
            wav_file.setframerate(src_rate)
            wav_file.writeframes(pcm_bytes)
        ffmpeg.decode_to_wav(tmp_wav, dst, sample_rate=SAMPLE_RATE)


def run(ctx: JobContext) -> dict:
    song_id = ctx.payload["song_id"]
    song_dir = find_song_dir(settings().songs_dir, song_id)
    if song_dir is None:
        raise RuntimeError(f"no song directory for song_id={song_id!r}")
    read_song(song_dir)  # fail loudly if song.json itself is unreadable

    audio_wav = song_dir / "audio.wav"
    if not audio_wav.is_file():
        raise RuntimeError(f"song {song_id} has no audio.wav to separate")

    if ctx.worker_state is None:
        raise RuntimeError("separate requires a loaded Separator (JobContext.worker_state)")
    separator = ctx.worker_state.separator
    wav_tensor = _load_wav_tensor(audio_wav)

    def on_progress(info: dict) -> None:
        if ctx.cancelled():
            raise JobCancelled
        if info.get("state") == "end" and info.get("audio_length"):
            ctx.progress(min(0.95, info["segment_offset"] / info["audio_length"]))

    separator.update_parameter(shifts=0, callback=on_progress, callback_arg={})
    _, stems = separator.separate_tensor(wav_tensor, sr=SAMPLE_RATE)

    stems_dir = song_dir / "stems"
    near_silent: dict[str, bool] = {}
    for name in STEM_NAMES:
        stem_tensor = stems[name]
        near_silent[name] = float(stem_tensor.abs().max()) < NEAR_SILENT_THRESHOLD
        wav_path = stems_dir / f"{name}.wav"
        _write_stem_wav(stem_tensor, separator.samplerate, wav_path)
        ffmpeg.encode_opus(wav_path, stems_dir / f"{name}.opus")

    ctx.progress(1.0)
    jobs_db.enqueue(ctx.conn, kind="analyze", song_id=song_id, payload={"song_id": song_id})
    return {"near_silent": near_silent}


register("separate", run)
