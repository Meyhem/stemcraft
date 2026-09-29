---
name: dev-setup
description: Use when setting up or running Stemcraft for development - installing dependencies, starting the worker, API and Vite dev server, running the Python and frontend tests, linting, typechecking, building the frontend or the design system, and capturing README screenshots.
---

# Stemcraft dev setup

Run everything from the repo root. Commands marked (ran) were executed once while writing this
file and worked as written. Commands marked (not run) were documented from `docs/running.md`
and `.claude/launch.json` only.

## Facts that bite

- Python 3.12, managed with `uv`. Node.js with npm for the frontend.
- The GPU is an RTX 5080 (sm_120). CUDA 12.8 or newer is a correctness floor; torch is pinned
  to the cu128 index by `[tool.uv.sources]` plus an explicit index in `pyproject.toml`. Never let a dependency resolve it elsewhere.
- `ffmpeg` and `yt-dlp` must be on `PATH`. Both the API and the worker validate dependencies
  at boot and refuse to start, naming what is missing. The worker also runs one tiny inference
  to prove the device works. Install yt-dlp with `uv tool install yt-dlp` and update it often.
- The API never imports torch; the worker owns all GPU work. See CLAUDE.md for the invariants.

## Install

```bash
uv sync
```
(ran) Python dependencies, including the dev group (pytest, ruff, httpx).

```bash
npm --prefix frontend install
```
(ran) Frontend dependencies.

## Run the three processes (each in its own terminal)

All (not run): ports 8000 and 5173 were held by other processes on the machine this was written on.

```bash
uv run stemcraft-worker
```
The worker has no port and no launch config. A clean boot logs `dependency ok` lines.

```bash
uv run uvicorn stemcraft_api.app:create_app --factory --reload --host 0.0.0.0 --port 8000
```
API on 8000 (`.claude/launch.json` config `api`).

```bash
npm --prefix frontend run dev
```
Vite on 5173, proxying `/api` to 8000 (`launch.json` config `frontend`). Open
<http://localhost:5173>. `launch.json` also has `ui-preview`, which serves `design/ui/dist` on 8777.

Single-origin alternative: build the frontend, then
`STEMCRAFT_DIST_DIR=frontend/dist uv run stemcraft-api` serves it on 8000 (not run).

## Verify

```bash
uv run pytest
```
(ran) Backend, worker, library and `ops/tests`. All tests pass.

```bash
uv run ruff check packages ops
```
(ran) Lint. All checks passed.

```bash
npm --prefix frontend test -- --run
```
(ran) Vitest. All tests pass.

```bash
npm --prefix frontend run typecheck
```
(ran) `tsc --noEmit`.

```bash
npm --prefix frontend run build
```
(ran) Typecheck plus Vite build into `frontend/dist`.

```bash
python3 design/ui/build.py
```
(ran) Builds the design system pages into `design/ui/dist`.

## Screenshots

```bash
node scripts/capture-screens.mjs library=/ song-view=/songs/<id> album-splitter=/splitter/<id> job-queue=/jobs
```
Needs google-chrome on PATH and a running app. It reads `STEMCRAFT_URL` (default
`http://localhost:5173`) and writes `docs/screenshots/<name>.png`. It only loads pages and
clicks nothing. Ran once, for `job-queue=/jobs` only, with `STEMCRAFT_URL` pointed at a
separate API on port 8100 serving the built frontend. The other three were not re-captured.

## Deploying

Not a dev task: see `docs/deploy.md` and `ops/install.sh --dry-run`.
