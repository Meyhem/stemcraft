# Play Along Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a separate Play along screen (`/songs/:songId/play`). It shows a live bass neck and a beat lane for the current and next bar. The notes are generated from the chord chart by a pattern the user picks, and playback keeps running when switching to and from Song view.

**Architecture:** Note generation is pure TypeScript in `frontend/src/music/`:
- `chordTones.ts` parses chord labels.
- `patterns.ts` turns a bar into timed interval slots.
- `fingering.ts` picks the octave and string/fret with a Viterbi search.
- `tabSource.ts` composes these three behind a `TabSource` interface.

The engine, recipe, transport and loop move out of `SongView` into a `SongSession` context. A `SongScope` layout route provides that context to both Song view and Play along, so the engine outlives a screen switch. The neck and lane are canvases painted from the engine clock through the existing `usePlayhead`. The only backend change is `song.json` schema v3, which adds a `play_along` field.

**Tech Stack:** Python 3.12, pydantic, FastAPI, pytest (`uv run pytest`); React 19, React Router 7, TanStack Query 5, Vitest + RTL (`npm --prefix frontend test -- --run`), CSS modules over `tokens.css` (D-16).

**Spec:** [docs/superpowers/specs/2026-09-29-play-along-design.md](../specs/2026-09-29-play-along-design.md). Decision D-18 in `design/tech-spec-stemcraft.md`. Mockup: `design/ui/src/pages/screens/play-along.html` (build with `python3 design/ui/build.py`, open `design/ui/dist/screens/play-along.html`).

## Global Constraints

- **The API never imports torch.** This feature adds no Python outside `stemcraft_lib/song.py`.
- **One writer per file.** Only the API writes `song.json`. No worker change, and no new files in the song folder.
- **Nothing derived is stored.** Resolved key, transposed chords, notes and fret positions are recomputed on every change and never written to `song.json`.
- **No renderer plays audio (D-07), no audio-rate React state (U-05).** Canvases repaint from `usePlayhead` into refs.
- **Integer sample indices at 48 kHz (D-03).** Bar/beat positions come from `grid.ts` arithmetic.
- **Fail loudly (N-08).** `N`, `X` and unreadable chord labels render as labelled empty bars, and every pattern fallback shows a substitution text. A save error, engine error or analysis error is shown verbatim.
- **Bars are 0-based in storage, `end_bar` exclusive; the UI shows 1-based inclusive** ("5 to 8" ⇔ `start_bar: 4, end_bar: 8`).
- **Chord vocabulary** (`packages/stemcraft_worker/src/stemcraft_worker/analysis/chords/recognize.py`): a bare root (`C#`) is major, roots are sharp-spelled, the qualities are `min maj dim aug min6 maj6 min7 minmaj7 maj7 7 dim7 hdim7 sus2 sus4`, plus `N` and `X`.
- **Bass range:** 4-string EADG, open strings MIDI `28 33 38 43`, frets 0–12, so MIDI 28–55.
- Match the surrounding style: header comments that explain *why* and cite spec IDs (D-18, N-08, U-05, D-07, D-03).
- Commit after every task with the trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Work on `main` (CLAUDE.md). Push once, at the end of Task 13, after README upkeep.
- Another session may be committing to `main` concurrently. Stage **only the files your task lists** (`git add <paths>`, never `git add -A`).

---

## File map

| File | Responsibility |
|---|---|
| `packages/stemcraft_lib/src/stemcraft_lib/song.py` | `PlayAlong` model, schema v3, v2→v3 migration |
| `packages/stemcraft_lib/tests/test_song.py` | v3 defaults, migration, validation |
| `packages/stemcraft_api/tests/test_songs_update.py` | PUT round-trips `play_along`, rejects bad enums |
| `frontend/src/api/client.ts` | `PlayAlong` types, `Song.play_along`, `DEFAULT_PLAY_ALONG` |
| `frontend/src/music/chordTones.ts` | Chord label → root, bass, third/fifth/seventh intervals |
| `frontend/src/music/patterns.ts` | Key resolution, spelling, rhythm slots, `planBar`, `approachPitch` |
| `frontend/src/music/fingering.ts` | Octave + string/fret choice over the whole song (Viterbi) |
| `frontend/src/music/grid.ts` | + `beatPosition` |
| `frontend/src/music/tabSource.ts` | `TabSource` interface, `patternSource`, text helpers |
| `frontend/src/session/SongSession.tsx` | Session state + handlers moved out of SongView; context + hook |
| `frontend/src/session/SongScope.tsx` | Layout route providing the session to `<Outlet/>` |
| `frontend/src/screens/SongView.tsx` | Consumes the session; view state only; "Play along" link |
| `frontend/src/app/routes.tsx` | Nested `songs/:songId` scope with index + `play` |
| `frontend/src/playalong/colors.ts` | Canvas colours resolved from tokens |
| `frontend/src/playalong/neckPainter.ts` / `Neck.tsx` | Neck geometry + painting; the canvas component |
| `frontend/src/playalong/beatLanePainter.ts` / `BeatLane.tsx` | Lane painting; the canvas component |
| `frontend/src/playalong/PatternPanel.tsx` | Key / notes / rhythm / approach pickers |
| `frontend/src/playalong/LoopBars.tsx` | Loop start/end bar steppers |
| `frontend/src/playalong/ChordRibbon.tsx` | Bar cells: current bar, loop tint, click/shift-click |
| `frontend/src/playalong/NowReadout.tsx` | Bar · beat, chord → next, substitution text |
| `frontend/src/playalong/PlayAlongTransport.tsx` | Play, tempo, loop, metronome, count-in, Space key |
| `frontend/src/playalong/PlayAlong.module.css` | Styles for the above |
| `frontend/src/screens/PlayAlong.tsx` | The screen: gating, composition |
| `README.md`, `docs/screenshots/play-along.png` | README upkeep |

---

### Task 1: `song.json` v3 with `play_along`

**Files:**
- Modify: `packages/stemcraft_lib/src/stemcraft_lib/song.py`
- Modify: `packages/stemcraft_lib/tests/test_song.py`
- Modify: `packages/stemcraft_api/tests/test_songs_update.py`
- Modify: `frontend/src/api/client.ts`

**Interfaces:**
- Produces (Python): `PlayAlong`, `PlayAlongKey`, `PlayAlongPattern` models; `Song.play_along: PlayAlong`; `SCHEMA_VERSION = 3`.
- Produces (TS, `api/client.ts`):
  ```ts
  export type PatternNotes = 'root' | 'root_fifth' | 'root_fifth_octave' | 'octave_pump' | 'triad_chord' | 'triad_diatonic' | 'seventh';
  export type PatternRhythm = 'whole' | 'half' | 'quarter' | 'eighth';
  export type PatternApproach = 'none' | 'chromatic' | 'scale' | 'fifth';
  export interface PlayAlongKey { tonic: string; mode: 'major' | 'minor' }
  export interface PlayAlongPattern { notes: PatternNotes; rhythm: PatternRhythm; approach: PatternApproach }
  export interface PlayAlong { key: PlayAlongKey | null; pattern: PlayAlongPattern }
  export const DEFAULT_PLAY_ALONG: PlayAlong;
  // Song gains: play_along: PlayAlong;
  ```

- [ ] **Step 1: Write the failing library tests**

In `packages/stemcraft_lib/tests/test_song.py`, change the two existing assertions `assert song.schema_version == 2` (in `test_new_song_defaults_to_no_active_loop_no_metronome_no_count_in` and `test_a_v1_song_migrates_forward_with_v1_fields_intact`) to `assert song.schema_version == SCHEMA_VERSION`. Then append:

```python
def test_new_song_defaults_play_along_to_top_key_and_quarter_triads():
    song = new_song(title="T", artist="", source_kind="upload", source_value="original.mp3")
    assert song.schema_version == 3
    assert song.play_along.key is None
    assert song.play_along.pattern.notes == "triad_chord"
    assert song.play_along.pattern.rhythm == "quarter"
    assert song.play_along.pattern.approach == "none"


def test_a_v2_song_migrates_to_v3_with_default_play_along(tmp_path):
    song_dir = tmp_path / "song"
    song_dir.mkdir()
    (song_dir / "song.json").write_text(
        json.dumps(
            {
                "schema_version": 2,
                "id": "abc123",
                "title": "V2 Song",
                "artist": "",
                "source": {"kind": "upload", "value": "original.mp3"},
                "created_at": "2026-09-01T00:00:00+00:00",
                "active_loop": {"name": "", "start_bar": 4, "end_bar": 8},
                "metronome": True,
                "count_in_bars": 1,
            }
        )
    )

    song = read_song(song_dir)
    assert song.schema_version == 3
    # v2's fields survive; only play_along is defaulted.
    assert song.active_loop == Loop(name="", start_bar=4, end_bar=8)
    assert song.metronome is True
    assert song.play_along.key is None
    assert song.play_along.pattern.notes == "triad_chord"


def test_play_along_round_trips_through_disk(tmp_path):
    from stemcraft_lib.song import PlayAlong, PlayAlongKey, PlayAlongPattern

    song = new_song(title="T", artist="", source_kind="upload", source_value="original.mp3")
    song.play_along = PlayAlong(
        key=PlayAlongKey(tonic="Bb", mode="major"),
        pattern=PlayAlongPattern(notes="seventh", rhythm="eighth", approach="chromatic"),
    )
    song_dir = tmp_path / "song"
    song_dir.mkdir()
    write_song(song_dir, song)
    assert read_song(song_dir).play_along == song.play_along


def test_play_along_rejects_an_unknown_pattern_or_tonic():
    from pydantic import ValidationError
    from stemcraft_lib.song import PlayAlongKey, PlayAlongPattern

    with pytest.raises(ValidationError):
        PlayAlongPattern(notes="arpeggio")
    with pytest.raises(ValidationError):
        PlayAlongKey(tonic="H", mode="major")
```

- [ ] **Step 2: Run them and see them fail**

Run: `uv run pytest packages/stemcraft_lib/tests/test_song.py -v`
Expected: the four new tests FAIL (`AttributeError: 'Song' object has no attribute 'play_along'`, `ImportError`). The two edited ones still pass, because they compare against `SCHEMA_VERSION`.

- [ ] **Step 3: Implement the model and migration**

In `packages/stemcraft_lib/src/stemcraft_lib/song.py`:

Change `SCHEMA_VERSION = 2` to `SCHEMA_VERSION = 3`.

After `class Loop`, add:

```python
# The note names theory.ts can read (sharps and flats). The key is the user's
# pick among the analysis's candidates, so it is validated here rather than
# trusted: an unreadable tonic would otherwise surface as a crash in the browser.
Tonic = Literal[
    "C", "C#", "Db", "D", "D#", "Eb", "E", "F", "F#", "Gb", "G", "G#", "Ab", "A", "A#", "Bb", "B"
]


class PlayAlongKey(BaseModel):
    tonic: Tonic
    mode: Literal["major", "minor"]


class PlayAlongPattern(BaseModel):
    notes: Literal[
        "root",
        "root_fifth",
        "root_fifth_octave",
        "octave_pump",
        "triad_chord",
        "triad_diatonic",
        "seventh",
    ] = "triad_chord"
    rhythm: Literal["whole", "half", "quarter", "eighth"] = "quarter"
    approach: Literal["none", "chromatic", "scale", "fifth"] = "none"


class PlayAlong(BaseModel):
    """v3 (D-18). The Play along screen's recipe: which key to think in (None =
    the analysis's top candidate) and which pattern to generate. Only the
    choice is stored; the notes and fret positions are derived in the browser
    on every change."""

    key: PlayAlongKey | None = None
    pattern: PlayAlongPattern = Field(default_factory=PlayAlongPattern)
```

In `class Song`, after `count_in_bars: int = 0`, add:

```python
    # v3 (D-18).
    play_along: PlayAlong = Field(default_factory=PlayAlong)
```

In `_migrate`, replace the tail from `if version == 1:` down to the final `raise` with:

```python
    if version == 1:
        # v1 -> v2 (Phase 6) is purely additive: active_loop, metronome and
        # count_in_bars take their pydantic defaults. Nothing is renamed or
        # dropped, so the only work is stamping the version forward; the file
        # itself is rewritten on the next write_song (§5: migrated in place).
        raw = {**raw, "schema_version": 2}
        version = 2
    if version == 2:
        # v2 -> v3 (D-18) is additive in the same way: play_along defaults.
        raw = {**raw, "schema_version": 3}
        version = 3
    if version == SCHEMA_VERSION:
        return raw
    raise SongUnreadable(f"{path}: no migration from schema_version {version}")
```

- [ ] **Step 4: Run the library tests**

Run: `uv run pytest packages/stemcraft_lib/tests/test_song.py -v`
Expected: all PASS.

- [ ] **Step 5: Write the API tests**

Append to `packages/stemcraft_api/tests/test_songs_update.py`:

```python
def test_put_round_trips_play_along(client: TestClient):
    song = _create(client)
    assert song["play_along"] == {
        "key": None,
        "pattern": {"notes": "triad_chord", "rhythm": "quarter", "approach": "none"},
    }
    song["play_along"] = {
        "key": {"tonic": "G", "mode": "major"},
        "pattern": {"notes": "octave_pump", "rhythm": "eighth", "approach": "fifth"},
    }
    response = client.put(f"/api/songs/{song['id']}", json=song)
    assert response.status_code == 200
    reread = client.get(f"/api/songs/{song['id']}").json()["song"]
    assert reread["play_along"] == song["play_along"]


def test_put_rejects_an_unknown_pattern(client: TestClient):
    song = _create(client)
    song["play_along"] = {
        "key": None,
        "pattern": {"notes": "arpeggio", "rhythm": "quarter", "approach": "none"},
    }
    response = client.put(f"/api/songs/{song['id']}", json=song)
    assert response.status_code == 422
```

- [ ] **Step 6: Run the whole Python suite**

Run: `uv run pytest -q && uv run ruff check packages ops`
Expected: all pass, lint clean. (Search `grep -rn "schema_version.*== 2" packages` and fix any other test that pinned v2.)

- [ ] **Step 7: Add the TS types**

In `frontend/src/api/client.ts`, directly above `export interface Song {`, add:

```ts
// v3 (D-18). Mirrors PlayAlong in stemcraft_lib/song.py.
export type PatternNotes =
  | 'root'
  | 'root_fifth'
  | 'root_fifth_octave'
  | 'octave_pump'
  | 'triad_chord'
  | 'triad_diatonic'
  | 'seventh';
export type PatternRhythm = 'whole' | 'half' | 'quarter' | 'eighth';
export type PatternApproach = 'none' | 'chromatic' | 'scale' | 'fifth';

export interface PlayAlongKey {
  tonic: string;
  mode: 'major' | 'minor';
}

export interface PlayAlongPattern {
  notes: PatternNotes;
  rhythm: PatternRhythm;
  approach: PatternApproach;
}

export interface PlayAlong {
  /** null = the analysis's top key candidate. */
  key: PlayAlongKey | null;
  pattern: PlayAlongPattern;
}

/** The server's defaults, for fixtures and for code that builds a Song by hand. */
export const DEFAULT_PLAY_ALONG: PlayAlong = {
  key: null,
  pattern: { notes: 'triad_chord', rhythm: 'quarter', approach: 'none' },
};
```

In `interface Song`, after `count_in_bars: number;`, add:

```ts
  // v3 (D-18): the Play along recipe.
  play_along: PlayAlong;
```

- [ ] **Step 8: Typecheck and run the frontend tests**

Run: `npm --prefix frontend run typecheck && npm --prefix frontend test -- --run`
Expected: pass. If `tsc` flags a hand-built `Song` literal anywhere, add `play_along: DEFAULT_PLAY_ALONG` to it (import from `../api/client`).

- [ ] **Step 9: Commit**

```bash
git add packages/stemcraft_lib/src/stemcraft_lib/song.py packages/stemcraft_lib/tests/test_song.py packages/stemcraft_api/tests/test_songs_update.py frontend/src/api/client.ts
git commit -m "feat(song): song.json v3 adds the play_along recipe (D-18)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Chord label parsing (`music/chordTones.ts`)

**Files:**
- Create: `frontend/src/music/chordTones.ts`
- Test: `frontend/src/music/chordTones.test.ts`

**Interfaces:**
- Consumes: `pitchClassOf(name: string): number` from `music/theory.ts` (throws on an unknown name).
- Produces:
  ```ts
  export const mod12: (n: number) => number;
  export interface Shape { third: number; fifth: number; seventh: number | null }
  export interface ChordTones extends Shape { rootPc: number; bassPc: number; quality: string }
  export type ParsedChord =
    | { kind: 'chord'; tones: ChordTones }
    | { kind: 'no_chord' }
    | { kind: 'unclassified' }
    | { kind: 'unparsed'; reason: string };
  export function parseChord(label: string, transpose: number): ParsedChord;
  export const CHORD_QUALITIES: readonly string[];
  ```

- [ ] **Step 1: Write the failing tests**

```ts
// frontend/src/music/chordTones.test.ts
import { describe, expect, it } from 'vitest';

import { CHORD_QUALITIES, mod12, parseChord } from './chordTones';

function tones(label: string, transpose = 0) {
  const parsed = parseChord(label, transpose);
  if (parsed.kind !== 'chord') throw new Error(`expected a chord, got ${parsed.kind}`);
  return parsed.tones;
}

describe('parseChord', () => {
  it('reads a bare root as major, the way recognize.py emits it', () => {
    expect(tones('G')).toEqual({ rootPc: 7, bassPc: 7, third: 4, fifth: 7, seventh: null, quality: 'maj' });
  });

  it('reads each quality into its third, fifth and seventh', () => {
    expect(tones('E:min')).toMatchObject({ rootPc: 4, third: 3, fifth: 7, seventh: null });
    expect(tones('D:min7')).toMatchObject({ third: 3, fifth: 7, seventh: 10 });
    expect(tones('C:maj7')).toMatchObject({ third: 4, fifth: 7, seventh: 11 });
    expect(tones('A:7')).toMatchObject({ third: 4, fifth: 7, seventh: 10 });
    expect(tones('B:hdim7')).toMatchObject({ third: 3, fifth: 6, seventh: 10 });
    expect(tones('B:dim7')).toMatchObject({ third: 3, fifth: 6, seventh: 9 });
    expect(tones('F:aug')).toMatchObject({ third: 4, fifth: 8 });
    expect(tones('C:sus4')).toMatchObject({ third: 5, fifth: 7 });
    expect(tones('C:sus2')).toMatchObject({ third: 2, fifth: 7 });
  });

  it('understands every quality the chord model can emit', () => {
    for (const quality of CHORD_QUALITIES) {
      expect(parseChord(`C:${quality}`, 0).kind).toBe('chord');
    }
    expect(CHORD_QUALITIES).toHaveLength(14);
  });

  it('transposes the root and bass by the pitch shift', () => {
    expect(tones('C', 3).rootPc).toBe(3);
    expect(tones('C', -1).rootPc).toBe(11);
    expect(tones('G', -2)).toMatchObject({ rootPc: 5, bassPc: 5 });
  });

  it('puts a slash degree in the bass', () => {
    expect(tones('C:maj/3')).toMatchObject({ rootPc: 0, bassPc: 4 });
    expect(tones('C:maj/b7')).toMatchObject({ bassPc: 10 });
  });

  it('keeps N and X apart from a chord, never guessing one', () => {
    expect(parseChord('N', 0)).toEqual({ kind: 'no_chord' });
    expect(parseChord('X', 0)).toEqual({ kind: 'unclassified' });
  });

  it('refuses an unknown root, quality or bass degree with the label in the reason (N-08)', () => {
    const root = parseChord('H:maj', 0);
    expect(root.kind).toBe('unparsed');
    expect(root.kind === 'unparsed' && root.reason).toContain('H:maj');
    const quality = parseChord('C:add9', 0);
    expect(quality.kind === 'unparsed' && quality.reason).toContain('add9');
    const degree = parseChord('C:maj/9', 0);
    expect(degree.kind === 'unparsed' && degree.reason).toContain('9');
  });
});

describe('mod12', () => {
  it('wraps negatives into 0..11', () => {
    expect(mod12(-1)).toBe(11);
    expect(mod12(24)).toBe(0);
  });
});
```

- [ ] **Step 2: Run and see it fail**

Run: `npm --prefix frontend test -- --run src/music/chordTones.test.ts`
Expected: FAIL, "Failed to resolve import ./chordTones".

- [ ] **Step 3: Implement**

```ts
// frontend/src/music/chordTones.ts
// The analysis's chord labels, read into the intervals a bass line is built
// from (D-18). Labels are BTC's large vocabulary as recognize.py emits them: a
// bare root ("C#") is major, otherwise "root:quality" with one of 14
// qualities; "N" is no chord and "X" is unclassifiable. A "/degree" slash
// suffix is accepted too, though the current model never emits one, so a
// future chord or transcription source works unchanged.
//
// Pure arithmetic with no failure mode of its own: a label it cannot read is
// returned as `unparsed` with the label in the reason, never treated as major
// (N-08). The chords themselves are probabilistic (R-05); reading them is not.
import { pitchClassOf } from './theory';

