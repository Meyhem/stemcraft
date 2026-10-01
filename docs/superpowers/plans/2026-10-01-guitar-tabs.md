# Guitar Tabs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Bass | Guitar switch in the Tabs view. In Guitar mode, each bar's chord is shown as a voicing on a 6-string neck, with a strum lane underneath, generated from the chord chart.

**Architecture:**
- A second `TabSource`, `guitarSource`, sits beside the bass `patternSource`.
- It parses each bar's chord as the bass path does, optionally simplifies it to a triad, and collects every shape the chosen style allows (`guitarShapes.ts`).
- It picks one shape per bar with a Viterbi pass that keeps the hand still, and adds a strum (`strums.ts`).
- The screen chooses source and painters by `song.play_along.instrument`.
- The readout and the chord ribbon read a shared `BarSummary`, so they don't branch on instrument.
- `song.json` goes to v4 (additive).

**Tech Stack:** React 19 + TypeScript, Vitest + Testing Library, tonal 6.4.3 (behind `music/spell.ts`), canvas painters; Python 3.12, pydantic, pytest, ruff.

**Spec:** `docs/superpowers/specs/2026-10-01-guitar-tabs-design.md`
**Mockup:** `design/ui/src/pages/screens/play-along-guitar.html`

## Deviations from the spec (decided while planning; each is cheaper and changes no behaviour)

- **`TabSource` is generic** (`TabSource<Bar>`, `TabResult<Bar>`), not a union on
  `instrument`. A union made every bass caller narrow a type it already knew.
  `PlayAlong.tsx` picks the source from `song.play_along.instrument`.
- **Separate components.** Guitar uses its own `GuitarNeck` and `StrumLane` components
  instead of `Neck` and `BeatLane` dispatching on instrument. The painters are separate
  either way, and the bass components stay untouched.
- **Barre rule.** A barre counts only when more than four strings are fretted (more
  notes than fingers). D (`xx0232`) has two notes at fret 2, but it is fingered, not
  barred.
- **Open and barre candidates come from their own enumerator** in `guitarShapes.ts`,
  using `isPlayable`. `guitarVoicings()` keeps only one shape per fret, which drops
  `xx0232` in favour of `x54232` and `x02220` in favour of `542225`.
  `guitarVoicings()` itself is unchanged.
- **Chord names use the existing Tabs convention** (`chordText`): `Emin7`, `Cmaj7`,
  `D7`. So the Simplify chip reads "Emin7 → Em", not "Em7 → Em".
- **A triad over a 7th chord** adds the substitution "C7 as a C triad", in the same
  N-08 spirit as the other fallbacks.

## Global Constraints

- The API never imports torch. The API is the only writer of `song.json`; guitar settings go through the existing `PUT /api/songs/{id}`.
- Stems are immutable; the guitar settings are recipe values in `song.json` (schema **v4**, additive from v3: stamp the version, let pydantic defaults fill `instrument` and `guitar`).
- Nothing derived is stored: shapes, strokes and substitutions are recomputed in the browser on every change.
- No waveform or neck renderer plays audio (D-07). Canvases paint from the engine clock via `usePlayhead`, never from React state at audio rate (U-05).
- Fail loudly (N-08): every fallback is a visible substitution, unknown enum values are rejected (pydantic `Literal`, `StrictBool`), never coerced.
- Guitar is fixed at standard tuning EADGBE, frets 0–12. Pitch shift transposes chords before shapes are chosen.
- Defaults: `instrument: "bass"`, `style: "open"`, `strum: "folk"`, `position: "auto"`, `simplify: false`.
- Selected segments are accent (U-01); guitar shapes and strokes use `--ds-other` (guitar lives in the other stem).
- Work on `main`. Commit after each task. Push only at the end of Task 10, after README upkeep (CLAUDE.md).
- Test commands, from the repo root:
  - `uv run pytest -q -p no:warnings`
  - `uv run ruff check packages ops`
  - `npm --prefix frontend test -- --run`
  - `npm --prefix frontend run typecheck`

## File map

| File | Change |
|---|---|
| `packages/stemcraft_lib/src/stemcraft_lib/song.py` | v4: `PlayAlongGuitar`, `PlayAlong.instrument/guitar`, v3→v4 migration |
| `packages/stemcraft_lib/tests/test_song.py`, `packages/stemcraft_api/tests/test_songs_update.py` | v4 tests |
| `frontend/src/api/client.ts` | `GuitarStyle`, `GuitarStrum`, `GuitarPosition`, `PlayAlongGuitar`, `PlayAlong`, `DEFAULT_PLAY_ALONG` |
| `frontend/src/music/chordTones.ts` | `withQuality` |
| `frontend/src/music/patterns.ts` | `tonesText` |
| `frontend/src/music/guitarChords.ts` (+test) | new: `simplify`, `guitarChord` |
| `frontend/src/music/guitarShapes.ts` (+test) | new: shapes per style, `barreOf`, `degreesOf` |
| `frontend/src/music/strums.ts` (+test) | new: `strumStrokes`, `withoutDownbeat` |
| `frontend/src/music/tabSource.ts` | generic `TabSource<Bar>`, export `nextBarOf`, `BarSummary`, `bassSummaries`, `chordText` via `tonesText` |
| `frontend/src/music/guitarSource.ts` (+test) | new: `guitarSource`, `GuitarBar`, helpers, `guitarSummaries` |
| `frontend/src/playalong/NowReadout.tsx`, `ChordRibbon.tsx` (+test) | read `BarSummary[]` |
| `frontend/src/playalong/colors.ts` | `other` colour |
| `frontend/src/playalong/guitarNeckPainter.ts`, `strumLanePainter.ts` (+tests) | new painters |
| `frontend/src/ui/Segmented.tsx` (+css, test) | `disabled` |
| `frontend/src/playalong/PatternPanel.tsx` (+test), `PlayAlong.module.css` | instrument switch, guitar rows |
| `frontend/src/playalong/GuitarNeck.tsx`, `StrumLane.tsx` | new components |
| `frontend/src/screens/PlayAlong.tsx` (+test) | picks source, painters, banners |
| `design/*`, `docs/superpowers/specs/2026-09-29-play-along-design.md`, `README.md`, `docs/screenshots/` | decisions, docs, screenshot |

---

### Task 1: `song.json` v4, guitar settings in the recipe

**Files:**
- Modify: `packages/stemcraft_lib/src/stemcraft_lib/song.py`
- Modify: `packages/stemcraft_lib/tests/test_song.py`
- Modify: `packages/stemcraft_api/tests/test_songs_update.py`
- Modify: `frontend/src/api/client.ts`
- Modify (fixtures): `frontend/src/music/tabSource.test.ts`, `frontend/src/screens/SongScreen.test.tsx`, `frontend/src/screens/PlayAlong.test.tsx`, `frontend/src/session/SongScope.test.tsx`

**Interfaces:**
- Produces (Python): `stemcraft_lib.song.PlayAlongGuitar(style, strum, position, simplify)`; `PlayAlong.instrument: Literal["bass","guitar"]`; `PlayAlong.guitar: PlayAlongGuitar`; `SCHEMA_VERSION = 4`.
- Produces (TS, `api/client.ts`): `GuitarStyle = 'open'|'barre'|'power'|'triad'`, `GuitarStrum = 'whole'|'half'|'quarters'|'eighths'|'folk'|'push'`, `GuitarPosition = 'auto'|'low'|'mid'`, `interface PlayAlongGuitar { style; strum; position; simplify: boolean }`, `PlayAlong.instrument: 'bass'|'guitar'`, `PlayAlong.guitar: PlayAlongGuitar`, and `DEFAULT_PLAY_ALONG` with both.

- [ ] **Step 1: Write the failing Python tests**

In `packages/stemcraft_lib/tests/test_song.py`, add `PlayAlong`, `PlayAlongGuitar` and `PlayAlongKey` to the `from stemcraft_lib.song import (...)` list (alphabetical, after `Loop`). Then make three edits:
- In `test_new_song_defaults_play_along_to_top_key_and_quarter_triads`, change `assert song.schema_version == 3` to `== 4`.
- Rename `test_a_v2_song_migrates_to_v3_with_default_play_along` to `test_a_v2_song_migrates_forward_with_default_play_along`.
- In that test, change `assert song.schema_version == 3` to `== 4`.

Append:

```python
def test_new_song_opens_tabs_on_bass_with_open_chords_ready_for_guitar():
    song = new_song(title="T", artist="", source_kind="upload", source_value="original.mp3")
    assert song.play_along.instrument == "bass"
    assert song.play_along.guitar.style == "open"
    assert song.play_along.guitar.strum == "folk"
    assert song.play_along.guitar.position == "auto"
    assert song.play_along.guitar.simplify is False


def test_a_v3_song_migrates_to_v4_keeping_its_bass_pattern(tmp_path):
    song_dir = tmp_path / "song"
    song_dir.mkdir()
    (song_dir / "song.json").write_text(
        json.dumps(
            {
                "schema_version": 3,
                "id": "abc123",
                "title": "V3 Song",
                "artist": "",
                "source": {"kind": "upload", "value": "original.mp3"},
                "created_at": "2026-09-01T00:00:00+00:00",
                "play_along": {
                    "key": {"tonic": "D", "mode": "minor"},
                    "pattern": {"notes": "root_fifth", "rhythm": "eighth", "approach": "scale"},
                },
            }
        )
    )

    song = read_song(song_dir)
    assert song.schema_version == 4
    assert song.play_along.key == PlayAlongKey(tonic="D", mode="minor")
    assert song.play_along.pattern.notes == "root_fifth"
    assert song.play_along.instrument == "bass"
    assert song.play_along.guitar == PlayAlongGuitar()


def test_guitar_settings_round_trip_through_disk(tmp_path):
    song = new_song(title="T", artist="", source_kind="upload", source_value="original.mp3")
    song.play_along.instrument = "guitar"
    song.play_along.guitar = PlayAlongGuitar(
        style="barre", strum="push", position="mid", simplify=True
    )
    song_dir = tmp_path / "song"
    song_dir.mkdir()
    write_song(song_dir, song)
    assert read_song(song_dir).play_along == song.play_along


def test_guitar_settings_reject_unknown_values_and_coerced_booleans():
    from pydantic import ValidationError

    with pytest.raises(ValidationError):
        PlayAlongGuitar(style="jazz")
    with pytest.raises(ValidationError):
        PlayAlongGuitar(strum="reggae")
    with pytest.raises(ValidationError):
        PlayAlongGuitar(position="high")
    with pytest.raises(ValidationError):
        PlayAlongGuitar(simplify="yes")
    with pytest.raises(ValidationError):
        PlayAlong(instrument="drums")
```

In `packages/stemcraft_api/tests/test_songs_update.py`, replace the body of `test_put_round_trips_play_along` with this:

```python
def test_put_round_trips_play_along(client: TestClient):
    song = _create(client)
    assert song["play_along"] == {
        "key": None,
        "instrument": "bass",
        "pattern": {"notes": "triad_chord", "rhythm": "quarter", "approach": "none"},
        "guitar": {"style": "open", "strum": "folk", "position": "auto", "simplify": False},
    }
    song["play_along"] = {
        "key": {"tonic": "G", "mode": "major"},
        "instrument": "guitar",
        "pattern": {"notes": "octave_pump", "rhythm": "eighth", "approach": "fifth"},
        "guitar": {"style": "barre", "strum": "push", "position": "low", "simplify": True},
    }
    response = client.put(f"/api/songs/{song['id']}", json=song)
    assert response.status_code == 200
    reread = client.get(f"/api/songs/{song['id']}").json()["song"]
    assert reread["play_along"] == song["play_along"]
```

and append:

```python
def test_put_rejects_an_unknown_guitar_style(client: TestClient):
    song = _create(client)
    song["play_along"]["guitar"]["style"] = "jazz"
    response = client.put(f"/api/songs/{song['id']}", json=song)
    assert response.status_code == 422
```

- [ ] **Step 2: Run them to verify they fail**

Run: `uv run pytest -q -p no:warnings packages/stemcraft_lib/tests/test_song.py packages/stemcraft_api/tests/test_songs_update.py`
Expected: FAIL (`ImportError: cannot import name 'PlayAlongGuitar'`).

- [ ] **Step 3: Implement v4 in `song.py`**

Change `from pydantic import BaseModel, Field, ValidationError` to `from pydantic import BaseModel, Field, StrictBool, ValidationError`, and `SCHEMA_VERSION = 3` to `SCHEMA_VERSION = 4`. Replace the `class PlayAlong(BaseModel):` block with:

```python
class PlayAlongGuitar(BaseModel):
    """v4 (D-20). The guitar Tabs' choices: which shapes, which strum, where on
    the neck, and whether 7ths and 6ths are reduced to triads."""

    style: Literal["open", "barre", "power", "triad"] = "open"
    strum: Literal["whole", "half", "quarters", "eighths", "folk", "push"] = "folk"
    position: Literal["auto", "low", "mid"] = "auto"
    # Strict: a "yes" or a 1 from a hand-edited file is an error, not a coercion.
    simplify: StrictBool = False


class PlayAlong(BaseModel):
    """v3 (D-18), v4 (D-20). The Tabs recipe: which key to think in (None =
    the analysis's top candidate), which instrument is shown, and each
    instrument's own choices. Only the choices are stored; notes, shapes and
    fret positions are derived in the browser on every change."""

    key: PlayAlongKey | None = None
    instrument: Literal["bass", "guitar"] = "bass"
    pattern: PlayAlongPattern = Field(default_factory=PlayAlongPattern)
    guitar: PlayAlongGuitar = Field(default_factory=PlayAlongGuitar)
```

In `_migrate`, directly after the `if version == 2:` block (which ends `version = 3`), add:

```python
    if version == 3:
        # v3 -> v4 (D-20) is additive again: play_along.instrument and
        # play_along.guitar take their defaults, so a song opens on bass as before.
        raw = {**raw, "schema_version": 4}
        version = 4
```

- [ ] **Step 4: Run the Python tests and ruff**

Run: `uv run pytest -q -p no:warnings && uv run ruff check packages ops`
Expected: all pass; `All checks passed!`

- [ ] **Step 5: Mirror the types in `frontend/src/api/client.ts`**

Replace `export interface PlayAlong { ... }` and `DEFAULT_PLAY_ALONG` with:

```ts
// v4 (D-20): the guitar choices, next to the bass pattern.
export type GuitarStyle = 'open' | 'barre' | 'power' | 'triad';
export type GuitarStrum = 'whole' | 'half' | 'quarters' | 'eighths' | 'folk' | 'push';
export type GuitarPosition = 'auto' | 'low' | 'mid';

export interface PlayAlongGuitar {
  style: GuitarStyle;
  strum: GuitarStrum;
  position: GuitarPosition;
  simplify: boolean;
}

export interface PlayAlong {
  /** null = the analysis's top key candidate. */
  key: PlayAlongKey | null;
  instrument: 'bass' | 'guitar';
  /** The bass pattern. */
  pattern: PlayAlongPattern;
  guitar: PlayAlongGuitar;
}

/** The server's defaults, for fixtures and for code that builds a Song by hand. */
export const DEFAULT_PLAY_ALONG: PlayAlong = {
  key: null,
  instrument: 'bass',
  pattern: { notes: 'triad_chord', rhythm: 'quarter', approach: 'none' },
  guitar: { style: 'open', strum: 'folk', position: 'auto', simplify: false },
};
```

Change the comment above `play_along: PlayAlong;` in `interface Song` to `// v3 (D-18), v4 (D-20): the Tabs recipe.`

- [ ] **Step 6: Bring the hand-written fixtures to v4**

These four test files spell out `play_along` by hand. Update each:
- In `screens/SongScreen.test.tsx`, `screens/PlayAlong.test.tsx` and `session/SongScope.test.tsx`, replace
  `play_along: { key: null, pattern: { notes: 'triad_chord', rhythm: 'quarter', approach: 'none' } },`
  with the block below, and change `schema_version: 3` to `schema_version: 4`:

