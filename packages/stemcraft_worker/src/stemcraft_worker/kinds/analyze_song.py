"""The `analyze` job kind: key candidates (essentia + Krumhansl-Kessler),
beat grid (beat_this) and a bar-aligned chord chart (vendored BTC) from a
separated Song's audio.wav and stems/*.wav.

Unlike `separate`, none of this phase's models are cached in WorkerState
(§7's own dependency table scopes an analysis failure to the job, not to
worker boot, unlike ffmpeg/PyTorch) -- each helper below lazy-loads its own
model per call. Idempotent by re-derivation (§6): audio.wav and stems/*.wav
never change once written, and every step here is deterministic (models run
in eval mode; essentia's HPCP/correlation math has no randomness at all), so
a retry after a lease reclaim reproduces byte-identical output.
"""

from __future__ import annotations

import wave

from stemcraft_lib.analysis import Analysis, BeatGrid, write_analysis
from stemcraft_lib.config import SAMPLE_RATE, settings
from stemcraft_lib.song import derive_files, find_song_dir, read_song

from ..analysis.beats import detect_beats
from ..analysis.chords.align import align_to_bars
from ..analysis.chords.recognize import recognize_frames
from ..analysis.key import detect_key
from ..registry import JobCancelled, JobContext, register


def run(ctx: JobContext) -> dict:
    song_id = ctx.payload["song_id"]
    song_dir = find_song_dir(settings().songs_dir, song_id)
    if song_dir is None:
        raise RuntimeError(f"no song directory for song_id={song_id!r}")
    read_song(song_dir)  # fail loudly if song.json itself is unreadable

    audio_wav = song_dir / "audio.wav"
    if not audio_wav.is_file():
        raise RuntimeError(f"song {song_id} has no audio.wav to analyze")
    if not derive_files(song_dir).has_stems:
        raise RuntimeError(f"song {song_id} has no separated stems to analyze")

    ctx.step("key")
    key_candidates = detect_key(
        [song_dir / "stems" / "bass.wav", song_dir / "stems" / "other.wav"],
        sample_rate=SAMPLE_RATE,
    )
    if ctx.cancelled():
        raise JobCancelled

    ctx.step("beats")
    raw_grid = detect_beats(audio_wav, sample_rate=SAMPLE_RATE)
    if ctx.cancelled():
        raise JobCancelled

    ctx.step("chords")
    frame_chords = recognize_frames(audio_wav)
    total_samples = _wav_sample_count(audio_wav)
    chords = align_to_bars(frame_chords, raw_grid.downbeats, total_samples, sample_rate=SAMPLE_RATE)

    ctx.step("write")
    analysis = Analysis(
        key_candidates=key_candidates,
        beat_grid=BeatGrid(bpm=raw_grid.bpm, beats=raw_grid.beats, downbeats=raw_grid.downbeats),
        chords=chords,
    )
    write_analysis(song_dir, analysis)

    top = key_candidates[0]
    return {"bpm": raw_grid.bpm, "top_key": f"{top.tonic} {top.mode}", "bar_count": len(chords)}


def _wav_sample_count(path) -> int:
    with wave.open(str(path), "rb") as wav_file:
        return wav_file.getnframes()


register("analyze", run)
