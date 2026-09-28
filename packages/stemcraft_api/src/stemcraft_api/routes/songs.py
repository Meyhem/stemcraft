from __future__ import annotations

import shutil
import sqlite3
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, HTTPException, Response, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel, ValidationError
from stemcraft_lib import jobs as jobs_db
from stemcraft_lib.analysis import read_analysis
from stemcraft_lib.atomic import atomic_write_bytes
from stemcraft_lib.config import settings
from stemcraft_lib.export import (
    NAME_PATTERN,
    ExportRecipe,
    ExportStem,
    export_name,
    export_path,
    list_exports,
)
from stemcraft_lib.ffmpeg import FfmpegError
from stemcraft_lib.ffmpeg import probe as ffprobe
from stemcraft_lib.song import (
    SCHEMA_VERSION,
    STEM_NAMES,
    Song,
    SongUnreadable,
    StemMix,
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


class ExportRequest(BaseModel):
    stems: list[str]
    # The mockup's "tempo & pitch" segmented control, and nothing else: stem
    # gains are the mix and are applied either way (D7-03).
    apply_recipe: bool = True
    name: str = ""


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


@router.get("/api/songs/{song_id}/analysis")
def get_analysis(song_id: str) -> dict:
    song_dir = _find_dir(song_id)
    if not (song_dir / "analysis.json").is_file():
        raise HTTPException(status_code=404, detail=f"song {song_id} has no analysis yet")
    return read_analysis(song_dir).model_dump(mode="json")


@router.get("/api/songs/{song_id}/stems/{stem}.opus")
def get_stem(song_id: str, stem: str) -> FileResponse:
    # §6: .opus per stem is the only thing ever served for playback (D-04).
    # `stem` is path-shaped and attacker-controlled, so it is matched against
    # the fixed four names rather than sanitized -- there is no case where a
    # fifth name is legitimate (the stem set is fixed at training time), so a
    # whitelist is both the safest and the most honest check.
    if stem not in STEM_NAMES:
        raise HTTPException(status_code=404, detail=f"no stem named {stem!r}")
    path = _find_dir(song_id) / "stems" / f"{stem}.opus"
    if not path.is_file():
        raise HTTPException(
            status_code=404, detail=f"song {song_id} has no {stem}.opus yet (not separated)"
        )
    return FileResponse(path, media_type="audio/ogg")


@router.get("/api/songs/{song_id}/peaks")
def get_peaks(song_id: str) -> FileResponse:
    path = _find_dir(song_id) / "peaks.json"
    if not path.is_file():
        raise HTTPException(status_code=404, detail=f"song {song_id} has no peaks.json yet")
    return FileResponse(path, media_type="application/json")


@router.get("/api/songs/{song_id}/audio.wav")
def get_audio(song_id: str) -> FileResponse:
    path = _find_dir(song_id) / "audio.wav"
    if not path.is_file():
        raise HTTPException(status_code=404, detail=f"song {song_id} has no audio.wav yet")
    return FileResponse(path, media_type="audio/wav")


@router.put("/api/songs/{song_id}")
def update_song(song_id: str, body: Song) -> dict:
    """Whole-document write of the practice recipe (§6: Song mutations are
    whole-document song.json writes). There is deliberately no ETag and no
    version check: §5/C-01 assume one active session and accept last-write-wins,
    and the seam for changing that later is an ETag on this resource.
    """
    song_dir = _find_dir(song_id)
    if body.id != song_id:
        raise HTTPException(
            status_code=409,
            detail=f"body id {body.id!r} does not match path id {song_id!r}",
        )
    current = read_song(song_dir)
    # Provenance is not part of the recipe and is not the client's to rewrite:
    # `created_at` and `source` are facts about the import, and `id` names the
    # folder. Everything else in the body wins wholesale.
    updated = body.model_copy(
        update={
            "schema_version": SCHEMA_VERSION,
            "id": current.id,
            "created_at": current.created_at,
            "source": current.source,
        }
    )
    write_song(song_dir, updated)
    return _entry(song_dir)


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
    # limit=None: this is a correctness gate, not a UI listing. list_jobs
    # defaults to the newest 200 rows, and the worker is strictly serial, so
    # a song's RUNNING job -- if the queue is deep -- is the OLDEST
    # queued-or-running row, not among the newest 200. A page-limited scan
    # would miss it, `live` would come back empty, and rmtree would delete a
    # directory the worker is actively writing into. A gate that exists to
    # prevent a race must see the whole table. (Same fix as delete_album.)
    running = jobs_db.list_jobs(conn, states=("queued", "running"), limit=None)
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


@router.post("/api/songs/{song_id}/export", status_code=201)
def queue_export(song_id: str, body: ExportRequest, conn: Conn) -> dict:
    """Resolve the live recipe into an immutable snapshot and queue the render.

    D7-02: everything the worker needs goes into the payload here, because
    song.json is autosaved continuously and §6 requires a job's inputs never to
    change under it. This route reads song.json and writes nothing -- the worker
    owns exports/ (§5).
    """
    song_dir = _find_dir(song_id)
    song = read_song(song_dir)
    if not derive_files(song_dir).has_stems:
        raise HTTPException(
            status_code=409,
            detail=f"song {song_id} has no separated stems to export yet",
        )
    if not body.stems:
        raise HTTPException(status_code=422, detail="pick at least one stem to export")
    unknown = [name for name in body.stems if name not in STEM_NAMES]
    if unknown:
        raise HTTPException(
            status_code=422,
            detail=f"unknown stem name(s) {', '.join(unknown)}; expected {', '.join(STEM_NAMES)}",
        )

    name = export_name(body.name, fallback=song.title)
    try:
        recipe = ExportRecipe(
            song_id=song_id,
            name=name,
            stems=[
                ExportStem(name=stem, gain_db=song.mix.get(stem, StemMix()).gain_db)
                for stem in body.stems
            ],
            tempo=song.playback.tempo if body.apply_recipe else 1.0,
            pitch_semitones=song.playback.pitch_semitones if body.apply_recipe else 0,
            title=song.title,
            artist=song.artist,
        )
    except ValidationError as exc:
        # N-08: a song.json the Song view could not have produced (a tempo above
        # 1.0, a pitch past an octave) is named, not clamped and not a traceback.
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    job_id = jobs_db.enqueue(
        conn, kind="export", song_id=song_id, payload=recipe.model_dump(mode="json")
    )
    return {"job_id": job_id, "name": name, "file": f"exports/{name}.mp3"}


@router.get("/api/songs/{song_id}/exports")
def get_exports(song_id: str) -> dict:
    # D7-08: a directory listing, like every other derived fact about a Song.
    return {"exports": list_exports(_find_dir(song_id))}


@router.get("/api/songs/{song_id}/exports/{name}.mp3")
def download_export(song_id: str, name: str) -> FileResponse:
    # `name` is user-typed and lands in a path, so it is matched against the
    # alphabet slugify() produces rather than sanitized: a name outside it is a
    # name this app never wrote. Same reasoning as the stem-name whitelist
    # above, as a pattern because export names are chosen rather than fixed.
    if not NAME_PATTERN.match(name):
        raise HTTPException(status_code=404, detail=f"no export named {name!r}")
    path = export_path(_find_dir(song_id), name)
    if not path.is_file():
        raise HTTPException(status_code=404, detail=f"song {song_id} has no export {name!r}")
    return FileResponse(path, media_type="audio/mpeg", filename=path.name)
