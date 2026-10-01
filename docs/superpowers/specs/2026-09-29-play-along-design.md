# Play along: live bass patterns over the chord chart — design

**Status:** approved in brainstorming, 2026-09-29.
**Mockup:** `design/ui/src/pages/screens/play-along.html`.
**Decision:** D-18 in `design/tech-spec-stemcraft.md`.

## Problem

Song view is where a song is *edited*: mix, tempo, pitch, loops. It tells a bass player
which chord is playing and which comes next, but not what to play over it. The scale
sheet shows every note that fits the key, which is too much to take in while playing.
A self-taught player needs a concrete, playable line for *this* bar and the next,
shown on the neck in time with the music.

## Goals

- A separate **Play along** screen at `/songs/:songId/play`, reached from Song view.
- It shows a live **12-fret 4-string bass neck** with the current bar's notes (filled
  and numbered in play order, with the note to play now highlighted) and the next bar's
  notes (hollow).
- Under the neck, a **beat lane** shows the current and next bar as note chips at their
  rhythmic positions, with a cursor that sweeps with the engine clock.
- The notes are **generated from the chord chart** by a pattern the user picks. There
  are three independent choices: notes, rhythm and approach.
- **Playback keeps running** when switching between Song view and Play along.
- Loop control on the Play along screen works **by bar numbers** (start/end steppers,
  or clicking the chord ribbon). It edits the same `active_loop` Song view edits.

## Non-goals

- **Transcription.** The notes are a practice pattern, not what the bassist on the
  record plays. The "Tabs (bonus)" transcription stays deferred. This design only
  leaves a seam for it (`TabSource`, below).
- **Text tabs and export.** The user chose a graphical neck over tab notation. A tab or
  `.gp5` export can come later from the same `BarNotes`.
- **Per-loop or per-bar patterns.** One pattern per song. Per-loop overrides were
  considered and dropped.
- **Other tunings, 5-string.** (Guitar: since 2026-10-01, D-20 and `2026-10-01-guitar-tabs-design.md`.) The neck is EADG standard. Pitch shift is
  handled by transposing (below), not by a tuning setting.
- **Mix controls on the Play along screen.** Mute, solo and gain stay in Song view.

## Screen

Top to bottom (see the mockup):

1. **Top bar**: back to Song view, title, "Play along · bass".
2. **Transport panel** (perform-size hit targets, since it's touched while holding
   the bass): play/pause, bar + beat readout, tempo, Loop toggle, loop start/end bar
   steppers, metronome, count-in.
3. **Pattern panel**: key (the analysis's key candidates, top one selected by
   default), notes, rhythm, approach. Every change saves to `song.json` and redraws
   immediately.
4. **Chord readout**: the current chord large, then → the next chord. When
   `pitch_semitones ≠ 0`, a chip says the pitch shift is applied.
5. **Neck** (canvas): filled bass-colour dots are this bar's notes, labelled with the
   note name and play-order number(s). The dot to play now is accent-blue with a halo.
   Dashed hollow rings are the next bar's notes, and an orange ring marks an approach
   note.
6. **Beat lane** (canvas): two boxes, the current bar and the next (dimmed), each
   divided into its beats, with a chip per note at its slot and a cursor sweeping the
   current bar. At each downbeat the lane flips: next becomes current.
7. **Chord ribbon**: one cell per bar with number and chord. The current bar is
   outlined and the active loop's bars are tinted. Click moves the playhead to the bar.
   Ctrl/Cmd-click sets the loop start and shift-click sets the end (changed
   2026-09-30; click used to set the start).
8. **Banner**: "A practice pattern over the detected chords, not a transcription"
   (R-05 honesty).

**Empty and failure states** (N-08: shown, never guessed):
- Song not analyzed yet: the same "needs analysis" empty state Song view uses, linking
  back to it.
- Grid unusable (`buildGrid` returns `null`): an empty state with that reason.
- Bar chord `N`: empty neck, lane shows "no chord". Bar chord `X`: empty neck, lane
  shows "unclassified".
- A pattern that needs something the bar doesn't have (see fallbacks below): the
  fallback is drawn, and a chip on the chord readout says what was substituted.

## Settings: `song.json` v3

Additive migration v2 → v3, the same shape as v1 → v2 in `song.py`: stamp the version
and let pydantic defaults fill the new field.

