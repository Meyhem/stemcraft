# Stemcraft Phase 9: Operations — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stemcraft can be installed on the production machine with one command that starts
both processes at boot, the Job queue shows all-time pass/fail counts and average durations
by kind and device, and the deploy and dev-setup procedures are written down from commands
that were actually run.

**Architecture:** One SQL aggregate over `jobs.sqlite` behind `GET /api/jobs/stats`, rendered
as a card row on the existing Job queue screen and refreshed by the WebSocket's existing
`['jobs']` invalidation. An idempotent `ops/install.sh` renders the two systemd user unit
templates with this checkout's paths, enables them, turns on lingering so they start at boot,
and health-checks the result; re-running it is the deploy. Docs close the phase.

**Tech Stack:** Python 3.12 + FastAPI + sqlite3 (stats), React + TanStack Query (card row),
bash + systemd user units (install), pytest drives the install script against fake binaries.
**This phase adds no new dependency to either process.**

**Spec:** The design is recorded in this document's "Decisions this phase makes" section —
this project's convention (CLAUDE.md) is one task-fidelity plan doc per phase. Upstream
sources this plan argues from:
- [the roadmap](2026-09-27-stemcraft-roadmap.md) §"Phase 9 — Operations"
- [design/tech-spec-stemcraft.md](../../../design/tech-spec-stemcraft.md) §10 Operations, D-02
- [design/domain-spec.md](../../../design/domain-spec.md) line "Stats: passed and failed counts…"
- [design/ui-spec.md](../../../design/ui-spec.md) §9 screen 6 "Job queue"
- The mockup [design/ui/src/pages/screens/job-queue.html](../../../design/ui/src/pages/screens/job-queue.html) "stats — all time"

---

## Global Constraints

Copied verbatim from CLAUDE.md and the tech spec. Every task's requirements implicitly
include this section.

- **The API never imports torch.** The stats route is pure sqlite3 in the API process.
- **One writer per file.** The stats query is read-only; it writes nothing.
- **Fail loudly** (N-08). No silent fallbacks. A missing dependency makes `install.sh` exit
  non-zero with the name of what is missing; a unit that does not come up makes it exit
  non-zero and print that unit's journal. A job with no recorded device is shown as "—",
  never folded into "cpu".
- **All file writes are atomic** — the install script writes each rendered unit to a temp
  file in the unit directory, then `mv`s it into place.
- §10: "two systemd user units, API and worker, with restart-on-failure."
- §10 Deploy: "`git pull`, `uv sync`, `npm ci && npm run build` for the SPA (D-12), restart
  both units. Rollback is a checkout of the previous commit."
- §10: "structured logs to the journal … No metrics backend, no alerting, no on-call."
- **Nothing in this phase installs units, enables lingering or runs `sudo` on the dev
  machine** (user ruling, 2026-09-29). Every test of `install.sh` runs it against fake
  `uv`/`npm`/`systemctl`/`loginctl`/`sudo`/`curl` binaries and a temp unit directory.
- Matches existing style: Python formatted per `ruff` (line length 100); frontend matches
  `JobQueue.tsx`; commit trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Decisions this phase makes

- **D9-01 — Stats live on the Job queue screen, not a new screen.** ui-spec §9.6 and the
  mockup already put "stats — all time" there; tech-spec §10 calls the Job queue "the real
  operational dashboard."
- **D9-02 — "Passed" is `state = 'done'`, "failed" is `state = 'failed'`.** Cancelled jobs are
  neither and are not counted (the spec asks for pass/fail only).
- **D9-03 — Average duration covers `done` jobs only**, `finished_at - started_at`, grouped by
  `(kind, device)`. A failed job's duration is time-to-crash, not how long the work takes, and
  would poison the estimate. Rows with a NULL `started_at` or `finished_at` are excluded.
- **D9-04 — Averages are neutral-coloured.** The mockup paints "avg separate · cpu" amber; the
  app does not, because a CPU average is not itself a warning (the CPU-fallback banner is).
  The mockup is changed to match in Task 2.
- **D9-05 — Unit files in the repo are templates.** `ops/systemd/*.service` carry `@REPO@`,
  `@UV@` and `@PATH@`; `install.sh` renders them. Today's files hard-code `%h/dev/stemcraft`,
  which is wrong for any other checkout path.
- **D9-06 — The unit PATH is written explicitly** from the directories of the `uv`, `ffmpeg`
  and `yt-dlp` that `install.sh` resolved, plus `/usr/local/bin:/usr/bin:/bin`. At boot, with
  lingering and no desktop session, the user manager has no login PATH to inherit, and both
  processes refuse to start without `ffmpeg` and `yt-dlp` (C-08-style boot checks).
- **D9-07 — `uv run --no-sync`** in `ExecStart`. `install.sh` has already run
  `uv sync --locked`; a unit must not re-resolve dependencies on every restart.
- **D9-08 — Restart policy:** `Restart=on-failure`, `RestartSec=5`,
  `StartLimitIntervalSec=300`, `StartLimitBurst=10`. A unit whose boot checks keep failing
  gives up after 10 attempts in 5 minutes and shows `failed` in `systemctl --user status`
  rather than looping silently forever — fail loudly.
