from __future__ import annotations

import sqlite3
from typing import Annotated

from fastapi import APIRouter, Depends
from stemcraft_lib import jobs as jobs_db
from stemcraft_lib.config import SAMPLE_RATE
from stemcraft_lib.deps import check_all

from ..deps import get_conn

router = APIRouter()
Conn = Annotated[sqlite3.Connection, Depends(get_conn)]


@router.get("/api/health")
def health(conn: Conn) -> dict:
    """Reports; never refuses. Boot refusal happens in the lifespan (N-08), but
    the UI still needs to render a banner naming what is wrong."""
    status = jobs_db.get_worker_status(conn)
    return {
        "deps": [{"name": c.name, "ok": c.ok, "detail": c.detail} for c in check_all()],
        "device": status.device if status else None,
        "fallback_reason": status.fallback_reason if status else None,
        "sample_rate": SAMPLE_RATE,
    }
