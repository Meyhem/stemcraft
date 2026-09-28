# Stemcraft Phase 4: Separation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps
> use checkbox (`- [ ]`) syntax for tracking.

**Goal:** torch enters the system. The worker probes for a working CUDA device at boot
(falling back to CPU with a real, named reason), loads HTDemucs v4 once, and a `separate`
job kind turns `audio.wav` into four immutable stems — WAV masters plus Opus delivery
copies — automatically chained onto a successful `import`. The API still never imports
torch; it only learns the device from a row in `jobs.sqlite` and shows a banner when it
reads `cpu`. No Song-view UI yet — that's Phase 6, once these stems and the engine's API
(Phase 3) both exist to build it against.

**Architecture:** All torch-touching code lives in `stemcraft_worker` only — never
`stemcraft_lib` (shared with the API) or `stemcraft_api` itself. The worker loads one
`demucs.api.Separator` **once at boot** (tech-spec §4: "models loaded once at boot"), runs
a real tiny inference through it as both the CUDA proof-of-work check *and* the
model-loads-and-runs boot dependency check (one real check serves both roles — a synthetic
matmul wouldn't catch an HTDemucs-specific kernel gap that only shows up in its transformer
layers). The same loaded `Separator` is then reused for every `separate` job for the rest
of the process's life, mirrors the existing `JobContext` plumbing, and is passed to job
kinds through a new optional `JobContext.worker_state` field.

**Tech Stack:** `torch` (cu128, pinned via a `uv` index), `demucs` 4.1 (HTDemucs v4's
reference implementation — see Task 1's note on why this replaces the domain spec's
`audio-separator`), `numpy` (demucs imports it directly but its own PyPI metadata doesn't
declare it on Linux — verified empirically, pinned explicitly rather than relying on it
arriving transitively).

**Spec:** [design/tech-spec-stemcraft.md](../../../design/tech-spec-stemcraft.md) §2 C-02,
§4 (device selection, boot checks), §5 (stems immutable, one writer per file), §7 (model
weights dependency row), §9 (cancel between segments), §11 D-02/D-03/D-04/D-08, §13 R-02;
[design/domain-spec.md](../../../design/domain-spec.md) "Separation" and "What the four
stems can and cannot do"; phase map:
[2026-09-27-stemcraft-roadmap.md](2026-09-27-stemcraft-roadmap.md) Phase 4. Phase 3's plan
(engine, already done): [2026-09-27-phase-3-playback-engine.md](2026-09-27-phase-3-playback-engine.md).

## Global constraints (repeated because every task inherits them)

- **The API never imports torch (§4).** Enforced today by `test_the_api_never_imports_torch`
  and by the dependency graph — `stemcraft-api` and `stemcraft-lib` must never gain `torch`
  or `demucs` as a dependency, directly or transitively. Every torch-touching module in
  this phase lives under `packages/stemcraft_worker/src/stemcraft_worker/`.
- **48 kHz stereo end to end (D-03).** HTDemucs runs internally at 44.1 kHz; every stem
  written to disk is resampled back to 48 kHz before it touches a file, the same way
  `audio.wav` already is.
- **Stems are immutable once written; one writer per file (§5).** The worker owns
  `stems/`. Nothing ever re-separates a Song — a second `separate` job for the same Song
  is a user/API decision (already possible today via the generic `/api/jobs` endpoint),
  never something this phase triggers automatically except once, right after import.