- **D9-09 — `install.sh` is also the deploy.** It is idempotent: sync, build, re-render units,
  `daemon-reload`, `enable`, `restart`, health-check. Deploy is `git pull && ops/install.sh`;
  rollback is `git checkout <previous> && ops/install.sh`.
- **D9-10 — Lingering:** if `loginctl show-user "$USER" -p Linger --value` is not `yes`, the
  script prints why it needs sudo and runs `sudo loginctl enable-linger "$USER"`.
- **D9-11 — The runbook marks unverified steps.** The roadmap asks for a runbook written
  "against commands that have actually been run." The real prod install is not run in this
  phase (user ruling), so `docs/deploy.md` states which steps were exercised only through the
  fake-binary tests and `--dry-run`, and has a "first real install" checklist for the user.
- **D9-12 — The backup script is out of scope** (user ruling 2026-09-29; roadmap updated in
  1eccca2).

## File structure

| File | Responsibility |
| --- | --- |
| `packages/stemcraft_lib/src/stemcraft_lib/jobs.py` | + `KindDuration`, `JobStats`, `job_stats(conn)` |
| `packages/stemcraft_lib/tests/test_jobs_stats.py` | new — aggregate semantics |
| `packages/stemcraft_api/src/stemcraft_api/routes/jobs.py` | + `GET /api/jobs/stats` |
| `packages/stemcraft_api/tests/test_api.py` | + route test |
| `frontend/src/api/client.ts` | + `JobStats`, `KindDuration` types |
| `frontend/src/api/queries.ts` | + `useJobStats()` under key `['jobs', 'stats']` |
| `frontend/src/screens/JobStats.tsx` + `.module.css` | new — the card row |
| `frontend/src/screens/JobStats.test.tsx` | new |
| `frontend/src/screens/JobQueue.tsx` | renders `<JobStats />` |
| `frontend/src/screens/JobQueue.test.tsx` | fetch mock routes `/api/jobs/stats` |
| `design/ui/src/pages/screens/job-queue.html` | D9-04 neutral averages |
| `ops/systemd/stemcraft-api.service`, `stemcraft-worker.service` | templates (D9-05…08) |
| `ops/install.sh` | new — install and deploy (D9-09, D9-10) |
| `ops/tests/test_install.py` | new — drives `install.sh` against fakes |
| `pyproject.toml` | `testpaths = ["packages", "ops"]` |
| `docs/deploy.md` | new — runbook (D9-11) |
| `.claude/skills/dev-setup/SKILL.md` | new — dev-setup skill |
| `README.md`, `docs/screenshots/job-queue.png`, `scripts/capture-screens.mjs` | README upkeep |

---

### Task 1: Stats aggregate and route

**Files:**
- Modify: `packages/stemcraft_lib/src/stemcraft_lib/jobs.py` (append after `list_jobs`)
- Create: `packages/stemcraft_lib/tests/test_jobs_stats.py`
- Modify: `packages/stemcraft_api/src/stemcraft_api/routes/jobs.py`
- Modify: `packages/stemcraft_api/tests/test_api.py` (append)

**Interfaces:**
- Produces: `jobs.job_stats(conn: sqlite3.Connection) -> JobStats`;
  `GET /api/jobs/stats` → `{"passed": int, "failed": int, "durations": [{"kind": str,
  "device": str | null, "count": int, "avg_seconds": float}]}`, durations ordered by
  `kind`, then `device` (NULL first).

- [ ] **Step 1: Write the failing lib tests**

```python
# packages/stemcraft_lib/tests/test_jobs_stats.py
from stemcraft_lib.jobs import (
    JobStats,
    KindDuration,
    claim_next,
    connect,
    enqueue,
    fail,
    finish,
    job_stats,
    request_cancel,
)


def _run(conn, kind, device, seconds, *, ok=True):
    """Enqueue, claim and finish one job, then pin its timestamps so the duration is exact."""
    job_id = enqueue(conn, kind=kind)
    claim_next(conn, device=device)
    (finish if ok else lambda c, i: fail(c, i, "boom"))(conn, job_id)
    conn.execute(
        "UPDATE jobs SET started_at = 100.0, finished_at = ? WHERE id = ?",
        (100.0 + seconds, job_id),
    )
    return job_id


def test_empty_database_has_zero_counts_and_no_durations(tmp_path):
    assert job_stats(connect(tmp_path / "j.sqlite")) == JobStats(passed=0, failed=0, durations=[])


def test_counts_done_as_passed_and_failed_as_failed_but_not_cancelled_or_live(tmp_path):
    conn = connect(tmp_path / "j.sqlite")
    _run(conn, "probe", "cpu", 1)
    _run(conn, "probe", "cpu", 1)
    _run(conn, "probe", "cpu", 1, ok=False)
    request_cancel(conn, enqueue(conn, kind="probe"))  # queued -> cancelled
    enqueue(conn, kind="probe")  # still queued
    stats = job_stats(conn)
    assert (stats.passed, stats.failed) == (2, 1)


def test_average_is_per_kind_and_device_over_done_jobs_only(tmp_path):
    conn = connect(tmp_path / "j.sqlite")
    _run(conn, "separate", "cuda", 20)
    _run(conn, "separate", "cuda", 30)
    _run(conn, "separate", "cpu", 180)
    _run(conn, "separate", "cuda", 999, ok=False)  # a crash's duration must not count
    _run(conn, "analyze", "cpu", 3)
    assert job_stats(conn).durations == [
        KindDuration(kind="analyze", device="cpu", count=1, avg_seconds=3.0),
        KindDuration(kind="separate", device="cpu", count=1, avg_seconds=180.0),
        KindDuration(kind="separate", device="cuda", count=2, avg_seconds=25.0),
    ]


def test_a_done_job_with_no_device_is_its_own_group_not_cpu(tmp_path):
    conn = connect(tmp_path / "j.sqlite")
    job_id = _run(conn, "probe", "cpu", 4)
    conn.execute("UPDATE jobs SET device = NULL WHERE id = ?", (job_id,))
    _run(conn, "probe", "cpu", 2)
    assert job_stats(conn).durations == [
        KindDuration(kind="probe", device=None, count=1, avg_seconds=4.0),
        KindDuration(kind="probe", device="cpu", count=1, avg_seconds=2.0),
    ]


def test_rows_missing_a_timestamp_are_left_out_of_the_average(tmp_path):
    conn = connect(tmp_path / "j.sqlite")
    job_id = _run(conn, "probe", "cpu", 4)
    conn.execute("UPDATE jobs SET started_at = NULL WHERE id = ?", (job_id,))
    stats = job_stats(conn)
    assert stats.passed == 1
    assert stats.durations == []
```

