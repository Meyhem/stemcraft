# Stemcraft Implementation Roadmap

**Goal:** Build Stemcraft from zero code to a working play-along tool, foundation
first, in nine phases whose order is dictated by risk and by data dependencies rather
than by feature priority.

**Spec:** [design/domain-spec.md](../../../design/domain-spec.md),
[design/tech-spec-stemcraft.md](../../../design/tech-spec-stemcraft.md),
[design/ui-spec.md](../../../design/ui-spec.md). The tech spec wins where they differ.

**How to read this:** this is the phase map, not the task list. Each phase gets its own
plan document at task fidelity, written when the phase starts — not now. Phases 1–3 can
be planned honestly today; later phases cannot, because Phase 3 answers Q-03 and
produces the engine API that Phases 6 and 7 are built against. Writing task-level steps
for Phase 7 today would be fiction, and fiction in a plan is worse than a gap.

Phase 1's plan is written: [2026-09-27-phase-1-foundation.md](2026-09-27-phase-1-foundation.md).

---

## Global constraints (every phase)

Copied verbatim from the spec. These are correctness floors, not preferences.

- **48 000 Hz stereo end to end** (D-03). Never 44.1. The beat grid is **integer sample
  indices at 48 kHz**, never float seconds.
- **The API never imports torch** (§4). A blast-radius boundary. If API code needs
  something from torch, the answer is a job.
- **One writer per file** (§5). API owns `song.json`. Worker owns `stems/`,
  `analysis.json`, `peaks.json`, `exports/`.
- **Stems are immutable once written** (§5). Mix, tempo, pitch, loops are a recipe in
  `song.json` applied at playback and export.
- **All writes atomic** — temp file, then rename.
- **The original upload/download is never modified or deleted.**
- **Never seek the time-stretcher** (D-06). Loops wrap the engine's own read cursor in
  the input domain with a ~5 ms crossfade.
- **Mix to stereo before stretching** (D-05). One SoundTouch instance, not four.
- **wavesurfer.js never plays audio** (D-07). Rendering and region UI only, slaved to
  the engine clock.
- **Fail loudly** (N-08). No silent fallbacks. Missing dependency, wrong device or
  failed job must be visible in the UI with the real error text.
- **CUDA ≥ 12.8** (C-02), torch pinned to a cu128 index via a constraints file.
  Python 3.12, `uv` for Python, `npm` for the SPA (D-12).
- **Every job kind is idempotent by re-derivation** (§6). Lease-based crash recovery
  depends on it.
- Dev: Vite on `:5173` bound `0.0.0.0`, proxying `/api` and the WebSocket to the API on
  `:8000`. Prod: FastAPI serves the built bundle (D-15). **No CORS middleware exists.**

---

## Phase order and why it is this order

```
1 Foundation ──► 2 Audio I/O + Import ──► 4 Separation ──► 5 Analysis ──► 6 Song view ──► 7 Export ──► 8 Album splitter ──► 9 Ops
                                    │                                        ▲
                                    └──► 3 Engine (click-track fixtures) ────┘
```

Phase 3 depends only on Phase 1's frontend scaffold and on synthetic fixtures, so it
runs off the critical path of the backend features and lands before any UI is built
around it — which is what R-01's mitigation asks for.

---

## Phase 1 — Foundation

**No features, no audio, no torch.** Repo and tooling, both processes booting with loud
dependency validation, the `jobs.sqlite` queue with lease-based crash recovery, the
`songs/` tree primitives (atomic writes, `song.json`, derived state), the frontend shell
with all seven routes, and both serving modes of D-15 verified.

A trivial `probe` job kind exercises API → `jobs.sqlite` → worker → WebSocket end to
end with no audio and no GPU.

**Why the Job Queue screen is in the foundation and not in "features":** it is the
system's operational dashboard (§10) and the only way to observe that the queue,
leases, progress and cancellation actually work. A foundation you cannot watch is not
finished.