export const mod12 = (n: number): number => ((n % 12) + 12) % 12;

/** Semitones above the root. A sus chord's 2 or 4 sits where the third would. */
export interface Shape {
  third: number;
  fifth: number;
  seventh: number | null;
}

export interface ChordTones extends Shape {
  /** Pitch class of the root, after transposition. */
  rootPc: number;
  /** Pitch class the bass plays: the slash note if there is one, else the root. */
  bassPc: number;
  quality: string;
}

export type ParsedChord =
  | { kind: 'chord'; tones: ChordTones }
  | { kind: 'no_chord' }
  | { kind: 'unclassified' }
  | { kind: 'unparsed'; reason: string };

const SHAPES: Record<string, Shape> = {
  maj: { third: 4, fifth: 7, seventh: null },
  min: { third: 3, fifth: 7, seventh: null },
  dim: { third: 3, fifth: 6, seventh: null },
  aug: { third: 4, fifth: 8, seventh: null },
  min6: { third: 3, fifth: 7, seventh: null },
  maj6: { third: 4, fifth: 7, seventh: null },
  min7: { third: 3, fifth: 7, seventh: 10 },
  minmaj7: { third: 3, fifth: 7, seventh: 11 },
  maj7: { third: 4, fifth: 7, seventh: 11 },
  '7': { third: 4, fifth: 7, seventh: 10 },
  dim7: { third: 3, fifth: 6, seventh: 9 },
  hdim7: { third: 3, fifth: 6, seventh: 10 },
  sus2: { third: 2, fifth: 7, seventh: null },
  sus4: { third: 5, fifth: 7, seventh: null },
};

/** The qualities recognize.py's _QUALITIES can produce. */
export const CHORD_QUALITIES: readonly string[] = Object.keys(SHAPES);

// Slash degrees are scale degrees of the chord root, where "b" is a degree
// flat, not a note name (the same reading chords.ts documents for display).
const DEGREES: Record<string, number> = {
  '1': 0,
  b2: 1,
  '2': 2,
  b3: 3,
  '3': 4,
  '4': 5,
  '#4': 6,
  b5: 6,
  '5': 7,
  '#5': 8,
  b6: 8,
  '6': 9,
  bb7: 9,
  b7: 10,
  '7': 11,
};

export function parseChord(label: string, transpose: number): ParsedChord {
  if (label === 'N') return { kind: 'no_chord' };
  if (label === 'X') return { kind: 'unclassified' };

  const [head = '', slash] = label.split('/');
  const [rootName = '', quality = 'maj'] = head.split(':');

  let rootPc: number;
  try {
    rootPc = pitchClassOf(rootName);
  } catch {
    return { kind: 'unparsed', reason: `unknown root "${rootName}" in chord "${label}"` };
  }
  const shape = SHAPES[quality];
  if (!shape) return { kind: 'unparsed', reason: `unknown chord quality "${quality}" in "${label}"` };

  let bassOffset = 0;
  if (slash !== undefined) {
    const degree = DEGREES[slash];
    if (degree === undefined) {
      return { kind: 'unparsed', reason: `unknown bass degree "${slash}" in chord "${label}"` };
    }
    bassOffset = degree;
  }

  const root = mod12(rootPc + transpose);
  return {
    kind: 'chord',
    tones: { rootPc: root, bassPc: mod12(root + bassOffset), ...shape, quality },
  };
}
```

- [ ] **Step 4: Run and see it pass**

Run: `npm --prefix frontend test -- --run src/music/chordTones.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/music/chordTones.ts frontend/src/music/chordTones.test.ts
git commit -m "feat(music): parse chord labels into bass intervals (D-18)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Bar plans (`music/patterns.ts`)

A plan is a bar's slots, each holding a timed interval above the bar's bass note. No pitches or frets yet: fingering picks the octave (Task 4).

**Files:**
- Create: `frontend/src/music/patterns.ts`
- Test: `frontend/src/music/patterns.test.ts`

**Interfaces:**
- Consumes: `mod12`, `parseChord`, `ChordTones`, `Shape` (Task 2); `noteName`, `pitchClassOf`, `scaleSemitones`, `Mode` from `music/theory.ts`; `KeyCandidate`, `PatternApproach`, `PatternNotes`, `PatternRhythm`, `PlayAlongKey`, `PlayAlongPattern` from `api/client.ts` (Task 1).
- Produces:
  ```ts
  export interface ResolvedKey { tonicPc: number; mode: Mode }
  export function resolveKey(chosen: PlayAlongKey | null, candidates: readonly KeyCandidate[], transpose: number): ResolvedKey | null;
  export function spell(pc: number, key: ResolvedKey): string;           // "F♯", "B♭"
  export function keyName(key: ResolvedKey): string;                      // "G major"
  export function slotBeats(rhythm: PatternRhythm, beatsPerBar: number): number[];
  export type SlotTone = { kind: 'tone'; semis: number } | { kind: 'approach' };
  export interface Slot { beat: number; beats: number; tone: SlotTone }
  export type EmptyKind = 'no_chord' | 'unclassified' | 'unparsed';
  export interface BarPlan {
    bar: number; label: string;
    empty: EmptyKind | null; reason: string | null;
    tones: ChordTones | null; bassPc: number | null;
    slots: Slot[]; substitution: string | null;
  }
  export interface PlanInput { bar: number; label: string; nextLabel: string | null; key: ResolvedKey; pattern: PlayAlongPattern; beatsPerBar: number; transpose: number }
  export function planBar(input: PlanInput): BarPlan;
  export function approachPitch(kind: Exclude<PatternApproach, 'none'>, target: number, key: ResolvedKey, lowest: number): number;
  ```

- [ ] **Step 1: Write the failing tests**

```ts
// frontend/src/music/patterns.test.ts
import { describe, expect, it } from 'vitest';

import type { PlayAlongPattern } from '../api/client';
import {
  approachPitch,
  keyName,
  planBar,
  resolveKey,
  slotBeats,
  spell,
  type BarPlan,
  type ResolvedKey,
} from './patterns';

const G_MAJOR: ResolvedKey = { tonicPc: 7, mode: 'major' };
const TRIAD: PlayAlongPattern = { notes: 'triad_chord', rhythm: 'quarter', approach: 'none' };

function plan(label: string, pattern: Partial<PlayAlongPattern> = {}, extra: Partial<Parameters<typeof planBar>[0]> = {}): BarPlan {
  return planBar({
    bar: 0,
    label,
    nextLabel: 'C',
    key: G_MAJOR,
    pattern: { ...TRIAD, ...pattern },
    beatsPerBar: 4,
    transpose: 0,
    ...extra,
  });
}

const semis = (p: BarPlan) => p.slots.map((s) => (s.tone.kind === 'tone' ? s.tone.semis : 'approach'));
const beats = (p: BarPlan) => p.slots.map((s) => [s.beat, s.beats]);

describe('resolveKey', () => {
  it('uses the chosen key, else the top candidate, transposed', () => {
    expect(resolveKey({ tonic: 'D', mode: 'major' }, [], 0)).toEqual({ tonicPc: 2, mode: 'major' });
    expect(resolveKey(null, [{ tonic: 'G', mode: 'major', confidence: 0.4 }], -2)).toEqual({ tonicPc: 5, mode: 'major' });
    expect(resolveKey(null, [], 0)).toBeNull();
  });
});

describe('spell', () => {
  it('spells in the key with real sharp and flat glyphs', () => {
    expect(spell(6, G_MAJOR)).toBe('F♯');
    expect(spell(10, { tonicPc: 5, mode: 'major' })).toBe('B♭');
    expect(keyName(G_MAJOR)).toBe('G major');
  });
});

describe('slotBeats', () => {
  it('lays out whole, half, quarter and eighth slots in 4/4 and 3/4', () => {
    expect(slotBeats('whole', 4)).toEqual([0]);
    expect(slotBeats('half', 4)).toEqual([0, 2]);
    expect(slotBeats('half', 3)).toEqual([0, 2]);
    expect(slotBeats('quarter', 3)).toEqual([0, 1, 2]);
    expect(slotBeats('eighth', 4)).toEqual([0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5]);
  });
});

describe('planBar', () => {
  it('cycles a 1-3-5-3 chord triad over quarter notes', () => {
    const p = plan('G');
    expect(semis(p)).toEqual([0, 4, 7, 4]);
    expect(beats(p)).toEqual([[0, 1], [1, 1], [2, 1], [3, 1]]);
    expect(p.bassPc).toBe(7);
    expect(p.substitution).toBeNull();
    expect(semis(plan('E:min'))).toEqual([0, 3, 7, 3]);
  });

  it('fits the cycle to the bar: 3/4 plays 1-3-5, the last half note lasts one beat', () => {
    expect(semis(plan('G', {}, { beatsPerBar: 3 }))).toEqual([0, 4, 7]);
    expect(beats(plan('G', { rhythm: 'half' }, { beatsPerBar: 3 }))).toEqual([[0, 2], [2, 1]]);
  });

  it('builds the foundation patterns', () => {
    expect(semis(plan('G', { notes: 'root', rhythm: 'eighth' }))).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
    expect(semis(plan('G', { notes: 'root_fifth' }))).toEqual([0, 7, 0, 7]);
    expect(semis(plan('G', { notes: 'root_fifth_octave' }))).toEqual([0, 7, 12, 7]);
    expect(semis(plan('G', { notes: 'octave_pump' }))).toEqual([0, 12, 0, 12]);
    expect(semis(plan('G', { rhythm: 'whole' }))).toEqual([0]);
  });

  it('takes a diatonic triad from the key, and says so when the root is borrowed', () => {
    // A in G major is A minor: A C E.
    expect(semis(plan('A', { notes: 'triad_diatonic' }))).toEqual([0, 3, 7, 3]);
    const borrowed = plan('A#', { notes: 'triad_diatonic' });
    expect(semis(borrowed)).toEqual([0, 4, 7, 4]);
    expect(borrowed.substitution).toBe('A♯ not in G major: chord triad');
  });

  it("uses the chord's 7th, else the key's, else falls back to the triad, visibly", () => {
    expect(semis(plan('G:7', { notes: 'seventh' }))).toEqual([0, 4, 7, 10]);
    const diatonic = plan('G', { notes: 'seventh' });
    expect(semis(diatonic)).toEqual([0, 4, 7, 11]);
    expect(diatonic.substitution).toBe("no 7th in the chord: G major's diatonic 7th");
    const borrowed = plan('A#', { notes: 'seventh' });
    expect(semis(borrowed)).toEqual([0, 4, 7, 4]);
    expect(borrowed.substitution).toBe('A♯ not in G major: chord triad');
  });

  it('replaces the last slot with an approach only when the next bar is a chord', () => {
    expect(semis(plan('G', { approach: 'chromatic' }))).toEqual([0, 4, 7, 'approach']);
    expect(semis(plan('G', { approach: 'chromatic' }, { nextLabel: 'N' }))).toEqual([0, 4, 7, 4]);
    expect(semis(plan('G', { approach: 'chromatic' }, { nextLabel: null }))).toEqual([0, 4, 7, 4]);
    expect(semis(plan('G', { approach: 'chromatic', rhythm: 'whole' }))).toEqual([0]);
  });

  it('renders N, X and an unreadable label as labelled empty bars (N-08)', () => {
    expect(plan('N')).toMatchObject({ empty: 'no_chord', slots: [], bassPc: null });
    expect(plan('X')).toMatchObject({ empty: 'unclassified', slots: [] });
    const bad = plan('G:weird');
    expect(bad.empty).toBe('unparsed');
    expect(bad.reason).toContain('weird');
  });

  it('transposes, and plays a slash note in the bass', () => {
    expect(plan('G', {}, { transpose: -2 }).bassPc).toBe(5);
    const slash = plan('C:maj/3');
    expect(slash.bassPc).toBe(4);
    // Intervals sit above the bass note E: the 3rd is E itself, the 5th G is 3 above.
    expect(semis(slash)).toEqual([0, 0, 3, 0]);
  });
});

describe('approachPitch', () => {
  it('leads in from below, or from above when below would leave the neck', () => {
    expect(approachPitch('chromatic', 45, G_MAJOR, 28)).toBe(44);
    expect(approachPitch('chromatic', 28, G_MAJOR, 28)).toBe(29);
    expect(approachPitch('fifth', 45, G_MAJOR, 28)).toBe(38);
    expect(approachPitch('fifth', 30, G_MAJOR, 28)).toBe(35);
    // Scale step: the nearest G-major note below C3 (48) is B2 (47); below G2 (43) is F♯2 (42).
    expect(approachPitch('scale', 48, G_MAJOR, 28)).toBe(47);
    expect(approachPitch('scale', 43, G_MAJOR, 28)).toBe(42);
  });
});
```

- [ ] **Step 2: Run and see it fail**

Run: `npm --prefix frontend test -- --run src/music/patterns.test.ts`
Expected: FAIL, "Failed to resolve import ./patterns".

- [ ] **Step 3: Implement**

```ts
// frontend/src/music/patterns.ts
// Bar plans for the Play along screen (D-18): which interval to play on which
// beat, generated from the bar's chord and the user's pattern. No pitches or
// frets here; fingering.ts picks the octave and the position. Keeping the two
// apart is what lets the fingering search the whole song at once while this
// stays a per-bar function.
//
// Every fallback is reported in `substitution` and drawn on screen, so a
// pattern that could not apply is never silently swapped for another (N-08).
import type {
  KeyCandidate,
  PatternApproach,
  PatternNotes,
  PatternRhythm,
  PlayAlongKey,
  PlayAlongPattern,
} from '../api/client';
import { mod12, parseChord, type ChordTones, type Shape } from './chordTones';
import { noteName, pitchClassOf, scaleSemitones, type Mode } from './theory';

export interface ResolvedKey {
  tonicPc: number;
  mode: Mode;
}

/** The chosen key, else the top candidate, transposed to what is heard. */
export function resolveKey(
  chosen: PlayAlongKey | null,
  candidates: readonly KeyCandidate[],
  transpose: number,
): ResolvedKey | null {
  const key = chosen ?? candidates[0] ?? null;
  if (!key) return null;
  return { tonicPc: mod12(pitchClassOf(key.tonic) + transpose), mode: key.mode };
}

/** A pitch class spelled for the key, with display glyphs ("F♯", "B♭"). */
export function spell(pc: number, key: ResolvedKey): string {
  return noteName(pc, key.tonicPc, key.mode).replace('#', '♯').replace(/^([A-G])b$/, '$1♭');
}

export function keyName(key: ResolvedKey): string {
  return `${spell(key.tonicPc, key)} ${key.mode}`;
}

function scalePcs(key: ResolvedKey): number[] {
  return scaleSemitones(key.mode, false).map((s) => mod12(key.tonicPc + s));
}

/** The triad (and 7th) the key builds on `rootPc`, or null if the root is not in the key. */
function diatonicShape(rootPc: number, key: ResolvedKey): Shape | null {
  const scale = scalePcs(key);
  const i = scale.indexOf(rootPc);
  if (i < 0) return null;
  const above = (step: number) => mod12(scale[(i + step) % 7]! - rootPc);
  return { third: above(2), fifth: above(4), seventh: above(6) };
}

/** Beat offsets of each note in a bar. The pattern cycles over these. */
export function slotBeats(rhythm: PatternRhythm, beatsPerBar: number): number[] {
  const step =
    rhythm === 'whole' ? beatsPerBar : rhythm === 'half' ? 2 : rhythm === 'quarter' ? 1 : 0.5;
  const out: number[] = [];
  for (let beat = 0; beat < beatsPerBar; beat += step) out.push(beat);
  return out;
}

type Degree = 1 | 3 | 5 | 7 | 8;

const CYCLES: Record<PatternNotes, readonly Degree[]> = {
  root: [1],
  root_fifth: [1, 5],
  root_fifth_octave: [1, 5, 8, 5],
  octave_pump: [1, 8],
  triad_chord: [1, 3, 5, 3],
  triad_diatonic: [1, 3, 5, 3],
  seventh: [1, 3, 5, 7],
};
const TRIAD: readonly Degree[] = CYCLES.triad_chord;

/**
 * Semitones above the bar's bass note. For a slash chord the bass is not the
 * root, so chord tones are re-measured from it (`bassShift`) and folded into
 * the octave above.
 */
function semisOf(degree: Degree, shape: Shape, bassShift: number): number {
  if (degree === 1) return 0;
  if (degree === 8) return 12;
  const tone = degree === 3 ? shape.third : degree === 5 ? shape.fifth : shape.seventh!;
  return mod12(tone - bassShift);
}

export type SlotTone = { kind: 'tone'; semis: number } | { kind: 'approach' };

export interface Slot {
  /** Offset into the bar, in beats. */
  beat: number;
  /** Duration, in beats: until the next slot or the end of the bar. */
  beats: number;
  tone: SlotTone;
}

export type EmptyKind = 'no_chord' | 'unclassified' | 'unparsed';

export interface BarPlan {
  bar: number;
  /** The analysis's label, as written. */
  label: string;
  empty: EmptyKind | null;
  /** Why an `unparsed` label could not be read. */
  reason: string | null;
  tones: ChordTones | null;
  bassPc: number | null;
  slots: Slot[];
  /** What was drawn instead of the chosen pattern, and why. */
  substitution: string | null;
}

export interface PlanInput {
  bar: number;
  label: string;
  /** The label of the bar that follows this one (the loop start at a loop's end), or null at the end. */
  nextLabel: string | null;
  key: ResolvedKey;
  pattern: PlayAlongPattern;
  beatsPerBar: number;
  transpose: number;
}

export function planBar(input: PlanInput): BarPlan {
  const { bar, label, key, pattern, beatsPerBar, transpose } = input;
  const parsed = parseChord(label, transpose);
  if (parsed.kind !== 'chord') {
    return {
      bar,
      label,
      empty: parsed.kind,
      reason: parsed.kind === 'unparsed' ? parsed.reason : null,
      tones: null,
      bassPc: null,
      slots: [],
      substitution: null,
    };
  }

  const tones = parsed.tones;
  const root = spell(tones.rootPc, key);
  let shape: Shape = tones;
  let cycle = CYCLES[pattern.notes];
  let substitution: string | null = null;

  if (pattern.notes === 'triad_diatonic') {
    const diatonic = diatonicShape(tones.rootPc, key);
    if (diatonic) shape = diatonic;
    else substitution = `${root} not in ${keyName(key)}: chord triad`;
  } else if (pattern.notes === 'seventh' && tones.seventh === null) {
    const diatonic = diatonicShape(tones.rootPc, key);
    if (diatonic) {
      shape = { ...tones, seventh: diatonic.seventh };
      substitution = `no 7th in the chord: ${keyName(key)}'s diatonic 7th`;
    } else {
      cycle = TRIAD;
      substitution = `${root} not in ${keyName(key)}: chord triad`;
    }
  }

  const bassShift = mod12(tones.bassPc - tones.rootPc);
  const starts = slotBeats(pattern.rhythm, beatsPerBar);
  const slots: Slot[] = starts.map((beat, i) => ({
    beat,
    beats: (starts[i + 1] ?? beatsPerBar) - beat,
    tone: { kind: 'tone', semis: semisOf(cycle[i % cycle.length]!, shape, bassShift) },
  }));

  const nextIsChord =
    input.nextLabel !== null && parseChord(input.nextLabel, transpose).kind === 'chord';
  if (pattern.approach !== 'none' && nextIsChord && slots.length > 1) {
    const last = slots.length - 1;
    slots[last] = { ...slots[last]!, tone: { kind: 'approach' } };
  }

  return { bar, label, empty: null, reason: null, tones, bassPc: tones.bassPc, slots, substitution };
}

/**
 * The lead-in to `target` (a MIDI pitch): a semitone, the nearest scale note,
 * or a fifth below it. When below would fall under the lowest open string, it
 * comes from above instead (a semitone, a scale note, or a fourth).
 */
export function approachPitch(
  kind: Exclude<PatternApproach, 'none'>,
  target: number,
  key: ResolvedKey,
  lowest: number,
): number {
  const inScale = new Set(scalePcs(key));
  const scaleBelow = () => {
    let p = target - 1;
    while (!inScale.has(mod12(p))) p--;
    return p;
  };
  const scaleAbove = () => {
    let p = target + 1;
    while (!inScale.has(mod12(p))) p++;
    return p;
  };
  const down = kind === 'chromatic' ? target - 1 : kind === 'fifth' ? target - 7 : scaleBelow();
  if (down >= lowest) return down;
  return kind === 'chromatic' ? target + 1 : kind === 'fifth' ? target + 5 : scaleAbove();
}
```

- [ ] **Step 4: Run and see it pass**

Run: `npm --prefix frontend test -- --run src/music/patterns.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/music/patterns.ts frontend/src/music/patterns.test.ts
git commit -m "feat(music): bar plans for play-along patterns, rhythm slots and approaches (D-18)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Fingering (`music/fingering.ts`)

**Files:**
- Create: `frontend/src/music/fingering.ts`
- Test: `frontend/src/music/fingering.test.ts`

