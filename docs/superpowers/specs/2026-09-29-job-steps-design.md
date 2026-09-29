# Job steps and the Import modal — design

**Status:** approved in brainstorming, 2026-09-29.
**Mockups:** `design/ui/src/pages/screens/job-queue.html`, `design/ui/src/pages/screens/import.html`.
**Decision:** D-17 in `design/tech-spec-stemcraft.md`.

## Problem

1. Import is a full-page route with two separate forms (file, URL). The UI spec (§6.2)
   wants a modal that shows the pipeline as explicit steps. This is audit finding F21,
   which the conformance plan deferred.
2. A job reports a single anonymous `progress` float. The job kinds all work in clear
   phases (download → decode → peaks, key → beats → chords, …), but nobody outside the
   worker can see which phase is running, how long each took, or which one failed.

## Goals

- Every job, of every kind, shows its named steps in real time: done / running with
  live % / pending / failed with the real error / skipped with a reason / cancelled
  with where it stopped. Durations are shown per step.
- The Job queue shows these steps per job (one row per job, expandable).
- Import becomes a modal over the current page. It has one form with one source zone
  that takes a file or a link. After submit it shows the song's `import`, `separate`
  and `analyze` jobs as step groups. The data and the component are the same ones the
  Job queue uses.

## Non-goals

- No pipeline grouping of jobs in the Job queue (rejected in brainstorming: one row
  per job).
- No Re-run action. The existing job-queue mockup's Re-run button is removed; it needs
  its own endpoint and is not part of this feature.
- No per-step stats. `/api/jobs/stats` is unchanged.
- No client-side tag probing. Title and artist are still filled in by the server from
  the file's tags when left blank.

## Data: steps on the job row

`jobs` gains one column, `steps TEXT`: a JSON list of step objects.

```json
{"id": "decode", "label": "Decode to 48 kHz", "weight": 0.6,
 "state": "running", "progress": 0.4, "detail": null,
 "started_at": 1759140000.1, "finished_at": null}
```

- `state` is one of `pending | running | done | failed | skipped | cancelled`.
- `detail` is optional short text from the worker, such as "segment 11 of 17",
  "track 4 of 11" or "bass.opus". For `skipped` it is the reason. The UI never
  invents it.
- `jobs.sqlite` schema version goes from 1 to 2. The migration is
  `ALTER TABLE jobs ADD COLUMN steps TEXT`. Rows written before the migration have
  `steps = NULL`, which the API returns as `[]`, and the UI says "No step record".

### Declarations

`stemcraft_lib/job_steps.py` (torch-free, importable by the API) declares each kind's
steps as `(id, label, weight)`:

| kind | steps (weight) |
|---|---|
| `import` | download "Download" (0.3) · decode "Decode to 48 kHz" (0.6) · peaks "Waveform peaks" (0.1) |
| `separate` | load "Load audio" (0.02) · separate "Separate 4 stems" (0.9) · write "Write stems" (0.08) |
| `analyze` | key "Key" (0.3) · beats "Beat grid" (0.3) · chords "Chords" (0.35) · write "Write analysis" (0.05) |
| `export` | render "Render & encode" (1.0) |
| `import_album` | decode "Decode to 48 kHz" (0.5) · peaks "Waveform peaks" (0.3) · silences "Find silences" (0.2) |
| `split_album` | tracks "Render tracks" (0.95) · zip "Build zip" (0.05) |
| `probe` | tick "Tick" (1.0) |

`declare(kind, steps)` adds a declaration at runtime, which is how worker tests declare
their `t_*` kinds.

### Lifecycle and who writes

- **Seed (API or worker, at enqueue).** `jobs.enqueue()` writes every declared step as
  `pending`. Enqueuing an undeclared kind raises `UnknownJobKind`, and
  `POST /api/jobs` turns that into a 422 carrying the message. This is the only time
  the API writes `steps`.
- **Advance (worker only).**
  - `ctx.step(id, detail=None)` closes the running step as `done` and opens `id` as
    `running`. Steps can only go forward in declaration order. Any step passed over
    is an error, unless it was skipped with `ctx.skip(id, reason)`.
  - `ctx.progress(f)` now means progress within the current step.
  - `ctx.detail(text)` updates the current step's detail without advancing.
  - Each write also stores the job's overall `progress`, computed as
    `Σ weight·step_progress / Σ weight`, where skipped steps are left out of the
    denominator. Stats, Library cards and the old single bar keep working unchanged.
- **Finish.** The worker loop calls `ctx.complete()` after the kind returns. It closes
  the running step, and if any step is still `pending` it raises (a kind that forgot a
  step is a bug, N-08). The job then fails with that message instead of finishing.
- **Fail.** `jobs.fail()` marks the running step `failed`. The traceback stays in
  `error`, and the UI draws it under the failed step.
- **Cancel.**
  - A running job: `jobs.cancelled()` marks the running step `cancelled`, keeping its
    `detail`, for example "stopped after 4 of 11".
  - A queued job: its steps stay `pending`, and the job's own `cancelled` state says
    enough.
