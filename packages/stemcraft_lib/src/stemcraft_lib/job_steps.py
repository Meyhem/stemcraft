"""Declared steps per job kind (D-17).

Every job kind declares its ordered steps here. jobs.enqueue() seeds them into
the row as `pending`; from then on only the worker advances them, through
JobContext. The functions below are pure: they take a step list and return a
new one, so the rules can be tested without a database and the DB layer only
ever stores what they return.

Torch-free on purpose: the API imports this to seed rows and to serve the
declarations to the SPA (invariant 1).
"""

from __future__ import annotations

import time
from dataclasses import dataclass


class UnknownJobKind(ValueError):
    """Enqueued a kind with no declared steps. N-08: refuse, never guess."""


class StepError(RuntimeError):
    """A kind moved its steps in a way its declaration does not allow."""


@dataclass(frozen=True)
class StepDecl:
    id: str
    label: str
    weight: float


_DECLS: dict[str, tuple[StepDecl, ...]] = {}


def declare(kind: str, steps: list[tuple[str, str, float]]) -> None:
    ids = [step_id for step_id, _, _ in steps]
    if len(set(ids)) != len(ids):
        raise ValueError(f"duplicate step id in {kind!r}: {ids}")
    _DECLS[kind] = tuple(StepDecl(*step) for step in steps)


def all_declarations() -> dict[str, list[dict]]:
    return {
        kind: [{"id": d.id, "label": d.label, "weight": d.weight} for d in decls]
        for kind, decls in _DECLS.items()
    }


def seed(kind: str) -> list[dict]:
    try:
        decls = _DECLS[kind]
    except KeyError:
        raise UnknownJobKind(
            f"no declared steps for job kind {kind!r}; declare it in stemcraft_lib/job_steps.py"
        ) from None
    return [_pending(d.id, d.label, d.weight) for d in decls]


def _pending(step_id: str, label: str, weight: float) -> dict:
    return {
        "id": step_id, "label": label, "weight": weight, "state": "pending",
        "progress": 0.0, "detail": None, "started_at": None, "finished_at": None,
    }


def _copy(steps: list[dict]) -> list[dict]:
    return [dict(step) for step in steps]


def _index(steps: list[dict], step_id: str) -> int:
    for i, step in enumerate(steps):
        if step["id"] == step_id:
            return i
    raise StepError(f"no step {step_id!r}; declared: {[s['id'] for s in steps]}")


def _running(steps: list[dict]) -> dict | None:
    return next((s for s in steps if s["state"] == "running"), None)


def _close(step: dict, state: str, now: float) -> None:
    step["state"] = state
    step["finished_at"] = now
    if state == "done":
        step["progress"] = 1.0


def _open_at(steps: list[dict], step_id: str, now: float) -> tuple[list[dict], int]:
    """Shared by advance() and skip(): close whatever is running, and refuse to
    pass over a step that never ran (a kind must skip it explicitly)."""
    steps = _copy(steps)
    i = _index(steps, step_id)
    if steps[i]["state"] != "pending":
        raise StepError(f"step {step_id!r} is {steps[i]['state']}, not pending")
    for earlier in steps[:i]:
        if earlier["state"] == "running":
            _close(earlier, "done", now)
        elif earlier["state"] == "pending":
            raise StepError(
                f"step {step_id!r} reached while {earlier['id']!r} is still pending; "
                "skip it explicitly"
            )
    return steps, i


def advance(steps: list[dict], step_id: str, *, detail: str | None = None,
            now: float | None = None) -> list[dict]:
    at = time.time() if now is None else now
    steps, i = _open_at(steps, step_id, at)
    steps[i].update(state="running", started_at=at, detail=detail, progress=0.0)
    return steps


def skip(steps: list[dict], step_id: str, reason: str, *, now: float | None = None) -> list[dict]:
    at = time.time() if now is None else now
    steps, i = _open_at(steps, step_id, at)
    steps[i].update(state="skipped", detail=reason, finished_at=at)
    return steps


def set_progress(steps: list[dict], fraction: float) -> list[dict]:
    steps = _copy(steps)
    step = _running(steps)
    if step is None:
        raise StepError("progress reported but no step is running; call ctx.step() first")
    step["progress"] = max(0.0, min(1.0, fraction))
    return steps


def set_detail(steps: list[dict], text: str | None) -> list[dict]:
    steps = _copy(steps)
    step = _running(steps)
    if step is None:
        raise StepError("detail reported but no step is running; call ctx.step() first")
    step["detail"] = text
    return steps


def complete(steps: list[dict], *, now: float | None = None) -> list[dict]:
    at = time.time() if now is None else now
    steps = _copy(steps)
    step = _running(steps)
    if step is not None:
        _close(step, "done", at)
    never_ran = [s["id"] for s in steps if s["state"] == "pending"]
    if never_ran:
        raise StepError(f"job returned but declared step(s) never ran: {', '.join(never_ran)}")
    return steps


def fail_running(steps: list[dict], *, now: float | None = None) -> list[dict]:
    at = time.time() if now is None else now
    steps = _copy(steps)
    step = _running(steps) or next((s for s in steps if s["state"] == "pending"), None)
    if step is not None:
        _close(step, "failed", at)
    return steps


def cancel_running(steps: list[dict], *, now: float | None = None) -> list[dict]:
    at = time.time() if now is None else now
    steps = _copy(steps)
    step = _running(steps)
    if step is not None:
        _close(step, "cancelled", at)
    return steps


def reset(steps: list[dict]) -> list[dict]:
    return [_pending(s["id"], s["label"], s["weight"]) for s in steps]


def overall(steps: list[dict]) -> float | None:
    """The job's single progress number, kept so stats, Library cards and any
    reader of `progress` keep working. Skipped steps leave the denominator."""
    counted = [s for s in steps if s["state"] != "skipped"]
    total = sum(s["weight"] for s in counted)
    if not counted or total <= 0:
        return None
    numerator = sum(
        s["weight"] * (1.0 if s["state"] == "done" else s["progress"])
        for s in counted
    )
    return numerator / total


# ---- declarations ---------------------------------------------------------
# Weights are rough shares of wall time on the reference machine; they only
# shape the single overall bar. Labels are what the UI prints.
declare("import", [
    ("download", "Download", 0.3),
    ("decode", "Decode to 48 kHz", 0.6),
    ("peaks", "Waveform peaks", 0.1),
])
declare("separate", [
    ("load", "Load audio", 0.02),
    ("separate", "Separate 4 stems", 0.9),
    ("write", "Write stems", 0.08),
])
declare("analyze", [
    ("key", "Key", 0.3),
    ("beats", "Beat grid", 0.3),
    ("chords", "Chords", 0.35),
    ("write", "Write analysis", 0.05),
])
declare("export", [("render", "Render & encode", 1.0)])
declare("import_album", [
    ("decode", "Decode to 48 kHz", 0.5),
    ("peaks", "Waveform peaks", 0.3),
    ("silences", "Find silences", 0.2),
])
declare("split_album", [
    ("tracks", "Render tracks", 0.95),
    ("zip", "Build zip", 0.05),
])
declare("probe", [("tick", "Tick", 1.0)])