- [ ] **Step 2: Run them to verify they fail**

Run: `uv run pytest packages/stemcraft_lib/tests/test_jobs_stats.py -v`
Expected: FAIL — `ImportError: cannot import name 'JobStats'`

- [ ] **Step 3: Implement `job_stats`** — append to `jobs.py` after `list_jobs`:

```python
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
```

- [ ] **Step 4: Run the lib tests** — `uv run pytest packages/stemcraft_lib/tests/test_jobs_stats.py -v` → PASS

- [ ] **Step 5: Write the failing route test** — append to `packages/stemcraft_api/tests/test_api.py`:

```python
def test_job_stats_route_reports_counts_and_averages(client):
    conn = jobs_db.connect(settings().jobs_db)
    ok = jobs_db.enqueue(conn, kind="probe")
    jobs_db.claim_next(conn, device="cuda")
    jobs_db.finish(conn, ok)
    conn.execute("UPDATE jobs SET started_at = 10.0, finished_at = 12.5 WHERE id = ?", (ok,))
    bad = jobs_db.enqueue(conn, kind="probe")
    jobs_db.claim_next(conn, device="cuda")
    jobs_db.fail(conn, bad, "boom")
    assert client.get("/api/jobs/stats").json() == {
        "passed": 1,
        "failed": 1,
        "durations": [{"kind": "probe", "device": "cuda", "count": 1, "avg_seconds": 2.5}],
    }
```

(`client` fixture sets `STEMCRAFT_DATA_DIR`, so `settings().jobs_db` is the same file the
app uses — call `settings()` after the fixture has run, as above.)

- [ ] **Step 6: Run it** — `uv run pytest packages/stemcraft_api/tests/test_api.py -k stats -v`
→ FAIL with a 404/422 body mismatch.

- [ ] **Step 7: Add the route** in `routes/jobs.py`, **above** `enqueue_job` (so it is declared
next to `list_jobs`):

```python
@router.get("/api/jobs/stats")
def job_stats(conn: Conn) -> dict:
    return asdict(jobs_db.job_stats(conn))
```

- [ ] **Step 8: Run the full Python suite** — `uv run pytest` → all pass (the torch-boundary
test in `test_api.py` included). `uv run ruff check packages` → clean.

- [ ] **Step 9: Commit**

```bash
git add packages/stemcraft_lib packages/stemcraft_api
git commit -m "feat(jobs): all-time pass/fail counts and average duration by kind and device

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Stats card row on the Job queue

**Files:**
- Modify: `frontend/src/api/client.ts` (after `interface Job`)
- Modify: `frontend/src/api/queries.ts` (after `useJobs`)
- Create: `frontend/src/screens/JobStats.tsx`, `JobStats.module.css`, `JobStats.test.tsx`
- Modify: `frontend/src/screens/JobQueue.tsx`, `JobQueue.test.tsx`
- Modify: `design/ui/src/pages/screens/job-queue.html` line 70 (D9-04)

**Interfaces:**
- Consumes: `GET /api/jobs/stats` (Task 1).
- Produces: `useJobStats()`; `<JobStats />` with `data-testid="job-stats"` (Task 4's
  screenshot waits on it); `formatAverage(seconds: number): string`.

Refresh needs no new wiring: `useJobStream` invalidates every `['jobs', …]` key on each job
event, and the stats key is `['jobs', 'stats']`.

- [ ] **Step 1: Types** — append to `client.ts` after `interface Job`:

```ts
// Mirrors stemcraft_lib.jobs.JobStats / KindDuration (GET /api/jobs/stats).
export interface KindDuration {
  kind: string;
  device: string | null;
  count: number;
  avg_seconds: number;
}

