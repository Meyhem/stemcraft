# Stem Practice App — Spec

Sep 27, 2026 · @Michal

A self-hosted, single-user web app that splits a song into stems so a bass or drum player can mute their instrument and play along. Guitar is not served — see [What the four stems can and cannot do](#what-the-four-stems-can-and-cannot-do). Python backend, React web UI, runs on one home machine with GPU acceleration and a CPU fallback.

## Overview

The core entity is a **Song**: one imported track with its stems, analysis and practice settings. Everything the user does happens inside a Song — import, stem, analyze, play along, export.

Primary user: a self-taught player learning an instrument, bass first. The value is muting your part, slowing the song down, looping a passage and knowing which notes fit.

**Non-goals**

- Multiple users, accounts or running it as a service
- Online lookups: no fingerprinting, no metadata fetching; the user types metadata in
- Parallel job execution; the queue is strictly serial
- Note-perfect tabs; transcription is a bonus, not a promise

## Architecture

Three processes: browser, API and one worker. The API never imports torch, so a broken GPU setup can't take the UI down, and all heavy work runs serially in a single long-lived worker.

&#91;embedded content: process layout · browser, API, worker, two stores\]

The browser talks only to the API. The API and worker never call each other; they coordinate through jobs.sqlite and the songs folder.

**Stack**

| Layer | Choice |
| --- | --- |
| Frontend | React + TypeScript on Vite (npm), React Router, TanStack Query over REST, CSS modules over the design tokens; wavesurfer.js v7 for waveforms and regions only, Web Audio for playback; live tempo/pitch via a WASM time-stretch AudioWorklet (SoundTouch port, Rubber Band open) |
| API | FastAPI + Uvicorn, WebSocket for job progress |
| Worker | Plain Python process polling jobs.sqlite; models loaded once at boot |
| Audio I/O | ffmpeg (assumed installed), soundfile, pyrubberband |
| Separation | HTDemucs v4 via `demucs` (Meta's reference implementation; `audio-separator`'s unconditional ONNX deps cut against D-08 -- see Phase 4's plan); Mel-Band Roformer optional for vocals |
| Analysis | Essentia (key), beat\_this or madmom (beats), autochord or BTC (chords) |
| URL import | yt-dlp, updated often |
| PyTorch | Pinned cu128 build via a constraints file or uv, so no dependency can swap it |

**Startup checks — fail fast**

Both processes refuse to start if a dependency is missing:

- ffmpeg is on PATH and can decode and encode MP3
- yt-dlp is installed
- Data folders are writable; jobs.sqlite opens in WAL mode
- Worker only: models load and one tiny inference succeeds on the chosen device

**Device selection**

At boot the worker tries CUDA and runs a small test op to prove the card has kernels. On failure it falls back to CPU and logs why. The device and reason show in the UI (a banner when on CPU), are stored on every job, and drive the per-job time estimate: roughly 10–30 s on GPU vs 2–4 min on CPU for a 3-minute song with Demucs (approximate).

## Storage and data model

The file system is the database for Songs; SQLite holds only jobs. Deleting a Song means deleting its folder, and nothing breaks.

**Folder layout**

```
data/
  jobs.sqlite              # queue + history, outside songs/
songs/
  <id>-<slug>/
    song.json              # metadata, settings, edit recipe
    original.<ext>         # untouched upload or download
    audio.wav              # 48 kHz stereo, normalized (D-03)
    peaks.json             # waveform peaks for the UI
    analysis.json          # key candidates, beat grid, chords
    stems/
      vocals.wav  drums.wav  bass.wav  other.wav
    exports/
      <name>.mp3
```

The Song list is a scan of `songs/*/song.json`. At a single user's library size that is instant, so there is no index to keep in sync.

**song.json**

```json
{
  "schema_version": 1,
  "id": "01J9Z3K8Q4",
  "title": "My Song",
  "artist": "Artist",
  "source": { "kind": "upload", "value": "original.mp3" },
  "created_at": "2026-09-27T18:00:00Z",
  "last_played_at": null,
  "mix": { "bass": { "gain_db": 0, "muted": true } },
  "playback": { "tempo": 0.8, "pitch_semitones": 0 },
  "loops": [ { "name": "Chorus", "start_bar": 17, "end_bar": 25 } ]
}
```

**Rules**

- Stems are immutable once separated. Mix, tempo, pitch and loops are a recipe in song.json, applied at playback and export — undo is free and nothing is ever re-separated.
- One writer per file: the API owns song.json; the worker writes only stems/, analysis.json, peaks.json and exports/. Song state (imported, separated, analyzed) is derived from which files exist.
- Writes are atomic: temp file, then rename.
- `schema_version` is checked on load and old files are migrated forward.
- The original file is always kept.

**jobs.sqlite**

```sql
CREATE TABLE jobs (
  id               INTEGER PRIMARY KEY,
  song_id          TEXT,      -- may dangle after a Song is deleted
  kind             TEXT,      -- import | separate | analyze | export | split | transcribe
  payload          TEXT,      -- JSON
  state            TEXT,      -- queued | running | done | failed | cancelled
  cancel_requested INTEGER DEFAULT 0,
  progress         REAL DEFAULT 0,
  device           TEXT,      -- cuda | cpu
  lease_until      REAL,      -- crash recovery
  created_at       REAL,
  started_at       REAL,
  finished_at      REAL,
  error            TEXT,
  result           TEXT       -- JSON
);
```

Pragmas: `journal_mode=WAL`, `busy_timeout=5000`, `synchronous=NORMAL`.

## Features

Four screens: Song library, Song view, Album splitter and Job queue. Everything slow runs as a job.

### Song library

- One card per Song: title, artist, detected key, duration, last played
- Sorted by last played; opening a Song restores its saved mutes, loop, tempo and pitch
- Delete removes the Song folder after a confirmation
- “New Song” opens the import dialog

### Import

Anything ffmpeg can decode is accepted — no format whitelist.

- **File upload:** audio or video; for video the audio track is extracted
- **URL:** direct media links and sites like YouTube, fetched with yt-dlp
- **Pipeline:** keep the original → decode to 48 kHz stereo WAV (D-03) → compute waveform peaks → queue separation
- Title and artist are prefilled from the file's own tags when present, always editable
- A decode failure shows ffmpeg's message; the original stays so the import can be retried

### Separation

- Four stems: vocals, drums, bass, other
- Default model HTDemucs v4; stems are written once and never modified
- Runs on GPU when usable, otherwise CPU with a warning banner and an upfront time estimate
- Checkpoints between stages so a cancel lands cleanly

#### What the four stems can and cannot do

The four stems are **fixed at training time**, not configured and not detected. HTDemucs
v4 emits `vocals`, `drums`, `bass` and `other` unconditionally for any input; there is no
step that identifies which instruments are present. Two consequences are permanent, and
both were investigated and accepted rather than overlooked.

**A stem can be empty.** A song with no vocals still produces `vocals.wav` — near-silence
plus separation bleed. The UI marks such a lane rather than showing an unexplained flat
waveform.

**Guitar is not separable, and this is why the primary user is bass-first.** Guitar lands
in `other` together with keys, synths, horns and strings, so muting `other` removes most
of the arrangement. The apparent fix — `htdemucs_6s`, which adds `guitar` and `piano` —
does not work either, for a reason that no model can solve: these are **source-class**
separators, one channel per instrument class. Rhythm and lead guitar are the same class,
so they land in the same channel. Muting it to play the lead also removes the rhythm part
you wanted to play against.

Rhythm-versus-lead is a *musical role*, not a timbre, so query- and text-conditioned
separators cannot distinguish them either. The signals that do differ are production
artefacts — panning of double-tracked rhythm parts, register, monophonic line versus
chords — and exploiting them (mid/side decomposition, band-splitting,
melody/accompaniment separation) is unreliable enough to be worse than not offering it.

**Decision: stay at four stems.** Bass and drums are well served because each is
reliably a single centred source. Guitar practice is out of scope (tech spec §16). A
player wanting to work against a guitar part should lower the `other` gain rather than
mute it.

### Analysis

Runs after separation, on CPU, in a few seconds.

- **Key and scale:** the top 2–3 candidates with confidence, computed on the bass and other stems rather than the full mix (Essentia). Shown as e.g. “G minor 72% · B♭ major 18%”.
- **Scale view:** tapping a candidate opens a fretboard (4-string bass, 6-string guitar) with the scale notes highlighted, plus a scale-pattern tab. Pure lookup from key to notes — no model, no failure mode.
- **Beat grid:** beats, downbeats and BPM (beat\_this or madmom); loops and the metronome snap to it
- **Chords:** a chord chart aligned to bars (autochord or BTC)

### Song view: play along

- Per-stem mute, solo and volume, over stacked waveforms with the beat grid
- **Tempo** 50–100% without changing pitch, live during playback; clean down to about 60–70%, usable below
- **Pitch shift** in semitones, live, e.g. to match a down-tuned instrument; clean within ±2–3
- **A–B loop** snapped to bars
- Count-in and metronome click locked to the beat grid
- All settings auto-save to song.json

### Export

- Pick any stems → ffmpeg mixes them → MP3 download; one stem alone works the same way
- Current tempo and pitch are applied by default, so the file matches what you practiced to; a toggle exports at the original
- Runs as a job; the file lands in `exports/`

### Album splitter

One long file becomes many tagged MP3s. All metadata is typed by the user — no fingerprinting, no online lookup.

1. Upload one long file (any format ffmpeg reads)
2. Silence detection proposes split points
3. The waveform shows the segments; the user drags, adds or removes split points
4. Album fields entered once — artist and album — and filled down to every track
5. A title per track; track numbers are automatic
6. Export individual MP3s with ID3 tags, downloadable as a zip

### Job queue

- Strictly serial: one worker, one job at a time
- Live list of queued and running jobs with progress, device and estimate
- **Cancel:** queued jobs cancel immediately; a running job stops at its next checkpoint
- **History:** every finished job kept with state, duration, device, error message and traceback
- **Stats:** passed and failed counts, average duration per job kind and device
- **Crash recovery:** a running job holds a lease; if the worker dies, the restarted worker picks the job up again

## Tabs (bonus)

Opt-in per Song, bass first. The output is an editable starting point, not a finished tab.

1. Bass stem → torchcrepe (monophonic pitch) → notes quantized to the beat grid → MIDI
2. MIDI → fretboard positions by shortest path over playable string/fret choices, costed by hand movement and stretch
3. Render in the browser with alphaTab; export `.gp5` (PyGuitarPro) or MusicXML (music21)

Guitar comes later via basic-pitch. Clean single-note lines transcribe well; distorted chords, bends and palm mutes don't.

## Backlog

- Per-stem pitch or octave shift as a stem edit (non-destructive, rendered with Rubber Band)
- Guitar tabs
- Practice timer and log per Song
- Setlists and tags
- Per-stem EQ, e.g. boost the low end while learning a bassline
- Batch import of a whole folder
- Song export/import as a zip, for backup or moving machines
- Send album-splitter tracks straight into the library as Songs
- Album splitter: full-length playback of the source and user-defined cuts. Autodetection stays the engine's job and proposes cuts; the user can add, remove and adjust them, then run the split. A full-length waveform bar, the same component as the song detail view, makes silences easy to spot

## Open questions

Both are closed; the tech spec holds the live ones (§14, Q-01…Q-05).

- [x] Install: uv with a pinned cu128 PyTorch, or a container on NVIDIA's PyTorch image?
      → **uv with a constraints-pinned cu128 index** (D-02).
- [x] GPU runtime: PyTorch, or the ONNX-only path that avoids torch entirely?
      → **PyTorch in the worker**, with the API kept torch-free as the blast-radius
      boundary instead (D-08, §4).