**Interfaces:**
- Consumes: `mod12` (Task 2); `approachPitch`, `spell`, `BarPlan`, `ResolvedKey` (Task 3); `PatternApproach` (Task 1).
- Produces:
  ```ts
  export const OPEN_STRINGS: readonly number[];   // [28, 33, 38, 43], string 0 = low E
  export const MAX_FRET = 12;
  export const LOWEST: number;                    // 28
  export const HIGHEST: number;                   // 55
  export interface Position { string: number; fret: number }
  export interface PlacedNote { midi: number; name: string; beat: number; beats: number; approach: boolean; position: Position }
  export interface PlacedBar { plan: BarPlan; bassMidi: number | null; anchor: number | null; notes: PlacedNote[] }
  export function positionsOf(midi: number): Position[];
  export interface PlaceOptions { approach: PatternApproach; key: ResolvedKey; nextOf(bar: number): number | null }
  export function placeBars(plans: BarPlan[], options: PlaceOptions): PlacedBar[];
  ```
  `plans[i].bar === i` is assumed: `nextOf` returns an index into `plans`.

- [ ] **Step 1: Write the failing tests**

```ts
// frontend/src/music/fingering.test.ts
import { describe, expect, it } from 'vitest';

import type { PlayAlongPattern } from '../api/client';
import { HIGHEST, LOWEST, MAX_FRET, placeBars, positionsOf, type PlacedBar } from './fingering';
import { approachPitch, planBar, type ResolvedKey } from './patterns';

const G_MAJOR: ResolvedKey = { tonicPc: 7, mode: 'major' };

function place(labels: string[], pattern: Partial<PlayAlongPattern> = {}, wrapTo: number | null = null): PlacedBar[] {
  const full: PlayAlongPattern = { notes: 'triad_chord', rhythm: 'quarter', approach: 'none', ...pattern };
  const nextOf = (bar: number) => (bar === labels.length - 1 ? wrapTo : bar + 1);
  const plans = labels.map((label, bar) => {
    const next = nextOf(bar);
    return planBar({ bar, label, nextLabel: next === null ? null : labels[next]!, key: G_MAJOR, pattern: full, beatsPerBar: 4, transpose: 0 });
  });
  return placeBars(plans, { approach: full.approach, key: G_MAJOR, nextOf });
}

describe('positionsOf', () => {
  it('lists every string and fret that sounds a pitch, low string first', () => {
    // G2 (43): past fret 12 on E (43 - 28 = 15), so not listed there.
    expect(positionsOf(43)).toEqual([
      { string: 1, fret: 10 },
      { string: 2, fret: 5 },
      { string: 3, fret: 0 },
    ]);
    expect(positionsOf(27)).toEqual([]);
  });
});

describe('placeBars', () => {
  it('places every note of a bar on the neck, in one hand position', () => {
    const [bar] = place(['G']);
    expect(bar!.notes.map((n) => n.name)).toEqual(['G', 'B', 'D', 'B']);
    expect(bar!.bassMidi! % 12).toBe(7);
    for (const note of bar!.notes) {
      expect(note.position.fret).toBeGreaterThanOrEqual(0);
      expect(note.position.fret).toBeLessThanOrEqual(MAX_FRET);
      expect(note.midi).toBeGreaterThanOrEqual(LOWEST);
      expect(note.midi).toBeLessThanOrEqual(HIGHEST);
    }
    const fretted = bar!.notes.map((n) => n.position.fret).filter((f) => f > 0);
    expect(Math.max(...fretted) - Math.min(...fretted)).toBeLessThanOrEqual(4);
  });

  it('is deterministic', () => {
    expect(place(['G', 'C', 'D', 'G'])).toEqual(place(['G', 'C', 'D', 'G']));
  });

  it('stays in position across a I-IV-V-I', () => {
    const bars = place(['G', 'C', 'D', 'G']);
    for (let i = 1; i < bars.length; i++) {
      expect(Math.abs(bars[i]!.anchor! - bars[i - 1]!.anchor!)).toBeLessThanOrEqual(2);
    }
  });

  it('places a chromatic approach a semitone from the next bar\'s chosen bass note', () => {
    const [g, c] = place(['G', 'C'], { approach: 'chromatic' });
    const last = g!.notes[3]!;
    expect(last.approach).toBe(true);
    expect(last.midi).toBe(approachPitch('chromatic', c!.bassMidi!, G_MAJOR, LOWEST));
  });

  it("approaches the loop start from a loop's last bar", () => {
    const bars = place(['G', 'C', 'D'], { approach: 'chromatic' }, 0);
    const last = bars[2]!.notes[3]!;
    expect(last.midi).toBe(approachPitch('chromatic', bars[0]!.bassMidi!, G_MAJOR, LOWEST));
  });

  it('leaves a no-chord bar empty and starts fresh after it', () => {
    const bars = place(['G', 'N', 'C']);
    expect(bars[1]).toMatchObject({ bassMidi: null, anchor: null, notes: [] });
    expect(bars[2]!.notes).toHaveLength(4);
  });

  it('fails loudly when a plan asks for an approach to a bar that has no notes', () => {
    const plan = planBar({ bar: 0, label: 'G', nextLabel: 'C', key: G_MAJOR, pattern: { notes: 'root', rhythm: 'quarter', approach: 'chromatic' }, beatsPerBar: 4, transpose: 0 });
    expect(() => placeBars([plan], { approach: 'chromatic', key: G_MAJOR, nextOf: () => null })).toThrow(/approach/);
  });
});
```

- [ ] **Step 2: Run and see it fail**

Run: `npm --prefix frontend test -- --run src/music/fingering.test.ts`
Expected: FAIL, "Failed to resolve import ./fingering".

- [ ] **Step 3: Implement**

```ts
// frontend/src/music/fingering.ts
// Where on the neck each planned note is played (D-18). The same G can be E3,
// A10 or an octave up on D5/G0; a line that jumps between them bar to bar is
// unplayable at tempo. So the choice is made over the whole song at once: each
// bar's state is (bass note octave, hand position), and a Viterbi pass finds
// the cheapest path through them, costed by hand movement between bars, stretch
// within a bar and a mild preference for low positions. Deterministic: the same
// song and settings always draw the same neck.
//
// 4-string bass, standard EADG tuning, frets 0-12.
import type { PatternApproach } from '../api/client';
import { mod12 } from './chordTones';
import { approachPitch, spell, type BarPlan, type ResolvedKey } from './patterns';

/** MIDI of the open strings, low E first. */
export const OPEN_STRINGS: readonly number[] = [28, 33, 38, 43];
export const MAX_FRET = 12;
export const LOWEST = OPEN_STRINGS[0]!;
export const HIGHEST = OPEN_STRINGS[OPEN_STRINGS.length - 1]! + MAX_FRET;

/** A hand position spans anchor..anchor+SPAN: one finger per fret plus a one-fret stretch. */
const SPAN = 4;
const MAX_ANCHOR = MAX_FRET - SPAN;

export interface Position {
  /** 0 = low E. */
  string: number;
  fret: number;
}

export interface PlacedNote {
  midi: number;
  name: string;
  beat: number;
  beats: number;
  approach: boolean;
  position: Position;
}

export interface PlacedBar {
  plan: BarPlan;
  bassMidi: number | null;
  anchor: number | null;
  notes: PlacedNote[];
}

export interface PlaceOptions {
  approach: PatternApproach;
  key: ResolvedKey;
  /** Index of the bar that follows `bar` (the loop start at a loop's end), or null. */
  nextOf(bar: number): number | null;
}

export function positionsOf(midi: number): Position[] {
  const out: Position[] = [];
  OPEN_STRINGS.forEach((open, string) => {
    const fret = midi - open;
    if (fret >= 0 && fret <= MAX_FRET) out.push({ string, fret });
  });
  return out;
}

const inWindow = (p: Position, anchor: number) =>
  p.fret === 0 || (p.fret >= anchor && p.fret <= anchor + SPAN);

/** The candidate nearest `fromFret`. Ties go to the lower string, which is listed first. */
function nearest(candidates: Position[], fromFret: number): Position | null {
  let best: Position | null = null;
  for (const c of candidates) {
    if (!best || Math.abs(c.fret - fromFret) < Math.abs(best.fret - fromFret)) best = c;
  }
  return best;
}

interface State {
  bassMidi: number;
  anchor: number;
  cost: number;
  /** One per `tone` slot, in order. Approach slots are placed afterwards. */
  positions: Position[];
}

function barStates(plan: BarPlan): State[] {
  if (plan.bassPc === null) return [];
  const tones = plan.slots.flatMap((s) => (s.tone.kind === 'tone' ? [s.tone.semis] : []));
  const top = Math.max(0, ...tones);
  const out: State[] = [];
  for (let bassMidi = LOWEST; bassMidi + top <= HIGHEST; bassMidi++) {
    if (mod12(bassMidi) !== plan.bassPc) continue;
    for (let anchor = 1; anchor <= MAX_ANCHOR; anchor++) {
      let cost = 0.05 * anchor;
      let fromFret = anchor;
      const positions: Position[] = [];
      for (const semis of tones) {
        const p = nearest(positionsOf(bassMidi + semis).filter((c) => inWindow(c, anchor)), fromFret);
        if (!p) break;
        if (p.fret === anchor + SPAN) cost += 1;
        cost += 0.1 * Math.abs((p.fret || anchor) - fromFret);
        positions.push(p);
        fromFret = p.fret || anchor;
      }
      if (positions.length === tones.length) out.push({ bassMidi, anchor, cost, positions });
    }
  }
  return out;
}

const transition = (a: State, b: State) =>
  Math.abs(a.anchor - b.anchor) + (Math.abs(a.bassMidi - b.bassMidi) > 7 ? 1 : 0);

/** Viterbi over one run of consecutive bars that all have states. */
function bestPath(states: State[][]): State[] {
  let cost = states[0]!.map((s) => s.cost);
  const back: number[][] = [];
  for (let k = 1; k < states.length; k++) {
    const prev = states[k - 1]!;
    const nextCost: number[] = [];
    const pointers: number[] = [];
    for (const s of states[k]!) {
      let best = Infinity;
      let arg = 0;
      prev.forEach((p, pi) => {
        const c = cost[pi]! + transition(p, s);
        if (c < best) {
          best = c;
          arg = pi;
        }
      });
      nextCost.push(best + s.cost);
      pointers.push(arg);
    }
    cost = nextCost;
    back.push(pointers);
  }
  let arg = cost.indexOf(Math.min(...cost));
  const path: State[] = new Array(states.length);
  for (let k = states.length - 1; k >= 0; k--) {
    path[k] = states[k]![arg]!;
    if (k > 0) arg = back[k - 1]![arg]!;
  }
  return path;
}

export function placeBars(plans: BarPlan[], options: PlaceOptions): PlacedBar[] {
  const states = plans.map(barStates);
  const chosen: (State | null)[] = plans.map(() => null);
  // An empty bar breaks the chain: the hand is free to move during a rest.
  let i = 0;
  while (i < plans.length) {
    if (states[i]!.length === 0) {
      i++;
      continue;
    }
    let j = i;
    while (j < plans.length && states[j]!.length > 0) j++;
    bestPath(states.slice(i, j)).forEach((s, k) => (chosen[i + k] = s));
    i = j;
  }
  return plans.map((plan, index) => placeOne(plan, index, chosen, options));
}

function placeOne(
  plan: BarPlan,
  index: number,
  chosen: (State | null)[],
  { approach, key, nextOf }: PlaceOptions,
): PlacedBar {
  const state = chosen[index] ?? null;
  if (!state) return { plan, bassMidi: null, anchor: null, notes: [] };
  const notes: PlacedNote[] = [];
  let t = 0;
  for (const slot of plan.slots) {
    if (slot.tone.kind === 'tone') {
      const midi = state.bassMidi + slot.tone.semis;
      notes.push({
        midi,
        name: spell(mod12(midi), key),
        beat: slot.beat,
        beats: slot.beats,
        approach: false,
        position: state.positions[t++]!,
      });
      continue;
    }
    const target = nextOf(index);
    const next = target === null ? null : (chosen[target] ?? null);
    if (!next || approach === 'none') {
      throw new Error(`bar ${plan.bar + 1}: an approach slot, but the next bar has no notes to approach`);
    }
    const midi = approachPitch(approach, next.bassMidi, key, LOWEST);
    const candidates = positionsOf(midi);
    const position =
      nearest(candidates.filter((c) => inWindow(c, state.anchor)), state.anchor) ??
      nearest(candidates, state.anchor);
    if (!position) throw new Error(`bar ${plan.bar + 1}: approach note ${midi} is off the neck`);
    notes.push({ midi, name: spell(mod12(midi), key), beat: slot.beat, beats: slot.beats, approach: true, position });
  }
  return { plan, bassMidi: state.bassMidi, anchor: state.anchor, notes };
}
```

- [ ] **Step 4: Run and see it pass**

Run: `npm --prefix frontend test -- --run src/music/fingering.test.ts`
Expected: PASS. If "stays in position across a I-IV-V-I" fails, print the anchors (`console.log(bars.map(b => [b.bassMidi, b.anchor]))`) and check the cost weights before loosening the assertion. A jump of more than 2 frets between G, C and D in G major means the transition cost is not being applied.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/music/fingering.ts frontend/src/music/fingering.test.ts
git commit -m "feat(music): whole-song fingering for play-along patterns (D-18)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: `beatPosition` and the `TabSource` (`music/tabSource.ts`)

**Files:**
- Modify: `frontend/src/music/grid.ts` (append)
- Modify: `frontend/src/music/grid.test.ts` (append)
- Create: `frontend/src/music/tabSource.ts`
- Test: `frontend/src/music/tabSource.test.ts`

**Interfaces:**
- Consumes: `Grid`, `barAt`, `barStart`, `buildGrid` (existing `grid.ts`); `planBar`, `resolveKey`, `spell`, `ResolvedKey` (Task 3); `placeBars`, `PlacedBar` (Task 4); `Analysis`, `Song` (`api/client.ts`).
- Produces:
  ```ts
  // grid.ts
  export interface BeatPosition { bar: number; beat: number; frac: number }  // frac: 0..1 through the bar
  export function beatPosition(grid: Grid, position: SampleIndex): BeatPosition | null;
  // tabSource.ts
  export interface LoopBars { startBar: number; endBar: number }  // 0-based, end exclusive
  export interface TabSourceInput { song: Song; analysis: Analysis; grid: Grid; loop: LoopBars | null }
  export type TabResult =
    | { ok: true; key: ResolvedKey; bars: PlacedBar[]; nextOf(bar: number): number | null }
    | { ok: false; error: string };
  export interface TabSource { barsFor(input: TabSourceInput): TabResult }
  export const patternSource: TabSource;
  export function chordLabels(analysis: Analysis): string[];
  export function chordText(bar: PlacedBar, key: ResolvedKey): string;
  export function noteIndexAt(bar: PlacedBar, beatsInto: number): number;
  export function describeBar(bar: PlacedBar | undefined, key: ResolvedKey): string;
  ```

- [ ] **Step 1: Write the failing `beatPosition` test**

Append to `frontend/src/music/grid.test.ts` (keep its existing imports; add `beatPosition` to the `./grid` import):

```ts
describe('beatPosition', () => {
  // 120 bpm at 48 kHz: a beat is 24 000 samples, a 4/4 bar 96 000.
  const grid = buildGrid({
    bpm: 120,
    beats: Array.from({ length: 16 }, (_, i) => i * 24_000),
    downbeats: Array.from({ length: 4 }, (_, i) => i * 96_000),
  })!;

  it('finds the bar, the beat and how far through the bar the cursor is', () => {
    expect(beatPosition(grid, sampleIndex(0))).toEqual({ bar: 0, beat: 0, frac: 0 });
    expect(beatPosition(grid, sampleIndex(96_000 + 60_000))).toEqual({ bar: 1, beat: 2, frac: 0.625 });
  });

  it('is null before the first downbeat', () => {
    const late = buildGrid({ bpm: 120, beats: [48_000, 72_000], downbeats: [48_000, 144_000] })!;
    expect(beatPosition(late, sampleIndex(0))).toBeNull();
  });

  it('keeps counting past the analysed bars', () => {
    expect(beatPosition(grid, sampleIndex(5 * 96_000))?.bar).toBe(5);
  });
});
```

If `sampleIndex` is not already imported in that file, add `import { sampleIndex } from '../engine/types';`.

- [ ] **Step 2: Run and see it fail, then implement**

Run: `npm --prefix frontend test -- --run src/music/grid.test.ts`, which should FAIL (`beatPosition` is not exported). Then append to `frontend/src/music/grid.ts`:

```ts
export interface BeatPosition {
  bar: number;
  /** Whole beat within the bar, 0-based. */
  beat: number;
  /** 0..1 through the bar: what the beat lane's cursor is drawn from. */
  frac: number;
}

/**
 * Bar, beat and fraction under the playhead, for the Play along screen. The
 * beat is derived from the fraction and the grid's beats per bar, so a bar
 * past the analysis (extrapolated at the median length) still has beats.
 */
export function beatPosition(grid: Grid, position: SampleIndex): BeatPosition | null {
  const bar = barAt(grid, position);
  if (bar < 0) return null;
  const start = barStart(grid, bar);
  const length = barStart(grid, bar + 1) - start;
  const frac = length > 0 ? Math.min(1, Math.max(0, (position - start) / length)) : 0;
  return { bar, beat: Math.min(grid.beatsPerBar - 1, Math.floor(frac * grid.beatsPerBar)), frac };
}
```

Run again. Expected: PASS.

- [ ] **Step 3: Write the failing `tabSource` tests**

```ts
// frontend/src/music/tabSource.test.ts
import { describe, expect, it } from 'vitest';

import { DEFAULT_PLAY_ALONG, type Analysis, type Song } from '../api/client';
import { buildGrid } from './grid';
import { chordLabels, chordText, describeBar, noteIndexAt, patternSource } from './tabSource';

const analysis: Analysis = {
  schema_version: 1,
  key_candidates: [
    { tonic: 'G', mode: 'major', confidence: 0.6 },
    { tonic: 'D', mode: 'major', confidence: 0.3 },
  ],
  beat_grid: {
    bpm: 120,
    beats: Array.from({ length: 16 }, (_, i) => i * 24_000),
    downbeats: Array.from({ length: 4 }, (_, i) => i * 96_000),
  },
  chords: ['G', 'C', 'D', 'G'].map((chord, bar) => ({
    bar,
    start_sample: bar * 96_000,
    end_sample: (bar + 1) * 96_000,
    chord,
  })),
};
const grid = buildGrid(analysis.beat_grid)!;

function song(overrides: Partial<Song> = {}): Song {
  return {
    schema_version: 3,
    id: 'abc123',
    title: 'T',
    artist: '',
    source: { kind: 'upload', value: 'original.mp3' },
    created_at: '2026-09-29T00:00:00+00:00',
    last_played_at: null,
    mix: {},
    playback: { tempo: 1, pitch_semitones: 0 },
    loops: [],
    active_loop: null,
    metronome: false,
    count_in_bars: 0,
    play_along: DEFAULT_PLAY_ALONG,
    ...overrides,
  };
}

function ok(result: ReturnType<typeof patternSource.barsFor>) {
  if (!result.ok) throw new Error(result.error);
  return result;
}

describe('patternSource', () => {
  it('generates and places a bar per chord, in the top key by default', () => {
    const { bars, key } = ok(patternSource.barsFor({ song: song(), analysis, grid, loop: null }));
    expect(bars).toHaveLength(4);
    expect(chordText(bars[0]!, key)).toBe('G');
    expect(describeBar(bars[0], key)).toBe('Bar 1, G: G B D B');
  });

  it('transposes the chords and the key to what is heard', () => {
    const shifted = song({ playback: { tempo: 1, pitch_semitones: -2 } });
    const { bars, key } = ok(patternSource.barsFor({ song: shifted, analysis, grid, loop: null }));
    expect(chordText(bars[0]!, key)).toBe('F');
    expect(bars[0]!.notes.map((n) => n.name)).toEqual(['F', 'A', 'C', 'A']);
  });

  it("approaches the loop start from the loop's last bar", () => {
    const chromatic = song({
      play_along: { key: null, pattern: { notes: 'triad_chord', rhythm: 'quarter', approach: 'chromatic' } },
    });
    const { bars, nextOf } = ok(
      patternSource.barsFor({ song: chromatic, analysis, grid, loop: { startBar: 0, endBar: 2 } }),
    );
    expect(nextOf(1)).toBe(0);
    expect(bars[1]!.notes[3]!.midi).toBe(bars[0]!.bassMidi! - 1);
  });

  it('fails loudly when the analysis has no key candidates (N-08)', () => {
    const result = patternSource.barsFor({ song: song(), analysis: { ...analysis, key_candidates: [] }, grid, loop: null });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toMatch(/no key candidates/);
  });
});

describe('text helpers', () => {
  it('fills a gap in the chord chart with N rather than shifting bars', () => {
    const gappy: Analysis = { ...analysis, chords: [analysis.chords[0]!, analysis.chords[2]!] };
    expect(chordLabels(gappy)).toEqual(['G', 'N', 'D']);
  });

  it('names an empty bar for what it is', () => {
    const gappy: Analysis = { ...analysis, chords: [analysis.chords[0]!, { ...analysis.chords[1]!, chord: 'X' }] };
    const { bars, key } = ok(patternSource.barsFor({ song: song(), analysis: gappy, grid, loop: null }));
    expect(describeBar(bars[1], key)).toBe('Bar 2, unclassified');
    expect(describeBar(undefined, key)).toBe('past the end of the chord chart');
  });

  it('finds the note sounding at a beat offset', () => {
    const { bars } = ok(patternSource.barsFor({ song: song(), analysis, grid, loop: null }));
    expect(noteIndexAt(bars[0]!, 0)).toBe(0);
    expect(noteIndexAt(bars[0]!, 2.5)).toBe(2);
    expect(noteIndexAt(bars[0]!, 4)).toBe(-1);
  });
});
```

