from __future__ import annotations

import sqlite3
from dataclasses import asdict
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from stemcraft_lib import job_steps
from stemcraft_lib import jobs as jobs_db
from stemcraft_lib.job_steps import UnknownJobKind

from ..deps import get_conn

router = APIRouter()
Conn = Annotated[sqlite3.Connection, Depends(get_conn)]


class EnqueueRequest(BaseModel):
    kind: str
    song_id: str | None = None
    payload: dict = {}


@router.get("/api/jobs")
def list_jobs(
    conn: Conn, active: bool = False, limit: int = 200, song_id: str | None = None
) -> dict:
    states = ("queued", "running") if active else None
    jobs = jobs_db.list_jobs(conn, states=states, song_id=song_id, limit=limit)
    return {"jobs": [asdict(j) for j in jobs]}


@router.get("/api/job-kinds")
def job_kinds() -> dict:
    # D-17: the SPA draws a job that is not queued yet (the Import modal's
    # separate and analyze) from these declarations.
    return {"kinds": job_steps.all_declarations()}


@router.post("/api/jobs", status_code=201)
def enqueue_job(body: EnqueueRequest, conn: Conn) -> dict:
    try:
        job_id = jobs_db.enqueue(conn, kind=body.kind, song_id=body.song_id, payload=body.payload)
    except UnknownJobKind as exc:
        # N-08: the real reason, not a generic 500.
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return {"id": job_id}


@router.post("/api/jobs/{job_id}/cancel")
def cancel_job(job_id: int, conn: Conn) -> dict:
    try:
        state = jobs_db.request_cancel(conn, job_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=f"no job {job_id}") from exc
    return {"id": job_id, "state": state}
