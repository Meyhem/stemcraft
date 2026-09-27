"""The `import` job kind: keep original.* -> decode to audio.wav (D-03) ->
compute peaks.json. This is the worker half of Phase 2's import feature; the
API is the sole writer of song.json and, for uploads, of original.* itself
(it already has the bytes in hand) -- this kind only ever downloads
original.* when the Song came from a URL.

Idempotent by re-derivation (§6): a crash and lease reclaim re-runs this
from the top. original.*'s presence on disk, not anything in the payload,
is the only check for "already downloaded", so a retry never re-downloads
or re-uploads it. decode_to_wav and compute_peaks are both deterministic
and overwrite their own output, so redoing them on a retry is harmless.
"""

from __future__ import annotations

from pathlib import Path

from stemcraft_lib import ffmpeg, ytdlp
from stemcraft_lib.atomic import atomic_write_json
from stemcraft_lib.config import SAMPLE_RATE, settings
from stemcraft_lib.song import find_song_dir, read_song

from .. import peaks as peaks_module
from ..registry import JobCancelled, JobContext, register


def _existing_original(song_dir: Path) -> Path | None:
    matches = sorted(song_dir.glob("original.*"))
    return matches[0] if matches else None


def run(ctx: JobContext) -> dict:
    song_id = ctx.payload["song_id"]
    song_dir = find_song_dir(settings().songs_dir, song_id)
    if song_dir is None:
        raise RuntimeError(f"no song directory for song_id={song_id!r}")
    song = read_song(song_dir)

    original = _existing_original(song_dir)
    if original is None:
        if song.source.kind != "url":
            raise RuntimeError(
                f"song {song.id} has no original.* on disk and its source is not a url"
            )
        original = ytdlp.download(song.source.value, song_dir)
    ctx.progress(0.1)
    if ctx.cancelled():
        raise JobCancelled

    audio_wav = song_dir / "audio.wav"
    ffmpeg.decode_to_wav(original, audio_wav, sample_rate=SAMPLE_RATE)
    ctx.progress(0.7)
    if ctx.cancelled():
        raise JobCancelled

    atomic_write_json(song_dir / "peaks.json", peaks_module.compute_peaks(audio_wav))
    ctx.progress(1.0)

    return {"duration_seconds": ffmpeg.probe(audio_wav).duration_seconds}


register("import", run)
