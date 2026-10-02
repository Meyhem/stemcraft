# Practice: generated warm-up exercises without a song — design

**Status:** approved in brainstorming, 2026-10-02.
**Mockup:** canvas "Stemcraft Practice" (https://claude.ai/artifact/WZRW3xFbrQUiktmMQ3H4GE),
artboards *Main* (the screen, clickable) and *States*. A design-system card
`design/ui/src/pages/screens/practice.html` is drawn from it as part of the plan.
**Decision:** D-22 in `design/tech-spec-stemcraft.md` (new). D-18, D-19, D-20 are unchanged;
D-19's "reference tones need their own design" is answered here for this screen only.

## Problem

Every practice feature so far needs a song: import, separate, analyze, then play along.
A player who wants to warm up for ten minutes has nothing to open. The pieces to fix that
already exist: the bass pattern generator (`music/patterns.ts`, `fingering.ts`), the
guitar shapes and strums (`guitarShapes.ts`, `strums.ts`), progressions in any key
(`progressions.ts`), scale positions (`positions.ts`), the tab staff and neck painters, and
an engine that loops seamlessly with a metronome locked to a beat grid. This design joins
them into a song-free screen.

## Goals

- A top-level **Practice** tab (`/practice`), between Theory and Job queue.
- A **Bass | Guitar** switch. Each instrument keeps its own settings.
- Four exercise types, all generated instantly in the browser:
  1. **Groove over chords**: a progression plus a pattern (bass), or plus shapes and a
     strum (guitar).
  2. **Scales & modes**: one position or two octaves, with paths and sequences.
  3. **Arpeggios**: triads or 7ths, over one chord or a progression.
  4. **Technique drills**: chromatic 1-2-3-4, permutations, spider, string crossing,
     octaves. Fret-based, no key.
- **Fixed loop**: one pass of the exercise, rounded to whole bars, looping seamlessly until
  stopped. **Regenerate** where the generator has choices: approach notes, drill
  permutations.
- **Metronome** with count-in. **BPM** 40–220 plus tap tempo. Optional **tempo ramp**
  (start → target, +N bpm every M loops).
- **Reference sound** for the exercise, which you can mute to play it yourself: a
  reference bass in bass mode, and a reference guitar plus a backing bass in guitar mode.
- **Last settings remembered**, plus **named presets**.

## Non-goals

- **Endless variation / sight-reading mode.** The loop is fixed; Regenerate is manual.
- **Time signatures other than 4/4** (3/4 and 6/8 are a later, additive setting).
- **Tunings other than standard** (EADG, EADGBE), as on Play along (D-18, D-20).
- **Scoring or listening to the player.** There is no microphone input.
- **Saving generated notes or audio.** Both are derived from the settings, so neither is
  stored (D-18's rule).
- **Mid-bar tempo changes.** A BPM edit restarts from the loop top, and a ramp step lands
  at the loop wrap.

## Phases

- **Phase A (this spec's plan):** the screen, all four generators for both instruments,
  click and count-in, ramp, the reference bass, reference guitar and backing bass synths,
  persistence and presets.
- **Phase B (own plan, same design):** a **chord pad** (bass mode) and **drum grooves**
  (rock, shuffle, half-time…). Both are additive renders into engine slots Phase A
  leaves silent. The screen shows them disabled and marked "Phase B" until then.

## Screen

Matches the *Main* artboard.

- **Left rail:** Instrument (Bass | Guitar), then the four exercise types, then presets and
  *Save as preset…*.
- **Transport** (perform tier): play/pause; bar `n / N`; four beat dots with the downbeat
  larger; now → next (the chord for groove and arpeggios, the note for scales, the string
  for drills); BPM stepper; Ramp; Count-in; Regenerate (only for groove and drills).
- **Ramp strip** while a ramp is on: the range, the step rule, a progress bar and
  "step k of n · loop i of m".
- **Settings panel:** the key (12 keys; black keys show both names, `C♯/D♭` …), then
  pickers for the exercise type:
  - *Groove, bass:* progression · bars per chord (1 / 2 / 4) · notes · rhythm · approach.
    These are Play along's own options (`PatternNotes`, `PatternRhythm`, `PatternApproach`).
  - *Groove, guitar:* progression · bars per chord · shapes · strum · position. These are
    D-20's options.
  - *Scales:* scale (the 14 in `spell.ts`) · shape (one position / two octaves) · from fret
    · path (up, down, up + down, in 3rds, groups of 3, groups of 4) · rhythm (quarter,
    eighth, triplet, 16th).
  - *Arpeggios:* over (one chord / progression) · chord or progression · bars per chord ·
    tones (triad / 7th) · path (up, down, up + down, inversions) · rhythm.
  - *Drills:* drill · from fret · direction (across and up / up and back) · rhythm. There
    is no key; the screen says so.
- **Tab staff:** the `TabStaff` painter, with 4 or 6 lines and the highest string on top.
  It has a chord/label row; repeated bars of the same chord show `%`. Approach notes are
  drawn outlined in the bass hue, and the note sounding now in the accent. Guitar groove
  adds a **strum row** (↓ ↑) under the staff, and each strum is a column of fret chips.
  - Loops of **up to 8 bars** are drawn whole, fitted to the width.
  - **Longer loops glide**: about 8 bars are visible, and the staff scrolls under the
    playhead with the Tab view's continuous Follow glide (`timeScale.ts`). The staff is
    drawn as the loop repeated end to end, so at the wrap it keeps sliding forward instead
    of jumping back to bar 1.
- **Neck:** the existing bass neck or guitar neck painter. It shows the current bar's
  notes, numbered in order (the chord shape for guitar groove), with the note or strum
  sounding now lit and the next bar's notes as dashed rings. In drills the dots show the
  finger (`f1`…`f4`) and the note name below.
- **Sound panel:** Click; Ref. bass or Ref. guitar with **M** (mute); Backing bass (guitar
  mode, with M); Chords and Drums disabled with a "Phase B" chip.
- **Help box:** one sentence on what the exercise is and how to use it.
- **Space** plays/pauses, as on the other screens.

Note spelling: notes in a keyed exercise are spelled for the key with `spell.ts` (F major
shows B♭, E major shows G♯). Drills have no key, so they use sharps. Key-picker buttons show
both names for the black keys.

## Architecture

```
PracticeSettings ─► generate (music/practice/*, pure) ─► PracticeLoop
                                                          │  bars, notes[], grid (48 kHz ints)
                                                          ▼
                                  render (practice/render.ts, OfflineAudioContext @ 48 kHz)
                                                          │  Record<StemName, AudioBuffer>
                                                          ▼
                     EngineController.createFromBuffers() · setGrid() · setLoop() · countInAndPlay()
                                                          │  playhead clock
                                                          ▼
                         PracticeScreen: TabStaff · Neck / GuitarNeck · strum row (painters, D-07)
```

Nothing here touches the API's audio paths, the worker or torch (invariant 1). The API's
only part is `practice.json`.

### Generators: `frontend/src/music/practice/` (pure)

One module per exercise type, each a pure function of `(settings, instrument, seed)`
returning the same shape:

```ts
interface PracticeNote {
  start: number;          // beats from loop start (rational: 0.5, 1/3 …)
  dur: number;            // beats
  string: number;         // 0 = lowest string
  fret: number;           // 0..MAX_FRET
  midi: number;
  kind: 'tone' | 'approach';
  group: number;          // notes struck together (a guitar strum) share a group
  stroke?: 'down' | 'up'; // guitar strums only
}
interface PracticeLoop {
  bars: { label: string; repeat: boolean }[]; // chord row; repeat → "%"
  beatsPerBar: 4;
  notes: PracticeNote[];
  spelling: (midi: number) => string;         // key-aware, or sharps for drills
}
type GenerateResult = { ok: true; loop: PracticeLoop } | { ok: false; error: string; fixes: Fix[] };
```

- **groove (bass):** builds `BarPlan`s from `progressionChords()` and passes them to the
  existing `planBar`/`placeBars` with the chosen pattern. `nextOf` wraps to bar 0, so
  the approach into the loop start is correct. With bars per chord > 1, only a chord's
  last bar gets the approach note. `planBar` alone would put one before every bar
  followed by a chord, including a repeat of the same chord (`patterns.ts:182`), which is
  right for a song's chart. The practice generator therefore passes `nextLabel: null` for
  a bar whose next bar is the same chord, and `planBar`/`placeBars` stay unchanged.
- **groove (guitar):** D-20's shape search and `strumStrokes()` over the progression. The
  Viterbi position pass runs over the loop, treating it as circular.
- **scale:** `positionWindows()` for one position; two octaves walks the scale across the
  neck from the from-fret. Paths and sequences are index transforms over the ascending
  note list.
- **arpeggio:** chord tones from `chordTones.ts`, placed with the same fingering cost as
  the bass patterns, kept inside one position per chord where possible.
- **drill:** fret patterns over all strings; permutations are a seeded shuffle of the
  24 four-finger orderings.
- **Seeded randomness only.** The same settings and seed give the same loop. Regenerate
  changes the seed, and the seed is saved with the settings, so reopening the tab
  reproduces the loop you left.
- **Does not fit → `ok: false`** (N-08): a note above `MAX_FRET` (12) or a position with no
  window. The error names the note and the fret it would need, and `fixes` are the actions
  the screen offers as buttons ("Start from fret 0", "One position"). It never re-voices
  silently.

### Renderer: `frontend/src/practice/render.ts`

- Converts beats to integer samples at 48 kHz: `round(beat × 60 / bpm × 48000)`. The grid
  (beats, downbeats) is built from the same function, so notes and the click agree to the
  sample (invariant 4).
- **Lead-in:** the buffers start with **2 bars of silence** before bar 1. The engine's
  count-in cannot start before sample 0 (`EngineController.countInAndPlay`, documented
  limitation). Starting play at bar 1 with 1 or 2 count-in bars therefore counts over
  the lead-in. The loop region is bar 1 to the end, so the lead-in is never repeated.
- **Synths**, rendered in an `OfflineAudioContext`, stereo, 48 kHz:
  - *Bass:* a sine plus a filtered saw, with a fast attack, exponential decay and a short
    release at the note's end. The low-pass filter follows the pitch.
  - *Guitar:* a Karplus–Strong pluck per string. Strings in a strum are staggered 8 ms
    apart: low to high on a downstroke, high to low on an upstroke.
- **Slots** (the engine's four fixed `STEM_ORDER` slots):

  | Slot     | Bass mode            | Guitar mode       |
  |----------|----------------------|-------------------|
  | `bass`   | reference bass       | backing bass (chord roots, 1–5 in quarters) |
  | `other`  | chord pad (Phase B)  | reference guitar  |
  | `drums`  | drums (Phase B)      | drums (Phase B)   |
  | `vocals` | silent               | silent            |

  A silent slot is a zero-filled buffer of the right length.
- The metronome is **not rendered**. It is the worklet's own click (`click.ts`), driven by
  `setGrid()` with the exact grid, so it shares the music's timebase (D6-03).
- Rendering a 16-bar loop at 60 bpm is 64 s of audio across four stereo buffers, which is
  well within an offline render's budget. The target is under 300 ms on the reference
  machine; the plan measures it.

### Engine use

- **`EngineController.createFromBuffers(buffers)`** is split out of `create()`, which
  becomes fetch + decode + `createFromBuffers`. The engine's behaviour is unchanged.
- The Practice screen owns one engine while it is mounted (a `PracticeSession`, like
  `SongSession`), disposes it on leave, and replaces it when the loop re-renders.
- **BPM and setting changes re-render.** Any change that alters notes or the base BPM
  regenerates, re-renders, creates a new engine from the buffers, and restarts from bar 1
  (with count-in if it is on). Gain and mute are live (`setStemGain`).
- **The ramp uses the engine's tempo ratio** (`setTempo`), so a step never re-renders.
  The loop is rendered at the ramp's start BPM. Each step sets
  `ratio = current / start`, applied when the playhead crosses the loop wrap. The ratio
  range is 0.5–1.5 (`TEMPO_MIN`/`TEMPO_MAX`), so the ramp editor limits the target to
  `start × 1.5` (or `× 0.5` going down) and says why. When the target is reached, the
  ramp holds there.
- Stems are mixed to stereo before the stretcher (invariant 6). The loop wraps the cursor;
  the stretcher is never seeked (invariant 5).

### Persistence: `practice.json` (API-owned)

Same pattern as `theory.json` (D-19): `<data_dir>/practice.json`, written only by the API,
atomically (invariant 8), via `GET`/`PUT /api/practice`.
`stemcraft_lib/practice.py` holds the pydantic model, read and write; `routes/practice.py`
holds the routes.

```json
{
  "schema_version": 1,
  "instrument": "bass",
  "settings": {
    "bass":   { "exercise": "groove", "key": "G", "bpm": 100, "count_in_bars": 1,
                "ramp": { "on": true, "start": 80, "target": 120, "step": 5, "every_loops": 2 },
                "levels": { "click": 0.7, "ref": 0.55, "ref_muted": false },
                "seed": 1234,
                "groove":   { "progression": "pop", "bars_per_chord": 1, "notes": "root_fifth_octave",
                              "rhythm": "quarter", "approach": "chromatic" },
                "scale":    { "scale": "minor-pentatonic", "shape": "position", "from_fret": 5,
                              "path": "up_down", "rhythm": "eighth" },
                "arpeggio": { "over": "progression", "chord": "Am7", "progression": "pop",
                              "bars_per_chord": 1, "tones": "seventh", "path": "up", "rhythm": "quarter" },
                "drill":    { "drill": "chromatic", "from_fret": 5, "direction": "up_back", "rhythm": "eighth" } },
    "guitar": { "...": "same shape; groove carries style, strum, position instead of notes/rhythm/approach;
                         levels add backing and backing_muted" }
  },
  "presets": [ { "name": "Blues warm-up", "instrument": "bass", "settings": { "...": "one instrument's settings" } } ]
}
```

- Every exercise keeps its own sub-settings, so switching exercise type and back restores
  them.
- Unknown or invalid values are rejected by the API with a 422 that names the field. An
  unreadable file is surfaced the way `theory.json`'s is (`TheoryUnreadable` → an error
  banner), never silently reset.
- Saving a preset under an existing name asks before replacing it (*States* artboard).
- Writes are debounced in the browser (one `PUT` per ~500 ms of edits), like the Theory tab.

## Errors (N-08)

| Case | What the screen does |
|---|---|
| Exercise does not fit the neck | Error banner naming the note and fret; fix buttons; nothing plays |
| Render or engine creation fails | Error banner with the real exception text; Play disabled |
| Ramp target beyond 1.5× start (or below 0.5×) | Ramp editor clamps and says "engine tempo range is 0.5–1.5× of the start BPM" |
| `practice.json` unreadable / PUT fails | Banner with the API's error; settings in the page still work but are not saved |
| AudioContext not at 48 kHz | The existing engine warning path (`toDeviceDomain`); no special case |

## Decisions to record

**D-22 — Practice is a song-free screen; exercises are generated and rendered in the
browser and played through the existing engine.**
- *Because:* the generators, painters and the seamless-looping engine already exist (D-18,
  D-20, R-01). Rendering a short loop offline and handing it to the engine as
  stem-shaped buffers gets looping, count-in, click, mute and the playhead clock without
  a second audio path or a second clock.
- *Rejected:* a live Web Audio scheduler (a second clock beside the engine, and looping,
  count-in and mute would have to be rebuilt); worker-rendered WAVs (a queue round-trip on
  every picker change, and stored derived data, as D-18 rejected); re-rendering on every
  ramp step (the engine cannot swap buffers mid-play; the tempo ratio is seamless);
  wrapping long loops into rows (too tall with 6 strings, so the staff glides instead).
- *Reversibility:* two-way. The route, `practice.json`, the endpoints and
  `createFromBuffers` are additive.

## Testing

- **Generators** (Vitest, pure), for each type × instrument:
  - every note fits (string in range, fret 0–12);
  - the loop is whole bars;
  - the same seed gives the same loop, and a new seed changes only groove approaches and
    drill permutations;
  - spelling is key-aware (F major gives B♭), and drills use sharps;
  - with bars per chord 1/2/4, the approach falls only before a chord change;
  - strum stroke direction and string order are right;
  - impossible settings give `ok: false` with a fix.
- **Renderer:**
  - beat → sample is exact integers, and grid and note onsets match;
  - the lead-in is exactly 2 bars;
  - a short `OfflineAudioContext` render has energy at each onset and silence in the
    lead-in (jsdom has no Web Audio, so these run in the existing engine test harness).
- **Engine:** `create()` still passes its tests after the `createFromBuffers` split.
- **Manual (R-01 rule):** loop a 1-bar click-only exercise at 60 and 200 bpm, and confirm
  by ear there is no seam at the wrap and the count-in is right. Then repeat with the
  reference bass. Recorded in the plan's verification task.
- **API** (pytest): `practice.json` round-trip, an atomic write, a 422 on a bad field, and
  the unreadable-file behaviour, mirroring `test_theory_routes.py`.
- **Screen** (Testing Library): the instrument switch keeps per-instrument settings;
  changing exercise type swaps the pickers; Regenerate is shown only for groove and
  drills; the "does not fit" banner shows its fixes; the ramp clamp message appears.
- **README:** add a Practice bullet and a screenshot when Phase A ships (CLAUDE.md).
