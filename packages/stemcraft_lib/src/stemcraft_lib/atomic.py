"""The only way anything in Stemcraft writes a file.

Temp file in the same directory, fsync, rename, fsync the directory. Same
directory matters: os.replace is only atomic within one filesystem.
"""

from __future__ import annotations

import json
import os
import tempfile
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path


def _fsync_dir(dir_path: Path) -> None:
    dir_fd = os.open(dir_path, os.O_RDONLY)
    try:
        os.fsync(dir_fd)
    finally:
        os.close(dir_fd)


def replace_atomic(tmp: Path, final_path: Path) -> None:
    """Rename `tmp` into place and fsync the containing directory. `tmp` must
    already be in the same directory as `final_path` -- os.replace is only
    atomic within one filesystem."""
    os.replace(tmp, final_path)
    _fsync_dir(final_path.parent)


def atomic_write_bytes(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_name = tempfile.mkstemp(dir=path.parent, prefix=f".{path.name}.", suffix=".tmp")
    tmp = Path(tmp_name)
    try:
        with os.fdopen(fd, "wb") as fh:
            fh.write(data)
            fh.flush()
            os.fsync(fh.fileno())
        replace_atomic(tmp, path)
    except BaseException:
        tmp.unlink(missing_ok=True)
        raise


@contextmanager
def atomic_output(final_path: Path) -> Iterator[Path]:
    """Like `atomic_write_bytes`, but for a file an external process (ffmpeg)
    writes directly to a path, rather than bytes already held in memory.

    Yields an empty temp path in the same directory as `final_path`. A clean
    exit renames it into place and fsyncs the directory; any exception
    removes the temp file and leaves `final_path` untouched, same as
    `atomic_write_bytes`'s failure path.
    """
    final_path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_name = tempfile.mkstemp(
        dir=final_path.parent, prefix=f".{final_path.name}.", suffix=".tmp"
    )
    os.close(fd)
    tmp = Path(tmp_name)
    try:
        yield tmp
    except BaseException:
        tmp.unlink(missing_ok=True)
        raise
    replace_atomic(tmp, final_path)


def atomic_write_text(path: Path, text: str) -> None:
    atomic_write_bytes(path, text.encode("utf-8"))


def atomic_write_json(path: Path, obj: object) -> None:
    atomic_write_text(path, json.dumps(obj, indent=2, sort_keys=True) + "\n")