```jsonc
"play_along": {
  "key": null,                 // null = top key candidate; else {"tonic": "G", "mode": "major"}
  "pattern": {
    "notes":    "triad_chord", // root | root_fifth | root_fifth_octave | octave_pump
                               // | triad_chord | triad_diatonic | seventh
    "rhythm":   "quarter",     // whole | half | quarter | eighth
    "approach": "none"         // none | chromatic | scale | fifth
  }
}
```

- Defaults: `key: null`, `triad_chord`, `quarter`, `none`.
- Saved like every other recipe change: a whole-document PUT plus invalidate (D-13),
  last-write-wins.
- `Loop` and `active_loop` are unchanged. The Play along loop steppers and ribbon
  write `active_loop` exactly as Song view's Set A / Set B do: the existing name is
  kept (`""` if none), and a loop is at least one bar long. Stored bars are
  **0-based** and `end_bar` is **exclusive**, as today. The steppers and ribbon show
  **1-based inclusive** bars, like the ruler: "5 to 8" is stored as
  `start_bar: 4, end_bar: 8`. The Loop toggle is the same arm/disarm action as Song
  view's Loop button.
- **Nothing derived is stored.** Resolved key, transposed chords, notes and fret
  positions are recomputed from analysis + recipe on every change.

## Generation: `music/patterns.ts` (pure)

Input per bar: the chord, the next bar's chord, the resolved key, the pattern, the
grid's `beatsPerBar` and `pitch_semitones`. Output: `BarNotes`.

```ts
interface PatternNote { pitch: number /* MIDI */; beat: number /* offset in beats */;
                        beats: number /* duration */; approach: boolean }
interface BarNotes { bar: number; chord: string; notes: PatternNote[];
                     substitution: string | null; empty: 'no_chord' | 'unclassified' | null }
```

**Chord parsing** (BTC labels, `root:quality[/degree]`). As `recognize.py` emits them
today, a bare root (`C#`) is major, roots are sharp-spelled, the 14 qualities are `min maj
dim aug min6 maj6 min7 minmaj7 maj7 7 dim7 hdim7 sus2 sus4`, and no slash is emitted. The
slash form is still parsed, so a future chord model or transcription source works unchanged.
- The third is 4 semitones (`maj`, `aug`, `7`, `maj7`, `maj6`, `9`…) or 3 (`min`, `dim`,
  `min7`, `hdim7`, `dim7`, `min6`…). `sus2`/`sus4` use 2/5 in place of the third.
- The fifth is 7, or 6 for `dim`/`hdim7`/`dim7`, or 8 for `aug`.
- The seventh is 10 for `7`/`min7`/`hdim7`, 11 for `maj7`, 9 for `dim7`, otherwise none.
- **Slash chords:** `/degree` is a scale degree of the chord root (`3` = +4, `b3` = +3,
  `5` = +7, `b7` = +10…). **The slash note replaces the root** as the bar's bass note
  for the `root`, `root_fifth`, `root_fifth_octave` and `octave_pump` patterns; the
  arpeggio patterns start from it too. This is what a bassist plays over `C/E`.
- An unknown quality fails loudly. The parse error is shown on that bar as an
  "unclassified"-style empty state with the raw label; it never crashes the screen
  and is never silently treated as major.

**Transposition:** every chord root, slash note and the key tonic are shifted by
`pitch_semitones` before generation, so the neck and the chord readout match what is
heard (user's choice A). Note spelling follows `theory.ts` for the *transposed* key.

**Note patterns** (chord degrees, cycled over the slots):

| `notes` | cycle |
|---|---|
| `root` | 1 |
| `root_fifth` | 1 5 |
| `root_fifth_octave` | 1 5 8 5 |
| `octave_pump` | 1 8 |
| `triad_chord` | 1 3 5 3, using the chord's own third and fifth |
| `triad_diatonic` | 1 3 5 3, with the third and fifth taken from the key's scale above the root |
| `seventh` | 1 3 5 7 |

**Fallbacks** (drawn with a visible `substitution` chip, never silent):
- `triad_diatonic` when the root is not in the key's scale (a borrowed chord): the
  chord triad is used and the chip reads e.g. "B♭ not in G major: chord triad".
- `seventh` when the chord has no 7th: the key's diatonic 7th above the root. If the
  root is not in the key either, the plain chord triad is used, with the chip.

**Rhythm → slots** (beat offsets inside the bar, `bpb` = beats per bar):
- `whole`: one slot at beat 0.
- `half`: every 2 beats (4/4 → 0, 2; 3/4 → 0, 2 with the last lasting 1 beat).
- `quarter`: every beat.
- `eighth`: every half beat.

Each note lasts until the next slot. The pattern cycles across slots, so a 1-3-5-3 in
3/4 quarters plays 1-3-5, and `root` in eighths plays eight roots.

**Approach** replaces the **last slot** with a lead-in to the *next* bar's bass note:
`chromatic` = one semitone below it (above if below would fall under open E),
`scale` = the key's scale note just below it, `fifth` = a fifth below it (a fourth
above if out of range). "Next bar" means the **loop start** when the current bar is the
active loop's end bar, so the wrap is approached correctly. There is no approach when
the next bar is `N`/`X`, when the song ends, or with `whole` rhythm (only one slot).

