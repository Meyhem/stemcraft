"""yt-dlp: URL import (C-08). It is a refuse-to-start dependency (deps.py)
and this module is the only place it is ever invoked.

Never pass --enable-file-urls or otherwise widen what yt-dlp's generic
extractor can reach: this app already accepts arbitrary URLs from any LAN
client with no authentication (D-11, R-03), and letting that reach the
local filesystem via file:// would turn an accepted "download the internet"
risk into a local-file-read one.
"""

from __future__ import annotations

import shutil
import subprocess
import tempfile
from pathlib import Path

from .atomic import replace_atomic

# A URL download can legitimately run long (a full album, a slow mirror);
# generous but finite so a stuck download fails loudly (N-08) instead of
# wedging the worker's single serial queue forever.
_TIMEOUT_SECONDS = 1800


class YtdlpError(Exception):
    pass


def download(url: str, dest_dir: Path) -> Path:
    """Downloads url's audio into dest_dir as original.<ext>, atomically.

    yt-dlp picks the extension itself (via --audio-format), so the final
    filename isn't known ahead of time: download into a scratch
    subdirectory of dest_dir first, then move the one resulting file into
    place with replace_atomic -- the same all-or-nothing guarantee
    atomic_output gives callers who do know the filename up front.
    """
    exe = shutil.which("yt-dlp")
    if exe is None:
        raise YtdlpError("yt-dlp is not on PATH (C-08: required for URL import)")

    dest_dir.mkdir(parents=True, exist_ok=True)
    scratch = Path(tempfile.mkdtemp(dir=dest_dir, prefix=".yt-dlp-"))
    try:
        try:
            proc = subprocess.run(
                [
                    exe, "--no-playlist", "-x", "--audio-format", "best",
                    "-o", str(scratch / "original.%(ext)s"), url,
                ],
                capture_output=True, text=True, timeout=_TIMEOUT_SECONDS,
            )
        except subprocess.TimeoutExpired as exc:
            raise YtdlpError(
                f"yt-dlp download of {url} timed out after {_TIMEOUT_SECONDS}s"
            ) from exc
        if proc.returncode != 0:
            raise YtdlpError(f"yt-dlp download of {url} failed: {proc.stderr.strip()[-1000:]}")
        produced = list(scratch.glob("original.*"))
        if not produced:
            raise YtdlpError(f"yt-dlp reported success but wrote no file for {url}")
        final_path = dest_dir / produced[0].name
        replace_atomic(produced[0], final_path)
        return final_path
    finally:
        shutil.rmtree(scratch, ignore_errors=True)
