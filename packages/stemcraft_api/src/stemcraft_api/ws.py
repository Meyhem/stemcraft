"""Job progress push. Strictly a liveness channel (§6).

Dropping the socket loses liveness, never data: every message is a nudge to
refetch, and the client recovers by refetching on reconnect.
"""

from __future__ import annotations

import asyncio
from dataclasses import asdict

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from stemcraft_lib import jobs as jobs_db
from stemcraft_lib.config import settings

router = APIRouter()
POLL_SECONDS = 0.25
RECENT_LIMIT = 100


def _snapshot(conn) -> dict:
    jobs = [asdict(j) for j in jobs_db.list_jobs(conn, limit=RECENT_LIMIT)]
    return {"type": "jobs", "jobs": jobs}


@router.websocket("/api/ws")
async def job_stream(websocket: WebSocket) -> None:
    await websocket.accept()
    conn = jobs_db.connect(settings().jobs_db)
    try:
        last_version = jobs_db.data_version(conn)
        await websocket.send_json(_snapshot(conn))
        while True:
            await asyncio.sleep(POLL_SECONDS)
            version = jobs_db.data_version(conn)
            if version == last_version:
                continue  # idle: no query, no message
            last_version = version
            await websocket.send_json(_snapshot(conn))
    except WebSocketDisconnect:
        pass
    finally:
        conn.close()
