# Tabs for guitar: chord voicings and strums over the chord chart — design

**Status:** approved in brainstorming, 2026-10-01.
**Mockup:** `design/ui/src/pages/screens/play-along-guitar.html` (guitar) and
`play-along.html` (bass, now with the instrument switch).
**Decision:** D-20 in `design/tech-spec-stemcraft.md` (new). Amends D-18's guitar non-goal;
D-19 is unchanged.

## Problem

The Tabs view (D-18) tells a bass player what to play in this bar and the next. A
guitarist gets nothing: the chord chart is there, but not a shape to hold or a rhythm to
strum. The pieces already exist elsewhere. The Theory tab finds playable guitar voicings
for any chord (`music/voicings.ts`), and the Tabs view already has the clock, the grid,
the loop and the chord parsing. This design joins them.

## Goals

- A **Bass | Guitar** switch at the front of the Tabs pattern panel, saved per song.
- In Guitar mode the Tabs view shows **rhythm guitar**: the current bar's chord voicing on
  a 6-string, 12-fret neck, the next bar's voicing as hollow rings, and a **strum lane**
  of down and up strokes in time with the music.
- Four guitar choices, all saved per song: **style**, **strum**, **position**, **simplify**.
- Bass mode is unchanged, and each instrument keeps its own settings when you switch.

## Non-goals

- **Picked arpeggios / single-note guitar lines.** Considered as a guitar sub-mode and
  dropped; bass already covers chord-tone lines.
- **Guitar tunings.** Guitar is fixed at EADGBE standard. Pitch shift covers down-tuned
  playing, as it does for bass (D-18). The Theory tab's tunings are not shared (D-19).
- **Transcription.** As for bass: these are practice shapes over detected chords, not
  what the record's guitarist plays (R-05).
- **Separating the guitar.** It is in the `other` stem and cannot be isolated (domain
  spec, "What the four stems can and cannot do"). The screen says so.
- **Finger numbers, chord boxes, tab or `.gp5` export.** The neck shows chord degrees;
  the rest can come later from `GuitarBar`.
- **Muted or percussive strokes, per-bar or per-loop overrides.**

## Screen

The same layout as bass Tabs (see both mockups). Only the panel's rows, the neck and the
lane change.

1. **Pattern panel.** `Instrument` (Bass | Guitar) comes first, then `Key` and the
   "Scale & fretboard" link, both shared. After that:
   - Bass: Notes, Rhythm, Approach (unchanged).
   - Guitar: **Style** (Open / Barre / Power / Triad), **Strum** (Whole / Half /
     Quarters / Eighths / Folk / Push), **Position** (Auto / Low / Mid) and
     **Simplify** (a checkbox, "7ths & 6ths → triads").
   - With Style = Open, Position is disabled and a hint says "open shapes sit at frets
     0–4". Its stored value is kept and comes back when the style changes.
2. **Neck** (canvas, `guitarNeckPainter`). It uses the bass neck's geometry (`neckGeometry`, the fret
   numbers, inlays) with 6 strings, low E at the bottom, and a string gap tightened so it
   is about the same height as the bass neck.
   - This bar's voicing: dots filled in `--ds-other` (guitar lives in that stem, U-01),
     each labelled with its chord degree (R, 3, ♭3, 5, ♭7…). Roots also get a
     `--ds-text` ring. An open string is drawn as a ring left of the nut, a muted string
     as ✕ there.
   - The barre of a barre shape is drawn as a bar across the strings it covers.
   - Next bar's voicing: dashed hollow rings, as on the bass neck.
   - **On every stroke** the whole current shape gets the accent halo for that eighth.
     There is no single "note to play now": a strum hits every string.
3. **Strum lane** (canvas, `strumLanePainter`). Two bar boxes (current, next dimmed),
   each beat split into its two eighths and labelled `1 & 2 & …`. Strokes are ↓ / ↑
   chips (large glyphs, U-C1). The stroke to play now is accent-filled. A **push**
   stroke carries the next chord's name and the orange ring an approach note uses. The
   cursor and the downbeat flip are the bass lane's.
4. **NowReadout and ChordRibbon:** unchanged in behaviour. The ribbon cell shows a
   simplification under the chord ("Em7 → Em"), and the readout's substitution chip
   shows any style or position fallback for the current bar.
5. **Banners.** The existing "practice pattern, not a transcription" note, worded for
   guitar ("…the style you pick… a substituted shape says what it replaced"). In Guitar
   mode it is preceded by a warn banner: "Guitar shares the *other* stem with keys and
   synths. It can't be separated on its own, so turn *other* down rather than muting it."
6. The view bar chip reads `guitar · standard tuning · pitch −2 st · shapes follow what
   you hear` when pitch is shifted.

