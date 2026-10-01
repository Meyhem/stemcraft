# Bass Tab (transcription) — design

*2026-10-01. Decision D-21 (tech spec §11), U-16 (UI spec §3). Supersedes the "Tabs /
transcription pipeline" item in tech spec §12 for bass. Design-system cards:
`design/ui/src/pages/screens/tab.html`, `screens/tab-states.html`,
`components/tabstaff.html`.*

## What and why

A third view on the song screen, **Tab**, shows the bass line the worker transcribed
from the `bass` stem: a tab staff on the same time axis as Stems, and the Play along neck
under it. The existing generated patterns move under **Play along**. The switch becomes
`Stems | Tab | Play along`.

The domain spec calls transcription "a bonus, not a promise". So v1 is read-only,
bass-only and opt-in per song. Every doubt it has is drawn, never hidden (U-16).

Out of scope: editing, `.gp5`/MusicXML export, guitar transcription, tunings other than
standard EADG, automatic extraction on import.

## Feasibility (measured 2026-10-01 on the reference machine)

- torchcrepe 0.0.24 resolves against the cu128 torch with no change to it. It adds only
  `resampy`.
- "Fortunate Son" bass stem (142 s): 3.7 s on the RTX 5080, full model, batch 512. The
  output starts with G1 eighths about 0.22 s apart, as the record plays.
- **fmin must be ≥ CREPE's lowest bin (31.7 Hz).** At 30 Hz torchcrepe masks every bin
  and returns f0 = fmin with periodicity −inf on CPU and GPU alike. We use 32 Hz.
- **torchcrepe's decoders are not deterministic.** `convert.bins_to_cents` adds random
  triangular dither, and both its Viterbi and weighted-argmax paths go through it. Two
  runs gave identical periodicity but f0 about 9 cents apart. The job therefore decodes
  the network's per-bin probabilities itself, with no dither (below).
- The GPU fell off the bus twice that day (Xid 79). The kernel log puts the first at
  10:54, seven minutes before the first spike, and the second at 12:44 while the GPU was
  idle, so neither was caused by transcription. Repeated CPU and CUDA runs at batch 64
  and 512 in between logged nothing. The job uses batch 512. Recorded as R-07.

## Data: `transcription.json` (worker-owned)

Written atomically by the worker only (invariant 2), served read-only by the API. Pure
re-derivation from `stems/bass.wav`, which never changes (invariant 3).

```json
{
  "schema_version": 1,
  "source": "bass",
  "model": "crepe-full",
  "device": "cuda",
  "params": {"fmin_hz": 32.0, "fmax_hz": 400.0, "hop_samples": 480,
             "voiced_min": 0.5, "gate_db": -45.0, "jump_semitones": 0.6, "min_note_samples": 2880},
  "notes": [
    {"start": 108000, "end": 117600, "midi": 31, "cents": -6.5, "confidence": 0.84}
  ]
}
```

- `start` and `end` are integer sample indices at 48 kHz (invariant 4), with end exclusive.
- `midi` is the nearest semitone as **recorded** (no pitch shift). `cents` is the
  median's deviation from it. `confidence` is the mean CREPE periodicity, 0 to 1.
