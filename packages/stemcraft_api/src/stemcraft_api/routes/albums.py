"""Album splitter routes. A standalone tool beside the library (Q-04): nothing
here imports from song.py or touches the songs/ tree.

Written against routes/songs.py -- same _entry/_find_dir/derived-state idiom,
same traversal guarding on downloads, same one-writer rule (this module writes
album.json and original.*; the worker writes everything else).
"""

from __future__ import annotations

import json
import shutil
import sqlite3
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, HTTPException, Response, UploadFile
from fastapi.responses import FileResponse
from stemcraft_lib import jobs as jobs_db
from stemcraft_lib.album import (
    ALBUM_SCHEMA_VERSION,
    TRACK_FILENAME_PATTERN,
    Album,
    AlbumUnreadable,
    create_album_dir,
    derive_album_files,
    find_album_dir,
    list_tracks,
    new_album,
    read_album,
    recipe_from_album,
    track_path,
    write_album,
    zip_path,
)
from stemcraft_lib.atomic import atomic_write_bytes
from stemcraft_lib.config import settings
from stemcraft_lib.ids import slugify

from ..deps import get_conn

router = APIRouter()
Conn = Annotated[sqlite3.Connection, Depends(get_conn)]


def _default_title(filename: str | None) -> str:
    return (Path(filename).stem if filename else "") or "Untitled Album"


def _entry(album_dir: Path) -> dict:
    try:
        album = read_album(album_dir)
    except AlbumUnreadable as exc:
        # §9: one bad file never breaks the list.
        return {"dir": album_dir.name, "album": None, "state": None, "files": None,
                "unreadable": str(exc)}
    files = derive_album_files(album_dir)
    return {
        "dir": album_dir.name,
        "album": album.model_dump(mode="json"),
        "state": files.state,
        "files": {
            "has_audio": files.has_audio,
            "has_peaks": files.has_peaks,
            "has_proposals": files.has_proposals,
            "has_tracks": files.has_tracks,
            "has_zip": files.has_zip,
        },
        "unreadable": None,
    }


def _album_dirs() -> list[Path]:
    albums_dir = settings().albums_dir
    if not albums_dir.is_dir():
        return []
    return sorted(p for p in albums_dir.iterdir() if (p / "album.json").is_file())


def _find_dir(album_id: str) -> Path:
    album_dir = find_album_dir(settings().albums_dir, album_id)
    if album_dir is None:
        raise HTTPException(status_code=404, detail=f"no album with id {album_id}")
    return album_dir


@router.get("/api/albums")
def list_albums() -> dict:
    return {"albums": [_entry(d) for d in _album_dirs()]}


@router.get("/api/albums/{album_id}")
def get_album(album_id: str) -> dict:
    return _entry(_find_dir(album_id))


@router.post("/api/albums/upload", status_code=201)
def upload_album(
    conn: Conn,
    file: Annotated[UploadFile, File()],
    title: Annotated[str, Form()] = "",
    artist: Annotated[str, Form()] = "",
) -> dict:
    # Sync, not async, for the same reason as upload_song: a sqlite3.Connection
    # can only be used from the thread that created it, and FastAPI runs a sync
    # route and its sync dependencies on one threadpool thread.
    ext = Path(file.filename).suffix.lower() if file.filename else ""
    if not ext:
        ext = ".input"
    content = file.file.read()

    album = new_album(
        title=title.strip() or _default_title(file.filename),
        artist=artist.strip(),
        source_value=f"original{ext}",
    )
    album_dir = create_album_dir(settings().albums_dir, album)
    atomic_write_bytes(album_dir / f"original{ext}", content)

    # D8-07: song_id stays NULL -- an album is not a Song and never becomes one.
    job_id = jobs_db.enqueue(
        conn, kind="import_album", song_id=None, payload={"album_id": album.id}
    )
    return {"album": album.model_dump(mode="json"), "job_id": job_id}


@router.put("/api/albums/{album_id}")
def update_album(album_id: str, body: Album) -> dict:
    """Whole-document autosave, mirroring PUT /api/songs/{id}. No ETag and no
    version check: C-01 assumes one active session and accepts last-write-wins.

    A body that violates Album's validators never reaches here -- FastAPI
    rejects it as 422 with pydantic's message, which is what N-08 wants for a
    split point past the end of the album or a track count that disagrees with
    the boundaries.
    """
    album_dir = _find_dir(album_id)
    if body.id != album_id:
        raise HTTPException(
            status_code=409,
            detail=f"body id {body.id!r} does not match path id {album_id!r}",
        )
    current = read_album(album_dir)
    # Provenance is a fact about the upload, not part of what the user edits.
    updated = body.model_copy(
        update={
            "schema_version": ALBUM_SCHEMA_VERSION,
            "id": current.id,
            "created_at": current.created_at,
            "source_value": current.source_value,
        }
    )
    write_album(album_dir, updated)
    return _entry(album_dir)


