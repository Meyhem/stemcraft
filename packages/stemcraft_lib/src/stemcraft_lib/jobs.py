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


LEASE_SECONDS = 30.0


def claim_next(
    conn: sqlite3.Connection,
    *,
    device: str,
    lease_seconds: float = LEASE_SECONDS,
    now: float | None = None,
) -> Job | None:
    """Atomically take the oldest queued job, but only if nothing is running
    (C-07). IMMEDIATE opens the write transaction up front so two workers can
    never both read an empty running set."""
    at = time.time() if now is None else now
    conn.execute("BEGIN IMMEDIATE")
    try:
        running = conn.execute(
            "SELECT COUNT(*) FROM jobs WHERE state = 'running'"
        ).fetchone()[0]
        if running:
            conn.execute("ROLLBACK")
            return None
        row = conn.execute(
            "UPDATE jobs SET state = 'running', device = ?, started_at = ?, lease_until = ? "
            "WHERE id = (SELECT id FROM jobs WHERE state = 'queued' ORDER BY id LIMIT 1) "
            "RETURNING *",
            (device, at, at + lease_seconds),
        ).fetchone()
        conn.execute("COMMIT")
    except BaseException:
        conn.execute("ROLLBACK")
        raise
    return _row_to_job(row) if row else None


def renew(conn: sqlite3.Connection, job_id: int, *, lease_seconds: float = LEASE_SECONDS) -> None:
    conn.execute(
        "UPDATE jobs SET lease_until = ? WHERE id = ? AND state = 'running'",
        (time.time() + lease_seconds, job_id),
    )


def set_progress(conn: sqlite3.Connection, job_id: int, progress: float) -> None:
    conn.execute(
        "UPDATE jobs SET progress = ? WHERE id = ? AND state = 'running'",
        (max(0.0, min(1.0, progress)), job_id),
    )


def finish(conn: sqlite3.Connection, job_id: int, result: dict | None = None) -> None:
    conn.execute(
        "UPDATE jobs SET state = 'done', progress = 1.0, finished_at = ?, lease_until = NULL, "
        "result = ? WHERE id = ?",
        (time.time(), json.dumps(result) if result is not None else None, job_id),
    )


def fail(conn: sqlite3.Connection, job_id: int, error: str) -> None:
    # N-08: the real message and traceback, kept verbatim for the Job Queue view.
    conn.execute(
        "UPDATE jobs SET state = 'failed', finished_at = ?, lease_until = NULL, error = ? "
        "WHERE id = ?",
        (time.time(), error, job_id),
    )


def request_cancel(conn: sqlite3.Connection, job_id: int) -> str:
    """Queued jobs cancel immediately. A running job gets a flag and stops at
    its next checkpoint (§9) — never hard-killed, which is what keeps VRAM from
    being orphaned."""
    conn.execute("BEGIN IMMEDIATE")
    try:
        row = conn.execute("SELECT state FROM jobs WHERE id = ?", (job_id,)).fetchone()
        if row is None:
            conn.execute("ROLLBACK")
            raise KeyError(job_id)
        state = row["state"]
        if state == "queued":
            conn.execute(
                "UPDATE jobs SET state = 'cancelled', finished_at = ? WHERE id = ?",
                (time.time(), job_id),
            )
            state = "cancelled"
        elif state == "running":
            conn.execute("UPDATE jobs SET cancel_requested = 1 WHERE id = ?", (job_id,))
        conn.execute("COMMIT")
    except BaseException:
        conn.execute("ROLLBACK")
        raise
    return state


def is_cancel_requested(conn: sqlite3.Connection, job_id: int) -> bool:
    row = conn.execute("SELECT cancel_requested FROM jobs WHERE id = ?", (job_id,)).fetchone()
    return bool(row and row["cancel_requested"])


def cancelled(conn: sqlite3.Connection, job_id: int) -> None:
    conn.execute(
        "UPDATE jobs SET state = 'cancelled', finished_at = ?, lease_until = NULL WHERE id = ?",
        (time.time(), job_id),
    )


def reclaim_expired(conn: sqlite3.Connection, *, now: float | None = None) -> list[int]:
    """Requeue jobs whose worker died holding the lease. Progress resets to 0
    because the job re-runs from the start."""
    at = time.time() if now is None else now
    rows = conn.execute(
        "UPDATE jobs SET state = 'queued', progress = 0, lease_until = NULL, started_at = NULL, "
        "device = NULL WHERE state = 'running' AND lease_until IS NOT NULL AND lease_until < ? "
        "RETURNING id",
        (at,),
    ).fetchall()
    return [r["id"] for r in rows]
