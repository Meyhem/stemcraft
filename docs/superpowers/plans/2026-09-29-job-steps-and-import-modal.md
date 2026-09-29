# Job Steps and Import Modal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every job shows its named steps live: in the Job queue as expandable rows, and in a new Import modal. The Import modal replaces the two-form Import page with one form and one source zone.

**Architecture:** Each job kind declares ordered steps in torch-free `stemcraft_lib/job_steps.py`. `jobs.enqueue()` seeds them into a new `steps` JSON column (jobs schema v2), and only the worker advances them, through `JobContext`. The existing websocket already pushes every job-row change, so the frontend gets steps live for free. One `StepList` component draws them in the Job queue and in the Import modal. The modal is `/import` rendered over a background location (D-14 keeps its route) on a native `<dialog>`.

**Tech Stack:** Python 3.12, SQLite, FastAPI, pytest (`uv run pytest`); React 19, React Router 7, TanStack Query 5, Vitest + RTL (`cd frontend && npx vitest run`), CSS modules over `tokens.css` (D-16).

**Spec:** [docs/superpowers/specs/2026-09-29-job-steps-design.md](../specs/2026-09-29-job-steps-design.md). Decision D-17 in `design/tech-spec-stemcraft.md`.
Mockups: [job steps](../specs/2026-09-29-job-steps-mockup.html) (Job queue, history, modal progress) and [import form](../specs/2026-09-29-import-modal-form-mockup.html) (only frames 1–3 apply; its frames 4–5 are superseded by the job-steps mockup's section 3).

## Global Constraints

- **The API never imports torch.** `job_steps.py` lives in `stemcraft_lib` and imports only the stdlib.
- **One writer per file / column.** The API writes `steps` only inside `enqueue()` (row creation). Every later `steps` write is the worker's.
- **Fail loudly (N-08).** Undeclared kind at enqueue → `UnknownJobKind` (HTTP 422). A step out of order, or a step left pending when a kind returns → `StepError`, and the job fails with that message. No silent fallbacks.
- **Idempotent by re-derivation.** Reclaiming a lease resets every step to `pending`, just as `progress` resets to 0.
- **All file writes atomic.** This feature writes no new files, and SQLite updates are single statements.
- **No Re-run button, no per-step stats, no client-side tag probing** (non-goals in the spec).
- Match surrounding style: module docstrings that explain *why*, cite spec IDs (N-08, D-14, D-17, U-09) in comments where the reason is a spec rule.
- Commit after every task, with the trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Push `main` once, at the end of Task 11, after README upkeep (CLAUDE.md).

---

## File map

| File | Responsibility |
|---|---|
| `packages/stemcraft_lib/src/stemcraft_lib/job_steps.py` (new) | Declarations per kind + pure step transitions (no DB) |
| `packages/stemcraft_lib/src/stemcraft_lib/jobs.py` | Schema v2 + migration, seed at enqueue, `set_steps`, fail/cancel/reclaim touch steps, `song_id` filter |
| `packages/stemcraft_worker/src/stemcraft_worker/registry.py` | `JobContext.step/skip/detail/progress/complete` |
| `packages/stemcraft_worker/src/stemcraft_worker/main.py` | `run_one` passes steps into the context, calls `ctx.complete()` |
| `packages/stemcraft_worker/src/stemcraft_worker/kinds/*.py` | Each kind calls `ctx.step(...)` at its phase boundaries |
| `packages/stemcraft_api/src/stemcraft_api/routes/jobs.py` | `?song_id=`, `GET /api/job-kinds`, 422 on an undeclared kind |
| `frontend/src/api/client.ts`, `queries.ts` | `JobStep`, `StepDecl`, `useSongJobs`, `useJobKinds` |
| `frontend/src/ui/StepList.tsx`, `StepStrip.tsx`, `Modal.tsx` (new) | Shared presentation |
| `frontend/src/screens/JobRow.tsx` (new), `JobQueue.tsx` | Expandable rows, `?song=` filter |
| `frontend/src/screens/import/*` (new) | `ImportModal`, `ImportForm`, `SourceZone`, `ImportProgress`, `pipeline.ts`, `importLink.ts` |
| `frontend/src/app/routes.tsx`, `AppShell.tsx`, `screens/Library.tsx` | Background-location routing and links |
| `design/ui/src/pages/screens/import.html`, `job-queue.html` | Design-system mockups brought in line |
| `README.md`, `docs/screenshots/job-queue.png`, `docs/screenshots/import.png` (new) | README upkeep |

---

### Task 1: Step declarations and pure transitions (`job_steps.py`)

**Files:**
- Create: `packages/stemcraft_lib/src/stemcraft_lib/job_steps.py`
- Test: `packages/stemcraft_lib/tests/test_job_steps.py`

**Interfaces:**
- Produces:
  - `class UnknownJobKind(ValueError)`, `class StepError(RuntimeError)`
  - `declare(kind: str, steps: list[tuple[str, str, float]]) -> None`
  - `all_declarations() -> dict[str, list[dict]]` — `{kind: [{"id","label","weight"}]}`
  - `seed(kind: str) -> list[dict]` — raises `UnknownJobKind`
  - `advance(steps, step_id, *, detail=None, now=None) -> list[dict]`
  - `skip(steps, step_id, reason: str, *, now=None) -> list[dict]`
  - `set_progress(steps, fraction: float) -> list[dict]`
  - `set_detail(steps, text: str | None) -> list[dict]`
  - `complete(steps, *, now=None) -> list[dict]`
  - `fail_running(steps, *, now=None) -> list[dict]`
  - `cancel_running(steps, *, now=None) -> list[dict]`
  - `reset(steps) -> list[dict]`
  - `overall(steps) -> float | None`
  - A step dict has exactly these keys: `id, label, weight, state, progress, detail, started_at, finished_at`.
  - Every function returns a **new** list and never mutates its input.

- [ ] **Step 1: Write the failing tests**

```python
# packages/stemcraft_lib/tests/test_job_steps.py
import pytest
from stemcraft_lib import job_steps
from stemcraft_lib.job_steps import StepError, UnknownJobKind


def states(steps):
    return [(s["id"], s["state"]) for s in steps]


@pytest.fixture
def three():
    job_steps.declare("t_three", [("a", "A", 0.5), ("b", "B", 0.25), ("c", "C", 0.25)])
    return job_steps.seed("t_three")


def test_seed_writes_every_declared_step_pending(three):
    assert states(three) == [("a", "pending"), ("b", "pending"), ("c", "pending")]
    assert three[0] == {
        "id": "a", "label": "A", "weight": 0.5, "state": "pending", "progress": 0.0,
        "detail": None, "started_at": None, "finished_at": None,
    }


def test_seed_refuses_an_undeclared_kind():
    with pytest.raises(UnknownJobKind, match="t_nobody_declared_this"):
        job_steps.seed("t_nobody_declared_this")


def test_every_built_in_kind_is_declared_with_at_least_one_step():
    for kind in ("import", "separate", "analyze", "export", "import_album", "split_album", "probe"):
        assert job_steps.seed(kind), kind


def test_duplicate_step_ids_are_refused():
    with pytest.raises(ValueError, match="duplicate"):
        job_steps.declare("t_dup", [("a", "A", 1.0), ("a", "A again", 1.0)])


def test_advance_closes_the_running_step_and_opens_the_next(three):
    s = job_steps.advance(three, "a", now=10.0)
    s = job_steps.advance(s, "b", detail="1 of 2", now=12.5)
    assert states(s) == [("a", "done"), ("b", "running"), ("c", "pending")]
    assert s[0]["finished_at"] == 12.5 and s[0]["progress"] == 1.0
    assert s[1]["started_at"] == 12.5 and s[1]["detail"] == "1 of 2"


def test_advance_does_not_mutate_its_input(three):
    job_steps.advance(three, "a")
    assert states(three)[0] == ("a", "pending")


def test_advancing_past_a_pending_step_is_an_error(three):
    with pytest.raises(StepError, match="'a' is still pending"):
        job_steps.advance(three, "b")


def test_going_backwards_is_an_error(three):
    s = job_steps.advance(job_steps.advance(three, "a"), "b")
    with pytest.raises(StepError, match="not pending"):
        job_steps.advance(s, "a")


def test_an_unknown_step_id_is_an_error(three):
    with pytest.raises(StepError, match="no step 'z'"):
        job_steps.advance(three, "z")


def test_skip_records_the_reason_and_lets_the_next_step_start(three):
    s = job_steps.skip(three, "a", "uploaded file", now=3.0)
    s = job_steps.advance(s, "b")
    assert states(s)[:2] == [("a", "skipped"), ("b", "running")]
    assert s[0]["detail"] == "uploaded file" and s[0]["finished_at"] == 3.0


def test_progress_and_detail_apply_to_the_running_step(three):
    s = job_steps.set_progress(job_steps.advance(three, "a"), 0.4)
    s = job_steps.set_detail(s, "segment 3 of 7")
    assert s[0]["progress"] == 0.4 and s[0]["detail"] == "segment 3 of 7"


def test_progress_is_clamped(three):
    s = job_steps.advance(three, "a")
    assert job_steps.set_progress(s, 7)[0]["progress"] == 1.0
    assert job_steps.set_progress(s, -1)[0]["progress"] == 0.0


def test_progress_with_nothing_running_is_an_error(three):
    with pytest.raises(StepError, match="no step is running"):
        job_steps.set_progress(three, 0.5)


def test_overall_is_the_weighted_mean(three):
    s = job_steps.set_progress(job_steps.advance(three, "a"), 0.5)
    assert job_steps.overall(s) == pytest.approx(0.25)
    s = job_steps.set_progress(job_steps.advance(s, "b"), 0.5)
    assert job_steps.overall(s) == pytest.approx(0.625)


def test_skipped_steps_leave_the_denominator(three):
    s = job_steps.skip(three, "a", "not needed")
    s = job_steps.set_progress(job_steps.advance(s, "b"), 1.0)
    assert job_steps.overall(s) == pytest.approx(0.5)


def test_overall_of_no_steps_is_none():
    assert job_steps.overall([]) is None


def test_complete_closes_the_running_step(three):
    s = job_steps.advance(job_steps.advance(job_steps.advance(three, "a"), "b"), "c")
    assert states(job_steps.complete(s)) == [("a", "done"), ("b", "done"), ("c", "done")]


def test_complete_with_a_step_still_pending_is_an_error(three):
    with pytest.raises(StepError, match="never ran: c"):
        job_steps.complete(job_steps.advance(job_steps.advance(three, "a"), "b"))


def test_fail_marks_the_running_step(three):
    s = job_steps.fail_running(job_steps.advance(three, "a"), now=9.0)
    assert states(s)[0] == ("a", "failed") and s[0]["finished_at"] == 9.0


def test_fail_before_any_step_ran_lands_on_the_first_pending_step(three):
    # A kind that fails its own preconditions (no song dir, bad payload) fails
    # before its first ctx.step(). The error still needs a step to sit under.
    assert states(job_steps.fail_running(three))[0] == ("a", "failed")


def test_cancel_marks_the_running_step_and_keeps_its_detail(three):
    s = job_steps.set_detail(job_steps.advance(three, "a"), "4 of 11 rendered")
    s = job_steps.cancel_running(s)
    assert states(s)[0] == ("a", "cancelled") and s[0]["detail"] == "4 of 11 rendered"


def test_cancel_with_nothing_running_changes_nothing(three):
    assert job_steps.cancel_running(three) == three


def test_reset_returns_every_step_to_pending(three):
    s = job_steps.fail_running(job_steps.skip(three, "a", "x"))
    assert job_steps.reset(s) == job_steps.seed("t_three")


def test_all_declarations_lists_ids_labels_and_weights():
    decls = job_steps.all_declarations()
    assert decls["import"] == [
        {"id": "download", "label": "Download", "weight": 0.3},
        {"id": "decode", "label": "Decode to 48 kHz", "weight": 0.6},
        {"id": "peaks", "label": "Waveform peaks", "weight": 0.1},
    ]
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `uv run pytest packages/stemcraft_lib/tests/test_job_steps.py -q`
Expected: collection error, `ModuleNotFoundError: No module named 'stemcraft_lib.job_steps'`.

- [ ] **Step 3: Implement `job_steps.py`**

```python
# packages/stemcraft_lib/src/stemcraft_lib/job_steps.py
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
    return sum(s["weight"] * (1.0 if s["state"] == "done" else s["progress"]) for s in counted) / total


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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `uv run pytest packages/stemcraft_lib/tests/test_job_steps.py -q`
Expected: all pass.

- [ ] **Step 5: Lint and commit**

```bash
uv run ruff check packages/stemcraft_lib
git add packages/stemcraft_lib/src/stemcraft_lib/job_steps.py packages/stemcraft_lib/tests/test_job_steps.py
git commit -m "feat(jobs): declared steps per job kind and their pure transitions (D-17)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Steps on the job row (`jobs.py`, schema v2)

**Files:**
- Modify: `packages/stemcraft_lib/src/stemcraft_lib/jobs.py` (SCHEMA, `JOBS_SCHEMA_VERSION`, `Job`, `_row_to_job`, `connect`, `enqueue`, `list_jobs`, `fail`, `cancelled`, `reclaim_expired`; add `set_steps`)
- Test: `packages/stemcraft_lib/tests/test_jobs_schema.py`, `packages/stemcraft_lib/tests/test_jobs_lease.py`, new `packages/stemcraft_lib/tests/test_jobs_steps.py`

**Interfaces:**
- Consumes: `job_steps.seed`, `fail_running`, `cancel_running`, `reset`, `overall`, `UnknownJobKind` (Task 1).
- Produces:
  - `Job.steps: list[dict]` (`[]` for rows written before v2)
  - `JOBS_SCHEMA_VERSION = 2`
  - `enqueue(...)` raises `UnknownJobKind` for undeclared kinds
  - `set_steps(conn, job_id, steps: list[dict]) -> None`, which also stores `progress = overall(steps)` when that isn't `None`, and only while `state = 'running'`
  - `list_jobs(conn, *, states=None, song_id: str | None = None, limit=200)`

- [ ] **Step 1: Write the failing tests**

Edit `test_jobs_schema.py`: add `"steps"` to the column set in `test_schema_has_every_documented_column`, and change the version assertion in `test_a_fresh_database_is_stamped_with_the_current_schema_version` to `== JOBS_SCHEMA_VERSION == 2`. Then create `test_jobs_steps.py`:

```python
# packages/stemcraft_lib/tests/test_jobs_steps.py
import sqlite3

import pytest
from stemcraft_lib import job_steps
from stemcraft_lib.job_steps import UnknownJobKind
from stemcraft_lib.jobs import (
    JOBS_SCHEMA_VERSION,
    JobsSchemaError,
    cancelled,
    claim_next,
    connect,
    enqueue,
    fail,
    get_job,
    list_jobs,
    reclaim_expired,
    request_cancel,
    set_steps,
)


def states(job):
    return [(s["id"], s["state"]) for s in job.steps]


def test_enqueue_seeds_the_declared_steps_as_pending(tmp_path):
    conn = connect(tmp_path / "j.sqlite")
    job = get_job(conn, enqueue(conn, kind="import", song_id="s1"))
    assert states(job) == [("download", "pending"), ("decode", "pending"), ("peaks", "pending")]


def test_enqueue_refuses_an_undeclared_kind_and_writes_no_row(tmp_path):
    conn = connect(tmp_path / "j.sqlite")
    with pytest.raises(UnknownJobKind):
        enqueue(conn, kind="t_never_declared")
    assert list_jobs(conn) == []


def test_set_steps_stores_steps_and_the_weighted_progress(tmp_path):
    conn = connect(tmp_path / "j.sqlite")
    job_id = enqueue(conn, kind="import")
    job = claim_next(conn, device="cpu")
    steps = job_steps.skip(job.steps, "download", "uploaded file")
    steps = job_steps.set_progress(job_steps.advance(steps, "decode"), 0.5)
    set_steps(conn, job_id, steps)
    stored = get_job(conn, job_id)
    assert states(stored)[:2] == [("download", "skipped"), ("decode", "running")]
    assert stored.progress == pytest.approx(0.6 * 0.5 / 0.7)


def test_set_steps_is_ignored_once_the_job_is_no_longer_running(tmp_path):
    conn = connect(tmp_path / "j.sqlite")
    job_id = enqueue(conn, kind="probe")
    set_steps(conn, job_id, job_steps.advance(get_job(conn, job_id).steps, "tick"))
    assert states(get_job(conn, job_id)) == [("tick", "pending")]


def test_fail_marks_the_running_step_failed(tmp_path):
    conn = connect(tmp_path / "j.sqlite")
    job_id = enqueue(conn, kind="probe")
    job = claim_next(conn, device="cpu")
    set_steps(conn, job_id, job_steps.advance(job.steps, "tick"))
    fail(conn, job_id, "Traceback...\nRuntimeError: boom")
    assert states(get_job(conn, job_id)) == [("tick", "failed")]


def test_cancelled_marks_the_running_step_cancelled(tmp_path):
    conn = connect(tmp_path / "j.sqlite")
    job_id = enqueue(conn, kind="probe")
    job = claim_next(conn, device="cpu")
    set_steps(conn, job_id, job_steps.advance(job.steps, "tick"))
    cancelled(conn, job_id)
    assert states(get_job(conn, job_id)) == [("tick", "cancelled")]


def test_a_queued_cancel_leaves_the_steps_pending(tmp_path):
    conn = connect(tmp_path / "j.sqlite")
    job_id = enqueue(conn, kind="probe")
    request_cancel(conn, job_id)
    assert states(get_job(conn, job_id)) == [("tick", "pending")]


def test_reclaim_resets_the_steps_with_the_progress(tmp_path):
    conn = connect(tmp_path / "j.sqlite")
    job_id = enqueue(conn, kind="import")
    job = claim_next(conn, device="cpu", lease_seconds=-1)
    set_steps(conn, job_id, job_steps.advance(job_steps.skip(job.steps, "download", "x"), "decode"))
    assert reclaim_expired(conn) == [job_id]
    requeued = get_job(conn, job_id)
    assert requeued.steps == job_steps.seed("import")
    assert requeued.progress == 0


def test_list_jobs_filters_by_song(tmp_path):
    conn = connect(tmp_path / "j.sqlite")
    mine = enqueue(conn, kind="import", song_id="s1")
    enqueue(conn, kind="import", song_id="s2")
    assert [j.id for j in list_jobs(conn, song_id="s1")] == [mine]


def test_a_v1_database_is_migrated_and_its_old_rows_have_no_steps(tmp_path):
    path = tmp_path / "j.sqlite"
    old = sqlite3.connect(path)
    old.executescript(
        "CREATE TABLE jobs (id INTEGER PRIMARY KEY, song_id TEXT, kind TEXT, payload TEXT,"
        " state TEXT, cancel_requested INTEGER DEFAULT 0, progress REAL DEFAULT 0,"
        " device TEXT, lease_until REAL, created_at REAL, started_at REAL,"
        " finished_at REAL, error TEXT, result TEXT);"
        "INSERT INTO jobs (kind, payload, state, progress) VALUES ('separate', '{}', 'done', 1);"
        "PRAGMA user_version = 1;"
    )
    old.close()

    conn = connect(path)
    assert conn.execute("PRAGMA user_version").fetchone()[0] == JOBS_SCHEMA_VERSION == 2
    assert list_jobs(conn)[0].steps == []
    assert states(get_job(conn, enqueue(conn, kind="probe"))) == [("tick", "pending")]


def test_a_v3_database_is_still_refused(tmp_path):
    path = tmp_path / "j.sqlite"
    setup = sqlite3.connect(path)
    setup.execute("PRAGMA user_version = 3")
    setup.close()
    with pytest.raises(JobsSchemaError):
        connect(path)
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `uv run pytest packages/stemcraft_lib/tests/test_jobs_steps.py packages/stemcraft_lib/tests/test_jobs_schema.py -q`
Expected: FAIL with `ImportError: cannot import name 'set_steps'`.

- [ ] **Step 3: Implement**

In `jobs.py`:

1. Import: `from . import job_steps`.
2. SCHEMA: after `result           TEXT` add `,\n  steps            TEXT`, so the table's last column is `steps TEXT` (a JSON list, D-17).
3. Replace the version constant and `connect()`'s migration block:

```python
JOBS_SCHEMA_VERSION = 2

# v2 (D-17): `steps`, the job kind's declared steps and their live states.
_MIGRATIONS = {
    2: "ALTER TABLE jobs ADD COLUMN steps TEXT",
}
```

```python
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
```

4. `Job` gains a last field `steps: list[dict]`, and `_row_to_job` sets `steps=json.loads(row["steps"]) if row["steps"] else []`.
5. `enqueue()`:

```python
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
```

6. `list_jobs()`:

```python
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
```

7. Add `set_steps` after `set_progress`, plus a private reader:

```python
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
```

8. `fail()` and `cancelled()` also write the closed steps:

```python
def fail(conn: sqlite3.Connection, job_id: int, error: str) -> None:
    # N-08: the real message and traceback, kept verbatim for the Job Queue view,
    # and the step it happened in marked failed so the UI can draw it there.
    steps = job_steps.fail_running(_steps_of(conn, job_id))
    conn.execute(
        "UPDATE jobs SET state = 'failed', finished_at = ?, lease_until = NULL, error = ?, "
        "steps = ? WHERE id = ? AND state = 'running'",
        (time.time(), error, json.dumps(steps), job_id),
    )
```

```python
def cancelled(conn: sqlite3.Connection, job_id: int) -> None:
    steps = job_steps.cancel_running(_steps_of(conn, job_id))
    conn.execute(
        "UPDATE jobs SET state = 'cancelled', finished_at = ?, lease_until = NULL, steps = ? "
        "WHERE id = ? AND state = 'running'",
        (time.time(), json.dumps(steps), job_id),
    )
```

9. `reclaim_expired()` resets steps in the same statement. SQLite has no JSON reset, so add `RETURNING id, steps` and then write the reset lists:

```python
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
```

- [ ] **Step 4: Run the whole lib suite**

Run: `uv run pytest packages/stemcraft_lib -q`
Expected: all pass. If a lib test enqueues a kind that isn't declared, it now raises `UnknownJobKind`. Declare that kind at the top of the test module with `job_steps.declare("<kind>", [])`, and never weaken `enqueue`.

- [ ] **Step 5: Commit**

```bash
uv run ruff check packages/stemcraft_lib
git add packages/stemcraft_lib
git commit -m "feat(jobs): steps column (schema v2), seeded at enqueue, closed on fail/cancel, reset on reclaim

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: The worker's step API (`JobContext`, `run_one`)

**Files:**
- Modify: `packages/stemcraft_worker/src/stemcraft_worker/registry.py`, `packages/stemcraft_worker/src/stemcraft_worker/main.py:52-72`, `packages/stemcraft_worker/src/stemcraft_worker/kinds/probe.py`
- Test: `packages/stemcraft_worker/tests/test_worker_loop.py`

**Interfaces:**
- Consumes: `jobs_db.set_steps`, `Job.steps` (Task 2), and `job_steps.advance/skip/set_progress/set_detail/complete/declare` (Task 1).
- Produces these `JobContext` members. Kinds in Tasks 4–5 call them.
  - `steps: list[dict]`
  - `step(step_id, detail=None)`, `skip(step_id, reason)`, `detail(text)`
  - `progress(fraction)`: within the current step, or the job's overall progress for a kind declared with no steps
  - `complete()`: called by `run_one`, never by kinds

- [ ] **Step 1: Write the failing tests**

In `test_worker_loop.py`:
1. Add `from stemcraft_lib import job_steps`.
2. Put a `job_steps.declare("<name>", [])` line before each existing `register("t_…", …)`: `t_ok`, `t_progress`, `t_cancel`, `t_boom`, `t_renew`, `t_reclaim_log`, `t_no_reclaim_log`. An empty declaration keeps these tests about the loop, not about steps.
3. In `test_unknown_kind_fails_loudly_instead_of_being_skipped`, add `job_steps.declare("t_does_not_exist", [])` before its `enqueue`. The kind is declared but has no registered function, which is still the thing under test.
4. Append:

```python
def _states(job):
    return [(s["id"], s["state"]) for s in job.steps]


def test_steps_advance_live_and_close_when_the_kind_returns(conn):
    seen = []
    job_steps.declare("t_steps", [("one", "One", 1.0), ("two", "Two", 1.0)])

    def kind(ctx: JobContext) -> None:
        ctx.step("one")
        ctx.progress(0.5)
        seen.append((_states(get_job(ctx.conn, ctx.job_id)), get_job(ctx.conn, ctx.job_id).progress))
        ctx.step("two", detail="half way")

    register("t_steps", kind)
    job_id = enqueue(conn, kind="t_steps")
    run_one(conn, device="cpu")

    assert seen == [([("one", "running"), ("two", "pending")], 0.25)]
    done = get_job(conn, job_id)
    assert done.state == "done"
    assert _states(done) == [("one", "done"), ("two", "done")]


def test_a_kind_that_forgets_a_step_fails_naming_it(conn):
    job_steps.declare("t_forgot", [("one", "One", 1.0), ("two", "Two", 1.0)])
    register("t_forgot", lambda ctx: ctx.step("one"))
    job_id = enqueue(conn, kind="t_forgot")
    run_one(conn, device="cpu")
    failed = get_job(conn, job_id)
    assert failed.state == "failed"
    assert "never ran: two" in failed.error


def test_an_exception_marks_the_step_it_happened_in(conn):
    job_steps.declare("t_step_boom", [("one", "One", 1.0), ("two", "Two", 1.0)])

    def kind(ctx: JobContext) -> None:
        ctx.step("one")
        ctx.step("two")
        raise RuntimeError("boom in two")

    register("t_step_boom", kind)
    job_id = enqueue(conn, kind="t_step_boom")
    run_one(conn, device="cpu")
    assert _states(get_job(conn, job_id)) == [("one", "done"), ("two", "failed")]


def test_a_cancel_marks_the_step_it_stopped_in(conn):
    job_steps.declare("t_step_cancel", [("one", "One", 1.0)])

    def kind(ctx: JobContext) -> None:
        ctx.step("one")
        ctx.detail("3 of 9")
        raise JobCancelled

    register("t_step_cancel", kind)
    job_id = enqueue(conn, kind="t_step_cancel")
    run_one(conn, device="cpu")
    job = get_job(conn, job_id)
    assert job.state == "cancelled"
    assert _states(job) == [("one", "cancelled")] and job.steps[0]["detail"] == "3 of 9"


def test_probe_reports_its_tick_step(conn):
    import stemcraft_worker.kinds.probe  # noqa: F401

    job_id = enqueue(conn, kind="probe", payload={"steps": 2, "step_seconds": 0.01})
    run_one(conn, device="cpu")
    assert _states(get_job(conn, job_id)) == [("tick", "done")]
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `uv run pytest packages/stemcraft_worker/tests/test_worker_loop.py -q`
Expected: the new tests fail with `AttributeError: 'JobContext' object has no attribute 'step'`.

- [ ] **Step 3: Implement**

`registry.py`: replace the `JobContext` class (keep its imports; add `from dataclasses import dataclass, field` if `field` is missing, and `from stemcraft_lib import job_steps`):

```python
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
```

If `JobContext` is currently `@dataclass(frozen=True)`, drop `frozen`: `_write` reassigns `steps`.

`main.py`, inside `run_one`: build the context before the call and complete it after:

```python
        fn = get_kind(job.kind)
        ctx = JobContext(
            conn=conn,
            job_id=job.id,
            payload=job.payload,
            device=device,
            worker_state=worker_state,
            steps=job.steps,
        )
        result = fn(ctx)
        # D-17: close the last step; a declared step that never ran is a bug in
        # the kind and fails the job here rather than finishing it.
        ctx.complete()
        jobs_db.finish(conn, job.id, result)
```

`kinds/probe.py`: call `ctx.step("tick")` before the loop. The loop body stays the same: `ctx.progress((index + 1) / steps)` is now progress within the tick step.

- [ ] **Step 4: Run the worker loop tests**

Run: `uv run pytest packages/stemcraft_worker/tests/test_worker_loop.py -q`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add packages/stemcraft_worker
git commit -m "feat(worker): JobContext.step/skip/detail; run_one closes steps and fails a kind that skips one

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Instrument the song kinds (import, separate, analyze)

**Files:**
- Modify: `packages/stemcraft_worker/src/stemcraft_worker/kinds/import_song.py`, `separate_song.py`, `analyze_song.py`
- Test: `packages/stemcraft_worker/tests/test_import_song.py`, `test_separate_song.py`, `test_analyze_song.py`

**Interfaces:**
- Consumes: the `ctx.step/skip/detail/progress` methods (Task 3) and the declarations (Task 1).
- Produces: after a successful run, `import` for an upload → `[download skipped ("uploaded file"), decode done, peaks done]`, `import` for a URL → all three done, `separate` → `load, separate, write` done, `analyze` → `key, beats, chords, write` done.

- [ ] **Step 1: Write the failing tests** (append one test per file; they reuse each file's existing fixtures and helpers)

`test_import_song.py`:

```python
def test_an_upload_import_skips_download_and_runs_the_rest(conn, songs_dir):
    song = new_song(title="T", artist="A", source_kind="upload", source_value="original.mp3")
    song_dir = create_song_dir(songs_dir, song)
    _fixture_mp3(song_dir / "original.mp3")

    job_id = enqueue(conn, kind="import", song_id=song.id, payload={"song_id": song.id})
    run_one(conn, device="cpu")

    steps = get_job(conn, job_id).steps
    assert [(s["id"], s["state"]) for s in steps] == [
        ("download", "skipped"), ("decode", "done"), ("peaks", "done"),
    ]
    assert steps[0]["detail"] == "uploaded file"


def test_an_import_for_a_missing_song_fails_on_its_first_step(conn, songs_dir):
    job_id = enqueue(conn, kind="import", song_id="nope", payload={"song_id": "nope"})
    run_one(conn, device="cpu")
    job = get_job(conn, job_id)
    assert job.state == "failed"
    assert job.steps[0]["state"] == "failed"
```

In the existing `test_url_source_downloads_then_decodes`, add at its end:
`assert [s["state"] for s in get_job(conn, job_id).steps] == ["done", "done", "done"]`.

`test_separate_song.py`:

```python
def test_separate_records_load_separate_and_write_steps(conn, songs_dir, worker_state):
    song, _ = _make_song(songs_dir)
    job_id = enqueue(conn, kind="separate", song_id=song.id, payload={"song_id": song.id})
    run_one(conn, device="cpu", worker_state=worker_state)
    steps = get_job(conn, job_id).steps
    assert [(s["id"], s["state"]) for s in steps] == [
        ("load", "done"), ("separate", "done"), ("write", "done"),
    ]
    assert steps[2]["detail"] == "other (4 of 4)"
```

Also append to `test_cancel_mid_separation_lands_as_cancelled_not_failed`:
`assert [s["state"] for s in cancelled.steps] == ["done", "cancelled", "pending"]`.

`test_analyze_song.py` (uses the file's own `_make_analyzable_song` helper and fixtures):

```python
def test_analyze_records_its_four_steps(conn, songs_dir, data_dir):
    song, _ = _make_analyzable_song(songs_dir)
    job_id = enqueue(conn, kind="analyze", song_id=song.id, payload={"song_id": song.id})
    run_one(conn, device="cpu")
    assert [(s["id"], s["state"]) for s in get_job(conn, job_id).steps] == [
        ("key", "done"), ("beats", "done"), ("chords", "done"), ("write", "done"),
    ]
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `uv run pytest packages/stemcraft_worker/tests/test_import_song.py packages/stemcraft_worker/tests/test_separate_song.py packages/stemcraft_worker/tests/test_analyze_song.py -q`
Expected: the new assertions fail. Every kind now ends with `StepError: ... never ran: ...` and state `failed`, because no kind calls `ctx.step` yet. This also shows why Task 3's `complete()` check exists.

- [ ] **Step 3: Instrument the kinds**

`import_song.py`, replacing the body from `original = _existing_original(song_dir)` to the peaks write:

```python
    original = _existing_original(song_dir)
    if original is None:
        if song.source.kind != "url":
            raise RuntimeError(
                f"song {song.id} has no original.* on disk and its source is not a url"
            )
        ctx.step("download")
        original = ytdlp.download(song.source.value, song_dir)
    else:
        # A retry after a crash finds the download already on disk (§6).
        ctx.skip("download", "uploaded file" if song.source.kind != "url" else "already downloaded")
    if ctx.cancelled():
        raise JobCancelled

    ctx.step("decode")
    audio_wav = song_dir / "audio.wav"
    ffmpeg.decode_to_wav(original, audio_wav, sample_rate=SAMPLE_RATE)
    if ctx.cancelled():
        raise JobCancelled

    ctx.step("peaks")
    atomic_write_json(song_dir / "peaks.json", peaks_module.compute_peaks(audio_wav))
```

Remove the three `ctx.progress(...)` calls. The chaining `enqueue` of `separate` and the `return` stay as they are.

`separate_song.py`:
- Put `ctx.step("load")` immediately before `wav_tensor = _load_wav_tensor(audio_wav)`.
- Put `ctx.step("separate")` immediately before `separator.update_parameter(...)`.
- In `on_progress`, replace `ctx.progress(min(0.95, ...))` with `ctx.progress(info["segment_offset"] / info["audio_length"])`.
- Replace the stem loop so it reports which stem it is writing:

```python
    ctx.step("write")
    stems_dir = song_dir / "stems"
    near_silent: dict[str, bool] = {}
    for index, name in enumerate(STEM_NAMES):
        ctx.detail(f"{name} ({index + 1} of {len(STEM_NAMES)})")
        stem_tensor = stems[name]
        near_silent[name] = float(stem_tensor.abs().max()) < NEAR_SILENT_THRESHOLD
        wav_path = stems_dir / f"{name}.wav"
        _write_stem_wav(stem_tensor, separator.samplerate, wav_path)
        ffmpeg.encode_opus(wav_path, stems_dir / f"{name}.opus")
        ctx.progress((index + 1) / len(STEM_NAMES))
```

- Delete the trailing `ctx.progress(1.0)`.

`analyze_song.py`:
- Put `ctx.step("key")` before `detect_key(`, `ctx.step("beats")` before `detect_beats(`, `ctx.step("chords")` before `recognize_frames(`, and `ctx.step("write")` before `analysis = Analysis(`.
- Delete every `ctx.progress(...)` call in the kind: 0.3, 0.6, 0.95 and 1.0.

- [ ] **Step 4: Run the tests**

Run: `uv run pytest packages/stemcraft_worker/tests/test_import_song.py packages/stemcraft_worker/tests/test_separate_song.py packages/stemcraft_worker/tests/test_analyze_song.py -q`
Expected: all pass, including the pre-existing tests.

- [ ] **Step 5: Commit**

```bash
git add packages/stemcraft_worker
git commit -m "feat(worker): import, separate and analyze report their named steps

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Instrument export, import_album and split_album

**Files:**
- Modify: `packages/stemcraft_worker/src/stemcraft_worker/kinds/export_song.py`, `import_album.py`, `split_album.py`
- Test: `packages/stemcraft_worker/tests/test_export_song.py`, `test_import_album.py`, `test_split_album.py`, and a new `packages/stemcraft_worker/tests/test_kinds_declared.py`

**Interfaces:**
- Consumes: Task 3's context API.
- Produces: final steps of `export` → `render` done; `import_album` → `decode, peaks, silences` done; `split_album` → `tracks, zip` done, with `tracks` detail `"N of N rendered"`.

- [ ] **Step 1: Write the failing tests**

`test_kinds_declared.py`:

```python
import stemcraft_worker.kinds  # noqa: F401  (registers every built-in kind)
from stemcraft_lib import job_steps
from stemcraft_worker.registry import KINDS


def test_every_registered_kind_declares_at_least_one_step():
    # D-17: a kind the UI cannot draw steps for is a bug, not a quiet default.
    builtin = {k for k in KINDS if not k.startswith("t_")}
    decls = job_steps.all_declarations()
    missing = sorted(k for k in builtin if not decls.get(k))
    assert missing == []
```

Append to the existing success tests:
- In `test_export_writes_the_mp3_and_reports_its_real_duration`, add at the end: `assert [(s["id"], s["state"]) for s in get_job(conn, job_id).steps] == [("render", "done")]`. Use the local variable names that test already has for the connection and the job id.
- In `test_import_album_writes_the_three_worker_owned_files`: `assert [(s["id"], s["state"]) for s in get_job(conn, job_id).steps] == [("decode", "done"), ("peaks", "done"), ("silences", "done")]`.
- In `test_split_renders_every_track_and_the_zip`: `steps = get_job(conn, job_id).steps`, then `assert [(s["id"], s["state"]) for s in steps] == [("tracks", "done"), ("zip", "done")]`, then `assert steps[0]["detail"].endswith("rendered")`.
- In `test_a_cancel_between_tracks_stops_the_render_and_writes_no_zip`: `assert [s["state"] for s in get_job(conn, job_id).steps] == ["cancelled", "pending"]`.

If `get_job` isn't imported in one of those files, add `from stemcraft_lib.jobs import get_job`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `uv run pytest packages/stemcraft_worker/tests/test_export_song.py packages/stemcraft_worker/tests/test_import_album.py packages/stemcraft_worker/tests/test_split_album.py packages/stemcraft_worker/tests/test_kinds_declared.py -q`
Expected: the step assertions fail (jobs end `failed` with `never ran`). `test_kinds_declared` passes already, because Task 1 declared every kind; it's a guard for future kinds.

- [ ] **Step 3: Instrument**

`export_song.py`: put `ctx.step("render")` immediately before `source_seconds = ffmpeg.probe(...)`. Keep `on_progress`'s `ctx.progress(min(0.99, fraction))`, which is now within the render step. Delete the trailing `ctx.progress(1.0)`.

`import_album.py`:
- Put `ctx.step("decode")` before `ffmpeg.decode_to_wav(`.
- Put `ctx.step("peaks")` before the `atomic_write_json(album_dir / "peaks.json", ...)` block. Leave its long comment in place, directly above the write.
- Put `ctx.step("silences")` before `split_points = silence.detect_split_points(`.
- Delete the `ctx.progress(0.5)`, `(0.8)` and `(1.0)` calls.

`split_album.py`:
- Put `ctx.step("tracks")` immediately before `tracks_dir(album_dir).mkdir(...)`.
- In the loop, replace `ctx.progress(min(0.95, (index + 1) / (total + 1)))` with:

```python
        ctx.detail(f"{index + 1} of {total} rendered")
        ctx.progress((index + 1) / total)
```

- Put `ctx.step("zip")` immediately before the stale-track sweep (the `keep = {...}` line), because the sweep is part of producing the final directory.
- Delete the trailing `ctx.progress(1.0)`.

- [ ] **Step 4: Run the whole worker suite**

Run: `uv run pytest packages/stemcraft_worker -q`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add packages/stemcraft_worker
git commit -m "feat(worker): export and album kinds report their named steps

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: API: song filter, job-kinds, 422 on an undeclared kind

**Files:**
- Modify: `packages/stemcraft_api/src/stemcraft_api/routes/jobs.py`
- Test: `packages/stemcraft_api/tests/test_api.py` (append)

**Interfaces:**
- Consumes: `jobs_db.list_jobs(song_id=)`, `job_steps.all_declarations`, `UnknownJobKind`.
- Produces for the SPA (Task 7):
  - `GET /api/jobs?song_id=<id>` → `{"jobs": Job[]}`, where every job carries `steps`
  - `GET /api/job-kinds` → `{"kinds": {kind: [{id, label, weight}]}}`
  - `POST /api/jobs` with an undeclared kind → 422 `{"detail": "<UnknownJobKind message>"}`

- [ ] **Step 1: Write the failing tests** (append to `test_api.py`; it already has the `client` fixture)

```python
def test_jobs_carry_their_seeded_steps(client):
    client.post("/api/jobs", json={"kind": "probe"})
    job = client.get("/api/jobs").json()["jobs"][0]
    assert [(s["id"], s["state"]) for s in job["steps"]] == [("tick", "pending")]


def test_jobs_can_be_filtered_by_song(client):
    mine = client.post("/api/jobs", json={"kind": "probe", "song_id": "s1"}).json()["id"]
    client.post("/api/jobs", json={"kind": "probe", "song_id": "s2"})
    jobs = client.get("/api/jobs", params={"song_id": "s1"}).json()["jobs"]
    assert [j["id"] for j in jobs] == [mine]


def test_job_kinds_lists_the_declared_steps(client):
    kinds = client.get("/api/job-kinds").json()["kinds"]
    assert [s["id"] for s in kinds["analyze"]] == ["key", "beats", "chords", "write"]
    assert kinds["export"] == [{"id": "render", "label": "Render & encode", "weight": 1.0}]


def test_enqueuing_an_undeclared_kind_is_a_422_naming_it(client):
    response = client.post("/api/jobs", json={"kind": "nonsense"})
    assert response.status_code == 422
    assert "nonsense" in response.json()["detail"]
    assert client.get("/api/jobs").json()["jobs"] == []
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `uv run pytest packages/stemcraft_api/tests/test_api.py -q -k "steps or song or job_kinds or undeclared"`
Expected: `/api/job-kinds` returns 404, the song filter is ignored, and the undeclared kind returns 500.

- [ ] **Step 3: Implement** (in `routes/jobs.py`)

```python
from stemcraft_lib import job_steps
from stemcraft_lib.job_steps import UnknownJobKind
```

```python
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
```

```python
@router.post("/api/jobs", status_code=201)
def enqueue_job(body: EnqueueRequest, conn: Conn) -> dict:
    try:
        job_id = jobs_db.enqueue(conn, kind=body.kind, song_id=body.song_id, payload=body.payload)
    except UnknownJobKind as exc:
        # N-08: the real reason, not a generic 500.
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return {"id": job_id}
```

- [ ] **Step 4: Run the whole Python suite**

Run: `uv run pytest -q`
Expected: all pass, including `test_the_api_never_imports_torch` and `test_ws.py`. The websocket snapshot uses `asdict(job)`, so it now carries `steps` with no change to `ws.py`.

- [ ] **Step 5: Commit**

```bash
uv run ruff check packages
git add packages/stemcraft_api
git commit -m "feat(api): jobs filterable by song, GET /api/job-kinds, 422 for an undeclared kind

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Frontend types, queries, `StepList` and `StepStrip`

**Files:**
- Modify: `frontend/src/api/client.ts` (after the `JobState` type and in `interface Job`), `frontend/src/api/queries.ts`, `frontend/src/ui/index.ts`
- Create: `frontend/src/ui/StepList.tsx`, `StepList.module.css`, `StepList.test.tsx`, `StepStrip.tsx`, `StepStrip.module.css`

**Interfaces:**
- Produces:
  - `type StepState = 'pending' | 'running' | 'done' | 'failed' | 'skipped' | 'cancelled'`
  - `interface JobStep { id; label; weight; state: StepState; progress: number; detail: string | null; started_at: number | null; finished_at: number | null }`
  - `Job.steps: JobStep[]`
  - `interface StepDecl { id: string; label: string; weight: number }`
  - `pendingStep(decl: StepDecl): JobStep` (exported from `client.ts`)
  - `queryKeys.songJobs(songId)` = `['jobs', 'song', songId]`, under the `['jobs']` prefix the job stream invalidates
  - `useSongJobs(songId: string | undefined)`
  - `useJobKinds()` → `Record<string, StepDecl[]>`
  - `<StepList steps error? />`: an `<ol aria-label="Steps">`; each `<li>` has `data-state` and an accessible name `"<label>: <state>"`
  - `<StepStrip steps />`: `role="img"` labelled `"<done> of <n> steps done"`

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/src/ui/StepList.test.tsx
import { render, screen, within } from '@testing-library/react';
import { expect, test } from 'vitest';

import type { JobStep } from '../api/client';
import { StepList } from './StepList';
import { StepStrip } from './StepStrip';

function step(over: Partial<JobStep>): JobStep {
  return {
    id: 'x', label: 'X', weight: 1, state: 'pending', progress: 0,
    detail: null, started_at: null, finished_at: null, ...over,
  };
}

const steps: JobStep[] = [
  step({ id: 'download', label: 'Download', state: 'skipped', detail: 'uploaded file', finished_at: 1 }),
  step({ id: 'decode', label: 'Decode to 48 kHz', state: 'done', started_at: 1, finished_at: 7.1 }),
  step({ id: 'separate', label: 'Separate 4 stems', state: 'running', progress: 0.62, detail: 'segment 11 of 17', started_at: 8 }),
  step({ id: 'write', label: 'Write stems', state: 'pending' }),
];

test('every step says its label and state', () => {
  render(<StepList steps={steps} />);
  const list = within(screen.getByRole('list', { name: 'Steps' }));
  expect(list.getByRole('listitem', { name: 'Download: skipped' })).toBeInTheDocument();
  expect(list.getByRole('listitem', { name: 'Decode to 48 kHz: done' })).toBeInTheDocument();
  expect(list.getByRole('listitem', { name: 'Separate 4 stems: running' })).toBeInTheDocument();
  expect(list.getByRole('listitem', { name: 'Write stems: pending' })).toBeInTheDocument();
});

test('a done step shows its duration, a skipped one its reason, the running one its live percent and bar', () => {
  render(<StepList steps={steps} />);
  expect(screen.getByText('6.1 s')).toBeInTheDocument();
  expect(screen.getByText('skipped · uploaded file')).toBeInTheDocument();
  expect(screen.getByText('62%')).toBeInTheDocument();
  expect(screen.getByText('segment 11 of 17')).toBeInTheDocument();
  expect(screen.getByRole('progressbar', { name: 'Separate 4 stems progress' })).toHaveAttribute('aria-valuenow', '62');
});

test("the job's real error sits under the failed step", () => {
  render(
    <StepList
      steps={[step({ id: 'key', label: 'Key', state: 'failed', started_at: 1, finished_at: 1.6 })]}
      error={'Traceback...\nRuntimeError: frame too short'}
    />,
  );
  const failed = screen.getByRole('listitem', { name: 'Key: failed' });
  expect(within(failed).getByText(/RuntimeError: frame too short/)).toBeInTheDocument();
});

test('the strip summarises how many steps are done', () => {
  render(<StepStrip steps={steps} />);
  expect(screen.getByRole('img', { name: '1 of 4 steps done' })).toBeInTheDocument();
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && npx vitest run src/ui/StepList.test.tsx`
Expected: FAIL, because `./StepList` can't be resolved.

- [ ] **Step 3: Implement**

`client.ts`, directly after `export type JobState = ...`:

```ts
// D-17: mirrors stemcraft_lib/job_steps.py. Seeded at enqueue, advanced only by the worker.
export type StepState = 'pending' | 'running' | 'done' | 'failed' | 'skipped' | 'cancelled';

export interface JobStep {
  id: string;
  label: string;
  weight: number;
  state: StepState;
  progress: number;
  detail: string | null;
  started_at: number | null;
  finished_at: number | null;
}

export interface StepDecl {
  id: string;
  label: string;
  weight: number;
}

/** A declared step drawn before its job exists (the Import modal's later groups). */
export function pendingStep(decl: StepDecl): JobStep {
  return { ...decl, state: 'pending', progress: 0, detail: null, started_at: null, finished_at: null };
}
```

Add `steps: JobStep[];` as the last field of `interface Job`.

`queries.ts`: add `type StepDecl` to the `./client` import list, and extend `queryKeys` and the hooks:

```ts
export const queryKeys = {
  health: ['health'] as const,
  songs: ['songs'] as const,
  jobs: (active: boolean) => ['jobs', active] as const,
  // Under ['jobs', ...] so the job stream's prefix invalidation refreshes it live.
  songJobs: (songId: string | undefined) => ['jobs', 'song', songId] as const,
  jobKinds: ['job-kinds'] as const,
  exports: (songId: string | undefined) => ['exports', songId] as const,
};
```

```ts
export function useSongJobs(songId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.songJobs(songId),
    queryFn: () => api.get<{ jobs: Job[] }>(`/api/jobs?song_id=${encodeURIComponent(songId!)}`),
    select: (data) => data.jobs,
    enabled: songId !== undefined,
  });
}

export function useJobKinds() {
  return useQuery({
    queryKey: queryKeys.jobKinds,
    queryFn: () => api.get<{ kinds: Record<string, StepDecl[]> }>('/api/job-kinds'),
    select: (data) => data.kinds,
    // Declarations change only with a deploy.
    staleTime: Infinity,
  });
}
```

`ui/StepList.tsx`:

```tsx
// D-17: one step vocabulary for the Job queue and the Import modal. The marks
// mean the same everywhere: ✓ done, ● running, ○ pending, ! failed, – skipped, ■ cancelled.
import type { JobStep } from '../api/client';
import { Banner } from './Banner';
import { ProgressBar } from './ProgressBar';
import styles from './StepList.module.css';

export interface StepListProps {
  steps: JobStep[];
  /** The job's error. U-09: drawn verbatim under the failed step. */
  error?: string | null;
}

function mark(step: JobStep, index: number): string {
  switch (step.state) {
    case 'done':
      return '✓';
    case 'failed':
      return '!';
    case 'skipped':
      return '–';
    case 'cancelled':
      return '■';
    default:
      return String(index + 1);
  }
}

function aside(step: JobStep): string {
  if (step.state === 'running') return `${Math.round(step.progress * 100)}%`;
  if (step.state === 'skipped') return step.detail ? `skipped · ${step.detail}` : 'skipped';
  if (step.started_at !== null && step.finished_at !== null) {
    return `${(step.finished_at - step.started_at).toFixed(1)} s`;
  }
  return '—';
}

export function StepList({ steps, error }: StepListProps) {
  return (
    <ol className={styles.list} aria-label="Steps">
      {steps.map((step, index) => (
        <li
          key={step.id}
          className={styles.step}
          data-state={step.state}
          aria-label={`${step.label}: ${step.state}`}
        >
          <span className={styles.mark} aria-hidden="true">
            {mark(step, index)}
          </span>
          <span className={styles.label}>
            {step.label}
            {step.detail && step.state !== 'skipped' && <span className={styles.detail}>{step.detail}</span>}
          </span>
          <span className={styles.aside}>{aside(step)}</span>
          {step.state === 'running' && (
            <div className={styles.extra}>
              <ProgressBar value={step.progress} label={`${step.label} progress`} />
            </div>
          )}
          {step.state === 'failed' && error && (
            <div className={styles.extra}>
              <Banner tone="error" trace={error} />
            </div>
          )}
        </li>
      ))}
    </ol>
  );
}
```

`ui/StepList.module.css` (ported from the mockup's `.steps`/`.step`):

```css
/* D-17 step list. Ported from the job-steps mockup's .step. */
.list {
  display: flex;
  flex-direction: column;
  gap: var(--ds-3);
  margin: 0;
  padding: 0;
  list-style: none;
}

.step {
  display: grid;
  grid-template-columns: 24px 1fr auto;
  column-gap: var(--ds-3);
  align-items: start;
  font-size: var(--ds-t-sm);
  line-height: var(--ds-lh-sm);
}

.mark {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  border: 2px solid var(--ds-border-strong);
  display: flex;
  align-items: center;
  justify-content: center;
  font: 700 13px/1 var(--ds-mono);
  color: var(--ds-text-3);
}

.label {
  min-width: 0;
  color: var(--ds-text-3);
}

.detail {
  margin-left: var(--ds-2);
  font-family: var(--ds-mono);
  color: var(--ds-text-3);
  font-weight: 400;
}

.aside {
  font-family: var(--ds-mono);
  font-variant-numeric: tabular-nums;
  color: var(--ds-text-3);
}

.extra {
  grid-column: 2 / 4;
  margin-top: var(--ds-2);
}

.step[data-state='done'] .mark { background: var(--ds-ok); border-color: var(--ds-ok); color: var(--ds-ground); }
.step[data-state='done'] .label { color: var(--ds-text-2); }
.step[data-state='running'] .mark { border-color: var(--ds-accent); color: var(--ds-accent); }
.step[data-state='running'] .label { color: var(--ds-text); font-weight: 600; }
.step[data-state='running'] .aside { color: var(--ds-accent); }
.step[data-state='failed'] .mark { background: var(--ds-error); border-color: var(--ds-error); color: var(--ds-on-error); }
.step[data-state='failed'] .label { color: var(--ds-error); font-weight: 600; }
.step[data-state='skipped'] .mark { border-style: dashed; }
.step[data-state='skipped'] .label { text-decoration: line-through; }
```

`ui/StepStrip.tsx`:

```tsx
import type { JobStep } from '../api/client';
import styles from './StepStrip.module.css';

/** The step list drawn small, for a collapsed job row. */
export function StepStrip({ steps }: { steps: JobStep[] }) {
  const done = steps.filter((s) => s.state === 'done' || s.state === 'skipped').length;
  return (
    <span className={styles.strip} role="img" aria-label={`${done} of ${steps.length} steps done`}>
      {steps.map((step) => (
        <i key={step.id} data-state={step.state} />
      ))}
    </span>
  );
}
```

`ui/StepStrip.module.css`:

```css
.strip { display: inline-flex; gap: 3px; vertical-align: middle; }
.strip i { width: 14px; height: 4px; border-radius: 2px; background: var(--ds-border-strong); }
.strip i[data-state='done'] { background: var(--ds-ok); }
.strip i[data-state='running'] { background: var(--ds-accent); }
.strip i[data-state='failed'] { background: var(--ds-error); }
```

`ui/index.ts`, appended:

```ts
export { StepList } from './StepList';
export type { StepListProps } from './StepList';
export { StepStrip } from './StepStrip';
```

- [ ] **Step 4: Run the test and typecheck**

Run: `cd frontend && npx vitest run src/ui/StepList.test.tsx && npx tsc --noEmit`
Expected: the tests pass. `tsc` reports missing `steps` in existing test fixtures (`JobQueue.test.tsx` and others typed as `Job`). Add `steps: []` to each such fixture object until `tsc` is clean. Don't make `steps` optional.

- [ ] **Step 5: Commit**

```bash
cd frontend && npx vitest run && cd ..
git add frontend/src
git commit -m "feat(ui): StepList and StepStrip, job step types and song/kinds queries (D-17)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Job queue rows with steps, and the `?song=` filter

**Files:**
- Create: `frontend/src/screens/JobRow.tsx`, `frontend/src/screens/JobRow.module.css`
- Modify: `frontend/src/screens/JobQueue.tsx`, `frontend/src/screens/JobQueue.module.css`, `frontend/src/screens/JobQueue.test.tsx`

**Interfaces:**
- Consumes: `StepList`, `StepStrip`, `useSongJobs` (Task 7), and the existing `Chip`, `jobStateTone`, `ProgressBar`, `Button`, `Banner`, `TextLink`, `useJobs`, `useCancelJob`.
- Produces:
  - `/jobs?song=<id>` shows only that song's jobs, all expanded, with a "Show all jobs" link. Task 10's "Open job queue" link targets this.
  - Each row is an `<li>` in `<ul aria-label="Jobs">`, with a disclosure button whose `aria-expanded` reflects its state and whose accessible name is `Steps of <kind> job <id>`.

- [ ] **Step 1: Update the tests** (`JobQueue.test.tsx`)

1. Add `steps: []` to the base `job` fixture.
2. Wrap the render in a router: import `MemoryRouter` from `react-router-dom`, change the helper to `function renderQueue(jobs: unknown[], path = '/jobs')`, and render `<MemoryRouter initialEntries={[path]}><JobQueue /></MemoryRouter>` inside the `QueryClientProvider`.
3. The chip-tone test currently scopes with `screen.findByRole('table')`. Change that to `screen.findByRole('list', { name: 'Jobs' })`.
4. Append:

```tsx
const running = {
  ...job,
  kind: 'separate',
  steps: [
    { id: 'load', label: 'Load audio', weight: 0.02, state: 'done', progress: 1, detail: null, started_at: 2, finished_at: 2.4 },
    { id: 'separate', label: 'Separate 4 stems', weight: 0.9, state: 'running', progress: 0.62, detail: null, started_at: 2.4, finished_at: null },
    { id: 'write', label: 'Write stems', weight: 0.08, state: 'pending', progress: 0, detail: null, started_at: null, finished_at: null },
  ],
};

test('the running job opens on its steps; a queued one is collapsed with a strip', async () => {
  renderQueue([running, { ...running, id: 8, state: 'queued', steps: running.steps.map((s) => ({ ...s, state: 'pending' })) }]);
  const open = await screen.findByRole('button', { name: 'Steps of separate job 7' });
  expect(open).toHaveAttribute('aria-expanded', 'true');
  expect(screen.getByRole('listitem', { name: 'Separate 4 stems: running' })).toBeInTheDocument();
  expect(screen.getByText(/step 2 of 3/)).toBeInTheDocument();

  const closed = screen.getByRole('button', { name: 'Steps of separate job 8' });
  expect(closed).toHaveAttribute('aria-expanded', 'false');
  expect(screen.getByRole('img', { name: '0 of 3 steps done' })).toBeInTheDocument();

  await userEvent.click(closed);
  expect(closed).toHaveAttribute('aria-expanded', 'true');
});

test("a failed job opens with its traceback under the failed step", async () => {
  renderQueue([{
    ...job, id: 9, kind: 'analyze', state: 'failed', error: 'Traceback...\nRuntimeError: frame too short',
    steps: [{ id: 'key', label: 'Key', weight: 0.3, state: 'failed', progress: 0, detail: null, started_at: 1, finished_at: 1.6 }],
  }]);
  const step = await screen.findByRole('listitem', { name: 'Key: failed' });
  expect(within(step).getByText(/RuntimeError: frame too short/)).toBeInTheDocument();
  expect(screen.getByText(/failed at step 1 of 1 · Key/)).toBeInTheDocument();
});

test('a job from before step tracking says so when opened', async () => {
  renderQueue([{ ...job, state: 'done', progress: 1 }]);
  await userEvent.click(await screen.findByRole('button', { name: 'Steps of probe job 7' }));
  expect(screen.getByText(/no step record/i)).toBeInTheDocument();
});

test('?song= lists only that song and links back to every job', async () => {
  const fetchMock = renderQueue([running], '/jobs?song=s1');
  expect(await screen.findByRole('link', { name: /show all jobs/i })).toHaveAttribute('href', '/jobs');
  expect(fetchMock).toHaveBeenCalledWith('/api/jobs?song_id=s1', expect.anything());
});
```

The existing test `shows the real error text for a failed job` keeps passing: a failed row is open by default and draws its error, inline under the failed step or under "No step record".

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && npx vitest run src/screens/JobQueue.test.tsx`
Expected: the new tests fail (no disclosure buttons, no list named "Jobs").

- [ ] **Step 3: Implement**

`screens/JobRow.tsx`:

```tsx
// §10 + D-17: one job, one row. Running and failed rows open on their steps by
// default, so a traceback is never hidden behind a click (N-08).
import { useId, useState } from 'react';

import type { Job } from '../api/client';
import { Banner, Button, Chip, ProgressBar, StepList, StepStrip, jobStateTone } from '../ui';
import styles from './JobRow.module.css';

function duration(job: Job): string {
  if (job.started_at === null) return '—';
  const end = job.finished_at ?? Date.now() / 1000;
  return `${(end - job.started_at).toFixed(1)} s`;
}

function summary(job: Job): string | null {
  const n = job.steps.length;
  const failed = job.steps.findIndex((s) => s.state === 'failed');
  if (failed >= 0) return `failed at step ${failed + 1} of ${n} · ${job.steps[failed]!.label}`;
  const running = job.steps.findIndex((s) => s.state === 'running');
  if (running >= 0) return `step ${running + 1} of ${n} · ${Math.round(job.progress * 100)}% overall`;
  return null;
}

export interface JobRowProps {
  job: Job;
  defaultOpen?: boolean;
  onCancel: () => void;
}

export function JobRow({ job, defaultOpen, onCancel }: JobRowProps) {
  const [open, setOpen] = useState(defaultOpen ?? (job.state === 'running' || job.state === 'failed'));
  const bodyId = useId();
  const line = summary(job);

  return (
    <li className={styles.row} data-state={job.state}>
      <div className={styles.head}>
        <button
          type="button"
          className={styles.disclosure}
          aria-expanded={open}
          aria-controls={bodyId}
          aria-label={`Steps of ${job.kind} job ${job.id}`}
          onClick={() => setOpen((value) => !value)}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M9 6l6 6-6 6-1.4-1.4 4.6-4.6-4.6-4.6z" />
          </svg>
        </button>
        <Chip tone={jobStateTone(job.state)} dot>
          {job.state}
        </Chip>
        <div className={styles.main}>
          <div className={styles.title}>
            <span className={styles.kind}>{job.kind}</span>
            {job.device ? <Chip>{job.device}</Chip> : <span className="dim3">—</span>}
          </div>
          {job.state === 'running' && <ProgressBar value={job.progress} label={`${job.kind} progress`} />}
          <span className={styles.meta} data-failed={job.state === 'failed'}>
            {/* U-04: a ticking duration must not jitter. */}
            {[line, duration(job)].filter(Boolean).join(' · ')}
            {!open && job.steps.length > 0 && <StepStrip steps={job.steps} />}
          </span>
        </div>
        {(job.state === 'queued' || job.state === 'running') && (
          <Button variant="danger" onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>
      {open && (
        <div id={bodyId} className={styles.body}>
          {job.steps.length > 0 ? (
            <StepList steps={job.steps} error={job.error} />
          ) : (
            <>
              <p className={styles.none}>No step record. This job ran before step tracking existed.</p>
              {job.error && <Banner tone="error" title={`${job.kind} job ${job.id} failed`} trace={job.error} />}
            </>
          )}
        </div>
      )}
    </li>
  );
}
```

`screens/JobRow.module.css`:

```css
.row { border-bottom: 1px solid var(--ds-border); }
.row:last-child { border-bottom: 0; }
.row[data-state='running'] { background: color-mix(in srgb, var(--ds-accent) 5%, transparent); }

.head {
  display: grid;
  grid-template-columns: 28px 112px 1fr auto;
  gap: var(--ds-4);
  align-items: center;
  padding: var(--ds-4);
}

.disclosure {
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: var(--ds-r-input);
  background: transparent;
  color: var(--ds-text-2);
  cursor: pointer;
}

.disclosure svg { width: 18px; height: 18px; fill: currentColor; transition: transform var(--ds-m-flip) var(--ds-ease); }
.disclosure[aria-expanded='true'] svg { transform: rotate(90deg); }

.main { display: flex; flex-direction: column; gap: var(--ds-2); min-width: 0; }
.title { display: flex; align-items: center; gap: var(--ds-3); }
.kind { font-size: var(--ds-t-md); font-weight: 600; }

.meta {
  display: flex;
  align-items: center;
  gap: var(--ds-2);
  font: 400 var(--ds-t-sm) / var(--ds-lh-sm) var(--ds-mono);
  font-variant-numeric: tabular-nums;
  color: var(--ds-text-2);
}
.meta[data-failed='true'] { color: var(--ds-error); }

/* Steps line up under the title column: disclosure + chip + two gaps. */
.body { padding: 0 var(--ds-4) var(--ds-5) calc(var(--ds-4) + 28px + 112px + 2 * var(--ds-4)); }
.none { margin: 0 0 var(--ds-3); font-size: var(--ds-t-sm); color: var(--ds-text-3); }

@media (max-width: 760px) {
  .head { grid-template-columns: 28px 1fr auto; }
  .head > :nth-child(2) { display: none; }
  .body { padding-left: var(--ds-4); }
}
```

`screens/JobQueue.tsx`: replace the table and the error-banner block (everything between the empty state and `<JobStats />`), and pick the source by the query string:

```tsx
import { useSearchParams } from 'react-router-dom';

import { useCancelJob, useEnqueueProbe, useJobs, useSongJobs } from '../api/queries';
import { Banner, Button, EmptyState, TextLink } from '../ui';
import { JobRow } from './JobRow';
import { JobStats } from './JobStats';
import styles from './JobQueue.module.css';

export function JobQueue() {
  const [params] = useSearchParams();
  const songId = params.get('song') ?? undefined;
  const allJobs = useJobs();
  const songJobs = useSongJobs(songId);
  const jobs = songId ? songJobs : allJobs;
  const cancel = useCancelJob();
  const probe = useEnqueueProbe();

  return (
    <section className={styles.screen}>
      <div className={styles.header}>
        <h1>Job queue</h1>
        <Button onClick={() => probe.mutate()}>Enqueue probe job</Button>
      </div>

      {songId && (
        <p className={styles.filter}>
          Showing one song's jobs. <TextLink to="/jobs">Show all jobs</TextLink>
        </p>
      )}

      {jobs.isError && (
        <Banner tone="error" title="The queue could not be listed" trace={String(jobs.error)} />
      )}

      {jobs.data?.length === 0 && <EmptyState title="No jobs yet." />}

      {jobs.data && jobs.data.length > 0 && (
        <ul className={styles.list} aria-label="Jobs">
          {jobs.data.map((job) => (
            <JobRow
              key={job.id}
              job={job}
              defaultOpen={songId ? true : undefined}
              onCancel={() => cancel.mutate(job.id)}
            />
          ))}
        </ul>
      )}

      {/* Mockup order: live queue first, all-time stats below. */}
      <JobStats />
    </section>
  );
}
```

Keep the file's top comment. Update it to say that tracebacks now sit under their failed step (D-17).

`JobQueue.module.css`: delete `.progressHead` and `.actions`, then add:

```css
.list {
  margin: 0;
  padding: 0;
  list-style: none;
  background: var(--ds-surface);
  border: 1px solid var(--ds-border);
  border-radius: var(--ds-r-panel);
  overflow: hidden;
}

.filter { margin: 0; font-size: var(--ds-t-sm); color: var(--ds-text-2); }
```

- [ ] **Step 4: Run the tests**

Run: `cd frontend && npx vitest run src/screens/JobQueue.test.tsx && npx tsc --noEmit`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/screens
git commit -m "feat(ui): job queue rows open on their live steps; ?song= filter

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Modal primitive, background routing, and the one-source Import form

**Files:**
- Create: `frontend/src/ui/Modal.tsx`, `frontend/src/ui/Modal.module.css`, `frontend/src/ui/Modal.test.tsx`
- Create: `frontend/src/screens/import/importLink.ts`, `ImportModal.tsx`, `ImportForm.tsx`, `ImportForm.module.css`, `SourceZone.tsx`, `SourceZone.module.css`, `ImportForm.test.tsx`
- Modify: `frontend/src/setupTests.ts`, `frontend/src/ui/index.ts`, `frontend/src/app/routes.tsx`, `frontend/src/app/routes.test.tsx`, `frontend/src/app/AppShell.tsx`, `frontend/src/screens/Library.tsx`
- Delete: `frontend/src/screens/Import.tsx`, `Import.module.css`, `Import.test.tsx`

**Interfaces:**
- Consumes: the `useCreateSongFromUpload` and `useCreateSongFromUrl` mutations (return `CreatedSong { song, job_id }`), `DropZone`, `TextField`, `Banner`, `Button`.
- Produces:
  - `<Modal title subtitle? onClose footer? children>`: a native `<dialog>` opened with `showModal()`. Esc (the `cancel` event) and a click on the backdrop call `onClose`. The ✕ button's name is `Close`.
  - `importLinkState(location: Location): { background: Location }`
  - `interface CreatedImport { songId: string; jobId: number; title: string; artist: string; source: string }` (exported from `ImportForm.tsx`)
  - `<ImportForm onCreated(created: CreatedImport) onClose />`
  - `<ImportModal />` (Task 10 adds the progress view to it)

- [ ] **Step 1: Write the failing tests**

`setupTests.ts`, appended:

```ts
// jsdom 25 has HTMLDialogElement but no showModal/close. The Modal only needs
// the open attribute toggled and a close event, which is what browsers do.
if (!HTMLDialogElement.prototype.showModal) {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.removeAttribute('open');
    this.dispatchEvent(new Event('close'));
  };
}
```

`ui/Modal.test.tsx`:

```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';

import { Modal } from './Modal';

test('opens as a modal dialog named by its title', () => {
  render(<Modal title="Add song" onClose={() => {}}>body</Modal>);
  expect(screen.getByRole('dialog', { name: 'Add song' })).toHaveAttribute('open');
});

test('the close button, Esc and a backdrop click all close it', async () => {
  const onClose = vi.fn();
  render(<Modal title="Add song" onClose={onClose}><p>body</p></Modal>);
  const dialog = screen.getByRole('dialog');

  await userEvent.click(screen.getByRole('button', { name: 'Close' }));
  fireEvent(dialog, new Event('cancel', { cancelable: true }));
  fireEvent.click(dialog);
  expect(onClose).toHaveBeenCalledTimes(3);

  fireEvent.click(screen.getByText('body'));
  expect(onClose).toHaveBeenCalledTimes(3);
});
```

`screens/import/ImportForm.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';

import { ImportForm } from './ImportForm';

function renderForm(fetchImpl: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>) {
  const fetchMock = vi.fn(fetchImpl);
  vi.stubGlobal('fetch', fetchMock);
  const onCreated = vi.fn();
  const onClose = vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ImportForm onCreated={onCreated} onClose={onClose} />
    </QueryClientProvider>,
  );
  return { fetchMock, onCreated, onClose };
}

const created = (id: string, jobId: number, title: string) =>
  new Response(JSON.stringify({ song: { id, title, artist: 'Band' }, job_id: jobId }), { status: 201 });

afterEach(() => vi.unstubAllGlobals());

test('a chosen file uploads as multipart and reports the created song', async () => {
  const { fetchMock, onCreated } = renderForm(async () => created('s1', 1, 'From Tags'));
  const file = new File(['bytes'], 'tightrope.flac', { type: 'audio/flac' });

  await userEvent.upload(screen.getByLabelText(/audio or video file/i), file);
  await userEvent.click(screen.getByRole('button', { name: /import & separate/i }));

  await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/songs/upload', expect.anything()));
  const form = (fetchMock.mock.calls[0]![1] as RequestInit).body as FormData;
  expect(form.get('file')).toBe(file);
  expect(form.get('title')).toBeNull();
  await waitFor(() =>
    expect(onCreated).toHaveBeenCalledWith({ songId: 's1', jobId: 1, title: 'From Tags', artist: 'Band', source: 'tightrope.flac' }),
  );
});

test('a chosen file collapses the zone to a row; Replace brings it back', async () => {
  renderForm(async () => created('s1', 1, 'T'));
  await userEvent.upload(screen.getByLabelText(/audio or video file/i), new File(['b'], 'a.mp3'));
  expect(screen.getByText(/a\.mp3/)).toBeInTheDocument();
  expect(screen.queryByLabelText(/^link$/i)).not.toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: /replace/i }));
  expect(screen.getByLabelText(/audio or video file/i)).toBeInTheDocument();
  expect(screen.getByLabelText(/^link$/i)).toBeInTheDocument();
});

test('a link posts json and needs a title; the file is cleared', async () => {
  const { fetchMock } = renderForm(async () => created('s2', 2, 'URL Song'));
  const submit = screen.getByRole('button', { name: /import & separate/i });

  await userEvent.type(screen.getByLabelText(/^link$/i), 'https://example.com/v');
  expect(submit).toBeDisabled();
  expect(screen.getByLabelText(/^title/i)).toBeRequired();
  expect(screen.getByText(/no tags to read before it's downloaded/i)).toBeInTheDocument();

  await userEvent.type(screen.getByLabelText(/^title/i), 'URL Song');
  await userEvent.type(screen.getByLabelText(/^artist$/i), 'Band');
  await userEvent.click(submit);

  await waitFor(() =>
    expect(fetchMock).toHaveBeenCalledWith('/api/songs/from-url', expect.objectContaining({ method: 'POST' })),
  );
  const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string);
  expect(body).toEqual({ url: 'https://example.com/v', title: 'URL Song', artist: 'Band' });
});

test('choosing a file after typing a link clears the link', async () => {
  renderForm(async () => created('s1', 1, 'T'));
  await userEvent.type(screen.getByLabelText(/^link$/i), 'https://example.com/v');
  await userEvent.upload(screen.getByLabelText(/audio or video file/i), new File(['b'], 'a.mp3'));
  await userEvent.click(screen.getByRole('button', { name: /replace/i }));
  expect(screen.getByLabelText(/^link$/i)).toHaveValue('');
});

test('nothing chosen means nothing to submit', () => {
  renderForm(async () => created('s1', 1, 'T'));
  expect(screen.getByRole('button', { name: /import & separate/i })).toBeDisabled();
});

test("a rejected upload shows the server's real message and stays open", async () => {
  const { onCreated } = renderForm(async () => new Response('ffmpeg: invalid data found', { status: 400 }));
  await userEvent.upload(screen.getByLabelText(/audio or video file/i), new File(['x'], 'bad.mp3'));
  await userEvent.click(screen.getByRole('button', { name: /import & separate/i }));
  expect(await screen.findByText(/ffmpeg: invalid data found/)).toBeInTheDocument();
  expect(onCreated).not.toHaveBeenCalled();
});

test('Cancel closes', async () => {
  const { onClose } = renderForm(async () => created('s1', 1, 'T'));
  await userEvent.click(screen.getByRole('button', { name: /^cancel$/i }));
  expect(onClose).toHaveBeenCalled();
});
```

`routes.test.tsx`: remove the `['/import', /import/i]` row from the `test.each` table, and add:

```tsx
test('/import opened directly shows the Add song dialog over the library', async () => {
  renderAt('/import');
  expect(await screen.findByRole('dialog', { name: 'Add song' })).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: /library/i })).toBeInTheDocument();
});
```

The Add-song form makes no requests until it's submitted, so `renderAt`'s fetch mock needs no new URL.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && npx vitest run src/ui/Modal.test.tsx src/screens/import src/app/routes.test.tsx`
Expected: module-not-found for `Modal` and `ImportForm`, and the route test finds no dialog.

- [ ] **Step 3: Implement**

`ui/Modal.tsx`:

```tsx
// Q-05, answered for dialogs: the native <dialog> with showModal() gives the
// focus trap, Esc and an inert page underneath with no library. U-08: the one
// surface allowed a shadow.
import { useEffect, useId, useRef, type ReactNode } from 'react';

import styles from './Modal.module.css';

export interface ModalProps {
  title: ReactNode;
  subtitle?: ReactNode;
  onClose: () => void;
  footer?: ReactNode;
  children: ReactNode;
}

export function Modal({ title, subtitle, onClose, footer, children }: ModalProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current!;
    if (!dialog.open) dialog.showModal();
    return () => {
      if (dialog.open) dialog.close();
    };
  }, []);

  return (
    <dialog
      ref={ref}
      className={styles.dialog}
      aria-labelledby={titleId}
      onCancel={(event) => {
        // Esc. The route owns open/closed, so the dialog must not close itself.
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        // The panel fills the dialog's box, so a click whose target is the
        // dialog itself landed on the ::backdrop.
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className={styles.panel}>
        <header className={styles.head}>
          <div className={styles.titles}>
            <h2 id={titleId} className={styles.title}>
              {title}
            </h2>
            {subtitle && <p className={styles.subtitle}>{subtitle}</p>}
          </div>
          <button type="button" className={styles.close} aria-label="Close" onClick={onClose}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M19 6.4L17.6 5 12 10.6 6.4 5 5 6.4 10.6 12 5 17.6 6.4 19 12 13.4 17.6 19 19 17.6 13.4 12z" />
            </svg>
          </button>
        </header>
        <div className={styles.body}>{children}</div>
        {footer && <footer className={styles.foot}>{footer}</footer>}
      </div>
    </dialog>
  );
}
```

`ui/Modal.module.css` (ported from the design system's `.scrim`/`.modal*`):

```css
.dialog {
  width: min(620px, calc(100% - 2 * var(--ds-4)));
  max-height: calc(100% - 2 * var(--ds-7));
  margin: var(--ds-7) auto auto;
  padding: 0;
  border: 1px solid var(--ds-border-strong);
  border-radius: var(--ds-r-panel);
  background: var(--ds-surface);
  color: var(--ds-text);
  box-shadow: var(--ds-shadow-overlay);
}
.dialog::backdrop { background: rgb(5 6 8 / 0.72); }

.panel { display: flex; flex-direction: column; }
.head { display: flex; align-items: center; justify-content: space-between; gap: var(--ds-4); padding: var(--ds-5); border-bottom: 1px solid var(--ds-border); }
.titles { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.title { margin: 0; font-size: var(--ds-t-lg); line-height: var(--ds-lh-lg); font-weight: 600; }
.subtitle { margin: 0; font-size: var(--ds-t-sm); color: var(--ds-text-2); }

.close {
  width: var(--ds-hit-setup);
  height: var(--ds-hit-setup);
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--ds-border-strong);
  border-radius: var(--ds-r-btn);
  background: var(--ds-raised);
  color: var(--ds-text-2);
  cursor: pointer;
}
.close:hover { background: var(--ds-overlay); color: var(--ds-text); }
.close svg { width: 20px; height: 20px; fill: currentColor; }

.body { display: flex; flex-direction: column; gap: var(--ds-5); padding: var(--ds-5); overflow-y: auto; }
.foot { display: flex; justify-content: flex-end; align-items: center; gap: var(--ds-3); padding: var(--ds-4) var(--ds-5); border-top: 1px solid var(--ds-border); background: var(--ds-raised); }
```

`ui/index.ts`, appended: `export { Modal } from './Modal';` and `export type { ModalProps } from './Modal';`.

`screens/import/importLink.ts`:

```ts
import type { Location } from 'react-router-dom';

// D-14 keeps /import a route; it renders as a modal over whatever page linked
// to it. Links pass that page along as the background location.
export interface ImportLinkState {
  background: Location;
}

export function importLinkState(location: Location): ImportLinkState {
  return { background: location };
}
```

`screens/import/SourceZone.tsx`:

```tsx
// Domain spec, "Import": one source, a file or a link. The last one given wins.
import { Button, DropZone, TextField } from '../../ui';
import styles from './SourceZone.module.css';

export interface SourceZoneProps {
  file: File | null;
  link: string;
  onFile: (file: File | null) => void;
  onLink: (link: string) => void;
}

function size(bytes: number): string {
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}

export function SourceZone({ file, link, onFile, onLink }: SourceZoneProps) {
  if (file) {
    return (
      <div className={styles.chosen}>
        <span className={styles.ok} aria-hidden="true">✓</span>
        <span className={styles.name}>
          {file.name} · {size(file.size)}
        </span>
        <Button variant="ghost" onClick={() => onFile(null)}>
          Replace
        </Button>
      </div>
    );
  }
  return (
    <div className={styles.zone}>
      <DropZone
        id="import-file"
        label="Audio or video file"
        file={null}
        onFile={onFile}
        hint="For video, the audio track is extracted."
      />
      <p className={styles.or}>or paste a link</p>
      <TextField
        id="import-link"
        label="Link"
        type="url"
        placeholder="https://… (YouTube and direct media links)"
        value={link}
        onChange={(event) => onLink(event.target.value)}
      />
    </div>
  );
}
```

`screens/import/SourceZone.module.css`:

```css
.zone { display: flex; flex-direction: column; gap: var(--ds-4); }
.or { display: flex; align-items: center; gap: var(--ds-3); margin: 0; font-size: var(--ds-t-sm); color: var(--ds-text-3); }
.or::before, .or::after { content: ''; flex: 1; height: 1px; background: var(--ds-border); }
.chosen { display: flex; align-items: center; gap: var(--ds-3); padding: var(--ds-3) var(--ds-4); background: var(--ds-surface); border: 1px solid var(--ds-border); border-radius: var(--ds-r-panel); }
.ok { color: var(--ds-ok); font-weight: 700; }
.name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font: 400 var(--ds-t-sm) / var(--ds-lh-sm) var(--ds-mono); }
```

`screens/import/ImportForm.tsx`:

```tsx
// Import, step one: one form, one source zone (UI spec §6.2). Title/artist are
// filled from the file's own tags server-side when left blank (C-06: no online
// lookup). A link has nothing to read before download, so its title is required.
import { type FormEvent, useState } from 'react';

import { useCreateSongFromUpload, useCreateSongFromUrl } from '../../api/queries';
import type { CreatedSong } from '../../api/client';
import { Banner, Button, Modal, TextField } from '../../ui';
import styles from './ImportForm.module.css';
import { SourceZone } from './SourceZone';

export interface CreatedImport {
  songId: string;
  jobId: number;
  title: string;
  artist: string;
  source: string;
}

export interface ImportFormProps {
  onCreated: (created: CreatedImport) => void;
  onClose: () => void;
}

function linkHost(link: string): string {
  try {
    return new URL(link).host;
  } catch {
    return link; // The server is the judge of the link (N-08); this is only a subtitle.
  }
}

export function ImportForm({ onCreated, onClose }: ImportFormProps) {
  const upload = useCreateSongFromUpload();
  const fromUrl = useCreateSongFromUrl();
  const [file, setFile] = useState<File | null>(null);
  const [link, setLink] = useState('');
  const [title, setTitle] = useState('');
  const [artist, setArtist] = useState('');

  const isLink = file === null && link.trim() !== '';
  const pending = upload.isPending || fromUrl.isPending;
  const error = upload.error ?? fromUrl.error;
  const ready = file !== null || (isLink && title.trim() !== '');

  function chooseFile(next: File | null) {
    setFile(next);
    if (next) setLink('');
  }

  function typeLink(next: string) {
    setLink(next);
    if (next) setFile(null);
  }

  function done(source: string) {
    return (data: CreatedSong) =>
      onCreated({
        songId: data.song.id,
        jobId: data.job_id,
        title: data.song.title,
        artist: data.song.artist,
        source,
      });
  }

  // Called by the footer button (outside the <form>) and by Enter in a field.
  function submit(event?: FormEvent) {
    event?.preventDefault();
    if (!ready) return;
    if (file) {
      const form = new FormData();
      form.set('file', file);
      if (title) form.set('title', title);
      if (artist) form.set('artist', artist);
      upload.mutate(form, { onSuccess: done(file.name) });
    } else {
      fromUrl.mutate(
        { url: link.trim(), title, artist: artist || undefined },
        { onSuccess: done(linkHost(link.trim())) },
      );
    }
  }

  return (
    <Modal
      title="Add song"
      subtitle="No format whitelist. If ffmpeg decodes it, it is accepted."
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!ready || pending} onClick={() => submit()}>
            {pending ? 'Importing…' : 'Import & separate'}
          </Button>
        </>
      }
    >
      <form className={styles.form} onSubmit={submit}>
        <SourceZone file={file} link={link} onFile={chooseFile} onLink={typeLink} />
        <div className={styles.fields}>
          <TextField
            id="import-title"
            label={isLink ? 'Title · required' : 'Title'}
            required={isLink}
            placeholder={isLink ? undefined : "From the file's tags"}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
          <TextField
            id="import-artist"
            label="Artist"
            placeholder={isLink ? undefined : "From the file's tags"}
            value={artist}
            onChange={(event) => setArtist(event.target.value)}
          />
        </div>
        <p className={styles.hint}>
          {isLink
            ? "A link has no tags to read before it's downloaded."
            : "Left blank, these come from the file's own tags. There's no online lookup anywhere."}
        </p>
        {/* N-08: the server's real message, not a generic failure notice. */}
        {error && <Banner tone="error" title="Import failed" trace={String(error)} />}
      </form>
    </Modal>
  );
}
```

`CreatedSong.song` is typed as `Song`, which has `title` and `artist`. The primary button lives in the modal footer, outside the `<form>`, so it calls `submit()` directly rather than relying on the `form=` attribute.

`screens/import/ImportForm.module.css`:

```css
.form { display: flex; flex-direction: column; gap: var(--ds-5); }
.fields { display: grid; grid-template-columns: 1fr 1fr; gap: var(--ds-4); }
.hint { margin: calc(-1 * var(--ds-3)) 0 0; font-size: var(--ds-t-sm); color: var(--ds-text-3); }
@media (max-width: 520px) { .fields { grid-template-columns: 1fr; } }
```

`screens/import/ImportModal.tsx` (the progress state arrives in Task 10):

```tsx
import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import { type CreatedImport, ImportForm } from './ImportForm';
import type { ImportLinkState } from './importLink';

export function ImportModal() {
  const navigate = useNavigate();
  const location = useLocation();
  const background = (location.state as ImportLinkState | null)?.background;
  const [created, setCreated] = useState<CreatedImport | null>(null);

  // Back to the page it was opened over; a direct visit has none, so go home.
  const close = () => (background ? navigate(-1) : navigate('/', { replace: true }));

  void created; // Task 10 renders the progress view from this.
  return <ImportForm onCreated={setCreated} onClose={close} />;
}
```

`app/routes.tsx`: remove `import { Import } from '../screens/Import';`, and add `useLocation` to the `react-router-dom` import plus:

```tsx
import { ImportModal } from '../screens/import/ImportModal';
import type { ImportLinkState } from '../screens/import/importLink';
```

Then restructure `AppRoutes`:

```tsx
export function AppRoutes() {
  const location = useLocation();
  // D-14: /import is a route that renders as a modal over the page it was
  // opened from. A direct visit has no background, so the Library is drawn under it.
  const background = (location.state as ImportLinkState | null)?.background;

  return (
    <>
      <Routes location={background ?? location}>
        {/* ...the existing dev harness route, unchanged... */}
        <Route element={<AppShell />}>
          <Route index element={<Library />} />
          <Route path="import" element={<Library />} />
          {/* ...every other existing route, unchanged... */}
        </Route>
      </Routes>
      <Routes>
        <Route path="/import" element={<ImportModal />} />
        <Route path="*" element={null} />
      </Routes>
    </>
  );
}
```

The two `/* ... */` comments above mean: keep those JSX blocks exactly as they are in the current file. Only the `import` route's element changes, and the second `<Routes>` is added.

`app/AppShell.tsx`: import `useLocation` and `importLinkState`. In the component, add `const location = useLocation();`, and pass `state={item.to === '/import' ? importLinkState(location) : undefined}` to each `NavLink`.

`screens/Library.tsx`: import `useLocation` and `importLinkState`. Add `const location = useLocation();` and pass `state={importLinkState(location)}` to both `ButtonLink`s that point to `/import`.

Delete `screens/Import.tsx`, `screens/Import.module.css` and `screens/Import.test.tsx`: their behaviour is covered by `ImportForm.test.tsx`.

- [ ] **Step 4: Run all the frontend tests and typecheck**

Run: `cd frontend && npx vitest run && npx tsc --noEmit`
Expected: all pass. If `Library.test.tsx` renders `Library` without a router, it already needs one for `Link`, so no change is needed. If it renders one, `useLocation` works.

- [ ] **Step 5: Commit**

```bash
git add -A frontend/src
git commit -m "feat(ui): Import is a modal over the current page with one source zone (F21, Q-05 for dialogs)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: The modal's progress view (import → separate → analyze)

**Files:**
- Create: `frontend/src/screens/import/pipeline.ts`, `pipeline.test.ts`, `ImportProgress.tsx`, `ImportProgress.module.css`, `ImportProgress.test.tsx`
- Modify: `frontend/src/screens/import/ImportModal.tsx`

**Interfaces:**
- Consumes: `CreatedImport` (Task 9), `useSongJobs`, `useJobKinds`, `pendingStep`, `StepList` (Task 7), `Modal` (Task 9), and `/jobs?song=` (Task 8).
- Produces:
  - `PIPELINE_KINDS = ['import', 'separate', 'analyze']`
  - `type PipelineGroup = { kind; status: 'job'; job: Job } | { kind; status: 'declared'; steps: StepDecl[] } | { kind; status: 'blocked'; blockedBy: PipelineKind; blockedState: JobState }`
  - `pipelineGroups(jobs: Job[], importJobId: number, kinds: Record<string, StepDecl[]>): PipelineGroup[]`
  - `pipelineDone(groups): boolean`

- [ ] **Step 1: Write the failing tests**

`pipeline.test.ts`:

```ts
import { expect, test } from 'vitest';

import type { Job } from '../../api/client';
import { pipelineDone, pipelineGroups } from './pipeline';

const kinds = {
  import: [{ id: 'decode', label: 'Decode', weight: 1 }],
  separate: [{ id: 'separate', label: 'Separate', weight: 1 }],
  analyze: [{ id: 'key', label: 'Key', weight: 1 }],
};

function job(id: number, kind: string, state: Job['state']): Job {
  return {
    id, song_id: 's1', kind, payload: {}, state, cancel_requested: false, progress: 0,
    device: null, lease_until: null, created_at: id, started_at: null, finished_at: null,
    error: null, result: null, steps: [],
  };
}

test('jobs that exist are shown; the rest come from their declarations', () => {
  const groups = pipelineGroups([job(5, 'import', 'done'), job(6, 'separate', 'running')], 5, kinds);
  expect(groups.map((g) => [g.kind, g.status])).toEqual([
    ['import', 'job'], ['separate', 'job'], ['analyze', 'declared'],
  ]);
});

test("an older run's jobs for the same song are ignored", () => {
  const groups = pipelineGroups([job(2, 'separate', 'done'), job(5, 'import', 'running')], 5, kinds);
  expect(groups[1]).toMatchObject({ kind: 'separate', status: 'declared' });
});

test('after a failure the later groups are blocked by it', () => {
  const groups = pipelineGroups([job(5, 'import', 'failed')], 5, kinds);
  expect(groups.slice(1)).toEqual([
    { kind: 'separate', status: 'blocked', blockedBy: 'import', blockedState: 'failed' },
    { kind: 'analyze', status: 'blocked', blockedBy: 'import', blockedState: 'failed' },
  ]);
});

test('done only when analyze is done', () => {
  expect(pipelineDone(pipelineGroups([job(5, 'import', 'done'), job(6, 'separate', 'done')], 5, kinds))).toBe(false);
  expect(
    pipelineDone(pipelineGroups([job(5, 'import', 'done'), job(6, 'separate', 'done'), job(7, 'analyze', 'done')], 5, kinds)),
  ).toBe(true);
});
```

`ImportProgress.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { expect, test, vi } from 'vitest';

import { ImportProgress } from './ImportProgress';

const created = { songId: 's1', jobId: 5, title: 'Tightrope', artist: 'Walk the Moon', source: 'tightrope.flac' };

function renderProgress(jobs: unknown[]) {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) =>
    String(input).startsWith('/api/job-kinds')
      ? new Response(JSON.stringify({ kinds: {
          import: [{ id: 'decode', label: 'Decode to 48 kHz', weight: 1 }],
          separate: [{ id: 'separate', label: 'Separate 4 stems', weight: 1 }],
          analyze: [{ id: 'key', label: 'Key', weight: 1 }],
        } }))
      : new Response(JSON.stringify({ jobs })),
  ));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ImportProgress created={created} onClose={() => {}} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const step = (id: string, label: string, state: string) => ({
  id, label, weight: 1, state, progress: state === 'running' ? 0.62 : 0, detail: null, started_at: null, finished_at: null,
});
const base = { song_id: 's1', payload: {}, cancel_requested: false, progress: 0, device: 'cuda', lease_until: null,
  created_at: 1, started_at: 1, finished_at: null, error: null, result: null };

test("shows each job's live steps and the declared steps of one not queued yet", async () => {
  renderProgress([
    { ...base, id: 6, kind: 'separate', state: 'running', steps: [step('separate', 'Separate 4 stems', 'running')] },
    { ...base, id: 5, kind: 'import', state: 'done', steps: [step('decode', 'Decode to 48 kHz', 'done')] },
  ]);
  expect(await screen.findByRole('dialog', { name: 'Tightrope' })).toBeInTheDocument();
  const separate = within(screen.getByRole('region', { name: 'separate job' }));
  expect(separate.getByRole('listitem', { name: 'Separate 4 stems: running' })).toBeInTheDocument();
  const analyze = within(screen.getByRole('region', { name: 'analyze job' }));
  expect(analyze.getByText(/not queued yet/)).toBeInTheDocument();
  expect(analyze.getByRole('listitem', { name: 'Key: pending' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /open song/i })).toBeDisabled();
  expect(screen.getByRole('link', { name: /open job queue/i })).toHaveAttribute('href', '/jobs?song=s1');
});

test('a failed import shows its error and says the rest will not run', async () => {
  renderProgress([
    { ...base, id: 5, kind: 'import', state: 'failed', error: 'ERROR: [youtube] Sign in to confirm your age.',
      steps: [step('decode', 'Decode to 48 kHz', 'failed')] },
  ]);
  expect(await screen.findByText(/Sign in to confirm your age/)).toBeInTheDocument();
  expect(screen.getAllByText(/won't run: import failed/)).toHaveLength(2);
});

test('Open song is a link once analyze is done', async () => {
  renderProgress([
    { ...base, id: 7, kind: 'analyze', state: 'done', steps: [step('key', 'Key', 'done')] },
    { ...base, id: 6, kind: 'separate', state: 'done', steps: [step('separate', 'Separate 4 stems', 'done')] },
    { ...base, id: 5, kind: 'import', state: 'done', steps: [step('decode', 'Decode to 48 kHz', 'done')] },
  ]);
  expect(await screen.findByRole('link', { name: /open song/i })).toHaveAttribute('href', '/songs/s1');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && npx vitest run src/screens/import`
Expected: FAIL, because `./pipeline` and `./ImportProgress` can't be resolved.

- [ ] **Step 3: Implement**

`screens/import/pipeline.ts`:

```ts
// The Import modal's view of one upload: the import job the API queued, then
// the separate and analyze jobs the worker queues after it. Pure, so the
// grouping rules are tested without React.
import type { Job, JobState, StepDecl } from '../../api/client';

export const PIPELINE_KINDS = ['import', 'separate', 'analyze'] as const;
export type PipelineKind = (typeof PIPELINE_KINDS)[number];

export type PipelineGroup =
  | { kind: PipelineKind; status: 'job'; job: Job }
  | { kind: PipelineKind; status: 'declared'; steps: StepDecl[] }
  | { kind: PipelineKind; status: 'blocked'; blockedBy: PipelineKind; blockedState: JobState };

export function pipelineGroups(
  jobs: Job[],
  importJobId: number,
  kinds: Record<string, StepDecl[]>,
): PipelineGroup[] {
  const groups: PipelineGroup[] = [];
  let blocked: { by: PipelineKind; state: JobState } | null = null;
  for (const kind of PIPELINE_KINDS) {
    if (blocked) {
      groups.push({ kind, status: 'blocked', blockedBy: blocked.by, blockedState: blocked.state });
      continue;
    }
    // Only this run: a re-imported song still has its earlier jobs in history.
    const job = jobs
      .filter((j) => j.kind === kind && j.id >= importJobId)
      .sort((a, b) => b.id - a.id)[0];
    if (job) {
      groups.push({ kind, status: 'job', job });
      if (job.state === 'failed' || job.state === 'cancelled') blocked = { by: kind, state: job.state };
    } else {
      groups.push({ kind, status: 'declared', steps: kinds[kind] ?? [] });
    }
  }
  return groups;
}

export function pipelineDone(groups: PipelineGroup[]): boolean {
  const last = groups[groups.length - 1];
  return last?.status === 'job' && last.job.state === 'done';
}
```

`screens/import/ImportProgress.tsx`:

```tsx
// Import, step two (UI spec §6.2, D-17): the song's import, separate and
// analyze jobs, drawn with the same StepList as the Job queue. Closing never
// stops the work.
import { pendingStep } from '../../api/client';
import { useJobKinds, useSongJobs } from '../../api/queries';
import { Banner, Button, ButtonLink, Chip, Modal, StepList, jobStateTone } from '../../ui';
import type { CreatedImport } from './ImportForm';
import styles from './ImportProgress.module.css';
import { type PipelineGroup, pipelineDone, pipelineGroups } from './pipeline';

export interface ImportProgressProps {
  created: CreatedImport;
  onClose: () => void;
}

function Group({ group }: { group: PipelineGroup }) {
  return (
    <section className={styles.group} aria-label={`${group.kind} job`}>
      <header className={styles.head}>
        <span className={styles.kind}>{group.kind}</span>
        {group.status === 'job' && (
          <Chip tone={jobStateTone(group.job.state)} dot>
            {group.job.state === 'running' && group.job.device ? group.job.device : group.job.state}
          </Chip>
        )}
        {group.status === 'declared' && <span className={styles.note}>not queued yet</span>}
        {group.status === 'blocked' && (
          <span className={styles.note}>
            won't run: {group.blockedBy} {group.blockedState}
          </span>
        )}
      </header>
      {group.status === 'job' && <StepList steps={group.job.steps} error={group.job.error} />}
      {group.status === 'declared' && <StepList steps={group.steps.map(pendingStep)} />}
    </section>
  );
}

export function ImportProgress({ created, onClose }: ImportProgressProps) {
  const jobs = useSongJobs(created.songId);
  const kinds = useJobKinds();
  const groups = pipelineGroups(jobs.data ?? [], created.jobId, kinds.data ?? {});
  const done = pipelineDone(groups);

  return (
    <Modal
      title={created.title}
      subtitle={[created.artist, created.source].filter(Boolean).join(' · ')}
      onClose={onClose}
      footer={
        <>
          <span className={styles.foot}>Closing won't stop the import</span>
          <ButtonLink variant="ghost" to={`/jobs?song=${encodeURIComponent(created.songId)}`}>
            Open job queue
          </ButtonLink>
          <Button onClick={onClose}>Close</Button>
          {done ? (
            <ButtonLink variant="primary" to={`/songs/${created.songId}`}>
              Open song
            </ButtonLink>
          ) : (
            <Button variant="primary" disabled>
              Open song
            </Button>
          )}
        </>
      }
    >
      {(jobs.isError || kinds.isError) && (
        <Banner tone="error" title="The import's jobs could not be read" trace={String(jobs.error ?? kinds.error)} />
      )}
      <div className={styles.groups}>
        {groups.map((group) => (
          <Group key={group.kind} group={group} />
        ))}
      </div>
    </Modal>
  );
}
```

`screens/import/ImportProgress.module.css`:

```css
.groups { display: flex; flex-direction: column; gap: var(--ds-4); }
.group { display: flex; flex-direction: column; gap: var(--ds-3); }
.group + .group { padding-top: var(--ds-4); border-top: 1px solid var(--ds-border); }
.head { display: flex; align-items: center; gap: var(--ds-3); }
.kind { text-transform: uppercase; letter-spacing: 0.08em; font-size: var(--ds-t-xs); font-weight: 600; color: var(--ds-text-3); }
.note { font-size: var(--ds-t-sm); color: var(--ds-text-3); }
.foot { flex: 1; font-size: var(--ds-t-sm); color: var(--ds-text-3); }
```

`ImportModal.tsx`: replace the `void created` line and the return with:

```tsx
  return created ? (
    <ImportProgress created={created} onClose={close} />
  ) : (
    <ImportForm onCreated={setCreated} onClose={close} />
  );
```

and add `import { ImportProgress } from './ImportProgress';`.

- [ ] **Step 4: Run all the frontend tests and typecheck**

Run: `cd frontend && npx vitest run && npx tsc --noEmit`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/screens/import
git commit -m "feat(ui): the Import modal follows the song's import, separate and analyze jobs step by step

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Design-system mockups, README, screenshots, end-to-end check, push

**Files:**
- Modify: `design/ui/src/pages/screens/import.html`, `design/ui/src/pages/screens/job-queue.html`, `README.md`, `docs/screenshots/job-queue.png`
- Create: `docs/screenshots/import.png`

- [ ] **Step 1: Bring the design-system mockups in line**

- `import.html`: keep the `@dsCard` header comment, and change its subtitle to `"One source zone, then the song's jobs step by step"`. Replace the body with frame 1 of `docs/superpowers/specs/2026-09-29-import-modal-form-mockup.html` (the modal with the source zone). Only the markup inside `.scrim` moves across, the `/* @inject */` style convention stays, and so do the `.steps`/`.step` classes already in the file. Remove the old "what happens next" five-step block.
- `job-queue.html`: replace the live `.card` of `.jobrow`s and the error banner with section 1 of `docs/superpowers/specs/2026-09-29-job-steps-mockup.html`. Copy its `.job`/`.jobrow`/`.jobsteps`/`.step` CSS into the page's `<style>` after `/* @inject */`. The **Re-run** button must not appear. Keep the stats and history blocks as they are.
- Build and look: `python3 design/ui/build.py`, then open `design/ui/dist/screens/job-queue.html` and `import.html` in a browser and compare them against the two spec mockups.

- [ ] **Step 2: README upkeep** (CLAUDE.md, "README upkeep")

In `README.md`, replace the Import bullet with:

```markdown
- Add a song from a file or a link (YouTube and direct media) in one dialog; any format
  ffmpeg can decode is accepted. The dialog then follows the import, separation and
  analysis live, step by step
```

and replace the Job queue bullet with:

```markdown
- Job queue screen: every job expands to its named steps, live, with a duration each and a
  failure's real traceback under the step that failed; all-time stats with passed and
  failed counts and the average duration per job kind and device
```

Under `## Screens`, add `![Add song](docs/screenshots/import.png)` after the Library image. Change "All four are captures" to "All five are captures", and add `import=/import` to the `capture-screens.mjs` command line.

- [ ] **Step 3: Run the app end to end and capture the screenshots**

Use the `dev-setup` skill for the exact commands: start the worker, the API and the Vite dev server.
1. Open the app in the browser pane, then Library → New Song. The dialog opens over the Library.
2. Upload a short audio file. The modal switches to the three groups. `Decode to 48 kHz` runs, then `separate` shows a live percentage, then `analyze` finishes, and "Open song" becomes a link.
3. Click "Open job queue": `/jobs?song=<id>` lists the three jobs, expanded, with durations.
4. Esc closes the modal back to the Library.
5. Import a link that fails (for example `https://example.invalid/x`). The `Download` step turns red with yt-dlp's real message, and separate and analyze say "won't run: import failed".
6. Check that the console has no errors.
7. Capture the screenshots: `node scripts/capture-screens.mjs import=/import job-queue=/jobs` (with a song mid-separation for `job-queue`, so a running row is expanded).

- [ ] **Step 4: Full verification**

```bash
uv run ruff check packages
uv run pytest -q
cd frontend && npx vitest run && npx tsc --noEmit && npm run build && cd ..
```

Expected: everything passes, and the build succeeds.

- [ ] **Step 5: Commit and push**

```bash
git add design/ui README.md docs/screenshots
git commit -m "docs(ui): job steps and Import modal in the design system, README and screenshots

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push origin main
```

---

## Self-review notes

- **Spec coverage:** the data column and migration are in Task 2. Declarations and the transition rules (N-08 errors) are in Task 1. Lifecycle is split across Task 2 (seed, fail, cancel, reclaim) and Task 3 (complete). Every kind is instrumented in Tasks 4–5. The API additions are in Task 6. StepList and StepStrip are in Task 7. The Job queue (disclosure, default-open rule, inline traceback, "No step record", `?song=`) is Task 8. The modal (background route, native dialog, one source zone, title rule) is Task 9, and its progress groups, "not queued yet", "won't run" and "Open song" are Task 10. Mockups and README are Task 11. The spec's non-goals (Re-run, per-step stats, tag probing) are deliberately absent.
- **Type names used across tasks:** `JobStep`, `StepDecl`, `pendingStep`, `useSongJobs`, `useJobKinds`, `CreatedImport`, `importLinkState`, `ImportLinkState`, `pipelineGroups`, `pipelineDone`, `JobContext.step/skip/detail/progress/complete`, `jobs.set_steps`, and `job_steps.advance/skip/set_progress/set_detail/complete/fail_running/cancel_running/reset/overall/seed/declare/all_declarations`.
