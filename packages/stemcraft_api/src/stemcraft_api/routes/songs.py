from __future__ import annotations

import shutil
import sqlite3
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response
from stemcraft_lib import jobs as jobs_db
from stemcraft_lib.config import settings
from stemcraft_lib.song import SongUnreadable, derive_files, find_song_dir, read_song

from ..deps import get_conn

router = APIRouter()
Conn = Annotated[sqlite3.Connection, Depends(get_conn)]


def _entry(song_dir: Path) -> dict:
    try:
        song = read_song(song_dir)
    except SongUnreadable as exc:
        # §9: one bad file never breaks the library.
        return {"dir": song_dir.name, "song": None, "state": None, "files": None,
                "unreadable": str(exc)}
    files = derive_files(song_dir)
    return {
        "dir": song_dir.name,
        "song": song.model_dump(mode="json"),
        "state": files.state,
        "files": {
            "has_audio": files.has_audio,
            "has_peaks": files.has_peaks,
            "has_stems": files.has_stems,
            "has_analysis": files.has_analysis,
        },
        "unreadable": None,
    }


def _song_dirs() -> list[Path]:
    songs_dir = settings().songs_dir
    if not songs_dir.is_dir():
        return []
    # D-01: the song list is a scan. At N-07 scale there is no index to desync.
    return sorted(p for p in songs_dir.iterdir() if (p / "song.json").is_file())


def _find_dir(song_id: str) -> Path:
    song_dir = find_song_dir(settings().songs_dir, song_id)
    if song_dir is None:
        raise HTTPException(status_code=404, detail=f"no song with id {song_id}")
    return song_dir


@router.get("/api/songs")
def list_songs() -> dict:
    return {"songs": [_entry(d) for d in _song_dirs()]}


@router.get("/api/songs/{song_id}")
def get_song(song_id: str) -> dict:
    return _entry(_find_dir(song_id))


@router.delete("/api/songs/{song_id}", status_code=204)
def delete_song(song_id: str, conn: Conn) -> Response:
    song_dir = _find_dir(song_id)
    running = jobs_db.list_jobs(conn, states=("queued", "running"))
    live = [j for j in running if j.song_id == song_id]
    if live:
        ids = ", ".join(str(j.id) for j in live)
        raise HTTPException(
            status_code=409,
            detail=f"cannot delete song {song_id}: blocked by job(s) {ids} (queued or running)",
        )
    # §2 (one writer per file): the worker owns stems/, analysis.json,
    # peaks.json and exports/. This rmtree is the one sanctioned crossing of
    # that rule -- a deliberate user-initiated delete removes the whole
    # folder (domain-spec.md), gated above on there being no live job that
    # could be writing into it right now.
    shutil.rmtree(song_dir)
    return Response(status_code=204)
