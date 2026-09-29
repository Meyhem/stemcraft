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

from . import job_steps

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
  result           TEXT,
  steps            TEXT
);
CREATE INDEX IF NOT EXISTS jobs_state_id ON jobs (state, id);
CREATE INDEX IF NOT EXISTS jobs_song ON jobs (song_id);
CREATE TABLE IF NOT EXISTS worker_status (
  id               INTEGER PRIMARY KEY CHECK (id = 1),
  device           TEXT NOT NULL,
  fallback_reason  TEXT,
  updated_at       REAL NOT NULL
);
"""

# jobs.sqlite's schema version, stored in PRAGMA user_version (SQLite's own
# schema-version slot -- no extra column or table needed for it). Mirrors
# song.json's schema_version: CREATE TABLE IF NOT EXISTS silently no-ops
# against a pre-existing database, so without this there would be no way to
# detect an old schema and every later query would just assume today's
# columns exist.
JOBS_SCHEMA_VERSION = 2

# v2 (D-17): `steps`, the job kind's declared steps and their live states.
_MIGRATIONS = {
    2: "ALTER TABLE jobs ADD COLUMN steps TEXT",
}


class JobsSchemaError(Exception):
    """jobs.sqlite's user_version is newer than this build understands.
    Refuse to guess rather than run queries against an unknown schema (same
    refusal shape as song.py's SongUnreadable for a future schema_version)."""


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
    steps: list[dict]


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
        steps=json.loads(row["steps"]) if row["steps"] else [],
    )


def connect(path: Path, *, check_same_thread: bool = True) -> sqlite3.Connection:
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(
        path, isolation_level=None, timeout=5.0, check_same_thread=check_same_thread
    )
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA busy_timeout=5000")
    conn.execute("PRAGMA synchronous=NORMAL")

    version = conn.execute("PRAGMA user_version").fetchone()[0]
    if version > JOBS_SCHEMA_VERSION:
        conn.close()
        raise JobsSchemaError(
            f"{path}: user_version {version} is newer than this build understands "
            f"({JOBS_SCHEMA_VERSION}); refusing to guess"
        )
    # A fresh database (never stamped) takes CREATE TABLE IF NOT EXISTS with
    # today's columns. An older stamped one is walked forward one migration at
    # a time first; CREATE TABLE IF NOT EXISTS is then a no-op on it.
    if 0 < version < JOBS_SCHEMA_VERSION:
        for target in range(version + 1, JOBS_SCHEMA_VERSION + 1):
            conn.execute(_MIGRATIONS[target])
    conn.executescript(SCHEMA)
    if version != JOBS_SCHEMA_VERSION:
        conn.execute(f"PRAGMA user_version = {JOBS_SCHEMA_VERSION}")
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
    # D-17: seeded before the INSERT, so an undeclared kind raises and no row
    # is written. This is the only place outside the worker that writes steps.
    steps = job_steps.seed(kind)
    cur = conn.execute(
        "INSERT INTO jobs (song_id, kind, payload, state, progress, created_at, steps) "
        "VALUES (?, ?, ?, 'queued', 0, ?, ?)",
        (song_id, kind, json.dumps(payload or {}), time.time(), json.dumps(steps)),
    )
    return int(cur.lastrowid)


def get_job(conn: sqlite3.Connection, job_id: int) -> Job | None:
    row = conn.execute("SELECT * FROM jobs WHERE id = ?", (job_id,)).fetchone()
    return _row_to_job(row) if row else None


def list_jobs(
    conn: sqlite3.Connection,
    *,
    states: tuple[str, ...] | None = None,
    song_id: str | None = None,
    limit: int | None = 200,
) -> list[Job]:
    sql = "SELECT * FROM jobs"
    where: list[str] = []
    params: list[object] = []
    if states:
        where.append(f"state IN ({','.join('?' * len(states))})")
        params.extend(states)
    if song_id is not None:
        where.append("song_id = ?")
        params.append(song_id)
    if where:
        sql += " WHERE " + " AND ".join(where)
    sql += " ORDER BY id DESC"
    if limit is not None:
        sql += " LIMIT ?"
        params.append(limit)
    return [_row_to_job(r) for r in conn.execute(sql, params)]


@dataclass(frozen=True)
class KindDuration:
    kind: str
    device: str | None
    count: int
    avg_seconds: float


@dataclass(frozen=True)
class JobStats:
    passed: int
    failed: int
    durations: list[KindDuration]


def job_stats(conn: sqlite3.Connection) -> JobStats:
    """All-time pass/fail counts and average duration by kind and device (§10) -- the
    reason jobs.sqlite keeps full history. Only done jobs are averaged: a failed job's
    duration is time-to-crash, not how long the work takes. A NULL device stays its own
    group rather than being folded into cpu (N-08)."""
    passed, failed = conn.execute(
        "SELECT COALESCE(SUM(state = 'done'), 0), COALESCE(SUM(state = 'failed'), 0) FROM jobs"
    ).fetchone()
    rows = conn.execute(
        "SELECT kind, device, COUNT(*) AS n, AVG(finished_at - started_at) AS avg_s FROM jobs "
        "WHERE state = 'done' AND started_at IS NOT NULL AND finished_at IS NOT NULL "
        "GROUP BY kind, device ORDER BY kind, device"
    )
    return JobStats(
        passed=int(passed),
        failed=int(failed),
        durations=[
            KindDuration(kind=r["kind"], device=r["device"], count=r["n"], avg_seconds=r["avg_s"])
            for r in rows
        ],
    )


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


