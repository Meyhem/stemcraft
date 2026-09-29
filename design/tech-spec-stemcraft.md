# Tech Spec: Stemcraft

*Drafted Sep 27, 2026 from an interview with @Michal. Status: draft.*
*Domain reference: [domain-spec.md](domain-spec.md).*

## 1. What this is

Stemcraft is a self-hosted, single-user web application that turns a song into four
isolated stems so a player can mute their own instrument and play along. One imported
track plus its stems, analysis and practice settings is a **Song**; every user action
happens inside a Song.

It runs as three processes on one home machine: a React SPA in the browser, a FastAPI
process that owns song metadata and serves audio, and a single serial worker that owns
all GPU and CPU-heavy work. Nothing external calls it and it calls nothing external
except `yt-dlp` for URL imports. It owns all of its data; there is no upstream system
and no integration surface.

The engineering weight is not evenly distributed. The backend is a job queue wrapped
around subprocess invocations. The genuinely hard component is the **browser playback
engine**: four stems mixed live, time-stretched and pitch-shifted in a WASM
AudioWorklet, looping seamlessly against a beat grid. That is where the risk lives
(see §13).

## 2. Constraints

Given, not chosen.

- **C-01** — Single machine, single user. No accounts, no multi-tenancy, no horizontal
  scaling. (Domain spec, non-goals.)
- **C-02** — GPU is an **RTX 5080, Blackwell / sm_120, 16 GB VRAM**. sm_120 has no
  kernels in any PyTorch wheel built before CUDA 12.8, so **cu128 is a hard floor**,
  not a preference. (Verified via `nvidia-smi`, driver 580.178.04.)
- **C-03** — Host provides 32 CPU cores and 123 GB RAM, making the CPU fallback path
  genuinely usable rather than nominal. (Verified.)
- **C-04** — `ffmpeg` is assumed present and is the only supported audio I/O path;
  no format whitelist. (Domain spec. ffmpeg 6.1.1 verified present.)
- **C-05** — Served over the home LAN, not just loopback. Practice clients include
  other machines on the network. (Interview, Q1.)
- **C-06** — No online metadata lookup, fingerprinting or identification of any kind.
  All metadata is user-typed. (Domain spec, non-goals.)
- **C-07** — Job execution is strictly serial: one worker, one job at a time.
  (Domain spec, non-goals.)
- **C-08** — `yt-dlp` must be installed and kept current; it is a refuse-to-start
  dependency. (Domain spec. **Currently absent on the host** — see R-04.)

## 3. Quality targets

- **N-01** — Separation of a 3-minute song: **10–30 s on GPU**, **2–4 min on CPU**
  (HTDemucs v4, approximate, per domain spec).
- **N-02** — Analysis (key, beats, chords) completes in **seconds**, on CPU.
- **N-03** — Time to first playback after opening a Song: **under ~3 s on LAN**,
  driven by Opus transfer of ~12 MB rather than ~125 MB of WAV (D-04).
- **N-04** — Tempo range **50–100 %** without pitch change; subjectively clean to
  ~70 %, usable below. Pitch shift clean within **±2–3 semitones**.
- **N-05** — Loop wrap is **sample-accurate and free of clicks or gaps**, sustained
  over long repetition. This is a hard requirement, not a preference (interview, Q5),
  and it dictates D-06.
- **N-06** — Mute/solo/gain changes take audible effect within **~50–100 ms**, the
  accepted cost of D-05.
- **N-07** — Scale envelope: **low hundreds of Songs** (A-01), ≈150 MB per song on
  disk, so ~45 GB at 300 songs.
- **N-08** — Degradation preference: **prefer failing loudly and visibly over
  degrading silently.** A wrong device, a missing dependency or a failed job must be
  obvious in the UI. There is no availability target; this is a single-user tool that
  may be restarted at will.

## 4. Architecture

Three processes, coordinating only through shared state on disk.

The **browser** holds the SPA and the audio engine. It talks only to the API, over
HTTP for resources and a WebSocket for job progress.

The **API** (FastAPI + Uvicorn) is the sole writer of `song.json`, serves audio and
peaks, accepts uploads, and enqueues jobs. It **never imports torch**. This is a
deliberate blast-radius boundary: a broken CUDA or driver upgrade degrades separation
but leaves the library browsable and playable.

The **worker** is a plain Python process that polls `jobs.sqlite`, loads models once
at boot, and writes only `stems/`, `analysis.json`, `peaks.json` and `exports/`.

API and worker never call each other. All coordination is through `jobs.sqlite` (queue
and history) and the `songs/` tree (content). Either can be restarted independently.