- **Reclaim.** `reclaim_expired()` re-seeds `steps` from the declaration, because the
  job re-runs from the top (idempotent by re-derivation). This matches how `progress`
  already resets to 0.

This keeps invariant 2: the API writes `steps` only when it creates a row, just as it
already writes `payload`. Everything after that is the worker's. Steps are job
progress, not song state, so "derive song state from files" is unaffected.

### Transport

Unchanged. The websocket already pushes a job snapshot whenever `data_version` bumps
(250 ms poll), and the SPA refetches `['jobs', …]` on every message. Steps travel
inside the `Job` object, via `asdict`.

### API additions

- `GET /api/jobs?song_id=<id>` filters by song, for the modal and for `/jobs?song=`.
- `GET /api/job-kinds` returns the declarations, so the modal can draw pending groups
  for jobs that haven't been queued yet (`separate` and `analyze` are queued by the
  worker only after the previous job finishes).

## UI

### StepList (new, `frontend/src/ui/StepList.tsx`)

- One component, used by the Job queue and the modal.
- Each row: a mark, the label, the detail, and a duration on the right.
- The running step shows its live % on the right and its own bar underneath.
- A failed step shows a `Banner`/trace for the job's `error` under it.
- The marks mean the same everywhere:
  - ✓ done (ok)
  - ● running (accent)
  - ○ pending
  - ! failed (error)
  - dashed – skipped, label struck through, reason on the right
  - ■ cancelled, with its detail
- The compact form is `StepStrip`: one small segment per step, for collapsed rows.

### Job queue

- One row per job, as now, plus a disclosure button (`aria-expanded`).
- The running job is expanded by default. The others are collapsed, each showing a
  `StepStrip`.
- The live row shows "step n of m · x% overall".
- A failed row says "failed at step n of m · <label>", and its traceback moves under
  the failed step. The separate banner list is removed.
- History rows expand the same way.
- `/jobs?song=<id>` shows only that song's jobs, all expanded, with a "Show all jobs"
  link.

### Import modal

- `/import` stays a route (D-14) and renders as a modal over the background location
  (React Router's `state.background`). A direct visit draws the Library underneath.
- Closing it goes back to the background location, or to `/` if there is none. It
  closes on ✕, Cancel, Esc or a scrim click.
- `ui/Modal.tsx` wraps the native `<dialog>` with `showModal()`, which gives focus
  trap, Esc and an inert background without a library. This settles Q-05 for dialogs
  only.
- **Form state.** There is one source zone. Choosing a file clears the link, and
  pasting a link clears the file. Once a source is chosen, the zone collapses to a row
  with a Replace button. Title and Artist are shared fields. Title is required only for
  a link, and the hint says why. There is one primary button, "Import & separate",
  which calls `useCreateSongFromUpload` or `useCreateSongFromUrl`.
- **Progress state.** After submit, the header shows the song's title and artist, and
  the body shows three groups: `import`, `separate` and `analyze`.
  - Each group draws its job's steps with `StepList` from `useJobs({songId})`, taking
    the newest job of each kind created at or after the import job.
  - A group whose job doesn't exist yet draws the declared steps, all pending, with
    "not queued yet".
  - If a job fails, the later groups collapse to a single line: "won't run: <kind>
    failed".
  - The footer has "Open job queue" (to `/jobs?song=<id>`) and "Close", plus the note
    "Closing won't stop the import".
  - "Open song" is enabled once `analyze` is done.
- The nav keeps its "Import" entry, which opens the modal over the current page.

## Error handling (N-08)

- Undeclared kind at enqueue: 422 with the message.
- Unknown step id, a step out of order, or a step left pending at return: the job fails
  with that message and its traceback, visible in the queue and the modal.
- Upload validation errors: shown inline in the form, as today.
- Job failures: the real `error` text under the failed step, in both views.

## Testing

- **lib:**
  - Seeding at enqueue.
  - `UnknownJobKind`.
  - Migration from v1 to v2, with old rows having `steps = []`.
  - A v3 database is still refused.
  - Advance, skip, detail, and the weighted overall progress (including with a step
    skipped).
  - Complete with a step pending → error.
  - Fail and cancel mark the running step.
  - Reclaim re-seeds.
- **worker:** each kind's test asserts its final `steps` states (for example, an upload
  import has download `skipped` and the others `done`), and a failing kind leaves the
  right step `failed`.
- **api:** `?song_id=` filter, `GET /api/job-kinds`, and 422 on an undeclared kind.
- **frontend:**
  - StepList renders every state.
  - Job queue: disclosure, auto-expanded running row, inline traceback, and the
    `?song=` filter.
  - Modal: background rendering, direct visit, close paths, file and link mutual
    exclusion, Title required only for a link, the right mutation per source, groups
    drawn from jobs and from declarations, and the "won't run" collapse.
  - `showModal` is stubbed in jsdom.
