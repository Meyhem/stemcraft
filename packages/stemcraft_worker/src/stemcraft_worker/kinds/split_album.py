"""The `split_album` job kind: one album master cut into N tagged MP3s and one
zip (D8-06).

Like `export`, this kind deliberately **does not read album.json** (D8-05). Its
input is the SplitRecipe the API snapshotted into the payload at enqueue time,
because §6 requires idempotency by re-derivation from inputs that never change
and album.json is autosaved as the user drags markers and types titles.

The zip is built from the recipe's filenames, not from a directory listing --
so a track renamed between two splits leaves its old file on disk but never
ships in the new zip.

No torch: every track is one ffmpeg subprocess.
"""

from __future__ import annotations

from stemcraft_lib import ffmpeg
from stemcraft_lib.album import (
    SplitRecipe,
    TrackSpan,
    find_album_dir,
    track_path,
    tracks_dir,
    write_album_zip,
    zip_path,
)
from stemcraft_lib.config import settings

from ..registry import JobCancelled, JobContext, register


def run(ctx: JobContext) -> dict:
    # Validated rather than trusted: a payload that does not parse is a bug in
    # whoever enqueued it, and N-08 wants that visible as a failed job carrying
    # pydantic's own message, not as a split of something almost right.
    recipe = SplitRecipe.model_validate(ctx.payload)

    album_dir = find_album_dir(settings().albums_dir, recipe.album_id)
    if album_dir is None:
        raise RuntimeError(f"no album directory for album_id={recipe.album_id!r}")

    source = album_dir / "audio.wav"
    if not source.is_file():
        raise RuntimeError(
            f"album {recipe.album_id} has no audio.wav; the import_album job has not "
            "run or did not finish. Tracks render from the decoded master (D8-03), "
            "never from original.*"
        )

    tracks_dir(album_dir).mkdir(parents=True, exist_ok=True)
    total = len(recipe.tracks)
    rendered = []

    for index, track in enumerate(recipe.tracks):
        # D8-06: the checkpoint is between tracks. render_track writes through
        # atomic_output, so stopping here leaves no partial file behind.
        if ctx.cancelled():
            raise JobCancelled
        span = TrackSpan(
            number=track.number,
            title=track.title,
            start_sample=track.start_sample,
            end_sample=track.end_sample,
            filename=track.filename,
        )
        destination = track_path(album_dir, track.filename)
        ffmpeg.render_track(
            source,
            span,
            destination,
            album_title=recipe.album_title,
            artist=recipe.artist,
            track_total=total,
        )
        rendered.append({"filename": track.filename, "bytes": destination.stat().st_size})
        # Held below 1.0 until the zip has been written too.
        ctx.progress(min(0.95, (index + 1) / (total + 1)))

    if ctx.cancelled():
        raise JobCancelled

    archive = write_album_zip(album_dir, [t.filename for t in recipe.tracks])
    ctx.progress(1.0)

    return {
        "zip": zip_path(album_dir).name,
        "bytes": archive.stat().st_size,
        "tracks": rendered,
    }


register("split_album", run)
