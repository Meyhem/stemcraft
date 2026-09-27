from __future__ import annotations

import shutil
from pathlib import Path

from fastapi import APIRouter, HTTPException, Response
from stemcraft_lib.config import settings
from stemcraft_lib.song import SongUnreadable, derive_files, read_song

router = APIRouter()


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
    for candidate in _song_dirs():
        if candidate.name.split("-", 1)[0] == song_id:
            return candidate
    raise HTTPException(status_code=404, detail=f"no song with id {song_id}")


@router.get("/api/songs")
def list_songs() -> dict:
    return {"songs": [_entry(d) for d in _song_dirs()]}


@router.get("/api/songs/{song_id}")
def get_song(song_id: str) -> dict:
    return _entry(_find_dir(song_id))


@router.delete("/api/songs/{song_id}", status_code=204)
def delete_song(song_id: str) -> Response:
    shutil.rmtree(_find_dir(song_id))
    return Response(status_code=204)
