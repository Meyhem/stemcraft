from __future__ import annotations

import shutil
import sqlite3
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, HTTPException, Response, UploadFile
from pydantic import BaseModel
from stemcraft_lib import jobs as jobs_db
from stemcraft_lib.atomic import atomic_write_bytes
from stemcraft_lib.config import settings
from stemcraft_lib.ffmpeg import FfmpegError
from stemcraft_lib.ffmpeg import probe as ffprobe
from stemcraft_lib.song import (
    SongUnreadable,
    create_song_dir,
    derive_files,
    find_song_dir,
    new_song,
    read_song,
    write_song,
)

from ..deps import get_conn

router = APIRouter()
Conn = Annotated[sqlite3.Connection, Depends(get_conn)]


class FromUrlRequest(BaseModel):
    url: str
    title: str
    artist: str = ""


def _default_title(filename: str | None) -> str:
    return (Path(filename).stem if filename else "") or "Untitled"


def _enqueue_import(conn: sqlite3.Connection, song_id: str) -> int:
    return jobs_db.enqueue(conn, kind="import", song_id=song_id, payload={"song_id": song_id})


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


@router.post("/api/songs/upload", status_code=201)
def upload_song(
    conn: Conn,
    file: Annotated[UploadFile, File()],
    title: Annotated[str, Form()] = "",
    artist: Annotated[str, Form()] = "",
) -> dict:
    # Deliberately sync, not async: FastAPI runs a sync route and its sync
    # dependencies (get_conn) in the same threadpool thread, and a
    # sqlite3.Connection can only be used from the thread that created it.
    # An async def here would read `file` on the event loop thread while
    # `conn` was created on a threadpool thread -- a cross-thread sqlite
    # error. file.file is a plain (spooled) file object, so a sync read
    # costs nothing async would have bought here anyway.
    ext = Path(file.filename).suffix.lower() if file.filename else ""
    if not ext:
        ext = ".input"
    content = file.file.read()

    song = new_song(
        title=title.strip() or _default_title(file.filename),
        artist=artist.strip(),
        source_kind="upload",
        source_value=f"original{ext}",
    )
    song_dir = create_song_dir(settings().songs_dir, song)
    # §5: song.json's writer is the API, but so is original.* here -- the
    # upload's bytes are already fully in hand, so there is no reason to
    # hand off to a job just to save them (only the slow decode is a job).
    original_path = song_dir / f"original{ext}"
    atomic_write_bytes(original_path, content)

    # Domain spec, "Import": tags fill in whatever the user left blank,
    # best-effort -- a file with no tags, or one ffprobe can't read at all,
    # simply keeps the user-typed (possibly default) values.
    if not title.strip() or not artist.strip():
        try:
            tags = ffprobe(original_path)
        except FfmpegError:
            tags = None
        if tags is not None:
            changed = False
            if not title.strip() and tags.title:
                song.title = tags.title
                changed = True
            if not artist.strip() and tags.artist:
                song.artist = tags.artist
                changed = True
            if changed:
                write_song(song_dir, song)

    job_id = _enqueue_import(conn, song.id)
    return {"song": song.model_dump(mode="json"), "job_id": job_id}


@router.post("/api/songs/from-url", status_code=201)
def create_song_from_url(body: FromUrlRequest, conn: Conn) -> dict:
    if not body.title.strip():
        # Unlike upload, there's nothing to probe before the download runs.
        raise HTTPException(status_code=422, detail="title is required for a url import")
    song = new_song(
        title=body.title.strip(),
        artist=body.artist.strip(),
        source_kind="url",
        source_value=body.url,
    )
    create_song_dir(settings().songs_dir, song)
    job_id = _enqueue_import(conn, song.id)
    return {"song": song.model_dump(mode="json"), "job_id": job_id}


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
