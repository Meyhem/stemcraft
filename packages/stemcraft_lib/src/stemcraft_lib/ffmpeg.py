"""ffmpeg: the one audio I/O path (C-04). No format whitelist anywhere here --
every function hands ffmpeg whatever extension the input has and lets it
succeed or fail on ffmpeg's own terms, surfaced verbatim (N-08).

Callers never see ffmpeg's exit code or a generic wrapper message: FfmpegError
always carries ffmpeg's/ffprobe's own stderr, which is what makes a corrupt
import file's failure legible in the Job Queue screen instead of just "failed".
"""

from __future__ import annotations

import json
import shutil
import subprocess
import tempfile
import threading
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from pathlib import Path

from .album import TrackSpan
from .atomic import atomic_output
from .config import SAMPLE_RATE
from .export import EXPORT_BITRATE, ExportRecipe

# Generous but finite: a hung ffmpeg must fail loudly (N-08), not hang the
# worker's single serial queue forever.
_TIMEOUT_SECONDS = 600


class FfmpegError(Exception):
    pass


@dataclass(frozen=True)
class ProbeResult:
    duration_seconds: float
    title: str | None
    artist: str | None


def _run(args: list[str]) -> subprocess.CompletedProcess[str]:
    exe = args[0]
    if shutil.which(exe) is None:
        raise FfmpegError(f"{exe} is not on PATH (C-04: the only audio I/O path)")
    try:
        return subprocess.run(args, capture_output=True, text=True, timeout=_TIMEOUT_SECONDS)
    except subprocess.TimeoutExpired as exc:
        raise FfmpegError(f"{exe} timed out after {_TIMEOUT_SECONDS}s") from exc


def probe(path: Path) -> ProbeResult:
    """Duration and tags. Tags are best-effort -- a file with none simply
    yields Nones -- but a file ffprobe cannot read at all raises."""
    proc = _run(
        ["ffprobe", "-hide_banner", "-v", "error", "-show_format", "-of", "json", str(path)]
    )
    if proc.returncode != 0:
        raise FfmpegError(f"probe of {path} failed: {proc.stderr.strip()[-500:]}")
    fmt = json.loads(proc.stdout).get("format", {})
    tags = {k.lower(): v for k, v in fmt.get("tags", {}).items()}
    duration = fmt.get("duration")
    return ProbeResult(
        duration_seconds=float(duration) if duration is not None else 0.0,
        title=tags.get("title"),
        artist=tags.get("artist"),
    )


def decode_to_wav(src: Path, dst: Path, *, sample_rate: int = SAMPLE_RATE) -> None:
    """D-03: 48 kHz stereo, always -- never 44.1."""
    with atomic_output(dst) as tmp:
        proc = _run(
            [
                "ffmpeg", "-hide_banner", "-nostdin", "-y", "-i", str(src),
                "-ac", "2", "-ar", str(sample_rate), "-c:a", "pcm_s16le", "-f", "wav", str(tmp),
            ]
        )
        if proc.returncode != 0:
            raise FfmpegError(f"decode of {src} failed: {proc.stderr.strip()[-500:]}")


def encode_mp3(src: Path, dst: Path, *, bitrate: str = "192k") -> None:
    with atomic_output(dst) as tmp:
        proc = _run(
            [
                "ffmpeg", "-hide_banner", "-nostdin", "-y", "-i", str(src),
                "-codec:a", "libmp3lame", "-b:a", bitrate, "-f", "mp3", str(tmp),
            ]
        )
        if proc.returncode != 0:
            raise FfmpegError(f"mp3 encode of {src} failed: {proc.stderr.strip()[-500:]}")


def encode_opus(src: Path, dst: Path, *, bitrate: str = "128k") -> None:
    with atomic_output(dst) as tmp:
        proc = _run(
            [
                "ffmpeg", "-hide_banner", "-nostdin", "-y", "-i", str(src),
                "-codec:a", "libopus", "-b:a", bitrate, "-f", "opus", str(tmp),
            ]
        )
        if proc.returncode != 0:
            raise FfmpegError(f"opus encode of {src} failed: {proc.stderr.strip()[-500:]}")


class FfmpegCancelled(Exception):
    """render_export saw should_cancel() go true and terminated ffmpeg (D7-07).
    A separate exception from FfmpegError because a cancel is not a failure --
    the worker turns it into JobCancelled, which is a different job state."""