export interface JobStats {
  passed: number;
  failed: number;
  durations: KindDuration[];
}
```

- [ ] **Step 2: Query** — in `queries.ts`, add `type JobStats` to the `./client` import list
and append after `useJobs`:

```ts
// Under ['jobs', ...] on purpose: the job stream invalidates that prefix on every job
// event, so the stats refresh when a job finishes without any wiring of their own.
export function useJobStats() {
  return useQuery({
    queryKey: ['jobs', 'stats'] as const,
    queryFn: () => api.get<JobStats>('/api/jobs/stats'),
  });
}
```

- [ ] **Step 3: Write the failing component tests** — `frontend/src/screens/JobStats.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import { expect, test, vi } from 'vitest';

import { formatAverage, JobStats } from './JobStats';

function renderStats(body: unknown, status = 200) {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status })));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <JobStats />
    </QueryClientProvider>,
  );
}

test('formats averages the way the mockup does', () => {
  expect(formatAverage(2.84)).toBe('2.8 s');
  expect(formatAverage(21.44)).toBe('21.4 s');
  expect(formatAverage(59.96)).toBe('1 m 00 s');
  expect(formatAverage(192)).toBe('3 m 12 s');
  expect(formatAverage(3725)).toBe('1 h 02 m');
});

test('shows passed and failed counts and one card per kind and device', async () => {
  renderStats({
    passed: 312,
    failed: 9,
    durations: [
      { kind: 'separate', device: 'cuda', count: 300, avg_seconds: 21.4 },
      { kind: 'separate', device: 'cpu', count: 2, avg_seconds: 192 },
    ],
  });
  const row = await screen.findByTestId('job-stats');
  expect(within(row).getByText('312')).toBeInTheDocument();
  expect(within(row).getByText('passed')).toBeInTheDocument();
  expect(within(row).getByText('9')).toBeInTheDocument();
  expect(within(row).getByText('avg separate · cuda')).toBeInTheDocument();
  expect(within(row).getByText('21.4 s')).toBeInTheDocument();
  expect(within(row).getByText('3 m 12 s')).toBeInTheDocument();
});

test('a job with no recorded device is labelled with a dash, never as cpu (N-08)', async () => {
  renderStats({
    passed: 1,
    failed: 0,
    durations: [{ kind: 'probe', device: null, count: 1, avg_seconds: 4 }],
  });
  expect(await screen.findByText('avg probe · —')).toBeInTheDocument();
});

test('says so when there is no finished job to average yet', async () => {
  renderStats({ passed: 0, failed: 0, durations: [] });
  expect(await screen.findByText(/no finished jobs yet/i)).toBeInTheDocument();
});

test('shows the real error when the stats cannot be read', async () => {
  renderStats({ detail: 'database is locked' }, 500);
  expect(await screen.findByText(/stats could not be read/i)).toBeInTheDocument();
  expect(screen.getByText(/database is locked/)).toBeInTheDocument();
});
```

Before relying on the last test, check how `request()` in `client.ts` builds its error: the
assertion needs the server's `detail` text to appear in the Banner's `trace`. If `request()`
puts `detail` in the thrown message (it does for other screens' error banners — confirm by
reading it), `String(stats.error)` carries it.

- [ ] **Step 4: Run** — `npm --prefix frontend test -- --run src/screens/JobStats.test.tsx`
→ FAIL, `./JobStats` does not exist.

- [ ] **Step 5: Implement** — `frontend/src/screens/JobStats.tsx`:

```tsx
// "stats — all time" (§10, ui-spec §9.6): pass/fail counts and how long each kind of job
// takes on each device. Averages cover finished jobs only (D9-03) and are neutral-coloured
// (D9-04): a CPU average is information, the CPU-fallback banner is the warning.
import { useJobStats } from '../api/queries';
import { Banner, Card } from '../ui';
import styles from './JobStats.module.css';

export function formatAverage(seconds: number): string {
  const tenths = Math.round(seconds * 10) / 10;
  if (tenths < 60) return `${tenths.toFixed(1)} s`;
  const whole = Math.round(seconds);
  if (whole < 3600) return `${Math.floor(whole / 60)} m ${String(whole % 60).padStart(2, '0')} s`;
  const minutes = Math.round(seconds / 60);
  return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')} m`;
}

function Stat({ value, label, tone }: { value: string; label: string; tone?: 'ok' | 'error' }) {
  return (
    <Card className={styles.stat}>
      <span className={`num ${styles.value} ${tone ? styles[tone] : ''}`}>{value}</span>
      <span className={styles.label}>{label}</span>
    </Card>
  );
}

