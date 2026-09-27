"""jobs.sqlite: the real contract between API and worker.

The API enqueues and cancels; the worker claims, renews and finishes. Neither
calls the other. Schema and pragmas are verbatim from the domain spec.
"""

from __future__ import annotations

import json
import sqlite3
import time
from dataclasses import dataclass
from pathlib import Path

SCHEMA = """
CREATE TABLE IF NOT EXISTS jobs (
  id               INTEGER PRIMARY KEY,
  song_id          TEXT,
  kind             TEXT,
  payload          TEXT,
  state            TEXT,
  cancel_requested INTEGER DEFAULT 0,
  progress         REAL DEFAULT 0,
  device           TEXT,
  lease_until      REAL,
  created_at       REAL,
  started_at       REAL,
  finished_at      REAL,
  error            TEXT,
  result           TEXT
);
CREATE INDEX IF NOT EXISTS jobs_state_id ON jobs (state, id);
CREATE INDEX IF NOT EXISTS jobs_song ON jobs (song_id);
"""


@dataclass(frozen=True)
class Job:
    id: int
    song_id: str | None
    kind: str
    payload: dict
    state: str
    cancel_requested: bool
    progress: float
    device: str | None
    lease_until: float | None
    created_at: float | None
    started_at: float | None
    finished_at: float | None
    error: str | None
    result: dict | None


def _row_to_job(row: sqlite3.Row) -> Job:
    return Job(
        id=row["id"],
        song_id=row["song_id"],
        kind=row["kind"],
        payload=json.loads(row["payload"]) if row["payload"] else {},
        state=row["state"],
        cancel_requested=bool(row["cancel_requested"]),
        progress=row["progress"] or 0.0,
        device=row["device"],
        lease_until=row["lease_until"],
        created_at=row["created_at"],
        started_at=row["started_at"],
        finished_at=row["finished_at"],
        error=row["error"],
        result=json.loads(row["result"]) if row["result"] else None,
    )


def connect(path: Path) -> sqlite3.Connection:
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path, isolation_level=None, timeout=5.0)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA busy_timeout=5000")
    conn.execute("PRAGMA synchronous=NORMAL")
    conn.executescript(SCHEMA)
    return conn


def data_version(conn: sqlite3.Connection) -> int:
    """Cheap change detector: bumps when a DIFFERENT connection writes to
    this database file. Lets the WebSocket handler's read-only connection
    poll for changes made by the REST API's or worker's connections without
    re-querying the jobs table on every tick. By design this does not
    change when this same connection writes (see PRAGMA data_version)."""
    return conn.execute("PRAGMA data_version").fetchone()[0]


def enqueue(
    conn: sqlite3.Connection,
    *,
    kind: str,
    song_id: str | None = None,
    payload: dict | None = None,
) -> int:
    cur = conn.execute(
        "INSERT INTO jobs (song_id, kind, payload, state, progress, created_at) "
        "VALUES (?, ?, ?, 'queued', 0, ?)",
        (song_id, kind, json.dumps(payload or {}), time.time()),
    )
    return int(cur.lastrowid)


def get_job(conn: sqlite3.Connection, job_id: int) -> Job | None:
    row = conn.execute("SELECT * FROM jobs WHERE id = ?", (job_id,)).fetchone()
    return _row_to_job(row) if row else None


def list_jobs(
    conn: sqlite3.Connection,
    *,
    states: tuple[str, ...] | None = None,
    limit: int = 200,
) -> list[Job]:
    sql = "SELECT * FROM jobs"
    params: list[object] = []
    if states:
        sql += f" WHERE state IN ({','.join('?' * len(states))})"
        params.extend(states)
    sql += " ORDER BY id DESC LIMIT ?"
    params.append(limit)
    return [_row_to_job(r) for r in conn.execute(sql, params)]
