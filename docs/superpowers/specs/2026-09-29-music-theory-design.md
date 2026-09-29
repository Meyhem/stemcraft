# Music Theory tab: a fretboard reference and practice tool — design

**Status:** approved in brainstorming, 2026-09-29.
**Mockups:** brainstorm screens `layout.html` (option B chosen) and `tools-v3.html`;
to be ported to `design/ui/src/pages/screens/theory-*.html`.
**Decision:** D-19 in `design/tech-spec-stemcraft.md`.

## Problem

Stemcraft tells a player what key and chords a song uses. The Scale sheet shows the
scale of one analysed key, and Play along shows a practice line. Neither is a place to
look things up *without* a song: "what's in A Dorian", "where are all the F♯s",
"what chords are in E♭", "what's this shape I'm holding", or to drill the
fretboard until it is memorised. Self-taught bass and guitar players need that
reference next to the practice tool they already use.

## Goals

- A new top-level **Theory** tab with a **tool rail** of 13 tools in 4 groups.
- Works for **bass (4 and 5 string) and guitar (6 string)**, any tuning, left-handed.
- Correct **note spelling** everywhere (letter-based, not a sharp/flat family).
- A **"from a song"** card that loads an analysed song's key and chords into the tools.
- Two **quizzes** that weight questions towards the player's weak spots.
- Settings and quiz history persist on the server, so they follow the player across
  browsers and devices.

## Non-goals

- **Sound.** No reference tones, drone or ear training. The only audio source stays
  the playback engine. Ear training can come later with its own design for how a
  second audio source coexists with the engine.
- **Printable sheets and tab export.**
- **Sharing the instrument setting with Play along.** Theory's instrument lives in
  `theory.json`, and Play along stays EADG as its spec says. Both necks share drawing
  code, so linking them later is a small change.
- **Rewriting `music/theory.ts`.** Scale sheet, Song view and Play along keep using it
  unchanged.
- **7-string guitar and 6-string bass.** The tuning model allows them, but they are not
  offered or tested in v1.

## Layout

Top nav gains **Theory** after Job queue. The screen is a left **rail** plus a content
area (mockup option B).

Rail, top to bottom:

1. **From a song** card: the picked song's title, key and chord count, with **Load**.
2. Tools, grouped:
   - **Find:** Scale finder · Chord finder · Note finder · Name that chord
   - **Shapes:** Scale positions · Triads & inversions · Arpeggios
   - **Harmony:** Chords in a key · Circle of fifths · Progressions · Scales over a chord
   - **Practice:** Fretboard quiz · Theory quiz
3. **Instrument** footer: instrument picker (Bass · 4, Bass · 5, Guitar · 6), tuning
   (presets: standard, drop D, half-step down, D standard, DADGAD, open G, open D, plus
   custom), left-handed toggle. It applies to every tool.

Shared controls, the same in every tool:

- **Root picker:** a row of 12 note buttons (C, C♯/D♭, D, E♭, …).
- **Label toggle:** Note / Interval / Degree.
- **Notes strip:** the notes as chips with their interval, the root filled in the bass colour.
- **Help box:** a short plain-English explanation of what is shown and what it is for.

**Selection carries between tools.** Root, scale, chord and key are one shared
selection. Choose A minor in Scale finder, open Chords in a key, and it is on A minor.

## The tools

### Find

