"""The `transcribe` job kind (D-21): stems/bass.wav -> transcription.json.

Opt-in per song (POST /api/songs/{id}/transcribe). Idempotent by re-derivation (§6):
the bass stem never changes, inference runs with TF32 off and cuDNN deterministic,
and the decode has no randomness, so a retry after a lease reclaim reproduces the
file. The stem is the worker's own 48 kHz PCM WAV, read directly; decoding user
media still goes through ffmpeg (C-04).
"""

from __future__ import annotations

import librosa
import numpy as np
import soundfile as sf
from stemcraft_lib.config import SAMPLE_RATE, settings
from stemcraft_lib.song import derive_files, find_song_dir, read_song
from stemcraft_lib.transcription import (
    TranscribedNote,
    Transcription,
    TranscriptionParams,
    write_transcription,
)

from ..analysis.bass.notes import SegmentParams, segment
from ..analysis.bass.track import track
from ..registry import JobCancelled, JobContext, register

HOP = 480  # 10 ms at 48 kHz: one CREPE frame
FMIN_HZ, FMAX_HZ = 32.0, 400.0


def run(ctx: JobContext) -> dict:
    song_id = ctx.payload["song_id"]
    song_dir = find_song_dir(settings().songs_dir, song_id)
    if song_dir is None:
        raise RuntimeError(f"no song directory for song_id={song_id!r}")
    read_song(song_dir)  # fail loudly if song.json itself is unreadable
    if not derive_files(song_dir).has_stems:
        raise RuntimeError(f"song {song_id} has no separated stems to transcribe")

    ctx.step("load")
    audio, sr = sf.read(song_dir / "stems" / "bass.wav", dtype="float32", always_2d=True)
    if sr != SAMPLE_RATE:
        raise RuntimeError(f"bass.wav is {sr} Hz, expected {SAMPLE_RATE} (D-03)")
    mono = audio.mean(axis=1)
    if ctx.cancelled():
        raise JobCancelled

    ctx.step("track")
    midi, periodicity = track(
        mono, device=ctx.device, fmin_hz=FMIN_HZ, fmax_hz=FMAX_HZ, progress=ctx.progress
    )
    if ctx.cancelled():
        raise JobCancelled

    ctx.step("notes")
    params = SegmentParams()
    rms_db = _rms_db(mono, len(midi))
    envelope = librosa.onset.onset_strength(y=mono, sr=SAMPLE_RATE, hop_length=HOP)
    onsets = librosa.onset.onset_detect(onset_envelope=envelope, sr=SAMPLE_RATE, hop_length=HOP)
    raw = segment(midi, periodicity, rms_db, onsets.tolist(), params)

    ctx.step("write")
    write_transcription(song_dir, Transcription(
        model="crepe-full",
        device=ctx.device,
        params=TranscriptionParams(
            fmin_hz=FMIN_HZ, fmax_hz=FMAX_HZ, hop_samples=HOP, voiced_min=params.voiced_min,
            gate_db=params.gate_db, jump_semitones=params.jump_semitones,
            min_note_samples=params.min_note_frames * HOP,
        ),
        notes=[
            TranscribedNote(
                start=n.start_frame * HOP, end=n.end_frame * HOP, midi=n.midi,
                cents=round(n.cents, 2), confidence=round(n.confidence, 4),
            )
            for n in raw
        ],
    ))
    return {"notes": len(raw)}


def _rms_db(mono: np.ndarray, frames: int) -> np.ndarray:
    rms = librosa.feature.rms(y=mono, frame_length=2048, hop_length=HOP, center=True)[0]
    db = 20.0 * np.log10(np.maximum(rms, 1e-9))
    if len(db) < frames:
        db = np.pad(db, (0, frames - len(db)), constant_values=-120.0)
    return db[:frames]


register("transcribe", run)