- [ ] **Step 4: Run and see it fail**

Run: `npm --prefix frontend test -- --run src/music/tabSource.test.ts`
Expected: FAIL, "Failed to resolve import ./tabSource".

- [ ] **Step 5: Implement**

```ts
// frontend/src/music/tabSource.ts
// Where the Play along screen gets its notes (D-18). The screen asks a
// TabSource for placed bars and does not care how they were made: today the
// only source generates patterns from the chord chart; a transcription job
// (the deferred "Tabs (bonus)", tech spec §12) will be a second source with
// the same shape.
import type { Analysis, Song } from '../api/client';
import { placeBars, type PlacedBar } from './fingering';
import type { Grid } from './grid';
import { planBar, resolveKey, spell, type ResolvedKey } from './patterns';

/** The armed loop, 0-based bars, end exclusive (as stored in song.json). */
export interface LoopBars {
  startBar: number;
  endBar: number;
}

export interface TabSourceInput {
  song: Song;
  analysis: Analysis;
  grid: Grid;
  loop: LoopBars | null;
}

export type TabResult =
  | { ok: true; key: ResolvedKey; bars: PlacedBar[]; nextOf(bar: number): number | null }
  | { ok: false; error: string };

export interface TabSource {
  barsFor(input: TabSourceInput): TabResult;
}

/** One label per bar, indexed by bar number. A bar the analysis skipped is "N", never a shift. */
export function chordLabels(analysis: Analysis): string[] {
  const count = analysis.chords.reduce((max, c) => Math.max(max, c.bar + 1), 0);
  const labels = new Array<string>(count).fill('N');
  for (const c of analysis.chords) labels[c.bar] = c.chord;
  return labels;
}

function nextBarOf(count: number, loop: LoopBars | null) {
  return (bar: number): number | null => {
    if (loop && bar === loop.endBar - 1 && loop.startBar < count) return loop.startBar;
    return bar + 1 < count ? bar + 1 : null;
  };
}

export const patternSource: TabSource = {
  barsFor({ song, analysis, grid, loop }) {
    const transpose = song.playback.pitch_semitones;
    const key = resolveKey(song.play_along.key, analysis.key_candidates, transpose);
    if (!key) {
      return { ok: false, error: 'The analysis found no key candidates, so there is no key to build patterns in.' };
    }
    const labels = chordLabels(analysis);
    const nextOf = nextBarOf(labels.length, loop);
    const { pattern } = song.play_along;
    const plans = labels.map((label, bar) => {
      const next = nextOf(bar);
      return planBar({
        bar,
        label,
        nextLabel: next === null ? null : labels[next]!,
        key,
        pattern,
        beatsPerBar: grid.beatsPerBar,
        transpose,
      });
    });
    return { ok: true, key, bars: placeBars(plans, { approach: pattern.approach, key, nextOf }), nextOf };
  },
};

/** The bar's chord as heard (transposed), e.g. "F♯m", "C/E", or what the bar is instead. */
export function chordText(bar: PlacedBar, key: ResolvedKey): string {
  const { plan } = bar;
  if (plan.empty === 'no_chord') return 'no chord';
  if (plan.empty === 'unclassified') return 'unclassified';
  if (plan.empty === 'unparsed') return `unreadable chord "${plan.label}"`;
  const tones = plan.tones!;
  const suffix = tones.quality === 'maj' ? '' : tones.quality === 'min' ? 'm' : tones.quality;
  const bass = tones.bassPc !== tones.rootPc ? `/${spell(tones.bassPc, key)}` : '';
  return `${spell(tones.rootPc, key)}${suffix}${bass}`;
}

/** Index of the note sounding `beatsInto` beats into the bar, or -1. */
export function noteIndexAt(bar: PlacedBar, beatsInto: number): number {
  return bar.notes.findIndex((n) => beatsInto >= n.beat && beatsInto < n.beat + n.beats);
}

/** One line for screen readers and tests: "Bar 5, G: G B D C♯". */
export function describeBar(bar: PlacedBar | undefined, key: ResolvedKey): string {
  if (!bar) return 'past the end of the chord chart';
  const head = `Bar ${bar.plan.bar + 1}, ${chordText(bar, key)}`;
  return bar.notes.length > 0 ? `${head}: ${bar.notes.map((n) => n.name).join(' ')}` : head;
}
```

- [ ] **Step 6: Run and see it pass, then run the whole music folder**

Run: `npm --prefix frontend test -- --run src/music`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/music/grid.ts frontend/src/music/grid.test.ts frontend/src/music/tabSource.ts frontend/src/music/tabSource.test.ts
git commit -m "feat(music): TabSource with the pattern source, and beatPosition (D-18)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Lift the session out of SongView (`SongSession` + `SongScope`)

A refactor: behaviour is unchanged, except the engine now lives above the screen. The existing `SongView.test.tsx` must pass with only its render harness changed.

**Files:**
- Create: `frontend/src/session/SongSession.tsx`
- Create: `frontend/src/session/SongScope.tsx`
- Create: `frontend/src/session/SongScope.test.tsx`
- Modify: `frontend/src/screens/SongView.tsx`
- Modify: `frontend/src/screens/SongView.test.tsx` (render harness only)
- Modify: `frontend/src/app/routes.tsx`

**Interfaces:**
- Produces:
  ```ts
  export interface SongSession {
    songId: string;
    entry: SongEntry | undefined; isPending: boolean; loadError: unknown | null;
    fetchedSong: Song | null; hasStems: boolean;
    analysis: Analysis | undefined; analysisError: unknown | null; notAnalyzedYet: boolean;
    chords: ChordSegment[]; grid: Grid | null;
    song: Song | null; engine: EngineController | null; engineError: string | null; saveError: Error | null;
    soloed: ReadonlySet<StemName>; playing: boolean; loopArmed: boolean; seekNonce: number;
    getPosition(): SampleIndex;
    applyRecipe(next: Song): void;
    onPlayPause(): Promise<void>; onScrub(position: SampleIndex): void; onNudgeBars(delta: number): void;
    onTempoChange(tempo: number): void; onPitchChange(semitones: number): void; onMetronomeToggle(): void;
    onSetLoopStart(): void; onSetLoopEnd(): void; onLoopArmToggle(): void;
    onMuteToggle(name: StemName): void; onSoloToggle(name: StemName): void;
    onGainChange(name: StemName, gainDb: number): void; onMuteLane(index: number): void;
    onRecallLoop(loop: Loop): void; onSaveActiveLoop(name: string): void; onDeleteLoop(name: string): void;
    onCountInChange(bars: number): void;
  }
  export function useSongSessionState(songId: string): SongSession;
  export const SongSessionContext: React.Context<SongSession | null>;
  export function useSongSession(): SongSession;   // throws outside a SongScope
  export function SongScope(): JSX.Element;         // renders <Outlet/> inside the provider
  ```

- [ ] **Step 1: Write the failing scope test**

```tsx
// frontend/src/session/SongScope.test.tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, renderHook, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SongScope } from './SongScope';
import { useSongSession } from './SongSession';

const engine = {
  play: vi.fn(async () => {}),
  pause: vi.fn(),
  seek: vi.fn(),
  setLoop: vi.fn(),
  setTempo: vi.fn(),
  setPitchSemitones: vi.fn(),
  setStemGain: vi.fn(),
  setMetronome: vi.fn(),
  setGrid: vi.fn(),
  countInAndPlay: vi.fn(async () => {}),
  onEnded: vi.fn(() => () => {}),
  getPositionSamples: vi.fn(() => 0),
  dispose: vi.fn(async () => {}),
  durationSamples: 48_000 * 8,
  durationSeconds: 8,
  stemSummaries: [],
};

vi.mock('../engine/EngineController', () => ({
  STEM_ORDER: ['vocals', 'drums', 'bass', 'other'],
  EngineController: { create: vi.fn(async () => engine) },
}));

import { EngineController } from '../engine/EngineController';

const songEntry = {
  dir: 'abc123-test',
  state: 'separated',
  unreadable: null,
  files: { has_audio: true, has_peaks: true, has_stems: true, has_analysis: false },
  song: {
    schema_version: 3,
    id: 'abc123',
    title: 'Test Song',
    artist: '',
    source: { kind: 'upload', value: 'original.mp3' },
    created_at: '2026-09-29T00:00:00+00:00',
    last_played_at: null,
    mix: {},
    playback: { tempo: 1, pitch_semitones: 0 },
    loops: [],
    active_loop: null,
    metronome: false,
    count_in_bars: 0,
    play_along: { key: null, pattern: { notes: 'triad_chord', rhythm: 'quarter', approach: 'none' } },
  },
};

function Probe({ name }: { name: string }) {
  const session = useSongSession();
  return (
    <p>
      {name}: {session.engine ? 'engine ready' : 'no engine'}
    </p>
  );
}

function Nav() {
  const navigate = useNavigate();
  return (
    <>
      <button onClick={() => navigate('/songs/abc123')}>to view</button>
      <button onClick={() => navigate('/songs/abc123/play')}>to play</button>
      <button onClick={() => navigate('/')}>to library</button>
    </>
  );
}

function renderScope(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Nav />
        <Routes>
          <Route path="/" element={<p>library</p>} />
          <Route path="/songs/:songId" element={<SongScope />}>
            <Route index element={<Probe name="view" />} />
            <Route path="play" element={<Probe name="play" />} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) =>
      url.endsWith('/analysis')
        ? new Response('not found', { status: 404 })
        : new Response(JSON.stringify(songEntry), { status: 200 }),
    ),
  );
});
afterEach(() => vi.unstubAllGlobals());

describe('SongScope', () => {
  it('keeps one engine across Song view and Play along, and disposes it on leaving the song', async () => {
    renderScope('/songs/abc123');
    expect(await screen.findByText('view: engine ready')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'to play' }));
    expect(await screen.findByText('play: engine ready')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'to view' }));
    expect(await screen.findByText('view: engine ready')).toBeInTheDocument();

    expect(EngineController.create).toHaveBeenCalledTimes(1);
    expect(engine.dispose).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: 'to library' }));
    await waitFor(() => expect(engine.dispose).toHaveBeenCalledTimes(1));
  });

  it('refuses to be used outside a scope', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => renderHook(() => useSongSession())).toThrow(/SongScope/);
    spy.mockRestore();
  });
});
```

- [ ] **Step 2: Run and see it fail**

Run: `npm --prefix frontend test -- --run src/session`
Expected: FAIL, "Failed to resolve import ./SongScope".

- [ ] **Step 3: Create `session/SongSession.tsx`**

This moves SongView's lines 55–487 (as of commit `e78a35e`) into a hook. The code is moved, not rewritten: keep every comment. The full file:

```tsx
// The listening session for one song, shared by every screen that plays it
// (D-18). Song view and Play along are two views of one session: the engine,
// the recipe, the transport and the loop live here, above both routes, so
// switching screens never stops playback or re-decodes the stems.
//
// Moved from SongView, which owned all of this until Play along existed. The
// rules it documented still shape this file:
//   * One funnel. Every control edits the recipe through `applyRecipe`, which
//     sets state, pushes to the engine and saves -- so no control can change
//     what you hear without also persisting it (§6, "all settings auto-save").
//   * Solo is transient, mute is persistent (D6-04). song.json has `muted` and
//     `gain_db` and no `soloed`; solo lives in React state and is combined with
//     the other two only at the engine edge, in `effectiveGain`.
//   * Moving the cursor releases an armed loop first, visibly (U-06), and at
//     the engine *before* the seek (D-06).
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

import {
  ApiError,
  songMedia,
  type Analysis,
  type ChordSegment,
  type Loop,
  type Song,
  type SongEntry,
  type StemMix,
} from '../api/client';
import { useAnalysis, useSong, useUpdateSong } from '../api/queries';
import { EngineController, STEM_ORDER, type StemName } from '../engine/EngineController';
import { sampleIndex, type SampleIndex } from '../engine/types';
import { barAt, barStart, buildGrid, snapToBar, type Grid } from '../music/grid';

/** Shared identity, so resetting solo on navigation is not a re-render. */
const NO_SOLO: ReadonlySet<StemName> = new Set<StemName>();
/** Stable identity, so a song with no analysis does not re-merge every render. */
const NO_CHORDS: ChordSegment[] = [];

/**
 * Mute, solo and gain collapse into the one number the engine takes. D6-04:
 * solo is transient React state and mute is persisted in song.json, so they are
 * combined here rather than stored combined.
 */
function effectiveGain(
  mix: StemMix | undefined,
  name: StemName,
  soloed: ReadonlySet<StemName>,
): number {
  if (mix?.muted) return 0;
  if (soloed.size > 0 && !soloed.has(name)) return 0;
  const db = mix?.gain_db ?? 0;
  return Math.pow(10, db / 20);
}

function pushMix(engine: EngineController, song: Song, soloed: ReadonlySet<StemName>): void {
  for (const name of STEM_ORDER) engine.setStemGain(name, effectiveGain(song.mix[name], name, soloed));
}

/**
 * The whole recipe, pushed at the engine. Written as a full push rather than a
 * diff: every call underneath is an idempotent parameter write, and a diff
 * would mean tracking a previous-value shadow copy of song.json for no audible
 * difference. The loop is *not* here -- it is the one setting with a transient
 * armed flag of its own, synced by its own effect below.
 */
function pushRecipe(engine: EngineController, song: Song, soloed: ReadonlySet<StemName>): void {
  engine.setTempo(song.playback.tempo);
  engine.setPitchSemitones(song.playback.pitch_semitones);
  engine.setMetronome(song.metronome);
  pushMix(engine, song, soloed);
}

export interface SongSession {
  songId: string;
  entry: SongEntry | undefined;
  isPending: boolean;
  /** The song query's error, or null. Rendered verbatim (N-08). */
  loadError: unknown | null;
  fetchedSong: Song | null;
  hasStems: boolean;
  analysis: Analysis | undefined;
  /** The analysis query's error, or null. A 404 also sets `notAnalyzedYet`. */
  analysisError: unknown | null;
  notAnalyzedYet: boolean;
  chords: ChordSegment[];
  grid: Grid | null;
  /** The recipe, owned here once seeded; the query result is only its seed. */
  song: Song | null;
  engine: EngineController | null;
  engineError: string | null;
  saveError: Error | null;
  soloed: ReadonlySet<StemName>;
  playing: boolean;
  loopArmed: boolean;
  /** A repaint ticket for paused seeks (usePlayhead), not a position. */
  seekNonce: number;
  getPosition(): SampleIndex;
  applyRecipe(next: Song): void;
  onPlayPause(): Promise<void>;
  onScrub(position: SampleIndex): void;
  onNudgeBars(delta: number): void;
  onTempoChange(tempo: number): void;
  onPitchChange(pitchSemitones: number): void;
  onMetronomeToggle(): void;
  onSetLoopStart(): void;
  onSetLoopEnd(): void;
  onLoopArmToggle(): void;
  onMuteToggle(name: StemName): void;
  onSoloToggle(name: StemName): void;
  onGainChange(name: StemName, gainDb: number): void;
  onMuteLane(index: number): void;
  onRecallLoop(loop: Loop): void;
  onSaveActiveLoop(name: string): void;
  onDeleteLoop(name: string): void;
  onCountInChange(bars: number): void;
}

export function useSongSessionState(songId: string): SongSession {
  const songQuery = useSong(songId);
  const analysisQuery = useAnalysis(songId);
  // N-08: a save that failed must say so. Everything on this screen edits a
  // recipe that is only real once it reaches song.json, so a rejected PUT (a
  // 409 on an id mismatch, a 500 on an unreadable song.json, a dropped LAN
  // connection) leaves the user editing something nothing is persisting --
  // silently, unless this error is rendered.
  const { save, error: saveError } = useUpdateSong(songId);

  const [engine, setEngine] = useState<EngineController | null>(null);
  const [engineError, setEngineError] = useState<string | null>(null);
  const [song, setSong] = useState<Song | null>(null);
  const [soloed, setSoloed] = useState<ReadonlySet<StemName>>(NO_SOLO);
  const [playing, setPlaying] = useState(false);
  const [loopArmed, setLoopArmed] = useState(false);
  // A repaint ticket, not a position. The readouts read the cursor through
  // `getPosition`, whose identity depends only on the engine, so moving the
  // cursor while paused changes nothing any of their rAF effects depend on and
  // they stay frozen on the old position. Bumping this is how a seek tells them
  // to paint one more frame.
  const [seekNonce, setSeekNonce] = useState(0);

  const entry = songQuery.data;
  const fetchedSong = entry?.song ?? null;
  const hasStems = entry?.files?.has_stems === true;

  const grid = useMemo(
    () => (analysisQuery.data ? buildGrid(analysisQuery.data.beat_grid) : null),
    [analysisQuery.data],
  );

  // Handlers must keep a stable identity: Transport registers a window keydown
  // listener in an effect keyed on them, and the rAF loops usePlayhead runs
  // restart when their callbacks change. So the handlers read the current
  // render's values from here instead of closing over them.
  const latest = useRef({ engine, song, grid, soloed, playing, loopArmed });
  useEffect(() => {
    latest.current = { engine, song, grid, soloed, playing, loopArmed };
  });

  // ---- data -> state ------------------------------------------------------
```