Both processes **refuse to start** if their dependencies are unmet: ffmpeg present and
able to decode and encode MP3, `yt-dlp` present, data directories writable, SQLite
opening in WAL mode; the worker additionally requires that models load and one tiny
inference succeeds on the selected device. Given C-02, that last check is the one that
catches a sm_120 kernel mismatch at boot rather than four minutes into a user's job.

**Device selection.** At boot the worker attempts CUDA and runs a small proof-of-work
op. On failure it falls back to CPU and records why. The device and the fallback reason
are surfaced in the UI as a banner, stored on every job row, and used to pick the
per-job time estimate from N-01.

### Playback engine

The browser engine is the one component that cannot be assembled from libraries.

Four Opus stems are fetched and decoded to PCM `AudioBuffer`s. A custom AudioWorklet
owns a single read cursor over those buffers. Per frame it applies per-stem gain and
mute, **sums to stereo, and passes the result through one SoundTouch instance** for
tempo and pitch.

Looping never seeks. The worklet advances its own cursor and **wraps it at the loop
boundary in the input domain**, applying a ~5 ms crossfade across the wrap. The
stretcher therefore receives an unbroken input stream and never learns that a loop
occurred — which is what makes N-05 achievable at all. Seeking a stretcher instead
would emit buffered loop-end audio after the jump, producing an audible artifact on
every repetition.

Consequently **no waveform renderer drives playback** (D-07). Waveforms and the
region/loop UI are drawings slaved to the engine's clock. The domain spec's implication
that wavesurfer's multitrack plugin plays the audio is superseded: that plugin owns its
own media elements and playhead, which is precisely the control the engine must retain.
(wavesurfer.js itself has since been replaced by our own canvas painters; see D-07.)

```
 browser ───── HTTP (opus, peaks, json) ─────┐
   │                                          ▼
   │  ┌──────────────────────────┐        ┌─────────┐
   │  │ 4 AudioBuffers           │        │   API   │ ── writes ──> song.json
   │  │  └─ gain/mute ─┐         │        │ no torch│ ── enqueue ─> jobs.sqlite
   │  │                ▼         │        └─────────┘                   │
   │  │        sum to stereo     │             ▲                        │ poll
   │  │                ▼         │             └── WS progress          ▼
   │  │        SoundTouch ──> out│                                 ┌─────────┐
   │  │        (cursor + loop    │                                 │ worker  │
   │  │         wrap + xfade)    │                                 │  torch  │
   │  └──────────────────────────┘                                 └─────────┘
   │                                                                    │
   └───────────── waveform canvases + regions only                       │
                  (slaved to engine clock)          stems/, analysis, exports
```

## 5. Data

### Source of truth

The **filesystem is the database for Songs.** `song.json` is authoritative for
metadata and the practice recipe; the presence or absence of files derives Song state
(imported / separated / analyzed). `jobs.sqlite` is authoritative for the queue and
job history, and holds nothing else. Deleting a Song is `rm -rf` of its folder, and
nothing requires repair afterwards.

The Song list is a scan of `songs/*/song.json`. At N-07 scale this is fast enough that
no index exists to fall out of sync.

### Layout

```
data/
  jobs.sqlite              # queue + history, deliberately outside songs/
songs/
  <id>-<slug>/
    song.json              # metadata, settings, edit recipe
    original.<ext>         # untouched upload or download — never modified
    audio.wav              # 48 kHz stereo, normalized  (see D-03)
    peaks.json             # precomputed waveform peaks
    analysis.json          # key candidates, beat grid, chords
    stems/
      vocals.wav  drums.wav  bass.wav  other.wav     # masters, immutable
      vocals.opus drums.opus bass.opus other.opus    # delivery copies (D-04)
    exports/
      <name>.mp3
```

### Invariants

- **Stems are immutable once written.** Mix, tempo, pitch and loops are a *recipe* in
  `song.json`, applied at playback and at export. Undo is therefore free and nothing
  is ever re-separated.
- **One writer per file.** The API owns `song.json`; the worker owns everything it
  produces. There is no file both processes write.
- **All writes are atomic** — temp file, then rename.
- **`schema_version` is checked on load** and old files migrated forward in place.
- **The original is always kept**, so any derived artifact can be rebuilt and a failed
  import can be retried without re-downloading.

### Sample rate and the beat grid

**One sample rate is true end-to-end: 48 kHz.** This revises the domain spec's
44.1 kHz. Opus always codes at 48 kHz, so 44.1 kHz masters would arrive in the browser
as 48 kHz PCM, and server-side sample indices would no longer denote the same instants
as client-side ones — silently breaking N-05. Normalizing at import removes the
discrepancy. HTDemucs resamples to 44.1 kHz internally and back; the round trip is
inaudible at practice volumes and is the correct trade for an unambiguous time base.

