"""Job kinds register themselves here. A kind is a function of a JobContext
returning a JSON-serializable result.

Every kind must be idempotent by re-derivation (§6): re-running it reproduces
its outputs from inputs that never change. Lease-based crash recovery re-runs
jobs from the start and relies on exactly that.
"""

from __future__ import annotations

import sqlite3
from collections.abc import Callable
from dataclasses import dataclass
from typing import TYPE_CHECKING

from stemcraft_lib import jobs as jobs_db

if TYPE_CHECKING:
    from .device import WorkerState  # noqa: F401 -- typing only, never imported at runtime here


class JobCancelled(Exception):
    """Raised by a kind when it notices ctx.cancelled() at a checkpoint."""


@dataclass
class JobContext:
    conn: sqlite3.Connection
    job_id: int
    payload: dict
    device: str
    worker_state: WorkerState | None = None

    def progress(self, fraction: float) -> None:
        jobs_db.set_progress(self.conn, self.job_id, fraction)

    def cancelled(self) -> bool:
        return jobs_db.is_cancel_requested(self.conn, self.job_id)


JobFn = Callable[[JobContext], dict | None]
KINDS: dict[str, JobFn] = {}


def register(name: str, fn: JobFn) -> None:
    KINDS[name] = fn


def get_kind(name: str) -> JobFn:
    try:
        return KINDS[name]
    except KeyError as exc:
        raise KeyError(f"no registered job kind named {name!r}") from exc