- **All writes atomic (invariant #8)** — every stem `.wav` and `.opus` lands via the
  existing `stemcraft_lib.atomic`/`stemcraft_lib.ffmpeg` machinery, never a raw `open()`.
- **Every job kind idempotent by re-derivation (§6).** A `separate` job is fully re-run
  from scratch on a lease reclaim; there is no partial-resume. Demucs's own `shifts`
  parameter defaults to a **non-deterministic** random-time-shift pass — this phase turns
  it off explicitly (`shifts=0`) so idempotency actually holds.
- **Fail loudly (N-08).** A CUDA failure falls back to CPU with the real exception text
  recorded; if *neither* device can load the model and run a tiny inference, the worker
  refuses to start, exactly like a missing `ffmpeg`.
- **CUDA ≥ 12.8 is a correctness floor (C-02).** Pinned via a `uv` index, not a version
  range — the lockfile is what actually fixes the wheel.

## Why demucs, not audio-separator (deviation from the domain spec's stack table)

The domain spec's stack table names `audio-separator` for HTDemucs v4. Verified against
the real package registry before writing this plan: `audio-separator` 0.47.0 pulls in
`onnx-weekly` and `onnx2torch-py313` **unconditionally** (not behind an extra), which cuts
against D-08's "PyTorch as the only inference runtime; no ONNX path" — a dependency that's
merely present and unused is a smaller sin than D-08 was written to avoid, but there's no
reason to accept it when the alternative is cleaner. `demucs` 4.1.0 (Meta's own reference
implementation of HTDemucs, still maintained) has none of that, exposes exactly the
primitives this phase needs out of the box (`demucs.api.Separator`'s `callback` parameter
fires per chunk/shift/submodel with a `state: "start"|"end"` key, and raising **any**
exception from inside it — verified directly, not assumed — cleanly aborts the remaining
chunks via `pool.shutdown(cancel_futures=True)` and propagates), and ships
`demucs.pretrained.demucs_unittest()`, a tiny untrained model built specifically for fast,
offline, deterministic tests — exactly the `ffmpeg`-test-fixture equivalent this phase
needs for the `separate` job kind's automated tests. This is an implementation-detail
substitution, not a tech-spec D-number reversal; **Task 1** updates the domain spec's
stack table row to match what actually ships.

## Why this order

The dependency pin (Task 1) has to land before anything else can even import `torch`.
`stemcraft_lib.jobs`'s new `worker_status` table (Task 2) and `stemcraft_lib.song`'s
opus-aware `has_stems` (Task 3) are both torch-free and independent of each other and of
the device probe, so either can go first. `device.py` (Task 4) is the one place the real
CUDA-vs-CPU decision gets made and is needed by both `main.py` (Task 6) and the `separate`
kind (Task 8); `registry.py`'s `JobContext` extension (Task 5) is the thin plumbing
connecting them, deliberately typed so that torch-free kinds (`probe`, `import`, and every
future analysis/export kind) never pay for a `torch` import just to load. `main.py` (Task
6) and `health.py` (Task 7) both consume Task 2's table, from opposite ends. The `separate`
kind (Task 8) is the centerpiece and depends on everything before it. `import_song.py`'s
chain-enqueue (Task 9) depends on `separate` existing to enqueue. The frontend banner
(Task 10) depends on Task 7's contract. Task 11 is real hardware, last, by construction.

```
Task 1 (torch/demucs pin) ─────────────────────────────────────────────────┐
                                                                            │
Task 2 (jobs: worker_status) ──┬─► Task 6 (main.py wiring) ─┐              │
                                └─► Task 7 (health.py)       │             │
Task 3 (song: has_stems+opus) ─────────────────────────────┐│             │
                                                             ││             ▼
Task 4 (device.py: CUDA probe) ─┬─► Task 6 ──────────────────┼─► Task 8 (separate kind) ─► Task 9 (import chains separate)
Task 5 (registry: JobContext) ──┘                            │             │                          │
                                                               ▼            ▼                          ▼
                                                        Task 7 ──► Task 10 (frontend banner)   Task 11 (real hardware verification)
```

## Task 1 — Pin torch to the cu128 index (D-02) and add `demucs` + `numpy`

**Problem:** `stemcraft_worker/pyproject.toml` already has the placeholder comment "Phase
4 adds torch here, pinned to the cu128 index by a constraints file (D-02)." Verified by
building a scratch two-package `uv` workspace mirroring this repo's exact shape and running
real `uv lock` against it: plain `torch` from PyPI is a CPU wheel; pinning via
`[[tool.uv.index]]` + `[tool.uv.sources]` at the **workspace root** resolves it to
`torch==2.11.0+cu128` from `download.pytorch.org/whl/cu128` even though `torch` is declared
in the *member* package's dependencies — the root's `tool.uv.sources` applies workspace-wide.
Also discovered empirically: `demucs` 4.1.0's own PyPI metadata does **not** declare `numpy`
as a dependency on Linux (only under a `sys_platform == "darwin"` marker), even though
`demucs/transformer.py` imports it unconditionally — a real gap in demucs's packaging, not
a hypothetical. And: `demucs` 4.1.0 pins `numpy<2` **only** under that same darwin marker,
which conflicts with a plain `numpy>=2` requirement once `uv` tries to solve for *every*
platform (including one this project will never run on) — fixed by scoping the resolution
to Linux only via `tool.uv.environments`, which is honestly the correct scope for C-01's
"single machine" anyway.

**Produces:**

- `pyproject.toml` (workspace root) — add:

  ```toml
  [tool.uv]
  environments = ["sys_platform == 'linux'"]

  [[tool.uv.index]]
  name = "pytorch-cu128"
  url = "https://download.pytorch.org/whl/cu128"
  explicit = true
  ```

  and extend the existing `[tool.uv.sources]` table with:

  ```toml
  torch = [{ index = "pytorch-cu128" }]
  ```

  (`explicit = true` means this index is only ever used for a package that names it in
  `tool.uv.sources` — nothing else silently starts resolving from PyTorch's limited index.)

- `packages/stemcraft_worker/pyproject.toml` — replace the placeholder comment and
  `dependencies` line with:

  ```toml
  # D-02: torch is pinned to the cu128 index at the workspace root
  # (pyproject.toml's [tool.uv.sources]/[tool.uv.index]) — never here as a version range,
  # since the *index* is what a transitive dependency could otherwise bypass, not the
  # version. numpy is pinned explicitly because demucs imports it directly but its own
  # metadata doesn't declare it on Linux (verified against the real package on PyPI).
  dependencies = ["stemcraft-lib", "torch", "demucs>=4.1", "numpy>=2"]
  ```

- [design/domain-spec.md](../../../design/domain-spec.md) — update the stack table's
  Separation row from "HTDemucs v4 via audio-separator" to "HTDemucs v4 via `demucs`
  (Meta's reference implementation; audio-separator's unconditional ONNX deps cut against
  D-08 — see Phase 4's plan)."

**Verification (real, against this actual repo — not the scratch workspace used to design
this task):**

```bash
uv lock
uv sync
uv run python -c "import torch; print(torch.__version__, torch.cuda.is_available())"
uv run python -c "import demucs, numpy; print('ok')"
```

Expect `torch.__version__` to end in `+cu128` and `torch.cuda.is_available()` to print
`True` on this machine (RTX 5080, driver 580.178.04, CUDA 13.0 — the driver comfortably
exceeds the cu128 floor). Confirm with `uv run python -m stemcraft_api.app` unaffected:
`grep -c torch` over `uv tree --package stemcraft-api` must stay `0`.

**Tests:** none (dependency/config only) — Task 6's and Task 8's tests are what actually
exercise this.

## Task 2 — `stemcraft_lib.jobs`: a `worker_status` row for the device banner

**Problem:** API and worker "never call each other; they coordinate through `jobs.sqlite`"
(§4). The worker decides its device once, at boot (§4: "At boot the worker attempts
CUDA..."); the API needs to read that decision to show N-08's banner, and must do so
without importing anything torch-touching. `health.py` today has a literal placeholder:
`"device": None,  # Phase 4 fills this from the worker's latest job row.` — a single-row
status table is simpler and more honest than inferring "the worker's device" from
whichever job happened to run last (which would read `None` forever if no job has ever
run, even after the worker has booted and made its real decision).

**Produces (appended to `packages/stemcraft_lib/src/stemcraft_lib/jobs.py`):**

- Add to `SCHEMA` (a new table — additive, so no `JOBS_SCHEMA_VERSION` bump; nothing about
  the existing `jobs` table changes):

  ```sql
  CREATE TABLE IF NOT EXISTS worker_status (
    id               INTEGER PRIMARY KEY CHECK (id = 1),
    device           TEXT NOT NULL,
    fallback_reason  TEXT,
    updated_at       REAL NOT NULL
  );
  ```

- ```python
  @dataclass(frozen=True)
  class WorkerStatus:
      device: str
      fallback_reason: str | None
      updated_at: float


  def set_worker_status(conn: sqlite3.Connection, *, device: str, fallback_reason: str | None) -> None:
      """Written once, at worker boot (§4's device decision doesn't change during the
      process's life). Single row by construction (id=1's CHECK constraint)."""
      conn.execute(
          "INSERT INTO worker_status (id, device, fallback_reason, updated_at) "
          "VALUES (1, ?, ?, ?) "
          "ON CONFLICT(id) DO UPDATE SET device=excluded.device, "
          "fallback_reason=excluded.fallback_reason, updated_at=excluded.updated_at",
          (device, fallback_reason, time.time()),
      )


  def get_worker_status(conn: sqlite3.Connection) -> WorkerStatus | None:
      """None until a worker has booted at least once against this database."""
      row = conn.execute("SELECT device, fallback_reason, updated_at FROM worker_status WHERE id = 1").fetchone()
      return WorkerStatus(device=row["device"], fallback_reason=row["fallback_reason"], updated_at=row["updated_at"]) if row else None
  ```

**Tests (`packages/stemcraft_lib/tests/test_jobs_schema.py`):**

- `test_worker_status_is_none_before_any_worker_boots`: fresh `connect()`,
  `get_worker_status(conn) is None`.
- `test_worker_status_round_trips`: `set_worker_status(conn, device="cuda",
  fallback_reason=None)`; `get_worker_status(conn)` returns matching `device`/`fallback_reason`
  and a `updated_at > 0`.
- `test_worker_status_upserts_a_single_row`: call `set_worker_status` twice with different
  devices; `get_worker_status(conn).device` reflects the second call, and
  `conn.execute("SELECT COUNT(*) FROM worker_status").fetchone()[0] == 1`.

## Task 3 — `stemcraft_lib.song`: `has_stems` requires the Opus copies too (D-04)

**Problem:** `derive_files.has_stems` today checks only the four `.wav` masters. D-04
makes `.opus` the *only* thing ever served for playback — a Song with WAVs but no Opus
(e.g. the worker died between writing the last WAV and encoding the first Opus) would
currently read as `"separated"` even though Phase 6's playback would have nothing to fetch.
Since this phase is what starts actually producing Opus copies, this is the natural point
to close that gap.

**Produces (modify `packages/stemcraft_lib/src/stemcraft_lib/song.py`):**

Update the comment above `SongFiles.has_stems` (currently "All four, or none: a partial
set is a crashed job, not a separated song.") to: "All four `.wav` *and* `.opus`, or none
(D-04) — a partial set is a crashed or still-running job, not a separated song." Then:

```python
def derive_files(song_dir: Path) -> SongFiles:
    stems = song_dir / "stems"
    return SongFiles(
        has_audio=(song_dir / "audio.wav").is_file(),
        has_peaks=(song_dir / "peaks.json").is_file(),
        has_stems=all(
            (stems / f"{name}.{ext}").is_file() for name in STEM_NAMES for ext in ("wav", "opus")
        ),
        has_analysis=(song_dir / "analysis.json").is_file(),
    )
```

**Tests (modify `packages/stemcraft_lib/tests/test_song.py`):**

- `test_state_is_derived_from_files_present`: when writing the four `stems/*.wav` files to
  reach `"separated"`, also write the four `stems/*.opus` files (empty bytes, same as the
  wav fixtures already do).
- `test_partial_stems_do_not_count_as_separated`: keep the existing partial-wav case, and
  add: write all four `.wav` files but omit `.opus` entirely → `has_stems is False`.

## Task 4 — `stemcraft_worker.device`: the CUDA probe and CPU fallback (C-02, R-02, N-08)

**Problem:** `main.py`'s `select_device()` is a stub returning `"cpu"` unconditionally,
with a comment saying Phase 4 replaces it. The tech spec asks for two things that turn out
to be the *same* check done once: "the worker attempts CUDA and runs a small proof-of-work
op" (device selection) and "models load and one tiny inference succeeds on the selected
device" (the boot-refusal dependency check, §7: "Worker refuses to start if weights are
absent or fail their boot inference"). Verified directly: loading `demucs`'s pretrained
`htdemucs` model and running one real `separate_tensor` call on a few thousand frames of
silence is fast (loading `demucs_unittest`, the untrained stand-in used in tests, takes
~10 ms and a 1-second separate call ~50 ms on CPU; the real `htdemucs` model is bigger but
still a boot-time cost, not a per-job one, matching "models loaded once at boot"). Using
the *real* model for this check — not a synthetic matmul — is what actually catches an
HTDemucs-specific sm_120 kernel gap (R-02) rather than a generic CUDA smoke test that would
miss it.

**Produces:** `packages/stemcraft_worker/src/stemcraft_worker/device.py`:

```python
"""CUDA probe and CPU fallback (§4, C-02, R-02). This module and every module that
imports it touches torch -- it must never be imported by stemcraft_lib or stemcraft_api
(§4's blast-radius boundary).

The SAME check plays two roles the tech spec asks for separately: a "small proof-of-work
op" deciding cuda vs. cpu, and "models load and one tiny inference succeeds on the
selected device" as a boot-refusal dependency check. Using the real htdemucs model for
both, instead of a synthetic op, is what catches an HTDemucs-specific kernel gap (R-02)
rather than a generic CUDA smoke test that wouldn't exercise the same code path a real
separation job does.
"""

from __future__ import annotations

from dataclasses import dataclass

import torch
from demucs.api import Separator

from stemcraft_lib.config import SAMPLE_RATE

_PROBE_FRAMES = SAMPLE_RATE // 10  # 0.1s of silence -- cheap, deterministic, real inference


class DeviceProbeError(Exception):
    """Neither CUDA nor CPU could load the model and run a tiny inference. The worker
    refuses to start (N-08) -- nothing would work anyway."""


@dataclass(frozen=True)
class WorkerState:
    device: str
    fallback_reason: str | None
    separator: Separator


def _tiny_probe(separator: Separator) -> None:
    silence = torch.zeros(2, _PROBE_FRAMES)
    separator.separate_tensor(silence, sr=SAMPLE_RATE)


def probe_and_select(*, model_name: str = "htdemucs") -> WorkerState:
    """Tries CUDA first; on any failure (missing kernels, no card, OOM -- caught broadly
    on purpose, since N-08 wants the real message either way, not a curated subset of
    exception types) falls back to CPU. Raises DeviceProbeError only if CPU also fails --
    total refusal, mirroring how a missing ffmpeg refuses the whole process rather than
    degrading one feature."""
    cuda_reason: str | None
    if torch.cuda.is_available():
        try:
            separator = Separator(model=model_name, device="cuda")
            _tiny_probe(separator)
            return WorkerState(device="cuda", fallback_reason=None, separator=separator)
        except Exception as exc:  # noqa: BLE001 -- N-08: the real message, whatever it is
            cuda_reason = f"{type(exc).__name__}: {exc}"
    else:
        cuda_reason = "torch.cuda.is_available() is False"

    try:
        separator = Separator(model=model_name, device="cpu")
        _tiny_probe(separator)
    except Exception as exc:
        raise DeviceProbeError(
            f"neither cuda ({cuda_reason}) nor cpu could load {model_name!r} and run a "
            f"tiny inference: {type(exc).__name__}: {exc}"
        ) from exc
    return WorkerState(device="cpu", fallback_reason=cuda_reason, separator=separator)
```

**Tests (`packages/stemcraft_worker/tests/test_device.py`, using `model_name="demucs_unittest"`
throughout so these never touch the network or download real weights):**

- `test_cpu_probe_succeeds_when_cuda_is_unavailable`: `monkeypatch.setattr(torch.cuda,
  "is_available", lambda: False)`; `probe_and_select(model_name="demucs_unittest")` returns
  `device == "cpu"` and a non-`None` `fallback_reason` containing `"is_available"`.
- `test_cuda_probe_succeeds_when_available`: skip with `pytest.mark.skipif(not
  torch.cuda.is_available(), reason="no CUDA device on this host")` — on a CUDA-capable
  host (this one), asserts `device == "cuda"` and `fallback_reason is None`.
- `test_falls_back_to_cpu_when_cuda_raises`: monkeypatch `torch.cuda.is_available` to
  `True` and monkeypatch `stemcraft_worker.device.Separator` (via `monkeypatch.setattr`
  on the module) to a fake whose `separate_tensor` raises `RuntimeError("no kernel image
  is available")` only when constructed with `device="cuda"`; asserts fallback to `"cpu"`
  with that message inside `fallback_reason`.
- `test_raises_when_neither_device_works`: monkeypatch so both the cuda and cpu attempts
  raise; asserts `DeviceProbeError` whose message contains both real exception texts.

## Task 5 — `stemcraft_worker.registry`: `JobContext.worker_state`

**Problem:** the `separate` kind needs access to the one `Separator` loaded at boot
(Task 4), but `registry.py` is imported by every kind — including `probe` and `import`,
which have nothing to do with torch, and by every future torch-free kind (`analyze` in
Phase 5, `export` in Phase 7). Importing `device.py` here directly would make torch a hard
import cost for every worker test, not just the ones about separation.

**Produces (modify `packages/stemcraft_worker/src/stemcraft_worker/registry.py`):**

```python
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from .device import WorkerState  # noqa: F401 -- typing only, never imported at runtime here


@dataclass
class JobContext:
    conn: sqlite3.Connection
    job_id: int
    payload: dict
    device: str
    worker_state: "WorkerState | None" = None
    ...  # progress/cancelled unchanged
```

**Tests:** none new — every existing `test_worker_loop.py` test constructs `JobContext`
only through `run_one(conn, device="cpu")`, which now defaults `worker_state=None`; add one
assertion to an existing test (`test_runs_a_job_and_records_its_result`) that a kind can
read `ctx.worker_state` and see `None` when `run_one` is called without it, confirming the
default doesn't break anything already passing.

## Task 6 — `stemcraft_worker.main`: wire the real device probe into boot

**Problem:** `main()` currently calls the stub `select_device() -> "cpu"` and never talks
to `worker_status`. `run_one` needs to carry `worker_state` through to `JobContext` without
breaking any of the ~15 existing call sites across `test_worker_loop.py` and
`test_import_song.py` that call `run_one(conn, device="cpu")` with no `worker_state` at all.

**Produces (modify `packages/stemcraft_worker/src/stemcraft_worker/main.py`):**

- Delete `select_device()`.
- ```python
  from .device import DeviceProbeError, WorkerState, probe_and_select
  ```
- `run_one` gains one new keyword-only parameter with a default, so every existing call
  site keeps compiling and passing unchanged:

  ```python
  def run_one(conn: sqlite3.Connection, *, device: str, worker_state: WorkerState | None = None) -> int | None:
      ...
      result = fn(JobContext(conn=conn, job_id=job.id, payload=job.payload, device=device,
                              worker_state=worker_state))
      ...
  ```

- `main()`:

  ```python
  try:
      state = probe_and_select()
  except DeviceProbeError as exc:
      log.error("%s", exc)
      raise SystemExit(1) from exc
  if state.fallback_reason:
      log.warning("falling back to cpu: %s", state.fallback_reason)

  conn = jobs_db.connect(settings().jobs_db)
  jobs_db.set_worker_status(conn, device=state.device, fallback_reason=state.fallback_reason)
  log.info("worker ready on device=%s, polling %s", state.device, settings().jobs_db)
  while True:
      if run_one(conn, device=state.device, worker_state=state) is None:
          time.sleep(POLL_SECONDS)
  ```

**Tests:** none new for `main()` itself (it has never been unit-tested directly — it's a
thin `while True` loop already exercised end-to-end in Task 11). Run the **existing**
`test_worker_loop.py` and `test_import_song.py` suites unmodified after this task and
confirm they still pass — that's the regression check this task's diff must satisfy.

## Task 7 — `stemcraft_api.routes.health`: report the real device

**Problem:** `health()` hardcodes `"device": None` with a comment pointing at this exact
phase.

**Produces (modify `packages/stemcraft_api/src/stemcraft_api/routes/health.py`):**

```python
from typing import Annotated
import sqlite3
from fastapi import Depends
from stemcraft_lib import jobs as jobs_db
from ..deps import get_conn

Conn = Annotated[sqlite3.Connection, Depends(get_conn)]


@router.get("/api/health")
def health(conn: Conn) -> dict:
    status = jobs_db.get_worker_status(conn)
    return {
        "deps": [{"name": c.name, "ok": c.ok, "detail": c.detail} for c in check_all()],
        "device": status.device if status else None,
        "fallback_reason": status.fallback_reason if status else None,
        "sample_rate": SAMPLE_RATE,
    }
```

**Tests (`packages/stemcraft_api/tests/test_api.py`):**

- `test_health_reports_no_device_before_any_worker_has_booted`: existing fixture, no
  `worker_status` row written → `body["device"] is None` and `body["fallback_reason"]
  is None`. (Extends the existing `test_health_reports_every_dependency_and_the_sample_rate`
  rather than duplicating its setup — add the two new assertions there.)
- `test_health_reports_the_workers_recorded_device`: use the `client` fixture's own
  `get_conn`/`settings().jobs_db` path — write a `worker_status` row directly via
  `jobs_db.set_worker_status(jobs_db.connect(settings().jobs_db), device="cpu",
  fallback_reason="no cuda device found")` before calling `/api/health`; assert both
  fields round-trip.
- `test_the_api_never_imports_torch` (existing) must still pass unmodified — the strongest
  regression check this task has, since it's asserting the exact invariant this whole
  phase is built around not violating.

## Task 8 — `stemcraft_worker.kinds.separate_song`: the `separate` job kind

**Problem:** this is the phase's centerpiece. `audio.wav` (48 kHz stereo, from Phase 2) in,
four immutable stems (§5) — WAV masters at 48 kHz plus Opus delivery copies (D-04) — out.
Verified directly against the real `demucs.api.Separator`, not assumed:

- `Separator.samplerate` is **44100** regardless of the input's rate (`separate_tensor`
  resamples internally via `julius`, in-process, no `torchaudio` needed) — every stem
  tensor that comes back is at 44.1 kHz and must be resampled back to 48 kHz (D-03) before
  it's written to disk.
- `separator.update_parameter(shifts=0, callback=..., callback_arg=...)` reuses the *same*
  loaded model instance across jobs; `shifts=0` turns off demucs's own default
  random-time-shift-and-average pass (its default is `shifts=1`, meaning "one random
  shift," which would silently break this job kind's idempotency — verified this is a real
  default, not a hypothetical).
- The `callback` fires with keys `{model_idx_in_bag, shift_idx, segment_offset, state,
  audio_length, models}`, `state` is `"start"` or `"end"`, and — verified by actually
  raising a plain custom exception from inside it on a 20-second synthetic clip — **any**
  exception raised from the callback aborts cleanly: the split-path futures pool calls
  `pool.shutdown(wait=True, cancel_futures=True)` before re-raising, and the non-split path
  has no special catch at all, so it just propagates. No `KeyboardInterrupt` translation is
  needed — raising `JobCancelled` directly from the callback works exactly like this
  worker's every other kind already cancels itself.
- Reading a 16-bit PCM WAV into a `torch.Tensor` and back needs no `numpy`:
  `torch.frombuffer(bytearray(raw_pcm), dtype=torch.int16)` (the `bytearray(...)` wrapper
  matters — `wave.readframes` returns immutable `bytes`, and `torch.frombuffer` on an
  immutable buffer raises a `UserWarning` demoted to a real error under `-W error`, though
  not by default) reshaped to `(channels, frames)`, and back via `.tolist()` into
  `array.array("h", ...)`.

**Produces:** `packages/stemcraft_worker/src/stemcraft_worker/kinds/separate_song.py`:

```python
"""The `separate` job kind: HTDemucs v4 (torch, this module only -- never
stemcraft_lib or stemcraft_api, per §4) turns audio.wav into four immutable stems
(§5) plus their Opus delivery copies (D-04).

Idempotent by re-derivation (§6): every stem file lands atomically via
stemcraft_lib.ffmpeg, so a crash mid-separation never leaves a half-written stem, and
a retry after a lease reclaim just redoes the whole separation from audio.wav and
overwrites. `shifts=0` is passed explicitly -- demucs's own default (`shifts=1`)
applies one *random* time-shift-and-average pass, which would make two runs on
identical input produce slightly different (though still valid) output, undermining
the idempotency guarantee this relies on. The tiny SDR cost demucs.api.Separator's own
docstring documents for shifts=0 is worth that guarantee.
"""

from __future__ import annotations

import array
import tempfile
import wave
from pathlib import Path

import torch

from stemcraft_lib import ffmpeg
from stemcraft_lib.config import SAMPLE_RATE, settings
from stemcraft_lib.song import STEM_NAMES, find_song_dir, read_song

from ..registry import JobCancelled, JobContext, register

# ~-34 dBFS. A starting guess, not a measured result (same status as A-05's crossfade
# ms) -- Task 11 tunes this by ear against a real song with a genuinely absent stem.
NEAR_SILENT_THRESHOLD = 0.02


def _load_wav_tensor(path: Path) -> torch.Tensor:
    with wave.open(str(path), "rb") as wav_file:
        channels = wav_file.getnchannels()
        sample_width = wav_file.getsampwidth()
        if sample_width != 2:
            raise ValueError(f"{path}: expected 16-bit PCM, got {sample_width * 8}-bit")
        raw = wav_file.readframes(wav_file.getnframes())
    flat = torch.frombuffer(bytearray(raw), dtype=torch.int16)
    return flat.view(-1, channels).t().contiguous().to(torch.float32) / 32768.0


def _write_stem_wav(tensor: torch.Tensor, src_rate: int, dst: Path) -> None:
    """`tensor` is (channels, frames) float32 in [-1, 1] at `src_rate` (the model's
    native rate -- 44100 for every HTDemucs variant). Writes a temp WAV at src_rate,
    then hands off to ffmpeg.decode_to_wav for the atomic resample to SAMPLE_RATE
    (D-03's 48 kHz round trip) -- the exact function Phase 2's import already tests
    at 48 kHz stereo, rather than a second hand-rolled resampling path."""
    ints = (tensor.clamp(-1, 1) * 32767.0).round().to(torch.int16)
    interleaved = ints.t().contiguous().reshape(-1)
    pcm_bytes = array.array("h", interleaved.tolist()).tobytes()
    with tempfile.TemporaryDirectory() as tmp_dir:
        tmp_wav = Path(tmp_dir) / "stem.wav"
        with wave.open(str(tmp_wav), "wb") as wav_file:
            wav_file.setnchannels(tensor.shape[0])
            wav_file.setsampwidth(2)
            wav_file.setframerate(src_rate)
            wav_file.writeframes(pcm_bytes)
        ffmpeg.decode_to_wav(tmp_wav, dst, sample_rate=SAMPLE_RATE)


def run(ctx: JobContext) -> dict:
    song_id = ctx.payload["song_id"]
    song_dir = find_song_dir(settings().songs_dir, song_id)
    if song_dir is None:
        raise RuntimeError(f"no song directory for song_id={song_id!r}")
    read_song(song_dir)  # fail loudly if song.json itself is unreadable

    audio_wav = song_dir / "audio.wav"
    if not audio_wav.is_file():
        raise RuntimeError(f"song {song_id} has no audio.wav to separate")

    if ctx.worker_state is None:
        raise RuntimeError("separate requires a loaded Separator (JobContext.worker_state)")
    separator = ctx.worker_state.separator
    wav_tensor = _load_wav_tensor(audio_wav)

    def on_progress(info: dict) -> None:
        if ctx.cancelled():
            raise JobCancelled
        if info.get("state") == "end" and info.get("audio_length"):
            ctx.progress(min(0.95, info["segment_offset"] / info["audio_length"]))

    separator.update_parameter(shifts=0, callback=on_progress, callback_arg={})
    _, stems = separator.separate_tensor(wav_tensor, sr=SAMPLE_RATE)

    stems_dir = song_dir / "stems"
    near_silent: dict[str, bool] = {}
    for name in STEM_NAMES:
        stem_tensor = stems[name]
        near_silent[name] = float(stem_tensor.abs().max()) < NEAR_SILENT_THRESHOLD
        wav_path = stems_dir / f"{name}.wav"
        _write_stem_wav(stem_tensor, separator.samplerate, wav_path)
        ffmpeg.encode_opus(wav_path, stems_dir / f"{name}.opus")

    ctx.progress(1.0)
    return {"near_silent": near_silent}


register("separate", run)
```

- Add to `packages/stemcraft_worker/src/stemcraft_worker/kinds/__init__.py`:
  `from . import import_song, probe, separate_song  # noqa: F401`

**Tests (`packages/stemcraft_worker/tests/test_separate_song.py`, gated
`pytest.mark.skipif(shutil.which("ffmpeg") is None, ...)` like the import tests, and always
using `Separator(model="demucs_unittest", device="cpu", shifts=0)` — fast, deterministic,
no network, no real weights download):**

- Fixture: build a `WorkerState` directly (`WorkerState(device="cpu", fallback_reason=None,
  separator=Separator(model="demucs_unittest", device="cpu"))`) and a real `audio.wav` via
  the same ffmpeg-sine-wave helper `test_import_song.py` already uses, decoded to 48 kHz
  stereo via `ffmpeg.decode_to_wav`.
- `test_separate_writes_all_four_wav_and_opus_stems_at_48khz`: run the job via
  `run_one(conn, device="cpu", worker_state=state)`; assert `done.state == "done"`; for
  each of `STEM_NAMES`, assert both `stems/<name>.wav` (opened with `wave`, asserting
  `getframerate() == 48000` and `getnchannels() == 2`) and `stems/<name>.opus` exist and
  are non-empty.
- `test_separate_result_reports_near_silent_per_stem`: assert `done.result["near_silent"]`
  has exactly the four `STEM_NAMES` keys, each a `bool`.
- `test_rerunning_separate_is_idempotent`: run twice on the same song (two separate
  `enqueue`+`run_one` calls); assert both jobs reach `"done"` and the second run's
  `stems/vocals.wav` bytes equal the first run's (proves `shifts=0` actually removed the
  randomness — this is the test that would fail if that parameter were ever dropped).
- `test_missing_audio_wav_fails_loudly`: song dir with no `audio.wav` → job `"failed"`,
  `song.id in failed.error`.
- `test_cancel_mid_separation_lands_as_cancelled_not_failed`: use a **longer** synthetic
  clip (≥20 s at 48 kHz, matching the length that was verified to produce multiple
  segment-callback events) so at least one `"end"` callback fires before completion; call
  `request_cancel(conn, job_id)` from inside a monkeypatched `on_progress`-adjacent hook —
  concretely, monkeypatch `stemcraft_lib.jobs.is_cancel_requested` (via `ctx.cancelled`) to
  return `True` starting from the second callback invocation (a small counter closure), so
  the cancellation fires mid-run rather than before the first segment starts; assert the
  job ends `"cancelled"`, not `"failed"`, and that no stem files exist at all (the whole
  per-stem write loop runs only after `separate_tensor` returns successfully, so a
  mid-inference cancel leaves zero partial stem files — assert this explicitly, since it's
  the concrete form of "no partial output left behind" from the roadmap's exit criteria).

## Task 9 — `stemcraft_worker.kinds.import_song`: chain `separate` onto a successful import

**Problem:** the domain spec's own Import pipeline literally ends in "queue separation":
*"Pipeline: keep the original → decode to 48 kHz stereo WAV (D-03) → compute waveform
peaks → queue separation."* Phase 2 stopped short of that last step because `separate`
didn't exist yet. This phase is what completes it, which is also what lets Phase 4's exit
criteria be exercised end-to-end through the existing Import screen with zero new frontend
code.

**Produces (modify `packages/stemcraft_worker/src/stemcraft_worker/kinds/import_song.py`):**

Add to the top-level imports (this module doesn't import `jobs_db` today):

```python
from stemcraft_lib import jobs as jobs_db
```

and, at the end of `run()`, right before the `return`:

```python
    jobs_db.enqueue(ctx.conn, kind="separate", song_id=song.id, payload={"song_id": song.id})
```

**Tests (modify `packages/stemcraft_worker/tests/test_import_song.py`):**

- `test_import_enqueues_a_separate_job_on_success`: after
  `test_upload_source_decodes_and_computes_peaks`'s existing setup and `run_one` call,
  assert `jobs_db.list_jobs(conn, states=("queued",))` contains exactly one job with
  `kind == "separate"` and `payload == {"song_id": song.id}`.
- `test_a_failed_import_does_not_enqueue_separation`: reuse
  `test_corrupt_original_fails_with_ffmpegs_message_and_original_survives`'s setup; assert
  `jobs_db.list_jobs(conn, states=("queued",)) == []` after the failed run.

## Task 10 — Frontend: the CPU-fallback banner (domain spec: "a banner when on CPU")

**Problem:** `AppShell.tsx` already renders a banner for broken dependencies but has no
concept of the device banner the domain spec calls for. `Health` doesn't carry
`fallback_reason` yet.

**Produces:**

- `frontend/src/api/client.ts` — extend `Health`:
  ```ts
  export interface Health {
    deps: DepCheck[];
    device: string | null;
    fallback_reason: string | null;
    sample_rate: number;
  }
  ```
- `frontend/src/app/AppShell.module.css` — add, alongside the existing `.banner`:
  ```css
  .bannerWarn {
    padding: var(--ds-3) var(--ds-4);
    background: var(--ds-raised);
    border-bottom: 1px solid var(--ds-warn);
    color: var(--ds-warn);
    font: 400 var(--ds-t-sm) / 1.5 var(--ds-mono);
  }
  ```
- `frontend/src/app/AppShell.tsx` — after the existing broken-deps banner block:
  ```tsx
  {broken.length === 0 && health.data?.device === 'cpu' && (
    <div className={styles.bannerWarn} role="status">
      Running separation on CPU{health.data.fallback_reason ? ` (${health.data.fallback_reason})` : ''}
      — this is slower than GPU (N-01).
    </div>
  )}
  ```
  (Gated on `broken.length === 0` so a genuinely broken dependency's `role="alert"` banner
  isn't visually doubled up with an informational one underneath it.)

**Tests (`frontend/src/app/routes.test.tsx`):** add one test alongside the existing
`beforeEach` fetch stub — a variant that stubs `/api/health` to return `{deps: [], device:
'cpu', fallback_reason: 'no cuda device found', sample_rate: 48000}` and asserts
`screen.findByText(/running separation on cpu/i)` resolves, and that it includes the
fallback reason text.

## Task 11 — Real hardware verification, exit criteria, and threshold tuning

Mirrors Phase 3's Task 9: automated tests use `demucs_unittest` throughout (fast, offline,
deterministic); this task is what actually proves the phase against the real RTX 5080 and
a real song, and is the one place in this plan that isn't fictional-by-construction from
static reading alone.

1. `uv sync` for real (Task 1's verification steps) if not already done; confirm
   `torch.cuda.is_available()` is `True` on this host.
2. `uv run stemcraft-worker`, watch the boot log for `worker ready on device=cuda` with no
   fallback warning. Confirm via `curl localhost:8000/api/health` (with the API also
   running) that `device` reads `"cuda"` and `fallback_reason` is `null`.
3. Import a real 3-5 minute song through the existing Import screen (file upload). Watch
   the Job Queue screen: the `import` job finishes, and a `separate` job appears queued
   immediately after (Task 9), then runs.
4. Time the `separate` job's `started_at` → `finished_at` and confirm it lands inside
   N-01's **10-30 s on GPU** window for a 3-minute song. If the real `htdemucs` model (not
   `demucs_unittest`) turns out to need a materially different segment/shift configuration
   for that budget, adjust `Separator`'s defaults in `device.py`'s `probe_and_select` — the
   `separate` job kind itself only calls `update_parameter(shifts=0, ...)`, so any further
   tuning (`segment`, `overlap`, `jobs`) belongs in the `Separator(...)` construction, not
   the job kind.
5. Listen to all four stems of that real song. Confirm they sound like the right
   instrument family and that a song with a genuinely near-silent part (or a short
   deliberately-silent test clip) is correctly flagged in the `separate` job's
   `result.near_silent`; tune `NEAR_SILENT_THRESHOLD` in `separate_song.py` by ear if
   `0.02` is clearly wrong in either direction, and record whatever value it settles on.
6. **Cancel mid-separation on the real model.** Enqueue `separate` for a longer file,
   cancel it from the Job Queue screen while it's running, and confirm via `nvidia-smi`
   that GPU memory returns to its idle baseline within a few seconds of the job reaching
   `"cancelled"` (no orphaned VRAM — §9's requirement) and that `stems/` for that song
   contains no files at all (Task 8's design: stems are only written after
   `separate_tensor` returns, so a mid-run cancel can never leave a partial stem).
7. Force the CPU path (temporarily monkeypatch or simply run with `CUDA_VISIBLE_DEVICES=`
   unset/empty so `torch.cuda.is_available()` is `False`) and re-run a separation; confirm
   the banner from Task 10 actually renders in the browser with a real, specific
   `fallback_reason` text — not a placeholder — and that the CPU run still completes,
   inside N-01's **2-4 min** CPU window.
8. Append a "Verification 7 — Phase 4 separation" section to
   [docs/running.md](../../running.md) with the real commands run, their real output
   (boot log lines, `nvidia-smi` before/after cancel, the timing numbers from steps 4 and
   7), and the final `NEAR_SILENT_THRESHOLD` value with a one-line note on whether it
   changed from `0.02` and why.

### Exit criteria (from the roadmap)

- Real stems for a real song inside N-01's window on GPU — step 4.
- A cancel mid-separation lands cleanly with no orphaned VRAM and no partial stems left
  behind — step 6 (both the automated `test_cancel_mid_separation_lands_as_cancelled_not_failed`
  in Task 8 and this real-hardware confirmation).
- Forcing CPU shows the banner with the real fallback reason — step 7 plus Task 10's test.

**Discharges:** C-02 (cu128 floor, Task 1), D-02 (constraints/index pinning, Task 1), R-02
(boot-time real-model inference check turns a kernel mismatch into a startup failure, Task
4 — early signal confirmed in step 2/7 above), R-04 (already resolved in Phase 2 per
`docs/running.md`; re-confirmed trivially here since nothing in this phase touches yt-dlp).

**Re-plan checkpoint** (roadmap, implicitly): Phase 5 (Analysis) needs nothing from this
phase's API beyond `audio.wav` and the four stems already existing on disk. Phase 6 (Song
view) is the first consumer of `near_silent` — currently only available via the
`separate` job's `result` in job history, not yet a Song-level, file-derived fact. Phase
6's plan should decide whether that's durable enough as-is (job history is retained
indefinitely today, per §5) or whether it belongs in a new Song-owned artifact by then.
