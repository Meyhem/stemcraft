"""Job kinds register themselves here. A kind is a function of a JobContext
returning a JSON-serializable result.

Every kind must be idempotent by re-derivation (§6): re-running it reproduces
its outputs from inputs that never change. Lease-based crash recovery re-runs
jobs from the start and relies on exactly that.
"""

from __future__ import annotations

import sqlite3
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import TYPE_CHECKING

from stemcraft_lib import job_steps
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
    # D-17: this job's steps as last written. The worker is their only writer
    # while the job runs, so the in-memory copy is the truth.
    steps: list[dict] = field(default_factory=list)

    def step(self, step_id: str, detail: str | None = None) -> None:
        self._write(job_steps.advance(self.steps, step_id, detail=detail))

    def skip(self, step_id: str, reason: str) -> None:
        self._write(job_steps.skip(self.steps, step_id, reason))

    def detail(self, text: str | None) -> None:
        self._write(job_steps.set_detail(self.steps, text))

    def progress(self, fraction: float) -> None:
        """Progress within the current step. A kind declared with no steps
        (test kinds only) still reports the job's overall progress directly."""
        if not self.steps:
            jobs_db.set_progress(self.conn, self.job_id, fraction)
            return
        self._write(job_steps.set_progress(self.steps, fraction))

    def complete(self) -> None:
        """Called by run_one after the kind returns. Raises StepError if a
        declared step never ran, which fails the job (N-08)."""
        if self.steps:
            self._write(job_steps.complete(self.steps))

    def cancelled(self) -> bool:
        return jobs_db.is_cancel_requested(self.conn, self.job_id)

    def _write(self, steps: list[dict]) -> None:
        self.steps = steps
        jobs_db.set_steps(self.conn, self.job_id, steps)


JobFn = Callable[[JobContext], dict | None]
KINDS: dict[str, JobFn] = {}


def register(name: str, fn: JobFn) -> None:
    KINDS[name] = fn


def get_kind(name: str) -> JobFn:
    try:
        return KINDS[name]
    except KeyError as exc:
        raise KeyError(f"no registered job kind named {name!r}") from exc
