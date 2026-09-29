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

# See the comment at the compute_peaks call below for why this is not the
# song default of 100.
ALBUM_BUCKETS_PER_SECOND = 10


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
    ctx.step("decode")
    ffmpeg.decode_to_wav(original, audio_wav, sample_rate=SAMPLE_RATE)
    if ctx.cancelled():
        raise JobCancelled

    duration_seconds = ffmpeg.probe(audio_wav).duration_seconds
    total_samples = int(round(duration_seconds * SAMPLE_RATE))

    # A deliberate divergence from D8-01's "mirror songs/": a song's peaks.json
    # is computed at the default 100 buckets/s, which is right for four minutes
    # and absurd for seventy. At 100/s a 70-minute album is ~1.68 M floats --
    # tens of megabytes the browser must download in full before any waveform
    # appears. 10/s gives ~42,000 buckets, still an order of magnitude more than
    # the few thousand pixels the strip is ever drawn into, and the album
    # waveform is an overview for placing boundaries, not a zoomable editor.
    # (Sample-accurate positioning is unaffected: boundaries are integer sample
    # indices, never read off the peaks array.)
    ctx.step("peaks")
    atomic_write_json(
        album_dir / "peaks.json",
        peaks_module.compute_peaks(audio_wav, buckets_per_second=ALBUM_BUCKETS_PER_SECOND),
    )
    if ctx.cancelled():
        raise JobCancelled

    ctx.step("silences")
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

    # Unlike import_song, nothing is enqueued next: a split is the user's
    # decision, made after they have looked at the proposed boundaries.
    return {
        "duration_seconds": round(duration_seconds, 3),
        "total_samples": total_samples,
        "proposed_split_points": split_points,
    }


register("import_album", run)
