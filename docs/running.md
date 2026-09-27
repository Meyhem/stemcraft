# Running Stemcraft

This is a record of the commands that were actually run to bring up the whole
system (worker, API, frontend) and prove D-15 (dev/prod parity) and §9
(crash recovery) against real processes, not mocks. Every command and every
block of output below is a literal transcript from that verification run
(2026-09-27), not an aspirational description. Where output has been
truncated it's noted.

Prerequisite dependencies on the host for anything below to boot at all:
`ffmpeg` (audio I/O, C-04) and `yt-dlp` (C-08) must both be on `PATH`, and
`uv sync` / `npm --prefix frontend install` must have been run once.

## The three processes

There is no launch configuration for the worker — it has no port — so it's
always started directly:

```bash
uv run stemcraft-worker
```

The other two are launch configs in `.claude/launch.json` (`api`, `frontend`)
but can be run by hand identically:

```bash
# API — port 8000
uv run uvicorn stemcraft_api.app:create_app --factory --reload --host 0.0.0.0 --port 8000

# Frontend dev server — port 5173, proxies /api (incl. websocket upgrade) to :8000
npm --prefix frontend run dev
```

In production there is no Vite process at all: the frontend is built once and
FastAPI serves the bundle itself from the same origin as the API (port 8000).
`STEMCRAFT_DIST_DIR` tells the API where to find it:

```bash
npm --prefix frontend run build
STEMCRAFT_DIST_DIR=frontend/dist uv run stemcraft-api
```

This is the whole of D-15: in dev, two origins (5173 and 8000) held together
by a proxy; in prod, one origin (8000) serving both the API and the static
bundle. Neither mode runs any CORS middleware — there is none in the
codebase — which is checked explicitly below.

## Verification 1 — dev path (D-15, dev half)

Started, in order, in separate background shells:

```bash
uv run stemcraft-worker
```
```
2026-09-27 16:31:04,855 INFO stemcraft.worker dependency ok: ffmpeg (/usr/bin/ffmpeg)
2026-09-27 16:31:04,855 INFO stemcraft.worker dependency ok: data_dirs (/home/meyhem/dev/stemcraft/data, /home/meyhem/dev/stemcraft/songs)
2026-09-27 16:31:04,855 INFO stemcraft.worker dependency ok: sqlite_wal (/home/meyhem/dev/stemcraft/data/jobs.sqlite)
2026-09-27 16:31:04,855 INFO stemcraft.worker dependency ok: yt-dlp (/home/meyhem/.local/bin/yt-dlp (2026.08.19))
2026-09-27 16:31:04,858 INFO stemcraft.worker worker ready on device=cpu, polling /home/meyhem/dev/stemcraft/data/jobs.sqlite
```

```bash
uv run uvicorn stemcraft_api.app:create_app --factory --reload --host 0.0.0.0 --port 8000
```
```
INFO:     Will watch for changes in these directories: ['/home/meyhem/dev/stemcraft']
INFO:     Uvicorn running on http://0.0.0.0:8000 (Press CTRL+C to quit)
INFO:     Started reloader process [142402] using WatchFiles
INFO:     Started server process [142404]
INFO:     Waiting for application startup.
INFO:     Application startup complete.
```

```bash
npm --prefix frontend run dev
```
```
  VITE v6.4.3  ready in 132 ms
  ➜  Local:   http://localhost:5173/
```

Health through the Vite proxy:

```bash
curl -s localhost:5173/api/health | head -c 500
```
```
{"deps":[{"name":"ffmpeg","ok":true,"detail":"/usr/bin/ffmpeg"},{"name":"data_dirs","ok":true,"detail":"/home/meyhem/dev/stemcraft/data, /home/meyhem/dev/stemcraft/songs"},{"name":"sqlite_wal","ok":true,"detail":"/home/meyhem/dev/stemcraft/data/jobs.sqlite"},{"name":"yt-dlp","ok":true,"detail":"/home/meyhem/.local/bin/yt-dlp (2026.08.19)"}],"device":null,"sample_rate":48000}
```