Continue the file by pasting SongView.tsx **lines 149–487 verbatim** (from `const seededFor = useRef<string | null>(null);` through the end of `handleCountInChange`; line 147's `// ---- data -> state` comment is already above). Make no edits except:
- the comment "SongView is not keyed by :songId" becomes "The scope is not keyed by :songId";
- in the engine-lifecycle effect, the guard `if (!songId || !hasStems) return;` stays as written.

Then close the hook:

```tsx
  // ---- context value ------------------------------------------------------

  // A 404 from analysis is "not analyzed yet" (the normal state for a song that
  // has only been separated), not a failure: the screen still plays, with no
  // bars. Any other error keeps the loud N-08 treatment.
  const notAnalyzedYet =
    analysisQuery.error instanceof ApiError && analysisQuery.error.status === 404;
  const chords = analysisQuery.data?.chords ?? NO_CHORDS;

  return useMemo<SongSession>(
    () => ({
      songId,
      entry,
      isPending: songQuery.isPending,
      loadError: songQuery.isError ? songQuery.error : null,
      fetchedSong,
      hasStems,
      analysis: analysisQuery.data,
      analysisError: analysisQuery.isError ? analysisQuery.error : null,
      notAnalyzedYet,
      chords,
      grid,
      song,
      engine,
      engineError,
      saveError: saveError ?? null,
      soloed,
      playing,
      loopArmed,
      seekNonce,
      getPosition,
      applyRecipe,
      onPlayPause: handlePlayPause,
      onScrub: handleScrub,
      onNudgeBars: handleNudgeBars,
      onTempoChange: handleTempoChange,
      onPitchChange: handlePitchChange,
      onMetronomeToggle: handleMetronomeToggle,
      onSetLoopStart: handleSetLoopStart,
      onSetLoopEnd: handleSetLoopEnd,
      onLoopArmToggle: handleLoopArmToggle,
      onMuteToggle: handleMuteToggle,
      onSoloToggle: handleSoloToggle,
      onGainChange: handleGainChange,
      onMuteLane: handleMuteLane,
      onRecallLoop: handleRecallLoop,
      onSaveActiveLoop: handleSaveActiveLoop,
      onDeleteLoop: handleDeleteLoop,
      onCountInChange: handleCountInChange,
    }),
    [
      songId,
      entry,
      songQuery.isPending,
      songQuery.isError,
      songQuery.error,
      fetchedSong,
      hasStems,
      analysisQuery.data,
      analysisQuery.isError,
      analysisQuery.error,
      notAnalyzedYet,
      chords,
      grid,
      song,
      engine,
      engineError,
      saveError,
      soloed,
      playing,
      loopArmed,
      seekNonce,
      getPosition,
      applyRecipe,
      handlePlayPause,
      handleScrub,
      handleNudgeBars,
      handleTempoChange,
      handlePitchChange,
      handleMetronomeToggle,
      handleSetLoopStart,
      handleSetLoopEnd,
      handleLoopArmToggle,
      handleMuteToggle,
      handleSoloToggle,
      handleGainChange,
      handleMuteLane,
      handleRecallLoop,
      handleSaveActiveLoop,
      handleDeleteLoop,
      handleCountInChange,
    ],
  );
}

export const SongSessionContext = createContext<SongSession | null>(null);

export function useSongSession(): SongSession {
  const session = useContext(SongSessionContext);
  if (!session) throw new Error('useSongSession must be used inside a SongScope route');
  return session;
}
```

- [ ] **Step 4: Create `session/SongScope.tsx`**

```tsx
// D-18: the layout route over /songs/:songId and /songs/:songId/play. It owns
// the session, so the engine lives exactly as long as the user is on this
// song: switching between Song view and Play along keeps it (and keeps
// playing), and leaving the song unmounts this and disposes it.
import { Outlet, useParams } from 'react-router-dom';

import { SongSessionContext, useSongSessionState } from './SongSession';

export function SongScope() {
  const { songId = '' } = useParams();
  const session = useSongSessionState(songId);
  return (
    <SongSessionContext.Provider value={session}>
      <Outlet />
    </SongSessionContext.Provider>
  );
}
```

- [ ] **Step 5: Run the scope test**

Run: `npm --prefix frontend test -- --run src/session`
Expected: PASS.

- [ ] **Step 6: Make SongView consume the session**

In `frontend/src/screens/SongView.tsx`:

1. Replace the header comment's first paragraph with:
   ```tsx
   // UI spec §6, screen 3 -- the screen where a song is edited. The engine, the
   // recipe and every transport/mixer/loop handler live in the song session
   // (session/SongSession.tsx, D-18), shared with Play along; this file owns
   // only how the time axis is drawn: zoom, follow, pan and drag-to-zoom.
   ```
   Delete the "Three rules shape this file" paragraph (it now lives in SongSession.tsx).
2. Delete everything from `/** Shared identity, so resetting solo...` (line 55) through the end of `handleCountInChange` (line 487). In its place, at the top of `export function SongView() {`, put:

```tsx
export function SongView() {
  const {
    songId,
    entry,
    isPending,
    loadError,
    fetchedSong,
    hasStems,
    analysis,
    analysisError,
    notAnalyzedYet,
    chords,
    grid,
    song,
    engine,
    engineError,
    saveError,
    soloed,
    playing,
    loopArmed,
    seekNonce,
    getPosition,
    onPlayPause: handlePlayPause,
    onScrub: handleScrub,
    onNudgeBars: handleNudgeBars,
    onTempoChange: handleTempoChange,
    onPitchChange: handlePitchChange,
    onMetronomeToggle: handleMetronomeToggle,
    onSetLoopStart: handleSetLoopStart,
    onSetLoopEnd: handleSetLoopEnd,
    onLoopArmToggle: handleLoopArmToggle,
    onMuteToggle: handleMuteToggle,
    onSoloToggle: handleSoloToggle,
    onGainChange: handleGainChange,
    onMuteLane: handleMuteLane,
    onRecallLoop: handleRecallLoop,
    onSaveActiveLoop: handleSaveActiveLoop,
    onDeleteLoop: handleDeleteLoop,
    onCountInChange: handleCountInChange,
  } = useSongSession();

  // View state, not recipe: how the time axis is drawn never reaches song.json.
  const [zoom, setZoom] = useState<Zoom>(DEFAULT_PX_PER_BAR);
  const [follow, setFollow] = useState(true);
  // The time axis scroll container, as state so Timeline's follow painter is
  // handed the element once it exists, and its visible content width (minus
  // the sticky head column), which is what Fit fits the song into.
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null);
  const [viewportWidth, setViewportWidth] = useState(0);

  // releaseFollow is registered on a non-passive wheel listener that must not
  // be re-attached every render, so it reads `playing` through a ref.
  const playingRef = useRef(playing);
  useEffect(() => {
    playingRef.current = playing;
  });

  const loopStartBar = song?.active_loop?.start_bar ?? null;
  const loopEndBar = song?.active_loop?.end_bar ?? null;
```

(Keep the `// ---- time axis view ---` section and everything after it.)

3. In `releaseFollow`, change `if (latest.current.playing) setFollow(false);` to `if (playingRef.current) setFollow(false);`. `grep -n "latest\." src/screens/SongView.tsx` must then return nothing.
4. In the render section:
   - Delete `const chords = analysisQuery.data?.chords ?? NO_CHORDS;` and `const notAnalyzedYet = ...;` (they come from the session now).
   - `if (songQuery.isPending)` → `if (isPending)`.
   - `if (songQuery.isError) { ... {String(songQuery.error)} ... }` → `if (loadError !== null) { ... {String(loadError)} ... }`.
   - `{analysisQuery.isError && !notAnalyzedYet && (` → `{analysisError !== null && !notAnalyzedYet && (`, and `{String(analysisQuery.error)}` → `{String(analysisError)}`.
   - `candidates={analysisQuery.data?.key_candidates ?? []}` → `candidates={analysis?.key_candidates ?? []}`.
5. Fix the imports: remove `ApiError`, `songMedia`, `ChordSegment`, `Loop`, `Song`, `StemMix`; the `../api/queries` import; `EngineController`, `STEM_ORDER`, `StemName`; `sampleIndex`, `SampleIndex`; and `barAt`, `barStart`, `buildGrid`, `snapToBar`. Add `import { useSongSession } from '../session/SongSession';`. Remove `useParams` from the router import (keep `Link`). Run `npm --prefix frontend run typecheck` and remove anything it reports as missing or unused until it is clean.

- [ ] **Step 7: Mount SongView inside the scope in its test and the routes**

In `frontend/src/screens/SongView.test.tsx`, add `import { SongScope } from '../session/SongScope';` and change the `<Routes>` in `renderSongView` to:

```tsx
        <Routes>
          <Route path="/songs/:songId" element={<SongScope />}>
            <Route index element={<SongView />} />
          </Route>
        </Routes>
```

In `frontend/src/app/routes.tsx`, add `import { SongScope } from '../session/SongScope';` and replace

```tsx
          <Route path="songs/:songId" element={<SongView />} />
```

with

```tsx
          {/* D-18: one session per song, above the screens that play it, so
              switching between them never stops playback. */}
          <Route path="songs/:songId" element={<SongScope />}>
            <Route index element={<SongView />} />
          </Route>
```

Check `frontend/src/app/routes.test.tsx`. If it renders `/songs/:id` and asserts on SongView, it passes as is. If it mocks `../screens/SongView`, the mock still applies.

- [ ] **Step 8: Run everything**

Run: `npm --prefix frontend run typecheck && npm --prefix frontend test -- --run`
Expected: all PASS, including every existing `SongView.test.tsx` case, unchanged.

- [ ] **Step 9: Commit**

```bash
git add frontend/src/session frontend/src/screens/SongView.tsx frontend/src/screens/SongView.test.tsx frontend/src/app/routes.tsx
git commit -m "refactor(ui): song session and engine move above the screen into SongScope (D-18)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Session handlers for Play along

**Files:**
- Modify: `frontend/src/session/SongSession.tsx`
- Modify: `frontend/src/session/SongScope.test.tsx`

**Interfaces:**
- Produces, added to `SongSession`:
  ```ts
  /** Sets the loop by bars: 0-based start, exclusive end. Ignored unless end > start >= 0. Keeps the loop's name. */
  onLoopBars(startBar: number, endBar: number): void;
  /** Replaces the play_along recipe. */
  onPlayAlongChange(playAlong: PlayAlong): void;
  ```

- [ ] **Step 1: Write the failing tests**

Append to `frontend/src/session/SongScope.test.tsx`:

```tsx
function Controls() {
  const session = useSongSession();
  return (
    <>
      <p>loop: {session.song?.active_loop ? `${session.song.active_loop.start_bar}-${session.song.active_loop.end_bar}` : 'none'}</p>
      <p>notes: {session.song?.play_along.pattern.notes}</p>
      <button onClick={() => session.onLoopBars(4, 8)}>loop 5 to 8</button>
      <button onClick={() => session.onLoopBars(8, 8)}>empty loop</button>
      <button
        onClick={() =>
          session.song &&
          session.onPlayAlongChange({ ...session.song.play_along, pattern: { ...session.song.play_along.pattern, notes: 'root' } })
        }
      >
        roots
      </button>
    </>
  );
}

describe('play-along session handlers', () => {
  function renderControls() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/songs/abc123/play']}>
          <Routes>
            <Route path="/songs/:songId" element={<SongScope />}>
              <Route path="play" element={<Controls />} />
            </Route>
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
  }

  it('sets the loop by bars and saves it, and ignores an empty range', async () => {
    renderControls();
    await userEvent.click(await screen.findByRole('button', { name: 'loop 5 to 8' }));
    expect(screen.getByText('loop: 4-8')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'empty loop' }));
    expect(screen.getByText('loop: 4-8')).toBeInTheDocument();
    await waitFor(
      () => {
        const put = vi.mocked(fetch).mock.calls.find(([, init]) => init?.method === 'PUT');
        expect(JSON.parse(String(put![1]!.body)).active_loop).toEqual({ name: '', start_bar: 4, end_bar: 8 });
      },
      { timeout: 3000 },
    );
  });

  it('replaces the play_along recipe', async () => {
    renderControls();
    await userEvent.click(await screen.findByRole('button', { name: 'roots' }));
    expect(screen.getByText('notes: root')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run and see them fail**

Run: `npm --prefix frontend test -- --run src/session`
Expected: FAIL. `session.onLoopBars is not a function` (TypeScript also flags it under typecheck).

- [ ] **Step 3: Implement**

In `SongSession.tsx`, add `type PlayAlong` to the `../api/client` import. After `handleCountInChange`, add:

```tsx
  // ---- play along -------------------------------------------------------

  // Play along sets the loop by bar numbers rather than from the cursor. Same
  // shape as Set A / Set B: the loop keeps its name, and an empty or inverted
  // range is not a loop, so it is refused rather than stored.
  const handleLoopBars = useCallback(
    (start_bar: number, end_bar: number) => {
      const { song: currentSong } = latest.current;
      if (!currentSong || start_bar < 0 || end_bar <= start_bar) return;
      applyRecipe({
        ...currentSong,
        active_loop: { name: currentSong.active_loop?.name ?? '', start_bar, end_bar },
      });
    },
    [applyRecipe],
  );

  const handlePlayAlongChange = useCallback(
    (play_along: PlayAlong) => {
      const { song: currentSong } = latest.current;
      if (currentSong) applyRecipe({ ...currentSong, play_along });
    },
    [applyRecipe],
  );
```

Add to the `SongSession` interface:

```ts
  /** Sets the loop by bars: 0-based start, exclusive end. Ignored unless end > start >= 0. */
  onLoopBars(startBar: number, endBar: number): void;
  onPlayAlongChange(playAlong: PlayAlong): void;
```

Add `onLoopBars: handleLoopBars, onPlayAlongChange: handlePlayAlongChange,` to the returned object, and `handleLoopBars, handlePlayAlongChange` to the `useMemo` dependency list.

- [ ] **Step 4: Run and see them pass**

Run: `npm --prefix frontend run typecheck && npm --prefix frontend test -- --run src/session`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/session/SongSession.tsx frontend/src/session/SongScope.test.tsx
git commit -m "feat(ui): session handlers to loop by bars and edit the play-along recipe (D-18)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: The neck (`playalong/colors.ts`, `neckPainter.ts`, `Neck.tsx`)

**Files:**
- Create: `frontend/src/playalong/colors.ts`
- Create: `frontend/src/playalong/neckPainter.ts`
- Create: `frontend/src/playalong/neckPainter.test.ts`
- Create: `frontend/src/playalong/Neck.tsx`
- Create: `frontend/src/playalong/Neck.test.tsx`
- Create: `frontend/src/playalong/PlayAlong.module.css`

**Interfaces:**
- Consumes: `resolveColor` (`ui/resolveColor.ts`); `PlacedBar`, `MAX_FRET` (Task 4); `beatPosition`, `Grid` (Task 5); `describeBar`, `noteIndexAt` (Task 5); `ResolvedKey` (Task 3); `usePlayhead(getPosition, onFrame, active, repaintNonce)` (`songview/usePlayhead.ts`).
- Produces:
  ```ts
  // colors.ts
  export interface PlayAlongColors { note; hot; approach; next; string; fret; nut; label; board; onNote; raised; ground; text; textDim: string }
  export function playAlongColors(): PlayAlongColors;
  // neckPainter.ts
  export const NECK_H = 214;
  export interface NeckGeometry { width: number; nutX: number; fretW: number }
  export function neckGeometry(width: number): NeckGeometry;
  export function stringY(string: number): number;
  export function noteX(g: NeckGeometry, fret: number): number;
  export function paintNeck(ctx: CanvasRenderingContext2D, width: number, colors: PlayAlongColors, current: PlacedBar | null, next: PlacedBar | null, hot: number): void;
  // Neck.tsx
  export interface NeckProps { bars: PlacedBar[]; nextOf(bar: number): number | null; songKey: ResolvedKey; grid: Grid; getPosition(): SampleIndex; playing: boolean; seekNonce: number }
  export function Neck(props: NeckProps): JSX.Element;   // <canvas role="img" data-testid="neck-canvas" aria-label=...>
  ```
  (`songKey`, not `key`: `key` is reserved by React.)

- [ ] **Step 1: Write the failing painter test**

```ts
// frontend/src/playalong/neckPainter.test.ts
import { describe, expect, it, vi } from 'vitest';

import type { PlacedBar } from '../music/fingering';
import type { BarPlan } from '../music/patterns';
import type { PlayAlongColors } from './colors';
import { neckGeometry, noteX, paintNeck, stringY } from './neckPainter';

const colors: PlayAlongColors = {
  note: 'teal', hot: 'blue', approach: 'orange', next: 'grey', string: 's', fret: 'f', nut: 'n',
  label: 'l', board: 'b', onNote: 'black', raised: 'r', ground: 'g', text: 't', textDim: 'td',
};

function recordingContext() {
  const calls: { fillText: [string, number, number][] } = { fillText: [] };
  const ctx = new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === 'fillText') return (text: string, x: number, y: number) => calls.fillText.push([text, x, y]);
        if (typeof prop === 'string' && ['setLineDash', 'beginPath', 'moveTo', 'lineTo', 'stroke', 'arc', 'fill', 'fillRect', 'clearRect', 'save', 'restore', 'strokeRect', 'roundRect'].includes(prop)) {
          return vi.fn();
        }
        return undefined;
      },
      set: () => true,
    },
  ) as unknown as CanvasRenderingContext2D;
  return { ctx, calls };
}

// Hand-built bars, so these tests pin what gets drawn rather than which
// positions the fingering search happens to choose.
const plan: BarPlan = { bar: 0, label: 'G', empty: null, reason: null, tones: null, bassPc: 7, slots: [], substitution: null };
const note = (name: string, string: number, fret: number, beat: number) => ({
  midi: 0, name, beat, beats: 1, approach: false, position: { string, fret },
});
const gBar: PlacedBar = {
  plan, bassMidi: 31, anchor: 1,
  notes: [note('G', 0, 3, 0), note('B', 1, 2, 1), note('D', 1, 5, 2), note('B', 1, 2, 3)],
};
const cBar: PlacedBar = {
  plan: { ...plan, bar: 1, label: 'C', bassPc: 0 }, bassMidi: 36, anchor: 2,
  notes: [note('C', 1, 3, 0), note('E', 2, 2, 1), note('G', 2, 5, 2), note('E', 2, 2, 3)],
};

describe('neck geometry', () => {
  it('puts low E at the bottom and fret n between wires n-1 and n', () => {
    expect(stringY(0)).toBeGreaterThan(stringY(3));
    const g = neckGeometry(1000);
    expect(noteX(g, 3)).toBeCloseTo(g.nutX + g.fretW * 2.5);
    expect(noteX(g, 0)).toBeLessThan(g.nutX);
  });
});

describe('paintNeck', () => {
  it("labels this bar's notes with their names and play order, a repeated note once", () => {
    const { ctx, calls } = recordingContext();
    paintNeck(ctx, 1000, colors, gBar, cBar, 2);
    const texts = calls.fillText.map(([t]) => t);
    expect(texts).toEqual(expect.arrayContaining(['G', 'B', 'D', '1', '2·4', '3']));
    // B at beat 2 and beat 4 is one dot, not two.
    expect(texts.filter((t) => t === 'B')).toHaveLength(1);
  });

  it('draws nothing but the neck for an empty bar', () => {
    const { ctx, calls } = recordingContext();
    paintNeck(ctx, 1000, colors, null, null, -1);
    // Fret numbers 1..12 and string names only.
    expect(calls.fillText.map(([t]) => t)).toEqual([
      '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', 'E', 'A', 'D', 'G',
    ]);
  });
});
```

- [ ] **Step 2: Run and see it fail**

Run: `npm --prefix frontend test -- --run src/playalong/neckPainter.test.ts`
Expected: FAIL, "Failed to resolve import ./colors".

- [ ] **Step 3: Implement colours and the painter**

```ts
// frontend/src/playalong/colors.ts
// Canvas colours for Play along. A canvas cannot read var(--ds-*), so every
// token is resolved once from :root (resolveColor), keeping tokens.css the
// single authority (U-02).
import { resolveColor } from '../ui/resolveColor';

export interface PlayAlongColors {
  note: string;
  hot: string;
  approach: string;
  next: string;
  string: string;
  fret: string;
  nut: string;
  label: string;
  board: string;
  onNote: string;
  raised: string;
  ground: string;
  text: string;
  textDim: string;
}

export function playAlongColors(): PlayAlongColors {
  return {
    note: resolveColor('var(--ds-bass)'),
    hot: resolveColor('var(--ds-accent)'),
    approach: resolveColor('var(--ds-warn)'),
    next: resolveColor('var(--ds-text-2)'),
    string: resolveColor('var(--ds-text-3)'),
    fret: resolveColor('var(--ds-border-strong)'),
    nut: resolveColor('var(--ds-text)'),
    label: resolveColor('var(--ds-text-3)'),
    board: resolveColor('var(--ds-surface)'),
    onNote: resolveColor('var(--ds-ground)'),
    raised: resolveColor('var(--ds-raised)'),
    ground: resolveColor('var(--ds-ground)'),
    text: resolveColor('var(--ds-text)'),
    textDim: resolveColor('var(--ds-text-3)'),
  };
}
```

```ts
// frontend/src/playalong/neckPainter.ts
// Drawing the Play along neck (D-18), kept apart from the component so the
// geometry and what gets drawn are testable against a recording context.
// Mirrors the mockup (design/ui/src/pages/screens/play-along.html): this bar's
// notes filled and numbered, the one to play now lit with a halo, approach
// notes ringed, the next bar's notes as dashed hollow rings.
import { MAX_FRET, type PlacedBar } from '../music/fingering';
import type { PlayAlongColors } from './colors';

export const NECK_H = 214;
const TOP = 40;
const STRING_GAP = 44;
const STRINGS = 'EADG';

export interface NeckGeometry {
  width: number;
  nutX: number;
  fretW: number;
}

export function neckGeometry(width: number): NeckGeometry {
  const nutX = 48;
  return { width, nutX, fretW: Math.max(0, (width - nutX - 18) / MAX_FRET) };
}

/** 0 = low E, drawn at the bottom, as a player looks down at the neck. */
export function stringY(string: number): number {
  return TOP + STRING_GAP * (3 - string);
}

/** Centre of a fretted note: between wire fret-1 and wire fret. Open notes sit left of the nut. */
export function noteX(g: NeckGeometry, fret: number): number {
  return fret === 0 ? g.nutX - 22 : g.nutX + g.fretW * (fret - 0.5);
}

function line(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number) {
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

function dot(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
}

export function paintNeck(
  ctx: CanvasRenderingContext2D,
  width: number,
  colors: PlayAlongColors,
  current: PlacedBar | null,
  next: PlacedBar | null,
  hot: number,
): void {
  const g = neckGeometry(width);
  const top = stringY(3) - 22;
  const bottom = stringY(0) + 22;
  ctx.clearRect(0, 0, width, NECK_H);

  ctx.fillStyle = colors.board;
  ctx.fillRect(g.nutX, top, g.fretW * MAX_FRET, bottom - top);

  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.font = '500 13px ui-monospace, monospace';
  ctx.fillStyle = colors.label;
  for (let f = 1; f <= MAX_FRET; f++) ctx.fillText(String(f), noteX(g, f), 16);

  for (let f = 0; f <= MAX_FRET; f++) {
    ctx.strokeStyle = f === 0 ? colors.nut : colors.fret;
    ctx.lineWidth = f === 0 ? 6 : 2;
    const x = g.nutX + g.fretW * f;
    line(ctx, x, top, x, bottom);
  }

  ctx.font = '600 17px system-ui, sans-serif';
  ctx.textAlign = 'left';
  for (let s = 0; s < 4; s++) {
    ctx.strokeStyle = colors.string;
    ctx.lineWidth = 3.2 - s * 0.6;
    line(ctx, g.nutX, stringY(s), g.nutX + g.fretW * MAX_FRET, stringY(s));
    ctx.fillStyle = colors.label;
    ctx.fillText(STRINGS[s]!, 8, stringY(s) + 6);
  }

  ctx.fillStyle = colors.fret;
  for (const f of [3, 5, 7, 9]) {
    dot(ctx, noteX(g, f), bottom + 18, 5);
    ctx.fill();
  }
  for (const d of [-10, 10]) {
    dot(ctx, noteX(g, 12) + d, bottom + 18, 5);
    ctx.fill();
  }

  if (next) {
    ctx.strokeStyle = colors.next;
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 4]);
    for (const n of next.notes) {
      dot(ctx, noteX(g, n.position.fret), stringY(n.position.string), 18);
      ctx.stroke();
    }
    ctx.setLineDash([]);
  }

  if (!current) return;
  // One dot per position, numbered with every beat it is played on ("2·4").
  const byPosition = new Map<string, { index: number[]; approach: boolean; name: string; string: number; fret: number }>();
  current.notes.forEach((n, i) => {
    const k = `${n.position.string}:${n.position.fret}`;
    const entry = byPosition.get(k);
    if (entry) {
      entry.index.push(i);
      entry.approach ||= n.approach;
    } else {
      byPosition.set(k, { index: [i], approach: n.approach, name: n.name, string: n.position.string, fret: n.position.fret });
    }
  });

  ctx.textAlign = 'center';
  for (const d of byPosition.values()) {
    const x = noteX(g, d.fret);
    const y = stringY(d.string);
    const isHot = d.index.includes(hot);
    if (isHot) {
      ctx.globalAlpha = 0.22;
      ctx.fillStyle = colors.hot;
      dot(ctx, x, y, 30);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    ctx.fillStyle = isHot ? colors.hot : colors.note;
    dot(ctx, x, y, 21);
    ctx.fill();
    if (d.approach) {
      ctx.strokeStyle = colors.approach;
      ctx.lineWidth = 3;
      ctx.stroke();
    }
    ctx.fillStyle = colors.onNote;
    ctx.font = '700 15px system-ui, sans-serif';
    ctx.fillText(d.name, x, y - 1);
    ctx.font = '700 10px system-ui, sans-serif';
    ctx.fillText(d.index.map((i) => i + 1).join('·'), x, y + 13);
  }
}
```

- [ ] **Step 4: Run the painter test**

Run: `npm --prefix frontend test -- --run src/playalong/neckPainter.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing component test**

```tsx
// frontend/src/playalong/Neck.test.tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { DEFAULT_PLAY_ALONG, type Analysis, type Song } from '../api/client';
import { sampleIndex } from '../engine/types';
import { buildGrid } from '../music/grid';
import { patternSource } from '../music/tabSource';
import { Neck } from './Neck';

const analysis: Analysis = {
  schema_version: 1,
  key_candidates: [{ tonic: 'G', mode: 'major', confidence: 1 }],
  beat_grid: { bpm: 120, beats: Array.from({ length: 12 }, (_, i) => i * 24_000), downbeats: [0, 96_000, 192_000] },
  chords: ['G', 'C', 'D'].map((chord, bar) => ({ bar, start_sample: bar * 96_000, end_sample: (bar + 1) * 96_000, chord })),
};
const grid = buildGrid(analysis.beat_grid)!;
const song = {
  schema_version: 3, id: 'x', title: 't', artist: '', source: { kind: 'upload', value: 'o' },
  created_at: '', last_played_at: null, mix: {}, playback: { tempo: 1, pitch_semitones: 0 },
  loops: [], active_loop: null, metronome: false, count_in_bars: 0, play_along: DEFAULT_PLAY_ALONG,
} as Song;

describe('Neck', () => {
  it('describes the bar under the playhead and the next one, for screen readers', () => {
    const result = patternSource.barsFor({ song, analysis, grid, loop: null });
    if (!result.ok) throw new Error(result.error);
    render(
      <Neck
        bars={result.bars}
        nextOf={result.nextOf}
        songKey={result.key}
        grid={grid}
        // Bar 2 (index 1), beat 3.
        getPosition={() => sampleIndex(96_000 + 2 * 24_000)}
        playing={false}
        seekNonce={0}
      />,
    );
    const canvas = screen.getByTestId('neck-canvas');
    expect(canvas.tagName).toBe('CANVAS');
    expect(canvas).toHaveAttribute('role', 'img');
    expect(canvas.getAttribute('aria-label')).toBe('Bar 2, C: C E G E. Next: Bar 3, D: D F♯ A F♯');
  });
});
```

- [ ] **Step 6: Run and see it fail, then implement the component and CSS**

Run: `npm --prefix frontend test -- --run src/playalong/Neck.test.tsx`. It should FAIL on the missing `./Neck`. Then create:

```tsx
// frontend/src/playalong/Neck.tsx
// Play along's neck (D-18). A canvas painted from the engine clock through
// usePlayhead, never from React state at audio rate (U-05). It draws; it never
// plays (D-07). The neck is still between notes, so a frame repaints only when
// the bar, the lit note, the width or the bars themselves change.
import { useCallback, useLayoutEffect, useRef, useState, type RefObject } from 'react';

import type { SampleIndex } from '../engine/types';
import type { PlacedBar } from '../music/fingering';
import { beatPosition, type Grid } from '../music/grid';
import type { ResolvedKey } from '../music/patterns';
import { describeBar, noteIndexAt } from '../music/tabSource';
import { usePlayhead } from '../songview/usePlayhead';
import { playAlongColors, type PlayAlongColors } from './colors';
import { NECK_H, paintNeck } from './neckPainter';
import styles from './PlayAlong.module.css';

export interface NeckProps {
  bars: PlacedBar[];
  nextOf(bar: number): number | null;
  songKey: ResolvedKey;
  grid: Grid;
  getPosition(): SampleIndex;
  playing: boolean;
  seekNonce: number;
}

/** Tracks the width of the canvas's parent, so the neck fills its panel. */
export function useParentWidth(ref: RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const parent = ref.current?.parentElement;
    if (!parent) return;
    const measure = () => setWidth(parent.clientWidth);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(parent);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}

export function Neck({ bars, nextOf, songKey, grid, getPosition, playing, seekNonce }: NeckProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const width = useParentWidth(canvasRef);
  const colors = useRef<PlayAlongColors | null>(null);
  const last = useRef<{ bars: PlacedBar[]; bar: number; hot: number; width: number } | null>(null);

  const paint = useCallback(
    (position: SampleIndex) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const at = beatPosition(grid, position);
      const barIndex = at?.bar ?? -1;
      const current = at ? bars[at.bar] : undefined;
      const hot = current && at ? noteIndexAt(current, at.frac * grid.beatsPerBar) : -1;
      const seen = last.current;
      if (seen && seen.bars === bars && seen.bar === barIndex && seen.hot === hot && seen.width === width) return;
      last.current = { bars, bar: barIndex, hot, width };

      const nextIndex = at ? nextOf(at.bar) : null;
      const next = nextIndex === null ? undefined : bars[nextIndex];
      canvas.setAttribute(
        'aria-label',
        at ? `${describeBar(current, songKey)}. Next: ${describeBar(next, songKey)}` : 'Before the first bar',
      );

      const dpr = window.devicePixelRatio || 1;
      if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(NECK_H * dpr)) {
        canvas.width = Math.round(width * dpr);
        canvas.height = Math.round(NECK_H * dpr);
        canvas.style.width = `${width}px`;
        canvas.style.height = `${NECK_H}px`;
      }
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      colors.current ??= playAlongColors();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      paintNeck(ctx, width, colors.current, current ?? null, next ?? null, hot);
    },
    [bars, nextOf, songKey, grid, width],
  );
  usePlayhead(getPosition, paint, playing, seekNonce);

  return <canvas ref={canvasRef} className={styles.canvas} data-testid="neck-canvas" role="img" aria-label="Bass neck" />;
}
```

```css
/* frontend/src/playalong/PlayAlong.module.css
   Play along (D-18). Mirrors design/ui/src/pages/screens/play-along.html. */
.canvas {
  display: block;
  width: 100%;
}

.board {
  background: var(--ds-ground);
  border: 1px solid var(--ds-border);
  border-radius: var(--ds-r-panel);
  padding: var(--ds-4) var(--ds-3) var(--ds-3);
  display: flex;
  flex-direction: column;
  gap: var(--ds-2);
}
```

Run again. Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/playalong/colors.ts frontend/src/playalong/neckPainter.ts frontend/src/playalong/neckPainter.test.ts frontend/src/playalong/Neck.tsx frontend/src/playalong/Neck.test.tsx frontend/src/playalong/PlayAlong.module.css
git commit -m "feat(ui): play-along neck painted from the engine clock (D-18)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: The beat lane (`beatLanePainter.ts`, `BeatLane.tsx`)

**Files:**
- Create: `frontend/src/playalong/beatLanePainter.ts`
- Create: `frontend/src/playalong/beatLanePainter.test.ts`
- Create: `frontend/src/playalong/BeatLane.tsx`

**Interfaces:**
- Consumes: `PlayAlongColors`, `playAlongColors` (Task 8); `useParentWidth` from `./Neck` (Task 8); `PlacedBar` (Task 4); `beatPosition`, `Grid` (Task 5); `chordText`, `noteIndexAt` (Task 5); `usePlayhead`.
- Produces:
  ```ts
  export const LANE_H = 92;
  export interface LaneBar { bar: PlacedBar; title: string }
  export function paintBeatLane(ctx: CanvasRenderingContext2D, width: number, colors: PlayAlongColors, current: LaneBar | null, next: LaneBar | null, beatsPerBar: number, frac: number, hot: number): void;
  export interface BeatLaneProps { bars: PlacedBar[]; nextOf(bar: number): number | null; songKey: ResolvedKey; grid: Grid; getPosition(): SampleIndex; playing: boolean; seekNonce: number }
  export function BeatLane(props: BeatLaneProps): JSX.Element;  // aria-hidden canvas; the neck carries the description
  ```

- [ ] **Step 1: Write the failing painter test**

```ts
// frontend/src/playalong/beatLanePainter.test.ts
import { describe, expect, it, vi } from 'vitest';

import type { PlacedBar } from '../music/fingering';
import type { BarPlan } from '../music/patterns';
import { paintBeatLane } from './beatLanePainter';
import type { PlayAlongColors } from './colors';

const colors = new Proxy({}, { get: (_t, p) => String(p) }) as PlayAlongColors;

function recording() {
  const texts: string[] = [];
  const lines: number[] = [];
  const ctx = new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === 'fillText') return (t: string) => texts.push(t);
        if (prop === 'moveTo') return (x: number) => lines.push(x);
        return vi.fn();
      },
      set: () => true,
    },
  ) as unknown as CanvasRenderingContext2D;
  return { ctx, texts, lines };
}

