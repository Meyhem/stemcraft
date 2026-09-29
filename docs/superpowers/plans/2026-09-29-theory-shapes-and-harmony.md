# Theory Shapes and Harmony Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the rest of the Theory tab's reference tools:
- guitar voicing cards and bass arpeggio cards in Chord finder;
- Scale positions, Triads & inversions and Arpeggios;
- Name that chord;
- Circle of fifths, Progressions and Scales over a chord.

**Architecture:**
- **Logic:** all of it is pure TypeScript in `frontend/src/music/`, computed from pitches and the tuning, so drop and open tunings get correct shapes. Nothing comes from a chord dictionary.
  - `voicings.ts`: guitar voicings found by search and checked by `isPlayable`, plus bass arpeggio shapes.
  - `shapes.ts`: pentatonic boxes, three-notes-per-string patterns, CAGED windows (standard tuning only) and triad inversions.
  - `identify.ts`: chord names from notes, ranked.
  - `harmony.ts`: which scales fit a chord, and a chord's numeral in a key.
- **UI:** each tool is one component in `frontend/src/theory/tools/`, registered in `tools.ts`. They all reuse `TheoryNeck`, the shared selection and the controls from the foundation phase. There are no backend changes.

**Tech Stack:** React 19, React Router 7, TanStack Query 5, tonal 6.4.3, Vitest + RTL (`npm --prefix frontend test`), CSS modules over `tokens.css`.

**Spec:** [docs/superpowers/specs/2026-09-29-music-theory-design.md](../specs/2026-09-29-music-theory-design.md) (tools 2 and 4–11). D-19, U-13. **Depends on** [2026-09-29-theory-foundation.md](2026-09-29-theory-foundation.md) being done: it provides `spell.ts`, `tuning.ts`, `positions.ts`, `progressions.ts`, `TheoryNeck`, `neckDots`, `selection`, `TheoryDoc`, `controls`, `useChosenSong`, `CircleOfFifths`, `tools.ts`, `Theory.module.css` and the `renderTool` test helper.

## Global Constraints

- **No backend change.** Nothing new is written to `theory.json` or anywhere else. Shapes, voicings, names and fits are derived on every render.
- **Only `frontend/src/music/` imports tonal**, pinned at `6.4.3`.
- **Fail loudly (N-08).**
  - CAGED in a non-standard tuning, 3-notes-per-string on bass or on a non-7-note scale, and pentatonic boxes on a non-5-note scale are **disabled buttons whose `title` gives the reason**, not hidden.
  - Notes with no chord name are listed with their intervals, not forced into a name.
  - A song chord outside the key is labelled **borrowed**, not given a numeral.
  - "No playable voicing" is said out loud.