@router.get("/api/albums/{album_id}/proposals")
def get_proposals(album_id: str) -> dict:
    """D8-04: worker-owned, served separately from album.json so that applying
    them is an explicit user action and re-detecting never overwrites a drag."""
    path = _find_dir(album_id) / "proposals.json"
    if not path.is_file():
        raise HTTPException(
            status_code=404,
            detail=f"album {album_id} has no silence proposals yet; its import job "
            "has not finished",
        )
    return json.loads(path.read_text())


@router.get("/api/albums/{album_id}/peaks")
def get_album_peaks(album_id: str) -> FileResponse:
    path = _find_dir(album_id) / "peaks.json"
    if not path.is_file():
        raise HTTPException(status_code=404, detail=f"album {album_id} has no peaks yet")
    return FileResponse(path, media_type="application/json")


@router.get("/api/albums/{album_id}/audio.wav")
def get_album_audio(album_id: str) -> FileResponse:
    path = _find_dir(album_id) / "audio.wav"
    if not path.is_file():
        raise HTTPException(status_code=404, detail=f"album {album_id} has no decoded audio yet")
    return FileResponse(path, media_type="audio/wav")


@router.post("/api/albums/{album_id}/split", status_code=201)
def queue_split(album_id: str, conn: Conn) -> dict:
    """Resolve the live document into an immutable snapshot and queue the render
    (D8-05). Reads album.json and writes nothing -- the worker owns tracks/ and
    album.zip (§5)."""
    album_dir = _find_dir(album_id)
    album = read_album(album_dir)
    if not derive_album_files(album_dir).has_audio:
        raise HTTPException(
            status_code=409,
            detail=f"album {album_id} has no decoded audio yet; its import job has not "
            "finished, so there is nothing to split",
        )
    if album.total_samples <= 0:
        # The length is measured by the import job and stamped into album.json
        # by a PUT from the client (§2 keeps the worker out of this file). Until
        # that lands, track_spans() is empty and a recipe cannot be built --
        # a 409 naming the reason, never a 500 out of SplitRecipe's min_length.
        raise HTTPException(
            status_code=409,
            detail=f"album {album_id} has no measured length yet; its import job has "
            "finished but total_samples has not been saved",
        )
    recipe = recipe_from_album(album)
    job_id = jobs_db.enqueue(
        conn, kind="split_album", song_id=None, payload=recipe.model_dump(mode="json")
    )
    return {"job_id": job_id, "tracks": len(recipe.tracks)}


@router.get("/api/albums/{album_id}/tracks")
def get_tracks(album_id: str) -> dict:
    # Derived from the directory, like every other fact about an album.
    return {"tracks": list_tracks(_find_dir(album_id))}


@router.get("/api/albums/{album_id}/tracks/{filename}")
def download_track(album_id: str, filename: str) -> FileResponse:
    # Matched against the alphabet the app writes rather than sanitized -- a
    # name outside TRACK_FILENAME_PATTERN is a name this app never produced.
    # Same reasoning as the export download route.
    if not TRACK_FILENAME_PATTERN.match(filename):
        raise HTTPException(status_code=404, detail=f"no track named {filename!r}")
    path = track_path(_find_dir(album_id), filename)
    if not path.is_file():
        raise HTTPException(status_code=404, detail=f"album {album_id} has no track {filename!r}")
    return FileResponse(path, media_type="audio/mpeg", filename=filename)


@router.get("/api/albums/{album_id}/album.zip")
def download_zip(album_id: str) -> FileResponse:
    album_dir = _find_dir(album_id)
    path = zip_path(album_dir)
    if not path.is_file():
        raise HTTPException(
            status_code=404, detail=f"album {album_id} has not been split yet"
        )
    album = read_album(album_dir)
    return FileResponse(
        path, media_type="application/zip", filename=f"{slugify(album.title)}.zip"
    )


@router.delete("/api/albums/{album_id}", status_code=204)
def delete_album(album_id: str, conn: Conn) -> Response:
    album_dir = _find_dir(album_id)
    # D8-07: an album's jobs carry song_id = NULL, so a live job for this
    # album is found by its payload, not the song_id column.
    live = [
        j
        for j in jobs_db.list_jobs(conn, states=("queued", "running"))
        if j.payload.get("album_id") == album_id
    ]
    if live:
        ids = ", ".join(str(j.id) for j in live)
        raise HTTPException(
            status_code=409,
            detail=f"cannot delete album {album_id}: blocked by job(s) {ids} "
            "(queued or running)",
        )
    # The one sanctioned crossing of the one-writer rule, exactly as in
    # delete_song: a deliberate user delete removes the whole folder, gated on
    # there being no live job that could be writing into it right now.
    shutil.rmtree(album_dir)
    return Response(status_code=204)