const plan: BarPlan = { bar: 0, label: 'G', empty: null, reason: null, tones: null, bassPc: 7, slots: [], substitution: null };
const note = (name: string, beat: number) => ({
  midi: 0, name, beat, beats: 1, approach: false, position: { string: 1, fret: 2 },
});
const gBar: PlacedBar = { plan, bassMidi: 31, anchor: 1, notes: ['G', 'B', 'D', 'B'].map((n, i) => note(n, i)) };
const cBar: PlacedBar = {
  plan: { ...plan, bar: 1, label: 'C', bassPc: 0 }, bassMidi: 36, anchor: 2,
  notes: ['C', 'E', 'G', 'E'].map((n, i) => note(n, i)),
};

describe('paintBeatLane', () => {
  it('draws numbered chips for this bar, plain ones for the next, and the cursor', () => {
    const { ctx, texts, lines } = recording();
    paintBeatLane(
      ctx, 1020, colors,
      { bar: gBar, title: 'Bar 1 · G' },
      { bar: cBar, title: 'Next · bar 2 · C' },
      4, 0.3, 1,
    );
    expect(texts).toEqual(
      expect.arrayContaining(['Bar 1 · G', 'Next · bar 2 · C', '1 · G', '2 · B', '3 · D', '4 · B', 'C', 'E']),
    );
    // The cursor is 30% through the current bar's box: x = 10 + 0.3 * (1020 - 20) / 2.
    // (Beat lines sit at 135, 260 and 385, so 160 can only be the cursor.)
    expect(lines).toContain(160);
  });
});
```

- [ ] **Step 2: Run and see it fail**

Run: `npm --prefix frontend test -- --run src/playalong/beatLanePainter.test.ts`
Expected: FAIL, "Failed to resolve import ./beatLanePainter".

- [ ] **Step 3: Implement the painter and the component**

```ts
// frontend/src/playalong/beatLanePainter.ts
// The beat lane under the neck (D-18): the current bar and the next as boxes
// divided into beats, one chip per note at its rhythmic position, and a cursor
// sweeping the current bar. It gives the rhythm the neck cannot show: roots in
// quarters and an octave pump in eighths look alike on a neck.
import type { PlacedBar } from '../music/fingering';
import type { PlayAlongColors } from './colors';

export const LANE_H = 92;

export interface LaneBar {
  bar: PlacedBar;
  title: string;
}

export function paintBeatLane(
  ctx: CanvasRenderingContext2D,
  width: number,
  colors: PlayAlongColors,
  current: LaneBar | null,
  next: LaneBar | null,
  beatsPerBar: number,
  frac: number,
  hot: number,
): void {
  ctx.clearRect(0, 0, width, LANE_H);
  const boxW = (width - 20) / 2;
  const boxes: [LaneBar | null, boolean][] = [
    [current, false],
    [next, true],
  ];

  boxes.forEach(([lane, isNext], i) => {
    const x0 = 10 + i * boxW;
    ctx.fillStyle = isNext ? colors.ground : colors.raised;
    ctx.fillRect(x0 + 3, 22, boxW - 6, 62);
    ctx.strokeStyle = colors.fret;
    ctx.lineWidth = 1;
    ctx.strokeRect(x0 + 3, 22, boxW - 6, 62);
    if (!lane) return;

    ctx.textAlign = 'left';
    ctx.font = '600 13px system-ui, sans-serif';
    ctx.fillStyle = isNext ? colors.textDim : colors.text;
    ctx.fillText(lane.title, x0 + 10, 15);

    for (let q = 1; q < beatsPerBar; q++) {
      const x = x0 + (q * boxW) / beatsPerBar;
      ctx.beginPath();
      ctx.moveTo(x, 28);
      ctx.lineTo(x, 78);
      ctx.stroke();
    }

    ctx.textAlign = 'center';
    ctx.font = '700 15px system-ui, sans-serif';
    lane.bar.notes.forEach((note, n) => {
      const x = x0 + (note.beat / beatsPerBar) * boxW + 6;
      const w = Math.max(18, (note.beats / beatsPerBar) * boxW - 12);
      ctx.beginPath();
      ctx.roundRect(x, 37, w, 32, 16);
      if (isNext) {
        ctx.setLineDash([5, 4]);
        ctx.strokeStyle = colors.textDim;
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.setLineDash([]);
      } else {
        ctx.fillStyle = n === hot ? colors.hot : colors.note;
        ctx.fill();
        if (note.approach) {
          ctx.strokeStyle = colors.approach;
          ctx.lineWidth = 3;
          ctx.stroke();
        }
      }
      const label = isNext ? note.name : `${n + 1} · ${note.name}`;
      // A chip too narrow for its number (eighths on a phone) keeps just the name.
      const text = !isNext && w < 64 ? note.name : label;
      ctx.fillStyle = isNext ? colors.textDim : colors.onNote;
      ctx.fillText(text, x + w / 2, 58);
    });
  });

  if (current) {
    const x = 10 + frac * boxW;
    ctx.strokeStyle = colors.hot;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x, 18);
    ctx.lineTo(x, 88);
    ctx.stroke();
  }
}
```

```tsx
// frontend/src/playalong/BeatLane.tsx
// The beat lane (D-18). Repaints every frame while playing, since the cursor
// moves continuously; all of it from the engine clock (U-05), none of it audio
// (D-07). aria-hidden: the neck's label already says what this bar holds.
import { useCallback, useRef } from 'react';

import type { SampleIndex } from '../engine/types';
import type { PlacedBar } from '../music/fingering';
import { beatPosition, type Grid } from '../music/grid';
import type { ResolvedKey } from '../music/patterns';
import { chordText, noteIndexAt } from '../music/tabSource';
import { usePlayhead } from '../songview/usePlayhead';
import { LANE_H, paintBeatLane } from './beatLanePainter';
import { playAlongColors, type PlayAlongColors } from './colors';
import { useParentWidth } from './Neck';
import styles from './PlayAlong.module.css';

export interface BeatLaneProps {
  bars: PlacedBar[];
  nextOf(bar: number): number | null;
  songKey: ResolvedKey;
  grid: Grid;
  getPosition(): SampleIndex;
  playing: boolean;
  seekNonce: number;
}

export function BeatLane({ bars, nextOf, songKey, grid, getPosition, playing, seekNonce }: BeatLaneProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const width = useParentWidth(canvasRef);
  const colors = useRef<PlayAlongColors | null>(null);

  const paint = useCallback(
    (position: SampleIndex) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const dpr = window.devicePixelRatio || 1;
      if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(LANE_H * dpr)) {
        canvas.width = Math.round(width * dpr);
        canvas.height = Math.round(LANE_H * dpr);
        canvas.style.width = `${width}px`;
        canvas.style.height = `${LANE_H}px`;
      }
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      colors.current ??= playAlongColors();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const at = beatPosition(grid, position);
      const current = at ? bars[at.bar] : undefined;
      const nextIndex = at ? nextOf(at.bar) : null;
      const next = nextIndex === null ? undefined : bars[nextIndex];
      paintBeatLane(
        ctx,
        width,
        colors.current,
        current ? { bar: current, title: `Bar ${current.plan.bar + 1} · ${chordText(current, songKey)}` } : null,
        next ? { bar: next, title: `Next · bar ${next.plan.bar + 1} · ${chordText(next, songKey)}` } : null,
        grid.beatsPerBar,
        at?.frac ?? 0,
        current && at ? noteIndexAt(current, at.frac * grid.beatsPerBar) : -1,
      );
    },
    [bars, nextOf, songKey, grid, width],
  );
  usePlayhead(getPosition, paint, playing, seekNonce);

  return <canvas ref={canvasRef} className={styles.canvas} data-testid="beat-lane-canvas" aria-hidden="true" />;
}
```

- [ ] **Step 4: Run and see it pass**

Run: `npm --prefix frontend run typecheck && npm --prefix frontend test -- --run src/playalong`
Expected: PASS. (`ctx.roundRect` is in TS 5.6's DOM lib; if `tsc` complains, check the `lib` in `tsconfig.json` includes `DOM`.)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/playalong/beatLanePainter.ts frontend/src/playalong/beatLanePainter.test.ts frontend/src/playalong/BeatLane.tsx
git commit -m "feat(ui): play-along beat lane for the current and next bar (D-18)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: The pattern pickers (`PatternPanel.tsx`)

**Files:**
- Create: `frontend/src/playalong/PatternPanel.tsx`
- Create: `frontend/src/playalong/PatternPanel.test.tsx`
- Modify: `frontend/src/playalong/PlayAlong.module.css` (append)

**Interfaces:**
- Consumes: `Segmented` from `../ui` (props `label`, `value`, `options: {value,label}[]`, `onChange`; buttons carry `aria-pressed`); `KeyCandidate`, `PlayAlong`, `PatternNotes`, `PatternRhythm`, `PatternApproach` (`api/client.ts`).
- Produces:
  ```ts
  export interface PatternPanelProps { candidates: KeyCandidate[]; value: PlayAlong; onChange(next: PlayAlong): void }
  export function PatternPanel(props: PatternPanelProps): JSX.Element;
  ```

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/src/playalong/PatternPanel.test.tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { DEFAULT_PLAY_ALONG } from '../api/client';
import { PatternPanel } from './PatternPanel';

const candidates = [
  { tonic: 'G', mode: 'major' as const, confidence: 0.4 },
  { tonic: 'D', mode: 'major' as const, confidence: 0.32 },
];

describe('PatternPanel', () => {
  it('shows the top candidate as the key when none is chosen', () => {
    render(<PatternPanel candidates={candidates} value={DEFAULT_PLAY_ALONG} onChange={vi.fn()} />);
    const keys = screen.getByRole('group', { name: 'Key' });
    expect(keys.querySelector('[aria-pressed="true"]')).toHaveTextContent('G major 40%');
    expect(screen.getByRole('button', { name: 'Triad' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Quarter' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'None' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('reports each choice as a whole new recipe', async () => {
    const onChange = vi.fn();
    render(<PatternPanel candidates={candidates} value={DEFAULT_PLAY_ALONG} onChange={onChange} />);
    await userEvent.click(screen.getByRole('button', { name: /D major/ }));
    expect(onChange).toHaveBeenLastCalledWith({ ...DEFAULT_PLAY_ALONG, key: { tonic: 'D', mode: 'major' } });
    await userEvent.click(screen.getByRole('button', { name: 'Octave' }));
    expect(onChange).toHaveBeenLastCalledWith({
      ...DEFAULT_PLAY_ALONG,
      pattern: { ...DEFAULT_PLAY_ALONG.pattern, notes: 'octave_pump' },
    });
    await userEvent.click(screen.getByRole('button', { name: 'Eighth' }));
    expect(onChange.mock.lastCall![0].pattern.rhythm).toBe('eighth');
    await userEvent.click(screen.getByRole('button', { name: 'Chromatic' }));
    expect(onChange.mock.lastCall![0].pattern.approach).toBe('chromatic');
  });
});
```