export function JobStats() {
  const stats = useJobStats();
  if (stats.isError) {
    return <Banner tone="error" title="The job stats could not be read" trace={String(stats.error)} />;
  }
  if (!stats.data) return null;
  const { passed, failed, durations } = stats.data;
  return (
    <section aria-labelledby="job-stats-title">
      <h2 id="job-stats-title" className={styles.caption}>
        stats — all time
      </h2>
      <div className={styles.row} data-testid="job-stats">
        <Stat value={String(passed)} label="passed" tone="ok" />
        <Stat value={String(failed)} label="failed" tone="error" />
        {durations.map((d) => (
          <Stat
            key={`${d.kind}:${d.device ?? ''}`}
            value={formatAverage(d.avg_seconds)}
            label={`avg ${d.kind} · ${d.device ?? '—'}`}
          />
        ))}
      </div>
      {durations.length === 0 && <p className={styles.label}>No finished jobs yet to average.</p>}
    </section>
  );
}
```

Check `../ui` exports a `Card` that accepts `className`; if it does not, use
`<div className={`card ${styles.stat}`}>` (the design system's `.card` class) instead. Check
the `Banner` prop names against `JobQueue.tsx`'s usage (they match as written).

`frontend/src/screens/JobStats.module.css` — values from the mockup's `.stats`/`.stat`:

```css
.caption {
  margin: 0 0 var(--ds-2);
  font: 600 var(--ds-t-xs) / 1 var(--ds-font);
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--ds-text-3);
}

.row {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: var(--ds-4);
}

.stat {
  padding: var(--ds-4);
  display: flex;
  flex-direction: column;
  gap: var(--ds-1);
}

/* U-04: tabular figures, so a changing count does not jitter. */
.value {
  font: 600 var(--ds-t-xl) / 1 var(--ds-mono);
  font-variant-numeric: tabular-nums;
}

.ok {
  color: var(--ds-ok);
}

.error {
  color: var(--ds-error);
}

.label {
  font-size: var(--ds-t-sm);
  color: var(--ds-text-2);
}
```

Before writing `.caption`, read the mockup's `.cap` rule in `design/ui/src/components.css`
and copy its exact values if they differ from the above.

- [ ] **Step 6: Run** the JobStats tests → PASS.

- [ ] **Step 7: Mount it** — in `JobQueue.tsx`, import `JobStats` and render `<JobStats />`
directly after the header `div` (the mockup puts stats above the live queue; if it puts them
below, follow the mockup). Update `JobQueue.test.tsx`'s `renderQueue` fetch mock to answer by
URL, so existing tests keep working:

```tsx
const fetchMock = vi.fn(async (input: RequestInfo | URL) =>
  String(input).includes('/api/jobs/stats')
    ? new Response(JSON.stringify({ passed: 0, failed: 0, durations: [] }))
    : new Response(JSON.stringify({ jobs })),
);
```

and add:

```tsx
test('shows the all-time stats above the queue', async () => {
  renderQueue([job]);
  expect(await screen.findByTestId('job-stats')).toBeInTheDocument();
});
```

Any other test file that renders `JobQueue` (grep `JobQueue` in `frontend/src`, e.g.
`routes.test.tsx`) must also still pass — fix its fetch mock the same way if it breaks.

- [ ] **Step 8: Mockup** — in `design/ui/src/pages/screens/job-queue.html` line 70 remove
`style="color:var(--ds-warn)"` from the `3 m 12 s` value (D9-04). Run
`python3 design/ui/build.py` → builds clean.

- [ ] **Step 9: Full frontend check** — `npm --prefix frontend test -- --run`,
`npm --prefix frontend run typecheck` (or `npx --prefix frontend tsc -b` — use whatever
`package.json` names), `npm --prefix frontend run build` → all pass.

- [ ] **Step 10: Browser check** — start the `api` and `frontend` launch configs, open
`/jobs`, confirm the card row renders real numbers from `data/jobs.sqlite` and the console
is free of errors. Read-only: do not enqueue, cancel or re-run anything.

- [ ] **Step 11: Commit**

```bash
git add frontend design/ui/src/pages/screens/job-queue.html
git commit -m "feat(jobqueue): all-time stats card row

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Unit templates and the install script

**Files:**
- Modify: `ops/systemd/stemcraft-api.service`, `ops/systemd/stemcraft-worker.service`
- Create: `ops/install.sh` (mode 755)
- Create: `ops/tests/test_install.py`
- Modify: `pyproject.toml` — `testpaths = ["packages", "ops"]`

**Interfaces:**
- Produces: `ops/install.sh [--dry-run]`, env overrides `STEMCRAFT_UNIT_DIR` (default
  `$HOME/.config/systemd/user`) and `STEMCRAFT_PORT` (default `8000`, for the health check).
  Units named `stemcraft-api.service` and `stemcraft-worker.service` (Task 4 docs rely on it).

- [ ] **Step 1: Rewrite the templates** (D9-05…08).

`ops/systemd/stemcraft-api.service`:

```ini
# Template: ops/install.sh fills in @REPO@, @UV@ and @PATH@ and installs the result into
# ~/.config/systemd/user/. Do not copy this file by hand.
[Unit]
Description=Stemcraft API
After=network.target
# D9-08: give up after 10 failed starts in 5 minutes, so a boot check that keeps failing
# ends as a visible "failed" unit instead of a silent restart loop (N-08).
StartLimitIntervalSec=300
StartLimitBurst=10

[Service]
Type=simple
WorkingDirectory=@REPO@
# D9-06: at boot there is no login session to inherit PATH from, and the boot checks
# need ffmpeg and yt-dlp on it.
Environment=PATH=@PATH@
Environment=PYTHONUNBUFFERED=1
Environment=STEMCRAFT_DIST_DIR=@REPO@/frontend/dist
# D9-07: install.sh already ran `uv sync --locked`; a restart must not re-resolve.
ExecStart=@UV@ run --no-sync stemcraft-api
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
```