```ts
    play_along: {
      key: null,
      instrument: 'bass',
      pattern: { notes: 'triad_chord', rhythm: 'quarter', approach: 'none' },
      guitar: { style: 'open', strum: 'folk', position: 'auto', simplify: false },
    },
```

- In `music/tabSource.test.ts`, change
  `play_along: { key: null, pattern: { notes: 'triad_chord', rhythm: 'quarter', approach: 'chromatic' } },`
  to
  `play_along: { ...DEFAULT_PLAY_ALONG, pattern: { notes: 'triad_chord', rhythm: 'quarter', approach: 'chromatic' } },`

- [ ] **Step 7: Typecheck and run the frontend tests**

Run: `npm --prefix frontend run typecheck && npm --prefix frontend test -- --run`
Expected: no type errors; all tests pass.

- [ ] **Step 8: Commit**

```bash
git add packages/stemcraft_lib packages/stemcraft_api/tests/test_songs_update.py frontend/src/api/client.ts frontend/src/music/tabSource.test.ts frontend/src/screens/SongScreen.test.tsx frontend/src/screens/PlayAlong.test.tsx frontend/src/session/SongScope.test.tsx
git commit -m "feat(song): song.json v4, guitar Tabs settings beside the bass pattern (D-20)"
```

---

### Task 2: Guitar chords: simplify and read into `ChordInfo`

**Files:**
- Modify: `frontend/src/music/chordTones.ts` (append `withQuality`)
- Modify: `frontend/src/music/patterns.ts` (add `tonesText`)
- Modify: `frontend/src/music/tabSource.ts` (`chordText` uses `tonesText`)
- Create: `frontend/src/music/guitarChords.ts`
- Test: `frontend/src/music/guitarChords.test.ts`

**Interfaces:**
- Consumes: `parseChord(label, transpose): ParsedChord` and `ChordTones` (`chordTones.ts`); `spell(pc, key)`, `ResolvedKey` (`patterns.ts`); `chordInfo(text): ChordResult`, `ChordInfo` (`spell.ts`).
- Produces:
  - `withQuality(tones: ChordTones, quality: string): ChordTones` (throws on an unknown quality).
  - `tonesText(tones: ChordTones, key: ResolvedKey): string`, e.g. "F♯m", "Emin7", "C/E".
  - `simplify(tones: ChordTones): ChordTones`.
  - `interface GuitarChord { tones: ChordTones; info: ChordInfo }`.
  - `type GuitarChordResult = { ok: true; chord: GuitarChord } | { ok: false; reason: string }`.
  - `guitarChord(tones: ChordTones, key: ResolvedKey): GuitarChordResult`.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/music/guitarChords.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { CHORD_QUALITIES, parseChord, type ChordTones } from './chordTones';
import { guitarChord, simplify } from './guitarChords';
import type { ResolvedKey } from './patterns';

const G_MAJOR: ResolvedKey = { tonicPc: 7, mode: 'major' };
const F_MAJOR: ResolvedKey = { tonicPc: 5, mode: 'major' };

function tones(label: string, transpose = 0): ChordTones {
  const parsed = parseChord(label, transpose);
  if (parsed.kind !== 'chord') throw new Error(`${label}: ${parsed.kind}`);
  return parsed.tones;
}

describe('simplify', () => {
  it.each([
    ['C:maj7', 'maj'], ['C:7', 'maj'], ['C:maj6', 'maj'],
    ['C:min7', 'min'], ['C:min6', 'min'], ['C:minmaj7', 'min'],
    ['C:hdim7', 'dim'], ['C:dim7', 'dim'],
    ['C', 'maj'], ['C:min', 'min'], ['C:dim', 'dim'], ['C:aug', 'aug'], ['C:sus2', 'sus2'], ['C:sus4', 'sus4'],
  ])('%s becomes %s', (label, quality) => {
    const t = simplify(tones(label));
    expect(t.quality).toBe(quality);
    expect(t.seventh).toBeNull();
    expect(t.rootPc).toBe(0);
  });

  it('keeps a slash bass', () => {
    expect(simplify(tones('C:maj7/3')).bassPc).toBe(4);
  });
});