- [ ] **Step 2: Run and see it fail**

Run: `npm --prefix frontend test -- --run src/playalong/PatternPanel.test.tsx`
Expected: FAIL, "Failed to resolve import ./PatternPanel".

- [ ] **Step 3: Implement**

```tsx
// frontend/src/playalong/PatternPanel.tsx
// What Play along generates (D-18): key, notes, rhythm and approach, three
// independent choices plus the key to think in. Every change is a whole new
// play_along recipe, saved through the session's one funnel.
import type {
  KeyCandidate,
  PatternApproach,
  PatternNotes,
  PatternRhythm,
  PlayAlong,
} from '../api/client';
import { Segmented } from '../ui';
import styles from './PlayAlong.module.css';

const NOTES: { value: PatternNotes; label: string }[] = [
  { value: 'root', label: 'Root' },
  { value: 'root_fifth', label: '1–5' },
  { value: 'root_fifth_octave', label: '1–5–8' },
  { value: 'octave_pump', label: 'Octave' },
  { value: 'triad_chord', label: 'Triad' },
  { value: 'triad_diatonic', label: 'Diatonic triad' },
  { value: 'seventh', label: '7th' },
];
const RHYTHM: { value: PatternRhythm; label: string }[] = [
  { value: 'whole', label: 'Whole' },
  { value: 'half', label: 'Half' },
  { value: 'quarter', label: 'Quarter' },
  { value: 'eighth', label: 'Eighth' },
];
const APPROACH: { value: PatternApproach; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'chromatic', label: 'Chromatic' },
  { value: 'scale', label: 'Scale' },
  { value: 'fifth', label: 'Fifth' },
];

const keyId = (k: { tonic: string; mode: string }) => `${k.tonic}:${k.mode}`;

export interface PatternPanelProps {
  candidates: KeyCandidate[];
  value: PlayAlong;
  onChange(next: PlayAlong): void;
}

export function PatternPanel({ candidates, value, onChange }: PatternPanelProps) {
  const chosenKey = value.key ?? candidates[0] ?? null;
  const setPattern = (patch: Partial<PlayAlong['pattern']>) =>
    onChange({ ...value, pattern: { ...value.pattern, ...patch } });

  return (
    <div className={styles.pickers}>
      {candidates.length > 0 && chosenKey && (
        <div className={styles.picker}>
          <span className={styles.caption}>Key</span>
          <Segmented
            label="Key"
            value={keyId(chosenKey)}
            options={candidates.map((c) => ({
              value: keyId(c),
              label: `${c.tonic} ${c.mode} ${Math.round(c.confidence * 100)}%`,
            }))}
            onChange={(id) => {
              const picked = candidates.find((c) => keyId(c) === id);
              if (picked) onChange({ ...value, key: { tonic: picked.tonic, mode: picked.mode } });
            }}
          />
        </div>
      )}
      <div className={styles.picker}>
        <span className={styles.caption}>Notes</span>
        <Segmented label="Notes" value={value.pattern.notes} options={NOTES} onChange={(notes) => setPattern({ notes })} />
      </div>
      <div className={styles.picker}>
        <span className={styles.caption}>Rhythm</span>
        <Segmented label="Rhythm" value={value.pattern.rhythm} options={RHYTHM} onChange={(rhythm) => setPattern({ rhythm })} />
      </div>
      <div className={styles.picker}>
        <span className={styles.caption}>Approach</span>
        <Segmented
          label="Approach"
          value={value.pattern.approach}
          options={APPROACH}
          onChange={(approach) => setPattern({ approach })}
        />
      </div>
    </div>
  );
}
```

Append to `PlayAlong.module.css`:

```css
.pickers {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: var(--ds-5);
}

.picker {
  display: flex;
  flex-direction: column;
  gap: var(--ds-1);
}

.caption {
  text-transform: uppercase;
  letter-spacing: 0.08em;
  font-size: var(--ds-t-xs);
  font-weight: 600;
  color: var(--ds-text-3);
}
```

- [ ] **Step 4: Run and see it pass**

Run: `npm --prefix frontend test -- --run src/playalong/PatternPanel.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/playalong/PatternPanel.tsx frontend/src/playalong/PatternPanel.test.tsx frontend/src/playalong/PlayAlong.module.css
git commit -m "feat(ui): play-along pattern pickers (D-18)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Looping by bars (`LoopBars.tsx`, `ChordRibbon.tsx`)

**Files:**
- Create: `frontend/src/playalong/LoopBars.tsx`
- Create: `frontend/src/playalong/LoopBars.test.tsx`
- Create: `frontend/src/playalong/ChordRibbon.tsx`
- Create: `frontend/src/playalong/ChordRibbon.test.tsx`
- Modify: `frontend/src/playalong/PlayAlong.module.css` (append)

**Interfaces:**
- Consumes: `Button` from `../ui`; `Loop` (`api/client.ts`); `PlacedBar` (Task 4); `ResolvedKey` (Task 3); `chordText` (Task 5); `barAt`, `Grid` (`music/grid.ts`); `usePlayhead`.
- Produces:
  ```ts
  // LoopBars.tsx
  export interface LoopBarsProps { loop: Loop | null; barCount: number; onLoopBars(startBar: number, endBar: number): void }
  export function LoopBars(props: LoopBarsProps): JSX.Element;
  // ChordRibbon.tsx
  export interface ChordRibbonProps { bars: PlacedBar[]; songKey: ResolvedKey; loop: Loop | null; grid: Grid; getPosition(): SampleIndex; playing: boolean; seekNonce: number; onLoopBars(startBar: number, endBar: number): void }
  export function ChordRibbon(props: ChordRibbonProps): JSX.Element;
  ```
  Both take and emit **0-based, end-exclusive** bars and display 1-based inclusive ones.

- [ ] **Step 1: Write the failing tests**

```tsx
// frontend/src/playalong/LoopBars.test.tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { LoopBars } from './LoopBars';

describe('LoopBars', () => {
  it('shows the stored loop as 1-based inclusive bars', () => {
    render(<LoopBars loop={{ name: '', start_bar: 4, end_bar: 8 }} barCount={16} onLoopBars={vi.fn()} />);
    expect(screen.getByLabelText('Loop start bar')).toHaveTextContent('5');
    expect(screen.getByLabelText('Loop end bar')).toHaveTextContent('8');
  });

  it('steps the ends, pushing the end along rather than inverting the loop', async () => {
    const onLoopBars = vi.fn();
    render(<LoopBars loop={{ name: '', start_bar: 4, end_bar: 5 }} barCount={16} onLoopBars={onLoopBars} />);
    await userEvent.click(screen.getByRole('button', { name: 'Start bar later' }));
    expect(onLoopBars).toHaveBeenLastCalledWith(5, 6);
    await userEvent.click(screen.getByRole('button', { name: 'End bar later' }));
    expect(onLoopBars).toHaveBeenLastCalledWith(4, 6);
    expect(screen.getByRole('button', { name: 'End bar earlier' })).toBeDisabled();
  });

  it('starts a one-bar loop at bar 1 when there is none', async () => {
    const onLoopBars = vi.fn();
    render(<LoopBars loop={null} barCount={16} onLoopBars={onLoopBars} />);
    await userEvent.click(screen.getByRole('button', { name: 'End bar later' }));
    expect(onLoopBars).toHaveBeenLastCalledWith(0, 2);
  });
});
```

```tsx
// frontend/src/playalong/ChordRibbon.test.tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { DEFAULT_PLAY_ALONG, type Analysis, type Song } from '../api/client';
import { sampleIndex } from '../engine/types';
import { buildGrid } from '../music/grid';
import { patternSource } from '../music/tabSource';
import { ChordRibbon } from './ChordRibbon';

const analysis: Analysis = {
  schema_version: 1,
  key_candidates: [{ tonic: 'G', mode: 'major', confidence: 1 }],
  beat_grid: { bpm: 120, beats: Array.from({ length: 16 }, (_, i) => i * 24_000), downbeats: [0, 96_000, 192_000, 288_000] },
  chords: ['G', 'C', 'D', 'G'].map((chord, bar) => ({ bar, start_sample: bar * 96_000, end_sample: (bar + 1) * 96_000, chord })),
};
const grid = buildGrid(analysis.beat_grid)!;
const song = {
  schema_version: 3, id: 'x', title: 't', artist: '', source: { kind: 'upload', value: 'o' },
  created_at: '', last_played_at: null, mix: {}, playback: { tempo: 1, pitch_semitones: 0 },
  loops: [], active_loop: null, metronome: false, count_in_bars: 0, play_along: DEFAULT_PLAY_ALONG,
} as Song;

function renderRibbon(onLoopBars = vi.fn(), loop = { name: '', start_bar: 1, end_bar: 3 }) {
  const result = patternSource.barsFor({ song, analysis, grid, loop: null });
  if (!result.ok) throw new Error(result.error);
  render(
    <ChordRibbon
      bars={result.bars}
      songKey={result.key}
      loop={loop}
      grid={grid}
      getPosition={() => sampleIndex(96_000 + 10)}
      playing={false}
      seekNonce={0}
      onLoopBars={onLoopBars}
    />,
  );
  return onLoopBars;
}

