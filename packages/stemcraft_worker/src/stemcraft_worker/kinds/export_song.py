"""The `export` job kind: any subset of stems, mixed and optionally
tempo/pitch-shifted, encoded to one 320 kbps MP3 in exports/ (D-10).

This kind deliberately **does not read song.json** (D7-02). Its input is the
recipe snapshot the API put in the payload at enqueue time, because §6 requires
idempotency by re-derivation from inputs that never change and song.json is
autosaved on every slider drag. The stems are immutable (§5) and the payload is
immutable, so re-running this job -- after a lease reclaim, or from the Job Queue
weeks later -- reproduces the same file byte for byte and overwrites it.

No torch anywhere in here; the whole render is one ffmpeg subprocess.
"""

from __future__ import annotations

from stemcraft_lib import ffmpeg
from stemcraft_lib.config import settings
from stemcraft_lib.export import ExportRecipe, export_path, stem_wav_paths
from stemcraft_lib.song import find_song_dir

from ..registry import JobCancelled, JobContext, register


def run(ctx: JobContext) -> dict:
    # Validated here rather than trusted: a payload that does not parse is a bug
    # in whoever enqueued it, and N-08 wants that visible as a failed job with
    # pydantic's own message, not as a render of something almost right.
    recipe = ExportRecipe.model_validate(ctx.payload)

    song_dir = find_song_dir(settings().songs_dir, recipe.song_id)
    if song_dir is None:
        raise RuntimeError(f"no song directory for song_id={recipe.song_id!r}")

    stem_paths = stem_wav_paths(song_dir, recipe)
    missing = [path.name for path in stem_paths if not path.is_file()]
    if missing:
        raise RuntimeError(
            f"song {recipe.song_id} is missing stem master(s) {', '.join(missing)}; "
            "exports render from stems/*.wav, never from the .opus delivery copies (D-04)"
        )

    # Every stem is the same length by construction (they come out of one
    # separation of one audio.wav), so the first one's duration is the source
    # duration -- and it is what turns ffmpeg's out_time into a fraction.
    source_seconds = ffmpeg.probe(stem_paths[0]).duration_seconds
    dst = export_path(song_dir, recipe.name)

    def on_progress(fraction: float) -> None:
        # Held below 1.0 until the encode has actually returned: the last
        # progress line arrives before ffmpeg has finished muxing and renaming.
        ctx.progress(min(0.99, fraction))

    try:
        rendered_seconds = ffmpeg.render_export(
            stem_paths,
            recipe,
            dst,
            source_seconds=source_seconds,
            on_progress=on_progress,
            should_cancel=ctx.cancelled,
        )
    except ffmpeg.FfmpegCancelled as exc:
        # D7-07: the temp file is already gone; nothing partial survives.
        raise JobCancelled from exc

    ctx.progress(1.0)
    return {
        "file": f"exports/{recipe.name}.mp3",
        "bytes": dst.stat().st_size,
        "duration_seconds": round(rendered_seconds, 3),
        "stems": [stem.name for stem in recipe.stems],
        "tempo": recipe.tempo,
        "pitch_semitones": recipe.pitch_semitones,
    }


register("export", run)