CORS absence, hit directly on the API origin with a foreign `Origin` header:

```bash
curl -sI -H 'Origin: http://example.com' localhost:8000/api/health | grep -i access-control || echo "no CORS header, as intended"
```
```
no CORS header, as intended
```

Browser check at `http://localhost:5173/jobs` (real Chromium, not a mock):
clicking "Enqueue probe job" created job 1 (`kind=probe`, default payload,
10 steps × 0.5s). Re-reading the page a few seconds later — no reload, no
further interaction — showed it having advanced from `1.2 s` (running) to
`5.0 s` (done), proving the WebSocket push (`/api/ws`, same-origin, proxied
with `ws: true`) works through Vite. To test Cancel without racing the
default job's ~5s runtime, a longer synthetic job was enqueued directly and
cancelled shortly after:

```bash
curl -s -X POST localhost:8000/api/jobs -H 'content-type: application/json' -d '{"kind":"probe","payload":{"steps":30,"step_seconds":1}}'
# -> {"id":3}
sleep 1.5
curl -s -X POST localhost:8000/api/jobs/3/cancel
# -> {"id":3,"state":"running"}
```

The Job Queue screen at `localhost:5173/jobs` then showed job 3 flip to
`cancelled` at `2.0 s` with no reload — confirming the browser UI reflects
both progress and cancellation live over the proxied socket. Worker log for
the whole sequence:

```
2026-09-27 16:32:23,394 INFO stemcraft.worker job 1 (probe) done
2026-09-27 16:32:48,406 INFO stemcraft.worker job 2 (probe) done
2026-09-27 16:33:26,423 INFO stemcraft.worker job 3 (probe) cancelled at a checkpoint
```

## Verification 2 — crash recovery (§9) against the real processes

```bash
curl -s -X POST localhost:8000/api/jobs -H 'content-type: application/json' -d '{"kind":"probe","payload":{"steps":60,"step_seconds":1}}'
# -> {"id":4}
```

Confirmed running with a live lease:

```json
{"id":4,"state":"running","progress":0.1167,"lease_until":1790519670.94,...}
```

Then the worker was killed hard (both the `uv run` wrapper PID and the
actual `stemcraft-worker` PID underneath it — `uv run` does not exec in
place here, it forks a child):

```bash
kill -9 142316 142320
```

`ps` and `lsof data/jobs.sqlite` afterward showed no worker process left
holding the database. Polling the job over the next several seconds showed
progress frozen at `0.2833` (the last state written before the kill) while
`lease_until` (1790519680.94) slipped into the past — the lease had expired
and nothing was renewing it. The restarted worker:

```bash
uv run stemcraft-worker
```
```
2026-09-27 16:34:57,458 INFO stemcraft.worker dependency ok: ffmpeg (/usr/bin/ffmpeg)
2026-09-27 16:34:57,458 INFO stemcraft.worker dependency ok: data_dirs (/home/meyhem/dev/stemcraft/data, /home/meyhem/dev/stemcraft/songs)
2026-09-27 16:34:57,458 INFO stemcraft.worker dependency ok: sqlite_wal (/home/meyhem/dev/stemcraft/data/jobs.sqlite)
2026-09-27 16:34:57,458 INFO stemcraft.worker dependency ok: yt-dlp (/home/meyhem/.local/bin/yt-dlp (2026.08.19))
2026-09-27 16:34:57,458 INFO stemcraft.worker worker ready on device=cpu, polling /home/meyhem/dev/stemcraft/data/jobs.sqlite
```

Re-checking job 4 a few seconds after that restart:

```json
{
  "id": 4, "state": "running", "progress": 0.3667,
  "created_at": 1790519640.78,
  "started_at": 1790519697.46,
  "lease_until": 1790519747.46
}
```

`created_at` is unchanged (same job row, id 4) but `started_at` jumped
forward to the worker's restart time and `progress` is climbing again from
near zero — `reclaim_expired()` (called at the top of every `run_one()`
poll, `packages/stemcraft_lib/src/stemcraft_lib/jobs.py`) requeued it
(`state='queued', progress=0, started_at=NULL`) as soon as its expired
lease was noticed, and `claim_next()` picked it straight back up. The Job
Queue screen (still open, no reload) showed the job flip from stalled
`running` straight to a fresh `running` climb without any user action.