**Exit criteria**
- Enqueue a `probe` job from the UI; progress advances over the WebSocket; cancel works.
- `kill -9` the worker mid-job; the restarted worker reclaims the expired lease and
  re-runs the job from the start.
- Deleting `ffmpeg` from PATH makes both processes refuse to start with the real error.
- A corrupt `song.json` lists that one song as unreadable and leaves the others alone.
- `npm run build` + FastAPI serves the SPA on one origin; `npm run dev` proxies to the
  API with no CORS header anywhere.

**Discharges:** D-01, D-12, D-13, D-14, D-15, D-16, §5 invariants, §9 crash recovery,
N-08.

---

## Phase 2 — Audio I/O and import

First real feature. Still no torch.

- ffmpeg wrapper: probe, tag read, decode to 48 kHz stereo `audio.wav`, MP3 and Opus
  encode. The single audio I/O path (C-04), no format whitelist.
- `import` job kind: keep `original.*` → `audio.wav` → `peaks.json`. The API creates
  `song.json` at upload time (one writer per file).
- URL import via `yt-dlp`, raw stderr surfaced verbatim on failure.
- Library screen, import dialog, delete-with-confirm.

**Exit criteria:** a file import and a URL import both produce a playable-later song
with peaks; a deliberately corrupt file fails with ffmpeg's own message and `original.*`
survives for retry; `audio.wav` is exactly 48 kHz stereo, asserted in a test.

**Discharges:** C-04, C-08, R-04 (yt-dlp must be installed on the host first), D-03 at
the import boundary.

---

## Phase 3 — The playback engine (R-01)

**The project's main risk, attacked with no UI around it.** Runs in parallel with
Phases 2 and 4 if desired.

- Fixture generator: ffmpeg click track at a known BPM, plus a synthetic four-stem set
  at 48 kHz where a seam is unmistakable.
- Branded TypeScript types separating sample indices from seconds; engine clock.
- AudioWorklet owning one read cursor over four `AudioBuffer`s: per-stem gain and mute,
  sum to stereo, then **one** SoundTouch instance (D-05).
- Loop wrap in the input domain with a ~5 ms crossfade. The stretcher never learns a
  loop occurred (D-06).
- Dev-only harness page, kept out of the production bundle.

**Exit criteria:** 30+ minutes of continuous looping on the click track with no audible
tick and no measurable drift; tempo 50–100 % assessed against N-04; mute/gain latency
measured against N-06's 50–100 ms.

**Decides:** Q-03 — SoundTouch or Rubber Band. Check Rubber Band's licensing before
adopting it.

**Re-plan checkpoint.** The engine's API shapes Phases 6 and 7. Plan them after this.

---

## Phase 4 — Separation (torch enters the system)

- Constraints file pinning the cu128 index; `uv sync` verified to resolve torch there
  and nowhere else.
- Worker boot proof: models load and one tiny inference succeeds on the selected
  device. This is the check that catches an sm_120 kernel mismatch at boot instead of
  four minutes into a user's job.
- Device selection with CPU fallback, the reason recorded, the banner shown, per-job
  device stored, estimates picked from N-01.
- `separate` job kind: HTDemucs v4 → `stems/*.wav` masters + `*.opus` delivery copies,
  progress via the inference callback, cancellation honoured between model segments,
  never hard-killed (§9).
- Near-silent stem detection so an empty lane is marked rather than shown as an
  unexplained flat waveform.

**Exit criteria:** real stems for a real song inside N-01's window on GPU; a cancel
mid-separation lands cleanly with no orphaned VRAM and no partial stems left behind;
forcing CPU shows the banner with the real fallback reason.

**Discharges:** C-02, D-02, R-02, R-04.

---

## Phase 5 — Analysis

- Key and scale: top 2–3 candidates with confidence, computed on the bass and other
  stems rather than the full mix.
- Beat grid: beats, downbeats, BPM, stored as **integer sample indices at 48 kHz**.
- Chords aligned to bars.
- Scale sheet screen: fretboard and scale pattern. Pure lookup from key to notes, no
  model, no failure mode — which is why it stays trustworthy when detection is not
  (R-05).