**Empty and failure states** are the bass ones (N-08): not analyzed, unusable grid,
`N`, `X`, and an unparsed label, each shown, never guessed. A bar with no voicing in any
style is an empty neck that says "no playable shape for <chord>". It never draws the
nearest-looking shape.

## Settings: `song.json` v4

Additive migration v3 → v4 in `song.py`: stamp the version and let pydantic defaults
fill the new fields, exactly as v1 → v2 and v2 → v3 do.

```jsonc
"play_along": {
  "key": null,                  // shared, unchanged
  "instrument": "bass",         // new: bass | guitar
  "pattern": { ... },           // bass, unchanged
  "guitar": {                   // new
    "style": "open",            // open | barre | power | triad
    "strum": "folk",            // whole | half | quarters | eighths | folk | push
    "position": "auto",         // auto | low | mid
    "simplify": false
  }
}
```

- Defaults: `instrument: "bass"` (existing songs open exactly as before), `open`,
  `folk`, `auto`, `false`.
- The models are pydantic `Literal`s, so a bad value is a validation error on PUT. It is
  never coerced.
- Saved like every recipe change: a whole-document PUT through the session's one funnel
  (`onPlayAlongChange`), last-write-wins (D-13).
- **Nothing derived is stored.** Voicings, strokes and substitutions are recomputed from
  analysis + recipe on every change.

## Generation: `music/strums.ts` (pure)

Inputs are those of the bass path: chord labels per bar, resolved key, grid
`beatsPerBar`, `pitch_semitones`, armed loop. The guitar settings are added.

```ts
type Stroke = { beat: number /* offset in beats, multiple of 0.5 */; dir: 'down' | 'up';
                accent: boolean /* the bar's first stroke */; early: boolean /* push */ };
interface Voicing6 { frets: (number | null)[] /* row 0 = high e */; barre: { fret: number; from: number; to: number } | null;
                     degrees: (string | null)[]; label: string }
interface GuitarBar { bar: number; chord: string /* as shown, after transpose */;
                      voicing: Voicing6 | null; strokes: Stroke[];
                      substitutions: string[]; empty: EmptyKind | 'no_shape' | null }
```

### Chord to `ChordInfo`

`chordTones.parseChord(label, transpose)` already parses BTC labels and applies pitch
shift. A small adapter, `toChordInfo(tones)`, builds the `spell.ts` `ChordInfo` that
`voicings.ts` takes, with note names spelled for the resolved key. It is tested over all
14 qualities and the slash form. Transposition happens first, as for bass, so shapes
match what is heard.

### Simplify (before voicing)

| from | to |
|---|---|
| `maj7`, `7`, `maj6` | `maj` |
| `min7`, `min6`, `minmaj7` | `min` |
| `hdim7`, `dim7` | `dim` |
| `maj`, `min`, `dim`, `aug`, `sus2`, `sus4` | unchanged |

A changed chord adds the substitution `"Cmaj7 → C"`. A slash bass is kept.

### Candidates per style

`isPlayable()` demands at least 4 sounding strings and every chord tone, which power
chords and triads cannot meet. So each style has its own candidate source and its own
rule set, each with a test:

| style | source | rule |
|---|---|---|
| `open` | `guitarVoicings()` | has an open string; nothing fretted above 4 |
| `barre` | `guitarVoicings()` | a clean barre (no open string in its span); lowest sounding string is 6th or 5th; no open strings |
| `power` | generated | root on 6th or 5th string + 5th + octave (2 or 3 adjacent strings, rest muted); only for chords with a perfect 5th and no slash, i.e. not `dim`, `aug`, `hdim7`, `dim7` |
| `triad` | generated | 3 adjacent strings among the top four (e B G / B G D); root position and both inversions; fret span ≤ 3; frets 0–12 |

`guitarVoicings()` keeps one result per starting fret, up to `limit`. The strums module
calls it with a limit of 12 so that every fret window has candidates.

**Fallback, loud (N-08):** if a style has no candidate for a chord, the next style in the
order **open → barre → triad** (and **power → barre → triad**) is tried. The bar gets
the substitution `"no open D♯dim, using triad"`. If every style fails, the bar is
`empty: 'no_shape'`.

### Position (Viterbi over the song)

- Each candidate's *anchor* is its lowest fretted fret (0 for an all-open shape).
- **Window filter:** Low keeps shapes inside frets 0–5, Mid inside 5–9, Auto keeps all.
  Open style ignores the window (the control is disabled). If the filter leaves a bar
  with nothing, its full candidate list is used and it gets the substitution
  `"no low-position F♯m7♭5, fret 9"`.
- **Path:** one voicing per bar, cheapest path through the song. The cost is:
  - `|Δanchor|` between consecutive bars (weighted most)
  - plus the shape's fret span
  - plus a small `anchor × ε` preference for low positions.

  Ties break on the lower anchor, then on the lower `tab` string, so the result is
  deterministic: the same song and settings always draw the same neck. Empty bars break
  the chain (cost reset), as in `fingering.ts`.