**Resolved:** the brief's expected behaviour says "the restarted worker logs
a reclaim." At the time this verification was first run, `reclaim_expired()`
(`packages/stemcraft_lib/src/stemcraft_lib/jobs.py:236`) returned the list of
reclaimed job ids but neither it nor its caller in
`packages/stemcraft_worker/src/stemcraft_worker/main.py::run_one` logged
anything when that list was non-empty — the mechanism was correct (job
requeued, progress reset, re-run from the start, visible live in the UI, all
verified above) but there was no explicit "reclaimed job 4" log line to grep
for operationally. `run_one` now logs
`"reclaimed expired lease(s) for job(s): %s"` at INFO on `stemcraft.worker`
whenever `reclaim_expired()` returns a non-empty list, covered by
`test_reclaimed_lease_is_logged_at_restart` and
`test_no_reclaim_log_when_nothing_is_expired` in
`packages/stemcraft_worker/tests/test_worker_loop.py`.

The job was cancelled afterward to avoid waiting out its full 60s runtime:

```bash
curl -s -X POST localhost:8000/api/jobs/4/cancel
# -> {"id":4,"state":"cancelled","progress":0.7,...}
```

## Verification 3 — production path (D-15, prod half)

Dev API and Vite were stopped first (port 8000 freed) and the worker left
running so the job queue would still be live.

```bash
npm --prefix frontend run build
```
```
✓ 99 modules transformed.
dist/index.html                   0.39 kB │ gzip:  0.26 kB
dist/assets/index-TkJETGRm.css    3.16 kB │ gzip:  1.21 kB
dist/assets/index-lIGNVHia.js   308.39 kB │ gzip: 97.75 kB │ map: 1,727.31 kB
✓ built in 628ms
```

```bash
STEMCRAFT_DIST_DIR=frontend/dist uv run stemcraft-api
```
```
INFO:     Started server process [144523]
INFO:     Waiting for application startup.
INFO:stemcraft.api:dependency ok: ffmpeg (/usr/bin/ffmpeg)
INFO:stemcraft.api:dependency ok: data_dirs (/home/meyhem/dev/stemcraft/data, /home/meyhem/dev/stemcraft/songs)
INFO:stemcraft.api:dependency ok: sqlite_wal (/home/meyhem/dev/stemcraft/data/jobs.sqlite)
INFO:stemcraft.api:dependency ok: yt-dlp (/home/meyhem/.local/bin/yt-dlp (2026.08.19))
INFO:     Application startup complete.
INFO:     Uvicorn running on http://0.0.0.0:8000 (Press CTRL+C to quit)
```

With no Vite process running at all:

```bash
curl -s -o /dev/null -w "status=%{http_code} content-type=%{content_type}\n" localhost:8000/
# status=200 content-type=text/html; charset=utf-8   (index.html, the built app)

curl -s -o /dev/null -w "status=%{http_code} content-type=%{content_type}\n" localhost:8000/jobs
# status=200 content-type=text/html; charset=utf-8   (same index.html — SPA fallback,
# i.e. a hard reload on a client-side route still works)

curl -s -o /dev/null -w "status=%{http_code} content-type=%{content_type}\n" localhost:8000/api/nope
curl -s localhost:8000/api/nope
# status=404 content-type=application/json
# {"detail":"no API route /api/nope"}

curl -sI -H 'Origin: http://example.com' localhost:8000/api/health | grep -i access-control || echo "no CORS header, as intended"
# no CORS header, as intended
```

Opened `http://localhost:8000/jobs` in a real browser (same origin as the
API, no proxy involved): prior job history (from the dev-path run above,
same `data/jobs.sqlite`) rendered immediately. Clicking "Enqueue probe job"
created a new job that progressed to `done` with no reload — confirming the
same-origin WebSocket (`ws://localhost:8000/api/ws`) works identically in
production, exercised by the actual built bundle rather than the dev
server.