`ops/systemd/stemcraft-worker.service`: identical except `Description=Stemcraft worker`, no
`STEMCRAFT_DIST_DIR` line, and `ExecStart=@UV@ run --no-sync stemcraft-worker`.

- [ ] **Step 2: Write the failing tests** — `ops/tests/test_install.py`. The tests put fake
binaries first on PATH; each fake appends its argv to a shared log and exits 0 (`loginctl
show-user` prints `no`, `curl` succeeds). No real systemctl, loginctl or sudo is ever reached.

```python
"""Drives ops/install.sh against fake binaries. Nothing here touches the real systemd user
manager, lingering or sudo (Phase 9 user ruling): every external command the script calls is
a stub on PATH that records its argv."""

import os
import shutil
import stat
import subprocess
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[2]
SCRIPT = REPO / "ops" / "install.sh"
FAKES = ("uv", "npm", "ffmpeg", "yt-dlp", "systemctl", "loginctl", "sudo", "curl", "journalctl")


def _fake(bin_dir: Path, name: str, log: Path, body: str = "") -> None:
    path = bin_dir / name
    path.write_text(f'#!/bin/sh\necho "{name} $*" >> "{log}"\n{body}\nexit 0\n')
    path.chmod(path.stat().st_mode | stat.S_IEXEC)


@pytest.fixture
def env(tmp_path):
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    log = tmp_path / "calls.log"
    log.touch()
    for name in FAKES:
        _fake(bin_dir, name, log)
    _fake(bin_dir, "loginctl", log, body='[ "$1" = show-user ] && echo no')
    units = tmp_path / "units"
    return {
        "bin": bin_dir,
        "log": log,
        "units": units,
        "vars": {
            "PATH": f"{bin_dir}:/usr/bin:/bin",
            "HOME": str(tmp_path / "home"),
            "USER": "tester",
            "STEMCRAFT_UNIT_DIR": str(units),
        },
    }


def _run(env, *args):
    return subprocess.run(
        ["bash", str(SCRIPT), *args], env=env["vars"], capture_output=True, text=True, timeout=60
    )


def _calls(env):
    return env["log"].read_text().splitlines()


def test_install_renders_both_units_with_this_checkout_and_explicit_path(env):
    result = _run(env)
    assert result.returncode == 0, result.stderr
    for name in ("stemcraft-api.service", "stemcraft-worker.service"):
        text = (env["units"] / name).read_text()
        for placeholder in ("@REPO@", "@UV@", "@PATH@"):
            assert placeholder not in text, text
        assert f"WorkingDirectory={REPO}\n" in text
        assert f"ExecStart={env['bin']}/uv run --no-sync " in text
        path_line = next(ln for ln in text.splitlines() if ln.startswith("Environment=PATH="))
        assert str(env["bin"]) in path_line and "/usr/bin" in path_line
        assert "Restart=on-failure" in text
    assert f"STEMCRAFT_DIST_DIR={REPO}/frontend/dist" in (
        env["units"] / "stemcraft-api.service"
    ).read_text()


def test_install_runs_the_deploy_steps_in_order(env):
    assert _run(env).returncode == 0
    calls = _calls(env)
    order = [
        "uv sync --locked",
        f"npm --prefix {REPO}/frontend ci",
        f"npm --prefix {REPO}/frontend run build",
        "systemctl --user daemon-reload",
        "systemctl --user enable stemcraft-api.service stemcraft-worker.service",
        "systemctl --user restart stemcraft-api.service stemcraft-worker.service",
    ]
    positions = [calls.index(c) for c in order]
    assert positions == sorted(positions), calls


def test_install_enables_lingering_only_when_it_is_off(env):
    assert _run(env).returncode == 0
    assert "sudo loginctl enable-linger tester" in _calls(env)

    env["log"].write_text("")
    _fake(env["bin"], "loginctl", env["log"], body='[ "$1" = show-user ] && echo yes')
    assert _run(env).returncode == 0
    assert not any(c.startswith("sudo") for c in _calls(env))


def test_dry_run_writes_nothing_and_calls_nothing_but_prints_every_step(env):
    result = _run(env, "--dry-run")
    assert result.returncode == 0, result.stderr
    assert not env["units"].exists()
    mutating = [c for c in _calls(env) if not c.startswith(("loginctl show-user",))]
    assert mutating == [], mutating
    for step in ("uv sync --locked", "daemon-reload", "enable-linger", "restart"):
        assert step in result.stdout


def test_a_missing_dependency_stops_the_install_and_names_it(env):
    (env["bin"] / "yt-dlp").unlink()
    result = _run(env)
    assert result.returncode != 0
    assert "yt-dlp" in result.stderr
    assert _calls(env) == []  # refused before touching anything
    assert not env["units"].exists()


def test_a_unit_that_does_not_come_up_fails_the_install_with_its_journal(env):
    _fake(env["bin"], "curl", env["log"], body="exit 7")
    _fake(env["bin"], "journalctl", env["log"], body='echo "boot check failed: ffmpeg"')
    result = _run(env)
    assert result.returncode != 0
    assert "boot check failed: ffmpeg" in result.stdout + result.stderr


@pytest.mark.skipif(shutil.which("systemd-analyze") is None, reason="no systemd-analyze")
def test_rendered_units_pass_systemd_analyze_verify(env):
    assert _run(env).returncode == 0
    result = subprocess.run(
        ["systemd-analyze", "--user", "verify", *sorted(env["units"].glob("*.service"))],
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, result.stderr
```