- **Colours (U-13):** root dots take the bass hue (via `TheoryNeck`'s `root` marker), tapped notes in Name that chord are `accent`, and dots outside a shape are `dim`. No new stylesheet names a stem hue.
- **Neck rows:** row 0 is the highest string. Tunings are stored low string first.
- **Voicing rules** (`isPlayable`, and what the tests assert):
  - The sounding strings form one unbroken run of at least 4.
  - The lowest note is the chord's bass (the root, or the slash note).
  - Every chord tone sounds. A chord of 4+ notes may drop its 5th. No other notes sound.
  - Fretted notes span at most 4 frets and need at most 4 fingers, where a barre counts as one finger.
- Match the surrounding style: header comments explain *why* and cite spec IDs.
- **Commits:**
  - Commit after every task, ending the message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
  - Work on `main`, and push once, at the end of Task 11.
  - Stage **only the files the task lists**.


> **As shipped (read this before the task text):** this plan was executed with a review after every task and a whole-branch review at the end. The code blocks below are the *starting prototypes*; review-driven changes made the shipped code differ. The ledger of rulings and per-task reports lived in the git-ignored `.superpowers/sdd/` workspaces; the differences that matter are:
- T1: `isPlayable` rejects any open string inside the lowest-fret barre span (F major's first card is 133211); the validity test uses an independent oracle.
- T2: `cardStart` keeps every fretted note inside the 5-fret window (unit-tested); changes were applied on top of the committed Chord finder, not by replacing it.
- T3: `perStringShape` enforces `maxFret`; boxes/patterns that cannot fit are dropped but keep their numbers (`Box 4` may be the first box); guards for an empty scale or bad start; invariant tests over every root, scale and tuning.
- T4: `systems()` marks a system unavailable when its shapes are empty (with a reason); `SystemDef` is exported; step buttons carry the shapes' own numbers (`short`).
- T5: Triads derives the triad from the selected chord (`triadIn`), says when it shows the triad inside a 7th, alerts when there is none (sus/power), and a 5-string bass offers all three adjacent string sets; the chosen set is keyed by tuning; `.chip:disabled` styling.
- T6: Arpeggios shows the `chordLinkProblem` alert, a status line naming chord tones a 4-fret box lacks, disables Play order until a position is chosen, and breaks ties lower-string-first.
- T7: `nameChord` re-reads every tonal candidate through `chordInfo` (tonal's `Chord.detect` returns wrong names), rewrites `m/ma7`, respells roots; `TheoryNeck` string names disambiguated by octave; stale taps are cleared with a notice when the tuning changes.
- T8: `numeralInKey` requires every chord tone in the key, returns `Xsus2`/`Xsus4` numerals for sus chords, and accepts the harmonic-minor V/V7 and vii°/vii°7 in minor keys; null means outside the key (borrowed). Scales over a chord keys its pick by chord and shows the link alert.
- T9: Circle neighbours keep the selected mode and derive from the pitch class; keys needing more than 7 accidentals are shown respelled, with a note.
- T10: the D7-in-G-minor 'borrowed' test is obsolete (it is `V`); unreadable song chords read `unreadable`, never `borrowed`; a song that is not usable shows its state; stock minor progressions spell roots with the minor table; the help text notes that no-chord bars are left out.
- T11: `capture-screens.mjs` gives the Theory shots a 960 px viewport.

---

## File map

| File | Responsibility |
|---|---|
| `frontend/src/music/voicings.ts` | `guitarVoicings`, `isPlayable`, `tabOf`, `bassArpeggios` |
| `frontend/src/music/shapes.ts` | `perStringShape`, `pentatonicBoxes`, `threeNotesPerString`, `cagedWindows`, `stringSets`, `triadShapes` |
| `frontend/src/music/identify.ts` | `nameChord` |
| `frontend/src/music/harmony.ts` | `scalesOverChord`, `numeralInKey` |
| `frontend/src/theory/ShapeCard.tsx` | A 5-fret zoomed neck card; `cardStart` |
| `frontend/src/theory/chordDots.ts` | Voicing and arpeggio dots |
| `frontend/src/theory/Theory.module.css` | + shape-card and list styles |
| `frontend/src/theory/tools/ChordFinder.tsx` | + voicing and arpeggio cards |
| `frontend/src/theory/tools/{ScalePositions,Triads,Arpeggios,NameThatChord,ScalesOverChord,CircleOfFifthsTool,Progressions}.tsx` | The seven tools |
| `frontend/src/theory/tools.ts` | Registry, in rail order |
| `README.md`, `docs/screenshots/theory-shapes.png` | README upkeep |

---

### Task 1: Guitar voicings and bass arpeggio shapes

**Files:**
- Create: `frontend/src/music/voicings.ts`
- Test: `frontend/src/music/voicings.test.ts`

**Interfaces:**
- Consumes: `rowMidi`, `Cell` (positions.ts); `ChordInfo`, `pcOf` (spell.ts); `Instrument` (tuning.ts); `mod12` (chordTones.ts).
- Produces:
  - `Voicing { frets: (number | null)[] /* per row, row 0 = highest */; tab: string /* "x02010", low string first */; label: string }`.
  - `guitarVoicings(inst, chord, limit = 9): Voicing[]`: at most one per starting fret, lowest on the neck first.
  - `isPlayable(inst, chord, frets): boolean` and `tabOf(frets)`.
  - `ArpeggioShape { label; cells: Cell[] /* play order */ }` and `bassArpeggios(inst, chord)`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, test } from 'vitest';

import { chordInfo, type ChordInfo } from './spell';
import { DEFAULT_INSTRUMENT, instrumentFor } from './tuning';
import { bassArpeggios, guitarVoicings, isPlayable, tabOf } from './voicings';

const guitar = instrumentFor('guitar6', false);
const chord = (s: string): ChordInfo => {
  const r = chordInfo(s);
  if (!r.ok) throw new Error(r.reason);
  return r.chord;
};

describe('guitar voicings', () => {
  test('tab notation, low string first', () => {
    expect(tabOf([0, 1, 0, 2, 0, null])).toBe('x02010');
    expect(tabOf([12, 13, 12, 14, 12, null])).toBe('x-12-14-12-13-12');
  });

  test('Am7 includes the open shape and the E-shape barre', () => {
    const tabs = guitarVoicings(guitar, chord('Am7')).map((v) => v.tab);
    expect(tabs).toContain('x02010');
    expect(tabs).toContain('575555');
  });

  test.each(['C', 'Am', 'Am7', 'G7', 'Dmaj7', 'F#m7b5', 'Bdim7', 'Esus4', 'C/E', 'Cadd9', 'A9'])(
    'every %s voicing obeys the rules',
    (s) => {
      const c = chord(s);
      const vs = guitarVoicings(guitar, c);
      expect(vs.length).toBeGreaterThan(0);
      expect(vs.length).toBeLessThanOrEqual(9);
      for (const v of vs) expect(isPlayable(guitar, c, v.frets), v.tab).toBe(true);
      const starts = vs.map((v) => Math.min(...v.frets.filter((f): f is number => f !== null && f > 0)));
      expect([...starts].sort((a, b) => a - b)).toEqual(starts);
    },
  );

  test('labels', () => {
    const vs = guitarVoicings(guitar, chord('Am7'));
    expect(vs.find((v) => v.tab === 'x02010')?.label).toBe('Open');
    expect(vs.find((v) => v.tab === '575555')?.label).toBe('Root on 6th string · fret 5');
  });

  test('isPlayable rejects wrong notes, a wrong bass and stretches', () => {
    const am7 = chord('Am7');
    expect(isPlayable(guitar, am7, [0, 1, 0, 2, 0, null])).toBe(true);
    expect(isPlayable(guitar, am7, [0, 1, 2, 2, 0, null])).toBe(false); // A on G string: no ♭7
    expect(isPlayable(guitar, am7, [0, 1, 0, 2, 0, 0])).toBe(false); // low E is the bass
    expect(isPlayable(guitar, am7, [0, 1, 0, 2, null, 5])).toBe(false); // gap in the strings
  });
});

describe('bass arpeggios', () => {
  test('Am7 from the root on the E string, in play order', () => {
    const [first] = bassArpeggios(DEFAULT_INSTRUMENT, chord('Am7'));
    expect(first!.label).toBe('From the root on the E string');
    expect(first!.cells).toEqual([
      { string: 3, fret: 5 },
      { string: 3, fret: 8 },
      { string: 2, fret: 7 },
      { string: 1, fret: 5 },
      { string: 1, fret: 7 },
    ]);
  });

  test('root, fifth, octave', () => {
    const shapes = bassArpeggios(DEFAULT_INSTRUMENT, chord('G'));
    expect(shapes.find((s) => s.label === 'Root, 5th, octave')!.cells).toEqual([
      { string: 3, fret: 3 },
      { string: 2, fret: 5 },
      { string: 1, fret: 5 },
    ]);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npm --prefix frontend test -- src/music/voicings.test.ts`
Expected: FAIL, `Failed to resolve import "./voicings"`.

- [ ] **Step 3: Implement**

```ts
// Chord shapes (D-19): guitar voicings found by search, and bass arpeggio
// shapes. Nothing is looked up from a chord dictionary, so any tuning works and
// every result can be checked against the rules below by the tests.
import { mod12 } from './chordTones';
import { rowMidi, type Cell } from './positions';
import type { ChordInfo } from './spell';
import { pcOf } from './spell';
import type { Instrument } from './tuning';

export interface Voicing {
  /** Fret per row (row 0 = highest string); null = muted. */
  frets: (number | null)[];
  /** "x02010": low string first, dashes between frets when any is above 9. */
  tab: string;
  label: string;
}

const ORDINAL = ['1st', '2nd', '3rd', '4th', '5th', '6th'];

export function tabOf(frets: readonly (number | null)[]): string {
  const low = [...frets].reverse();
  const parts = low.map((f) => (f === null ? 'x' : String(f)));
  return low.some((f) => f !== null && f > 9) ? parts.join('-') : parts.join('');
}

function fingers(fretted: number[]): number {
  if (fretted.length === 0) return 0;
  const min = Math.min(...fretted);
  const atMin = fretted.filter((f) => f === min).length;
  // Two or more strings at the lowest fret are one barre finger.
  return atMin >= 2 ? 1 + fretted.filter((f) => f > min).length : fretted.length;
}

/**
 * The rules every voicing obeys (also what the tests assert):
 * - sounding strings are one unbroken run of at least 4 strings;
 * - the lowest sounding note is the chord's bass (root, or slash note);
 * - every chord tone sounds, except that a chord of 4+ notes may drop its 5th;
 * - no other notes;
 * - fretted notes span at most 4 frets (max − min ≤ 3) and need at most 4 fingers.
 */
export function isPlayable(inst: Instrument, chord: ChordInfo, frets: readonly (number | null)[]): boolean {
  const open = rowMidi(inst);
  const sounding = frets.map((f, row) => (f === null ? null : { row, midi: open[row]! + f, fret: f }));
  const rows = sounding.filter((s) => s !== null).map((s) => s!.row);
  if (rows.length < 4 || rows[rows.length - 1]! - rows[0]! !== rows.length - 1) return false;
  const tones = new Set(chord.notes.map((n) => n.pc));
  const bassPc = pcOf(chord.bass ?? chord.root)!;
  if (chord.extraBass) tones.add(chord.extraBass.pc);
  const notes = sounding.filter((s) => s !== null).map((s) => s!);
  const lowest = notes.reduce((a, b) => (b.midi < a.midi ? b : a));
  if (mod12(lowest.midi) !== bassPc) return false;
  const played = new Set(notes.map((n) => mod12(n.midi)));
  if ([...played].some((pc) => !tones.has(pc))) return false;
  const fifth = chord.notes.find((n) => n.interval === '5')?.pc;
  const required = [...tones].filter((pc) => !(chord.notes.length >= 4 && pc === fifth));
  if (required.some((pc) => !played.has(pc))) return false;
  const fretted = notes.map((n) => n.fret).filter((f) => f > 0);
  if (fretted.length && Math.max(...fretted) - Math.min(...fretted) > 3) return false;
  return fingers(fretted) <= 4;
}

function label(frets: readonly (number | null)[], slash: boolean): string {
  const fretted = frets.filter((f): f is number => f !== null && f > 0);
  const hasOpen = frets.some((f) => f === 0);
  if (hasOpen && Math.max(0, ...fretted) <= 4) return 'Open';
  const bassRow = frets.reduce<number>((acc, f, row) => (f !== null ? row : acc), 0);
  return `${slash ? 'Bass' : 'Root'} on ${ORDINAL[bassRow]} string · fret ${frets[bassRow]}`;
}

/** Up to `limit` guitar voicings, lowest on the neck first, one per starting fret. */
export function guitarVoicings(inst: Instrument, chord: ChordInfo, limit = 9): Voicing[] {
  const open = rowMidi(inst);
  const tones = new Set(chord.notes.map((n) => n.pc));
  if (chord.extraBass) tones.add(chord.extraBass.pc);
  const best = new Map<number, { frets: (number | null)[]; score: number }>();
  for (let lo = 1; lo <= 12; lo++) {
    const options = open.map((o) => {
      const opts: (number | null)[] = [null];
      if (lo === 1 && tones.has(mod12(o))) opts.push(0);
      for (let f = lo; f <= lo + 3; f++) if (tones.has(mod12(o + f))) opts.push(f);
      return opts;
    });
    const pick: (number | null)[] = [];
    const walk = (row: number) => {
      if (row === open.length) {
        if (!isPlayable(inst, chord, pick)) return;
        const fretted = pick.filter((f): f is number => f !== null && f > 0);
        const min = fretted.length ? Math.min(...fretted) : 0;
        const sounding = pick.filter((f) => f !== null).length;
        const score = sounding * 10 + pick.filter((f) => f === 0).length - fingers(fretted);
        const prev = best.get(min);
        if (!prev || score > prev.score) best.set(min, { frets: [...pick], score });
        return;
      }
      for (const o of options[row]!) {
        pick[row] = o;
        walk(row + 1);
      }
    };
    walk(0);
  }
  return [...best.entries()]
    .sort((a, b) => b[1].score - a[1].score || a[0] - b[0])
    .slice(0, limit)
    .sort((a, b) => a[0] - b[0])
    .map(([, v]) => ({ frets: v.frets, tab: tabOf(v.frets), label: label(v.frets, chord.bass !== null && chord.bass !== chord.root) }));
}

export interface ArpeggioShape {
  label: string;
  /** In play order, low to high. */
  cells: Cell[];
}

/**
 * Places `steps` (semitones above the root, ascending) starting from the root on
 * row `rootRow`, each on the lowest string it fits on within one-finger-per-fret
 * reach of the root (root fret −1 … +3). Stops at the first note that does not fit.
 */
function arpeggio(inst: Instrument, rootPc: number, rootRow: number, steps: number[]): Cell[] {
  const open = rowMidi(inst);
  const rootFret = mod12(rootPc - open[rootRow]!) || 12;
  const rootMidi = open[rootRow]! + rootFret;
  const cells: Cell[] = [];
  let row = rootRow;
  for (const step of steps) {
    const midi = rootMidi + step;
    let placed = false;
    for (let r = row; r >= 0; r--) {
      const fret = midi - open[r]!;
      if (fret >= Math.max(0, rootFret - 1) && fret <= rootFret + 3) {
        cells.push({ string: r, fret });
        row = r;
        placed = true;
        break;
      }
    }
    if (!placed) break;
  }
  return cells;
}

/** Bass arpeggio cards: the chord from the root on the two lowest strings, and root–5th–octave. */
export function bassArpeggios(inst: Instrument, chord: ChordInfo): ArpeggioShape[] {
  const rootPc = pcOf(chord.root)!;
  const semis = chord.notes.map((n) => mod12(n.pc - rootPc)).sort((a, b) => a - b);
  const steps = [...semis, 12];
  const low = inst.strings - 1;
  const names = [...inst.tuning].reverse().map((n) => n.replace(/\d+$/, ''));
  return [
    { label: `From the root on the ${names[low]} string`, cells: arpeggio(inst, rootPc, low, steps) },
    { label: `From the root on the ${names[low - 1]} string`, cells: arpeggio(inst, rootPc, low - 1, steps) },
    { label: 'Root, 5th, octave', cells: arpeggio(inst, rootPc, low, [0, 7, 12]) },
  ].filter((s) => s.cells.length >= 3);
}
```

- [ ] **Step 4: Run the tests**

Run: `npm --prefix frontend test -- src/music/voicings.test.ts`
Expected: 17 passed.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/music/voicings.ts frontend/src/music/voicings.test.ts
git commit -m "feat(theory): guitar voicings by search with a playability check, bass arpeggio shapes (D-19)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Shape cards in Chord finder

**Files:**
- Create: `frontend/src/theory/ShapeCard.tsx`, `frontend/src/theory/chordDots.ts`
- Modify: `frontend/src/theory/Theory.module.css` (append), `frontend/src/theory/tools/ChordFinder.tsx`
- Test: `frontend/src/theory/tools/chordFinderShapes.test.tsx`

**Interfaces:**
- Consumes: Task 1; `TheoryNeck` with `start`, `size="card"` and the `mute` marker (foundation Task 6). On a zoomed window, fret 0 is the ✕ column for muted strings.
- Produces:
  - `ShapeCard({ title, subtitle?, instrument, dots, current? })` and `cardStart(frets)`, a 5-fret window holding every fretted note, starting at 1 near the nut.
  - `voicingDots(inst, chord, voicing)` and `orderDots(inst, rootPc, cells)`.

- [ ] **Step 1: Write the failing test**

```tsx
import { screen } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';

import { renderTool } from './testing';

afterEach(() => vi.unstubAllGlobals());

const guitar = { instrument: { kind: 'guitar' as const, strings: 6, tuning: ['E2', 'A2', 'D3', 'G3', 'B3', 'E4'], left_handed: false } };

test('chord finder on guitar shows voicing cards with tab', async () => {
  renderTool('/theory/chord-finder?root=A&q=m7', { theory: guitar });
  expect(await screen.findByText('x02010')).toBeInTheDocument();
  expect(screen.getByText('575555')).toBeInTheDocument();
  expect(screen.getByText('Open')).toBeInTheDocument();
  expect(screen.getAllByText('Root on 6th string · fret 5').length).toBeGreaterThan(0);
});

test('chord finder on bass shows arpeggio shapes in play order', async () => {
  const { container } = renderTool('/theory/chord-finder?root=A&q=m7');
  expect(await screen.findByText('From the root on the E string')).toBeInTheDocument();
  const card = screen.getByText('From the root on the E string').closest('div')!.parentElement!;
  expect([...card.querySelectorAll('[data-cell]')].map((d) => d.textContent)).toEqual(['1', '2', '3', '4', '5']);
  expect(container.querySelector('[data-cell="s3f5"][data-marker="root"]')).not.toBeNull();
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npm --prefix frontend test -- src/theory/tools/chordFinderShapes.test.tsx`
Expected: FAIL, `Unable to find an element with the text: x02010`.

- [ ] **Step 3: The card and its dots**

`frontend/src/theory/ShapeCard.tsx`:

```tsx
// A small zoomed neck for one chord shape (D-19): a guitar voicing or a bass
// arpeggio. Five frets, starting where the shape needs; the open column only
// when the shape uses open strings.
import type { Cell } from '../music/positions';
import type { Instrument } from '../music/tuning';
import { Panel } from '../ui';
import styles from './Theory.module.css';
import { TheoryNeck, type NeckDot } from './TheoryNeck';

const SPAN = 5;

/** First fret of a 5-fret window that holds every fretted note: 1 (with the open column) near the nut. */
export function cardStart(frets: readonly number[]): number {
  const fretted = frets.filter((f) => f > 0);
  if (fretted.length === 0) return 1;
  const hi = Math.max(...fretted);
  if (hi <= SPAN) return 1;
  return Math.max(1, Math.min(Math.min(...fretted) - 1, hi - SPAN + 1));
}

export function ShapeCard({
  title,
  subtitle,
  instrument,
  dots,
  current = false,
}: {
  title: string;
  subtitle?: string;
  instrument: Instrument;
  dots: readonly NeckDot[];
  current?: boolean;
}) {
  const start = cardStart(dots.filter((d) => d.marker !== 'mute').map((d: Cell) => d.fret));
  const shown = start === 1 ? dots : dots.map((d) => (d.marker === 'mute' ? { ...d, fret: 0 } : d));
  return (
    <Panel className={current ? `${styles.shapeCard} ${styles.shapeCardCurrent}` : styles.shapeCard}>
      <div className={styles.row}>
        <b>{title}</b>
        {subtitle && <span className={styles.mono}>{subtitle}</span>}
      </div>
      <TheoryNeck instrument={instrument} start={start} frets={SPAN} size="card" dots={shown} label={`${title} ${subtitle ?? ''}`.trim()} />
    </Panel>
  );
}
```

`frontend/src/theory/chordDots.ts`:

```ts
// Chord shapes -> dots for ShapeCard (D-19): intervals on a guitar voicing,
// play-order numbers on a bass arpeggio; the root marked either way (U-13).
import { mod12 } from '../music/chordTones';
import { positionAt, type Cell } from '../music/positions';
import { pcOf, type ChordInfo } from '../music/spell';
import type { Instrument } from '../music/tuning';
import type { Voicing } from '../music/voicings';
import type { NeckDot } from './TheoryNeck';

function intervalOf(chord: ChordInfo, pc: number): string {
  const all = chord.extraBass ? [...chord.notes, chord.extraBass] : chord.notes;
  return all.find((n) => n.pc === pc)?.interval ?? '';
}

export function voicingDots(inst: Instrument, chord: ChordInfo, v: Voicing): NeckDot[] {
  const rootPc = pcOf(chord.root)!;
  return v.frets.map((fret, string) => {
    if (fret === null) return { string, fret: 0, label: '', marker: 'mute' as const };
    const pc = positionAt(inst, { string, fret }).pc;
    return { string, fret, label: intervalOf(chord, pc), marker: pc === rootPc ? ('root' as const) : ('tone' as const) };
  });
}

export function orderDots(inst: Instrument, rootPc: number, cells: readonly Cell[]): NeckDot[] {
  return cells.map((cell, i) => ({
    ...cell,
    label: String(i + 1),
    marker: mod12(positionAt(inst, cell).pc - rootPc) === 0 ? 'root' : 'tone',
  }));
}
```

Append to `frontend/src/theory/Theory.module.css`:

```css
/* ---- shape cards (voicings, arpeggios) ---- */
.cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: var(--ds-3);
}

.shapeCard {
  display: flex;
  flex-direction: column;
  gap: var(--ds-2);
  padding: var(--ds-3);
}

.shapeCardCurrent {
  border-color: var(--ds-accent);
}

.mono {
  font: 400 var(--ds-t-xs) / 1 var(--ds-mono);
  color: var(--ds-text-3);
}

.choices {
  display: flex;
  flex-wrap: wrap;
  gap: var(--ds-2);
}

.list {
  display: flex;
  flex-direction: column;
  gap: var(--ds-2);
  margin: 0;
  padding: 0;
  list-style: none;
}

.listRow {
  display: flex;
  align-items: center;
  gap: var(--ds-3);
  padding: var(--ds-2) var(--ds-3);
  background: var(--ds-surface);
  border: 1px solid var(--ds-border);
  border-radius: var(--ds-r-btn);
}

.listRow[aria-current='true'] {
  border-color: var(--ds-accent);
}

.names {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: var(--ds-3);
}
```

- [ ] **Step 4: Replace `frontend/src/theory/tools/ChordFinder.tsx`**

The only changes are the `voicings` and `arpeggios` constants and the cards section above the help box:

```tsx
// Chord finder (D-19): pick a root and quality or type any chord tonal can
// read. Shows the chord's notes and intervals on the whole neck and where it is
// diatonic. A typed chord it can't read is an inline error and the last chord
// stays on screen; nothing is guessed (N-08).
import { useState, type FormEvent } from 'react';

import { DEFAULT_THEORY } from '../../api/client';
import { chordHomes, chordInfo, chordSymbol, pcOf, pretty, QUALITIES, rootName, type ChordInfo } from '../../music/spell';
import { neckFrets } from '../../music/tuning';
import { bassArpeggios, guitarVoicings } from '../../music/voicings';
import { Button } from '../../ui';
import { orderDots, voicingDots } from '../chordDots';
import { ChipRow, HelpBox, NoteChips, NotePicker, ToolHeader } from '../controls';
import { noteDots } from '../neckDots';
import { useSelection } from '../selection';
import styles from '../Theory.module.css';
import { ShapeCard } from '../ShapeCard';
import { TheoryNeck } from '../TheoryNeck';
import { useTheoryDoc } from '../TheoryDoc';
import { useChosenSong } from '../useChosenSong';

/** The chord the selection names: a typed one if any, else root + quality (+ bass). */
export function selectedChord(sel: { chord: string | null; root: string; quality: (typeof QUALITIES)[number]['id']; bass: string | null }): ChordInfo {
  const typed = sel.chord ? chordInfo(sel.chord) : null;
  if (typed?.ok) return typed.chord;
  const built = chordInfo(chordSymbol(sel.root, sel.quality, sel.bass));
  if (built.ok) return built.chord;
  throw new Error(`chord finder cannot build ${sel.root} ${sel.quality}`);
}

export function ChordFinder() {
  const { doc } = useTheoryDoc();
  const inst = doc?.instrument ?? DEFAULT_THEORY.instrument;
  const [sel, select] = useSelection();
  const song = useChosenSong();
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);

  const chord = selectedChord(sel);
  const notes = chord.extraBass ? [...chord.notes, chord.extraBass] : chord.notes;
  const homes = chordHomes(chord);
  const frets = neckFrets(inst);
  const voicings = inst.kind === 'guitar' ? guitarVoicings(inst, chord) : [];
  const arpeggios = inst.kind === 'bass' ? bassArpeggios(inst, chord) : [];

  const typeChord = (event: FormEvent) => {
    event.preventDefault();
    const parsed = chordInfo(text);
    if (!parsed.ok) {
      setError(parsed.reason);
      return;
    }
    setError(null);
    setText('');
    // The root follows the typed chord so the next tool opens on it; a double
    // sharp or flat root (rare) has no note-picker button and is left as it was.
    const root = /^[A-G](#|b)?$/.test(parsed.chord.root) ? parsed.chord.root : sel.root;
    select({ chord: parsed.chord.symbol, root });
  };

  return (
    <>
      <ToolHeader title="Chord finder">
        <form className={styles.row} onSubmit={typeChord}>
          <input
            className={styles.select}
            aria-label="Type a chord"
            placeholder="or type a chord: Am7, C/E, F#m7b5…"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <Button type="submit">Show</Button>
        </form>
      </ToolHeader>
      {error && (
        <p className={styles.errorText} role="alert">
          {error}. Nothing is guessed; the last chord stays shown.
        </p>
      )}
      <div className={styles.stack}>
        <span className={styles.cap}>root</span>
        <NotePicker label="Root" selected={[pcOf(chord.root)!]} onPick={(pc) => select({ root: rootName(pc, 'major'), chord: null, bass: null })} />
      </div>
      <ChipRow
        label="Quality"
        value={sel.chord ? null : sel.quality}
        onChange={(quality) => select({ quality, chord: null })}
        options={QUALITIES.map((q) => ({ value: q.id, label: q.label }))}
      />
      {song.state === 'ready' && song.distinct.length > 0 && (
        <ChipRow
          label={`In ${song.title}`}
          value={sel.chord}
          onChange={(symbol) => select({ chord: symbol })}
          options={song.distinct.map((s) => ({ value: s, label: pretty(s) }))}
        />
      )}
      <div className={styles.row}>
        <span className={styles.big}>{pretty(chord.symbol)}</span>
        <span className={styles.dimText}>{pretty(chord.name)}</span>
        <NoteChips notes={notes} />
      </div>
      <div className={styles.neck}>
        <TheoryNeck
          instrument={inst}
          frets={frets}
          label={`${pretty(chord.symbol)} on ${inst.kind}`}
          dots={noteDots(inst, notes, { lo: 0, hi: frets, labels: 'interval' })}
        />
      </div>
      {inst.kind === 'guitar' ? (
        <>
          <span className={styles.cap}>voicings · {voicings.length}</span>
          {voicings.length === 0 && <p className={styles.dimText}>No playable voicing of {pretty(chord.symbol)} in this tuning.</p>}
          <div className={styles.cards}>
            {voicings.map((v) => (
              <ShapeCard key={v.tab} title={v.label} subtitle={v.tab} instrument={inst} dots={voicingDots(inst, chord, v)} />
            ))}
          </div>
        </>
      ) : (
        <>
          <span className={styles.cap}>arpeggio shapes</span>
          <div className={styles.cards}>
            {arpeggios.map((a) => (
              <ShapeCard key={a.label} title={a.label} subtitle="play order" instrument={inst} dots={orderDots(inst, pcOf(chord.root)!, a.cells)} />
            ))}
          </div>
        </>
      )}
      <HelpBox>
        <b>{pretty(chord.symbol)}</b>: {notes.map((n) => `${pretty(n.name)} (${n.interval})`).join(', ')}.{' '}
        {homes.length > 0 ? (
          <>
            It is the <b>{homes.slice(0, 3).join(', ')}</b>.
          </>
        ) : (
          'It is not a chord of any major key.'
        )}
      </HelpBox>
    </>
  );
}
```

- [ ] **Step 5: Run the tests**

Run: `npm --prefix frontend test -- src/theory`
Expected: all pass (chordFinderShapes 2, chordFinder 3).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/theory/ShapeCard.tsx frontend/src/theory/chordDots.ts frontend/src/theory/Theory.module.css frontend/src/theory/tools/ChordFinder.tsx frontend/src/theory/tools/chordFinderShapes.test.tsx
git commit -m "feat(theory): voicing cards on guitar, arpeggio cards on bass, in Chord finder (D-19)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Scale shapes and triad shapes

**Files:**
- Create: `frontend/src/music/shapes.ts`
- Test: `frontend/src/music/shapes.test.ts`

**Interfaces:**
- Produces:
  - `Shape { label; cells: Cell[] }` and `FretWindow { label; lo; hi }`.
  - `isStandardGuitar(inst)`.
  - `perStringShape(inst, scale, start, perString, maxFret)`, `pentatonicBoxes(inst, scale, maxFret)` ("Box 1".."Box 5") and `threeNotesPerString(inst, scale, maxFret)` ("Pattern 1".."Pattern 7").
  - `cagedWindows(inst, rootPc): FretWindow[] | null`, which is null unless the tuning is `E2 A2 D3 G3 B3 E4`.
  - `Inversion` = `0 | 1 | 2`, `INVERSION_LABELS`, `stringSets(inst): number[][]` (row triples, lowest string first) and `triadShapes(inst, triad, set, inversion, maxFret): Cell[][]`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, test } from 'vitest';

import { cagedWindows, pentatonicBoxes, perStringShape, stringSets, threeNotesPerString, triadShapes } from './shapes';
import { chordInfo, scaleNotes, type ChordInfo } from './spell';
import { DEFAULT_INSTRUMENT, instrumentFor } from './tuning';

const guitar = instrumentFor('guitar6', false);
const bass4 = DEFAULT_INSTRUMENT;
const cells = (cs: { string: number; fret: number }[]) => cs.map((c) => `${c.string}:${c.fret}`).join(' ');
const chord = (s: string): ChordInfo => {
  const r = chordInfo(s);
  if (!r.ok) throw new Error(r.reason);
  return r.chord;
};

describe('scale shapes', () => {
  test('pentatonic box 1 of A minor on guitar is the familiar fret 5 box', () => {
    const [box1] = pentatonicBoxes(guitar, scaleNotes('A', 'minor-pentatonic'), 17);
    expect(cells(box1!.cells)).toBe('5:5 5:8 4:5 4:7 3:5 3:7 2:5 2:7 1:5 1:8 0:5 0:8');
  });

  test('five boxes, each two notes per string', () => {
    const boxes = pentatonicBoxes(guitar, scaleNotes('A', 'minor-pentatonic'), 17);
    expect(boxes.map((b) => b.label)).toEqual(['Box 1', 'Box 2', 'Box 3', 'Box 4', 'Box 5']);
    for (const b of boxes) expect(b.cells).toHaveLength(12);
  });

  test('three notes per string, G major pattern 1', () => {
    const [p1] = threeNotesPerString(guitar, scaleNotes('G', 'major'), 17);
    expect(cells(p1!.cells)).toBe('5:3 5:5 5:7 4:3 4:5 4:7 3:4 3:5 3:7 2:4 2:5 2:7 1:5 1:7 1:8 0:5 0:7 0:8');
  });

  test('a shape that would start below the nut moves up an octave', () => {
    const shape = perStringShape(bass4, scaleNotes('E', 'minor-pentatonic'), 0, 2, 15);
    expect(Math.min(...shape.map((c) => c.fret))).toBeGreaterThanOrEqual(0);
  });

  test('CAGED windows for C, standard tuning only', () => {
    expect(cagedWindows(guitar, 0)!.map((w) => `${w.label} ${w.lo}-${w.hi}`)).toEqual([
      'C shape 0-4', 'A shape 3-7', 'G shape 5-9', 'E shape 8-12', 'D shape 10-14',
    ]);
    expect(cagedWindows(bass4, 0)).toBeNull();
    expect(cagedWindows({ ...guitar, tuning: ['D2', 'A2', 'D3', 'G3', 'B3', 'E4'] }, 0)).toBeNull();
  });
});

describe('triads', () => {
  test('string sets, lowest string first', () => {
    expect(stringSets(guitar)).toEqual([[5, 4, 3], [4, 3, 2], [3, 2, 1], [2, 1, 0]]);
    expect(stringSets(bass4)).toEqual([[3, 2, 1], [2, 1, 0]]);
  });

  test('C major on the G, B and E strings in each inversion, plus the octave up', () => {
    const c = chord('C').notes;
    expect(triadShapes(guitar, c, [2, 1, 0], 0, 17).map(cells)).toEqual(['2:5 1:5 0:3', '2:17 1:17 0:15']);
    expect(triadShapes(guitar, c, [2, 1, 0], 1, 17).map(cells)).toEqual(['2:9 1:8 0:8']);
    expect(triadShapes(guitar, c, [2, 1, 0], 2, 17).map(cells)).toEqual(['2:0 1:1 0:0', '2:12 1:13 0:12']);
  });

  test('G major on the low three bass strings', () => {
    expect(triadShapes(bass4, chord('G').notes, [3, 2, 1], 0, 15).map(cells)).toEqual(['3:3 2:2 1:0', '3:15 2:14 1:12']);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npm --prefix frontend test -- src/music/shapes.test.ts`
Expected: FAIL, `Failed to resolve import "./shapes"`.

- [ ] **Step 3: Implement**

```ts
// Scale positions and triad shapes (D-19). Every shape is computed from pitches
// and the tuning, so drop and open tunings get correct (if unfamiliar) shapes;
// CAGED is the one exception, which is defined by standard guitar tuning and
// says so instead of drawing something wrong (N-08).
import { mod12 } from './chordTones';
import { rowMidi, type Cell } from './positions';
import type { Spelled } from './spell';
import type { Instrument } from './tuning';

export interface Shape {
  label: string;
  /** Low to high pitch, which is play order. */
  cells: Cell[];
}

export interface FretWindow {
  label: string;
  lo: number;
  hi: number;
}

/** Scientific-pitch-free check for E A D G B E. */
export function isStandardGuitar(inst: Instrument): boolean {
  return inst.kind === 'guitar' && inst.tuning.join(' ') === 'E2 A2 D3 G3 B3 E4';
}

/**
 * `perString` consecutive scale notes on each string, low string first,
 * starting from scale degree `start` on the lowest string: 2 per string gives
 * the pentatonic boxes, 3 gives the three-notes-per-string patterns.
 */
export function perStringShape(inst: Instrument, scale: readonly Spelled[], start: number, perString: number, maxFret: number): Cell[] {
  const open = rowMidi(inst);
  const lowRow = open.length - 1;
  const pcs = scale.map((n) => n.pc);
  const first = open[lowRow]! + mod12(pcs[start]! - open[lowRow]!);
  const pitches: number[] = [];
  for (let midi = first; pitches.length < perString * open.length; midi++) {
    if (pcs.includes(mod12(midi))) pitches.push(midi);
  }
  const place = (shift: number) =>
    pitches.map((midi, i) => {
      const string = lowRow - Math.floor(i / perString);
      return { string, fret: midi + shift - open[string]! };
    });
  let cells = place(0);
  if (cells.some((c) => c.fret < 0)) cells = place(12);
  if (cells.every((c) => c.fret >= 12) && Math.max(...cells.map((c) => c.fret)) > maxFret) cells = place(-12);
  return cells;
}

/** The five pentatonic boxes (5-note scales), box 1 starting on the root. */
export function pentatonicBoxes(inst: Instrument, scale: readonly Spelled[], maxFret: number): Shape[] {
  return scale.map((_, i) => ({ label: `Box ${i + 1}`, cells: perStringShape(inst, scale, i, 2, maxFret) }));
}

/** Seven three-notes-per-string patterns (7-note scales), pattern 1 starting on the root. */
export function threeNotesPerString(inst: Instrument, scale: readonly Spelled[], maxFret: number): Shape[] {
  return scale.map((_, i) => ({ label: `Pattern ${i + 1}`, cells: perStringShape(inst, scale, i, 3, maxFret) }));
}

/**
 * CAGED windows for standard guitar tuning, from where the root sits: C shape
 * ends on the root on the A string, A shape starts on it; G shape ends on the
 * root on the low E, E shape starts on it; D shape starts on the root on the D
 * string. Each window is five frets. Null for any other tuning.
 */
export function cagedWindows(inst: Instrument, rootPc: number): FretWindow[] | null {
  if (!isStandardGuitar(inst)) return null;
  const e = mod12(rootPc - 4);
  const a = mod12(rootPc - 9);
  const d = mod12(rootPc - 2);
  const win = (label: string, lo: number) => {
    const start = lo < 0 ? lo + 12 : lo;
    return { label, lo: start, hi: start + 4 };
  };
  return [win('C shape', a - 3), win('A shape', a), win('G shape', e - 3), win('E shape', e), win('D shape', d)].sort(
    (x, y) => x.lo - y.lo,
  );
}

export type Inversion = 0 | 1 | 2;
export const INVERSION_LABELS = ['Root position', '1st inversion', '2nd inversion'] as const;

/**
 * Adjacent string sets of three, low to high, as row triples (lowest string
 * first): guitar 6-5-4, 5-4-3, 4-3-2, 3-2-1; 4-string bass E-A-D, A-D-G.
 */
export function stringSets(inst: Instrument): number[][] {
  const rows = rowMidi(inst).length;
  const sets: number[][] = [];
  for (let low = rows - 1; low >= 2; low--) sets.push([low, low - 1, low - 2]);
  return sets;
}

/**
 * A triad (root, 3rd, 5th) in an inversion on one string set, closest to the
 * nut; the same shape an octave up is returned too when it fits on the neck.
 */
export function triadShapes(inst: Instrument, triad: readonly Spelled[], set: readonly number[], inversion: Inversion, maxFret: number): Cell[][] {
  const open = rowMidi(inst);
  const order = [0, 1, 2].map((i) => triad[(i + inversion) % 3]!.pc);
  const build = (octave: number) => {
    const cells: Cell[] = [];
    let prev = open[set[0]!]! + mod12(order[0]! - open[set[0]!]!) + 12 * octave;
    cells.push({ string: set[0]!, fret: prev - open[set[0]!]! });
    for (let i = 1; i < 3; i++) {
      const midi = prev + (mod12(order[i]! - prev) || 12);
      cells.push({ string: set[i]!, fret: midi - open[set[i]!]! });
      prev = midi;
    }
    return cells;
  };
  const out: Cell[][] = [];
  for (let octave = 0; octave < 3; octave++) {
    const cells = build(octave);
    const frets = cells.map((c) => c.fret);
    if (Math.min(...frets) < 0) continue;
    if (Math.max(...frets) > maxFret) break;
    const fretted = frets.filter((f) => f > 0);
    if (fretted.length === 0 || Math.max(...fretted) - Math.min(...fretted) <= 4) out.push(cells);
  }
  return out;
}
```

- [ ] **Step 4: Run the tests**

Run: `npm --prefix frontend test -- src/music/shapes.test.ts`
Expected: 8 passed.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/music/shapes.ts frontend/src/music/shapes.test.ts
git commit -m "feat(theory): pentatonic boxes, 3-notes-per-string, CAGED windows and triad inversions (D-19)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Scale positions

**Files:**
- Create: `frontend/src/theory/tools/ScalePositions.tsx`
- Modify: `frontend/src/theory/tools.ts`
- Test: `frontend/src/theory/tools/scalePositions.test.tsx`

**Interfaces:**
- Produces: `systems(inst, notes, frets): SystemDef[]`. Each entry is `{ id: 'boxes' | '3nps' | 'caged' | 'positions', label, unavailable: string | null, steps() }`.

- [ ] **Step 1: Write the failing test**

```tsx
import { fireEvent, screen } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';

import { renderTool } from './testing';

afterEach(() => vi.unstubAllGlobals());

const guitar = { instrument: { kind: 'guitar' as const, strings: 6, tuning: ['E2', 'A2', 'D3', 'G3', 'B3', 'E4'], left_handed: false } };

test('scale positions: pentatonic box 1 on guitar, then the next box', async () => {
  const { dots } = renderTool('/theory/scale-positions?root=A&scale=minor-pentatonic', { theory: guitar });
  await screen.findByRole('heading', { name: 'Scale positions' });
  expect(screen.getByRole('button', { name: 'Pentatonic boxes' })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByText('Box 1')).toBeInTheDocument();
  const lit = dots().filter((d) => !d.endsWith(':dim'));
  expect(lit).toHaveLength(12);
  expect(lit).toContain('s5f5:R');
  fireEvent.click(screen.getByRole('button', { name: 'Next shape' }));
  expect(screen.getByText('Box 2')).toBeInTheDocument();
});

test('scale positions: CAGED is disabled with the reason in a drop tuning', async () => {
  renderTool('/theory/scale-positions?root=G', {
    theory: { instrument: { ...guitar.instrument, tuning: ['D2', 'A2', 'D3', 'G3', 'B3', 'E4'] } },
  });
  await screen.findByRole('heading', { name: 'Scale positions' });
  const caged = screen.getByRole('button', { name: 'CAGED' });
  expect(caged).toBeDisabled();
  expect(caged).toHaveAttribute('title', 'CAGED shapes assume standard guitar tuning (E A D G B E)');
  expect(screen.getByRole('button', { name: '3 notes per string' })).toHaveAttribute('aria-pressed', 'true');
});

test('scale positions: bass gets one-finger-per-fret boxes and play order numbers', async () => {
  const { dots } = renderTool('/theory/scale-positions?root=G');
  await screen.findByRole('heading', { name: 'Scale positions' });
  expect(screen.getByRole('button', { name: '1 finger per fret' })).toHaveAttribute('aria-pressed', 'true');
  fireEvent.click(screen.getByRole('checkbox', { name: 'Play order' }));
  expect(dots()).toContain('s3f3:1');
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npm --prefix frontend test -- src/theory/tools/scalePositions.test.tsx`
Expected: FAIL (no heading named Scale positions).

- [ ] **Step 3: Implement**

```tsx
// Scale positions (D-19): step through one playable shape of the scale at a
// time. Pentatonic boxes (5-note scales) and three-notes-per-string patterns
// (7-note scales on guitar) are computed from the tuning; CAGED needs standard
// guitar tuning and says so when it can't apply; plain position boxes work for
// every scale and instrument. Notes outside the shape stay on the neck, dimmed.
import { useState } from 'react';

import { DEFAULT_THEORY } from '../../api/client';
import { positionsOf, positionWindows, type Cell } from '../../music/positions';
import { cagedWindows, pentatonicBoxes, threeNotesPerString } from '../../music/shapes';
import { pcOf, pretty, rootName, scaleDef, scaleNotes, SCALES, type Spelled } from '../../music/spell';
import { neckFrets, type Instrument } from '../../music/tuning';
import { Button, Segmented } from '../../ui';
import { ChipRow, HelpBox, NotePicker, ToolHeader } from '../controls';
import { useSelection } from '../selection';
import styles from '../Theory.module.css';
import { TheoryNeck, type NeckDot } from '../TheoryNeck';
import { useTheoryDoc } from '../TheoryDoc';

type System = 'boxes' | '3nps' | 'caged' | 'positions';

interface Step {
  label: string;
  cells: Cell[];
}

interface SystemDef {
  id: System;
  label: string;
  /** Why it is unavailable for this scale and instrument, or null. */
  unavailable: string | null;
  steps: () => Step[];
}

/** Scale notes inside a fret window, low to high (play order). */
function windowCells(inst: Instrument, notes: readonly Spelled[], lo: number, hi: number): Cell[] {
  return positionsOf(inst, new Set(notes.map((n) => n.pc)), lo, hi).sort((a, b) => a.midi - b.midi);
}

export function systems(inst: Instrument, notes: readonly Spelled[], frets: number): SystemDef[] {
  const rootPc = notes[0]!.pc;
  const guitar = inst.kind === 'guitar';
  const caged = cagedWindows(inst, rootPc);
  return [
    {
      id: 'boxes',
      label: 'Pentatonic boxes',
      unavailable: notes.length === 5 ? null : 'Pentatonic boxes are for 5-note scales',
      steps: () => pentatonicBoxes(inst, notes, frets),
    },
    {
      id: '3nps',
      label: '3 notes per string',
      unavailable: !guitar ? 'Three notes per string is a guitar system' : notes.length === 7 ? null : 'Three notes per string is for 7-note scales',
      steps: () => threeNotesPerString(inst, notes, frets),
    },
    {
      id: 'caged',
      label: 'CAGED',
      unavailable: !guitar ? 'CAGED is a guitar system' : caged ? null : 'CAGED shapes assume standard guitar tuning (E A D G B E)',
      steps: () => (caged ?? []).map((w) => ({ label: `${w.label} · frets ${w.lo}–${w.hi}`, cells: windowCells(inst, notes, w.lo, w.hi) })),
    },
    {
      id: 'positions',
      label: guitar ? 'Positions' : '1 finger per fret',
      unavailable: null,
      steps: () =>
        positionWindows(inst, rootPc, notes.map((n) => n.pc)).map((w) => ({
          label: `Position ${w.index} · frets ${w.lo}–${w.hi}`,
          cells: windowCells(inst, notes, w.lo, w.hi),
        })),
    },
  ];
}

export function ScalePositions() {
  const { doc } = useTheoryDoc();
  const inst = doc?.instrument ?? DEFAULT_THEORY.instrument;
  const [sel, select] = useSelection();
  const [chosen, setChosen] = useState<System | null>(null);
  const [step, setStep] = useState(0);
  const [order, setOrder] = useState(false);

  const notes = scaleNotes(sel.root, sel.scale);
  const frets = neckFrets(inst);
  const defs = systems(inst, notes, frets);
  const system = defs.find((d) => d.id === chosen && !d.unavailable) ?? defs.find((d) => !d.unavailable)!;
  const steps = system.steps();
  const current = steps[Math.min(step, steps.length - 1)]!;
  const inShape = new Map(current.cells.map((c, i) => [`${c.string}:${c.fret}`, i]));
  const rootPc = notes[0]!.pc;

  const dots: NeckDot[] = positionsOf(inst, new Set(notes.map((n) => n.pc)), 0, frets).map((p) => {
    const idx = inShape.get(`${p.string}:${p.fret}`);
    const note = notes.find((n) => n.pc === p.pc)!;
    return {
      string: p.string,
      fret: p.fret,
      marker: p.pc === rootPc ? 'root' : 'tone',
      label: idx !== undefined && order ? String(idx + 1) : note.interval,
      dim: idx === undefined,
    };
  });

  const choose = (id: System) => {
    setChosen(id);
    setStep(0);
  };

  return (
    <>
      <ToolHeader title="Scale positions">
        <label className={styles.check}>
          <input type="checkbox" checked={order} onChange={(e) => setOrder(e.target.checked)} />
          Play order
        </label>
      </ToolHeader>
      <div className={styles.row}>
        <span className={styles.cap}>root</span>
        <NotePicker label="Root" selected={[pcOf(sel.root)!]} onPick={(pc) => { select({ root: rootName(pc, scaleDef(sel.scale).mode) }); setStep(0); }} />
      </div>
      <ChipRow
        label="Scale"
        value={sel.scale}
        onChange={(scale) => { select({ scale, mode: scaleDef(scale).mode }); setStep(0); }}
        options={SCALES.map((s) => ({ value: s.id, label: s.label }))}
      />
      <div className={styles.choices} role="group" aria-label="System">
        {defs.map((d) => (
          <button
            key={d.id}
            type="button"
            className={styles.chip}
            aria-pressed={d.id === system.id}
            disabled={d.unavailable !== null}
            title={d.unavailable ?? undefined}
            onClick={() => choose(d.id)}
          >
            {d.label}
          </button>
        ))}
      </div>
      <div className={styles.row}>
        <Button onClick={() => setStep((s) => (s - 1 + steps.length) % steps.length)} aria-label="Previous shape">
          ←
        </Button>
        <Segmented<string>
          label="Shape"
          value={String(Math.min(step, steps.length - 1))}
          onChange={(v) => setStep(Number(v))}
          options={steps.map((_, i) => ({ value: String(i), label: String(i + 1) }))}
        />
        <Button onClick={() => setStep((s) => (s + 1) % steps.length)} aria-label="Next shape">
          →
        </Button>
        <b>{current.label}</b>
      </div>
      <div className={styles.neck}>
        <TheoryNeck instrument={inst} frets={frets} dots={dots} label={`${pretty(sel.root)} ${scaleDef(sel.scale).label}, ${current.label}`} />
      </div>
      <HelpBox>
        Learn one shape at a time: play it low to high and back{order ? ' in the numbered order' : ''}, then move to the next.
        Neighbouring shapes share notes, so together they cover the neck. The dimmed notes are the rest of the scale.
      </HelpBox>
    </>
  );
}
```

Register it in `frontend/src/theory/tools.ts` (import `ScalePositions`), after Note finder:

```ts
  { slug: 'scale-positions', label: 'Scale positions', group: 'Shapes', Component: ScalePositions },
```

- [ ] **Step 4: Run the tests**

Run: `npm --prefix frontend test -- src/theory`
Expected: all pass (scalePositions 3).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/theory/tools/ScalePositions.tsx frontend/src/theory/tools/scalePositions.test.tsx frontend/src/theory/tools.ts
git commit -m "feat(theory): Scale positions, one shape at a time, unavailable systems say why (D-19, N-08)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Triads & inversions

**Files:**
- Create: `frontend/src/theory/tools/Triads.tsx`
- Modify: `frontend/src/theory/tools.ts`
- Test: `frontend/src/theory/tools/triads.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { fireEvent, screen } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';

import { renderTool } from './testing';

afterEach(() => vi.unstubAllGlobals());

const guitar = { instrument: { kind: 'guitar' as const, strings: 6, tuning: ['E2', 'A2', 'D3', 'G3', 'B3', 'E4'], left_handed: false } };

test('triads: C major on the G-B-E strings in 2nd inversion', async () => {
  const { dots } = renderTool('/theory/triads?root=C', { theory: guitar });
  await screen.findByRole('heading', { name: 'Triads & inversions' });
  fireEvent.click(screen.getByRole('button', { name: 'G–B–E' }));
  fireEvent.click(screen.getByRole('button', { name: '2nd inversion' }));
  expect(dots()).toEqual(['s2f0:5', 's1f1:R', 's0f0:3', 's2f12:5', 's1f13:R', 's0f12:3']);
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npm --prefix frontend test -- src/theory/tools/triads.test.tsx`
Expected: FAIL (no heading named Triads & inversions).

- [ ] **Step 3: Implement**

```tsx
// Triads & inversions (D-19): a major, minor, diminished or augmented triad in
// root position or an inversion, on every set of three adjacent strings (or one
// chosen set). On bass these are the arpeggio shapes of the triad.
import { useState } from 'react';

import { DEFAULT_THEORY } from '../../api/client';
import { INVERSION_LABELS, stringSets, triadShapes, type Inversion } from '../../music/shapes';
import { chordInfo, chordSymbol, pcOf, pretty, rootName, type QualityId } from '../../music/spell';
import { neckFrets } from '../../music/tuning';
import { Segmented } from '../../ui';
import { ChipRow, HelpBox, NoteChips, NotePicker, ToolHeader } from '../controls';
import { useSelection } from '../selection';
import styles from '../Theory.module.css';
import { TheoryNeck, type NeckDot } from '../TheoryNeck';
import { useTheoryDoc } from '../TheoryDoc';

const TRIADS = ['maj', 'm', 'dim', 'aug'] as const satisfies readonly QualityId[];
type Triad = (typeof TRIADS)[number];

export function Triads() {
  const { doc } = useTheoryDoc();
  const inst = doc?.instrument ?? DEFAULT_THEORY.instrument;
  const [sel, select] = useSelection();
  const [inversion, setInversion] = useState<Inversion>(0);
  const [set, setSet] = useState('all');

  const quality: Triad = (TRIADS as readonly string[]).includes(sel.quality) ? (sel.quality as Triad) : 'maj';
  const parsed = chordInfo(chordSymbol(sel.root, quality));
  const triad = parsed.ok ? parsed.chord.notes : [];
  const frets = neckFrets(inst);
  const rowNames = [...inst.tuning].reverse().map((n) => pretty(n.replace(/-?\d+$/, '')));
  const sets = stringSets(inst).map((rows) => ({ id: rows.join('-'), rows, label: rows.map((r) => rowNames[r]).join('–') }));
  const shown = set === 'all' ? sets : sets.filter((s) => s.id === set);
  const rootPc = pcOf(sel.root)!;

  const dots: NeckDot[] = shown.flatMap((s) =>
    triadShapes(inst, triad, s.rows, inversion, frets).flatMap((cells) =>
      cells.map((c, i) => {
        const note = triad[(i + inversion) % 3]!;
        return { ...c, label: note.interval, marker: note.pc === rootPc ? ('root' as const) : ('tone' as const) };
      }),
    ),
  );

  return (
    <>
      <ToolHeader title="Triads & inversions">
        <Segmented<string>
          label="Inversion"
          value={String(inversion)}
          onChange={(v) => setInversion(Number(v) as Inversion)}
          options={INVERSION_LABELS.map((label, i) => ({ value: String(i), label }))}
        />
      </ToolHeader>
      <div className={styles.row}>
        <span className={styles.cap}>root</span>
        <NotePicker label="Root" selected={[rootPc]} onPick={(pc) => select({ root: rootName(pc, 'major'), chord: null })} />
      </div>
      <ChipRow label="Triad" value={quality} onChange={(q) => select({ quality: q, chord: null })} options={TRIADS.map((q) => ({ value: q, label: q }))} />
      <ChipRow label="Strings" value={set} onChange={setSet} options={[{ value: 'all', label: 'All' }, ...sets.map((s) => ({ value: s.id, label: s.label }))]} />
      <div className={styles.row}>
        <b>{pretty(chordSymbol(sel.root, quality))}</b>
        <NoteChips notes={triad} />
      </div>
      <div className={styles.neck}>
        <TheoryNeck instrument={inst} frets={frets} dots={dots} label={`${pretty(chordSymbol(sel.root, quality))} ${INVERSION_LABELS[inversion]}`} />
      </div>
      <HelpBox>
        <b>{INVERSION_LABELS[inversion]}</b>: the lowest note is the{' '}
        {['root', '3rd', '5th'][inversion]}. Each group of three strings holds one shape; the same shape repeats an octave
        up. Inversions let you play the same chord without jumping around the neck.
      </HelpBox>
    </>
  );
}
```

Register it in `tools.ts` (import `Triads`), after Scale positions:

```ts
  { slug: 'triads', label: 'Triads & inversions', group: 'Shapes', Component: Triads },
```

- [ ] **Step 4: Run the tests**

Run: `npm --prefix frontend test -- src/theory`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/theory/tools/Triads.tsx frontend/src/theory/tools/triads.test.tsx frontend/src/theory/tools.ts
git commit -m "feat(theory): Triads & inversions on every three-string set (D-19)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Arpeggios

**Files:**
- Create: `frontend/src/theory/tools/Arpeggios.tsx`
- Modify: `frontend/src/theory/tools.ts`
- Test: `frontend/src/theory/tools/arpeggios.test.tsx`

**Interfaces:**
- Consumes: `selectedChord` (ChordFinder.tsx) and `positionWindows` (positions.ts).

- [ ] **Step 1: Write the failing test**

```tsx
import { fireEvent, screen, within } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';

import { renderTool } from './testing';

afterEach(() => vi.unstubAllGlobals());

test('arpeggios: a highlighted position numbers its notes low to high', async () => {
  const { dots } = renderTool('/theory/arpeggios?root=A&q=m7');
  await screen.findByRole('heading', { name: 'Arpeggios' });
  fireEvent.click(within(screen.getByRole('group', { name: 'Position' })).getByRole('button', { name: '1' }));
  expect(screen.getByText('frets 5–8')).toBeInTheDocument();
  const lit = dots().filter((d) => !d.endsWith(':dim'));
  expect(lit[0]).toBe('s0f5:6');
  expect(lit).toContain('s3f5:1');
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npm --prefix frontend test -- src/theory/tools/arpeggios.test.tsx`
Expected: FAIL (no heading named Arpeggios).

- [ ] **Step 3: Implement**

```tsx
// Arpeggios (D-19): a chord's tones across the whole neck, with one position
// highlighted at a time and the notes in that position numbered low to high.
import { useState } from 'react';

import { DEFAULT_THEORY } from '../../api/client';
import { positionsOf, positionWindows } from '../../music/positions';
import { pcOf, pretty, QUALITIES, rootName } from '../../music/spell';
import { neckFrets } from '../../music/tuning';
import { Segmented } from '../../ui';
import { ChipRow, HelpBox, NoteChips, NotePicker, ToolHeader } from '../controls';
import { useSelection } from '../selection';
import styles from '../Theory.module.css';
import { TheoryNeck, type NeckDot } from '../TheoryNeck';
import { useTheoryDoc } from '../TheoryDoc';
import { selectedChord } from './ChordFinder';

export function Arpeggios() {
  const { doc } = useTheoryDoc();
  const inst = doc?.instrument ?? DEFAULT_THEORY.instrument;
  const [sel, select] = useSelection();
  const [position, setPosition] = useState<{ key: string; index: number } | null>(null);
  const [order, setOrder] = useState(true);

  const chord = selectedChord(sel);
  const frets = neckFrets(inst);
  const rootPc = pcOf(chord.root)!;
  const windows = positionWindows(inst, rootPc, chord.notes.map((n) => n.pc));
  const key = `${chord.symbol}-${inst.tuning.join('')}`;
  const active = position?.key === key ? windows.find((w) => w.index === position.index) ?? null : null;
  const all = positionsOf(inst, new Set(chord.notes.map((n) => n.pc)), 0, frets);
  const inWindow = active ? all.filter((p) => p.fret >= active.lo && p.fret <= active.hi).sort((a, b) => a.midi - b.midi) : [];

  const dots: NeckDot[] = all.map((p) => {
    const idx = inWindow.findIndex((q) => q.string === p.string && q.fret === p.fret);
    const note = chord.notes.find((n) => n.pc === p.pc)!;
    return {
      string: p.string,
      fret: p.fret,
      marker: p.pc === rootPc ? 'root' : 'tone',
      label: idx >= 0 && order ? String(idx + 1) : note.interval,
      dim: active ? idx < 0 : false,
    };
  });

  return (
    <>
      <ToolHeader title="Arpeggios">
        <label className={styles.check}>
          <input type="checkbox" checked={order} onChange={(e) => setOrder(e.target.checked)} />
          Play order
        </label>
      </ToolHeader>
      <div className={styles.row}>
        <span className={styles.cap}>root</span>
        <NotePicker label="Root" selected={[rootPc]} onPick={(pc) => select({ root: rootName(pc, 'major'), chord: null, bass: null })} />
      </div>
      <ChipRow label="Quality" value={sel.chord ? null : sel.quality} onChange={(q) => select({ quality: q, chord: null })} options={QUALITIES.map((q) => ({ value: q.id, label: q.label }))} />
      <div className={styles.row}>
        <b>{pretty(chord.symbol)}</b>
        <NoteChips notes={chord.notes} />
        <span className={styles.cap}>position</span>
        <Segmented<string>
          label="Position"
          value={active ? String(active.index) : 'all'}
          onChange={(v) => setPosition(v === 'all' ? null : { key, index: Number(v) })}
          options={[{ value: 'all', label: 'All' }, ...windows.map((w) => ({ value: String(w.index), label: String(w.index) }))]}
        />
        {active && <span className={styles.dimText}>frets {active.lo}–{active.hi}</span>}
      </div>
      <div className={styles.neck}>
        <TheoryNeck instrument={inst} frets={frets} dots={dots} window={active} label={`${pretty(chord.symbol)} arpeggio`} />
      </div>
      <HelpBox>
        An arpeggio is a chord played one note at a time. Pick a position and play the numbered notes up and back down;
        the root is filled.
      </HelpBox>
    </>
  );
}
```

Register it in `tools.ts` (import `Arpeggios`), after Triads:

```ts
  { slug: 'arpeggios', label: 'Arpeggios', group: 'Shapes', Component: Arpeggios },
```

- [ ] **Step 4: Run the tests**

Run: `npm --prefix frontend test -- src/theory`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/theory/tools/Arpeggios.tsx frontend/src/theory/tools/arpeggios.test.tsx frontend/src/theory/tools.ts
git commit -m "feat(theory): Arpeggios with one position numbered low to high (D-19)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Name that chord

**Files:**
- Create: `frontend/src/music/identify.ts`, `frontend/src/theory/tools/NameThatChord.tsx`
- Modify: `frontend/src/theory/tools.ts`
- Test: `frontend/src/music/identify.test.ts`, `frontend/src/theory/tools/nameThatChord.test.tsx`

**Interfaces:**
- Produces: `nameChord(notesLowFirst: string[]): string[]`, ranked as follows:
  1. a common chord in root position;
  2. a common chord over a slash bass;
  3. anything rarer.

  Fewer than 3 distinct notes returns `[]`.

- [ ] **Step 1: Write the failing tests**

`frontend/src/music/identify.test.ts`:

```ts
import { describe, expect, test } from 'vitest';

import { nameChord } from './identify';

describe('naming chords', () => {
  test('root position beats a slash name; common beats rare', () => {
    expect(nameChord(['A', 'C', 'E', 'G'])[0]).toBe('Am7');
    expect(nameChord(['C', 'E', 'G', 'A'])).toEqual(['C6', 'Am7/C']);
    expect(nameChord(['G', 'A', 'C', 'E'])).toEqual(['Am7/G', 'C6/G']);
    expect(nameChord(['E', 'G', 'C'])[0]).toBe('C/E');
    expect(nameChord(['C', 'E', 'G'])[0]).toBe('C');
  });

  test('duplicates collapse and fewer than three notes is no chord', () => {
    expect(nameChord(['C', 'E', 'G', 'C'])[0]).toBe('C');
    expect(nameChord(['C', 'E'])).toEqual([]);
    expect(nameChord(['C', 'C', 'E'])).toEqual([]);
  });
});
```

`frontend/src/theory/tools/nameThatChord.test.tsx`:

```tsx
import { fireEvent, screen, within } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';

import { renderTool } from './testing';

afterEach(() => vi.unstubAllGlobals());

const guitar = { instrument: { kind: 'guitar' as const, strings: 6, tuning: ['E2', 'A2', 'D3', 'G3', 'B3', 'E4'], left_handed: false } };

test('name that chord: tapped notes, lowest is the bass', async () => {
  renderTool('/theory/name-that-chord');
  await screen.findByRole('heading', { name: 'Name that chord' });
  expect(screen.getByText('Tap at least three different notes.')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'E string, fret 3' })); // G
  fireEvent.click(screen.getByRole('button', { name: 'A string, open' })); // A
  fireEvent.click(screen.getByRole('button', { name: 'D string, fret 10' })); // C
  fireEvent.click(screen.getByRole('button', { name: 'G string, fret 9' })); // E
  const names = within(screen.getByRole('region', { name: 'Chord names' })).getAllByRole('button').map((b) => b.textContent);
  expect(names).toEqual(['Am7/G', 'C6/G']);
});

test('name that chord: the note row, and notes with no name', async () => {
  renderTool('/theory/name-that-chord');
  await screen.findByRole('heading', { name: 'Name that chord' });
  const row = screen.getByRole('group', { name: 'Notes' });
  for (const n of ['C', 'C♯/D♭', 'D']) fireEvent.click(within(row).getByRole('button', { name: n }));
  expect(screen.getByRole('region', { name: 'Chord names' })).toHaveTextContent('No chord name for these notes: C (R), C♯ (♭2), D (2).');
});

test('name that chord: guitar strings sound one note each', async () => {
  const { dots } = renderTool('/theory/name-that-chord', { theory: guitar });
  await screen.findByRole('heading', { name: 'Name that chord' });
  fireEvent.click(screen.getByRole('button', { name: 'A string, fret 3' }));
  fireEvent.click(screen.getByRole('button', { name: 'A string, fret 5' }));
  expect(dots()).toEqual(['s4f5:D']);
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npm --prefix frontend test -- src/music/identify.test.ts src/theory/tools/nameThatChord.test.tsx`
Expected: FAIL, `Failed to resolve import "./identify"`.

- [ ] **Step 3: Implement `identify.ts`**

```ts
// Notes -> chord names, for Name that chord (D-19). tonal's Chord.detect finds
// every name; the ranking here decides which one a player would say first:
// a common chord in root position, then a common chord over a slash bass, then
// anything rarer. "Em#5" is a real name for E G C, but "C/E" is the answer.
import { Chord } from 'tonal';

import { pcOf } from './spell';

// Most familiar first. Keys are tonal chord-type names.
const COMMON = [
  'major', 'minor', 'dominant seventh', 'major seventh', 'minor seventh', 'diminished',
  'augmented', 'suspended fourth', 'suspended second', 'half-diminished', 'diminished seventh',
  'sixth', 'minor sixth', 'dominant ninth', '', 'minor/major seventh',
];

// tonal writes a major triad as "M" and "Madd9" for add9; players write neither.
function tidy(symbol: string): string {
  return symbol.replace(/^([A-G][#b]*)M(?=$|\/)/, '$1').replace(/^([A-G][#b]*)Madd9/, '$1add9');
}

/**
 * Chord names for a set of notes, lowest note first (it is the bass), ranked.
 * Fewer than three different notes is not a chord: [].
 */
export function nameChord(notesLowFirst: readonly string[]): string[] {
  const distinct: string[] = [];
  for (const n of notesLowFirst) if (!distinct.some((d) => pcOf(d) === pcOf(n))) distinct.push(n);
  if (distinct.length < 3) return [];
  const score = (symbol: string) => {
    const [main = ''] = symbol.split('/');
    const rank = COMMON.indexOf(Chord.get(main).type);
    return (rank < 0 ? 1000 : 0) + (symbol.includes('/') ? 100 : 0) + (rank < 0 ? 50 : rank);
  };
  return Chord.detect(distinct)
    .map((s, i) => ({ s: tidy(s), i }))
    .sort((a, b) => score(a.s) - score(b.s) || a.i - b.i)
    .map((x) => x.s);
}
```

- [ ] **Step 4: Implement the tool**

```tsx
// Name that chord (D-19): tap notes on the neck, or on the note row, and see
// every chord name for them, the most likely first (identify.ts). The lowest
// tapped note is the bass. Notes with no chord name say so and are listed with
// their intervals instead of being forced into a name (N-08).
import { useState } from 'react';

import { DEFAULT_THEORY } from '../../api/client';
import { mod12 } from '../../music/chordTones';
import { nameChord } from '../../music/identify';
import { positionAt, type Cell } from '../../music/positions';
import { chordInfo, namer, pretty, scaleNotes } from '../../music/spell';
import { neckFrets } from '../../music/tuning';
import { Button } from '../../ui';
import { ChipRow, HelpBox, NotePicker, ToolHeader } from '../controls';
import { useSelection } from '../selection';
import styles from '../Theory.module.css';
import { TheoryNeck, type NeckDot } from '../TheoryNeck';
import { useTheoryDoc } from '../TheoryDoc';
import { useChosenSong } from '../useChosenSong';

// Intervals above the lowest note, for notes that make no chord.
const SEMITONE_LABELS = ['R', '♭2', '2', '♭3', '3', '4', '♭5', '5', '♭6', '6', '♭7', '7'];

export function NameThatChord() {
  const { doc } = useTheoryDoc();
  const inst = doc?.instrument ?? DEFAULT_THEORY.instrument;
  const [sel, select] = useSelection();
  const song = useChosenSong();
  const [cells, setCells] = useState<Cell[]>([]);
  const [pcs, setPcs] = useState<number[]>([]);
  const frets = neckFrets(inst);
  const name = namer(scaleNotes(sel.root, sel.scale).map((n) => n.name));

  const tap = (cell: Cell) =>
    setCells((cur) => {
      if (cur.some((c) => c.string === cell.string && c.fret === cell.fret)) {
        return cur.filter((c) => !(c.string === cell.string && c.fret === cell.fret));
      }
      // A guitar string sounds one note at a time; bass players tap arpeggios, so any number.
      const others = inst.kind === 'guitar' ? cur.filter((c) => c.string !== cell.string) : cur;
      return [...others, cell];
    });
  const togglePc = (pc: number) => setPcs((cur) => (cur.includes(pc) ? cur.filter((p) => p !== pc) : [...cur, pc]));

  const tapped = cells.map((c) => positionAt(inst, c)).sort((a, b) => a.midi - b.midi);
  const lowFirst = [...tapped.map((p) => p.pc), ...pcs];
  const notes = lowFirst.map(name);
  const names = nameChord(notes);
  const distinct = [...new Set(lowFirst)];
  const bass = notes[0];

  const dots: NeckDot[] = cells.map((c) => ({ ...c, label: pretty(name(positionAt(inst, c).pc)), marker: 'accent' }));

  const loadSongChord = (symbol: string) => {
    const info = chordInfo(symbol);
    if (!info.ok) return;
    setCells([]);
    setPcs(info.chord.notes.map((n) => n.pc));
  };

  return (
    <>
      <ToolHeader title="Name that chord">
        <Button variant="ghost" onClick={() => { setCells([]); setPcs([]); }} disabled={cells.length + pcs.length === 0}>
          Clear
        </Button>
      </ToolHeader>
      <div className={styles.stack}>
        <span className={styles.cap}>or tap notes here</span>
        <NotePicker label="Notes" selected={pcs} onPick={togglePc} />
      </div>
      {song.state === 'ready' && song.distinct.length > 0 && (
        <ChipRow label={`In ${song.title}`} value={null} onChange={loadSongChord} options={song.distinct.map((s) => ({ value: s, label: pretty(s) }))} />
      )}
      <div className={styles.neck}>
        <TheoryNeck instrument={inst} frets={frets} dots={dots} onPick={tap} label="Tap notes to name a chord" />
      </div>
      <section aria-label="Chord names" className={styles.names}>
        {distinct.length < 3 ? (
          <span className={styles.dimText}>Tap at least three different notes.</span>
        ) : names.length > 0 ? (
          names.map((n, i) => (
            <button key={n} type="button" className={i === 0 ? styles.big : styles.chip} onClick={() => select({ chord: n })}>
              {pretty(n)}
            </button>
          ))
        ) : (
          <span>
            No chord name for these notes:{' '}
            {distinct.map((pc) => `${pretty(name(pc))} (${SEMITONE_LABELS[mod12(pc - lowFirst[0]!)]})`).join(', ')}.
          </span>
        )}
      </section>
      <HelpBox>
        The lowest note you tap is the bass{bass ? <>, here <b>{pretty(bass)}</b></> : ''}. A name with a slash, like Am7/G,
        means that chord over a different bass note. Click a name to use it in the other tools.
      </HelpBox>
    </>
  );
}
```

Register it in `tools.ts` (import `NameThatChord`), after Note finder and before Scale positions:

```ts
  { slug: 'name-that-chord', label: 'Name that chord', group: 'Find', Component: NameThatChord },
```

- [ ] **Step 5: Run the tests**

Run: `npm --prefix frontend test -- src/music/identify.test.ts src/theory`
Expected: all pass (identify 2, nameThatChord 3).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/music/identify.ts frontend/src/music/identify.test.ts frontend/src/theory/tools/NameThatChord.tsx frontend/src/theory/tools/nameThatChord.test.tsx frontend/src/theory/tools.ts
git commit -m "feat(theory): Name that chord, ranked names, honest when there is none (D-19, N-08)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Scales over a chord

**Files:**
- Create: `frontend/src/music/harmony.ts`, `frontend/src/theory/tools/ScalesOverChord.tsx`
- Modify: `frontend/src/theory/tools.ts`
- Test: `frontend/src/music/harmony.test.ts`, `frontend/src/theory/tools/scalesOverChord.test.tsx`

**Interfaces:**
- Produces:
  - `ScaleFit { scale; root; label }` and `scalesOverChord(chord)`. Candidates are the scales in `SCALES` built on the chord's root that hold every chord tone, fewest notes first, then `SCALES` order.
  - `numeralInKey(tonic, mode, symbol): string | null`, which gives the key triad's numeral when the chord contains that triad, else null (borrowed).

- [ ] **Step 1: Write the failing tests**

`frontend/src/music/harmony.test.ts`:

```ts
import { describe, expect, test } from 'vitest';

import { numeralInKey, scalesOverChord } from './harmony';
import { chordInfo, type ChordInfo } from './spell';

const chord = (s: string): ChordInfo => {
  const r = chordInfo(s);
  if (!r.ok) throw new Error(r.reason);
  return r.chord;
};

describe('harmony', () => {
  test('scales over a chord, safest first', () => {
    expect(scalesOverChord(chord('Am7')).map((s) => s.label)).toEqual([
      'A minor pentatonic', 'A blues', 'A minor', 'A dorian', 'A phrygian',
    ]);
    expect(scalesOverChord(chord('G7')).map((s) => s.label)).toEqual(['G mixolydian']);
  });

  test('numerals in a key, or null when borrowed', () => {
    expect(numeralInKey('G', 'major', 'Em7')).toBe('vi');
    expect(numeralInKey('G', 'major', 'D7')).toBe('V');
    expect(numeralInKey('G', 'major', 'Bb')).toBeNull();
    expect(numeralInKey('G', 'major', 'Cm')).toBeNull();
    expect(numeralInKey('E', 'minor', 'C')).toBe('VI');
  });
});
```

`frontend/src/theory/tools/scalesOverChord.test.tsx`:

```tsx
import { screen, within } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';

import { renderTool } from './testing';

afterEach(() => vi.unstubAllGlobals());

test('scales over a chord: safest first, chord tones full strength', async () => {
  const { dots } = renderTool('/theory/scales-over-chord?root=A&q=m7');
  const list = await screen.findByRole('list', { name: 'Scales over Am7' });
  expect(within(list).getAllByRole('button').map((b) => b.textContent)).toEqual([
    '1. A minor pentatonic', '2. A blues', '3. A minor', '4. A dorian', '5. A phrygian',
  ]);
  expect(dots()).toContain('s3f5:R');
  expect(dots()).toContain('s2f5:4:dim');
  expect(within(list).getAllByRole('link')[0]).toHaveAttribute('href', '/theory/scale-finder?root=A&scale=minor-pentatonic&q=m7');
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npm --prefix frontend test -- src/music/harmony.test.ts src/theory/tools/scalesOverChord.test.tsx`
Expected: FAIL, `Failed to resolve import "./harmony"`.

- [ ] **Step 3: Implement `harmony.ts`**

```ts
// Harmony lookups that sit on top of spell.ts (D-19): which scales fit a
// chord, and what a song's chord is called in its key.
import { chordInfo, keyChords, pcOf, scaleNotes, SCALES, type ChordInfo, type KeyMode, type ScaleId } from './spell';

export interface ScaleFit {
  scale: ScaleId;
  root: string;
  label: string;
}

/**
 * Scales built on the chord's root that contain every chord tone, safest first:
 * fewer notes first (a pentatonic has no wrong notes to land on), then SCALES
 * order. Am7 -> A minor pentatonic, A blues, A minor, A dorian, A phrygian.
 */
export function scalesOverChord(chord: ChordInfo): ScaleFit[] {
  const tones = chord.notes.map((n) => n.pc);
  return SCALES.map((def, order) => ({ def, order, notes: scaleNotes(chord.root, def.id) }))
    .filter(({ notes }) => tones.every((pc) => notes.some((n) => n.pc === pc)))
    .sort((a, b) => a.notes.length - b.notes.length || a.order - b.order)
    .map(({ def }) => ({ scale: def.id, root: chord.root, label: `${chord.root} ${def.label.toLowerCase()}` }));
}

/**
 * The numeral of a chord in a key when it is diatonic (its triad is one of the
 * key's seven), else null: the caller labels it "borrowed" rather than force a
 * numeral on it. G major: Em7 -> "vi", D7 -> "V", Bb -> null.
 */
export function numeralInKey(tonic: string, mode: KeyMode, symbol: string): string | null {
  const parsed = chordInfo(symbol);
  if (!parsed.ok) return null;
  const pcs = new Set(parsed.chord.notes.map((n) => n.pc));
  const rootPc = pcOf(parsed.chord.root);
  for (const kc of keyChords(tonic, mode, 'triads')) {
    const triad = chordInfo(kc.symbol);
    if (triad.ok && pcOf(triad.chord.root) === rootPc && triad.chord.notes.every((n) => pcs.has(n.pc))) return kc.numeral;
  }
  return null;
}
```

- [ ] **Step 4: Implement the tool**

The "Open in Scale finder" link sets `mode` from the fitted scale. Keeping the old mode would open A minor pentatonic in major mode.

```tsx
// Scales over a chord (D-19): the scales built on the chord's root that hold
// every chord tone, safest first. The neck shows the picked scale with the
// chord tones full strength: they are the notes to land on.
import { useState } from 'react';
import { Link } from 'react-router-dom';

import { DEFAULT_THEORY } from '../../api/client';
import { scalesOverChord } from '../../music/harmony';
import { positionAt } from '../../music/positions';
import { pcOf, pretty, QUALITIES, rootName, scaleDef, scaleNotes } from '../../music/spell';
import { neckFrets } from '../../music/tuning';
import { ChipRow, HelpBox, NotePicker, ToolHeader } from '../controls';
import { noteDots } from '../neckDots';
import { selectionParams, useSelection } from '../selection';
import styles from '../Theory.module.css';
import { TheoryNeck } from '../TheoryNeck';
import { useTheoryDoc } from '../TheoryDoc';
import { selectedChord } from './ChordFinder';

export function ScalesOverChord() {
  const { doc } = useTheoryDoc();
  const inst = doc?.instrument ?? DEFAULT_THEORY.instrument;
  const [sel, select] = useSelection();
  const [picked, setPicked] = useState(0);
  const chord = selectedChord(sel);
  const fits = scalesOverChord(chord);
  const current = fits[Math.min(picked, fits.length - 1)];
  const frets = neckFrets(inst);
  const tones = new Set(chord.notes.map((n) => n.pc));
  // Chord tones at full strength (the notes to land on), the rest of the scale dimmed.
  const dots = current
    ? noteDots(inst, scaleNotes(current.root, current.scale), { lo: 0, hi: frets, labels: 'interval' }).map((d) => ({
        ...d,
        dim: !tones.has(positionAt(inst, d).pc),
      }))
    : [];

  return (
    <>
      <ToolHeader title="Scales over a chord" />
      <div className={styles.row}>
        <span className={styles.cap}>root</span>
        <NotePicker label="Root" selected={[pcOf(chord.root)!]} onPick={(pc) => { select({ root: rootName(pc, 'major'), chord: null, bass: null }); setPicked(0); }} />
      </div>
      <ChipRow label="Quality" value={sel.chord ? null : sel.quality} onChange={(q) => { select({ quality: q, chord: null }); setPicked(0); }} options={QUALITIES.map((q) => ({ value: q.id, label: q.label }))} />
      {fits.length === 0 ? (
        <p className={styles.dimText}>No scale in the list holds every note of {pretty(chord.symbol)}.</p>
      ) : (
        <ol className={styles.list} aria-label={`Scales over ${pretty(chord.symbol)}`}>
          {fits.map((f, i) => (
            <li key={f.scale} className={styles.listRow} aria-current={i === picked}>
              <button type="button" className={styles.chip} aria-pressed={i === picked} onClick={() => setPicked(i)}>
                {i + 1}. {pretty(f.label)}
              </button>
              <span className={styles.dimText}>{scaleNotes(f.root, f.scale).map((n) => pretty(n.name)).join(' ')}</span>
              <Link to={`/theory/scale-finder?${selectionParams({ ...sel, root: f.root, scale: f.scale, mode: scaleDef(f.scale).mode, chord: null }).toString()}`}>Open in Scale finder</Link>
            </li>
          ))}
        </ol>
      )}
      {current && (
        <div className={styles.neck}>
          <TheoryNeck instrument={inst} frets={frets} dots={dots} label={`${pretty(current.label)} over ${pretty(chord.symbol)}`} />
        </div>
      )}
      <HelpBox>
        Safest first: fewer notes means fewer to get wrong. The full-strength notes are the chord&apos;s own, the ones to
        land on; the faded ones are passing notes.
      </HelpBox>
    </>
  );
}
```

Register it in `tools.ts` (import `ScalesOverChord`), last in the Harmony group:

```ts
  { slug: 'scales-over-chord', label: 'Scales over a chord', group: 'Harmony', Component: ScalesOverChord },
```

- [ ] **Step 5: Run the tests**

Run: `npm --prefix frontend test -- src/music/harmony.test.ts src/theory`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/music/harmony.ts frontend/src/music/harmony.test.ts frontend/src/theory/tools/ScalesOverChord.tsx frontend/src/theory/tools/scalesOverChord.test.tsx frontend/src/theory/tools.ts
git commit -m "feat(theory): Scales over a chord, safest first, chord tones to land on (D-19)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Circle of fifths

**Files:**
- Create: `frontend/src/theory/tools/CircleOfFifthsTool.tsx`
- Modify: `frontend/src/theory/tools.ts`
- Test: `frontend/src/theory/tools/circleOfFifths.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { fireEvent, screen, within } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';

import { renderTool } from './testing';

afterEach(() => vi.unstubAllGlobals());

test('circle of fifths: key signature, relative key and neighbours', async () => {
  const { where } = renderTool('/theory/circle-of-fifths?root=D');
  await screen.findByRole('heading', { name: 'Circle of fifths' });
  expect(screen.getByText(/Key signature/)).toHaveTextContent('2 sharps · F♯ C♯');
  expect(screen.getByRole('link', { name: 'B minor' })).toHaveAttribute('href', '/theory/chords-in-key?root=B&scale=minor');
  fireEvent.click(within(screen.getByRole('group', { name: 'Circle of fifths' })).getByRole('button', { name: 'A major' }));
  expect(where()).toBe('/theory/circle-of-fifths?root=A');
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npm --prefix frontend test -- src/theory/tools/circleOfFifths.test.tsx`
Expected: FAIL (no heading named Circle of fifths).

- [ ] **Step 3: Implement**

```tsx
// Circle of fifths (D-19): the same circle as on Chords in a key, drawn large,
// with the chosen key's signature, relative key, neighbours and chords.
import { Link } from 'react-router-dom';

import { keyChords, pretty, relativeKey, type KeyMode } from '../../music/spell';
import { CircleOfFifths, signatureText } from '../CircleOfFifths';
import { HelpBox, ToolHeader } from '../controls';
import { selectionParams, useSelection } from '../selection';
import styles from '../Theory.module.css';

const MAJORS = ['C', 'G', 'D', 'A', 'E', 'B', 'F#', 'Db', 'Ab', 'Eb', 'Bb', 'F'];

export function CircleOfFifthsTool() {
  const [sel, select] = useSelection();
  const setKey = (root: string, mode: KeyMode) => select({ root, mode, scale: mode === 'minor' ? 'minor' : 'major' });
  const rel = relativeKey(sel.root, sel.mode);
  const major = sel.mode === 'major' ? sel.root : rel.root;
  const i = MAJORS.findIndex((k) => k === major);
  const neighbours = i < 0 ? [] : [MAJORS[(i + 11) % 12]!, MAJORS[(i + 1) % 12]!];
  const chords = keyChords(sel.root, sel.mode, 'triads');
  const toKey = (root: string, mode: KeyMode) =>
    `/theory/chords-in-key?${selectionParams({ ...sel, root, mode, scale: mode === 'minor' ? 'minor' : 'major' }).toString()}`;

  return (
    <>
      <ToolHeader title="Circle of fifths" />
      <div className={styles.split}>
        <CircleOfFifths root={sel.root} mode={sel.mode} size={460} onPick={setKey} />
        <div className={styles.grow}>
          <h2 className={styles.big}>
            {pretty(sel.root)} {sel.mode}
          </h2>
          <p>Key signature: {signatureText(sel.root, sel.mode)}</p>
          <p>
            Relative {rel.mode}: <Link to={toKey(rel.root, rel.mode)}>{pretty(rel.root)} {rel.mode}</Link>
          </p>
          {neighbours.length > 0 && (
            <p>
              Neighbours (one sharp or flat away):{' '}
              {neighbours.map((k, n) => (
                <span key={k}>
                  {n > 0 && ' · '}
                  <button type="button" className={styles.chip} onClick={() => setKey(k, 'major')}>
                    {pretty(k)} major
                  </button>
                </span>
              ))}
            </p>
          )}
          <p>
            Chords:{' '}
            {chords.map((c) => `${c.numeral} ${pretty(c.symbol)}`).join(' · ')} ·{' '}
            <Link to={toKey(sel.root, sel.mode)}>open in Chords in a key</Link>
          </p>
          <HelpBox>
            Going clockwise adds a sharp (or removes a flat); counter-clockwise adds a flat. Keys next to each other share
            six of their seven notes, which is why songs so often move between them.
          </HelpBox>
        </div>
      </div>
    </>
  );
}
```

Register it in `tools.ts` (import `CircleOfFifthsTool`), after Chords in a key:

```ts
  { slug: 'circle-of-fifths', label: 'Circle of fifths', group: 'Harmony', Component: CircleOfFifthsTool },
```

- [ ] **Step 4: Run the tests**

Run: `npm --prefix frontend test -- src/theory`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/theory/tools/CircleOfFifthsTool.tsx frontend/src/theory/tools/circleOfFifths.test.tsx frontend/src/theory/tools.ts
git commit -m "feat(theory): Circle of fifths tool, signature, relative key and neighbours (D-19)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Progressions

**Files:**
- Create: `frontend/src/theory/tools/Progressions.tsx`
- Modify: `frontend/src/theory/tools.ts`
- Test: `frontend/src/theory/tools/progressionsTool.test.tsx`

**Interfaces:**
- Consumes: `PROGRESSIONS` and `progressionChords` (foundation Task 5); `numeralInKey` (Task 8); `useChosenSong().sequence` (foundation Task 9).

- [ ] **Step 1: Write the failing test**

```tsx
import { fireEvent, screen, within } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';

import { renderTool } from './testing';

afterEach(() => vi.unstubAllGlobals());

test('progressions: transposed to the key and stepped through', async () => {
  const { dots } = renderTool('/theory/progressions?root=G');
  await screen.findByRole('heading', { name: 'Progressions' });
  const bars = screen.getByRole('list', { name: 'Bars' });
  expect(within(bars).getAllByRole('button').map((b) => b.textContent)).toEqual(['IG', 'VD', 'viEm', 'IVC']);
  fireEvent.click(screen.getByRole('button', { name: 'Next bar' }));
  expect(within(bars).getAllByRole('button')[1]).toHaveAttribute('aria-pressed', 'true');
  expect(dots()).toContain('s1f0:R');
});

test("progressions: this song's chart with numerals, borrowed chords labelled", async () => {
  renderTool('/theory/progressions?root=G&scale=minor', {
    theory: { song_id: '01SONG' },
    analysis: {
      schema_version: 1,
      key_candidates: [{ tonic: 'G', mode: 'minor', confidence: 1 }],
      beat_grid: { bpm: 120, beats: [0], downbeats: [0] },
      chords: [
        { bar: 0, start_sample: 0, end_sample: 1, chord: 'G:min' },
        { bar: 1, start_sample: 1, end_sample: 2, chord: 'D#:maj' },
        { bar: 2, start_sample: 2, end_sample: 3, chord: 'D:7' },
      ],
    },
  });
  fireEvent.click(await screen.findByRole('button', { name: 'This song · Tightrope' }));
  const bars = screen.getByRole('list', { name: 'Bars' });
  expect(within(bars).getAllByRole('button').map((b) => b.textContent)).toEqual(['iGm', 'VIE♭', 'borrowedD7']);
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npm --prefix frontend test -- src/theory/tools/progressionsTool.test.tsx`
Expected: FAIL (no heading named Progressions).

- [ ] **Step 3: Implement**

```tsx
// Progressions (D-19): ~15 common progressions in any key, stepped through bar
// by bar on the neck. With a song chosen, "This song" is its chord chart with
// numerals against the key; a chord outside the key is labelled borrowed, not
// forced into a numeral (N-08).
import { useState } from 'react';

import { DEFAULT_THEORY } from '../../api/client';
import { numeralInKey } from '../../music/harmony';
import { progressionChords, PROGRESSIONS } from '../../music/progressions';
import { chordInfo, pcOf, pretty, rootName } from '../../music/spell';
import { Button } from '../../ui';
import { ChipRow, HelpBox, NoteChips, NotePicker, ToolHeader } from '../controls';
import { noteDots } from '../neckDots';
import { useSelection } from '../selection';
import styles from '../Theory.module.css';
import { TheoryNeck } from '../TheoryNeck';
import { useTheoryDoc } from '../TheoryDoc';
import { useChosenSong } from '../useChosenSong';

const THIS_SONG = 'this-song';

export function Progressions() {
  const { doc } = useTheoryDoc();
  const inst = doc?.instrument ?? DEFAULT_THEORY.instrument;
  const [sel, select] = useSelection();
  const song = useChosenSong();
  const [id, setId] = useState('pop');
  const [bar, setBar] = useState(0);

  const fromSong = id === THIS_SONG && song.state === 'ready';
  const def = PROGRESSIONS.find((p) => p.id === id) ?? PROGRESSIONS[0]!;
  const chords = fromSong ? song.sequence : progressionChords(def, sel.root);
  const numerals = fromSong
    ? chords.map((c) => numeralInKey(sel.root, sel.mode, c) ?? 'borrowed')
    : def.numerals;
  const current = Math.min(bar, chords.length - 1);
  const info = chordInfo(chords[current] ?? 'C');

  const options = [
    ...(song.state === 'ready' && song.sequence.length > 0 ? [{ value: THIS_SONG, label: `This song · ${song.title}` }] : []),
    ...PROGRESSIONS.map((p) => ({ value: p.id, label: p.label })),
  ];

  return (
    <>
      <ToolHeader title="Progressions" />
      <ChipRow label="Progression" value={id} onChange={(v) => { setId(v); setBar(0); }} options={options} />
      <div className={styles.row}>
        <span className={styles.cap}>key</span>
        <NotePicker label="Key" selected={[pcOf(sel.root)!]} onPick={(pc) => select({ root: rootName(pc, fromSong ? sel.mode : def.mode), mode: fromSong ? sel.mode : def.mode })} />
      </div>
      <ol className={styles.choices} aria-label="Bars">
        {chords.map((c, i) => (
          <li key={`${c}-${i}`}>
            <button type="button" className={styles.keyCard} aria-pressed={i === current} onClick={() => setBar(i)}>
              <span className={styles.numeral}>{numerals[i]}</span>
              <span className={styles.keyChord}>{pretty(c)}</span>
            </button>
          </li>
        ))}
      </ol>
      <div className={styles.row}>
        <Button onClick={() => setBar((current - 1 + chords.length) % chords.length)} aria-label="Previous bar">
          ←
        </Button>
        <Button onClick={() => setBar((current + 1) % chords.length)} aria-label="Next bar">
          →
        </Button>
        {info.ok && (
          <>
            <b>
              {numerals[current]} · {pretty(info.chord.symbol)}
            </b>
            <NoteChips notes={info.chord.notes} />
          </>
        )}
      </div>
      {info.ok && (
        <div className={styles.neck}>
          <TheoryNeck instrument={inst} frets={12} dots={noteDots(inst, info.chord.notes, { lo: 0, hi: 12, labels: 'interval' })} label={`${pretty(info.chord.symbol)} on ${inst.kind}`} />
        </div>
      )}
      <HelpBox>
        {fromSong
          ? `Numerals are read against ${pretty(sel.root)} ${sel.mode}. A chord marked borrowed is not one of the key's seven.`
          : 'Roman numerals name each chord by its step in the key, so the same progression works in any key: pick another key above.'}
      </HelpBox>
    </>
  );
}
```

Register it in `tools.ts` (import `Progressions`), after Circle of fifths. `tools.ts` now reads:

```ts
// The Theory tab's tools, in rail order (D-19). The rail, the routes and the
// "last tool" redirect all read this list; a tool exists in the UI exactly when
// it is registered here.
import type { ComponentType } from 'react';

import type { TheoryTool } from '../api/client';
import { Arpeggios } from './tools/Arpeggios';
import { ChordFinder } from './tools/ChordFinder';
import { ChordsInKey } from './tools/ChordsInKey';
import { CircleOfFifthsTool } from './tools/CircleOfFifthsTool';
import { NameThatChord } from './tools/NameThatChord';
import { NoteFinder } from './tools/NoteFinder';
import { Progressions } from './tools/Progressions';
import { ScaleFinder } from './tools/ScaleFinder';
import { ScalePositions } from './tools/ScalePositions';
import { ScalesOverChord } from './tools/ScalesOverChord';
import { Triads } from './tools/Triads';

export type ToolGroup = 'Find' | 'Shapes' | 'Harmony' | 'Practice';

export interface ToolDef {
  slug: TheoryTool;
  label: string;
  group: ToolGroup;
  Component: ComponentType;
}

export const GROUPS: readonly ToolGroup[] = ['Find', 'Shapes', 'Harmony', 'Practice'];

export const TOOLS: readonly ToolDef[] = [
  { slug: 'scale-finder', label: 'Scale finder', group: 'Find', Component: ScaleFinder },
  { slug: 'chord-finder', label: 'Chord finder', group: 'Find', Component: ChordFinder },
  { slug: 'note-finder', label: 'Note finder', group: 'Find', Component: NoteFinder },
  { slug: 'name-that-chord', label: 'Name that chord', group: 'Find', Component: NameThatChord },
  { slug: 'scale-positions', label: 'Scale positions', group: 'Shapes', Component: ScalePositions },
  { slug: 'triads', label: 'Triads & inversions', group: 'Shapes', Component: Triads },
  { slug: 'arpeggios', label: 'Arpeggios', group: 'Shapes', Component: Arpeggios },
  { slug: 'chords-in-key', label: 'Chords in a key', group: 'Harmony', Component: ChordsInKey },
  { slug: 'circle-of-fifths', label: 'Circle of fifths', group: 'Harmony', Component: CircleOfFifthsTool },
  { slug: 'progressions', label: 'Progressions', group: 'Harmony', Component: Progressions },
  { slug: 'scales-over-chord', label: 'Scales over a chord', group: 'Harmony', Component: ScalesOverChord },
];

export function toolBySlug(slug: string | undefined): ToolDef | undefined {
  return TOOLS.find((t) => t.slug === slug);
}
```

- [ ] **Step 4: Run everything**

Run: `npm --prefix frontend test && npm --prefix frontend run build`
Expected: everything passes, and the build is clean with no 500 kB warning (the Theory chunk is about 80 kB).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/theory/tools/Progressions.tsx frontend/src/theory/tools/progressionsTool.test.tsx frontend/src/theory/tools.ts
git commit -m "feat(theory): Progressions in any key, and this song's chart with borrowed chords labelled (D-19)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: README, screenshot, verification, push

**Files:**
- Modify: `README.md`
- Create: `docs/screenshots/theory-shapes.png`

- [ ] **Step 1: Update the README feature bullet**

Replace the Theory tab bullet (added by the foundation phase) with:

```markdown
- Theory tab for 4- and 5-string bass and guitar in any tuning, left-handed too: scale,
  chord and note finders, name a chord from notes you tap, scale positions (pentatonic
  boxes, 3-notes-per-string, CAGED), triads and inversions, arpeggios, guitar voicings and
  bass arpeggio shapes, chords in a key, a circle of fifths, progressions in any key and
  scales that fit a chord. Load an analysed song's key and chords into it with one click
```

Under `## Screens`, add `![Theory: scale positions](docs/screenshots/theory-shapes.png)` after the Theory image. Update the count ("All eight are captures"), and add `theory-shapes=/theory/scale-positions?root=A&scale=minor-pentatonic` to the capture command.

- [ ] **Step 2: Capture the screenshot**

With the API and dev server running, set the instrument to Guitar · 6 string in the rail footer first. It is saved in `theory.json`, so the capture shows guitar boxes.

Run: `node scripts/capture-screens.mjs "theory-shapes=/theory/scale-positions?root=A&scale=minor-pentatonic"`
Expected: `docs/screenshots/theory-shapes.png` shows Box 1 of A minor pentatonic at fret 5, with the rest of the scale dimmed.

- [ ] **Step 3: Full verification**

Run: `uv run pytest && npm --prefix frontend test && npm --prefix frontend run build`
Expected: everything passes. Then check in the running app:
- in drop D, the CAGED button is disabled and its tooltip gives the reason;
- tapping G A C E in Name that chord gives Am7/G first;
- with a song chosen, Progressions → "This song" shows numerals, with borrowed chords labelled.

- [ ] **Step 4: Commit and push**

```bash
git add README.md docs/screenshots/theory-shapes.png
git commit -m "docs: README and screenshot for the Theory tab's shapes and harmony tools (D-19)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push origin main
```