## Verification 4 — refuse-to-start (N-08)

`uv`'s own binary lives outside the standard system directories
(`~/.local/bin/uv` on this host), so `PATH=/nonexistent uv run stemcraft-api`
as literally written fails with "command not found" on `uv` itself rather
than exercising the app's dependency check. Adapted by resolving `uv`'s
absolute path first and invoking that directly with the broken `PATH`:

```bash
UV_ABS=$(command -v uv)   # /home/meyhem/.local/bin/uv
PATH=/nonexistent "$UV_ABS" run stemcraft-api
echo "exit: $?"
```
```
INFO:     Started server process [144897]
INFO:     Waiting for application startup.
ERROR:    Traceback (most recent call last):
  ...
  File "/home/meyhem/dev/stemcraft/packages/stemcraft_api/src/stemcraft_api/app.py", line 28, in lifespan
    for check in assert_ready():
  File "/home/meyhem/dev/stemcraft/packages/stemcraft_lib/src/stemcraft_lib/deps.py", line 118, in assert_ready
    raise DependencyError(f"refusing to start; unmet dependencies:\n{lines}")
stemcraft_lib.deps.DependencyError: refusing to start; unmet dependencies:
  - ffmpeg: ffmpeg is not on PATH (C-04: the only audio I/O path)
  - yt-dlp: yt-dlp is not on PATH (C-08: required, keep it updated)
ERROR:    Application startup failed. Exiting.
exit: 3
```

Both unmet dependencies (ffmpeg and yt-dlp) are named, not just the first —
`assert_ready()` collects every failed `DepCheck` before raising. Exit code
is non-zero (3, uvicorn's convention for a failed startup).

The same check against the worker:

```bash
PATH=/nonexistent "$UV_ABS" run stemcraft-worker
echo "exit: $?"
```
```
2026-09-27 16:37:17,879 ERROR stemcraft.worker refusing to start; unmet dependencies:
  - ffmpeg: ffmpeg is not on PATH (C-04: the only audio I/O path)
  - yt-dlp: yt-dlp is not on PATH (C-08: required, keep it updated)
exit: 1
```

## A note on yt-dlp

`assert_ready()` requires yt-dlp on `PATH` unconditionally
(`require_yt_dlp` defaults to `True` in both `stemcraft_api.app.lifespan` and
`stemcraft_worker.main.main`, and neither caller overrides it). On the host
this verification ran on, yt-dlp was not installed at the start of the
session — which would have made both the API and the worker refuse to start
even for the dev/prod checks above, not just for the deliberate Step 6 test.
It was installed for this run with `uv tool install yt-dlp` (placing the
binary in `~/.local/bin`, already on `PATH` alongside `uv` itself) so that
Verifications 1, 2 and 3 could exercise a genuinely healthy boot. Anyone
reproducing this on a fresh machine needs to do the same before the API or
worker will start at all.

## Summary

| What | Port | Dev | Prod |
|---|---|---|---|
| Worker | none | `uv run stemcraft-worker` | same |
| API | 8000 | `uv run uvicorn stemcraft_api.app:create_app --factory --reload --host 0.0.0.0 --port 8000` | `STEMCRAFT_DIST_DIR=frontend/dist uv run stemcraft-api` |
| Frontend | 5173 (dev only) | `npm --prefix frontend run dev` (proxies `/api` incl. websockets to :8000) | not run — API serves `frontend/dist` directly on :8000 |

All four checks above passed against the real, running system:
1. Dev serves through the Vite proxy on `:5173`; no CORS header on `:8000`.
2. `kill -9` on the worker mid-job reclaims the lease and re-runs the job
   from the start (progress reset, new `started_at`), visible live in the UI.
3. Prod serves the built bundle from FastAPI on `:8000` with SPA fallback on
   client-side routes, JSON (not HTML) on unknown `/api/*` paths, and no CORS
   header.
4. Both processes refuse to start (non-zero exit) when ffmpeg and yt-dlp are
   both unreachable, naming both in the log — not just the first.