The health-check wait must be short under test: the script's timeout is controlled by
`STEMCRAFT_HEALTH_TIMEOUT` (seconds, default 60); the "does not come up" test must set it,
so add `env["vars"]["STEMCRAFT_HEALTH_TIMEOUT"] = "2"` at the top of that test.

- [ ] **Step 3: Run them to verify they fail** — add `"ops"` to `testpaths` in
`pyproject.toml`, then `uv run pytest ops -v` → FAIL, `install.sh` not found.

- [ ] **Step 4: Write `ops/install.sh`**:

```bash
#!/usr/bin/env bash
# Install or redeploy Stemcraft as two systemd user units that start at boot (§10, D9-09).
# Idempotent: re-running it IS the deploy. `git pull && ops/install.sh` deploys;
# `git checkout <previous> && ops/install.sh` rolls back.
#
#   ops/install.sh             do it
#   ops/install.sh --dry-run   print every step, change nothing
#
# Env: STEMCRAFT_UNIT_DIR (default ~/.config/systemd/user), STEMCRAFT_PORT (default 8000),
#      STEMCRAFT_HEALTH_TIMEOUT (seconds to wait for the API, default 60).
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
UNIT_DIR="${STEMCRAFT_UNIT_DIR:-$HOME/.config/systemd/user}"
PORT="${STEMCRAFT_PORT:-8000}"
HEALTH_TIMEOUT="${STEMCRAFT_HEALTH_TIMEOUT:-60}"
UNITS=(stemcraft-api.service stemcraft-worker.service)
DRY=0
[[ "${1:-}" == "--dry-run" ]] && DRY=1

run() {
  echo "+ $*"
  if (( ! DRY )); then "$@"; fi
}

die() {
  echo "install.sh: $*" >&2
  exit 1
}

# N-08: refuse before touching anything if a dependency is missing.
declare -A BIN
for tool in uv npm ffmpeg yt-dlp systemctl loginctl curl; do
  BIN[$tool]="$(command -v "$tool")" || die "missing dependency: $tool is not on PATH"
done

# D9-06: the units get an explicit PATH -- at boot there is no login session to inherit it.
unit_path=""
for tool in uv ffmpeg yt-dlp; do
  dir="$(dirname "${BIN[$tool]}")"
  case ":$unit_path:" in *":$dir:"*) ;; *) unit_path="${unit_path:+$unit_path:}$dir" ;; esac
done
unit_path="$unit_path:/usr/local/bin:/usr/bin:/bin"

cd "$REPO"
run uv sync --locked
run npm --prefix "$REPO/frontend" ci
run npm --prefix "$REPO/frontend" run build

for unit in "${UNITS[@]}"; do
  echo "+ render ops/systemd/$unit -> $UNIT_DIR/$unit"
  if (( ! DRY )); then
    mkdir -p "$UNIT_DIR"
    tmp="$(mktemp "$UNIT_DIR/.$unit.XXXXXX")"
    sed -e "s|@REPO@|$REPO|g" -e "s|@UV@|${BIN[uv]}|g" -e "s|@PATH@|$unit_path|g" \
      "$REPO/ops/systemd/$unit" > "$tmp"
    mv "$tmp" "$UNIT_DIR/$unit"  # atomic: temp file then rename
  fi
done

run systemctl --user daemon-reload
run systemctl --user enable "${UNITS[@]}"

# D9-10: lingering lets the user manager start these at boot and keep them after logout.
if [[ "$(loginctl show-user "$USER" -p Linger --value 2>/dev/null || true)" != "yes" ]]; then
  echo "Lingering is off for $USER; enabling it needs sudo so the units start at boot."
  run sudo loginctl enable-linger "$USER"
fi

run systemctl --user restart "${UNITS[@]}"

if (( DRY )); then
  echo "+ wait for http://127.0.0.1:$PORT/api/health"
  exit 0
fi

for (( i = 0; i < HEALTH_TIMEOUT; i++ )); do
  if curl -fsS "http://127.0.0.1:$PORT/api/health" > /dev/null 2>&1; then
    systemctl --user is-active --quiet stemcraft-worker.service \
      || { journalctl --user -u stemcraft-worker.service -n 50 --no-pager; die "the worker is not running"; }
    echo "Stemcraft is up on http://$(hostname):$PORT"
    exit 0
  fi
  sleep 1
done
journalctl --user -u stemcraft-api.service -n 50 --no-pager
die "the API did not answer on port $PORT within ${HEALTH_TIMEOUT}s"
```

`chmod +x ops/install.sh`. Note the fake `systemctl` in the tests exits 0 for
`is-active`, which is what a healthy worker returns.

- [ ] **Step 5: Run** — `uv run pytest ops -v` → all PASS. Then
`uv run pytest` (whole suite) → PASS. If `shellcheck` is installed, `shellcheck ops/install.sh`
→ clean; it is not a requirement.

