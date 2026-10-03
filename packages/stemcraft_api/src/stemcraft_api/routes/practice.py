"""GET/PUT /api/practice (D-22). The API is practice.json's only writer (§2).

A missing file is a normal first run and reads as the defaults. An unreadable
one is a 500 carrying the real reason (U-09), and is left on disk untouched.
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException
from stemcraft_lib.config import settings
from stemcraft_lib.practice import (
    Practice,
    PracticeUnreadable,
    practice_path,
    read_practice,
    write_practice,
)

router = APIRouter()


@router.get("/api/practice")
def get_practice() -> dict:
    try:
        return read_practice(settings().data_dir).model_dump(mode="json")
    except PracticeUnreadable as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.put("/api/practice")
def put_practice(body: Practice) -> dict:
    # A full replacement, like PUT /api/theory. FastAPI has already refused an
    # invalid body with a 422 naming the field.
    data_dir = settings().data_dir
    try:
        return write_practice(data_dir, body).model_dump(mode="json")
    except OSError as exc:
        raise HTTPException(status_code=500, detail=f"{practice_path(data_dir)}: {exc}") from exc