- Notes are ascending and do not overlap. The transcription is monophonic.
- The time it was written is not stored. The API derives `written_at` from the file's
  mtime (derive, don't store).
- `device` is recorded because CPU and CUDA inference differ slightly. It is an input of
  the run, not a status field.
- Song state does not change. `derive_files` gains `has_transcription`. Imported →
  separated → analyzed stays the lifecycle, because a tab is an optional extra beside it.

## Worker: the `transcribe` job kind

Declared steps (D-17): `load` "Load bass stem" (0.05), `track` "Track pitch" (0.75),
`notes` "Find notes" (0.15), `write` "Write tab" (0.05).

- `analysis/bass/track.py` (touches torch, so it lives in the worker only):
  - Read `stems/bass.wav` and mix it to mono.
  - Resample to 16 kHz in memory.
  - Run `torchcrepe.preprocess` + `torchcrepe.infer` ("full", batch 512, hop 160 =
    10 ms) on `ctx.device`, with TF32 off and cuDNN deterministic.
  - Zero the bins outside [fmin, fmax].
  - Viterbi over the bins with `librosa.sequence.viterbi` and CREPE's triangular
    transition (±12 bins).
  - Periodicity is the probability at the chosen bin. Pitch is the probability-weighted
    mean of cents over the chosen bin ±4, with no dither.
  - Returns `midi_float[T]` and `periodicity[T]` at 100 frames/s, frame *t* centred on
    sample `t*480`.
  - Reports progress per inference batch.
  - fmin < 31.7 Hz raises. A misconfiguration must fail loudly (N-08), not produce a
    flat line.
- `analysis/bass/notes.py` (pure numpy, tested without a model): segments frames into
  notes.
  - A frame is voiced when `periodicity ≥ 0.5` **and** the stem's RMS at that frame is
    ≥ −45 dBFS.
  - A note is a run of voiced frames.
  - The run splits on a pitch jump: three consecutive frames more than 0.6 semitones
    from the running median.
  - It also splits on an onset from librosa onset detection on the stem (repeated notes).
  - A fragment shorter than 60 ms merges into the previous note when it is adjacent and
    of the same pitch. Otherwise it is dropped.
  - Pitch is the rounded median. `cents` is the residual. Confidence is the mean
    periodicity.
- `kinds/transcribe_song.py`:
  - Fails loudly when the song folder, `song.json` or the separated stems are missing.
  - Honours cancel between steps.
  - Returns `{notes, unsure}` for the job row.
  - Lazy-loads torchcrepe inside the job, so a broken model fails this job, not worker
    boot. This follows `analyze` (§7: analysis failures are scoped to the job).
- Dependency: `torchcrepe>=0.0.24` in `stemcraft-worker`. torch stays pinned to cu128 at
  the root (D-02).

## API (torch-free)

- `POST /api/songs/{id}/transcribe`:
  - Returns 409 when the song has no stems, or when a `transcribe` job for this song is
    already queued or running.
  - Otherwise enqueues `transcribe` with `{song_id}` and returns `201 {job_id}`.
  - Re-extract is the same call. The new file replaces the old one atomically when the
    job finishes.
- `GET /api/songs/{id}/transcription`: 404 if absent, otherwise the file plus `written_at`
  (ISO, from mtime).
- The song entry's `files` gains `has_transcription`.

## Frontend

**Switch and route.** `SongScreen` gets three `NavLink`s: Stems `/songs/:id`, Tab
`/songs/:id/tab`, Play along `/songs/:id/play`. The URLs Stems and Play along already had
stay the same (D-14).

**Shared time axis.** SongView's axis machinery moves into `songview/TimeAxis.tsx`
unchanged in behaviour: the scroller, zoom, Fit, wheel and drag-to-zoom, Follow, ruler,
chord row, loop region, playhead and ZoomTools portal. It renders the caller's rows,
`rows(scale, scroller)`, under the chord row. Stems passes its four lanes. Tab passes one
`TabStaff` row and opens at 280 px per bar, where Stems opens at 56.

**`music/bassTab.ts`** (pure). This is a note source beside `TabSource`, not an
implementation of it: its input is the transcription, not the chord chart, and it has
its own bar type, as `GuitarBar` does.
- `placeTranscription(notes, pitchSemitones)` → `TabNote[]`. It transposes each note to
  what is heard (`midi + pitchSemitones`). A note outside the 4-string neck (MIDI 28–55)
  moves by octaves until it fits, with `octave: +1 | −1 | …` recorded (U-16 `↑8`/`↓8`).
  Unsure is `confidence < 0.75`.
- Fingering is a Viterbi pass over the note sequence:
  - The states are each note's positions (frets 0–12, `positionsOf` from
    `fingering.ts`).
  - Cost: fret movement between consecutive fretted notes (open strings cost no hand
    movement), plus 0.05 per fret height, plus 0.3 per string change.
  - A gap longer than one bar resets the chain, because the hand is free during a rest.
  - The pass is deterministic: the same notes and shift always draw the same tab.
