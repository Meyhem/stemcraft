# Stemcraft

Self-hosted, single-user web app that splits songs into stems so a player can mute
their own instrument and play along. Python backend, React frontend, one home machine.

**There is no application code yet.** The repo currently holds design documents only.
Read both before proposing implementation:

- [design/domain-spec.md](design/domain-spec.md) — what the product is, features, data model
- [design/tech-spec-stemcraft.md](design/tech-spec-stemcraft.md) — architecture, decisions
  (D-01…D-11), constraints (C-01…C-08), risks, open questions

Cite decision IDs rather than re-litigating them. If a decision needs to change, say
which D-number and why — several are marked one-way.

## Non-negotiable invariants

Violating any of these breaks the design, not just a test:

1. **The API never imports torch.** It is a blast-radius boundary: a broken CUDA
   install must not take the UI down. If API code needs something from torch, the
   answer is a job, not an import.
2. **One writer per file.** The API owns `song.json`. The worker owns `stems/`,
   `analysis.json`, `peaks.json`, `exports/`. Never cross this.
3. **Stems are immutable once written.** Mix, tempo, pitch and loops are a recipe in
   `song.json` applied at playback/export. Never re-separate to reflect a setting.
4. **48 kHz everywhere** (D-03). Not 44.1. The beat grid is stored as integer sample
   indices at 48 kHz, never float seconds — sample-accurate looping depends on it.
5. **Never seek the time-stretcher** (D-06). Loops work by wrapping the engine's own
   read cursor in the input domain with a short crossfade. Seeking produces a click on
   every repetition.
6. **Mix stems to stereo before stretching, not after** (D-05). One SoundTouch
   instance, not four.
7. **wavesurfer.js never plays audio** (D-07). Waveform rendering and region UI only,
   slaved to the custom engine's clock.
8. **All file writes are atomic** — temp file then rename.
9. **The original upload/download is never modified or deleted.**
10. **Fail loudly** (N-08). No silent fallbacks. A CPU fallback, missing dependency or
    failed job must be visible in the UI with the real error message.

## Architecture in one breath

Browser (React SPA + custom Web Audio engine) → API (FastAPI, torch-free, owns
`song.json`) → `jobs.sqlite` ← worker (single, serial, owns all GPU work). API and
worker never call each other; they coordinate through SQLite and the `songs/` tree.
Filesystem is the database for songs; SQLite holds only jobs.

## Hard environment facts

- GPU is an **RTX 5080 (Blackwell, sm_120)**. **CUDA ≥ 12.8 is a correctness floor**,
  not a preference — earlier PyTorch wheels have no kernels for this card and fail at
  the first conv. Torch is pinned to a cu128 index via a constraints file; never let a
  transitive dependency resolve it elsewhere.
- Dependencies are managed with `uv`. Python 3.12.
- `ffmpeg` is the only audio I/O path. No format whitelist — if ffmpeg decodes it, it
  is accepted.
- `yt-dlp` is a refuse-to-start dependency and must be updated often.
- Both processes validate dependencies at boot and refuse to start if unmet. The
  worker additionally runs one tiny inference to prove the device really works.

## Where the difficulty actually is

The backend is a job queue wrapped around subprocess calls. **The hard part is the
browser playback engine** — four decoded stems, live mix, single shared time-stretcher,
sample-accurate seamless looping against a beat grid. It is bespoke and it is R-01, the
project's main risk.

Build and validate the engine against a click track before building UI around it. A
seam at the loop wrap is obvious on a click track and easy to miss on music.

## Conventions

- Match the surrounding code's style; there is no established codebase to conform to
  yet, so the first implementation of an area sets its idiom.
- Prefer deriving state over storing it. Song state (imported / separated / analyzed)
  is derived from which files exist — do not add a status field.
- Every job kind must be idempotent by re-derivation. Re-running it must reproduce its
  outputs from inputs that never change. Lease-based crash recovery depends on this.