**Decides:** Q-01 (`beat_this` vs `madmom` — check madmom's install health on Python
3.12 + NumPy 2 first, per R-02) and Q-02 (`autochord` vs BTC, by listening).

**Exit criteria:** the grid round-trips bar numbers to sample offsets exactly; every
key readout shows confidence and alternatives, never a single answer as fact.

**Re-plan checkpoint.** Q-01/Q-02 outcomes change Phase 6's chord chart.

---

## Phase 6 — Song view, play along

The screen the product exists for. Needs Phase 3's engine, Phase 4's stems and Phase
5's grid — which is why it is sixth and not first.

- Stacked waveforms via wavesurfer, slaved to the engine clock; playhead positioned by
  `requestAnimationFrame` from that clock, never by CSS (U-05).
- Per-stem mute, solo, volume. Live tempo 50–100 % and live pitch shift.
- A–B loop snapped to bars, stored as bar numbers and resolved through the grid.
- Count-in and metronome locked to the grid.
- Scrubbing during an active loop disarms the loop first, visibly (U-06).
- Recipe auto-saves to `song.json` as whole-document writes under last-write-wins.

**Exit criteria:** N-03 (under ~3 s to first playback over LAN), N-05 on real music,
N-06 on mix changes; settings survive a reload; two tabs clobbering each other is
observed and accepted, not fixed (§5).

**Note:** the A–B tempo ramp described at domain-spec.md:198 is **not** in scope —
commit 2c934e4 removed it from the design and that line is stale.

**Plan:** [2026-09-28-phase-6-song-view.md](2026-09-28-phase-6-song-view.md). Code landed
and reviewed; the exit criteria that need ears (N-03 over LAN, N-05, N-06, metronome
alignment) are an open checklist in that document's verification section.

---

## Phase 7 — Export

- `export` job kind rendering server-side at higher quality than the live preview
  (D-10), so preview and export are deliberately non-identical.
- Any subset of stems, including one alone; current tempo and pitch applied by default
  with a toggle for original.
- MP3 into `exports/`, downloadable.

**Exit criteria:** an export at 70 % tempo matches what was practised to; the toggle
produces an original-tempo file; the job is re-runnable and overwrites its own output.

**Plan:** [2026-09-28-phase-7-export.md](2026-09-28-phase-7-export.md). Code landed and
reviewed. Measured against the real song: 70 % gives 202.56 s from a 141.77 s source, the
original toggle gives 141.79 s, and a re-run is byte-identical. The one exit criterion that
needs ears — whether the 70 % file *matches what was practised to*, and whether D-10's
"better, never worse" actually holds — is an open checklist in that document's verification
section. `rubberband` also became a refuse-to-start dependency this phase (D7-01).

---

## Phase 8 — Album splitter

- Silence detection proposes split points; the user drags, adds and removes them.
- Album fields typed once and filled down; automatic track numbers.
- Tagged MP3s, downloadable as a zip.

**Decides:** Q-04 — whether output lands in the library as Songs or stays a zip. This
changes whether the splitter shares the Song write path.

---

## Phase 9 — Operations

- Two systemd user units finalised with restart-on-failure.
- Stats view: pass/fail counts, average duration by kind and by device.
- Backup script for `original.*` + `song.json` only (~2 % of the bytes, the only
  irreplaceable part).
- Deploy runbook, and **this is where the dev-setup skill gets written** — against
  commands that have actually been run, not intended ones.

---

## Explicitly not planned

Deferred by §12 and the domain spec's backlog, listed so their absence is a decision
rather than an oversight: the tabs/transcription pipeline (R-06), per-stem EQ and
per-stem pitch shift, Mel-Band Roformer for vocals, job-history pruning, concurrent-
session safety (ETag on the Song resource), practice timer, setlists, batch folder
import, song zip export.

Each has a named seam in §12. None requires a contract change to add later.