1. **Scale finder.** Root, and a scale from grouped chips: *Common* (major, minor,
   major pentatonic, minor pentatonic, blues), *Modes* (Dorian, Phrygian, Lydian,
   Mixolydian, Locrian; Ionian and Aeolian are listed under Common as major and minor),
   *More* (harmonic minor, melodic minor, whole tone, diminished). The neck shows every
   scale note, 0–15 frets on bass and 0–17 on guitar. The **highlight position**
   control (All, 1…n) dims everything outside one position window. The help box names
   the chords the scale fits over and other scales with the same notes ("same notes as
   C major pentatonic").
2. **Chord finder.** Root + quality chips (maj, m, 7, maj7, m7, m7♭5, dim, dim7, aug,
   sus2, sus4, 6, m6, 9, add9, plus any quality tonal parses), or a free-text chord
   input ("Am7", "C/E", "F#m7b5"). It shows the name, the notes with intervals, and
   where it occurs ("ii in G major, vi in C major"). **Guitar:** up to 9 voicing cards
   (open, E-shape and A-shape barre, drop-2 on the top 4 strings), each a 5-fret
   zoomed neck with muted strings marked ✕. **Bass:** arpeggio shape cards (root
   position in two places on the neck, and root–5th–octave) instead of voicings.
3. **Note finder.** Pick one or more notes. Every occurrence lights up, one colour per
   picked note, with octaves labelled (E1, E2…). Colours for multiple notes use neutral
   outline styles with letter labels, not stem or signal hues.
4. **Name that chord.** Tap positions on the neck (one note per string on guitar, any
   on bass) or tap the 12-note row. It lists every chord name for those notes, ranked
   by the lowest note as the bass and then by simplicity, inversions and slash chords
   included ("Am7/G"; "C6 = Am7/C"). If there is no name it says so and shows the notes
   and intervals.

### Shapes

5. **Scale positions.** Step through the positions one at a time with prev/next and
   numbered chips:
   - Guitar: 5 pentatonic boxes (pentatonic scales), 5 CAGED shapes and 7
     three-notes-per-string patterns (7-note scales).
   - Bass: one-finger-per-fret boxes (4-fret span) starting on each scale degree of
     the lowest string.

   A **Play order** toggle numbers the dots from low to high.
6. **Triads & inversions.** A major, minor, diminished or augmented triad in root
   position, 1st and 2nd inversion. Guitar: shown on every group of 3 adjacent strings
   (the string-set picker defaults to "all"). Bass: the three inversions as arpeggio
   shapes on the lowest 3 strings and on the highest 3.
7. **Arpeggios.** A chord's tones across the whole neck, with the same position
   highlighting and play-order numbering as Scale positions.

### Harmony

8. **Chords in a key.** Key root + Major/Minor, and Triads/7th chords. There are 7
   cards (Roman numeral, chord name, a one-word function: home / sub / tension, from
   tonic / subdominant / dominant function). Click a card to draw it on the neck with
   interval labels and a one-line description. **Common progressions** chips transpose
   to the key. A **small circle of fifths** sits alongside with the key lit and its
   neighbours outlined. Clicking a key there changes the key. The relative major or
   minor is named in the header.
9. **Circle of fifths.** The same circle drawn large. Click a key for its key
   signature (the sharps or flats listed), the relative key, the neighbouring keys and
   its 7 chords, each linking to Chords in a key.
10. **Progressions.** A fixed library of about 15 progressions: I–V–vi–IV, I–vi–IV–V,
    ii–V–I, I–IV–V, 12-bar blues, minor blues, vi–IV–I–V, i–♭VII–♭VI–V (Andalusian),
    i–iv–v, I–♭VII–IV, ii–V–I minor, I–V–vi–iii–IV–I–IV–V (Canon), I–IV–vi–V,
    i–♭VI–♭III–♭VII, I–iii–IV–V. Transposed to the current key. Step through bar by bar
    to see each chord on the neck. With a song loaded, a **"This song"** entry shows the
    song's chord sequence (deduplicated runs, from `analysis.json`) with Roman numerals
    against the loaded key. Chords outside the key are labelled "borrowed", not forced
    into a numeral.
11. **Scales over a chord.** Pick a chord to get the fitting scales, ranked safest
    first. A scale fits when it contains every chord tone. The rank goes pentatonic
    before 7-note, and the scale built on the chord's root before others. Each result
    links to Scale finder.

### Practice

12. **Fretboard quiz** and 13. **Theory quiz**: see Quizzes below.

## From a song

The card lists songs that have `analysis.json` (from the existing library API),
sorted by last played. The chosen `song_id` is saved in `theory.json`. **Load** reads
the song's analysis through the existing endpoint and:

- sets the shared selection to the top key candidate (the other candidates stay
  choosable on the card);
- makes the song's chords available as the "This song" progression and as a chord
  list in Chord finder and Name that chord.

It never writes to the song. If the chosen song no longer exists or has no analysis,
the card says which ("*Tightrope* has no analysis yet") and offers the picker again.
It never falls back to another song silently.

## Architecture

### Frontend

- `frontend/src/theory/`: `TheoryScreen` (rail + outlet), `ToolRail`, `InstrumentFooter`,
  `SongCard`, the shared controls, and one component per tool.
- `frontend/src/music/` (pure, no React, fully unit-tested):
  - `spell.ts`: the only module that imports tonal. Wraps note, interval, scale,
    chord, key and Roman-numeral queries in Stemcraft types, so tonal never leaks into
    components.
  - `tuning.ts`: instruments, tuning presets, MIDI pitch per string.
  - `positions.ts`: note → neck positions for any tuning and fret range; position
    windows; CAGED, pentatonic box, three-notes-per-string and one-finger-per-fret shapes.
  - `voicings.ts`: guitar voicing generator and validator, bass arpeggio shapes.
  - `identify.ts`: notes → ranked chord names.
  - `progressions.ts`: the progression library.
  - `quiz.ts`: question generators, the weighting, stats derived from history.
- `Neck` component (canvas-free SVG, like the mockups): any tuning, fret range or
  start fret, open-string column left of the nut, labels by note, interval or degree,
  a dimmed window, markers (root, tone, accent, hollow, correct, wrong, question),
  click handler, left-handed flip. The existing `Fretboard` stays as is for the Scale
  sheet.
- **Routes (D-14):** `/theory` redirects to `/theory/<last_tool>` (default
  `scale-finder`). The tool slugs are `scale-finder`, `chord-finder`, `note-finder`,
  `name-that-chord`, `scale-positions`, `triads`, `arpeggios`, `chords-in-key`,
  `circle-of-fifths`, `progressions`, `scales-over-chord`, `fretboard-quiz`,
  `theory-quiz`. The shared selection is in the **query string** (`?root=A&scale=minor-pentatonic`,
  `?chord=Am7`, `?key=G&mode=major`), so back/forward and bookmarks work. The query
  string is the source of truth for selection; `theory.json` does not store it.
- **Dependency:** `tonal` (MIT, no runtime deps), pinned in `package.json`. It is
  the only new frontend dependency.

### Server

- **File:** `<data_dir>/theory.json` (next to `jobs.sqlite`). The **API is the only
  writer** (invariant 2) and writes with `stemcraft_lib.atomic.atomic_write_json`
  (invariant 8). The worker never reads or writes it.
- **Endpoints** (a new `routes/theory.py`, torch-free):
  - `GET /api/theory`: the document, or the defaults when the file does not exist.
  - `PUT /api/theory`: validates (pydantic) and replaces the whole document. The
    server trims `quiz.history` to the newest 2,000 entries before writing.
- **Schema, version 1:**

  ```json
  {
    "version": 1,
    "instrument": {
      "kind": "bass",
      "strings": 4,
      "tuning": ["E1", "A1", "D2", "G2"],
      "left_handed": false
    },
    "last_tool": "scale-finder",
    "song_id": null,
    "quiz": {
      "settings": {
        "fretboard": { "mode": "find-note", "strings": [0, 1, 2, 3], "frets": [0, 12], "accidentals": false },
        "theory": { "topics": ["keys", "chords", "intervals"] }
      },
      "history": [
        { "quiz": "fretboard", "mode": "find-note", "item": "s2f7",
          "correct": true, "ms": 2100, "at": "2026-09-29T18:04:11Z" }
      ]
    }
  }
  ```

  `tuning` is ordered low string to high, as scientific pitch. `item` is a stable
  key for the thing asked (`s<string>f<fret>` on the neck, `v-of-Eb` and so on for
  theory facts). Nothing derived (stats, weak spots, heatmap) is stored.
- **Saving:** instrument and last-tool changes are sent as they happen, debounced
  500 ms. Quiz answers are held in memory and sent with the document at the end of
  each round, and when leaving the quiz page mid-round.

## Quizzes

**Round:** 20 questions. The mode and focus settings are chosen before starting and
saved in `quiz.settings`. Each answer gets immediate feedback:

- right: the dot turns green;
- wrong: a red ✕ and an explanation ("that's G♯, one fret too high"), and the
  question stays until it is answered right. Only the first attempt is scored and
  recorded.

The end-of-round summary shows the score, the average time, the 3 weakest items and
**Practise these** (a round restricted to them).

**Fretboard quiz modes** (all within the focus strings and fret range):

- *Name the note:* one dot lit; answer with the 12 note buttons (keys 1–9, 0, -, =).
- *Find the note:* tap every occurrence of a named note.
- *Find the interval:* "tap the 5th above this dot", which can be on any string in range.
- *Spell the chord:* "tap the notes of Dm" inside a 4-fret window.

**Theory quiz:** 4-option multiple choice (keys 1–4). Topics: keys (V of X, relative
minor, number of sharps/flats), chords (notes of X, name these notes), intervals
(C to A is a…). Wrong options are plausible: neighbouring keys, one changed chord tone.

**Weighting:** each item's weakness is computed from its last 5 answers:
`weakness = 0.6 · wrong_rate + 0.4 · min(avg_ms / 6000, 1)`. Items with no answers
score 1.0. The pick probability is proportional to `0.15 + weakness`, so strong items
still appear. The same item never comes twice in a row. `quiz.ts` takes a seeded RNG
so tests are deterministic.

**Stats panel** (both quiz pages): for the fretboard, a heatmap on the `Neck`,
coloured per position from `--ds-error` (weak) to `--ds-ok` (strong) at reduced
opacity. Positions never asked are left blank. For the theory quiz, a list of the 10
weakest facts. **Reset history** asks for confirmation, then PUTs an empty history.
Red and green mean wrong and right here, which is the design system's rule for vivid hues.

## Errors (N-08)

| Situation | Behaviour |
| --- | --- |
| `theory.json` missing | Normal first run: `GET` returns the defaults |
| `theory.json` unreadable or fails validation | `GET` returns a 500 with the real error. The tab shows a red banner quoting it, with **Reset to defaults** (confirm) that PUTs the defaults. The file is never overwritten silently |
| `PUT` fails (network, 422) | Banner "Couldn't save: <error>" with **Retry**. Unsaved quiz answers stay in memory until a save succeeds |
| Typed chord doesn't parse | Inline message under the input: "Don't know 'Cmaj13#11b9'". Nothing is guessed |
| No chord name for tapped notes | "No chord name for these notes", plus the notes and intervals |
| Chosen song missing or unanalysed | The song card says which, and offers the picker |
| Tuning or instrument can't show a shape (e.g. a CAGED shape on bass) | The control is disabled with a tooltip giving the reason, not hidden |

## Testing

- **`music/*` unit tests (vitest), table-driven:**
  - spelling: D harmonic minor → D E F G A B♭ C♯; F♯m7♭5 → F♯ A C E; C dim7 → C E♭ G♭ B𝄫; E major → E F♯ G♯ A B C♯ D♯;
  - positions per tuning, including drop D and 5-string;
  - every generated voicing is playable (4-fret stretch at most, one note per string) and contains exactly the chord's tones;
  - `identify(spell(chord)) ∋ chord` for every root × quality, and inversions give the slash name;
  - quiz: weighting with a seeded RNG, no immediate repeats, stats derived correctly from a fixture history.
- **Component tests (RTL):** each tool renders the right lit positions for a known
  selection; selection carries across tools through the query string; quiz accept and
  reject flow; error banners for a failed GET and a failed PUT; the song card's missing-analysis state.
- **API tests (pytest):** defaults when the file is missing; a PUT/GET round trip;
  the write goes through the atomic helper; a corrupt file gives a 500 with the message;
  an invalid body gives a 422; history is capped at 2,000; the worker package never
  references `theory.json`.
- **Design system:** port the mockups to `design/ui/src/pages/screens/theory-*.html`.

## Build order

Each phase gets its own plan document in `docs/superpowers/plans/`.

- **T1, foundation (the tab is usable):** `theory.json` + API + tests; nav item,
  routes, `TheoryScreen`, rail, instrument footer; `Neck`; `tonal`, `spell.ts`,
  `tuning.ts`, `positions.ts`; the song card; **Scale finder, Chord finder,
  Note finder, Chords in a key** (with the small circle). README and screenshots.
- **T2, shapes and harmony:** `voicings.ts` (the guitar voicing cards also land in
  Chord finder here, and T1's Chord finder shows notes and intervals only),
  `identify.ts`, `progressions.ts`; **Scale positions, Triads & inversions,
  Arpeggios, Name that chord, Circle of fifths, Progressions, Scales over a chord**.
- **T3, practice:** `quiz.ts`; **Fretboard quiz, Theory quiz**; stats panel and
  heatmap; batched history saves.