The **beat grid in `analysis.json` is stored as integer sample indices at 48 kHz**, not
float seconds, so beat positions are exact and identical on both sides. Loops are
stored in `song.json` as bar numbers (user-meaningful, survive re-analysis) and
resolved to sample offsets through the grid at load time.

### Consistency and concurrency

There is no locking and no versioning on `song.json`: a single active session is
assumed and **last write wins** (C-01, interview Q5). Two browser tabs editing one
Song will clobber each other's settings. Accepted; the loss is a mute state, and the
seam for fixing it later is an ETag on the Song resource.

### Retention

No automatic deletion. Songs persist until explicitly deleted. Job history is retained
indefinitely for the stats view; pruning is deferred (§12).

## 6. Interfaces and contracts

All interfaces are **internal and unversioned**. There are no external consumers, the
SPA and API deploy together from one repo, and a breaking change breaks only a browser
reload. This is the main simplification C-01 buys and it should be spent freely.

- **HTTP/JSON, API → SPA.** Song CRUD, import, job control, stats. Song mutations are
  whole-document `song.json` writes.
- **Audio over HTTP.** `.opus` per stem for playback; `.wav` and `.mp3` for export
  download. Range requests supported, since the engine needs whole buffers anyway.
- **WebSocket, API → SPA.** Job progress, state transitions, device banner. Strictly a
  push channel for data already durable in `jobs.sqlite`; dropping the socket loses
  liveness, never data, and the client recovers by refetching.
- **`jobs.sqlite`, API ↔ worker.** The real contract of the system. Rows are the
  queue; `payload` and `result` are JSON blobs whose shape is owned by the job kind.
  `steps` is a JSON list seeded from the kind's declaration at enqueue and advanced
  only by the worker (D-17).
  Idempotency is per kind: `separate`, `analyze` and `export` are safe to re-run and
  overwrite their outputs, which is what makes lease-based crash recovery sound.
- **Writes are idempotent by re-derivation**, not by request IDs. Re-running any job
  reproduces its outputs from inputs that never change (the original file).

## 7. External dependencies

| Dependency | Used for | Limits | Behavior when it's down |
| --- | --- | --- | --- |
| ffmpeg (C-04) | All decode, encode, resample, silence detection | Local subprocess | **Refuse to start.** Nothing works without it |
| yt-dlp (C-08) | URL import | Breaks whenever sites change; needs frequent updates | Refuse to start. Import failures surface the raw stderr |
| PyTorch cu128 (C-02) | HTDemucs inference | 16 GB VRAM; sm_120 needs ≥ 12.8 | Worker falls back to CPU with a UI banner; API unaffected |
| Model weights | Separation, chords, pitch | One-time download, then cached on disk | Worker refuses to start if weights are absent or fail their boot inference |
| Essentia / beat_this / autochord | Key, beats, chords | CPU, seconds | Analysis job fails; playback and separation unaffected |

No dependency is a network service, so there is no rate limit, no sandbox problem and
no retry-with-backoff anywhere in the system. Every failure is local and immediate.

## 8. Identity, access, security, compliance

**There is no authentication.** The API binds to the LAN (C-05) and trusts every
client on it (interview Q3). This was raised as a concern and accepted: it means any
device or any web page on the home network can enumerate the library, upload files,
and POST arbitrary URLs into the `yt-dlp` download queue.

Mitigating facts: the data is music the user already owns, there are no credentials or
personal data anywhere in the system, and the machine is behind a residential NAT.

The seam, should this change: the bind address remains a configuration value, so
restricting to loopback plus an SSH tunnel is a config edit, and a single shared
password over a long-lived cookie is a small, self-contained middleware. Nothing in
the design forecloses either.

No compliance regime applies. No data classification, residency, encryption-at-rest or
audit requirement exists.

## 9. Failure and recovery

- **Import decode failure** — surface ffmpeg's or yt-dlp's actual message verbatim.
  `original.*` is retained, so retry costs nothing and never re-downloads.
- **Any job failure** — the running step is marked `failed` and the traceback is
  drawn under it, in the Job queue and in the Import modal (D-17). A kind that returns
  with a declared step still pending fails as a bug rather than finishing.
- **Cancelling a queued job** — immediate; the row is marked `cancelled` and never
  picked up.
- **Cancelling a running separation** — honoured **between model segments** via the
  inference progress callback (interview Q4). Worst case is a few seconds of lag. The
  process is never hard-killed, which is what keeps VRAM from being orphaned and
  leaves partial output cleanly discardable.