## Fingering: `music/fingering.ts` (pure)

Each note is assigned a (string, fret) on EADG in frets 0–12. The octave of each bar's
bass note is chosen here too: any MIDI pitch from E1 (28) up that is playable.

- **Candidates:** every (string, fret) that sounds the pitch, for every playable
  octave of the bar's root. Other chord tones sit above the chosen root (`8` = +12).
- **Cost:** hand movement between consecutive notes (fret distance, weighted more
  across bars than within one), stretch within a bar (span beyond 4 frets is heavily
  penalised), a small preference for lower positions, and open strings free.
- **Search:** Viterbi over bars. The state is a bar's chosen root placement, and inside
  a bar each note takes the cheapest candidate given the previous note. It runs over the
  whole song once per settings change: O(bars × candidates²), which is trivial for a
  few hundred bars.
- **Deterministic:** the same inputs always give the same neck.
- Approach notes are placed after the next bar's root is fixed, since they depend on it.

## Architecture

- **`SongScope` layout route** wraps `songs/:songId` (Song view) and
  `songs/:songId/play` (Play along). It owns what `SongView` owns today: the song
  and analysis queries, the `EngineController` lifecycle (create on entry, dispose
  only on leaving `/songs/:songId/*`), and pushing the recipe (mix, tempo, pitch,
  loop, metronome) into the engine. Both screens read these from a React context.
  Switching screens keeps the engine, so playback, position and loop continue
  uninterrupted. Scale sheet and Export stay outside the scope, as today.
- **`TabSource` interface:** `barsFor(song, analysis, grid) → BarNotes[]`. The
  pattern source composes `patterns.ts` and `fingering.ts`. A future transcription
  source (a worker job writing a file into the song folder) implements the same
  interface, and the screen doesn't change.
- **`playalong/` components:** `PlayAlong` (screen), `PatternPanel`, `LoopBars`,
  `Neck` (canvas), `BeatLane` (canvas), `ChordRibbon`. `Neck` and `BeatLane` repaint
  from the engine clock through the existing `usePlayhead` painter hook, never from
  React state at audio rate (U-05, D-07). They draw only; they never touch audio.
- **Bar and beat under the playhead** come from `grid.ts` arithmetic over integer
  sample indices (D-03). A new pure `beatPosition(grid, sample) → {bar, beat, frac}`
  sits beside the existing bar helpers.
- **API:** `Song` gains `play_along`, `SCHEMA_VERSION = 3`, a migration from v2, and
  the PUT validates the enums. No new endpoints, no worker change, no torch (invariant 1).

## Testing

- `patterns.test.ts`: chord parsing across the BTC vocabulary, including slash chords
  and unknown qualities; every note pattern × rhythm in 4/4 and 3/4; approach variants,
  including the loop-wrap next bar, `N`/`X` next bars and range edges; each fallback
  producing its substitution text; transposition.
- `fingering.test.ts`: determinism; stays in position across a I–IV–V; no stretch
  beyond the limit; all positions within frets 0–12; approach placed relative to the
  chosen next root.
- `grid.test.ts`: `beatPosition` at bar starts, mid-beat and past the analysed bars.
- Component tests for `PatternPanel` (saves the recipe), `LoopBars` and `ChordRibbon`
  (write `active_loop`), and the empty states.
- `SongScope`: the engine is created once and survives Song view ↔ Play along
  navigation, and is disposed on leaving the song (mocked `EngineController`, as in
  `routes.test.tsx`).
- Python: v2 → v3 migration round-trips; invalid enum values are rejected by the PUT.
- README: a Play along feature bullet and a new screenshot in `docs/screenshots/`.