### Strums

A strum is a cycle of **one-beat cells**, each two eighth slots (`D`, `U` or rest). The
cells cycle over `beatsPerBar`, so 3/4 works as the bass rhythms do.

| strum | cells (cycled) |
|---|---|
| whole | `D·` then `··` for the rest of the bar |
| half | `D·` `··` |
| quarters | `D·` |
| eighths | `DU` |
| folk | `D·` `DU` `·U` `DU` |
| push | as folk, but the bar's **last** `U` is `early`: it plays the **next** bar's chord, and that bar's beat-1 `D` is dropped (tied over) |

- **Push and the next bar:** the next bar is the one playback goes to. At the armed
  loop's end it is the loop's first bar (as with bass approach notes, using
  `nextOf(bar)`). If the next bar is empty (`N`, `X`, `no_shape`), push falls back to a
  normal `U` on the current chord, and the bar gets the substitution "no push into an
  empty bar".
- The first stroke of each bar is `accent: true` (drawn bolder).

## Source and screen wiring

- `TabResult` becomes a union on `instrument`:
  - `{ ok: true; instrument: 'bass'; … PlacedBar[] }`, as today.
  - `{ ok: true; instrument: 'guitar'; key; bars: GuitarBar[]; nextOf }`.

  `guitarSource.barsFor()` sits next to `patternSource`. `PlayAlong.tsx` picks the
  source from `song.play_along.instrument`.
- **Shared parts:** `NowReadout`, `ChordRibbon`, the key picker and `nextOf`. They read
  a small `BarSummary` (`bar`, `chord`, `substitutions`, `empty`) that both bar types
  satisfy, so they don't branch on instrument.
- **Per-instrument parts:** the `Neck` and `BeatLane` components dispatch to their bass
  or guitar painter. The painters stay pure and are tested against the recording
  context.
- Colours: `colors.ts` gains `other` from `--ds-other`.

## Decisions to record

- **D-20 (new) — Guitar Tabs are generated chord voicings and strums.** In the
  `play_along` recipe (`song.json` v4), next to the bass patterns. Instrument per
  song, guitar fixed at standard tuning, nothing derived stored.
  - *Because:* the voicing search already exists (D-19), and rhythm guitar over a chord
    chart is what a guitarist practises against.
  - *Rejected:*
    - picked arpeggios (duplicates the bass mode)
    - generalising the bass pipeline to chords (bends `BarNotes` and puts the working
      bass fingering at risk)
    - embedding the Theory Chord finder (not driven by the playback clock)
    - sharing the Theory instrument (reverses D-19)
  - *Reversibility:* two-way, the field is additive.
- **D-18 amended:** "Other tunings, 5-string, guitar" becomes "other tunings, 5-string".
  Guitar is covered by D-20. The pitch-shift-instead-of-tuning stance stays.
- **Domain spec:**
  - "Play along" gains a "Guitar" subsection.
  - The line "Guitar, other tunings and a tab or Guitar Pro export are later work"
    drops "Guitar".
  - The Backlog's "Guitar tabs" entry is replaced by "Guitar transcription".
- **UI spec:** the Tabs screen entry lists the instrument switch and the guitar rows.
  The Neck component row mentions the 6-string Tabs neck and the strum lane.

## Testing

- **`strums.test.ts`:**
  - each style's candidates obey that style's rules
  - each fallback chain and its wording, including `no_shape`
  - the Simplify table, row by row
  - the window filter and its fallback chip
  - Viterbi is deterministic and prefers small moves (G–D–Em–C in Open stays at frets
    0–3; in Barre it does not jump between 3 and 10)
  - strum cells over 3/4 and 4/4
  - push into the next bar, into the loop start at a loop's end, and its fallback into an
    empty bar
- **`toChordInfo` test:** all 14 qualities, slash form, a transposed label.
- **Painter tests** (`guitarNeckPainter`, `strumLanePainter`): open, muted and barre
  drawing, degree labels, next-shape rings, the stroke halo, the push ring, the empty
  neck message.
- **`PatternPanel` test:**
  - the instrument switch swaps the rows
  - switching back keeps each instrument's settings
  - Position is disabled for Open, and its value is kept
- **`PlayAlong` screen test:** guitar mode shows the other-stem banner. A substituted
  bar shows its chip.
- **Python:**
  - v3 → v4 migration (old file reads with `instrument: "bass"` and the guitar defaults)
  - a bad `style`/`strum`/`position` value is rejected on PUT
  - round trip through `write_song`
- **No engine work:** nothing touches the audio path, the loop wrap or the stretcher,
  so no click-track check is needed.
- **README upkeep and screenshots:** the feature bullets for Tabs and a guitar Tabs
  screenshot in `docs/screenshots/`.