# ffmpeg's own progress cadence (-stats_period defaults to 0.5 s). It bounds how
# long a cancel takes to be noticed, because that is when we look.
_PROGRESS_KEY = "out_time_us"


def build_export_args(
    stem_paths: Sequence[Path], recipe: ExportRecipe, dst: Path
) -> list[str]:
    """The whole render as one argv: per-stem gain, one amix, optionally one
    rubberband, one MP3 encode. Pure, so the graph is testable as text.

    One subprocess and no intermediate file is not an optimization: every extra
    stage would be another 16-bit round trip, and D-10 promises this file is the
    *better* one.
    """
    if len(stem_paths) != len(recipe.stems):
        raise ValueError(
            f"{len(stem_paths)} stem path(s) for {len(recipe.stems)} recipe stem(s); "
            "input N maps to recipe.stems[N] and the two must line up"
        )

    args = [
        "ffmpeg", "-hide_banner", "-nostdin", "-v", "error",
        # Progress on stdout, so the caller can stream it without parsing the
        # stderr log that N-08 wants kept verbatim for the failure message.
        "-progress", "pipe:1", "-y",
    ]
    for path in stem_paths:
        args += ["-i", str(path)]

    chain = []
    labels = []
    for index, stem in enumerate(recipe.stems):
        chain.append(f"[{index}:a]volume={stem.gain_db:.4f}dB[g{index}]")
        labels.append(f"[g{index}]")
    # normalize=0: amix normalizes by input count by default, which would make a
    # four-stem export quieter than a one-stem export of the same material. The
    # gains in the recipe are the mix; nothing else is allowed to scale them.
    chain.append(f"{''.join(labels)}amix=inputs={len(labels)}:normalize=0[mix]")
    out_label = "[mix]"
    if not recipe.is_identity:
        chain.append(
            f"[mix]rubberband=tempo={recipe.tempo:.6f}:pitch={recipe.pitch_scale:.6f}"
            # D7-01/D-10: the offline quality settings the real-time engine cannot
            # afford. channels=together keeps the stereo pair phase-coherent; the
            # filter's `apart` default smears the image on a mix.
            ":pitchq=quality:channels=together:transients=crisp[out]"
        )
        out_label = "[out]"

    args += [
        "-filter_complex", ";".join(chain),
        "-map", out_label,
        "-ac", "2",
        "-ar", str(SAMPLE_RATE),  # D-03, restated at the output, never 44.1
        "-codec:a", "libmp3lame",
        "-b:a", EXPORT_BITRATE,
    ]
    if recipe.title:
        args += ["-metadata", f"title={recipe.title}"]
    if recipe.artist:
        args += ["-metadata", f"artist={recipe.artist}"]
    # -f mp3 explicitly: dst is an atomic_output temp path whose suffix is .tmp,
    # so ffmpeg has no extension to infer the muxer from.
    args += ["-f", "mp3", str(dst)]
    return args