- [ ] **Step 6: Dry run for real** — `ops/install.sh --dry-run` on the dev machine. It resolves
the real tools and prints the steps; it changes nothing (D9-11 records this). Paste the output
into Task 4's runbook.

- [ ] **Step 7: Commit**

```bash
git add ops pyproject.toml
git commit -m "feat(ops): install script renders and enables the systemd units, starts at boot

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Runbook, dev-setup skill, README

**Files:**
- Create: `docs/deploy.md`
- Create: `.claude/skills/dev-setup/SKILL.md`
- Modify: `README.md`, `scripts/capture-screens.mjs`, `docs/running.md` (only if it tells the
  reader to copy `ops/systemd/*.service` by hand — point it at `ops/install.sh` instead)
- Create: `docs/screenshots/job-queue.png`

**Interfaces:**
- Consumes: `ops/install.sh` and its env vars (Task 3), `data-testid="job-stats"` (Task 2).

- [ ] **Step 1: `docs/deploy.md`** — sections, each with the exact commands:
  1. *Requirements on the prod machine* — same list as README "Run locally", plus systemd and
     sudo for the one lingering command.
  2. *First install* — `git clone …`, `cd stemcraft`, `ops/install.sh --dry-run`, then
     `ops/install.sh`. Paste the real `--dry-run` output from Task 3 Step 6.
  3. *Deploy* — `git pull && ops/install.sh`.
  4. *Rollback* — `git log --oneline`, `git checkout <commit> && ops/install.sh`, then back to
     `main` with `git checkout main` once fixed. Model weights live outside the repo and
     survive (§10).
  5. *Status and logs* — `systemctl --user status stemcraft-api stemcraft-worker`,
     `journalctl --user -u stemcraft-worker -f`, and what a unit that hit the start limit
     looks like plus `systemctl --user reset-failed <unit>` (D9-08).
  6. *yt-dlp updates* — link to the note in `docs/running.md`; after updating, restart the
     units (`systemctl --user restart stemcraft-api stemcraft-worker`).
  7. *What has and has not been run* (D9-11) — a table: every step above, and whether it was
     run for real on the dev machine, exercised only by `ops/tests/test_install.py` against
     fakes, or only by `--dry-run`. Then a short "first real install" checklist for the
     user: dry-run output looks right; after install `systemctl --user is-enabled` shows both
     `enabled`; `loginctl show-user $USER -p Linger` shows `yes`; reboot, and without
     logging in, `curl http://<host>:8000/api/health` answers from another machine.

- [ ] **Step 2: `.claude/skills/dev-setup/SKILL.md`** — frontmatter
`name: dev-setup` and a `description:` that says when to use it (setting up or running
Stemcraft for development: install, run the three processes, test, capture screenshots).
Body: only commands actually run in this session, each with what it proves — `uv sync`,
`npm --prefix frontend install`, the three dev processes (worker, API, Vite; name the
`.claude/launch.json` configs), `uv run pytest`, `uv run ruff check packages ops`,
`npm --prefix frontend test -- --run`, the typecheck and build commands, `python3
design/ui/build.py`, `node scripts/capture-screens.mjs …`. Include the hard facts from
CLAUDE.md that bite during setup (CUDA ≥ 12.8 cu128 constraint, Python 3.12, ffmpeg and
yt-dlp on PATH, both processes refuse to start on a missing dependency). Run each command
once while writing it and fix any that does not work as written.

- [ ] **Step 3: Screenshot** — add `'job-queue': '[data-testid="job-stats"]'` to `READY` in
`scripts/capture-screens.mjs`. With API and Vite running, run
`node scripts/capture-screens.mjs job-queue=/jobs`. Read-only — the script loads pages and
clicks nothing. Look at the PNG before committing it.

- [ ] **Step 4: README** —
  - Feature bullets: add the Job queue's all-time stats if the bullets list screens.
  - Screens: add `![Job queue](docs/screenshots/job-queue.png)`; change "All three" to "All
    four"; add `job-queue=/jobs` to the capture command.
  - New section "Deploy" after "Run locally": one paragraph — `ops/install.sh` installs two
    systemd user units that start at boot and restart on failure; `git pull &&
    ops/install.sh` redeploys — linking `docs/deploy.md`.
  - "More": add `docs/deploy.md`.

- [ ] **Step 5: Verify the docs** — every command in `docs/deploy.md` and the skill either
was run or is marked as not run in section 7; every file path they mention exists
(`ls` each). `uv run pytest` and `npm --prefix frontend test -- --run` still pass.

- [ ] **Step 6: Commit and push** (CLAUDE.md standing authorization; README upkeep is part of
this push):

```bash
git add docs/deploy.md .claude/skills/dev-setup README.md docs/screenshots/job-queue.png scripts/capture-screens.mjs docs/running.md
git commit -m "docs(ops): deploy runbook, dev-setup skill, job queue in the README

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push origin main
```

---

## Out of scope

- Backup script (D9-12).
- Actually installing the units, enabling lingering or rebooting on any machine — the user
  does the first real install on prod with the checklist in `docs/deploy.md` §7.
- Job-history pruning (tech-spec §12) — the stats depend on full history.
- Re-run button and "Copy traceback" from the mockup's failed-job card — not part of the
  roadmap's Phase 9 bullets.