def _steps_of(conn: sqlite3.Connection, job_id: int) -> list[dict]:
    row = conn.execute("SELECT steps FROM jobs WHERE id = ?", (job_id,)).fetchone()
    return json.loads(row["steps"]) if row and row["steps"] else []


def set_steps(conn: sqlite3.Connection, job_id: int, steps: list[dict]) -> None:
    """The worker's one write path for steps (D-17). `progress` is derived from
    them in the same statement so the two can never disagree."""
    progress = job_steps.overall(steps)
    if progress is None:
        conn.execute(
            "UPDATE jobs SET steps = ? WHERE id = ? AND state = 'running'",
            (json.dumps(steps), job_id),
        )
    else:
        conn.execute(
            "UPDATE jobs SET steps = ?, progress = ? WHERE id = ? AND state = 'running'",
            (json.dumps(steps), progress, job_id),
        )


def finish(conn: sqlite3.Connection, job_id: int, result: dict | None = None) -> None:
    conn.execute(
        "UPDATE jobs SET state = 'done', progress = 1.0, finished_at = ?, lease_until = NULL, "
        "result = ? WHERE id = ? AND state = 'running'",
        (time.time(), json.dumps(result) if result is not None else None, job_id),
    )


def fail(conn: sqlite3.Connection, job_id: int, error: str) -> None:
    # N-08: the real message and traceback, kept verbatim for the Job Queue view,
    # and the step it happened in marked failed so the UI can draw it there.
    steps = job_steps.fail_running(_steps_of(conn, job_id))
    conn.execute(
        "UPDATE jobs SET state = 'failed', finished_at = ?, lease_until = NULL, error = ?, "
        "steps = ? WHERE id = ? AND state = 'running'",
        (time.time(), error, json.dumps(steps), job_id),
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
        if conn.in_transaction:
            conn.execute("ROLLBACK")
        raise
    return state


def is_cancel_requested(conn: sqlite3.Connection, job_id: int) -> bool:
    row = conn.execute("SELECT cancel_requested FROM jobs WHERE id = ?", (job_id,)).fetchone()
    return bool(row and row["cancel_requested"])


def cancelled(conn: sqlite3.Connection, job_id: int) -> None:
    steps = job_steps.cancel_running(_steps_of(conn, job_id))
    conn.execute(
        "UPDATE jobs SET state = 'cancelled', finished_at = ?, lease_until = NULL, steps = ? "
        "WHERE id = ? AND state = 'running'",
        (time.time(), json.dumps(steps), job_id),
    )


@dataclass(frozen=True)
class WorkerStatus:
    device: str
    fallback_reason: str | None
    updated_at: float


def set_worker_status(
    conn: sqlite3.Connection, *, device: str, fallback_reason: str | None
) -> None:
    """Written once, at worker boot (§4: the device decision doesn't change during the
    process's life). Single row by construction (id=1's CHECK constraint) -- this is how
    the API learns the worker's device without importing anything torch-touching (§4)."""
    conn.execute(
        "INSERT INTO worker_status (id, device, fallback_reason, updated_at) "
        "VALUES (1, ?, ?, ?) "
        "ON CONFLICT(id) DO UPDATE SET device=excluded.device, "
        "fallback_reason=excluded.fallback_reason, updated_at=excluded.updated_at",
        (device, fallback_reason, time.time()),
    )


def get_worker_status(conn: sqlite3.Connection) -> WorkerStatus | None:
    """None until a worker has booted at least once against this database."""
    row = conn.execute(
        "SELECT device, fallback_reason, updated_at FROM worker_status WHERE id = 1"
    ).fetchone()
    return (
        WorkerStatus(
            device=row["device"],
            fallback_reason=row["fallback_reason"],
            updated_at=row["updated_at"],
        )
        if row
        else None
    )


def reclaim_expired(conn: sqlite3.Connection, *, now: float | None = None) -> list[int]:
    """Requeue jobs whose worker died holding the lease. Progress and steps
    reset because the job re-runs from the start (idempotent by re-derivation)."""
    at = time.time() if now is None else now
    rows = conn.execute(
        "UPDATE jobs SET state = 'queued', progress = 0, lease_until = NULL, started_at = NULL, "
        "device = NULL WHERE state = 'running' AND lease_until IS NOT NULL AND lease_until < ? "
        "RETURNING id, steps",
        (at,),
    ).fetchall()
    for row in rows:
        if row["steps"]:
            conn.execute(
                "UPDATE jobs SET steps = ? WHERE id = ?",
                (json.dumps(job_steps.reset(json.loads(row["steps"]))), row["id"]),
            )
    return [r["id"] for r in rows]
