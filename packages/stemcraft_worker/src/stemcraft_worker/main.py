"""The worker: poll, claim, run, finish. Never called by the API.

It owns all GPU work and everything under a Song folder except song.json.
"""

from __future__ import annotations

import logging
import sqlite3
import threading
import time
import traceback

from stemcraft_lib import jobs as jobs_db
from stemcraft_lib.config import settings
from stemcraft_lib.deps import DependencyError, assert_ready

from . import kinds  # noqa: F401  (importing registers the built-in kinds)
from .registry import JobCancelled, JobContext, get_kind

log = logging.getLogger("stemcraft.worker")
POLL_SECONDS = 0.5


def _renew_until(stop: threading.Event, db_path, job_id: int) -> None:
    """A sqlite3.Connection belongs to its creating thread, so the renewer opens
    its own. WAL makes the second writer safe."""
    conn = jobs_db.connect(db_path)
    try:
        while not stop.wait(jobs_db.LEASE_SECONDS / 3):
            jobs_db.renew(conn, job_id)
    finally:
        conn.close()


def run_one(conn: sqlite3.Connection, *, device: str) -> int | None:
    reclaimed = jobs_db.reclaim_expired(conn)
    if reclaimed:
        log.info("reclaimed expired lease(s) for job(s): %s", reclaimed)
    job = jobs_db.claim_next(conn, device=device)
    if job is None:
        return None

    stop = threading.Event()
    db_path = conn.execute("PRAGMA database_list").fetchone()[2]
    renewer = threading.Thread(
        target=_renew_until, args=(stop, db_path, job.id), daemon=True
    )
    renewer.start()
    try:
        fn = get_kind(job.kind)
        result = fn(JobContext(conn=conn, job_id=job.id, payload=job.payload, device=device))
        jobs_db.finish(conn, job.id, result)
        log.info("job %s (%s) done", job.id, job.kind)
    except JobCancelled:
        jobs_db.cancelled(conn, job.id)
        log.info("job %s (%s) cancelled at a checkpoint", job.id, job.kind)
    except Exception:
        # N-08: the real traceback, verbatim, into the row the UI renders.
        jobs_db.fail(conn, job.id, traceback.format_exc())
        log.exception("job %s (%s) failed", job.id, job.kind)
    finally:
        stop.set()
        renewer.join(timeout=5)
    return job.id


def select_device() -> str:
    """Phase 4 replaces this with a CUDA attempt plus a proof-of-work op. The
    API must never learn how this is decided — it only reads the job row."""
    return "cpu"


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    try:
        checks = assert_ready()
    except DependencyError as exc:
        log.error("%s", exc)
        raise SystemExit(1) from exc
    for check in checks:
        log.info("dependency ok: %s (%s)", check.name, check.detail)

    device = select_device()
    conn = jobs_db.connect(settings().jobs_db)
    log.info("worker ready on device=%s, polling %s", device, settings().jobs_db)
    while True:
        if run_one(conn, device=device) is None:
            time.sleep(POLL_SECONDS)