def render_export(
    stem_paths: Sequence[Path],
    recipe: ExportRecipe,
    dst: Path,
    *,
    source_seconds: float,
    on_progress: Callable[[float], None] | None = None,
    should_cancel: Callable[[], bool] | None = None,
) -> float:
    """Render `recipe` to `dst` atomically. Returns the output's duration in
    seconds, which is `source_seconds / tempo` and therefore not the Song's
    duration -- that is the number worth reporting back to the UI.

    Streamed rather than run through _run() because an export of a real song is
    seconds of work the Job Queue should show moving, and because a cancel has
    to be noticed while it runs.
    """
    if shutil.which("ffmpeg") is None:
        raise FfmpegError("ffmpeg is not on PATH (C-04: the only audio I/O path)")
    expected_seconds = source_seconds / recipe.tempo if recipe.tempo else source_seconds
    rendered = 0.0

    with atomic_output(dst) as tmp:
        args = build_export_args(stem_paths, recipe, tmp)
        with tempfile.TemporaryFile("w+") as stderr_file:
            # stderr to a file, not a pipe: reading only stdout while a full
            # stderr pipe blocks ffmpeg is the classic deadlock, and N-08 needs
            # all of stderr afterwards anyway.
            proc = subprocess.Popen(args, stdout=subprocess.PIPE, stderr=stderr_file, text=True)
            stdout = proc.stdout
            assert stdout is not None  # stdout=PIPE above
            # The deadline can't be enforced by checking it between progress
            # lines: `for line in stdout` blocks in readline(), so a hung
            # ffmpeg that stops emitting progress (stuck filter, I/O
            # starvation) would never let that check run again, and this
            # would block forever -- contradicting _TIMEOUT_SECONDS' own
            # contract. A watchdog timer enforces it independently of
            # whether ffmpeg is still writing anything.
            timed_out = threading.Event()

            def _on_timeout() -> None:
                timed_out.set()
                proc.kill()

            watchdog = threading.Timer(_TIMEOUT_SECONDS, _on_timeout)
            watchdog.start()
            try:
                for line in stdout:
                    key, _, value = line.strip().partition("=")
                    if key == _PROGRESS_KEY and value not in ("", "N/A"):
                        rendered = int(value) / 1_000_000
                        if on_progress is not None and expected_seconds > 0:
                            on_progress(min(1.0, rendered / expected_seconds))
                    if should_cancel is not None and should_cancel():
                        # D7-07: a CPU subprocess writing to a temp file has
                        # nothing to orphan, so terminate rather than wait for a
                        # checkpoint. atomic_output unlinks the temp file on the
                        # way out of this `with`.
                        proc.terminate()
                        try:
                            proc.wait(timeout=10)
                        except subprocess.TimeoutExpired:
                            # A cancel is not a failure even when terminate()
                            # itself needs escalating -- the caller still gets
                            # FfmpegCancelled, never a bare TimeoutExpired.
                            proc.kill()
                            proc.wait(timeout=10)
                        raise FfmpegCancelled(f"export of {dst.name} cancelled")
            finally:
                watchdog.cancel()
                stdout.close()
                # A grace wait before kill: stdout hitting EOF means the child
                # closed the pipe, but poll() can still read None for a
                # just-exited process that hasn't been reaped yet -- killing
                # on that would turn a clean render into a spurious failure.
                try:
                    proc.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    proc.kill()
                    proc.wait(timeout=10)
            if timed_out.is_set():
                raise FfmpegError(f"ffmpeg timed out after {_TIMEOUT_SECONDS}s")
            returncode = proc.wait()
            stderr_file.seek(0)
            stderr = stderr_file.read()
        if returncode != 0:
            raise FfmpegError(f"export render of {dst.name} failed: {stderr.strip()[-500:]}")

    return rendered


def build_track_args(
    src: Path,
    span: TrackSpan,
    dst: Path,
    *,
    album_title: str,
    artist: str,
    track_total: int,
) -> list[str]:
    """One track cut out of the decoded album master. Pure, so the argv is
    testable as text -- same treatment as build_export_args.

    -ss before -i is the fast seek. With a re-encode it is also exact, and
    D8-03 has already guaranteed the source is PCM WAV, so there is no
    compressed frame boundary for the seek to land on. -t rather than -to
    because a duration is measured from the seek point and cannot drift with it.
    """
    args = [
        "ffmpeg", "-hide_banner", "-nostdin", "-v", "error", "-y",
        "-ss", f"{span.start_seconds:.6f}",
        "-i", str(src),
        "-t", f"{span.duration_seconds:.6f}",
        "-ac", "2",
        "-ar", str(SAMPLE_RATE),  # D-03, restated at the output, never 44.1
        "-codec:a", "libmp3lame",
        "-b:a", EXPORT_BITRATE,   # D8-08: imported, so the two paths cannot drift
    ]
    # An empty tag is worse than an absent one -- players show a blank field
    # rather than falling back to the filename.
    if span.title.strip():
        args += ["-metadata", f"title={span.title}"]
    if artist.strip():
        args += ["-metadata", f"artist={artist}"]
    if album_title.strip():
        args += ["-metadata", f"album={album_title}"]
    args += ["-metadata", f"track={span.number}/{track_total}"]
    args += ["-f", "mp3", str(dst)]
    return args


def render_track(
    src: Path,
    span: TrackSpan,
    dst: Path,
    *,
    album_title: str,
    artist: str,
    track_total: int,
) -> None:
    """Render one track atomically. Unlike render_export there is no progress
    callback and no cancel hook: a single track is seconds of work, and the
    split job's checkpoint is between tracks, where a cancel leaves nothing
    half-written."""
    with atomic_output(dst) as tmp:
        proc = _run(
            build_track_args(
                src, span, tmp,
                album_title=album_title, artist=artist, track_total=track_total,
            )
        )
        if proc.returncode != 0:
            raise FfmpegError(
                f"render of track {span.number} ({span.filename}) failed: "
                f"{proc.stderr.strip()[-500:]}"
            )