describe('ChordRibbon', () => {
  it('lists every bar with its chord, lights the current one and tints the loop', () => {
    renderRibbon();
    const cells = screen.getAllByRole('button');
    expect(cells.map((c) => c.textContent)).toEqual(['1G', '2C', '3D', '4G']);
    expect(cells[1]).toHaveAttribute('data-current', 'true');
    expect(cells[1]).toHaveAttribute('data-in-loop', 'true');
    expect(cells[3]).toHaveAttribute('data-in-loop', 'false');
  });

  it('click sets the loop start, shift-click the end', () => {
    const onLoopBars = renderRibbon();
    fireEvent.click(screen.getByRole('button', { name: /Bar 4/ }));
    // A start past the current end pushes the end along: at least one bar.
    expect(onLoopBars).toHaveBeenLastCalledWith(3, 4);
    fireEvent.click(screen.getByRole('button', { name: /Bar 4/ }), { shiftKey: true });
    expect(onLoopBars).toHaveBeenLastCalledWith(1, 4);
    // Shift-click before the start is not an end of anything.
    onLoopBars.mockClear();
    fireEvent.click(screen.getByRole('button', { name: /Bar 1/ }), { shiftKey: true });
    expect(onLoopBars).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run and see them fail**

Run: `npm --prefix frontend test -- --run src/playalong/LoopBars.test.tsx src/playalong/ChordRibbon.test.tsx`
Expected: FAIL, unresolved imports.

- [ ] **Step 3: Implement**

```tsx
// frontend/src/playalong/LoopBars.tsx
// Play along loops by bar numbers (D-18), not by the cursor: start and end
// steppers over the same active_loop Song view edits. Stored bars are 0-based
// with an exclusive end; shown 1-based and inclusive, like the ruler, so
// "5 to 8" is start_bar 4, end_bar 8.
import type { Loop } from '../api/client';
import { Button } from '../ui';
import styles from './PlayAlong.module.css';

export interface LoopBarsProps {
  loop: Loop | null;
  /** Bars the analysis found; neither end steps past it. */
  barCount: number;
  onLoopBars(startBar: number, endBar: number): void;
}

export function LoopBars({ loop, barCount, onLoopBars }: LoopBarsProps) {
  // No loop yet: the steppers start from a one-bar loop on bar 1.
  const start = loop?.start_bar ?? 0;
  const end = loop?.end_bar ?? 1;

  // Like Set A: a start moved onto or past the end pushes the end along.
  const setStart = (next: number) => onLoopBars(next, Math.max(end, next + 1));

  return (
    <div className={styles.picker}>
      <span className={styles.caption}>Loop bars</span>
      <div className={styles.loopBars}>
        <Button aria-label="Start bar earlier" disabled={start <= 0} onClick={() => setStart(start - 1)}>
          −
        </Button>
        <output className={styles.barValue} aria-label="Loop start bar">
          {start + 1}
        </output>
        <Button aria-label="Start bar later" disabled={start >= barCount - 1} onClick={() => setStart(start + 1)}>
          +
        </Button>
        <span className={styles.to}>to</span>
        <Button aria-label="End bar earlier" disabled={end <= start + 1} onClick={() => onLoopBars(start, end - 1)}>
          −
        </Button>
        <output className={styles.barValue} aria-label="Loop end bar">
          {end}
        </output>
        <Button aria-label="End bar later" disabled={end >= barCount} onClick={() => onLoopBars(start, end + 1)}>
          +
        </Button>
      </div>
    </div>
  );
}
```

```tsx
// frontend/src/playalong/ChordRibbon.tsx
// The whole chord chart as one cell per bar (D-18): where you are, where the
// loop is, and a quick way to set it. Click sets the loop start, shift-click
// the end, with the same one-bar minimum and no inversion as Set A / Set B.
// The current bar is lit from the engine clock into a data attribute (U-05),
// the same pattern as ChordStrip, never React state.
import { useCallback, useRef, type MouseEvent } from 'react';

import type { Loop } from '../api/client';
import type { SampleIndex } from '../engine/types';
import type { PlacedBar } from '../music/fingering';
import { barAt, type Grid } from '../music/grid';
import type { ResolvedKey } from '../music/patterns';
import { chordText } from '../music/tabSource';
import { usePlayhead } from '../songview/usePlayhead';
import styles from './PlayAlong.module.css';

export interface ChordRibbonProps {
  bars: PlacedBar[];
  songKey: ResolvedKey;
  loop: Loop | null;
  grid: Grid;
  getPosition(): SampleIndex;
  playing: boolean;
  seekNonce: number;
  onLoopBars(startBar: number, endBar: number): void;
}

export function ChordRibbon({ bars, songKey, loop, grid, getPosition, playing, seekNonce, onLoopBars }: ChordRibbonProps) {
  const cells = useRef<(HTMLButtonElement | null)[]>([]);
  const lit = useRef(-1);

  const paint = useCallback(
    (position: SampleIndex) => {
      const bar = barAt(grid, position);
      if (bar === lit.current && cells.current[bar]?.dataset.current === 'true') return;
      const previous = lit.current >= 0 ? cells.current[lit.current] : null;
      if (previous) previous.dataset.current = 'false';
      const cell = bar >= 0 ? cells.current[bar] : null;
      if (cell) cell.dataset.current = 'true';
      lit.current = bar;
    },
    [grid],
  );
  usePlayhead(getPosition, paint, playing, seekNonce);

  const select = (bar: number, event: MouseEvent) => {
    if (event.shiftKey) {
      const start = loop?.start_bar ?? 0;
      if (bar < start) return;
      onLoopBars(start, bar + 1);
      return;
    }
    onLoopBars(bar, Math.max(loop?.end_bar ?? 0, bar + 1));
  };

  return (
    <div className={styles.ribbon} role="group" aria-label="Chord chart by bar. Click sets the loop start, shift-click the end.">
      {bars.map((b, i) => {
        const inLoop = loop !== null && i >= loop.start_bar && i < loop.end_bar;
        const text = b.plan.empty ? (b.plan.empty === 'no_chord' ? '–' : '?') : chordText(b, songKey);
        return (
          <button
            key={i}
            type="button"
            ref={(el) => {
              cells.current[i] = el;
            }}
            className={styles.cell}
            data-current="false"
            data-in-loop={inLoop ? 'true' : 'false'}
            aria-label={`Bar ${i + 1}, ${chordText(b, songKey)}`}
            onClick={(event) => select(i, event)}
          >
            <span className={styles.cellBar}>{i + 1}</span>
            {text}
          </button>
        );
      })}
    </div>
  );
}
```

Append to `PlayAlong.module.css`:

```css
.loopBars {
  display: inline-flex;
  align-items: center;
  gap: var(--ds-2);
}

.barValue {
  min-width: 48px;
  text-align: center;
  font: 600 var(--ds-t-lg) / 1 var(--ds-mono);
}

.to {
  color: var(--ds-text-2);
  font-size: var(--ds-t-sm);
}

.ribbon {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(52px, 1fr));
  gap: 3px;
}

.cell {
  min-height: var(--ds-hit-setup);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1px;
  background: var(--ds-raised);
  border: 1px solid var(--ds-border);
  border-radius: var(--ds-r-input);
  color: var(--ds-text-2);
  font: 600 var(--ds-t-sm) / 1 var(--ds-font);
  cursor: pointer;
}

.cell[data-in-loop='true'] {
  background: color-mix(in srgb, var(--ds-bass) 12%, var(--ds-raised));
}

.cell[data-current='true'] {
  border-color: var(--ds-bass);
  color: var(--ds-bass);
}

.cellBar {
  font: 500 11px var(--ds-mono);
  color: var(--ds-text-3);
}
```

- [ ] **Step 4: Run and see them pass**

Run: `npm --prefix frontend test -- --run src/playalong`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/playalong/LoopBars.tsx frontend/src/playalong/LoopBars.test.tsx frontend/src/playalong/ChordRibbon.tsx frontend/src/playalong/ChordRibbon.test.tsx frontend/src/playalong/PlayAlong.module.css
git commit -m "feat(ui): loop by bar numbers, steppers and chord ribbon (D-18)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: The Play along screen, its route and the link from Song view

**Files:**
- Create: `frontend/src/playalong/NowReadout.tsx`
- Create: `frontend/src/playalong/PlayAlongTransport.tsx`
- Create: `frontend/src/screens/PlayAlong.tsx`
- Create: `frontend/src/screens/PlayAlong.test.tsx`
- Modify: `frontend/src/playalong/PlayAlong.module.css` (append)
- Modify: `frontend/src/app/routes.tsx`
- Modify: `frontend/src/screens/SongView.tsx` (header link)

**Interfaces:**
- Consumes: `useSongSession()` incl. `onLoopBars`, `onPlayAlongChange` (Tasks 6–7); `patternSource`, `chordText`, `noteIndexAt`, `LoopBars` type (Task 5); `Neck` (8), `BeatLane` (9), `PatternPanel` (10), `LoopBars`, `ChordRibbon` (11); `Button`, `ButtonLink`, `Segmented`, `Banner`, `EmptyState`, `Panel` from `../ui`; `usePlayhead`; `beatPosition`.
- Produces: `export function PlayAlong(): JSX.Element` at route `songs/:songId/play`.

- [ ] **Step 1: Write the failing screen test**

```tsx
// frontend/src/screens/PlayAlong.test.tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SongScope } from '../session/SongScope';
import { PlayAlong } from './PlayAlong';
import { SongView } from './SongView';

let cursor = 0;
const engine = {
  play: vi.fn(async () => {}),
  pause: vi.fn(),
  seek: vi.fn(),
  setLoop: vi.fn(),
  setTempo: vi.fn(),
  setPitchSemitones: vi.fn(),
  setStemGain: vi.fn(),
  setMetronome: vi.fn(),
  setGrid: vi.fn(),
  countInAndPlay: vi.fn(async () => {}),
  onEnded: vi.fn(() => () => {}),
  getPositionSamples: vi.fn(() => cursor),
  dispose: vi.fn(async () => {}),
  durationSamples: 48_000 * 8,
  durationSeconds: 8,
  stemSummaries: ['vocals', 'drums', 'bass', 'other'].map((name) => ({
    name,
    envelope: Float32Array.from([0.3]),
    peak: 0.3,
    nearSilent: false,
  })),
};

vi.mock('../engine/EngineController', () => ({
  STEM_ORDER: ['vocals', 'drums', 'bass', 'other'],
  EngineController: { create: vi.fn(async () => engine) },
}));

const songEntry = {
  dir: 'abc123-test',
  state: 'analyzed',
  unreadable: null,
  files: { has_audio: true, has_peaks: true, has_stems: true, has_analysis: true },
  song: {
    schema_version: 3,
    id: 'abc123',
    title: 'Test Song',
    artist: 'Someone',
    source: { kind: 'upload', value: 'original.mp3' },
    created_at: '2026-09-29T00:00:00+00:00',
    last_played_at: null,
    mix: {},
    playback: { tempo: 1, pitch_semitones: 0 },
    loops: [],
    active_loop: null,
    metronome: false,
    count_in_bars: 0,
    play_along: { key: null, pattern: { notes: 'triad_chord', rhythm: 'quarter', approach: 'none' } },
  },
};

const analysis = {
  schema_version: 1,
  key_candidates: [{ tonic: 'G', mode: 'major', confidence: 0.6 }],
  beat_grid: {
    bpm: 120,
    beats: Array.from({ length: 16 }, (_, i) => i * 24_000),
    downbeats: Array.from({ length: 4 }, (_, i) => i * 96_000),
  },
  chords: ['G', 'C', 'D', 'G'].map((chord, bar) => ({ bar, start_sample: bar * 96_000, end_sample: (bar + 1) * 96_000, chord })),
};

function mockFetch(analysisBody: unknown = analysis) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'PUT') return new Response(String(init.body), { status: 200 });
      if (url.endsWith('/analysis')) {
        return analysisBody === 404
          ? new Response('not found', { status: 404 })
          : new Response(JSON.stringify(analysisBody), { status: 200 });
      }
      return new Response(JSON.stringify(songEntry), { status: 200 });
    }),
  );
}

function renderAt(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/songs/:songId" element={<SongScope />}>
            <Route index element={<SongView />} />
            <Route path="play" element={<PlayAlong />} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  cursor = 0;
  mockFetch();
});
afterEach(() => vi.unstubAllGlobals());

describe('PlayAlong', () => {
  it('shows the neck for the bar under the playhead', async () => {
    renderAt('/songs/abc123/play');
    const neck = await screen.findByTestId('neck-canvas');
    await waitFor(() => expect(neck.getAttribute('aria-label')).toBe('Bar 1, G: G B D B. Next: Bar 2, C: C E G E'));
    expect(screen.getByRole('heading', { name: 'Test Song' })).toBeInTheDocument();
    expect(screen.getByText(/not a transcription/i)).toBeInTheDocument();
  });

  it('saves a pattern change to song.json', async () => {
    renderAt('/songs/abc123/play');
    await userEvent.click(await screen.findByRole('button', { name: 'Octave' }));
    await waitFor(
      () => {
        const put = vi.mocked(fetch).mock.calls.find(([, init]) => init?.method === 'PUT');
        expect(JSON.parse(String(put![1]!.body)).play_along.pattern.notes).toBe('octave_pump');
      },
      { timeout: 3000 },
    );
  });

  it('says the song needs analysis rather than drawing an empty neck', async () => {
    mockFetch(404);
    renderAt('/songs/abc123/play');
    expect(await screen.findByText(/needs analysis/i)).toBeInTheDocument();
    expect(screen.queryByTestId('neck-canvas')).not.toBeInTheDocument();
  });

  it('is linked from Song view, and links back', async () => {
    renderAt('/songs/abc123');
    await userEvent.click(await screen.findByRole('link', { name: /play along/i }));
    expect(await screen.findByTestId('neck-canvas')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('link', { name: /song view/i }));
    expect(await screen.findByTestId('time-axis')).toBeInTheDocument();
  });

  it('toggles playback with the Space key', async () => {
    renderAt('/songs/abc123/play');
    await screen.findByTestId('neck-canvas');
    await userEvent.keyboard(' ');
    await waitFor(() => expect(engine.play).toHaveBeenCalled());
  });
});
```

- [ ] **Step 2: Run and see it fail**

Run: `npm --prefix frontend test -- --run src/screens/PlayAlong.test.tsx`
Expected: FAIL, "Failed to resolve import ./PlayAlong".

- [ ] **Step 3: Implement `NowReadout` and `PlayAlongTransport`**

```tsx
// frontend/src/playalong/NowReadout.tsx
// Bar · beat, the chord now → the chord next, and what a pattern had to
// substitute in this bar. Painted into refs from the engine clock (U-05), like
// Transport's readouts. The substitution is part of the readout because it
// changes bar to bar, and hiding it would be a silent fallback (N-08).
import { useCallback, useRef } from 'react';

import type { SampleIndex } from '../engine/types';
import type { PlacedBar } from '../music/fingering';
import { beatPosition, type Grid } from '../music/grid';
import type { ResolvedKey } from '../music/patterns';
import { chordText } from '../music/tabSource';
import { usePlayhead } from '../songview/usePlayhead';
import styles from './PlayAlong.module.css';

export interface NowReadoutProps {
  bars: PlacedBar[];
  nextOf(bar: number): number | null;
  songKey: ResolvedKey;
  grid: Grid;
  pitchSemitones: number;
  getPosition(): SampleIndex;
  playing: boolean;
  seekNonce: number;
}

export function NowReadout({ bars, nextOf, songKey, grid, pitchSemitones, getPosition, playing, seekNonce }: NowReadoutProps) {
  const barRef = useRef<HTMLSpanElement | null>(null);
  const beatRef = useRef<HTMLSpanElement | null>(null);
  const nowRef = useRef<HTMLSpanElement | null>(null);
  const nextRef = useRef<HTMLSpanElement | null>(null);
  const noteRef = useRef<HTMLSpanElement | null>(null);

  const paint = useCallback(
    (position: SampleIndex) => {
      const at = beatPosition(grid, position);
      const current = at ? bars[at.bar] : undefined;
      const nextIndex = at ? nextOf(at.bar) : null;
      const next = nextIndex === null ? undefined : bars[nextIndex];
      const set = (el: HTMLElement | null, text: string) => {
        if (el && el.textContent !== text) el.textContent = text;
      };
      set(barRef.current, at ? String(at.bar + 1) : '--');
      set(beatRef.current, at ? `beat ${at.beat + 1}` : '');
      set(nowRef.current, current ? chordText(current, songKey) : '--');
      set(nextRef.current, next ? chordText(next, songKey) : '');
      const note = current?.plan.substitution ?? current?.plan.reason ?? '';
      set(noteRef.current, note);
      if (noteRef.current) noteRef.current.hidden = note === '';
    },
    [bars, nextOf, songKey, grid],
  );
  usePlayhead(getPosition, paint, playing, seekNonce);

  return (
    <div className={styles.now}>
      <span className={styles.caption}>Bar</span>
      <span className={styles.bigBar} data-testid="play-bar" ref={barRef}>
        --
      </span>
      <span className={styles.beat} ref={beatRef} />
      <span className={styles.chordNow} data-testid="play-chord" ref={nowRef}>
        --
      </span>
      <span className={styles.arrow} aria-hidden="true">
        →
      </span>
      <span className={styles.chordNext} data-testid="play-chord-next" ref={nextRef} />
      <span className={styles.substitution} data-testid="play-substitution" ref={noteRef} hidden />
      {pitchSemitones !== 0 && (
        <span className={styles.pitchNote}>
          pitch {pitchSemitones > 0 ? '+' : '−'}
          {Math.abs(pitchSemitones)} st · fingering follows what you hear
        </span>
      )}
    </div>
  );
}
```

```tsx
// frontend/src/playalong/PlayAlongTransport.tsx
// The transport a player reaches for with a bass in their hands: perform-size
// targets (56 px), and Space to play or pause. It only calls the session's
// handlers, so it cannot drift from Song view's transport: same engine, same
// recipe, same loop.
import { useEffect } from 'react';

import type { Loop } from '../api/client';
import { Button, Segmented } from '../ui';
import { LoopBars } from './LoopBars';
import styles from './PlayAlong.module.css';

const COUNT_IN = [0, 1, 2];

export interface PlayAlongTransportProps {
  playing: boolean;
  tempo: number;
  metronome: boolean;
  countInBars: number;
  loop: Loop | null;
  loopArmed: boolean;
  barCount: number;
  onPlayPause(): void;
  onTempoChange(tempo: number): void;
  onMetronomeToggle(): void;
  onCountInChange(bars: number): void;
  onLoopArmToggle(): void;
  onLoopBars(startBar: number, endBar: number): void;
}

export function PlayAlongTransport(props: PlayAlongTransportProps) {
  const { playing, tempo, metronome, countInBars, loop, loopArmed, barCount, onPlayPause } = props;

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key !== ' ' || event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      // Space on a focused button or text field is that control's own key.
      if (target?.closest('input, textarea, select, button, [contenteditable="true"]')) return;
      event.preventDefault();
      onPlayPause();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onPlayPause]);

  return (
    <div className={styles.transport}>
      <Button tier="perform" aria-label={playing ? 'Pause' : 'Play'} onClick={onPlayPause}>
        {playing ? '⏸' : '▶'}
      </Button>
      <label className={styles.slider}>
        <span className={styles.caption}>Tempo</span>
        <input
          type="range"
          aria-label="Tempo"
          min={50}
          max={100}
          step={1}
          value={Math.round(tempo * 100)}
          onChange={(e) => props.onTempoChange(Number(e.target.value) / 100)}
        />
        <output>{Math.round(tempo * 100)}%</output>
      </label>
      <Button tier="perform" aria-label="Arm loop" aria-pressed={loopArmed} disabled={!loop} onClick={props.onLoopArmToggle}>
        Loop
      </Button>
      <LoopBars loop={loop} barCount={barCount} onLoopBars={props.onLoopBars} />
      <Button tier="perform" aria-label="Metronome" aria-pressed={metronome} onClick={props.onMetronomeToggle}>
        Metronome
      </Button>
      <div className={styles.picker}>
        <span className={styles.caption}>Count-in</span>
        <Segmented
          label="Count-in"
          value={String(countInBars)}
          options={COUNT_IN.map((bars) => ({ value: String(bars), label: `${bars} ${bars === 1 ? 'bar' : 'bars'}` }))}
          onChange={(value) => props.onCountInChange(Number(value))}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Implement the screen**

```tsx
// frontend/src/screens/PlayAlong.tsx
// Play along (D-18): the practice screen. Song view is where a song is edited;
// this is where you play with it: a bass neck showing what to play in this bar
// and the next, a beat lane showing when, generated from the chord chart by a
// pattern you pick. It shares the song session (and so the engine) with Song
// view, so switching between them never stops the music.
//
// The patterns are arithmetic over detected chords: exact given the chords,
// but the chords are probabilistic (R-05). The banner says so, and every
// empty or substituted bar is labelled rather than guessed (N-08).
import { useMemo } from 'react';

import { patternSource } from '../music/tabSource';
import { BeatLane } from '../playalong/BeatLane';
import { ChordRibbon } from '../playalong/ChordRibbon';
import { Neck } from '../playalong/Neck';
import { NowReadout } from '../playalong/NowReadout';
import { PatternPanel } from '../playalong/PatternPanel';
import { PlayAlongTransport } from '../playalong/PlayAlongTransport';
import styles from '../playalong/PlayAlong.module.css';
import { useSongSession } from '../session/SongSession';
import { Banner, ButtonLink, EmptyState, Panel } from '../ui';

export function PlayAlong() {
  const session = useSongSession();
  const {
    songId,
    entry,
    isPending,
    loadError,
    fetchedSong,
    hasStems,
    analysis,
    analysisError,
    notAnalyzedYet,
    grid,
    song,
    engine,
    engineError,
    saveError,
    playing,
    loopArmed,
    seekNonce,
    getPosition,
  } = session;

  const loopStart = song?.active_loop?.start_bar ?? null;
  const loopEnd = song?.active_loop?.end_bar ?? null;
  const armedLoop = useMemo(
    () => (loopArmed && loopStart !== null && loopEnd !== null ? { startBar: loopStart, endBar: loopEnd } : null),
    [loopArmed, loopStart, loopEnd],
  );

  const result = useMemo(
    () => (song && analysis && grid ? patternSource.barsFor({ song, analysis, grid, loop: armedLoop }) : null),
    [song, analysis, grid, armedLoop],
  );

  const title = song?.title ?? fetchedSong?.title ?? songId;
  const header = (
    <header className={styles.header}>
      <ButtonLink variant="ghost" to={`/songs/${songId}`}>
        &larr; Song view
      </ButtonLink>
      <div className={styles.titles}>
        <h1>{title}</h1>
        <p className={styles.sub}>Play along · bass</p>
      </div>
    </header>
  );

  if (isPending) return <p className={styles.sub}>Loading song&hellip;</p>;
  if (loadError !== null) return <Banner tone="error" trace={String(loadError)} />;
  if (entry?.unreadable) return <Banner tone="error" title={songId} trace={entry.unreadable} />;
  if (!hasStems) {
    return (
      <section className={styles.page}>
        {header}
        <EmptyState title="This song has not been separated yet">Play along needs its four stems.</EmptyState>
      </section>
    );
  }
  if (notAnalyzedYet) {
    return (
      <section className={styles.page}>
        {header}
        <EmptyState title="This song needs analysis">
          Play along builds its patterns from the chord chart and the beat grid, which appear after analysis.
        </EmptyState>
      </section>
    );
  }

  return (
    <section className={styles.page}>
      {header}

      {engineError && <Banner tone="error" trace={engineError} />}
      {saveError && <Banner tone="error" trace={saveError.message} />}
      {analysisError !== null && <Banner tone="error" trace={String(analysisError)} />}
      {analysis && !grid && (
        <Banner tone="error" title="The beat grid is unusable">
          The analysis found fewer than two downbeats, so there are no bars to play along to.
        </Banner>
      )}
      {result && !result.ok && <Banner tone="error" title="No patterns" trace={result.error} />}
      {!engine && !engineError && <p className={styles.sub}>Loading stems&hellip;</p>}

      {engine && song && grid && result?.ok && (
        <>
          <Panel className={styles.panel}>
            <PlayAlongTransport
              playing={playing}
              tempo={song.playback.tempo}
              metronome={song.metronome}
              countInBars={song.count_in_bars}
              loop={song.active_loop}
              loopArmed={loopArmed}
              barCount={result.bars.length}
              onPlayPause={session.onPlayPause}
              onTempoChange={session.onTempoChange}
              onMetronomeToggle={session.onMetronomeToggle}
              onCountInChange={session.onCountInChange}
              onLoopArmToggle={session.onLoopArmToggle}
              onLoopBars={session.onLoopBars}
            />
          </Panel>

          <Panel className={styles.panel}>
            <PatternPanel
              candidates={analysis?.key_candidates ?? []}
              value={song.play_along}
              onChange={session.onPlayAlongChange}
            />
          </Panel>

          <Panel className={styles.panel}>
            <NowReadout
              bars={result.bars}
              nextOf={result.nextOf}
              songKey={result.key}
              grid={grid}
              pitchSemitones={song.playback.pitch_semitones}
              getPosition={getPosition}
              playing={playing}
              seekNonce={seekNonce}
            />
            <div className={styles.board}>
              <Neck
                bars={result.bars}
                nextOf={result.nextOf}
                songKey={result.key}
                grid={grid}
                getPosition={getPosition}
                playing={playing}
                seekNonce={seekNonce}
              />
              <BeatLane
                bars={result.bars}
                nextOf={result.nextOf}
                songKey={result.key}
                grid={grid}
                getPosition={getPosition}
                playing={playing}
                seekNonce={seekNonce}
              />
            </div>
            <ChordRibbon
              bars={result.bars}
              songKey={result.key}
              loop={song.active_loop}
              grid={grid}
              getPosition={getPosition}
              playing={playing}
              seekNonce={seekNonce}
              onLoopBars={session.onLoopBars}
            />
          </Panel>

          <Banner tone="warn" role="note" title="A practice pattern over the detected chords, not a transcription">
            These notes are generated from the chord chart and the key you pick. The arithmetic is exact, but the chords
            themselves are detected and can be wrong. A bar with no chord shows an empty neck saying so; nothing is
            guessed.
          </Banner>
        </>
      )}
    </section>
  );
}
```

Append to `PlayAlong.module.css`:

```css
.page {
  display: flex;
  flex-direction: column;
  gap: var(--ds-4);
  min-width: 0;
}

.header {
  display: flex;
  align-items: center;
  gap: var(--ds-4);
}

.titles h1 {
  margin: 0;
  font: 600 var(--ds-t-xl) / var(--ds-lh-xl) var(--ds-font);
}

.sub {
  margin: 0;
  color: var(--ds-text-2);
  font-size: var(--ds-t-sm);
}

.panel {
  display: flex;
  flex-direction: column;
  gap: var(--ds-4);
  padding: var(--ds-5);
}

.transport {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: var(--ds-5);
}

.slider {
  display: flex;
  flex-direction: column;
  gap: var(--ds-1);
  min-width: 180px;
}

.slider output {
  font: 600 var(--ds-t-sm) / 1 var(--ds-mono);
  color: var(--ds-text-2);
}

.now {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: var(--ds-3);
}

.bigBar {
  font: 600 var(--ds-t-display) / 1 var(--ds-mono);
  font-variant-numeric: tabular-nums;
}

.beat {
  font: 600 var(--ds-t-sm) / 1 var(--ds-font);
  color: var(--ds-text-3);
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.chordNow {
  margin-left: var(--ds-5);
  font: 700 var(--ds-t-display) / var(--ds-lh-display) var(--ds-font);
  color: var(--ds-bass);
}

.arrow {
  color: var(--ds-text-3);
  font-size: var(--ds-t-lg);
}

.chordNext {
  font: 600 var(--ds-t-xl) / 1 var(--ds-font);
  color: var(--ds-text-2);
}

.substitution,
.pitchNote {
  border: 1px solid var(--ds-border-strong);
  border-radius: var(--ds-r-pill);
  padding: 2px var(--ds-3);
  font-size: var(--ds-t-sm);
  color: var(--ds-text-2);
}

.substitution {
  border-color: var(--ds-warn);
  color: var(--ds-warn);
}

.pitchNote {
  margin-left: auto;
}
```

- [ ] **Step 5: Route it and link it from Song view**

In `frontend/src/app/routes.tsx`, add `import { PlayAlong } from '../screens/PlayAlong';` and add the child route inside the `SongScope` route from Task 6:

```tsx
          <Route path="songs/:songId" element={<SongScope />}>
            <Route index element={<SongView />} />
            <Route path="play" element={<PlayAlong />} />
          </Route>
```

In `frontend/src/screens/SongView.tsx`'s header, directly before the Export link, add:

```tsx
          <Link className={styles.link} to={`/songs/${songId}/play`}>
            Play along
          </Link>
```

- [ ] **Step 6: Run the screen test and the whole suite**

Run: `npm --prefix frontend run typecheck && npm --prefix frontend test -- --run`
Expected: all PASS.

- [ ] **Step 7: Check it in the real app**

Start the servers (see the `dev-setup` skill: the `api` and `frontend` configs in `.claude/launch.json`), open an analyzed song, click **Play along**, press Space, and confirm:
- the neck's blue dot moves beat by beat, the lane cursor sweeps, and the lane flips at each downbeat;
- switching to Song view and back does not stop the audio;
- changing Notes, Rhythm and Approach redraws immediately, and survives a reload;
- with pitch shifted −2 in Song view, the chord names and the neck move down a tone and the pitch chip appears;
- setting a loop 5 to 8 with an approach on shows the approach into bar 5 on bar 8.

Compare against the mockup (`design/ui/dist/screens/play-along.html`). Fix anything that differs from the spec, not from the mockup's placeholder data.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/playalong/NowReadout.tsx frontend/src/playalong/PlayAlongTransport.tsx frontend/src/playalong/PlayAlong.module.css frontend/src/screens/PlayAlong.tsx frontend/src/screens/PlayAlong.test.tsx frontend/src/app/routes.tsx frontend/src/screens/SongView.tsx
git commit -m "feat(ui): Play along screen, bass patterns on a live neck (D-18)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: README upkeep, screenshot, push

**Files:**
- Modify: `README.md`
- Create: `docs/screenshots/play-along.png`

- [ ] **Step 1: Update the feature list**

In `README.md`, after the bullet "Beat, key and chord analysis, plus a fretboard view", add:

```markdown
- Play along screen for bass: a live neck shows what to play in the current and the next
  bar, with a beat lane underneath showing when. The notes are generated from the chord
  chart by a pattern you pick (root, root–5th, octave, chord or diatonic triad, 7th; whole
  to eighth notes; optional chromatic, scale or fifth approach into the next bar), in the
  detected key or another candidate, and follow the pitch shift. Loop by bar numbers or
  from the chord ribbon; playback carries on when you switch back to the Song view
```

Under `## Screens`, after the Song view image, add:

```markdown
![Play along](docs/screenshots/play-along.png)
```

- [ ] **Step 2: Capture the screenshot**

With the API and the Vite dev server running and an analyzed song in the library:

```bash
node scripts/capture-screens.mjs play-along=/songs/<id>/play
```

Replace `<id>` with a real song id (`curl -s localhost:8000/api/songs | head` lists them). Confirm `docs/screenshots/play-along.png` shows the neck with notes on it. If the capture happens before playback, the neck shows bar 1, which is fine.

- [ ] **Step 3: Final verification**

Run:

```bash
uv run pytest -q && uv run ruff check packages ops && npm --prefix frontend run build && npm --prefix frontend test -- --run
```

Expected: all pass, build succeeds.

- [ ] **Step 4: Commit and push**

```bash
git add README.md docs/screenshots/play-along.png
git commit -m "docs: README covers the Play along screen

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push origin main
```

---

## Self-review notes

- **Spec coverage:** separate screen and route (T12); live neck with numbering, hot note and hollow next bar (T8); beat lane (T9); three independent pickers plus key, top candidate by default (T10); `song.json` v3 additive migration (T1); chord parsing incl. slash, N/X/unparsed (T2); patterns, rhythm slots, 3/4, fallbacks with substitution text, approach incl. loop wrap (T3, T5); fingering Viterbi, deterministic, frets 0–12 (T4); transposition (T3, T5); playback across screens via `SongScope` (T6); loop by bar numbers with inclusive display and exclusive storage (T7, T11); empty and failure states (T12); banner (T12); README and screenshot (T13).
- **Deliberate narrowing:** PatternPanel labels key candidates as detected, not transposed; the transposed key shows in the chord and note names. Space is the only Play along keyboard shortcut. Song view's A/B/L/M keys belong to its Transport.
