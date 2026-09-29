from __future__ import annotations

import sqlite3
from dataclasses import asdict
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from stemcraft_lib import jobs as jobs_db

from ..deps import get_conn

router = APIRouter()
Conn = Annotated[sqlite3.Connection, Depends(get_conn)]


class EnqueueRequest(BaseModel):
    kind: str
    song_id: str | None = None
    payload: dict = {}


@router.get("/api/jobs")
def list_jobs(conn: Conn, active: bool = False, limit: int = 200) -> dict:
    states = ("queued", "running") if active else None
    return {"jobs": [asdict(j) for j in jobs_db.list_jobs(conn, states=states, limit=limit)]}


@router.get("/api/jobs/stats")
def job_stats(conn: Conn) -> dict:
    return asdict(jobs_db.job_stats(conn))


@router.post("/api/jobs", status_code=201)
def enqueue_job(body: EnqueueRequest, conn: Conn) -> dict:
    job_id = jobs_db.enqueue(conn, kind=body.kind, song_id=body.song_id, payload=body.payload)
    return {"id": job_id}


@router.post("/api/jobs/{job_id}/cancel")
def cancel_job(job_id: int, conn: Conn) -> dict:
    try:
        state = jobs_db.request_cancel(conn, job_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=f"no job {job_id}") from exc
    return {"id": job_id, "state": state}