describe('guitarChord', () => {
  it.each(CHORD_QUALITIES)('reads quality %s into a chord with the same pitch classes', (quality) => {
    const t = tones(`D:${quality}`);
    const read = guitarChord(t, G_MAJOR);
    if (!read.ok) throw new Error(read.reason);
    const expected = new Set([t.rootPc, (t.rootPc + t.third) % 12, (t.rootPc + t.fifth) % 12]);
    if (t.seventh !== null) expected.add((t.rootPc + t.seventh) % 12);
    for (const pc of expected) expect(read.chord.info.notes.map((n) => n.pc)).toContain(pc);
  });

  it('spells the root and slash bass for the key, transposed to what is heard', () => {
    const read = guitarChord(tones('A:min7', 1), F_MAJOR); // A + 1 = B♭
    if (!read.ok) throw new Error(read.reason);
    expect(read.chord.info.root).toBe('Bb');
    const slash = guitarChord(tones('C/3'), G_MAJOR);
    if (!slash.ok) throw new Error(slash.reason);
    expect(slash.chord.info.bass).toBe('E');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm --prefix frontend test -- --run src/music/guitarChords.test.ts`
Expected: FAIL, cannot resolve `./guitarChords`.

- [ ] **Step 3: Add `withQuality` and `tonesText`**

Append to `frontend/src/music/chordTones.ts`:

```ts
/** The same root and bass with another quality's intervals (Simplify, D-20). */
export function withQuality(tones: ChordTones, quality: string): ChordTones {
  const shape = SHAPES[quality];
  if (!shape) throw new Error(`unknown chord quality "${quality}"`);
  return { ...tones, ...shape, quality };
}
```

In `frontend/src/music/patterns.ts`, insert directly above `export function keyName`:

```ts
/** A chord as heard, e.g. "F♯m", "Emin7", "C/E": the root and slash note spelled for the key. */
export function tonesText(tones: ChordTones, key: ResolvedKey): string {
  const suffix = tones.quality === 'maj' ? '' : tones.quality === 'min' ? 'm' : tones.quality;
  const bass = tones.bassPc !== tones.rootPc ? `/${spell(tones.bassPc, key)}` : '';
  return `${spell(tones.rootPc, key)}${suffix}${bass}`;
}
```

In `frontend/src/music/tabSource.ts`:
- Change the import to `import { planBar, resolveKey, tonesText, type ResolvedKey } from './patterns';`. `spell` is no longer used there.
- Replace the last four lines of `chordText` (from `const tones = plan.tones!;` to the `return`) with `return tonesText(plan.tones!, key);`.

- [ ] **Step 4: Create `frontend/src/music/guitarChords.ts`**

```ts
// The guitar Tabs' chords (D-20): a bar's parsed chord, optionally reduced to
// its triad, read into the ChordInfo the voicing search (voicings.ts) takes.
// The BTC label is parsed once, by chordTones.parseChord, exactly as for bass;
// this only respells the result as a symbol tonal can read. A chord tonal
// cannot read is an error the bar shows, never a guess (N-08).
import { withQuality, type ChordTones } from './chordTones';
import { spell, type ResolvedKey } from './patterns';
import { chordInfo, type ChordInfo } from './spell';

/** Simplify: 7ths and 6ths become the triad under them. Everything else stays. */
const SIMPLER: Record<string, string> = {
  maj7: 'maj',
  '7': 'maj',
  maj6: 'maj',
  min7: 'min',
  min6: 'min',
  minmaj7: 'min',
  hdim7: 'dim',
  dim7: 'dim',
};

export function simplify(tones: ChordTones): ChordTones {
  const to = SIMPLER[tones.quality];
  return to ? withQuality(tones, to) : tones;
}

/** chordTones' quality names as tonal chord suffixes. */
const TONAL_SUFFIX: Record<string, string> = {
  maj: '',
  min: 'm',
  dim: 'dim',
  aug: 'aug',
  min6: 'm6',
  maj6: '6',
  min7: 'm7',
  minmaj7: 'mMaj7',
  maj7: 'maj7',
  '7': '7',
  dim7: 'dim7',
  hdim7: 'm7b5',
  sus2: 'sus2',
  sus4: 'sus4',
};

export interface GuitarChord {
  tones: ChordTones;
  info: ChordInfo;
}

export type GuitarChordResult = { ok: true; chord: GuitarChord } | { ok: false; reason: string };

export function guitarChord(tones: ChordTones, key: ResolvedKey): GuitarChordResult {
  const suffix = TONAL_SUFFIX[tones.quality];
  if (suffix === undefined) return { ok: false, reason: `no guitar spelling for chord quality "${tones.quality}"` };
  const bass = tones.bassPc !== tones.rootPc ? `/${spell(tones.bassPc, key)}` : '';
  const read = chordInfo(`${spell(tones.rootPc, key)}${suffix}${bass}`);
  return read.ok ? { ok: true, chord: { tones, info: read.chord } } : { ok: false, reason: read.reason };
}
```

- [ ] **Step 5: Run the music tests**

Run: `npm --prefix frontend test -- --run src/music`
Expected: PASS (the new 30 tests, and `tabSource.test.ts` unchanged).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/music/chordTones.ts frontend/src/music/patterns.ts frontend/src/music/tabSource.ts frontend/src/music/guitarChords.ts frontend/src/music/guitarChords.test.ts
git commit -m "feat(music): guitar chords, simplify to triads and read into ChordInfo (D-20)"
```

---

### Task 3: Guitar shapes per style

**Files:**
- Create: `frontend/src/music/guitarShapes.ts`
- Test: `frontend/src/music/guitarShapes.test.ts`

**Interfaces:**
- Consumes: `GuitarChord` (Task 2); `isPlayable(inst, chord, frets)`, `tabOf(frets)` (`voicings.ts`); `rowMidi(inst)` (`positions.ts`); `instrumentFor('guitar6', false)` (`tuning.ts`).
- Produces:
  - `type GuitarStyle`.
  - `GUITAR`, `GUITAR_OPEN: readonly number[]` (row 0 = high e), `GUITAR_MAX_FRET = 12`.
  - `interface Barre { fret; from; to }`.
  - `interface GuitarShape { frets: (number|null)[]; tab: string; barre: Barre|null; anchor: number; span: number; muted: number }`.
  - `barreOf(frets)`, `shapeOf(frets): GuitarShape`.
  - `shapesFor(style: GuitarStyle, chord: GuitarChord): GuitarShape[]`: sorted by anchor then tab, memoised.
  - `degreesOf(shape, tones): (string|null)[]`.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/music/guitarShapes.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { mod12, parseChord } from './chordTones';
import { guitarChord, type GuitarChord } from './guitarChords';
import { barreOf, degreesOf, GUITAR_OPEN, shapesFor, type GuitarShape } from './guitarShapes';
import type { ResolvedKey } from './patterns';

const KEY: ResolvedKey = { tonicPc: 7, mode: 'major' };

function chord(label: string): GuitarChord {
  const parsed = parseChord(label, 0);
  if (parsed.kind !== 'chord') throw new Error(label);
  const read = guitarChord(parsed.tones, KEY);
  if (!read.ok) throw new Error(read.reason);
  return read.chord;
}

const tabs = (shapes: GuitarShape[]) => shapes.map((s) => s.tab);
const pcsOf = (s: GuitarShape) =>
  new Set(s.frets.flatMap((f, row) => (f === null ? [] : [mod12(GUITAR_OPEN[row]! + f)])));
const lowestPc = (s: GuitarShape) => {
  const row = s.frets.reduce<number>((acc, f, r) => (f !== null ? r : acc), -1);
  return mod12(GUITAR_OPEN[row]! + s.frets[row]!);
};

describe('barreOf', () => {
  it('finds a flat finger across unbroken strings at the lowest fret', () => {
    expect(barreOf([1, 1, 2, 3, 3, 1])).toEqual({ fret: 1, from: 0, to: 5 }); // F, 133211
    expect(barreOf([3, 5, 5, 5, 3, null])).toEqual({ fret: 3, from: 0, to: 4 }); // C, x35553
  });

  it('is not a barre when four fingers are enough', () => {
    expect(barreOf([3, 0, 0, 0, 2, 3])).toBeNull(); // G, 320003
    expect(barreOf([2, 3, 2, 0, null, null])).toBeNull(); // D, xx0232
  });
});

describe('shapesFor open', () => {
  it('has the cowboy chords', () => {
    expect(tabs(shapesFor('open', chord('G')))).toContain('320003');
    expect(tabs(shapesFor('open', chord('C')))).toContain('x32010');
    expect(tabs(shapesFor('open', chord('D')))).toContain('xx0232');
    expect(tabs(shapesFor('open', chord('E:min')))).toContain('022000');
    expect(tabs(shapesFor('open', chord('A')))).toContain('x02220');
  });

  it('every open shape has an open string and nothing above fret 4', () => {
    for (const label of ['G', 'C', 'D', 'E:min', 'A:min', 'C:maj7', 'D:sus4']) {
      for (const s of shapesFor('open', chord(label))) {
        expect(s.frets).toContain(0);
        expect(Math.max(...s.frets.map((f) => f ?? 0))).toBeLessThanOrEqual(4);
      }
    }
  });

  it('has no open F', () => {
    expect(shapesFor('open', chord('F'))).toEqual([]);
  });
});

describe('shapesFor barre', () => {
  it('has the E and A shapes and nothing open', () => {
    expect(tabs(shapesFor('barre', chord('F')))).toContain('133211');
    expect(tabs(shapesFor('barre', chord('C')))).toContain('x35553');
    for (const s of shapesFor('barre', chord('B:min'))) {
      expect(s.frets).not.toContain(0);
      expect(s.barre).not.toBeNull();
      expect([4, 5]).toContain(s.barre!.to);
    }
  });
});

describe('shapesFor power', () => {
  it('is root, 5th and octave on low E or A', () => {
    expect(tabs(shapesFor('power', chord('G')))).toEqual(['355xxx', 'x-10-12-12-x-x']);
    expect(tabs(shapesFor('power', chord('E')))).toContain('022xxx');
    expect(tabs(shapesFor('power', chord('E:min')))).toContain('022xxx');
  });

  it('refuses a chord without a perfect 5th, or with a slash bass', () => {
    for (const label of ['B:dim', 'C:aug', 'B:hdim7', 'B:dim7', 'C/3']) expect(shapesFor('power', chord(label))).toEqual([]);
  });
});

describe('shapesFor triad', () => {
  it('plays exactly the three triad notes on three adjacent strings of the top four', () => {
    const c = chord('C');
    const shapes = shapesFor('triad', c);
    expect(shapes.length).toBeGreaterThan(4);
    for (const s of shapes) {
      const sounding = s.frets.flatMap((f, row) => (f === null ? [] : [row]));
      expect(sounding).toHaveLength(3);
      expect(sounding[2]! - sounding[0]!).toBe(2);
      expect(sounding[2]).toBeLessThanOrEqual(3);
      expect(pcsOf(s)).toEqual(new Set([0, 4, 7]));
      const frets = s.frets.filter((f): f is number => f !== null);
      expect(Math.max(...frets) - Math.min(...frets)).toBeLessThanOrEqual(3);
    }
  });

  it('keeps a slash bass lowest', () => {
    const shapes = shapesFor('triad', chord('C/3'));
    expect(shapes.length).toBeGreaterThan(0);
    for (const s of shapes) expect(lowestPc(s)).toBe(4);
  });

  it('is in order up the neck, the same every time', () => {
    const a = tabs(shapesFor('triad', chord('G')));
    expect(a).toEqual(tabs(shapesFor('triad', chord('G'))));
    const anchors = shapesFor('triad', chord('G')).map((s) => s.anchor);
    expect(anchors).toEqual([...anchors].sort((x, y) => x - y));
  });
});

describe('degreesOf', () => {
  it('labels each string with its chord degree', () => {
    const g = shapesFor('open', chord('G')).find((s) => s.tab === '320003')!;
    expect(degreesOf(g, chord('G').tones)).toEqual(['R', '3', 'R', '5', '3', 'R']);
    const em = shapesFor('open', chord('E:min')).find((s) => s.tab === '022000')!;
    expect(degreesOf(em, chord('E:min').tones)).toEqual(['R', '5', '♭3', 'R', '5', 'R']);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm --prefix frontend test -- --run src/music/guitarShapes.test.ts`
Expected: FAIL, cannot resolve `./guitarShapes`.

- [ ] **Step 3: Create `frontend/src/music/guitarShapes.ts`**

```ts
// Where the guitar Tabs' chords are held (D-20): every shape a style allows for
// a chord, on a 6-string guitar in standard tuning, frets 0-12. Open and barre
// shapes are full chords and pass voicings.ts's isPlayable; power chords and
// triads cannot (they are 2-3 strings), so they are generated here with their
// own rules. Which shape each bar gets is guitarSource's choice, not this
// module's. Rows are indexed as voicings.ts indexes them: row 0 = high e.
import { mod12, type ChordTones } from './chordTones';
import type { GuitarChord } from './guitarChords';
import { rowMidi } from './positions';
import { instrumentFor } from './tuning';
import { isPlayable, tabOf } from './voicings';

export type GuitarStyle = 'open' | 'barre' | 'power' | 'triad';

export const GUITAR = instrumentFor('guitar6', false);
/** MIDI of the open strings, row 0 = high e, row 5 = low E. */
export const GUITAR_OPEN: readonly number[] = rowMidi(GUITAR);
export const GUITAR_MAX_FRET = 12;
const LOW_E = 5;
const A_STRING = 4;

/** A finger laid flat across rows `from`..`to` (from ≤ to) at `fret`. */
export interface Barre {
  fret: number;
  from: number;
  to: number;
}

export interface GuitarShape {
  /** Fret per row (row 0 = high e); null = muted, 0 = open. */
  frets: (number | null)[];
  /** "320003": low string first, as voicings.ts writes it. */
  tab: string;
  barre: Barre | null;
  /** Lowest fretted fret, 0 if nothing is fretted. Where the hand sits. */
  anchor: number;
  /** Highest fretted fret minus the anchor. */
  span: number;
  muted: number;
}

/**
 * The barre in a fretting: only when more strings are fretted than there are
 * fingers, a flat first finger across every row at the lowest fret, with
 * nothing open or muted between its ends. D (xx0232) has two strings at fret 2
 * but three fretted notes, so it is fingered, not barred.
 */
export function barreOf(frets: readonly (number | null)[]): Barre | null {
  const fretted = frets.flatMap((f, row) => (f !== null && f > 0 ? [{ f, row }] : []));
  if (fretted.length <= 4) return null;
  const min = Math.min(...fretted.map((x) => x.f));
  const rows = fretted.filter((x) => x.f === min).map((x) => x.row);
  if (rows.length < 2) return null;
  const from = Math.min(...rows);
  const to = Math.max(...rows);
  if (frets.slice(from, to + 1).some((f) => f === null || f === 0)) return null;
  return { fret: min, from, to };
}

export function shapeOf(frets: readonly (number | null)[]): GuitarShape {
  const fretted = frets.filter((f): f is number => f !== null && f > 0);
  const anchor = fretted.length ? Math.min(...fretted) : 0;
  return {
    frets: [...frets],
    tab: tabOf(frets),
    barre: barreOf(frets),
    anchor,
    span: fretted.length ? Math.max(...fretted) - anchor : 0,
    muted: frets.filter((f) => f === null).length,
  };
}

const lowestRow = (s: GuitarShape) => s.frets.reduce<number>((acc, f, row) => (f !== null ? row : acc), -1);

/**
 * Every fretting isPlayable accepts: one unbroken run of 4-6 strings, each
 * open or within a 4-fret window. Unlike guitarVoicings (one best shape per
 * fret, for the Theory cards) this keeps them all, so xx0232 survives next to
 * x54232 and the styles below have something to choose from.
 */
function playableShapes(chord: GuitarChord): GuitarShape[] {
  const tones = new Set(chord.info.notes.map((n) => n.pc));
  if (chord.info.extraBass) tones.add(chord.info.extraBass.pc);
  const seen = new Map<string, GuitarShape>();
  for (let lo = 1; lo <= GUITAR_MAX_FRET; lo++) {
    const hi = Math.min(lo + 3, GUITAR_MAX_FRET);
    const options = GUITAR_OPEN.map((open) => {
      const opts: number[] = tones.has(mod12(open)) ? [0] : [];
      for (let f = lo; f <= hi; f++) if (tones.has(mod12(open + f))) opts.push(f);
      return opts;
    });
    for (let top = 0; top < GUITAR_OPEN.length; top++) {
      for (let bottom = top + 3; bottom < GUITAR_OPEN.length; bottom++) {
        const frets: (number | null)[] = GUITAR_OPEN.map(() => null);
        const walk = (row: number) => {
          if (row > bottom) {
            if (isPlayable(GUITAR, chord.info, frets)) {
              const shape = shapeOf(frets);
              if (!seen.has(shape.tab)) seen.set(shape.tab, shape);
            }
            return;
          }
          for (const f of options[row]!) {
            frets[row] = f;
            walk(row + 1);
          }
          frets[row] = null;
        };
        walk(top);
      }
    }
  }
  return [...seen.values()];
}

/** Open: at least one open string, nothing fretted above fret 4. */
const isOpen = (s: GuitarShape) => s.frets.includes(0) && s.anchor + s.span <= 4;

/** Barre: the E or A shape. No open strings; the barre starts on the bass string, which is low E or A. */
function isBarre(s: GuitarShape): boolean {
  const low = lowestRow(s);
  return s.barre !== null && !s.frets.includes(0) && (low === LOW_E || low === A_STRING) && s.barre.to === low;
}

/** Root on low E or A, the 5th and the octave above it. Needs a perfect 5th and no slash bass. */
function powerShapes(t: ChordTones): GuitarShape[] {
  if (t.fifth !== 7 || t.bassPc !== t.rootPc) return [];
  const out: GuitarShape[] = [];
  for (const row of [LOW_E, A_STRING]) {
    for (let f = mod12(t.rootPc - GUITAR_OPEN[row]!); f + 2 <= GUITAR_MAX_FRET; f += 12) {
      const frets: (number | null)[] = GUITAR_OPEN.map(() => null);
      frets[row] = f;
      frets[row - 1] = f + 2;
      frets[row - 2] = f + 2;
      out.push(shapeOf(frets));
    }
  }
  return out;
}

/**
 * Root, third and fifth, one each, on three adjacent strings of the top four
 * (e-B-G or B-G-D), any inversion, all within 4 frets. A slash chord keeps its
 * bass lowest, so it needs a slash note that is one of the three.
 */
function triadShapes(t: ChordTones): GuitarShape[] {
  const pcs = [t.rootPc, mod12(t.rootPc + t.third), mod12(t.rootPc + t.fifth)];
  if (!pcs.includes(t.bassPc)) return [];
  const slash = t.bassPc !== t.rootPc;
  const out: GuitarShape[] = [];
  const fretsFor = (row: number) => {
    const fs: number[] = [];
    for (let f = 0; f <= GUITAR_MAX_FRET; f++) if (pcs.includes(mod12(GUITAR_OPEN[row]! + f))) fs.push(f);
    return fs;
  };
  for (const top of [0, 1]) {
    const [r0, r1, r2] = [top, top + 1, top + 2];
    for (const f0 of fretsFor(r0)) {
      for (const f1 of fretsFor(r1)) {
        for (const f2 of fretsFor(r2)) {
          const played = [f0 + GUITAR_OPEN[r0]!, f1 + GUITAR_OPEN[r1]!, f2 + GUITAR_OPEN[r2]!].map(mod12);
          if (new Set(played).size !== 3) continue;
          if (Math.max(f0, f1, f2) - Math.min(f0, f1, f2) > 3) continue;
          if (slash && played[2] !== t.bassPc) continue;
          const frets: (number | null)[] = GUITAR_OPEN.map(() => null);
          frets[r0] = f0;
          frets[r1] = f1;
          frets[r2] = f2;
          out.push(shapeOf(frets));
        }
      }
    }
  }
  return out;
}

const byPlace = (a: GuitarShape, b: GuitarShape) => a.anchor - b.anchor || (a.tab < b.tab ? -1 : a.tab > b.tab ? 1 : 0);

const memo = new Map<string, GuitarShape[]>();

/** Every shape `style` allows for the chord, lowest on the neck first. Deterministic. */
export function shapesFor(style: GuitarStyle, chord: GuitarChord): GuitarShape[] {
  const t = chord.tones;
  const id = `${style}|${t.rootPc}|${t.bassPc}|${t.quality}`;
  const hit = memo.get(id);
  if (hit) return hit;
  const shapes =
    style === 'power'
      ? powerShapes(t)
      : style === 'triad'
        ? triadShapes(t)
        : playableShapes(chord).filter(style === 'open' ? isOpen : isBarre);
  shapes.sort(byPlace);
  memo.set(id, shapes);
  return shapes;
}

const DEGREE = ['R', '♭2', '2', '♭3', '3', '4', '♭5', '5', '♯5', '6', '♭7', '7'];

/** The chord degree each sounding string plays (R, ♭3, 5…), null for a muted string. */
export function degreesOf(shape: GuitarShape, t: ChordTones): (string | null)[] {
  return shape.frets.map((f, row) => {
    if (f === null) return null;
    const semis = mod12(GUITAR_OPEN[row]! + f - t.rootPc);
    return t.seventh === 9 && semis === 9 ? '𝄫7' : DEGREE[semis]!;
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm --prefix frontend test -- --run src/music/guitarShapes.test.ts`
Expected: PASS (12 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/music/guitarShapes.ts frontend/src/music/guitarShapes.test.ts
git commit -m "feat(music): open, barre, power and triad guitar shapes (D-20)"
```

---

### Task 4: Strum patterns

**Files:**
- Create: `frontend/src/music/strums.ts`
- Test: `frontend/src/music/strums.test.ts`

**Interfaces:**
- Consumes: `GuitarStrum` (Task 1, `api/client.ts`).
- Produces:
  - `interface Stroke { beat: number; dir: 'down'|'up'; accent: boolean; early: boolean }`.
  - `strumStrokes(strum: GuitarStrum, beatsPerBar: number): Stroke[]`.
  - `withoutDownbeat(strokes): Stroke[]`.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/music/strums.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { strumStrokes, withoutDownbeat } from './strums';

const pattern = (strokes: ReturnType<typeof strumStrokes>) =>
  strokes.map((s) => `${s.beat}${s.dir === 'down' ? 'D' : 'U'}${s.early ? '!' : ''}`).join(' ');

describe('strumStrokes', () => {
  it.each([
    ['whole', 4, '0D'],
    ['half', 4, '0D 2D'],
    ['quarters', 4, '0D 1D 2D 3D'],
    ['eighths', 4, '0D 0.5U 1D 1.5U 2D 2.5U 3D 3.5U'],
    ['folk', 4, '0D 1D 1.5U 2.5U 3D 3.5U'],
    ['push', 4, '0D 1D 1.5U 2.5U 3D 3.5U!'],
    ['whole', 3, '0D'],
    ['half', 3, '0D 2D'],
    ['folk', 3, '0D 1D 1.5U 2.5U'],
    ['push', 3, '0D 1D 1.5U 2.5U!'],
  ] as const)('%s in %i/4', (strum, beats, expected) => {
    expect(pattern(strumStrokes(strum, beats))).toBe(expected);
  });

  it('accents only the first stroke', () => {
    expect(strumStrokes('eighths', 4).map((s) => s.accent)).toEqual([true, false, false, false, false, false, false, false]);
  });
});

describe('withoutDownbeat', () => {
  it('drops the beat-1 down-stroke and accents what is left first', () => {
    const tied = withoutDownbeat(strumStrokes('folk', 4));
    expect(pattern(tied)).toBe('1D 1.5U 2.5U 3D 3.5U');
    expect(tied[0]!.accent).toBe(true);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm --prefix frontend test -- --run src/music/strums.test.ts`
Expected: FAIL, cannot resolve `./strums`.

- [ ] **Step 3: Create `frontend/src/music/strums.ts`**

```ts
// Strum patterns for the guitar Tabs (D-20). A pattern is a cycle of one-beat
// cells, each two eighth-note slots: D (down), U (up) or · (rest). The cells
// cycle over the bar's beats, so every pattern fits 3/4 as well as 4/4, the
// way the bass rhythms do.
import type { GuitarStrum } from '../api/client';

export interface Stroke {
  /** Offset into the bar in beats; a multiple of 0.5. */
  beat: number;
  dir: 'down' | 'up';
  /** The bar's first stroke, drawn bolder. */
  accent: boolean;
  /** Push: this stroke already plays the next bar's chord. */
  early: boolean;
}

const CELLS: Record<Exclude<GuitarStrum, 'whole' | 'push'>, readonly string[]> = {
  half: ['D·', '··'],
  quarters: ['D·'],
  eighths: ['DU'],
  folk: ['D·', 'DU', '·U', 'DU'],
};

export function strumStrokes(strum: GuitarStrum, beatsPerBar: number): Stroke[] {
  const cells =
    strum === 'whole' ? ['D·', ...new Array<string>(beatsPerBar - 1).fill('··')] : CELLS[strum === 'push' ? 'folk' : strum];
  const strokes: Stroke[] = [];
  for (let beat = 0; beat < beatsPerBar; beat++) {
    [...cells[beat % cells.length]!].forEach((slot, half) => {
      if (slot === '·') return;
      strokes.push({ beat: beat + half / 2, dir: slot === 'D' ? 'down' : 'up', accent: strokes.length === 0, early: false });
    });
  }
  if (strum === 'push') {
    for (let i = strokes.length - 1; i >= 0; i--) {
      if (strokes[i]!.dir === 'up') {
        strokes[i] = { ...strokes[i]!, early: true };
        break;
      }
    }
  }
  return strokes;
}

/** A bar that was pushed into: its beat-1 down-stroke is tied over from the push. */
export function withoutDownbeat(strokes: readonly Stroke[]): Stroke[] {
  const rest = strokes.filter((s) => !(s.beat === 0 && s.dir === 'down'));
  return rest.map((s, i) => ({ ...s, accent: i === 0 }));
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm --prefix frontend test -- --run src/music/strums.test.ts`
Expected: PASS (12 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/music/strums.ts frontend/src/music/strums.test.ts
git commit -m "feat(music): strum patterns as one-beat cells, push ties into the next bar (D-20)"
```

---

### Task 5: `guitarSource`: one shape and one strum per bar

**Files:**
- Modify: `frontend/src/music/tabSource.ts`
- Create: `frontend/src/music/guitarSource.ts`
- Test: `frontend/src/music/guitarSource.test.ts`

**Interfaces:**
- Consumes: Tasks 2–4. From `tabSource.ts`: `chordLabels`, `nextBarOf` (exported in this task), `TabSourceInput`.
- Produces:
  - In `tabSource.ts`:
    - `type TabResult<Bar>` and `interface TabSource<Bar>`. `patternSource` becomes `TabSource<PlacedBar>`.
    - `export function nextBarOf(count, loop)`.
    - `interface BarSummary { bar: number; text: string; cell: string; sub: string|null; note: string }`.
    - `bassSummaries(bars: readonly PlacedBar[], key: ResolvedKey): BarSummary[]`.
  - In `guitarSource.ts`:
    - `interface GuitarBar { bar; label; empty: EmptyKind|'no_shape'|null; reason; heard; chord; shape: GuitarShape|null; degrees; strokes: Stroke[]; pushChord: string|null; substitutions: string[] }`.
    - `guitarSource: TabSource<GuitarBar>`.
    - `guitarChordText(bar)`, `guitarEmptyText(bar): string|null`, `strokeIndexAt(bar, beatsInto): number`, `describeGuitarBar(bar|undefined)`, `guitarSummaries(bars): BarSummary[]`.

- [ ] **Step 1: Make `TabSource` generic and add the summary type**

In `frontend/src/music/tabSource.ts`, replace the `TabResult` type and the `TabSource` interface with:

```ts
/** A source's bars: PlacedBar for the bass patterns, GuitarBar for guitar (D-20). */
export type TabResult<Bar> =
  | { ok: true; key: ResolvedKey; bars: Bar[]; nextOf(bar: number): number | null }
  | { ok: false; error: string };

export interface TabSource<Bar> {
  barsFor(input: TabSourceInput): TabResult<Bar>;
}
```

Also make these edits in the same file:
- Change `function nextBarOf(` to `export function nextBarOf(`.
- Change `export const patternSource: TabSource = {` to `export const patternSource: TabSource<PlacedBar> = {`.
- Append the following to the end of the file:

```ts
/** What the readout and the ribbon need from a bar, whichever instrument made it. */
export interface BarSummary {
  bar: number;
  /** The chord as played, or what the bar is instead ("no chord"). */
  text: string;
  /** The ribbon cell: the chord as heard, "–" for no chord, "?" for unreadable. */
  cell: string;
  /** Under the cell: what Simplify reduced it to ("→ Em"), else null. */
  sub: string | null;
  /** Every substitution and reason for this bar, for the readout chip; "" if none. */
  note: string;
}

export function bassSummaries(bars: readonly PlacedBar[], key: ResolvedKey): BarSummary[] {
  return bars.map((b) => ({
    bar: b.plan.bar,
    text: chordText(b, key),
    cell: b.plan.empty ? (b.plan.empty === 'no_chord' ? '–' : '?') : chordText(b, key),
    sub: null,
    note: b.plan.substitution ?? b.plan.reason ?? '',
  }));
}
```

Run: `npm --prefix frontend run typecheck`
Expected: no errors. `ReturnType<typeof patternSource.barsFor>` in the existing tests still narrows to `PlacedBar`.

- [ ] **Step 2: Write the failing test**

Create `frontend/src/music/guitarSource.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { DEFAULT_PLAY_ALONG, type Analysis, type PlayAlongGuitar, type Song } from '../api/client';
import { buildGrid } from './grid';
import { describeGuitarBar, guitarEmptyText, guitarSource, guitarSummaries, strokeIndexAt } from './guitarSource';
import type { LoopBars } from './tabSource';

function analysisOf(chords: string[]): Analysis {
  return {
    schema_version: 1,
    key_candidates: [{ tonic: 'G', mode: 'major', confidence: 0.8 }],
    beat_grid: {
      bpm: 120,
      beats: Array.from({ length: chords.length * 4 }, (_, i) => i * 24_000),
      downbeats: Array.from({ length: chords.length }, (_, i) => i * 96_000),
    },
    chords: chords.map((chord, bar) => ({ bar, start_sample: bar * 96_000, end_sample: (bar + 1) * 96_000, chord })),
  };
}

function songWith(guitar: Partial<PlayAlongGuitar>): Song {
  return {
    schema_version: 4, id: 'abc123', title: 'T', artist: '',
    source: { kind: 'upload', value: 'original.mp3' }, created_at: '2026-10-01T00:00:00+00:00',
    last_played_at: null, mix: {}, playback: { tempo: 1, pitch_semitones: 0 }, loops: [],
    active_loop: null, metronome: false, count_in_bars: 0,
    play_along: { ...DEFAULT_PLAY_ALONG, instrument: 'guitar', guitar: { ...DEFAULT_PLAY_ALONG.guitar, ...guitar } },
  };
}

function bars(chords: string[], guitar: Partial<PlayAlongGuitar> = {}, loop: LoopBars | null = null) {
  const analysis = analysisOf(chords);
  const result = guitarSource.barsFor({ song: songWith(guitar), analysis, grid: buildGrid(analysis.beat_grid)!, loop });
  if (!result.ok) throw new Error(result.error);
  return result.bars;
}

const tabs = (b: ReturnType<typeof bars>) => b.map((x) => x.shape?.tab ?? x.empty);
const strokes = (b: ReturnType<typeof bars>[number]) =>
  b.strokes.map((s) => `${s.beat}${s.dir === 'down' ? 'D' : 'U'}${s.early ? '!' : ''}`).join(' ');

describe('guitarSource', () => {
  it('plays G D Em C as the open chords, folk strum by default', () => {
    const b = bars(['G', 'D', 'E:min', 'C']);
    expect(tabs(b)).toEqual(['320003', 'xx0232', '022000', 'x32010']);
    expect(b[0]!.degrees).toEqual(['R', '3', 'R', '5', '3', 'R']);
    expect(strokes(b[0]!)).toBe('0D 1D 1.5U 2.5U 3D 3.5U');
    expect(b.every((x) => x.substitutions.length === 0)).toBe(true);
  });

  it('is deterministic and keeps the hand still: barre G D Em C does not jump between frets 3 and 10', () => {
    const a = tabs(bars(['G', 'D', 'E:min', 'C'], { style: 'barre' }));
    expect(a).toEqual(tabs(bars(['G', 'D', 'E:min', 'C'], { style: 'barre' })));
    const anchors = bars(['G', 'D', 'E:min', 'C'], { style: 'barre' }).map((x) => x.shape!.anchor);
    for (let i = 1; i < anchors.length; i++) expect(Math.abs(anchors[i]! - anchors[i - 1]!)).toBeLessThanOrEqual(3);
  });

  it('says so when a style has no shape for a chord, and uses the next style', () => {
    const b = bars(['C', 'F', 'G', 'C']);
    expect(b[1]!.shape!.tab).toBe('133211');
    expect(b[1]!.substitutions).toEqual(['no open F, using barre']);
    const p = bars(['G', 'B:dim', 'C'], { style: 'power' });
    expect(p[1]!.substitutions).toEqual(['no power Bdim, using triad']);
  });

  it('keeps shapes inside the position window, and says when one cannot be', () => {
    const low = bars(['G', 'D', 'E:min', 'C'], { style: 'barre', position: 'low' });
    expect(tabs(low)).toEqual(['355433', 'x57775', 'x79987', 'x35553']);
    expect(low[1]!.substitutions).toEqual(['no low-position D, fret 5']);
    const mid = bars(['G', 'D'], { style: 'barre', position: 'mid' });
    expect(mid[1]!.substitutions).toEqual([]);
    expect(mid[0]!.substitutions).toEqual(['no mid-position G, fret 3']);
  });

  it('ignores the position window for open chords', () => {
    expect(tabs(bars(['G', 'C'], { position: 'mid' }))).toEqual(['320003', 'x32010']);
  });

  it('simplifies 7ths and 6ths to triads, and says so', () => {
    const b = bars(['G', 'E:min7', 'C:maj7', 'D:7'], { simplify: true });
    expect(tabs(b)).toEqual(['320003', '022000', 'x32010', 'xx0232']);
    expect(b.map((x) => x.substitutions)).toEqual([[], ['Emin7 → Em'], ['Cmaj7 → C'], ['D7 → D']]);
    const summary = guitarSummaries(b)[1]!;
    expect(summary).toEqual({ bar: 1, text: 'Em', cell: 'Emin7', sub: '→ Em', note: 'Emin7 → Em' });
  });

  it('says a triad drops the 7th', () => {
    expect(bars(['C:7', 'G'], { style: 'triad' })[0]!.substitutions).toEqual(['C7 as a C triad']);
  });

  it('pushes the last up-stroke into the next chord and ties over its downbeat', () => {
    const b = bars(['G', 'C', 'N', 'G'], { strum: 'push' });
    expect(strokes(b[0]!)).toBe('0D 1D 1.5U 2.5U 3D 3.5U!');
    expect(b[0]!.pushChord).toBe('C');
    expect(strokes(b[1]!)).toBe('1D 1.5U 2.5U 3D 3.5U');
    expect(b[1]!.substitutions).toEqual(['no push into an empty bar']);
    expect(b[2]!.empty).toBe('no_chord');
    expect(b[2]!.strokes).toEqual([]);
    expect(b[3]!.substitutions).toEqual(['no push past the last bar']);
  });

  it('pushes from the loop end into the loop start', () => {
    const b = bars(['G', 'C', 'D', 'G'], { strum: 'push' }, { startBar: 0, endBar: 2 });
    expect(b[1]!.pushChord).toBe('G');
    expect(strokes(b[0]!)).toBe('1D 1.5U 2.5U 3D 3.5U!');
  });

  it('shows a chord no style can play as an empty neck that says so', () => {
    const [bar] = bars(['C/b7', 'G'], { style: 'triad' });
    expect(bar!.empty).toBe('no_shape');
    expect(guitarEmptyText(bar!)).toMatch(/^no playable shape for C\//);
    expect(describeGuitarBar(bar)).toMatch(/^Bar 1, C\//);
  });

  it('describes a bar and finds the stroke under the playhead', () => {
    const [bar] = bars(['G', 'C']);
    expect(describeGuitarBar(bar)).toBe('Bar 1, G: 320003');
    expect(strokeIndexAt(bar!, 0.2)).toBe(0);
    expect(strokeIndexAt(bar!, 0.7)).toBe(-1);
    expect(strokeIndexAt(bar!, 1.6)).toBe(2);
  });

  it('summarises empty bars for the ribbon', () => {
    const s = guitarSummaries(bars(['N', 'X', 'G']));
    expect(s.map((x) => [x.text, x.cell])).toEqual([['no chord', '–'], ['unclassified', '?'], ['G', 'G']]);
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npm --prefix frontend test -- --run src/music/guitarSource.test.ts`
Expected: FAIL, cannot resolve `./guitarSource`.

- [ ] **Step 4: Create `frontend/src/music/guitarSource.ts`**

```ts
// The guitar Tabs' second TabSource (D-20): per bar a chord shape and a strum,
// generated from the chord chart. The style picks which shapes a chord may
// take, a Viterbi pass over the whole song picks one per bar so the hand moves
// as little as it can, and the strum says when to hit it. Deterministic: the
// same song and settings always draw the same shapes.
//
// Every fallback is written into the bar's substitutions and drawn, never
// silently swapped (N-08): a style with no shape for a chord, a position
// window with none in it, a simplified chord, a push with nothing to push into.
import type { PlayAlongGuitar } from '../api/client';
import { parseChord, type ChordTones } from './chordTones';
import { guitarChord, simplify } from './guitarChords';
import { degreesOf, shapesFor, type GuitarShape, type GuitarStyle } from './guitarShapes';
import { resolveKey, tonesText, type EmptyKind, type ResolvedKey } from './patterns';
import { strumStrokes, withoutDownbeat, type Stroke } from './strums';
import { chordLabels, nextBarOf, type BarSummary, type TabSource } from './tabSource';

export interface GuitarBar {
  bar: number;
  /** The analysis's label, as written. */
  label: string;
  empty: EmptyKind | 'no_shape' | null;
  /** Why an `unparsed` label could not be read. */
  reason: string | null;
  /** The chord as heard (transposed), before Simplify; null for an empty bar. */
  heard: string | null;
  /** The chord as played, after Simplify. */
  chord: string | null;
  shape: GuitarShape | null;
  /** Chord degree per row (row 0 = high e), null for a muted string. */
  degrees: (string | null)[];
  strokes: Stroke[];
  /** The chord an early (push) stroke plays, else null. */
  pushChord: string | null;
  substitutions: string[];
}

/** Which style to try next when a style has no shape for a chord. */
const CHAIN: Record<GuitarStyle, readonly GuitarStyle[]> = {
  open: ['open', 'barre', 'triad'],
  barre: ['barre', 'triad'],
  power: ['power', 'barre', 'triad'],
  triad: ['triad'],
};

const WINDOW = { low: [0, 5], mid: [5, 9] } as const;

const fits = (s: GuitarShape, [lo, hi]: readonly [number, number]) =>
  s.frets.every((f) => f === null || f === 0 || (f >= lo && f <= hi));

interface Draft {
  bar: number;
  label: string;
  empty: GuitarBar['empty'];
  reason: string | null;
  heard: string | null;
  chord: string | null;
  tones: ChordTones | null;
  candidates: GuitarShape[];
  substitutions: string[];
  missedWindow: 'low' | 'mid' | null;
}

function draftBar(bar: number, label: string, key: ResolvedKey, settings: PlayAlongGuitar, transpose: number): Draft {
  const base: Draft = {
    bar, label, empty: null, reason: null, heard: null, chord: null, tones: null,
    candidates: [], substitutions: [], missedWindow: null,
  };
  const parsed = parseChord(label, transpose);
  if (parsed.kind === 'no_chord') return { ...base, empty: 'no_chord' };
  if (parsed.kind === 'unclassified') return { ...base, empty: 'unclassified' };
  if (parsed.kind === 'unparsed') return { ...base, empty: 'unparsed', reason: parsed.reason };

  const tones = settings.simplify ? simplify(parsed.tones) : parsed.tones;
  const heard = tonesText(parsed.tones, key);
  const chord = tonesText(tones, key);
  const substitutions = chord !== heard ? [`${heard} → ${chord}`] : [];
  const read = guitarChord(tones, key);
  if (!read.ok) return { ...base, heard, chord, tones, empty: 'unparsed', reason: read.reason, substitutions };

  for (const style of CHAIN[settings.style]) {
    let candidates = shapesFor(style, read.chord);
    if (candidates.length === 0) continue;
    if (style !== settings.style) substitutions.push(`no ${settings.style} ${chord}, using ${style}`);
    if (style === 'triad' && tones.seventh !== null) substitutions.push(`${chord} as a ${tonesText(simplify(tones), key)} triad`);
    let missedWindow: Draft['missedWindow'] = null;
    if (settings.position !== 'auto' && style !== 'open') {
      const inWindow = candidates.filter((s) => fits(s, WINDOW[settings.position as 'low' | 'mid']));
      if (inWindow.length > 0) candidates = inWindow;
      else missedWindow = settings.position as 'low' | 'mid';
    }
    return { ...base, heard, chord, tones, candidates, substitutions, missedWindow };
  }
  return { ...base, heard, chord, tones, empty: 'no_shape', substitutions };
}

/** Within a shape: wide stretches and muted strings cost, and so does climbing the neck, a little. */
const shapeCost = (s: GuitarShape) => s.span + 0.5 * s.muted + 0.05 * s.anchor;
/** Between bars: the hand moving. Weighted most, so a song stays in one place when it can. */
const moveCost = (a: GuitarShape, b: GuitarShape) => 2 * Math.abs(a.anchor - b.anchor);

/** Viterbi over one run of consecutive bars that all have candidates. Ties keep the earlier (lower) candidate. */
function bestPath(states: GuitarShape[][]): GuitarShape[] {
  let cost = states[0]!.map(shapeCost);
  const back: number[][] = [];
  for (let k = 1; k < states.length; k++) {
    const prev = states[k - 1]!;
    const nextCost: number[] = [];
    const pointers: number[] = [];
    for (const s of states[k]!) {
      let best = Infinity;
      let arg = 0;
      prev.forEach((p, pi) => {
        const c = cost[pi]! + moveCost(p, s);
        if (c < best) {
          best = c;
          arg = pi;
        }
      });
      nextCost.push(best + shapeCost(s));
      pointers.push(arg);
    }
    cost = nextCost;
    back.push(pointers);
  }
  let arg = cost.indexOf(Math.min(...cost));
  const path: GuitarShape[] = new Array(states.length);
  for (let k = states.length - 1; k >= 0; k--) {
    path[k] = states[k]![arg]!;
    if (k > 0) arg = back[k - 1]![arg]!;
  }
  return path;
}

function chooseShapes(drafts: Draft[]): (GuitarShape | null)[] {
  const chosen: (GuitarShape | null)[] = drafts.map(() => null);
  // An empty bar breaks the chain: the hand is free to move during a rest.
  let i = 0;
  while (i < drafts.length) {
    if (drafts[i]!.candidates.length === 0) {
      i++;
      continue;
    }
    let j = i;
    while (j < drafts.length && drafts[j]!.candidates.length > 0) j++;
    bestPath(drafts.slice(i, j).map((d) => d.candidates)).forEach((s, k) => (chosen[i + k] = s));
    i = j;
  }
  return chosen;
}

export const guitarSource: TabSource<GuitarBar> = {
  barsFor({ song, analysis, grid, loop }) {
    const transpose = song.playback.pitch_semitones;
    const key = resolveKey(song.play_along.key, analysis.key_candidates, transpose);
    if (!key) {
      return { ok: false, error: 'The analysis found no key candidates, so there is no key to spell the chords in.' };
    }
    const settings = song.play_along.guitar;
    const labels = chordLabels(analysis);
    const nextOf = nextBarOf(labels.length, loop);
    const drafts = labels.map((label, bar) => draftBar(bar, label, key, settings, transpose));
    const chosen = chooseShapes(drafts);

    const bars: GuitarBar[] = drafts.map((d, index) => {
      const shape = chosen[index] ?? null;
      const substitutions = [...d.substitutions];
      if (shape && d.missedWindow) substitutions.push(`no ${d.missedWindow}-position ${d.chord}, fret ${shape.anchor}`);
      let strokes = shape ? strumStrokes(settings.strum, grid.beatsPerBar) : [];
      let pushChord: string | null = null;
      const early = strokes.findIndex((s) => s.early);
      if (early >= 0) {
        const target = nextOf(index);
        if (target !== null && chosen[target]) {
          pushChord = drafts[target]!.chord;
        } else {
          strokes = strokes.map((s) => ({ ...s, early: false }));
          substitutions.push(target === null ? 'no push past the last bar' : 'no push into an empty bar');
        }
      }
      return {
        bar: d.bar,
        label: d.label,
        empty: d.empty,
        reason: d.reason,
        heard: d.heard,
        chord: d.chord,
        shape,
        degrees: shape && d.tones ? degreesOf(shape, d.tones) : [],
        strokes,
        pushChord,
        substitutions,
      };
    });

    // A bar pushed into has its downbeat tied over from the push.
    bars.forEach((b, index) => {
      if (b.pushChord === null) return;
      const target = nextOf(index)!;
      bars[target] = { ...bars[target]!, strokes: withoutDownbeat(bars[target]!.strokes) };
    });

    return { ok: true, key, bars, nextOf };
  },
};

/** The chord as played, or what the bar is instead. */
export function guitarChordText(bar: GuitarBar): string {
  if (bar.empty === 'no_chord') return 'no chord';
  if (bar.empty === 'unclassified') return 'unclassified';
  if (bar.empty === 'unparsed') return `unreadable chord "${bar.label}"`;
  return bar.chord!;
}

/** What an empty neck says, or null when the bar has a shape. */
export function guitarEmptyText(bar: GuitarBar): string | null {
  if (bar.shape) return null;
  if (bar.empty === 'no_shape') return `no playable shape for ${bar.chord}`;
  return guitarChordText(bar);
}

/** Index of the stroke sounding `beatsInto` beats into the bar (each lasts an eighth), or -1. */
export function strokeIndexAt(bar: GuitarBar, beatsInto: number): number {
  return bar.strokes.findIndex((s) => beatsInto >= s.beat && beatsInto < s.beat + 0.5);
}

/** One line for screen readers and tests: "Bar 5, G: 320003". */
export function describeGuitarBar(bar: GuitarBar | undefined): string {
  if (!bar) return 'past the end of the chord chart';
  const head = `Bar ${bar.bar + 1}, ${guitarChordText(bar)}`;
  return bar.shape ? `${head}: ${bar.shape.tab}` : head;
}

export function guitarSummaries(bars: readonly GuitarBar[]): BarSummary[] {
  return bars.map((b) => ({
    bar: b.bar,
    text: guitarChordText(b),
    cell:
      b.empty === 'no_chord' ? '–' : b.empty === 'unclassified' || b.empty === 'unparsed' ? '?' : (b.heard ?? b.chord!),
    sub: b.heard !== null && b.chord !== null && b.heard !== b.chord ? `→ ${b.chord}` : null,
    note: [...b.substitutions, ...(b.reason ? [b.reason] : [])].join(' · '),
  }));
}
```

- [ ] **Step 5: Run all music tests and typecheck**

Run: `npm --prefix frontend test -- --run src/music && npm --prefix frontend run typecheck`
Expected: PASS (guitarSource: 12 tests), no type errors.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/music/tabSource.ts frontend/src/music/guitarSource.ts frontend/src/music/guitarSource.test.ts
git commit -m "feat(music): guitarSource, shapes chosen across the song and strums with push (D-20)"
```

---

### Task 6: Readout and chord ribbon read `BarSummary`

The bass behaviour is unchanged. This task gives the two shared components an
input that does not care which instrument made the bar.

**Files:**
- Modify: `frontend/src/playalong/NowReadout.tsx`
- Modify: `frontend/src/playalong/ChordRibbon.tsx`
- Modify: `frontend/src/playalong/ChordRibbon.test.tsx`
- Modify: `frontend/src/playalong/PlayAlong.module.css`
- Modify: `frontend/src/screens/PlayAlong.tsx` (interim: pass bass summaries)

**Interfaces:**
- Consumes: `BarSummary`, `bassSummaries` (Task 5).
- Produces:
  - `NowReadoutProps`: `{ bars: BarSummary[]; nextOf; instrument: 'bass'|'guitar'; grid; pitchSemitones; getPosition; playing; seekNonce }`. `songKey` is removed.
  - `ChordRibbonProps`: `{ bars: BarSummary[]; loop; grid; getPosition; playing; seekNonce; onLoopBars; onSeekBar }`. `songKey` is removed.
  - CSS class `.cellSub`.

- [ ] **Step 1: Write the failing test**

In `frontend/src/playalong/ChordRibbon.test.tsx`:
- Change the import to `import { bassSummaries, patternSource } from '../music/tabSource';`.
- In `renderRibbon`, replace the two props `bars={result.bars}` and `songKey={result.key}` with `bars={bassSummaries(result.bars, result.key)}`.
- Append:

```tsx
describe('ChordRibbon with a simplified chord', () => {
  it('shows the chord as heard, what it was reduced to under it, and names the bar by what is played', () => {
    render(
      <ChordRibbon
        bars={[{ bar: 0, text: 'Em', cell: 'Emin7', sub: '→ Em', note: 'Emin7 → Em' }]}
        loop={null}
        grid={grid}
        getPosition={() => sampleIndex(0)}
        playing={false}
        seekNonce={0}
        onLoopBars={vi.fn()}
        onSeekBar={vi.fn()}
      />,
    );
    const cell = screen.getByRole('button', { name: 'Bar 1, Em' });
    expect(cell).toHaveTextContent('1Emin7→ Em');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm --prefix frontend test -- --run src/playalong/ChordRibbon.test.tsx`
Expected: FAIL. The ribbon reads `b.plan`, so a `BarSummary` throws `Cannot read properties of undefined`.

- [ ] **Step 3: Rewrite `ChordRibbon.tsx` to read summaries**

Replace the whole file with:

```tsx
// The whole chord chart as one cell per bar (D-18): where you are, where the
// loop is, and a quick way to move. Click moves the playhead to the bar.
// Ctrl/Cmd-click sets the loop start and shift-click the end, with the same
// one-bar minimum and no inversion as Set A / Set B.
// The current bar is lit from the engine clock into a data attribute (U-05),
// the same pattern as ChordStrip, never React state.
import { useCallback, useRef, type MouseEvent } from 'react';

import type { Loop } from '../api/client';
import type { SampleIndex } from '../engine/types';
import { barAt, type Grid } from '../music/grid';
import type { BarSummary } from '../music/tabSource';
import { usePlayhead } from '../songview/usePlayhead';
import styles from './PlayAlong.module.css';

export interface ChordRibbonProps {
  bars: BarSummary[];
  loop: Loop | null;
  grid: Grid;
  getPosition(): SampleIndex;
  playing: boolean;
  seekNonce: number;
  onLoopBars(startBar: number, endBar: number): void;
  onSeekBar(bar: number): void;
}

export function ChordRibbon({ bars, loop, grid, getPosition, playing, seekNonce, onLoopBars, onSeekBar }: ChordRibbonProps) {
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
    if (event.ctrlKey || event.metaKey) {
      onLoopBars(bar, Math.max(loop?.end_bar ?? 0, bar + 1));
      return;
    }
    onSeekBar(bar);
  };

  return (
    <div className={styles.ribbon} role="group" aria-label="Chord chart by bar. Click moves the playhead, Ctrl-click sets the loop start, shift-click the end.">
      {bars.map((b, i) => {
        const inLoop = loop !== null && i >= loop.start_bar && i < loop.end_bar;
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
            aria-label={`Bar ${i + 1}, ${b.text}`}
            onClick={(event) => select(i, event)}
          >
            <span className={styles.cellBar}>{i + 1}</span>
            {b.cell}
            {b.sub && <span className={styles.cellSub}>{b.sub}</span>}
          </button>
        );
      })}
    </div>
  );
}
```

Add to `frontend/src/playalong/PlayAlong.module.css`, directly above `.cellBar {`:

```css
.cellSub {
  font: 600 10px / 1 var(--ds-font);
  color: var(--ds-warn);
}
```

- [ ] **Step 4: Rewrite `NowReadout.tsx` to read summaries**

Replace the whole file with:

```tsx
// frontend/src/playalong/NowReadout.tsx
// Bar · beat, the chord now → the chord next, and what a pattern had to
// substitute in this bar. Painted into refs from the engine clock (U-05), like
// Transport's readouts. The substitution is part of the readout because it
// changes bar to bar, and hiding it would be a silent fallback (N-08).
import { useCallback, useRef } from 'react';

import type { SampleIndex } from '../engine/types';
import { beatPosition, type Grid } from '../music/grid';
import type { BarSummary } from '../music/tabSource';
import { usePlayhead } from '../songview/usePlayhead';
import styles from './PlayAlong.module.css';

export interface NowReadoutProps {
  bars: BarSummary[];
  nextOf(bar: number): number | null;
  /** Says what follows the pitch shift: the bass fingering or the guitar shapes. */
  instrument: 'bass' | 'guitar';
  grid: Grid;
  pitchSemitones: number;
  getPosition(): SampleIndex;
  playing: boolean;
  seekNonce: number;
}

export function NowReadout({ bars, nextOf, instrument, grid, pitchSemitones, getPosition, playing, seekNonce }: NowReadoutProps) {
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
      set(nowRef.current, current ? current.text : '--');
      set(nextRef.current, next ? next.text : '');
      const note = current?.note ?? '';
      set(noteRef.current, note);
      if (noteRef.current) noteRef.current.hidden = note === '';
    },
    [bars, nextOf, grid],
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
          {Math.abs(pitchSemitones)} st · {instrument === 'guitar' ? 'shapes follow' : 'fingering follows'} what you hear
        </span>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Feed the bass summaries from `PlayAlong.tsx` (interim)**

In `frontend/src/screens/PlayAlong.tsx`:
- Change the `tabSource` import to `import { bassSummaries, patternSource } from '../music/tabSource';`.
- Add this below the `result` memo:

```tsx
  const summaries = useMemo(() => (result?.ok ? bassSummaries(result.bars, result.key) : null), [result]);
```

- In `<NowReadout …>`, replace `bars={result.bars}` with `bars={summaries!}` and `songKey={result.key}` with `instrument="bass"`.
- In `<ChordRibbon …>`, replace `bars={result.bars}` with `bars={summaries!}` and delete `songKey={result.key}`.

Task 9 replaces this file wholesale.

- [ ] **Step 6: Run the frontend tests and typecheck**

Run: `npm --prefix frontend test -- --run && npm --prefix frontend run typecheck`
Expected: all pass, including the existing `PlayAlong` screen tests (the readout and ribbon look the same for bass).

- [ ] **Step 7: Commit**

```bash
git add frontend/src/playalong/NowReadout.tsx frontend/src/playalong/ChordRibbon.tsx frontend/src/playalong/ChordRibbon.test.tsx frontend/src/playalong/PlayAlong.module.css frontend/src/screens/PlayAlong.tsx
git commit -m "refactor(tabs): readout and chord ribbon read a BarSummary, whichever instrument made it"
```

---

### Task 7: Guitar neck and strum lane painters

**Files:**
- Modify: `frontend/src/playalong/colors.ts`
- Modify: `frontend/src/playalong/neckPainter.test.ts` (colour fixture)
- Create: `frontend/src/playalong/guitarNeckPainter.ts`
- Create: `frontend/src/playalong/strumLanePainter.ts`
- Test: `frontend/src/playalong/guitarNeckPainter.test.ts`, `frontend/src/playalong/strumLanePainter.test.ts`

**Interfaces:**
- Consumes: `GuitarBar`, `guitarEmptyText` (Task 5); `GUITAR_MAX_FRET`, `shapeOf` (Task 3); `strumStrokes` (Task 4); `noteX`, `NeckGeometry` (`neckPainter.ts`).
- Produces:
  - `PlayAlongColors.other` (from `--ds-other`).
  - `GUITAR_NECK_H = 236`, `guitarGeometry(width): NeckGeometry`, `rowY(row)`.
  - `paintGuitarNeck(ctx, width, colors, current: GuitarBar|null, next: GuitarBar|null, strumming: boolean)`.
  - `STRUM_LANE_H = 96`, `interface StrumLaneBar { bar: GuitarBar; title: string }`.
  - `paintStrumLane(ctx, width, colors, current, next, beatsPerBar, frac, hot)`.

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/playalong/guitarNeckPainter.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';

import type { GuitarBar } from '../music/guitarSource';
import { shapeOf } from '../music/guitarShapes';
import type { PlayAlongColors } from './colors';
import { guitarGeometry, paintGuitarNeck, rowY } from './guitarNeckPainter';
import { noteX } from './neckPainter';

const colors = new Proxy({}, { get: (_t, p) => String(p) }) as PlayAlongColors;

function recordingContext() {
  const calls = { fillText: [] as [string, number, number][], arc: [] as [number, number, number][], roundRect: 0 };
  const ctx = new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === 'fillText') return (text: string, x: number, y: number) => calls.fillText.push([text, x, y]);
        if (prop === 'arc') return (x: number, y: number, r: number) => calls.arc.push([x, y, r]);
        if (prop === 'roundRect') return () => calls.roundRect++;
        if (typeof prop === 'string' && ['setLineDash', 'beginPath', 'moveTo', 'lineTo', 'stroke', 'fill', 'fillRect', 'clearRect', 'strokeRect'].includes(prop)) {
          return vi.fn();
        }
        return undefined;
      },
      set: () => true,
    },
  ) as unknown as CanvasRenderingContext2D;
  return { ctx, calls };
}

const bar = (over: Partial<GuitarBar>): GuitarBar => ({
  bar: 0, label: 'G', empty: null, reason: null, heard: 'G', chord: 'G', shape: null, degrees: [],
  strokes: [], pushChord: null, substitutions: [], ...over,
});
// G, 320003, and D, xx0232 (row 0 = high e).
const gBar = bar({ shape: shapeOf([3, 0, 0, 0, 2, 3]), degrees: ['R', '3', 'R', '5', '3', 'R'] });
const dBar = bar({ bar: 1, chord: 'D', heard: 'D', shape: shapeOf([2, 3, 2, 0, null, null]), degrees: ['3', 'R', '5', 'R', null, null] });
const fBar = bar({ chord: 'F', heard: 'F', shape: shapeOf([1, 1, 2, 3, 3, 1]), degrees: ['R', '5', '3', 'R', '5', 'R'] });

describe('paintGuitarNeck', () => {
  it('labels every sounding string with its degree and marks muted strings', () => {
    const { ctx, calls } = recordingContext();
    paintGuitarNeck(ctx, 1400, colors, dBar, null, false);
    const texts = calls.fillText.map(([t]) => t);
    expect(texts.filter((t) => t === '✕')).toHaveLength(2);
    expect(texts).toEqual(expect.arrayContaining(['3', 'R', '5']));
  });

  it("draws the next bar's shape as rings where its notes are", () => {
    const { ctx, calls } = recordingContext();
    paintGuitarNeck(ctx, 1400, colors, gBar, dBar, false);
    const g = guitarGeometry(1400);
    // D's B-string note: row 1, fret 3.
    expect(calls.arc).toContainEqual([noteX(g, 3), rowY(1), 16]);
  });

  it('halos every string on a stroke, and nothing between strokes', () => {
    const lit = recordingContext();
    paintGuitarNeck(lit.ctx, 1400, colors, gBar, null, true);
    expect(lit.calls.arc.filter(([, , r]) => r === 16 * 1.45)).toHaveLength(6);
    const still = recordingContext();
    paintGuitarNeck(still.ctx, 1400, colors, gBar, null, false);
    expect(still.calls.arc.filter(([, , r]) => r === 16 * 1.45)).toHaveLength(0);
  });

  it('draws a barre as one bar across its strings', () => {
    const { ctx, calls } = recordingContext();
    paintGuitarNeck(ctx, 1400, colors, fBar, null, false);
    expect(calls.roundRect).toBe(1);
  });

  it('says why the neck is empty', () => {
    const { ctx, calls } = recordingContext();
    paintGuitarNeck(ctx, 1400, colors, bar({ chord: 'C/A♯', empty: 'no_shape' }), null, false);
    expect(calls.fillText.map(([t]) => t)).toContain('no playable shape for C/A♯');
    const none = recordingContext();
    paintGuitarNeck(none.ctx, 1400, colors, bar({ chord: null, heard: null, empty: 'no_chord' }), null, false);
    expect(none.calls.fillText.map(([t]) => t)).toContain('no chord');
  });
});
```

Create `frontend/src/playalong/strumLanePainter.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';

import type { GuitarBar } from '../music/guitarSource';
import { strumStrokes } from '../music/strums';
import type { PlayAlongColors } from './colors';
import { paintStrumLane } from './strumLanePainter';

const colors = new Proxy({}, { get: (_t, p) => String(p) }) as PlayAlongColors;

function recordingContext() {
  const fills: string[] = [];
  const texts: string[] = [];
  const strokes: string[] = [];
  let fillStyle = '';
  let strokeStyle = '';
  const ctx = new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === 'fillText') return (text: string) => texts.push(text);
        if (prop === 'fill') return () => fills.push(fillStyle);
        if (prop === 'stroke') return () => strokes.push(strokeStyle);
        if (typeof prop === 'string' && ['setLineDash', 'beginPath', 'moveTo', 'lineTo', 'fillRect', 'clearRect', 'strokeRect', 'roundRect'].includes(prop)) {
          return vi.fn();
        }
        return undefined;
      },
      set(_target, prop, value) {
        if (prop === 'fillStyle') fillStyle = value;
        if (prop === 'strokeStyle') strokeStyle = value;
        return true;
      },
    },
  ) as unknown as CanvasRenderingContext2D;
  return { ctx, fills, texts, strokes };
}

const bar = (over: Partial<GuitarBar>): GuitarBar => ({
  bar: 0, label: 'G', empty: null, reason: null, heard: 'G', chord: 'G', shape: null, degrees: [],
  strokes: strumStrokes('push', 4), pushChord: 'C', substitutions: [], ...over,
});

describe('paintStrumLane', () => {
  it('draws a chip per stroke, the one to play now lit', () => {
    const { ctx, fills, texts } = recordingContext();
    paintStrumLane(ctx, 1400, colors, { bar: bar({}), title: 'Bar 1 · G' }, null, 4, 0.3, 2);
    expect(fills.filter((f) => f === 'hot')).toHaveLength(1);
    expect(fills.filter((f) => f === 'other')).toHaveLength(5);
    expect(texts.filter((t) => t === '↓')).toHaveLength(3);
  });

  it('rings a push stroke and names the chord it plays', () => {
    const { ctx, texts, strokes } = recordingContext();
    paintStrumLane(ctx, 1400, colors, { bar: bar({}), title: 'Bar 1 · G' }, null, 4, 0, -1);
    expect(texts).toContain('↑ C');
    expect(strokes).toContain('approach');
  });

  it("draws the next bar's strokes as plain arrows", () => {
    const { ctx, texts } = recordingContext();
    paintStrumLane(ctx, 1400, colors, null, { bar: bar({}), title: 'Next · bar 2 · C' }, 4, 0, -1);
    expect(texts).not.toContain('↑ C');
    expect(texts.filter((t) => t === '↑')).toHaveLength(3);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npm --prefix frontend test -- --run src/playalong/guitarNeckPainter.test.ts src/playalong/strumLanePainter.test.ts`
Expected: FAIL, cannot resolve `./guitarNeckPainter` / `./strumLanePainter`.

- [ ] **Step 3: Add the `other` colour**

In `frontend/src/playalong/colors.ts`:
- Add this field after `note: string;` in `PlayAlongColors`:

```ts
  /** Guitar shapes and strokes: guitar lives in the other stem (U-01, D-20). */
  other: string;
```

- Add `other: resolveColor('var(--ds-other)'),` after the `note:` line in `playAlongColors()`.

In `frontend/src/playalong/neckPainter.test.ts`, change the fixture's `note: 'teal', hot:` to `note: 'teal', other: 'violet', hot:`.

- [ ] **Step 4: Create `frontend/src/playalong/guitarNeckPainter.ts`**

```ts
// Drawing the guitar Tabs neck (D-20), kept apart from the component so what
// gets drawn is testable against a recording context, like neckPainter.ts.
// Mirrors the mockup (design/ui/src/pages/screens/play-along-guitar.html): this
// bar's shape filled in the other-stem colour with a chord degree on each dot,
// open strings as rings and muted ones as ✕ left of the nut, a barre as a bar,
// the next bar's shape as dashed rings, and a halo on every stroke.
import type { GuitarBar } from '../music/guitarSource';
import { guitarEmptyText } from '../music/guitarSource';
import { GUITAR_MAX_FRET } from '../music/guitarShapes';
import type { PlayAlongColors } from './colors';
import { noteX, type NeckGeometry } from './neckPainter';

export const GUITAR_NECK_H = 236;
const TOP = 40;
const STRING_GAP = 30;
/** Row 0 = high e, drawn at the top, as a player looks down at the neck. */
const NAMES = ['e', 'B', 'G', 'D', 'A', 'E'];

/** Wider than the bass nut, so open-string rings sit clear of the string names. */
export function guitarGeometry(width: number): NeckGeometry {
  const nutX = 72;
  return { width, nutX, fretW: Math.max(0, (width - nutX - 18) / GUITAR_MAX_FRET) };
}

export function rowY(row: number): number {
  return TOP + STRING_GAP * row;
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

export function paintGuitarNeck(
  ctx: CanvasRenderingContext2D,
  width: number,
  colors: PlayAlongColors,
  current: GuitarBar | null,
  next: GuitarBar | null,
  strumming: boolean,
): void {
  const g = guitarGeometry(width);
  const top = rowY(0) - 18;
  const bottom = rowY(5) + 18;
  // Dots shrink with the frets on a phone so adjacent frets do not overlap; 16 on desktop.
  const r = Math.min(16, g.fretW * 0.42);
  const scale = r / 16;
  ctx.clearRect(0, 0, width, GUITAR_NECK_H);

  ctx.fillStyle = colors.board;
  ctx.fillRect(g.nutX, top, g.fretW * GUITAR_MAX_FRET, bottom - top);

  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.font = '500 13px ui-monospace, monospace';
  ctx.fillStyle = colors.label;
  for (let f = 1; f <= GUITAR_MAX_FRET; f++) ctx.fillText(String(f), noteX(g, f), 16);

  for (let f = 0; f <= GUITAR_MAX_FRET; f++) {
    ctx.strokeStyle = f === 0 ? colors.nut : colors.fret;
    ctx.lineWidth = f === 0 ? 6 : 2;
    const x = g.nutX + g.fretW * f;
    line(ctx, x, top, x, bottom);
  }

  ctx.font = '600 15px system-ui, sans-serif';
  ctx.textAlign = 'left';
  for (let row = 0; row < 6; row++) {
    ctx.strokeStyle = colors.string;
    ctx.lineWidth = 1.2 + row * 0.35;
    line(ctx, g.nutX, rowY(row), g.nutX + g.fretW * GUITAR_MAX_FRET, rowY(row));
    ctx.fillStyle = colors.label;
    ctx.fillText(NAMES[row]!, 8, rowY(row) + 5);
  }

  ctx.fillStyle = colors.fret;
  for (const f of [3, 5, 7, 9]) {
    dot(ctx, noteX(g, f), bottom + 16, 5);
    ctx.fill();
  }
  for (const d of [-10, 10]) {
    dot(ctx, noteX(g, 12) + d, bottom + 16, 5);
    ctx.fill();
  }

  if (next?.shape) {
    ctx.strokeStyle = colors.next;
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 4]);
    next.shape.frets.forEach((f, row) => {
      if (f === null) return;
      dot(ctx, noteX(g, f), rowY(row), r);
      ctx.stroke();
    });
    ctx.setLineDash([]);
  }

  if (!current) return;
  const empty = guitarEmptyText(current);
  if (empty !== null || !current.shape) {
    ctx.textAlign = 'center';
    ctx.font = '600 17px system-ui, sans-serif';
    ctx.fillStyle = colors.textDim;
    ctx.fillText(empty ?? '', g.nutX + (g.fretW * GUITAR_MAX_FRET) / 2, (top + bottom) / 2 + 6);
    return;
  }

  const { frets, barre } = current.shape;
  if (strumming) {
    ctx.globalAlpha = 0.22;
    ctx.fillStyle = colors.hot;
    frets.forEach((f, row) => {
      if (f === null) return;
      dot(ctx, noteX(g, f), rowY(row), r * 1.45);
      ctx.fill();
    });
    ctx.globalAlpha = 1;
  }

  if (barre) {
    ctx.fillStyle = colors.other;
    ctx.beginPath();
    ctx.roundRect(noteX(g, barre.fret) - r * 0.55, rowY(barre.from) - r * 0.55, r * 1.1, rowY(barre.to) - rowY(barre.from) + r * 1.1, r * 0.55);
    ctx.fill();
  }

  ctx.textAlign = 'center';
  frets.forEach((f, row) => {
    const y = rowY(row);
    if (f === null) {
      ctx.fillStyle = colors.textDim;
      ctx.font = `700 ${Math.max(10, 15 * scale)}px system-ui, sans-serif`;
      ctx.fillText('✕', noteX(g, 0), y + 5 * scale);
      return;
    }
    const x = noteX(g, f);
    const degree = current.degrees[row] ?? '';
    dot(ctx, x, y, r);
    if (f === 0) {
      ctx.fillStyle = colors.ground;
      ctx.fill();
      ctx.strokeStyle = colors.other;
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.fillStyle = colors.other;
    } else {
      ctx.fillStyle = colors.other;
      ctx.fill();
      if (degree === 'R') {
        ctx.strokeStyle = colors.text;
        ctx.lineWidth = 3;
        ctx.stroke();
      }
      ctx.fillStyle = colors.onNote;
    }
    ctx.font = `700 ${Math.max(9, 14 * scale)}px system-ui, sans-serif`;
    ctx.fillText(degree, x, y + 5 * scale);
  });
}
```

- [ ] **Step 5: Create `frontend/src/playalong/strumLanePainter.ts`**

```ts
// The strum lane under the guitar neck (D-20): the current bar and the next as
// boxes split into beats and eighths, one ↓ or ↑ chip per stroke, the stroke
// to play now lit, a push stroke ringed and named after the chord it plays,
// and a cursor sweeping the current bar. The beat lane's layout (beatLanePainter)
// with strokes where it has notes.
import type { GuitarBar } from '../music/guitarSource';
import type { PlayAlongColors } from './colors';

export const STRUM_LANE_H = 96;

export interface StrumLaneBar {
  bar: GuitarBar;
  title: string;
}

export function paintStrumLane(
  ctx: CanvasRenderingContext2D,
  width: number,
  colors: PlayAlongColors,
  current: StrumLaneBar | null,
  next: StrumLaneBar | null,
  beatsPerBar: number,
  frac: number,
  hot: number,
): void {
  ctx.clearRect(0, 0, width, STRUM_LANE_H);
  const boxW = (width - 20) / 2;
  const beatW = boxW / beatsPerBar;
  const chipW = Math.max(22, Math.min(62, beatW / 2 - 8));
  const boxes: [StrumLaneBar | null, boolean][] = [
    [current, false],
    [next, true],
  ];

  boxes.forEach(([lane, isNext], i) => {
    const x0 = 10 + i * boxW;
    ctx.fillStyle = isNext ? colors.ground : colors.raised;
    ctx.fillRect(x0 + 3, 22, boxW - 6, 66);
    ctx.strokeStyle = colors.fret;
    ctx.lineWidth = 1;
    ctx.strokeRect(x0 + 3, 22, boxW - 6, 66);
    if (!lane) return;

    ctx.textAlign = 'left';
    ctx.font = '600 13px system-ui, sans-serif';
    ctx.fillStyle = isNext ? colors.textDim : colors.text;
    ctx.fillText(lane.title, x0 + 10, 15, boxW - 20);

    ctx.font = '500 11px ui-monospace, monospace';
    ctx.fillStyle = colors.textDim;
    for (let q = 0; q < beatsPerBar; q++) {
      const x = x0 + q * beatW;
      if (q > 0) {
        ctx.beginPath();
        ctx.moveTo(x, 28);
        ctx.lineTo(x, 82);
        ctx.stroke();
      }
      ctx.fillText(String(q + 1), x + 8, 38);
      ctx.fillText('&', x + beatW / 2 + 4, 38);
    }

    ctx.textAlign = 'center';
    lane.bar.strokes.forEach((s, n) => {
      const cx = x0 + s.beat * beatW + beatW / 4;
      ctx.beginPath();
      ctx.roundRect(cx - chipW / 2, 46, chipW, 34, 17);
      if (isNext) {
        ctx.setLineDash([5, 4]);
        ctx.strokeStyle = colors.textDim;
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.setLineDash([]);
      } else {
        ctx.fillStyle = n === hot ? colors.hot : colors.other;
        ctx.fill();
        if (s.early) {
          ctx.strokeStyle = colors.approach;
          ctx.lineWidth = 3;
          ctx.stroke();
        }
      }
      const arrow = s.dir === 'down' ? '↓' : '↑';
      // A push names the chord it already plays, if the chip has room.
      const text = !isNext && s.early && lane.bar.pushChord && chipW >= 52 ? `${arrow} ${lane.bar.pushChord}` : arrow;
      ctx.font = `700 ${s.accent ? 24 : 22}px system-ui, sans-serif`;
      ctx.fillStyle = isNext ? colors.textDim : colors.onNote;
      ctx.fillText(text, cx, 71);
    });
  });

  if (current) {
    const x = 10 + frac * boxW;
    ctx.strokeStyle = colors.hot;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x, 18);
    ctx.lineTo(x, 92);
    ctx.stroke();
  }
}
```

- [ ] **Step 6: Run the playalong tests and typecheck**

Run: `npm --prefix frontend test -- --run src/playalong && npm --prefix frontend run typecheck`
Expected: PASS, no type errors.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/playalong/colors.ts frontend/src/playalong/neckPainter.test.ts frontend/src/playalong/guitarNeckPainter.ts frontend/src/playalong/guitarNeckPainter.test.ts frontend/src/playalong/strumLanePainter.ts frontend/src/playalong/strumLanePainter.test.ts
git commit -m "feat(tabs): guitar neck and strum lane painters (D-20)"
```

---

### Task 8: Instrument switch and guitar rows in the pattern panel

**Files:**
- Modify: `frontend/src/ui/Segmented.tsx`, `frontend/src/ui/Segmented.module.css`, `frontend/src/ui/Segmented.test.tsx`
- Modify: `frontend/src/playalong/PatternPanel.tsx`, `frontend/src/playalong/PatternPanel.test.tsx`
- Modify: `frontend/src/playalong/PlayAlong.module.css`

**Interfaces:**
- Consumes: `PlayAlong`, `GuitarStyle`, `GuitarStrum`, `GuitarPosition` (Task 1).
- Produces:
  - `SegmentedProps.disabled?: boolean`.
  - `PatternPanel`'s props are unchanged. It now emits `instrument` and `guitar` changes as whole new `PlayAlong` recipes.
  - CSS classes `.check` and `.hint`.

- [ ] **Step 1: Write the failing tests**

Append to `frontend/src/ui/Segmented.test.tsx`:

```tsx
test('a disabled group shows its value but ignores clicks', async () => {
  const onChange = vi.fn();
  render(<Segmented label="Instrument" value="bass" options={OPTIONS} onChange={onChange} disabled />);
  expect(screen.getByRole('button', { name: /bass/i })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByRole('button', { name: /guitar/i })).toBeDisabled();
  await userEvent.click(screen.getByRole('button', { name: /guitar/i }));
  expect(onChange).not.toHaveBeenCalled();
});
```

In `frontend/src/playalong/PatternPanel.test.tsx`, add these two tests inside the `describe('PatternPanel', …)` block, after the last existing test:

```tsx
  it('swaps the bass rows for the guitar rows, and keeps each instrument\'s settings', async () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <PatternPanel candidates={candidates} value={DEFAULT_PLAY_ALONG} onChange={onChange} pitchSemitones={0} />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Guitar' }));
    const guitar = onChange.mock.lastCall![0];
    expect(guitar).toEqual({ ...DEFAULT_PLAY_ALONG, instrument: 'guitar' });

    rerender(<PatternPanel candidates={candidates} value={guitar} onChange={onChange} pitchSemitones={0} />);
    expect(screen.queryByRole('group', { name: 'Notes' })).not.toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Style' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Barre' }));
    expect(onChange).toHaveBeenLastCalledWith({ ...guitar, guitar: { ...guitar.guitar, style: 'barre' } });
    await userEvent.click(screen.getByRole('button', { name: 'Push' }));
    expect(onChange.mock.lastCall![0].guitar.strum).toBe('push');
    await userEvent.click(screen.getByRole('checkbox', { name: /triads/ }));
    expect(onChange.mock.lastCall![0].guitar.simplify).toBe(true);
    // The bass pattern rides along untouched.
    expect(onChange.mock.lastCall![0].pattern).toEqual(DEFAULT_PLAY_ALONG.pattern);
  });

  it('greys Position out for open chords and says why, keeping its value', () => {
    const guitar = { ...DEFAULT_PLAY_ALONG, instrument: 'guitar' as const, guitar: { ...DEFAULT_PLAY_ALONG.guitar, position: 'mid' as const } };
    const { rerender } = render(<PatternPanel candidates={candidates} value={guitar} onChange={vi.fn()} pitchSemitones={0} />);
    expect(screen.getByRole('button', { name: 'Mid' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Mid' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('open shapes sit at frets 0–4')).toBeInTheDocument();
    const barre = { ...guitar, guitar: { ...guitar.guitar, style: 'barre' as const } };
    rerender(<PatternPanel candidates={candidates} value={barre} onChange={vi.fn()} pitchSemitones={0} />);
    expect(screen.getByRole('button', { name: 'Mid' })).toBeEnabled();
    expect(screen.queryByText('open shapes sit at frets 0–4')).not.toBeInTheDocument();
  });
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npm --prefix frontend test -- --run src/ui/Segmented.test.tsx src/playalong/PatternPanel.test.tsx`
Expected: FAIL. The guitar button is not disabled, and there is no `Guitar` button.

- [ ] **Step 3: Add `disabled` to `Segmented`**

Replace `frontend/src/ui/Segmented.tsx` with:

```tsx
import type { ReactNode } from 'react';

import styles from './Segmented.module.css';

export interface SegmentedOption<T extends string> {
  value: T;
  label: ReactNode;
}

export interface SegmentedProps<T extends string> {
  /** Accessible name for the group, e.g. "Instrument". */
  label: string;
  value: T;
  options: readonly SegmentedOption<T>[];
  onChange: (value: T) => void;
  className?: string;
  /** Greys the whole group out and ignores clicks; the value is still shown. */
  disabled?: boolean;
}

export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  className,
  disabled = false,
}: SegmentedProps<T>) {
  return (
    <div className={[styles.seg, className].filter(Boolean).join(' ')} role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className={styles.item}
          aria-pressed={option.value === value}
          disabled={disabled}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
```

Append to `frontend/src/ui/Segmented.module.css`:

```css
.item:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.item:disabled:hover { color: var(--ds-text-2); }
```

- [ ] **Step 4: Rewrite `PatternPanel.tsx`**

Replace the whole file with:

```tsx
// The Tabs pattern panel: the instrument, the key to think in, then that
// instrument's choices. Bass (D-18): notes, rhythm, approach. Guitar (D-20):
// style, strum, position, simplify. Each instrument keeps its own settings
// while the other is shown. Every change is a whole new play_along recipe,
// saved through the session's one funnel.
import type {
  GuitarPosition,
  GuitarStrum,
  GuitarStyle,
  KeyCandidate,
  PatternApproach,
  PatternNotes,
  PatternRhythm,
  PlayAlong,
} from '../api/client';
import { keyName, resolveKey } from '../music/patterns';
import { Segmented } from '../ui';
import styles from './PlayAlong.module.css';

const INSTRUMENT: { value: PlayAlong['instrument']; label: string }[] = [
  { value: 'bass', label: 'Bass' },
  { value: 'guitar', label: 'Guitar' },
];
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
const STYLE: { value: GuitarStyle; label: string }[] = [
  { value: 'open', label: 'Open' },
  { value: 'barre', label: 'Barre' },
  { value: 'power', label: 'Power' },
  { value: 'triad', label: 'Triad' },
];
const STRUM: { value: GuitarStrum; label: string }[] = [
  { value: 'whole', label: 'Whole' },
  { value: 'half', label: 'Half' },
  { value: 'quarters', label: 'Quarters' },
  { value: 'eighths', label: 'Eighths' },
  { value: 'folk', label: 'Folk' },
  { value: 'push', label: 'Push' },
];
const POSITION: { value: GuitarPosition; label: string }[] = [
  { value: 'auto', label: 'Auto' },
  { value: 'low', label: 'Low' },
  { value: 'mid', label: 'Mid' },
];

const keyId = (k: { tonic: string; mode: string }) => `${k.tonic}:${k.mode}`;

export interface PatternPanelProps {
  candidates: KeyCandidate[];
  value: PlayAlong;
  onChange(next: PlayAlong): void;
  /** The song's playback pitch; key labels are shown as heard. */
  pitchSemitones: number;
}

export function PatternPanel({ candidates, value, onChange, pitchSemitones }: PatternPanelProps) {
  const chosenKey = value.key ?? candidates[0] ?? null;
  const setPattern = (patch: Partial<PlayAlong['pattern']>) =>
    onChange({ ...value, pattern: { ...value.pattern, ...patch } });
  const setGuitar = (patch: Partial<PlayAlong['guitar']>) => onChange({ ...value, guitar: { ...value.guitar, ...patch } });
  const openShapes = value.guitar.style === 'open';

  return (
    <div className={styles.pickers}>
      <div className={styles.picker}>
        <span className={styles.caption}>Instrument</span>
        <Segmented
          label="Instrument"
          value={value.instrument}
          options={INSTRUMENT}
          onChange={(instrument) => onChange({ ...value, instrument })}
        />
      </div>
      {candidates.length > 0 && chosenKey && (
        <div className={styles.picker}>
          <span className={styles.caption}>Key</span>
          <Segmented
            label="Key"
            value={keyId(chosenKey)}
            options={candidates.map((c) => ({
              value: keyId(c),
              label: `${keyName(resolveKey(c, [], pitchSemitones)!)} ${Math.round(c.confidence * 100)}%`,
            }))}
            onChange={(id) => {
              const picked = candidates.find((c) => keyId(c) === id);
              if (picked) onChange({ ...value, key: { tonic: picked.tonic, mode: picked.mode } });
            }}
          />
        </div>
      )}
      {value.instrument === 'bass' ? (
        <>
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
        </>
      ) : (
        <>
          <div className={styles.picker}>
            <span className={styles.caption}>Style</span>
            <Segmented label="Style" value={value.guitar.style} options={STYLE} onChange={(style) => setGuitar({ style })} />
          </div>
          <div className={styles.picker}>
            <span className={styles.caption}>Strum</span>
            <Segmented label="Strum" value={value.guitar.strum} options={STRUM} onChange={(strum) => setGuitar({ strum })} />
          </div>
          <div className={styles.picker}>
            <span className={styles.caption}>Position</span>
            <Segmented
              label="Position"
              value={value.guitar.position}
              options={POSITION}
              onChange={(position) => setGuitar({ position })}
              disabled={openShapes}
            />
            {openShapes && <span className={styles.hint}>open shapes sit at frets 0–4</span>}
          </div>
          <div className={styles.picker}>
            <span className={styles.caption}>Simplify</span>
            <label className={styles.check}>
              <input
                type="checkbox"
                checked={value.guitar.simplify}
                onChange={(event) => setGuitar({ simplify: event.target.checked })}
              />
              7ths &amp; 6ths → triads
            </label>
          </div>
        </>
      )}
    </div>
  );
}
```

Append to `frontend/src/playalong/PlayAlong.module.css`:

```css
.check {
  display: inline-flex;
  align-items: center;
  gap: var(--ds-2);
  min-height: 40px;
  font-size: var(--ds-t-md);
  cursor: pointer;
}

.check input {
  width: 20px;
  height: 20px;
  accent-color: var(--ds-accent);
}

.hint {
  font-size: var(--ds-t-xs);
  color: var(--ds-text-3);
}
```

- [ ] **Step 5: Run the tests and typecheck**

Run: `npm --prefix frontend test -- --run src/ui src/playalong && npm --prefix frontend run typecheck`
Expected: PASS, no type errors.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/ui/Segmented.tsx frontend/src/ui/Segmented.module.css frontend/src/ui/Segmented.test.tsx frontend/src/playalong/PatternPanel.tsx frontend/src/playalong/PatternPanel.test.tsx frontend/src/playalong/PlayAlong.module.css
git commit -m "feat(tabs): Bass/Guitar switch, guitar style, strum, position and simplify pickers (D-20)"
```

---

### Task 9: The Tabs screen in guitar mode

**Files:**
- Create: `frontend/src/playalong/GuitarNeck.tsx`
- Create: `frontend/src/playalong/StrumLane.tsx`
- Modify: `frontend/src/screens/PlayAlong.tsx` (replace)
- Modify: `frontend/src/screens/PlayAlong.test.tsx`

**Interfaces:**
- Consumes:
  - `guitarSource`, `guitarSummaries`, `describeGuitarBar`, `strokeIndexAt`, `guitarChordText` (Task 5).
  - The painters (Task 7) and `useParentWidth` (`Neck.tsx`).
  - `usePlayhead(getPosition, paint, playing, seekNonce)`.
  - `bassSummaries` (Task 5), and `NowReadout` and `ChordRibbon` (Task 6).
- Produces:
  - `<GuitarNeck bars nextOf grid getPosition playing seekNonce />`: `data-testid="guitar-neck-canvas"`, `aria-label` like "Bar 1, G: 320003. Next: Bar 2, C: x32010".
  - `<StrumLane bars nextOf grid strum getPosition playing seekNonce />`: `data-testid="strum-lane-canvas"`.

- [ ] **Step 1: Write the failing screen test**

In `frontend/src/screens/PlayAlong.test.tsx`, insert this test directly before `it('saves a pattern change to song.json', …)`:

```tsx
  it('shows the guitar neck, a strum lane and the other-stem note in guitar mode', async () => {
    songEntry.song.play_along.instrument = 'guitar';
    try {
      renderAt('/songs/abc123/play');
      const neck = await screen.findByTestId('guitar-neck-canvas');
      await waitFor(() => expect(neck.getAttribute('aria-label')).toBe('Bar 1, G: 320003. Next: Bar 2, C: x32010'));
      expect(screen.getByTestId('strum-lane-canvas')).toBeInTheDocument();
      expect(screen.queryByTestId('neck-canvas')).not.toBeInTheDocument();
      expect(screen.getByText(/shares the other stem/i)).toBeInTheDocument();
      expect(screen.getByRole('group', { name: 'Style' })).toBeInTheDocument();
    } finally {
      songEntry.song.play_along.instrument = 'bass';
    }
  });

```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm --prefix frontend test -- --run src/screens/PlayAlong.test.tsx`
Expected: FAIL, unable to find `[data-testid="guitar-neck-canvas"]`.

- [ ] **Step 3: Create `frontend/src/playalong/GuitarNeck.tsx`**

```tsx
// The guitar Tabs neck (D-20): this bar's shape and the next, painted from the
// engine clock through usePlayhead, never from React state at audio rate
// (U-05). It draws; it never plays (D-07). It repaints only when the bar, the
// stroke under the playhead, the width or the bars themselves change.
import { useCallback, useRef } from 'react';

import type { SampleIndex } from '../engine/types';
import { beatPosition, type Grid } from '../music/grid';
import { describeGuitarBar, strokeIndexAt, type GuitarBar } from '../music/guitarSource';
import { usePlayhead } from '../songview/usePlayhead';
import { playAlongColors, type PlayAlongColors } from './colors';
import { GUITAR_NECK_H, paintGuitarNeck } from './guitarNeckPainter';
import { useParentWidth } from './Neck';
import styles from './PlayAlong.module.css';

export interface GuitarNeckProps {
  bars: GuitarBar[];
  nextOf(bar: number): number | null;
  grid: Grid;
  getPosition(): SampleIndex;
  playing: boolean;
  seekNonce: number;
}

export function GuitarNeck({ bars, nextOf, grid, getPosition, playing, seekNonce }: GuitarNeckProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const width = useParentWidth(canvasRef);
  const colors = useRef<PlayAlongColors | null>(null);
  const last = useRef<{ bars: GuitarBar[]; bar: number; hot: number; width: number } | null>(null);

  const paint = useCallback(
    (position: SampleIndex) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const at = beatPosition(grid, position);
      const barIndex = at?.bar ?? -1;
      const current = at ? bars[at.bar] : undefined;
      const hot = current && at ? strokeIndexAt(current, at.frac * grid.beatsPerBar) : -1;
      const seen = last.current;
      if (seen && seen.bars === bars && seen.bar === barIndex && seen.hot === hot && seen.width === width) return;

      const nextIndex = at ? nextOf(at.bar) : null;
      const next = nextIndex === null ? undefined : bars[nextIndex];
      canvas.setAttribute(
        'aria-label',
        at ? `${describeGuitarBar(current)}. Next: ${describeGuitarBar(next)}` : 'Before the first bar',
      );

      const dpr = window.devicePixelRatio || 1;
      if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(GUITAR_NECK_H * dpr)) {
        canvas.width = Math.round(width * dpr);
        canvas.height = Math.round(GUITAR_NECK_H * dpr);
        canvas.style.height = `${GUITAR_NECK_H}px`;
      }
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      last.current = { bars, bar: barIndex, hot, width };
      colors.current ??= playAlongColors();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      paintGuitarNeck(ctx, width, colors.current, current ?? null, next ?? null, hot >= 0);
    },
    [bars, nextOf, grid, width],
  );
  usePlayhead(getPosition, paint, playing, seekNonce);

  return <canvas ref={canvasRef} className={styles.canvas} data-testid="guitar-neck-canvas" role="img" aria-label="Guitar neck" />;
}
```

- [ ] **Step 4: Create `frontend/src/playalong/StrumLane.tsx`**

```tsx
// The strum lane (D-20). Repaints every frame while playing, since the cursor
// moves continuously; all of it from the engine clock (U-05), none of it audio
// (D-07). aria-hidden: the neck's label already says what this bar holds.
import { useCallback, useRef } from 'react';

import type { SampleIndex } from '../engine/types';
import { beatPosition, type Grid } from '../music/grid';
import { guitarChordText, strokeIndexAt, type GuitarBar } from '../music/guitarSource';
import { usePlayhead } from '../songview/usePlayhead';
import { playAlongColors, type PlayAlongColors } from './colors';
import { useParentWidth } from './Neck';
import styles from './PlayAlong.module.css';
import { paintStrumLane, STRUM_LANE_H } from './strumLanePainter';

export interface StrumLaneProps {
  bars: GuitarBar[];
  nextOf(bar: number): number | null;
  grid: Grid;
  /** The strum's name, for the lane title ("folk"). */
  strum: string;
  getPosition(): SampleIndex;
  playing: boolean;
  seekNonce: number;
}

export function StrumLane({ bars, nextOf, grid, strum, getPosition, playing, seekNonce }: StrumLaneProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const width = useParentWidth(canvasRef);
  const colors = useRef<PlayAlongColors | null>(null);

  const paint = useCallback(
    (position: SampleIndex) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const dpr = window.devicePixelRatio || 1;
      if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(STRUM_LANE_H * dpr)) {
        canvas.width = Math.round(width * dpr);
        canvas.height = Math.round(STRUM_LANE_H * dpr);
        canvas.style.height = `${STRUM_LANE_H}px`;
      }
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      colors.current ??= playAlongColors();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const at = beatPosition(grid, position);
      const current = at ? bars[at.bar] : undefined;
      const nextIndex = at ? nextOf(at.bar) : null;
      const next = nextIndex === null ? undefined : bars[nextIndex];
      paintStrumLane(
        ctx,
        width,
        colors.current,
        current ? { bar: current, title: `Bar ${current.bar + 1} · ${guitarChordText(current)} · ${strum}` } : null,
        next ? { bar: next, title: `Next · bar ${next.bar + 1} · ${guitarChordText(next)}` } : null,
        grid.beatsPerBar,
        at?.frac ?? 0,
        current && at ? strokeIndexAt(current, at.frac * grid.beatsPerBar) : -1,
      );
    },
    [bars, nextOf, grid, strum, width],
  );
  usePlayhead(getPosition, paint, playing, seekNonce);

  return <canvas ref={canvasRef} className={styles.canvas} data-testid="strum-lane-canvas" aria-hidden="true" />;
}
```

- [ ] **Step 5: Replace `frontend/src/screens/PlayAlong.tsx`**

```tsx
// frontend/src/screens/PlayAlong.tsx
// The Tabs content of the song screen (D-18, D-20): where Stems shows the
// audio, this shows what to play in this bar and the next, generated from the
// chord chart. For bass, a neck of notes and a beat lane (patternSource); for
// guitar, a neck with the chord shape and a strum lane (guitarSource). It
// shares the song session (and so the engine, and the transport above it)
// with Stems, so switching between them never stops the music.
//
// Both are arithmetic over detected chords: exact given the chords, but the
// chords are probabilistic (R-05). The banner says so, and every empty or
// substituted bar is labelled rather than guessed (N-08).
import { useMemo } from 'react';

import { guitarSource, guitarSummaries } from '../music/guitarSource';
import { bassSummaries, patternSource } from '../music/tabSource';
import { BeatLane } from '../playalong/BeatLane';
import { ChordRibbon } from '../playalong/ChordRibbon';
import { GuitarNeck } from '../playalong/GuitarNeck';
import { Neck } from '../playalong/Neck';
import { NowReadout } from '../playalong/NowReadout';
import { PatternPanel } from '../playalong/PatternPanel';
import styles from '../playalong/PlayAlong.module.css';
import { StrumLane } from '../playalong/StrumLane';
import { useSongSession } from '../session/SongSession';
import { Banner, EmptyState, Panel } from '../ui';

export function PlayAlong() {
  const session = useSongSession();
  const { analysis, notAnalyzedYet, grid, song, engine, playing, loopArmed, seekNonce, getPosition } = session;

  const loopStart = song?.active_loop?.start_bar ?? null;
  const loopEnd = song?.active_loop?.end_bar ?? null;
  const armedLoop = useMemo(
    () => (loopArmed && loopStart !== null && loopEnd !== null ? { startBar: loopStart, endBar: loopEnd } : null),
    [loopArmed, loopStart, loopEnd],
  );

  const guitar = song?.play_along.instrument === 'guitar';
  const bass = useMemo(
    () => (!guitar && song && analysis && grid ? patternSource.barsFor({ song, analysis, grid, loop: armedLoop }) : null),
    [guitar, song, analysis, grid, armedLoop],
  );
  const strums = useMemo(
    () => (guitar && song && analysis && grid ? guitarSource.barsFor({ song, analysis, grid, loop: armedLoop }) : null),
    [guitar, song, analysis, grid, armedLoop],
  );
  const result = bass ?? strums;
  const summaries = useMemo(() => {
    if (bass?.ok) return bassSummaries(bass.bars, bass.key);
    if (strums?.ok) return guitarSummaries(strums.bars);
    return null;
  }, [bass, strums]);

  // The transport above still plays; only this content has nothing to draw.
  if (notAnalyzedYet) {
    return (
      <EmptyState title="This song needs analysis">
        Tabs are built from the chord chart and the beat grid, which appear after analysis.
      </EmptyState>
    );
  }
  // Loading and engine errors are SongScreen's to say.
  if (!engine || !song) return null;

  return (
    <>
      {analysis && !grid && (
        <Banner tone="error" title="The beat grid is unusable">
          The analysis found fewer than two downbeats, so there are no bars to play along to.
        </Banner>
      )}
      {result && !result.ok && <Banner tone="error" title="No patterns" trace={result.error} />}

      {grid && result?.ok && summaries && (
        <>
          <Panel className={styles.panel}>
            <PatternPanel
              candidates={analysis?.key_candidates ?? []}
              value={song.play_along}
              onChange={session.onPlayAlongChange}
              pitchSemitones={song.playback.pitch_semitones}
            />
          </Panel>

          <Panel className={styles.panel}>
            <NowReadout
              bars={summaries}
              nextOf={result.nextOf}
              instrument={song.play_along.instrument}
              grid={grid}
              pitchSemitones={song.playback.pitch_semitones}
              getPosition={getPosition}
              playing={playing}
              seekNonce={seekNonce}
            />
            <div className={styles.board}>
              {bass?.ok && (
                <>
                  <Neck
                    bars={bass.bars}
                    nextOf={bass.nextOf}
                    songKey={bass.key}
                    grid={grid}
                    getPosition={getPosition}
                    playing={playing}
                    seekNonce={seekNonce}
                  />
                  <BeatLane
                    bars={bass.bars}
                    nextOf={bass.nextOf}
                    songKey={bass.key}
                    grid={grid}
                    getPosition={getPosition}
                    playing={playing}
                    seekNonce={seekNonce}
                  />
                </>
              )}
              {strums?.ok && (
                <>
                  <GuitarNeck
                    bars={strums.bars}
                    nextOf={strums.nextOf}
                    grid={grid}
                    getPosition={getPosition}
                    playing={playing}
                    seekNonce={seekNonce}
                  />
                  <StrumLane
                    bars={strums.bars}
                    nextOf={strums.nextOf}
                    grid={grid}
                    strum={song.play_along.guitar.strum}
                    getPosition={getPosition}
                    playing={playing}
                    seekNonce={seekNonce}
                  />
                </>
              )}
            </div>
            <ChordRibbon
              bars={summaries}
              loop={song.active_loop}
              grid={grid}
              getPosition={getPosition}
              playing={playing}
              seekNonce={seekNonce}
              onLoopBars={session.onLoopBars}
              onSeekBar={session.onSeekBar}
            />
          </Panel>

          {guitar && (
            <Banner tone="warn" title="Guitar shares the other stem with keys and synths">
              It cannot be separated on its own, so turn other down rather than muting it.
            </Banner>
          )}
          <Banner tone="warn" role="note" title="A practice pattern over the detected chords, not a transcription">
            {guitar
              ? 'These shapes are generated from the chord chart and the style you pick. The arithmetic is exact, but the chords themselves are detected and can be wrong. A bar with no chord shows an empty neck saying so, and a substituted shape says what it replaced; nothing is guessed.'
              : 'These notes are generated from the chord chart and the key you pick. The arithmetic is exact, but the chords themselves are detected and can be wrong. A bar with no chord shows an empty neck saying so; nothing is guessed.'}
          </Banner>
        </>
      )}
    </>
  );
}
```

- [ ] **Step 6: Run everything**

Run: `npm --prefix frontend test -- --run && npm --prefix frontend run typecheck`
Expected: all pass (about 1170 tests), no type errors.

- [ ] **Step 7: Check it in the running app**

Start the API, the worker and the dev server as the `dev-setup` skill describes. Open an analyzed song's Tabs view and click **Guitar**. Then check:
- The neck shows a shape with degree labels, and the strum lane chips light in time while playing.
- Changing Style, Strum, Position and Simplify redraws at once and survives a reload (`song.json` v4).
- Style = Open greys out Position.
- A substitution chip appears for a chord the style can't play (e.g. F in Open).
- Switching back to **Bass** shows the old pattern unchanged.

Check the browser console for errors.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/playalong/GuitarNeck.tsx frontend/src/playalong/StrumLane.tsx frontend/src/screens/PlayAlong.tsx frontend/src/screens/PlayAlong.test.tsx
git commit -m "feat(tabs): guitar mode, chord shapes on a 6-string neck with a strum lane (D-20)"
```

---

### Task 10: Decisions, docs, README and screenshot, then push

**Files:**
- Modify: `design/tech-spec-stemcraft.md` (D-20 after D-19; one line on D-18)
- Modify: `docs/superpowers/specs/2026-09-29-play-along-design.md` (non-goal note)
- Modify: `design/domain-spec.md`
- Modify: `design/ui-spec.md`
- Modify: `README.md`
- Create: `docs/screenshots/play-along-guitar.png`

- [ ] **Step 1: Record D-20 and amend D-18**

In `design/tech-spec-stemcraft.md`, insert this directly after the D-19 entry (after its `Design:` line):

```markdown
- **D-20 — Guitar Tabs are generated chord shapes and strums, beside the bass patterns.**
  The Tabs view gets a Bass | Guitar switch. In guitar mode each bar's detected chord
  is drawn as a shape on a 6-string, 12-fret neck in standard tuning, with a strum lane
  under it, all generated in the browser (`music/guitarChords.ts`, `guitarShapes.ts`,
  `strums.ts`, `guitarSource.ts`) behind the same `TabSource` seam as the bass
  patterns. The recipe is `play_along.instrument` and `play_along.guitar` (style, strum,
  position, simplify) in `song.json` v4; nothing derived is stored. A Viterbi pass picks
  one shape per bar to keep the hand still. Every fallback (a style with no shape, a
  position window with none, a simplified chord, a push into nothing) is drawn as a
  substitution (N-08).
  *Because:* the voicing search already existed (D-19), and rhythm guitar over a chord
  chart is what a guitarist practises against. Guitar stays in the `other` stem and
  cannot be separated; the screen says so.
  *Rejected:* picked arpeggios (duplicates the bass mode); generalising the bass
  pipeline to chords (bends `BarNotes` and risks the working bass fingering); embedding
  the Theory Chord finder (not slaved to the playback clock); sharing the Theory
  instrument (reverses D-19); guitar tunings (pitch shift covers them, as for bass).
  *Reversibility:* two-way. The `song.json` fields are additive (v3 → v4).
  Design: `docs/superpowers/specs/2026-10-01-guitar-tabs-design.md`.
```

In the D-18 entry, directly after its last line (`Design: \`docs/superpowers/specs/2026-09-29-play-along-design.md\`.`), add:

```markdown
  *Amended 2026-10-01 by D-20:* guitar is no longer a non-goal; the pitch-shift-instead-of-tunings stance stands.
```

In `docs/superpowers/specs/2026-09-29-play-along-design.md`, change the non-goal bullet `- **Other tunings, 5-string, guitar.** …` so it starts with `- **Other tunings, 5-string.** (Guitar: since 2026-10-01, D-20 and \`2026-10-01-guitar-tabs-design.md\`.)` and keep the rest of the bullet.

- [ ] **Step 2: Domain and UI spec**

In `design/domain-spec.md`:
- Directly after the `### Play along: bass patterns` section's bullet list, add:

```markdown
### Play along: guitar chords and strums

The same Tabs view, switched to **Guitar** (per song). Design:
`docs/superpowers/specs/2026-10-01-guitar-tabs-design.md`.

- **Live neck:** a 12-fret 6-string neck in standard tuning. This bar's chord shape is
  drawn with the chord degree on each string, open strings as rings and muted ones as ✕;
  the next bar's shape is hollow. The shape lights on every stroke.
- **Strum lane:** the current and next bar as down and up strokes on the eighth notes, with a cursor sweeping in time.
- **Style:** open chords, barre chords (E and A shapes), power chords or triads on the top strings
- **Strum:** whole, half, quarters, eighths, folk, or push (the last up-stroke plays the next chord an eighth early, also into the loop start)
- **Position:** auto, low (frets 0–5) or mid (5–9); shapes are chosen across the song to keep the hand still
- **Simplify:** 7ths and 6ths reduced to triads
- **Honest about the shapes:** a chord a style can't play falls back to another style, a chord outside the position window is drawn where it can be, and each says so. A chord no style can play shows an empty neck saying so.
- **Guitar can't be separated:** it is in the *other* stem with keys and synths, so turn *other* down rather than muting it. The screen says so.
```

- Change the bullet `- Guitar, other tunings and a tab or Guitar Pro export are later work` to `- Other tunings and a tab or Guitar Pro export are later work`.
- In `## Backlog`, change `- Guitar tabs` to `- Guitar transcription (the generated shapes and strums cover practising over the chords)`.

In `design/ui-spec.md`, in the song screen paragraph, change `**Tabs** is the play-along content: key and pattern pickers,` to `**Tabs** is the play-along content: a Bass | Guitar switch, key and pattern pickers (bass: notes, rhythm, approach; guitar: style, strum, position, simplify),`. In that same paragraph, change `the neck, the beat lane and the chord ribbon` to `the neck (4-string notes, or a 6-string chord shape in the other-stem colour), the beat lane (or strum lane) and the chord ribbon. Mockup for guitar: \`design/ui/src/pages/screens/play-along-guitar.html\``.

- [ ] **Step 3: README**

In `README.md`, directly after the `- Tabs view for bass: …` bullet (which ends `…by Ctrl- and Shift-clicking the ribbon`), add:

```markdown
- Tabs view for guitar: switch Tabs to Guitar and each bar's chord is a shape on a
  6-string neck, with the chord degree on every string, and a strum lane showing when
  to hit it. Pick the style (open, barre, power chords, triads), the strum (whole to
  eighths, folk, or push into the next chord), the neck position, and whether 7ths
  and 6ths are simplified to triads. Shapes are chosen across the song to keep the hand
  still, follow the pitch shift, and every substitution is labelled
```

In `## Screens`:
- Add `![Song screen — Tabs, guitar](docs/screenshots/play-along-guitar.png)` after the Tabs line.
- Change `All nine are captures` to `All ten are captures`.
- Add `play-along-guitar=/songs/<id>/play` to the capture command, after `play-along=/songs/<id>/play`.
- After the sentence ending `…pause again).`, add: `For the guitar capture, switch that song's Tabs to Guitar first (it is saved per song) and back to Bass after.`

- [ ] **Step 4: Capture the screenshot**

With the API, worker and dev server running (`dev-setup` skill), open an analyzed song's Tabs view and click **Guitar**. Then run:

```bash
node scripts/capture-screens.mjs play-along-guitar=/songs/<id>/play
```

Open `docs/screenshots/play-along-guitar.png` and check that it shows the guitar neck, the strum lane and the pickers. Switch the song back to **Bass**.

- [ ] **Step 5: Full verification**

Run: `uv run pytest -q -p no:warnings && uv run ruff check packages ops && npm --prefix frontend test -- --run && npm --prefix frontend run typecheck`
Expected: all pass.

- [ ] **Step 6: Commit and push**

```bash
git add design/tech-spec-stemcraft.md design/domain-spec.md design/ui-spec.md docs/superpowers/specs/2026-09-29-play-along-design.md README.md docs/screenshots/play-along-guitar.png
git commit -m "docs: guitar Tabs (D-20), README and screenshot"
git push origin main
```

- [ ] **Step 7: Design system sync (user)**

The mockups are already in `design/ui/src`. Tell the user to run `/design-sync` to push `screens/play-along.html` and `screens/play-along-guitar.html` to the Claude Design project **Stemcraft**. Claude must not run that sync itself.
