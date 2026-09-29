"""GET/PUT /api/theory (D-19). The API is theory.json's only writer (§2).

A missing file is a normal first run and reads as the defaults. An unreadable
one is a 500 carrying the real reason (U-09), and is left on disk untouched:
the player decides whether to reset it, from the banner that quotes the error.
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException
from stemcraft_lib.config import settings
from stemcraft_lib.theory import Theory, TheoryUnreadable, read_theory, theory_path, write_theory

router = APIRouter()


@router.get("/api/theory")
def get_theory() -> dict:
    try:
        return read_theory(settings().data_dir).model_dump(mode="json")
    except TheoryUnreadable as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.put("/api/theory")
def put_theory(body: Theory) -> dict:
    # A full replacement, like PUT /api/songs/{id}. FastAPI has already refused
    # an invalid body with a 422 naming the field.
    data_dir = settings().data_dir
    try:
        return write_theory(data_dir, body).model_dump(mode="json")
    except OSError as exc:
        # The banner quotes this (U-09); a bare 500 would hide why the save failed.
        raise HTTPException(status_code=500, detail=f"{theory_path(data_dir)}: {exc}") from exc