- **Worker crash mid-job** — the running job holds a `lease_until`. On restart the
  worker reclaims expired leases and re-runs the job from the start. Safe because
  every job kind is idempotent by re-derivation (§6). Its `steps` are re-seeded from
  the declaration along with `progress` resetting to 0.
- **CUDA unavailable or kernel mismatch** — detected at boot by the proof-of-work op,
  not at first use. Fall back to CPU, log the reason, show the banner, adjust
  estimates. Per N-08 this is loud, never silent.
- **Corrupt or future-version `song.json`** — the Song is listed as unreadable with
  its error, and other Songs are unaffected. One bad file never breaks the library.
- **Disk full** — atomic writes mean a failed write leaves the previous good file
  intact; the job fails with the OS error.
- **Dangling `song_id` in job history** — expected after a Song is deleted. History
  rows are kept and rendered without a link.

## 10. Operations

- **Single environment.** No staging; the developer, operator and user are one person.
- **Packaging:** `uv` with a constraints file pinning the cu128 PyTorch index (D-02).
  No container, no GPU passthrough layer.
- **Process management:** two systemd user units, API and worker, with restart-on-
  failure. Restart is the primary recovery mechanism for everything in §9.
- **Deploy:** `git pull`, `uv sync`, `npm ci && npm run build` for the SPA (D-12),
  restart both units. Rollback is a
  checkout of the previous commit. Model weights live outside the repo and survive.
- **Observability sized to one user:** structured logs to the journal, and the Job
  Queue screen as the real operational dashboard — per-job state, duration, device,
  error and traceback, plus pass/fail counts and average duration by kind and device.
  That view is the reason `jobs.sqlite` keeps full history. No metrics backend, no
  alerting, no on-call.
- **Backup:** `original.*` + `song.json` only (interview Q5) — roughly 2 % of the
  bytes and the only irreplaceable part. Stems, peaks and analysis are re-derivable at
  the cost of GPU time. `jobs.sqlite` is not backed up; it is operational history.

## 11. Key decisions

- **D-01 — Filesystem as the Song store; SQLite only for jobs.**
  *Because:* a single user's library is small enough that a directory scan beats an
  index, and content-addressed-by-folder means delete is `rm -rf` with no referential
  cleanup. Job state, by contrast, genuinely needs transactions and a queue.
  *Rejected:* everything in SQLite (turns audio into blobs or into paths-plus-index
  that can desync); a metadata index alongside the files (a cache to invalidate, for
  no gain at N-07).
  *Reversibility:* two-way, but an index added later must be rebuildable from the
  files or D-01's main benefit is lost.

- **D-02 — `uv` with a constraints-pinned cu128 PyTorch, on systemd.** *(Closes the
  domain spec's open question #1.)*
  *Because:* C-02 makes the CUDA version a correctness issue, and a constraints file
  prevents any transitive dependency from resolving torch back to a non-cu128 wheel.
  `uv` is already on the host; containers would add nvidia-container-toolkit and
  bind-mount friction for one local user.
  *Rejected:* Docker on NVIDIA's PyTorch image (reproducible but heavier to operate
  here); bare pip (no lock, no protection against torch being swapped).
  *Reversibility:* two-way, cheap.

- **D-03 — Normalize to 48 kHz stereo end-to-end.** *(Revises the domain spec's
  44.1 kHz.)*
  *Because:* Opus codes only at 48 kHz (D-04), so a 44.1 kHz master makes server and
  client sample indices disagree, which silently defeats N-05.
  *Rejected:* 44.1 kHz with client-side resampling (reintroduces the index mismatch
  and costs CPU on every load); 44.1 kHz with time expressed in seconds (loses sample
  exactness precisely where it is required).
  *Reversibility:* **one-way** once audio and analysis files exist — changing it
  invalidates every `audio.wav`, stem and beat grid. Cost: Demucs resamples internally
  to 44.1 kHz and back, judged inaudible.

