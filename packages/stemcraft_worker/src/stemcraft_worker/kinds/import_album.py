"""The `import_album` job kind: original.* -> audio.wav (D-03) -> peaks.json ->
proposals.json.

Writes only worker-owned files. The measured length goes back to the API in the
job result rather than into album.json, because album.json's only writer is the
API (invariant 2) -- and the proposed split points go to their own file for the
same reason, which is also what stops a re-detection from silently overwriting
boundaries the user dragged (D8-04).

No torch: the whole job is two ffmpeg passes and a numpy reduction.

Idempotent by re-derivation (§6): decode, peaks and detection are all
deterministic and all overwrite their own output, so a lease reclaim re-running
this from the top is harmless.
"""

from __future__ import annotations

from pathlib import Path

from stemcraft_lib import ffmpeg, silence
from stemcraft_lib.album import find_album_dir
from stemcraft_lib.atomic import atomic_write_json
from stemcraft_lib.config import SAMPLE_RATE, settings

from .. import peaks as peaks_module
from ..registry import JobCancelled, JobContext, register


def _existing_original(album_dir: Path) -> Path | None:
    matches = sorted(album_dir.glob("original.*"))
    return matches[0] if matches else None


def run(ctx: JobContext) -> dict:
    album_id = ctx.payload["album_id"]
    album_dir = find_album_dir(settings().albums_dir, album_id)
    if album_dir is None:
        raise RuntimeError(f"no album directory for album_id={album_id!r}")

    original = _existing_original(album_dir)
    if original is None:
        # There is no url import for albums, so unlike import_song there is
        # nothing to fall back to -- the API writes original.* at upload.
        raise RuntimeError(f"album {album_id} has no original.* on disk")
    if ctx.cancelled():
        raise JobCancelled

    audio_wav = album_dir / "audio.wav"
    ffmpeg.decode_to_wav(original, audio_wav, sample_rate=SAMPLE_RATE)
    ctx.progress(0.5)
    if ctx.cancelled():
        raise JobCancelled

    duration_seconds = ffmpeg.probe(audio_wav).duration_seconds
    total_samples = int(round(duration_seconds * SAMPLE_RATE))

    atomic_write_json(album_dir / "peaks.json", peaks_module.compute_peaks(audio_wav))
    ctx.progress(0.8)
    if ctx.cancelled():
        raise JobCancelled

    split_points = silence.detect_split_points(audio_wav, total_samples=total_samples)
    atomic_write_json(
        album_dir / "proposals.json",
        {
            "total_samples": total_samples,
            "split_points": split_points,
            # Recorded so a proposal can be read back later and understood --
            # "why did it find nothing?" is answerable from the file itself.
            "noise_db": silence.DEFAULT_NOISE_DB,
            "min_silence_seconds": silence.DEFAULT_MIN_SILENCE_SECONDS,
        },
    )
    ctx.progress(1.0)

    # Unlike import_song, nothing is enqueued next: a split is the user's
    # decision, made after they have looked at the proposed boundaries.
    return {
        "duration_seconds": round(duration_seconds, 3),
        "total_samples": total_samples,
        "proposed_split_points": split_points,
    }


register("import_album", run)