- `tabBars(tabNotes, grid)` groups notes by the bar their onset falls in, for the neck.
  The neck's next bar honours an armed loop (`nextBarOf`).

**`songview/TabStaff.tsx` + `tabStaffPainter.ts`.** One axis row: the 200 px head
holding G D A E, and a viewport-sized canvas painting only its visible slice, as
StemLane does.
- Strings, bar lines and beat lines.
- Each note is a mono fret chip whose left edge is its onset `xOf(scale, start)`, with a
  tail to `xOf(scale, end)`.
- Kinds per U-16: transcribed (bass hue), sounding now (accent + halo), unsure (40 %
  + `?`), shifted (warn ring + `↑8`/`↓8` above).
- It repaints on scroll and resize, and from the engine clock only when the sounding
  note changes (D-07, U-05).

**Neck.** `paintNeck` takes a structural `NeckBar { notes: NeckNote[] }`. `PlacedBar`
already satisfies it, and `NeckNote` gains optional `unsure` and `octave`. Unsure draws
at 40 % with a `?` badge. Shifted draws with the warn ring. A new `TabNeck.tsx` feeds it
the current and next bars of the transcription.

**`screens/TabView.tsx`** states, matching `tab-states.html`:
1. No file and no live job: empty state, **Extract bass tab**. A near-silent bass stem
   (U-10, from `engine.stemSummaries`) adds the warn banner, and extracting is still
   allowed.
2. A queued or running `transcribe` job (the latest for this song from `useSongJobs`):
   that job's `StepList`, a "running · device" chip and an Open job queue link. With a
   tab already present, the tab stays on screen and the provenance banner shows
   "re-extracting · step %".
3. The latest job failed and there is no newer file: the `StepList` with the verbatim
   traceback (U-09) and **Retry**.
4. File with zero notes: an empty state saying so. Re-extracting would give the same
   result, so no button is offered.
5. File with notes: the time axis with the `TabStaff`, a panel with `TabNeck` and the
   legend, and the provenance banner:
   - model on device, `written_at`, note count, unsure and shifted counts, **Re-extract**;
   - "Rhythm is drawn as played, not snapped to the beat grid."
   - Without a beat grid, the neck panel says it needs analysis to group notes by bar.
     The staff still draws.

When a `transcribe` job for the song reaches `done`, the view invalidates the
transcription and song queries.

## Error handling (N-08)

- Every job failure shows the real traceback under the failed step.
- Every substitution (an octave shift) is drawn and counted.
- A missing stem is a 409 with its reason, shown as a banner.
- A `transcription.json` the API cannot parse is a 500 carrying the validation error,
  shown verbatim.

## Testing

- **lib:** model round trip, ordering and overlap validation, `derive_files`.
- **worker:**
  - `notes.py` on synthetic frame tracks: steady notes, repeated notes split by onsets,
    a pitch jump, vibrato within 0.6 st staying one note, a short fragment merging, a
    gate.
  - The decoder's determinism and the fmin guard.
  - End to end, as the "click track" for this feature: a rendered synthetic bass line of
    known notes is written as a song's `bass.wav`, then the `transcribe` kind runs on the
    CPU. Every note must come back with the right MIDI, and onsets within 30 ms.
- **api:** enqueue (201, 409 without stems, 409 when already live), serving with
  `written_at`, 404, and `has_transcription`.
- **frontend:**
  - `bassTab` (transpose, octave shift, unsure, fingering continuity, bar grouping, loop
    next bar).
  - The staff painter against a recording context.
  - `TabView` states.
  - The three-way switch.
  - `TimeAxis` keeps the existing SongView tests passing unchanged.

## Docs

- Tech spec: D-21, R-07 (GPU reset during the spike), and §12 pruned to export, editing
  and guitar.
- Domain spec: the Tabs section, renaming the play-along view to Play along.
- UI spec: already carries U-16 and the Tab staff.
- README: feature bullets and a screenshot.