- **D-04 — Serve Opus ~128 kbps for playback; keep WAV masters for export.**
  *Because:* ~12 MB versus ~125 MB per song over LAN is the difference between
  instant and awkward (N-03), and stems are already artifacts of a lossy separation
  process, so a second lossy stage costs little that is audible. Export still renders
  from untouched WAV.
  *Rejected:* WAV to the browser (slow first play, and 45 GB of traffic over a
  library's life); FLAC (still 75 MB, patchier browser support).
  *Reversibility:* one-way in the API's audio contract, though masters are retained so
  no audio is lost.

- **D-05 — Mix stems to stereo first, then apply a single stretcher.**
  *Because:* gain and mute are linear and commute with the mix, so pre-mix application
  is bit-identical to per-stem processing at one quarter the CPU — one SoundTouch
  instance instead of four.
  *Rejected:* one stretcher per stem (4× cost for identical output); server-rendered
  tempo/pitch variants (removes the live tempo slider, which is the core practice
  interaction).
  *Reversibility:* **one-way** in the engine's structure. Note it stays compatible
  with the backlog's per-stem pitch shift *only* because that is scoped as a
  server-rendered stem edit; making it a live control would require undoing D-05.
  *Cost:* N-06's ~50–100 ms actuation lag, since the stretcher's buffer already holds
  the previous mix.

- **D-06 — Loop by wrapping the engine's own read cursor in the input domain, with a
  ~5 ms crossfade. Never seek.**
  *Because:* it is the only construction that satisfies N-05 while keeping D-05's
  shared stretcher. The stretcher sees a continuous stream and cannot produce a wrap
  artifact because it is unaware of the wrap.
  *Rejected:* seeking the stretcher (emits buffered loop-end audio after each jump —
  a click every repetition); scheduling looped `AudioBufferSourceNode`s (loses
  independent tempo control); accepting a small seam (explicitly refused in Q5).
  *Reversibility:* **one-way**; it is the engine's central mechanism.

- **D-07 — No waveform renderer plays audio.** Waveforms are drawings slaved to the
  custom engine's clock (Song view) or to a plain `<audio>` element (Album splitter);
  region and cut UI is ours. *(Originally worded around wavesurfer.js; amended when it
  was removed — see the note below.)*
  *Because:* D-06 requires ownership of the cursor and clock, which a library player such
  as wavesurfer's multitrack plugin holds internally.
  *Rejected:* wavesurfer multitrack as the player (cannot meet N-05).
  *Amendment (Phase 8/9):* wavesurfer.js was dropped as the renderer. It lays a
  canvas out at the full content width, which cannot be zoomed to the depths the Song
  view and the splitter need; both now paint one viewport-sized canvas that repaints on
  scroll (`music/zoom.ts`). The rule this decision protects is unchanged.
  *Reversibility:* one-way in practice — it is the reason the custom engine exists.
  *Cost:* the engine is bespoke work, and the largest single risk in the project
  (R-01).

- **D-08 — PyTorch as the only inference runtime; no ONNX path.** *(Closes the domain
  spec's open question #2.)*
  *Because:* HTDemucs v4 is torch-native, torchcrepe for tabs needs torch regardless,
  and ONNX Runtime's CUDA execution provider is the less-proven road on a
  just-released Blackwell part (C-02). One runtime is one thing to debug when kernels
  are missing.
  *Rejected:* ONNX-only (smaller install, but forecloses the tabs path and adds
  sm_120 risk); hybrid (two runtimes, two failure modes, for no present benefit).
  *Reversibility:* two-way, but reversing costs a re-validation of every model.

- **D-09 — Cancel a running separation between inference segments, never by killing
  the process.**
  *Because:* it matches the domain spec's "stops at its next checkpoint", avoids
  orphaned VRAM, and leaves partial output clearly discardable.
  *Rejected:* hard kill (orphan GPU memory, unclear partial state); uncancellable
  (unacceptable when a CPU-fallback job runs for minutes).
  *Reversibility:* two-way.

- **D-10 — Export renders server-side at higher quality than the live preview.**
  *Because:* the preview is a real-time budget and the export is not, so the export
  should sound better than what was practiced to — never worse. Bit-identical
  preview/export has no practice value.
  *Rejected:* SoundTouch server-side for parity (deliberately degrades the artifact);
  original-tempo-only export (defeats the stated purpose of matching practice).
  *Reversibility:* two-way.
  *Cost:* preview and export are audibly non-identical; documented, not a bug.

- **D-11 — No authentication; trust the LAN.**
  *Because:* the user's explicit decision (Q3) for a single-user home tool holding no
  sensitive data behind a residential NAT.
  *Rejected:* shared-password cookie (recommended and declined); local-CA TLS.
  *Reversibility:* two-way and cheap — bind address is config, auth is middleware.
  *Cost:* R-03.

- **D-12 — TypeScript throughout the SPA, built with Vite, dependencies via npm.**
  *Because:* the engine's correctness rests on integer sample indices at 48 kHz (D-03)
  and on never confusing a sample index with a float second — exactly the class of
  mistake a branded type catches for free, in the one component that cannot be
  assembled from libraries. Vite gives one config for both the dev server and the
  production bundle (D-15), and npm needs no tool beyond Node on a host that already
  tracks `uv` and `yt-dlp` currency.
  *Rejected:* plain JS (discards the only cheap guard on the sample-index invariant);
  Next.js or any SSR framework (there is nothing to server-render — one client, a Web
  Audio engine, and C-01 makes SEO and cold start meaningless); pnpm (marginal on one
  machine, one more tool to keep current).
  *Reversibility:* two-way.
  *Cost:* the time-stretch AudioWorklet and its WASM must be emitted as their own
  entry rather than bundled into the main graph. Known Vite friction, not a blocker.

- **D-13 — REST plus TanStack Query for server state; no global store for anything the
  server owns.**
  *Because:* all server state here is derived from which files exist (D-01), so the
  client has no domain model to maintain — only a cache of what the API last said, which
  is what Query is. That makes the WebSocket a pure invalidation signal: a job event
  invalidates the song's key and the refetch does the rest, which is what makes §6's
  "dropping the socket loses liveness, never data" true on the client as well. Song
  mutations are whole-document writes under last-write-wins (§5), so a mutation is a PUT
  plus an invalidate, with no local reducer to reconcile.
  *Rejected:* Redux or Zustand as the primary store (copies the server's derived state
  into a second source of truth and invites the status field §5 forbids); fetch +
  `useEffect` by hand (re-implements caching, dedup and refetch, worse); GraphQL or tRPC
  (a schema layer for one unversioned internal consumer).
  *Scope:* server state only. Transport and engine state — play position, gains, loop
  bounds, stretch ratio — live in the engine and in refs, never in Query and never in
  React state at audio rate (U-05).
  *Reversibility:* two-way.

- **D-14 — React Router, one route per screen, song id in the path.**
  *Because:* the screens in `design/ui/` are already separate destinations, and a
  practice session wants a link a phone on the LAN can bookmark (C-05). The song id is
  the only parameter the app needs.
  *Rejected:* conditional rendering with no router (loses back button and deep links);
  TanStack Router or file-based routing (machinery for seven mostly-static routes).
  *Reversibility:* two-way.

- **D-15 — Vite dev server in development; FastAPI serves the built bundle in
  production.**
  *Because:* production is genuinely one origin, and Vite's proxy for `/api` and the
  WebSocket makes development one origin too — so no CORS middleware exists in the API
  at all, and dev cannot diverge from prod at the layer where origin bugs hide. Serving
  the built bundle from a static mount keeps §6's "the SPA and API deploy together from
  one repo" literally true: one unit serves both, and a stale bundle is impossible.
  *Rejected:* CORS-enabled API with the browser calling `:8000` directly (adds
  middleware production never needs, and makes dev the only place origins differ);
  nginx or Caddy in front (a third process to operate for one static directory);
  rebuilding on change instead of a dev server (loses HMR, which is most of Vite's value
  while the engine is being tuned).
  *Reversibility:* two-way.
  *Cost:* in dev the proxy sits in the path of multi-megabyte `.opus` fetches, and must
  be configured to proxy WebSockets or job progress fails in development only. Vite must
  bind `0.0.0.0` for C-05.

- **D-16 — CSS modules over `tokens.css`. *(Closes the UI spec's U-02 deferral.)***
  *Because:* `tokens.css` is already the source of truth and
  `design/ui/src/components.css` is already hand-written CSS against those tokens, so
  the React port is a move of that file rather than a translation of it. Per-component
  scoping, no runtime, nothing added to the Vite config.
  *Rejected:* Tailwind (either duplicates the tokens in a theme config, which U-02
  rejected, or degenerates into arbitrary-value classes wrapping `var()`);
  vanilla-extract (typed styles are real value, but bridging the tokens through
  `createGlobalTheme` makes `tokens.css` a generated artifact instead of the authority);
  CSS-in-JS with a runtime (per-frame style work beside an audio engine that must not
  jank, and U-05 forbids CSS-driven motion for anything the engine clocks).
  *Reversibility:* two-way, per component.

- **D-17 — Jobs declare named steps; the job row records them live.**
  Each job kind declares an ordered list of steps (id, label, weight) in torch-free
  `stemcraft_lib/job_steps.py`. `enqueue()` seeds them all as `pending` into a
  `steps` JSON column and refuses an undeclared kind. From then on only the worker
  writes them, through `ctx.step()` / `ctx.skip()` / `ctx.detail()` / `ctx.progress()`.
  The job's overall `progress` is still stored, computed from the step weights.
  A failure before any step began is anchored on the first pending step with the detail
  "failed before this step started".
  *Because:* a single anonymous float cannot say which phase is running, how long each
  took, or which one failed. The kinds already work in clear phases. Seeding at enqueue
  lets a queued job, and a job not yet queued (from the declaration), show what it will
  do. The existing websocket makes it live for free.
  *Rejected:* steps written only by the worker as it goes (a queued job shows nothing,
  and "step 3 of 5" is impossible); a free-form per-job log (a log, not a pipeline);
  grouping chained jobs into one pipeline row (one row per job was chosen; the Import
  modal is where a song's chain is shown together).
  *Reversibility:* two-way. The column is additive (jobs schema v2), and rows from
  before it render as "No step record".
  Design: `docs/superpowers/specs/2026-09-29-job-steps-design.md`.

- **D-18 — Play-along patterns are generated in the browser; the engine is song-scoped.**
  A separate Play along screen (`/songs/:songId/play`) draws a live bass neck and beat
  lane for the current and next bar. The notes come from pure TypeScript
  (`music/patterns.ts`, `music/fingering.ts`) over `analysis.json`'s chords and the
  `play_along` recipe in `song.json` (schema v3). Nothing derived is stored. The
  `EngineController` moves from `SongView` into a `SongScope` layout route that wraps
  Song view and Play along, so switching between them never stops playback. Notes
  reach the screen through a `TabSource` interface, which a later transcription job
  also implements.
  *Because:* generation is arithmetic over the chord chart, like the scale view
  (R-05). It has no model and no failure mode, and doing it in the browser makes every
  picker change instant while playing. A song-scoped engine is the only way the two
  screens share one playhead without re-decoding four stems on every switch.
  *Rejected:* a worker job writing `playalong.json` (a queue round-trip for every
  picker change, and a file that is purely derived from the recipe); computing in the
  API (a second music-theory implementation beside `theory.ts`); a drawer inside Song
  view (the neck needs the full width, and editing and playing along are different
  activities); per-loop pattern overrides (dropped for simplicity).
  *Reversibility:* two-way. The `song.json` field is additive (v2 → v3).
  Design: `docs/superpowers/specs/2026-09-29-play-along-design.md`.

- **D-19 — The Music Theory tab is a browser-side lookup on tonal.js; `theory.json` is API-owned.**
  A top-level Theory tab (`/theory/:tool`) with a rail of 13 tools (scale, chord and
  note finders, shapes, harmony, two quizzes) for bass and guitar in any tuning. All
  music logic is pure TypeScript in `music/` (`spell.ts` is the only module importing
  `tonal`). The existing `theory.ts` is untouched. Instrument, last tool, the chosen
  song and quiz history live in `<data_dir>/theory.json`, written only by the API
  (`GET`/`PUT /api/theory`, atomic, history capped at 2,000 answers). Quiz stats and
  weak spots are derived from the history, never stored. The worker never touches it.
  *Because:* like the scale view (R-05), this is arithmetic with no failure mode, so
  it belongs in the browser where every picker change is instant. Letter-correct
  spelling across modes, harmonic minor and ~40 chord qualities, plus chord-symbol
  parsing, is the error-prone part, and a maintained library does it better than a
  second hand-written implementation. A server-side file follows the player across
  devices and is backed up with the rest of the data.
  *Rejected:* hand-writing all theory (re-implements tonal's edge cases); rebuilding
  `theory.ts` on tonal (touches working Scale sheet / Song view / Play along code for
  no user gain); localStorage (per-browser, lost on clear); sharing the instrument with
  Play along (reopens D-18's EADG non-goal); reference tones (a second audio source
  beside the engine needs its own design).
  *Reversibility:* two-way. The file and endpoints are additive, and `tonal` sits behind `spell.ts`.
  Design: `docs/superpowers/specs/2026-09-29-music-theory-design.md`.

## 12. Deferred decisions

- **Tabs / transcription pipeline** (bass → torchcrepe → MIDI → fretboard → alphaTab,
  `.gp5`/MusicXML export). Opt-in per Song and explicitly a bonus. *Seam:* it is
  simply another job kind writing another file into the Song folder; no existing
  contract changes to add it. In the browser it becomes a second `TabSource` for the
  Play along screen (D-18).
- **Job history pruning.** Retained indefinitely for now. *Seam:* a `DELETE` on
  `jobs.sqlite` by `finished_at`; nothing depends on old rows but the stats view.
- **Mel-Band Roformer for vocals.** *Seam:* model selection is job payload, so a
  second separation model is a payload field plus a UI control.
- **Concurrent-session safety.** *Seam:* ETag / `If-Match` on the Song resource.
- **Per-stem EQ and per-stem pitch shift** (backlog). *Seam:* both must stay
  server-rendered stem edits to remain compatible with D-05.

## 13. Risks

- **R-01 — The custom playback engine is the project's real risk.** Sample-accurate
  seamless looping (N-05) through a shared stretcher (D-05, D-06) is subtle,
  timing-sensitive work with no library that does it for you.
  *Mitigation:* build the engine first, against a hand-made click track where a seam
  is unmistakable, before any UI exists. *Early signal:* an audible tick at the wrap
  after 30 seconds of looping.
- **R-02 — sm_120 model-stack breakage beyond torch itself.** cu128 fixes PyTorch, but
  Essentia, madmom and older transitive audio libraries may carry their own
  binary/NumPy-2 incompatibilities on a very new platform.
  *Mitigation:* the boot-time inference check (§4) turns this into a startup failure
  rather than a job failure. *Early signal:* worker refuses to start after a
  dependency bump.
- **R-03 — Unauthenticated LAN exposure** (D-11). Any device or web page on the
  network can upload, enumerate, or queue a `yt-dlp` fetch of an arbitrary URL.
  *Accepted by the user.* *Mitigation available:* bind-to-loopback config flip.
  *Early signal:* unexplained jobs in the queue.
- **R-04 — `yt-dlp` is not installed on the host**, while C-08 makes it a
  refuse-to-start dependency. The worker will not boot as specified today.
  *Mitigation:* install during setup; pin nothing, update often, since URL import
  breaks whenever sites change.
- **R-05 — Analysis quality is unguaranteed.** Key, beat and chord detection are
  probabilistic; chords especially will be wrong on dense material.
  *Mitigation:* always show confidence and multiple key candidates; never present a
  single answer as fact. The fretboard scale view is pure lookup and has no failure
  mode, so it stays trustworthy even when detection is not.
- **R-06 — Transcription may simply not be good enough** to be worth shipping.
  *Mitigation:* keep it opt-in, framed as an editable starting point (per domain
  spec). It is deferred (§12) precisely so this can be discovered cheaply.

## 14. Open questions

- **Q-01** — Which beat tracker: `beat_this` or `madmom`? Blocks nothing structural,
  but madmom's install health on Python 3.12 + NumPy 2 should be checked before it is
  chosen (relates to R-02).
- **Q-02** — Which chord model: `autochord` or BTC? Affects §7 only; decide by
  listening to output on real material.
- **Q-03** — Is SoundTouch's quality acceptable at 50–60 % tempo, or is Rubber Band
  needed after all? Blocks nothing until the engine exists; revisit against R-01's
  click-track harness. Note Rubber Band's licensing before adopting it.
- **Q-04** — Should album-splitter output land directly in the library as Songs
  (backlog) rather than only as a zip? Changes whether the splitter shares the Song
  write path or stays a standalone tool.
- **Q-05** — Is any headless primitive library (Radix, Ark) needed for dialogs, menus
  and selects? The transport, mixer and sliders are bespoke by U-03/U-05 regardless, so
  this reduces to a handful of overlays. Decide when the first modal is built; nothing
  in D-16 depends on it. *Partly answered (2026-09-29):* dialogs use the native
  `<dialog>` with `showModal()` (focus trap, Esc and inert background built in), so
  they need no library. Menus and selects are still open.

## 15. Assumptions

Asserted here but **not** confirmed by the user.

- **A-01** — Library stays in the low hundreds of Songs. Stated as an order of
  magnitude, not measured. Invalidates D-01's no-index stance above roughly 2,000
  Songs, where a directory scan per page load becomes noticeable.
- **A-02** — All clients are desktop-class ("assume strong computer", Q4). No mobile
  or tablet performance budget exists, so D-05's four-decode-plus-stretch load is
  assumed affordable. If a tablet ever becomes the practice surface, N-03 and D-05
  need re-examination.
- **A-03** — Songs are typically 3–5 minutes, which is what the ~150 MB/song and
  ~12 MB Opus figures assume. Full album-length files as *Songs* (as opposed to
  splitter input) would multiply memory in the engine, which holds whole decoded
  buffers.
- **A-04** — 128 kbps Opus is transparent enough for practice. Not blind-tested.
- **A-05** — ~5 ms is the right crossfade at the loop wrap (D-06). A starting value to
  be tuned by ear, not a measured result.
- **A-06** — The practice-relevant tempo range is 70–100 %, which is what makes
  SoundTouch a safe default (D-03/Q-03).

## 16. Out of scope

- Multiple users, accounts, or operation as a service (C-01)
- Online lookup of any kind: fingerprinting, metadata fetch, album identification
  (C-06)
- Parallel job execution (C-07)
- Note-perfect transcription; tabs are a starting point, never a promise
- Isolating one player from another *within* a stem — rhythm versus lead guitar, lead
  versus harmony vocals. Separation is per source class, never per performer; no
  available model changes this. Investigated and declined (domain spec, "What the four
  stems can and cannot do"), which is also why `htdemucs_6s` is not adopted
- High availability, clustering, replication, or any multi-machine concern
- TLS, encryption at rest, audit logging, compliance regimes (§8)
- Mobile-optimized UI or mobile performance work (A-02)
