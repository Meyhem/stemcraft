# Theory Quizzes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the Theory tab's Practice group:
- a **Fretboard quiz** (name the note, find the note, find the interval, spell the chord);
- a **Theory quiz** (keys, chords, intervals as four-option questions).

Both weight questions towards the player's weak spots, keep the answer history in `theory.json`, and show a weak-spot panel.

**Architecture:**
- **Logic:** `frontend/src/music/quiz.ts` is pure and seeded, with no React.
  - It holds the answer model, weakness from each item's last 5 answers, and weighted picking that never repeats an item twice in a row.
  - It holds the fretboard and theory question generators, and the derived stats (heatmap, weakest facts).
- **Round:** `useQuizRound` runs a 20-question round and scores only the first try. It holds answers in memory and appends them to `theory.json`'s `quiz.history` in one `PUT` when the round ends, or when the player leaves mid-round, using `useTheoryDoc().update(…, { now: true })` from the foundation phase.
- **Backend:** no change. The foundation phase's `theory.json` model already has `quiz.settings` and `quiz.history` (capped at 2,000).

**Tech Stack:** React 19, React Router 7, TanStack Query 5, tonal 6.4.3, Vitest + RTL (`npm --prefix frontend test`), CSS modules over `tokens.css`.

**Spec:** [docs/superpowers/specs/2026-09-29-music-theory-design.md](../specs/2026-09-29-music-theory-design.md), section "Quizzes". D-19; keys in `design/ui-spec.md` §7; heatmap and markers in U-13; mockup `design/ui/src/pages/screens/theory-fretboard-quiz.html`. **Depends on** [2026-09-29-theory-foundation.md](2026-09-29-theory-foundation.md), which provides `TheoryDoc`, `TheoryNeck` with its `heat` prop, `positions`, `spell`, `tuning`, `controls`, `tools.ts` and `renderTool`. It is independent of the shapes-and-harmony phase except for where the entries go in `tools.ts`.

## Global Constraints

- **Nothing derived is stored.** Weakness, the heatmap, weakest facts, score, streak and averages are computed from `quiz.history` on every render. Only first-try answers are stored: `{ quiz, mode, item, correct, ms, at }`.
- **One PUT per round.** Answers are sent together when a round ends, or when the player leaves mid-round. A failed save is the screen's "Couldn't save" banner with Retry, and nothing is dropped (N-08).
- **Item keys** (stable, and the history is keyed on them):
  - fretboard cells are `s{row}f{fret}`, with row 0 the highest string;
  - find-note is `n{pc}`;
  - spell-chord is the chord symbol (`Dm`);
  - theory facts are `v:Eb`, `rel:F`, `sig:D`, `notes:Bm7`, `name:Bm7` and `ivl:C:6M`.
- **Theory answer `mode`** is its topic (`keys`, `chords` or `intervals`), so weighting and "weakest facts" group by topic.
- **Weighting:**
  - `weakness = 0.6 · wrong_rate + 0.4 · min(avg_ms / 6000, 1)` over the item's last 5 answers in the same quiz and mode.
  - An item never asked scores 1.
  - The pick probability is proportional to `0.15 + weakness`.
  - The same item never comes twice in a row.
  - Every random choice goes through an injected `Rng` (`mulberry32(seed)`). The app seeds it with `Date.now()`.
- **Colours (U-13):** a question is the `question` marker (accent ring, "?"), a found note is `ok`, a wrong tap is `wrong` (✕), the origin note of an interval question is `accent`, and heat cells are `heatWeak` / `heatStrong`. The red feedback chip is `Chip tone="error"`.
- **Keys (ui-spec §7):** Name the note uses `1`–`9`, `0`, `-`, `=` for C … B; the Theory quiz uses `1`–`4`; `Enter` starts the next round from the summary.
- **Commits:**
  - Commit after every task, ending the message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
  - Work on `main`, and push once, at the end of Task 4.
  - Stage **only the files the task lists**.


> **As shipped (read this before the task text):** this plan was executed with a review after every task and a whole-branch review at the end. The code blocks below are the *starting prototypes*; review-driven changes made the shipped code differ. The ledger of rulings and per-task reports lived in the git-ignored `.superpowers/sdd/` workspaces; the differences that matter are:
- T1 (`quiz.ts`): `restrict` throws `NothingToPractise` when a practise list matches nothing (no silent fallback); `QuizFocusError` carries a `problem` and a per-cause message; `focusCells`/`focusFrets`/`focusRows` clamp to real strings and frets; find-interval offers only origins that have another cell with the answer in the focus and exposes `interval` and `targets`; spell-chord targets stay on the focus rows and never ask a chord with no target; the heatmap counts only name-note and find-interval answers.
- Item keys (final review): name-note and find-interval items carry the tuning, e.g. `E1-A1-D2-G2/s2f7` (`cellItem`; `cellKey` stays the bare cell id), so history and weak spots are per instrument/tuning; older bare `s{row}f{fret}` answers no longer count. Practise-strings/frets settings are remapped when the instrument changes.
- T2: the persistence design is the TheoryDoc keep-store (see the foundation note); `useQuizRound.flush` passes `keep: true` and clears its unsaved answers only when the document took them; answers are trimmed to the server's 2,000 cap oldest-first; `beforeunload` guards while answers are unsaved; the quiz tools do nothing (and ask nothing) while no document can be read; wrong-tap reasons include 'outside the outlined frets'; `quizKey` has a `{ shift }` option (AZERTY/QWERTZ) used by both quizzes.
- T3: `quizExplain.ts` explains each wrong option without revealing the right one; RoundSummary's Enter yields only to buttons inside the summary; a wrong-then-right answer is stored once as wrong.

---

## File map

| File | Responsibility |
|---|---|
| `frontend/src/music/quiz.ts` | Rng, weakness, picking, `restrict`, fretboard and theory questions, heatmap, weakest facts |
| `frontend/src/theory/useQuizRound.ts` | 20-question round, first-try scoring, batched save; `roundStats`, `weakestOfRound` |
| `frontend/src/theory/RoundSummary.tsx` | End-of-round score, weakest three, "Practise these" |
| `frontend/src/theory/QuizStats.tsx` | Heatmap panel, weakest facts, confirmed "Reset history…"; `cellText` |
| `frontend/src/theory/Theory.module.css` | + quiz styles |
| `frontend/src/theory/tools/FretboardQuiz.tsx`, `TheoryQuiz.tsx` | The two quizzes |
| `frontend/src/theory/tools.ts` | Practice group entries |
| `README.md`, `docs/screenshots/theory-quiz.png` | README upkeep |

---

### Task 1: Quiz logic

**Files:**
- Create: `frontend/src/music/quiz.ts`
- Test: `frontend/src/music/quiz.test.ts`

**Interfaces:**
- Consumes: `positionAt`, `rowMidi`, `Cell` (positions.ts); `chordInfo`, `keyChords`, `keySignature`, `pretty`, `relativeKey`, `rootName` (spell.ts); `mod12` (chordTones.ts); `Interval`, `Note` (tonal).
- Produces:
  - Types: `Rng`, `QuizKind`, `FretboardMode`, `TheoryTopic`, `Answer` (the same shape as `QuizAnswer` in `api/client.ts`).
  - Randomness and weighting: `mulberry32(seed)`, `weakness(history, quiz, mode, item)`, `pickItem(items, weight, rng, previous?)`, `restrict(items, only?)` and `shuffle`.
  - Fretboard: `FretboardFocus { strings; frets; accidentals }`, `cellKey`, `parseCellKey`, `focusCells`, `plainName(pc)`, `pcAt(inst, cell)`.
  - `FretboardQuestion`, a union by `mode`:
    - `name-note { cell; answerPc }`
    - `find-note { pc; targets }`
    - `find-interval { cell; answerPc }`
    - `spell-chord { symbol; window; targets }`

    Every variant also has `item` and `prompt`.
  - `fretboardQuestion(mode, inst, focus, history, rng, previous?, only?)`.
  - Theory: `TheoryQuestion { topic; item; prompt; options[4]; answer }`, `theoryItems(topics)`, `theoryQuestion(item, rng)` and `nextTheoryQuestion(topics, history, rng, previous?, only?)`.
  - Stats: `CellStat`, `heatmap(history)` and `weakestFacts(history, n)`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, test } from 'vitest';

import {
  cellKey,
  focusCells,
  fretboardQuestion,
  heatmap,
  mulberry32,
  nextTheoryQuestion,
  parseCellKey,
  pickItem,
  restrict,
  theoryItems,
  theoryQuestion,
  weakestFacts,
  weakness,
  type Answer,
} from './quiz';
import { DEFAULT_INSTRUMENT } from './tuning';

const bass4 = DEFAULT_INSTRUMENT;
const at = '2026-09-29T00:00:00Z';
const ans = (item: string, correct: boolean, ms: number, mode = 'name-note'): Answer => ({ quiz: 'fretboard', mode, item, correct, ms, at });

describe('weighting', () => {
  test('never asked is weakest; weakness uses only the last five answers', () => {
    expect(weakness([], 'fretboard', 'name-note', 's0f1')).toBe(1);
    const history = [ans('s0f1', false, 9000), ...Array.from({ length: 5 }, () => ans('s0f1', true, 1500))];
    expect(weakness(history, 'fretboard', 'name-note', 's0f1')).toBeCloseTo(0.1);
    expect(weakness([ans('s0f1', false, 6000)], 'fretboard', 'name-note', 's0f1')).toBeCloseTo(1);
  });

  test('answers of another mode do not count', () => {
    expect(weakness([ans('s0f1', true, 0, 'find-interval')], 'fretboard', 'name-note', 's0f1')).toBe(1);
  });

  test('seeded picks are repeatable, weak items come up more, never twice in a row', () => {
    const items = ['a', 'b'];
    const weight = (i: string) => (i === 'a' ? 1 : 0);
    const rngA = mulberry32(42);
    const rngB = mulberry32(42);
    const seqA = Array.from({ length: 20 }, () => pickItem(['a', 'b', 'c'], weight, rngA));
    const seqB = Array.from({ length: 20 }, () => pickItem(['a', 'b', 'c'], weight, rngB));
    expect(seqA).toEqual(seqB);
    const rng = mulberry32(7);
    const counts = { a: 0, b: 0 };
    for (let i = 0; i < 2000; i++) counts[pickItem(items, weight, rng) as 'a' | 'b']++;
    expect(counts.a / 2000).toBeGreaterThan(0.8);
    let prev: string | undefined;
    for (let i = 0; i < 50; i++) {
      const next = pickItem(items, weight, rng, prev);
      expect(next).not.toBe(prev);
      prev = next;
    }
  });
});

test('restrict keeps the listed items unless none match', () => {
  expect(restrict(['a', 'b', 'c'], ['b'])).toEqual(['b']);
  expect(restrict(['a', 'b'], ['z'])).toEqual(['a', 'b']);
  expect(restrict(['a', 'b'])).toEqual(['a', 'b']);
});

describe('fretboard questions', () => {
  const focus = { strings: [], frets: [0, 12] as [number, number], accidentals: false };

  test('cell keys round-trip', () => {
    expect(cellKey({ string: 2, fret: 7 })).toBe('s2f7');
    expect(parseCellKey('s2f7')).toEqual({ string: 2, fret: 7 });
    expect(parseCellKey('n9')).toBeNull();
  });

  test('focus: naturals only on the E and A strings', () => {
    const cells = focusCells(bass4, { strings: [3, 2], frets: [0, 5], accidentals: false });
    expect(cells.map(cellKey)).toEqual(['s3f0', 's3f1', 's3f3', 's3f5', 's2f0', 's2f2', 's2f3', 's2f5']);
  });

  test('find the note lists every target in range', () => {
    const rng = mulberry32(1);
    for (let i = 0; i < 20; i++) {
      const q = fretboardQuestion('find-note', bass4, focus, [], rng);
      if (q.mode !== 'find-note') throw new Error('mode');
      if (q.pc === 7) {
        expect(q.targets.map(cellKey).sort()).toEqual(['s0f0', 's0f12', 's1f5', 's2f10', 's3f3']);
        return;
      }
    }
    throw new Error('never asked for G in 20 tries');
  });

  test('name the note and find the interval ask about a cell in focus', () => {
    const rng = mulberry32(3);
    const allowed = new Set(focusCells(bass4, focus).map(cellKey));
    for (const mode of ['name-note', 'find-interval'] as const) {
      const q = fretboardQuestion(mode, bass4, focus, [], rng);
      expect(allowed.has(q.item)).toBe(true);
    }
  });

  test('only asks about the listed items', () => {
    const rng = mulberry32(4);
    for (let i = 0; i < 10; i++) expect(fretboardQuestion('name-note', bass4, focus, [], rng, undefined, ['s2f7']).item).toBe('s2f7');
    expect(nextTheoryQuestion(['keys'], [], rng, undefined, ['v:D']).item).toBe('v:D');
  });

  test('spell the chord targets only chord tones inside its 4-fret window', () => {
    const q = fretboardQuestion('spell-chord', bass4, focus, [], mulberry32(5));
    if (q.mode !== 'spell-chord') throw new Error('mode');
    expect(q.window[1] - q.window[0]).toBe(3);
    for (const c of q.targets) expect(c.fret >= q.window[0] && c.fret <= q.window[1]).toBe(true);
    expect(q.targets.length).toBeGreaterThan(0);
  });
});

describe('theory questions', () => {
  test('items by topic', () => {
    expect(theoryItems(['keys'])).toHaveLength(36);
    expect(theoryItems(['chords'])).toHaveLength(120);
    expect(theoryItems(['intervals'])).toHaveLength(77);
  });

  test.each([
    ['v:Eb', "What's the V chord in E♭ major?", 'B♭'],
    ['rel:F', 'Relative minor of F major?', 'D minor'],
    ['sig:D', 'Key signature of D major?', '2 sharps'],
    ['notes:Bm7', 'Notes of Bm7?', 'B D F♯ A'],
    ['name:Bm7', 'Which chord is B D F♯ A?', 'Bm7'],
    ['ivl:C:6M', 'C up to A is a…', 'major 6th'],
  ])('%s', (item, prompt, right) => {
    const q = theoryQuestion(item, mulberry32(9));
    expect(q.prompt).toBe(prompt);
    expect(q.options[q.answer]).toBe(right);
    expect(q.options).toHaveLength(4);
    expect(new Set(q.options).size).toBe(4);
  });

  test('every item makes a four-option question', () => {
    const rng = mulberry32(11);
    for (const item of theoryItems(['keys', 'chords', 'intervals'])) {
      const q = theoryQuestion(item, rng);
      expect(new Set(q.options).size, item).toBe(4);
    }
  });

  test('next question respects topics', () => {
    const q = nextTheoryQuestion(['intervals'], [], mulberry32(2));
    expect(q.topic).toBe('intervals');
  });
});

describe('stats', () => {
  test('heatmap per cell from the last five answers', () => {
    const h = heatmap([ans('s2f7', false, 6000), ans('s2f7', false, 6000), ans('n7', true, 100, 'find-note')]);
    expect(h).toEqual([{ string: 2, fret: 7, weakness: 1 }]);
  });

  test('weakest facts', () => {
    const t = (item: string, correct: boolean): Answer => ({ quiz: 'theory', mode: 'keys', item, correct, ms: 1000, at });
    const w = weakestFacts([t('v:C', true), t('v:G', false), t('sig:D', true)], 2);
    expect(w.map((x) => x.item)).toEqual(['v:G', 'v:C']);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npm --prefix frontend test -- src/music/quiz.test.ts`
Expected: FAIL, `Failed to resolve import "./quiz"`.

- [ ] **Step 3: Implement**

```ts
// Quiz questions and the weak-spot weighting (D-19). Pure: every random choice
// goes through an injected Rng, so a seeded test sees the same round every
// time. Stats are derived from the answer history on every call and never
// stored, the same rule as song state.
import { Interval, Note } from 'tonal';

import { mod12 } from './chordTones';
import { positionAt, rowMidi, type Cell } from './positions';
import { chordInfo, keyChords, keySignature, pretty, relativeKey, rootName } from './spell';
import type { Instrument } from './tuning';

export type Rng = () => number;

/** Small, fast, seedable. Tests pass a seed; the app seeds from Date.now(). */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type QuizKind = 'fretboard' | 'theory';
export type FretboardMode = 'name-note' | 'find-note' | 'find-interval' | 'spell-chord';
export type TheoryTopic = 'keys' | 'chords' | 'intervals';

/** One first-try answer, as theory.json stores it. */
export interface Answer {
  quiz: QuizKind;
  mode: string;
  item: string;
  correct: boolean;
  ms: number;
  at: string;
}

export const WINDOW = 5;
const SLOW_MS = 6000;

/** 0 (strong) … 1 (weak) from the last 5 answers; never asked = 1. */
export function weakness(history: readonly Answer[], quiz: QuizKind, mode: string, item: string): number {
  const last = history.filter((a) => a.quiz === quiz && a.mode === mode && a.item === item).slice(-WINDOW);
  if (last.length === 0) return 1;
  const wrong = last.filter((a) => !a.correct).length / last.length;
  const avgMs = last.reduce((s, a) => s + a.ms, 0) / last.length;
  return 0.6 * wrong + 0.4 * Math.min(avgMs / SLOW_MS, 1);
}

/** Picks an item, weak ones more often, never `previous` twice in a row. */
export function pickItem(items: readonly string[], weight: (item: string) => number, rng: Rng, previous?: string): string {
  const pool = items.length > 1 ? items.filter((i) => i !== previous) : [...items];
  const weights = pool.map((i) => 0.15 + weight(i));
  let r = rng() * weights.reduce((s, w) => s + w, 0);
  for (let i = 0; i < pool.length; i++) {
    r -= weights[i]!;
    if (r < 0) return pool[i]!;
  }
  return pool[pool.length - 1]!;
}

/** "Practise these": keep only the listed items, unless that would leave none. */
export function restrict(items: readonly string[], only?: readonly string[]): string[] {
  if (!only?.length) return [...items];
  const kept = items.filter((i) => only.includes(i));
  return kept.length ? kept : [...items];
}

export function shuffle<T>(xs: readonly T[], rng: Rng): T[] {
  const out = [...xs];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

// ---------------------------------------------------------------- fretboard

export interface FretboardFocus {
  /** Rows to ask about; empty = every string. */
  strings: number[];
  frets: [number, number];
  accidentals: boolean;
}

export const cellKey = (c: Cell) => `s${c.string}f${c.fret}`;

export function parseCellKey(key: string): Cell | null {
  const m = /^s(\d+)f(\d+)$/.exec(key);
  return m ? { string: Number(m[1]), fret: Number(m[2]) } : null;
}

const NATURAL = new Set([0, 2, 4, 5, 7, 9, 11]);

/** The cells the focus allows: chosen strings × fret range, naturals only unless accidentals. */
export function focusCells(inst: Instrument, focus: FretboardFocus): Cell[] {
  const rows = focus.strings.length ? focus.strings : rowMidi(inst).map((_, i) => i);
  const out: Cell[] = [];
  for (const string of rows) {
    for (let fret = focus.frets[0]; fret <= focus.frets[1]; fret++) {
      const p = positionAt(inst, { string, fret });
      if (focus.accidentals || NATURAL.has(p.pc)) out.push({ string, fret });
    }
  }
  return out;
}

export const INTERVALS = [
  { name: '3m', label: 'minor 3rd' },
  { name: '3M', label: 'major 3rd' },
  { name: '4P', label: '4th' },
  { name: '5P', label: '5th' },
  { name: '7m', label: '♭7' },
  { name: '8P', label: 'octave' },
] as const;

export type FretboardQuestion =
  | { mode: 'name-note'; item: string; cell: Cell; answerPc: number; prompt: string }
  | { mode: 'find-note'; item: string; pc: number; targets: Cell[]; prompt: string }
  | { mode: 'find-interval'; item: string; cell: Cell; answerPc: number; prompt: string }
  | { mode: 'spell-chord'; item: string; symbol: string; window: [number, number]; targets: Cell[]; prompt: string };

const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];

/** A name for a pitch class a player would use without a key: naturals, then sharps (F♯, C♯, G♯) or flats (B♭, E♭). */
export function plainName(pc: number): string {
  return ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'G#', 'A', 'Bb', 'B'][mod12(pc)]!;
}

export function fretboardQuestion(
  mode: FretboardMode,
  inst: Instrument,
  focus: FretboardFocus,
  history: readonly Answer[],
  rng: Rng,
  previous?: string,
  only?: readonly string[],
): FretboardQuestion {
  const cells = focusCells(inst, focus);
  const weight = (item: string) => weakness(history, 'fretboard', mode, item);
  if (mode === 'find-note') {
    const pcs = [...new Set(cells.map((c) => positionAt(inst, c).pc))].map((pc) => `n${pc}`);
    const item = pickItem(restrict(pcs, only), weight, rng, previous);
    const pc = Number(item.slice(1));
    const targets = cells.filter((c) => positionAt(inst, c).pc === pc);
    return { mode, item, pc, targets, prompt: `Find every ${pretty(plainName(pc))}` };
  }
  if (mode === 'spell-chord') {
    const symbols = LETTERS.flatMap((l) => [l, `${l}m`]);
    const item = pickItem(restrict(symbols, only), weight, rng, previous);
    const info = chordInfo(item);
    const tones = new Set(info.ok ? info.chord.notes.map((n) => n.pc) : []);
    const lo = focus.frets[0] + Math.floor(rng() * Math.max(1, focus.frets[1] - focus.frets[0] - 2));
    const window: [number, number] = [lo, Math.min(lo + 3, focus.frets[1])];
    const rows = rowMidi(inst).map((_, i) => i);
    const targets = rows.flatMap((string) =>
      Array.from({ length: window[1] - window[0] + 1 }, (_, i) => ({ string, fret: window[0] + i })),
    ).filter((c) => tones.has(positionAt(inst, c).pc));
    return { mode, item, symbol: item, window, targets, prompt: `Tap the notes of ${pretty(item)} in frets ${window[0]}–${window[1]}` };
  }
  const item = pickItem(restrict(cells.map(cellKey), only), weight, rng, previous);
  const cell = parseCellKey(item)!;
  const pc = positionAt(inst, cell).pc;
  if (mode === 'name-note') return { mode, item, cell, answerPc: pc, prompt: 'Name this note' };
  const interval = INTERVALS[Math.floor(rng() * INTERVALS.length)]!;
  const answerPc = mod12(pc + Interval.get(interval.name).semitones!);
  return { mode, item, cell, answerPc, prompt: `Tap the ${interval.label} above this note` };
}

// ---------------------------------------------------------------- theory

export interface TheoryQuestion {
  topic: TheoryTopic;
  item: string;
  prompt: string;
  options: string[];
  answer: number;
}

const MAJOR_KEYS = Array.from({ length: 12 }, (_, pc) => rootName(pc, 'major'));
const QUALITY = ['', 'm', '7', 'maj7', 'm7'];
const TOPIC_OF: Record<string, TheoryTopic> = { v: 'keys', rel: 'keys', sig: 'keys', notes: 'chords', name: 'chords', ivl: 'intervals' };

/** Every fact the theory quiz can ask about, as stable item keys. */
export function theoryItems(topics: readonly TheoryTopic[]): string[] {
  const items: string[] = [];
  for (const key of MAJOR_KEYS) items.push(`v:${key}`, `rel:${key}`, `sig:${key}`);
  for (const key of MAJOR_KEYS) for (const q of QUALITY) items.push(`notes:${key}${q}`, `name:${key}${q}`);
  for (const from of LETTERS) for (const iv of ['2m', '2M', '3m', '3M', '4P', '5d', '5P', '6m', '6M', '7m', '7M']) items.push(`ivl:${from}:${iv}`);
  return items.filter((i) => topics.includes(TOPIC_OF[i.split(':')[0]!]!));
}

const IVL_LABEL: Record<string, string> = {
  '2m': 'minor 2nd', '2M': 'major 2nd', '3m': 'minor 3rd', '3M': 'major 3rd', '4P': 'perfect 4th', '5d': 'tritone',
  '5P': 'perfect 5th', '6m': 'minor 6th', '6M': 'major 6th', '7m': 'minor 7th', '7M': 'major 7th',
};

function sigText(key: string): string {
  const { accidentals, sharps } = keySignature(key, 'major');
  if (accidentals.length === 0) return 'no sharps or flats';
  const n = accidentals.length;
  return `${n} ${sharps ? (n === 1 ? 'sharp' : 'sharps') : n === 1 ? 'flat' : 'flats'}`;
}

function notesText(symbol: string): string {
  const info = chordInfo(symbol);
  return info.ok ? info.chord.notes.map((n) => pretty(n.name)).join(' ') : symbol;
}

function ask(topic: TheoryTopic, item: string, prompt: string, right: string, wrong: string[], rng: Rng): TheoryQuestion {
  const distinct = [...new Set(wrong.filter((w) => w !== right))].slice(0, 3);
  const options = shuffle([right, ...distinct], rng);
  return { topic, item, prompt, options, answer: options.indexOf(right) };
}

export function theoryQuestion(item: string, rng: Rng): TheoryQuestion {
  const [kind, a = '', b = ''] = item.split(':');
  if (kind === 'v' || kind === 'rel' || kind === 'sig') {
    const idx = MAJOR_KEYS.indexOf(a);
    const near = [1, 11, 2, 10, 5].map((d) => MAJOR_KEYS[(idx + d) % 12]!);
    if (kind === 'v') {
      const fifth = (k: string) => pretty(keyChords(k, 'major', 'triads')[4]!.symbol);
      const own = keyChords(a, 'major', 'triads').map((c) => pretty(c.symbol));
      return ask('keys', item, `What's the V chord in ${pretty(a)} major?`, fifth(a), [own[3]!, own[1]!, own[5]!, ...near.map(fifth)], rng);
    }
    if (kind === 'rel') {
      const rel = (k: string) => `${pretty(relativeKey(k, 'major').root)} minor`;
      return ask('keys', item, `Relative minor of ${pretty(a)} major?`, rel(a), near.map(rel), rng);
    }
    return ask('keys', item, `Key signature of ${pretty(a)} major?`, sigText(a), near.map(sigText), rng);
  }
  if (kind === 'notes' || kind === 'name') {
    const info = chordInfo(a);
    const root = info.ok ? info.chord.root : a;
    const others = QUALITY.map((q) => `${root}${q}`).filter((s) => s !== a);
    if (kind === 'notes') {
      return ask('chords', item, `Notes of ${pretty(a)}?`, notesText(a), others.map(notesText), rng);
    }
    return ask('chords', item, `Which chord is ${notesText(a)}?`, pretty(a), others.map(pretty), rng);
  }
  const to = Note.transpose(a, b);
  const keys = Object.keys(IVL_LABEL);
  const idx = keys.indexOf(b);
  const dist = (k: string) => Math.abs(keys.indexOf(k) - idx);
  const near = keys.filter((k) => k !== b).sort((x, y) => dist(x) - dist(y) || keys.indexOf(x) - keys.indexOf(y));
  return ask('intervals', item, `${pretty(a)} up to ${pretty(to)} is a…`, IVL_LABEL[b]!, near.map((k) => IVL_LABEL[k]!), rng);
}

export function nextTheoryQuestion(
  topics: readonly TheoryTopic[],
  history: readonly Answer[],
  rng: Rng,
  previous?: string,
  only?: readonly string[],
): TheoryQuestion {
  const items = restrict(theoryItems(topics), only);
  const item = pickItem(items, (i) => weakness(history, 'theory', TOPIC_OF[i.split(':')[0]!]!, i), rng, previous);
  return theoryQuestion(item, rng);
}

// ---------------------------------------------------------------- stats

export interface CellStat extends Cell {
  weakness: number;
}

/** Per-cell weakness from name-note, find-note and find-interval answers. Cells never asked are absent. */
export function heatmap(history: readonly Answer[]): CellStat[] {
  const byCell = new Map<string, Answer[]>();
  for (const a of history) {
    if (a.quiz !== 'fretboard' || !parseCellKey(a.item)) continue;
    byCell.set(a.item, [...(byCell.get(a.item) ?? []), a]);
  }
  return [...byCell.entries()].map(([key, answers]) => {
    const last = answers.slice(-WINDOW);
    const wrong = last.filter((a) => !a.correct).length / last.length;
    const avgMs = last.reduce((s, a) => s + a.ms, 0) / last.length;
    return { ...parseCellKey(key)!, weakness: 0.6 * wrong + 0.4 * Math.min(avgMs / SLOW_MS, 1) };
  });
}

/** The `n` weakest theory facts that have been asked at least once. */
export function weakestFacts(history: readonly Answer[], n: number): { item: string; weakness: number }[] {
  const items = [...new Set(history.filter((a) => a.quiz === 'theory').map((a) => `${a.mode}|${a.item}`))];
  return items
    .map((k) => {
      const [mode = '', item = ''] = k.split('|');
      return { item, weakness: weakness(history, 'theory', mode, item) };
    })
    .sort((a, b) => b.weakness - a.weakness)
    .slice(0, n);
}

/** Pitch-class of a tapped cell, for checking answers. */
export function pcAt(inst: Instrument, cell: Cell): number {
  return positionAt(inst, cell).pc;
}
```

- [ ] **Step 4: Run the tests**

Run: `npm --prefix frontend test -- src/music/quiz.test.ts`
Expected: 21 passed.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/music/quiz.ts frontend/src/music/quiz.test.ts
git commit -m "feat(theory): quiz questions and weak-spot weighting, seeded and derived from history (D-19)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Rounds, stats and the Fretboard quiz

**Files:**
- Create: `frontend/src/theory/useQuizRound.ts`, `frontend/src/theory/RoundSummary.tsx`, `frontend/src/theory/QuizStats.tsx`, `frontend/src/theory/tools/FretboardQuiz.tsx`
- Modify: `frontend/src/theory/Theory.module.css` (append), `frontend/src/theory/tools.ts`
- Test: `frontend/src/theory/tools/fretboardQuiz.test.tsx`

**Interfaces:**
- Consumes: Task 1; `useTheoryDoc().update(change, { now: true })`; `TheoryNeck` `heat`, `onPick` and markers; `NotePicker`; `Chip`, `Segmented`, `Button` and `Panel` from `../ui`.
- Produces:
  - `ROUND = 20`, `Result extends QuizAnswer { text }`.
  - `useQuizRound(): { number, results, done, history, record(result), restart(only?), only }`. `history` is the stored history plus this round's unsaved answers, which is what weighting reads.
  - `roundStats(results): { correct, answered, streak, avgSeconds }` and `weakestOfRound(results)`.
  - `RoundSummary({ results, onRestart(only?) })`, `FretboardStats({ instrument, history, frets })`, `TheoryStats({ history })` and `cellText(inst, key)`, e.g. "A string, fret 7".
  - `NOTE_KEYS`.

- [ ] **Step 1: Write the failing test**

The tests read each question off the page (the `question` cell or the "Find every G" prompt) and work out the answer with `positionAt`, so they do not depend on the seed.

```tsx
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';

import { DEFAULT_THEORY, type QuizAnswer } from '../../api/client';
import { positionAt, positionsOf } from '../../music/positions';
import { DEFAULT_INSTRUMENT } from '../../music/tuning';
import { renderTool } from './testing';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const KEYS = ['C', 'C♯/D♭', 'D', 'E♭', 'E', 'F', 'F♯/G♭', 'G', 'A♭', 'A', 'B♭', 'B'];
const nameNote = { quiz: { ...DEFAULT_THEORY.quiz, settings: { ...DEFAULT_THEORY.quiz.settings, fretboard: { ...DEFAULT_THEORY.quiz.settings.fretboard, mode: 'name-note' as const } } } };

function questionPc(container: HTMLElement): number {
  const cell = container.querySelector('[data-marker="question"]')!.getAttribute('data-cell')!;
  const [, s, f] = /^s(\d+)f(\d+)$/.exec(cell)!;
  return positionAt(DEFAULT_INSTRUMENT, { string: Number(s), fret: Number(f) }).pc;
}

const answers = () => within(screen.getByRole('group', { name: 'Answer' }));

test('name the note: a wrong answer is explained and the question stays; only the first try counts', async () => {
  const { container } = renderTool('/theory/fretboard-quiz', { theory: nameNote });
  await screen.findByText('Name this note');
  const pc = questionPc(container);
  fireEvent.click(answers().getByRole('button', { name: KEYS[(pc + 1) % 12] }));
  expect(screen.getByText(/✕ not/)).toBeInTheDocument();
  expect(screen.getByText(/^round \d+ of 20$/)).toHaveTextContent('round 1 of 20');
  fireEvent.click(answers().getByRole('button', { name: KEYS[pc] }));
  expect(screen.getByText(/^round \d+ of 20$/)).toHaveTextContent('round 2 of 20');
  expect(screen.getByText(/first try/)).toHaveTextContent('0/1 first try');
});

test('name the note answers from the keyboard, 1–9 0 - = for C … B', async () => {
  const { container } = renderTool('/theory/fretboard-quiz', { theory: nameNote });
  await screen.findByText('Name this note');
  const pc = questionPc(container);
  fireEvent.keyDown(window, { key: ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '-', '='][pc] });
  expect(screen.getByText(/first try/)).toHaveTextContent('1/1 first try');
});

test('find the note: wrong taps are marked, every target must be found', async () => {
  const { container } = renderTool('/theory/fretboard-quiz');
  const prompt = await screen.findByText(/^Find every /);
  const pc = KEYS.findIndex((k) => k.split('/').some((n) => prompt.textContent === `Find every ${n}`));
  const targets = positionsOf(DEFAULT_INSTRUMENT, new Set([pc]), 0, 12);
  const wrongCell = positionsOf(DEFAULT_INSTRUMENT, new Set([(pc + 2) % 12]), 0, 12)[0]!;
  fireEvent.click(container.querySelector(`[aria-label$="${wrongCell.fret === 0 ? 'open' : `fret ${wrongCell.fret}`}"][aria-label^="${['G', 'D', 'A', 'E'][wrongCell.string]} string"]`)!);
  expect(container.querySelector('[data-marker="wrong"]')).not.toBeNull();
  expect(screen.getByText(/✕ that's/)).toBeInTheDocument();
  for (const t of targets) {
    fireEvent.click(screen.getByRole('button', { name: `${['G', 'D', 'A', 'E'][t.string]} string, ${t.fret === 0 ? 'open' : `fret ${t.fret}`}` }));
  }
  expect(screen.getByText(/^round \d+ of 20$/)).toHaveTextContent('round 2 of 20');
  expect(screen.getByText(/first try/)).toHaveTextContent('0/1 first try');
});

test('a round of 20 ends in a summary and one PUT with all 20 answers', async () => {
  const { container, puts } = renderTool('/theory/fretboard-quiz', { theory: nameNote });
  await screen.findByText('Name this note');
  for (let i = 0; i < 20; i++) fireEvent.click(answers().getByRole('button', { name: KEYS[questionPc(container)] }));
  expect(await screen.findByText('20 / 20 first try')).toBeInTheDocument();
  await waitFor(() => expect(puts.at(-1)?.quiz.history).toHaveLength(20));
  expect(puts.at(-1)!.quiz.history.every((a: QuizAnswer) => a.quiz === 'fretboard' && a.mode === 'name-note' && a.correct)).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Practise these' }));
  expect(screen.getByText(/^round \d+ of 20$/)).toHaveTextContent('round 1 of 20');
});

test('focus settings are saved and restart the round', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  const { puts } = renderTool('/theory/fretboard-quiz');
  await screen.findByText(/^Find every /);
  fireEvent.click(screen.getByRole('button', { name: 'Frets 0–5' }));
  fireEvent.click(screen.getByRole('button', { name: 'E + A only' }));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(600);
  });
  expect(puts.at(-1)?.quiz.settings.fretboard).toEqual({ mode: 'find-note', strings: [3, 2], frets: [0, 5], accidentals: false });
});

test('weak spots come from the history; reset asks first', async () => {
  const at = '2026-09-29T00:00:00Z';
  const history = [
    { quiz: 'fretboard' as const, mode: 'name-note', item: 's2f7', correct: false, ms: 6000, at },
    { quiz: 'fretboard' as const, mode: 'name-note', item: 's3f3', correct: true, ms: 500, at },
  ];
  const { container, puts } = renderTool('/theory/fretboard-quiz', { theory: { quiz: { ...DEFAULT_THEORY.quiz, history } } });
  await screen.findByText(/^Find every /);
  expect(container.querySelector('[data-heat="s2f7"]')).toHaveClass('heatWeak');
  expect(container.querySelector('[data-heat="s3f3"]')).toHaveClass('heatStrong');
  expect(screen.getByText(/Weakest:/)).toHaveTextContent('Weakest: A string, fret 7.');
  vi.spyOn(window, 'confirm').mockReturnValueOnce(true);
  fireEvent.click(screen.getByRole('button', { name: 'Reset history…' }));
  await waitFor(() => expect(puts.at(-1)?.quiz.history).toEqual([]));
});

// ---------------------------------------------------------------- Theory quiz

const progress = () => screen.queryByText(/^round \d+ of 20$/)?.textContent ?? 'done';

/** Clicks options in order until the question changes; returns how many were wrong. */
function answerTheory(): number {
  const before = progress();
  const buttons = within(screen.getByRole('group', { name: 'Answers' })).getAllByRole('button');
  for (let i = 0; i < buttons.length; i++) {
    fireEvent.click(buttons[i]!);
    if (progress() !== before) return i;
  }
  throw new Error('no option advanced the question');
}
```

- [ ] **Step 2: Run it to see it fail**

Run: `npm --prefix frontend test -- src/theory/tools/fretboardQuiz.test.tsx`
Expected: FAIL (the page says there is no tool called “fretboard-quiz”).

- [ ] **Step 3: The round**

`frontend/src/theory/useQuizRound.ts`:

```ts
// One quiz round (D-19): 20 questions, only the first try at each one scored.
// Answers are held here and appended to theory.json's history in one PUT when
// the round ends, or when the player leaves mid-round. A failed save is the
// screen's "Couldn't save" banner with Retry, and the answers stay in memory.
import { useCallback, useEffect, useRef, useState } from 'react';

import type { QuizAnswer } from '../api/client';
import { useTheoryDoc } from './TheoryDoc';

export const ROUND = 20;

export interface Result extends QuizAnswer {
  /** How the item reads in the summary: "A string, fret 7", "V of E♭". */
  text: string;
}

export interface Round {
  /** 1-based number of the current question. */
  number: number;
  results: Result[];
  done: boolean;
  /** History plus this round's unsaved answers: what weighting reads. */
  history: QuizAnswer[];
  record: (result: Omit<Result, 'at'>) => void;
  /** Starts a new round, optionally limited to some items ("Practise these"). */
  restart: (only?: string[]) => void;
  only: string[] | undefined;
}

export function useQuizRound(): Round {
  const { doc, update } = useTheoryDoc();
  const [results, setResults] = useState<Result[]>([]);
  const [only, setOnly] = useState<string[] | undefined>(undefined);
  const pending = useRef<QuizAnswer[]>([]);

  const flush = useCallback(() => {
    const answers = pending.current;
    if (answers.length === 0) return;
    pending.current = [];
    update((d) => ({ ...d, quiz: { ...d.quiz, history: [...d.quiz.history, ...answers] } }), { now: true });
  }, [update]);

  const record = useCallback(
    (r: Omit<Result, 'at'>) => {
      const answer = { ...r, at: new Date().toISOString() };
      const { text: _text, ...stored } = answer;
      pending.current = [...pending.current, stored];
      setResults((cur) => [...cur, answer]);
    },
    [],
  );

  // The round's last answer sends the whole round in one PUT.
  useEffect(() => {
    if (results.length === ROUND) flush();
  }, [results.length, flush]);

  // Leaving the quiz mid-round still saves what was answered.
  useEffect(() => () => flush(), [flush]);

  const restart = useCallback(
    (items?: string[]) => {
      flush();
      setResults([]);
      setOnly(items?.length ? items : undefined);
    },
    [flush],
  );

  return {
    number: Math.min(results.length + 1, ROUND),
    results,
    done: results.length >= ROUND,
    history: [...(doc?.quiz.history ?? []), ...pending.current],
    record,
    restart,
    only,
  };
}

/** Score, streak and average time of a round so far. */
export function roundStats(results: readonly Result[]) {
  const correct = results.filter((r) => r.correct).length;
  let streak = 0;
  for (let i = results.length - 1; i >= 0 && results[i]!.correct; i--) streak++;
  const avg = results.length ? results.reduce((s, r) => s + r.ms, 0) / results.length : 0;
  return { correct, answered: results.length, streak, avgSeconds: avg / 1000 };
}

/** The 3 weakest of a round: wrong first, then slowest. */
export function weakestOfRound(results: readonly Result[]): Result[] {
  return [...results].sort((a, b) => Number(a.correct) - Number(b.correct) || b.ms - a.ms).slice(0, 3);
}
```

`frontend/src/theory/RoundSummary.tsx`:

```tsx
// End of a round (D-19): score, average time, the three weakest items and
// "Practise these", which starts a round of only those.
import { useEffect } from 'react';

import { Button, Panel } from '../ui';
import styles from './Theory.module.css';
import { roundStats, weakestOfRound, type Result } from './useQuizRound';

export function RoundSummary({ results, onRestart }: { results: readonly Result[]; onRestart: (only?: string[]) => void }) {
  const stats = roundStats(results);
  const weak = weakestOfRound(results);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter') onRestart();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onRestart]);
  return (
    <Panel className={styles.stack}>
      <h2 className={styles.big}>
        {stats.correct} / {stats.answered} first try
      </h2>
      <p className={styles.dimText}>Average {stats.avgSeconds.toFixed(1)} s per answer.</p>
      <p>
        Weakest this round: <b>{weak.map((r) => r.text).join(' · ')}</b>
      </p>
      <div className={styles.row}>
        <Button variant="primary" onClick={() => onRestart()}>
          Next round
        </Button>
        <Button onClick={() => onRestart(weak.map((r) => r.item))}>Practise these</Button>
      </div>
    </Panel>
  );
}
```

`frontend/src/theory/QuizStats.tsx`:

```tsx
// Weak spots (D-19): a heatmap over the neck for the fretboard quiz and the
// weakest facts for the theory quiz, both computed from the history on every
// render and never stored. Reset history asks first.
import type { QuizAnswer } from '../api/client';
import { heatmap, mulberry32, parseCellKey, theoryQuestion, weakestFacts } from '../music/quiz';
import { pretty } from '../music/spell';
import type { Instrument } from '../music/tuning';
import { Button, Panel } from '../ui';
import styles from './Theory.module.css';
import { TheoryNeck } from './TheoryNeck';
import { useTheoryDoc } from './TheoryDoc';

export function cellText(inst: Instrument, key: string): string {
  const cell = parseCellKey(key);
  if (!cell) return key;
  const name = pretty([...inst.tuning].reverse()[cell.string]?.replace(/-?\d+$/, '') ?? '?');
  return `${name} string, ${cell.fret === 0 ? 'open' : `fret ${cell.fret}`}`;
}

function ResetHistory() {
  const { update } = useTheoryDoc();
  const reset = () => {
    if (window.confirm('Delete your whole quiz history? Your weak spots start again from scratch.')) {
      update((d) => ({ ...d, quiz: { ...d.quiz, history: [] } }), { now: true });
    }
  };
  return (
    <Button variant="ghost" onClick={reset}>
      Reset history…
    </Button>
  );
}

export function FretboardStats({ instrument, history, frets }: { instrument: Instrument; history: readonly QuizAnswer[]; frets: number }) {
  const heat = heatmap(history).filter((h) => h.string < instrument.strings && h.fret <= frets);
  const weakest = [...heat].sort((a, b) => b.weakness - a.weakness).slice(0, 3).filter((h) => h.weakness >= 0.5);
  return (
    <Panel className={styles.stack}>
      <div className={styles.row}>
        <span className={styles.cap}>your weak spots · last 5 answers per position</span>
        <ResetHistory />
      </div>
      <div className={styles.neck}>
        <TheoryNeck instrument={instrument} frets={frets} dots={[]} heat={heat} label="Weak spots" />
      </div>
      <p className={styles.dimText}>
        {heat.length === 0
          ? 'No answers yet: play a round and your weak spots show up here.'
          : weakest.length === 0
            ? 'No weak spots right now.'
            : `Weakest: ${weakest.map((h) => cellText(instrument, `s${h.string}f${h.fret}`)).join(' · ')}. Those come up more often.`}
      </p>
    </Panel>
  );
}

export function TheoryStats({ history }: { history: readonly QuizAnswer[] }) {
  const facts = weakestFacts(history, 10);
  return (
    <Panel className={styles.stack}>
      <div className={styles.row}>
        <span className={styles.cap}>your weakest facts · last 5 answers each</span>
        <ResetHistory />
      </div>
      {facts.length === 0 ? (
        <p className={styles.dimText}>No answers yet: play a round and your weakest facts show up here.</p>
      ) : (
        <ol className={styles.list}>
          {facts.map((f) => (
            <li key={f.item} className={styles.listRow}>
              {theoryQuestion(f.item, mulberry32(1)).prompt} <span className={styles.dimText}>{Math.round(f.weakness * 100)}% weak</span>
            </li>
          ))}
        </ol>
      )}
    </Panel>
  );
}
```

Append to `frontend/src/theory/Theory.module.css`:

```css
/* ---- quizzes ---- */
.stat {
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: var(--ds-t-xs);
  color: var(--ds-text-3);
}

.stat b {
  font: 700 var(--ds-t-xl) / 1 var(--ds-mono);
  font-variant-numeric: tabular-nums;
  color: var(--ds-text);
}

.option {
  min-height: var(--ds-hit-setup);
  padding: 0 var(--ds-4);
  background: var(--ds-raised);
  color: var(--ds-text);
  border: 1px solid var(--ds-border-strong);
  border-radius: var(--ds-r-btn);
  font: 600 var(--ds-t-md) / 1 var(--ds-font);
  text-align: left;
  cursor: pointer;
}

.option:disabled {
  color: var(--ds-error);
  border-color: var(--ds-error);
  cursor: default;
}
```

- [ ] **Step 4: The Fretboard quiz**

`frontend/src/theory/tools/FretboardQuiz.tsx`:

```tsx
// Fretboard quiz (D-19): name the note, find the note, find the interval, spell
// the chord. Weak spots come up more often (quiz.ts). A wrong answer is marked
// and explained and the question stays until it is right; only the first try
// is scored. Focus settings are saved to theory.json.
import { useCallback, useEffect, useRef, useState } from 'react';

import { DEFAULT_THEORY, type FretboardQuizSettings } from '../../api/client';
import { mod12 } from '../../music/chordTones';
import type { Cell } from '../../music/positions';
import { fretboardQuestion, mulberry32, pcAt, plainName, type FretboardQuestion } from '../../music/quiz';
import { pretty } from '../../music/spell';
import { neckFrets } from '../../music/tuning';
import { Chip, Segmented } from '../../ui';
import { NotePicker, ToolHeader } from '../controls';
import { cellText, FretboardStats } from '../QuizStats';
import { RoundSummary } from '../RoundSummary';
import styles from '../Theory.module.css';
import { TheoryNeck, type NeckDot } from '../TheoryNeck';
import { useTheoryDoc } from '../TheoryDoc';
import { ROUND, roundStats, useQuizRound } from '../useQuizRound';

const MODES = [
  { value: 'name-note', label: 'Name the note' },
  { value: 'find-note', label: 'Find the note' },
  { value: 'find-interval', label: 'Find the interval' },
  { value: 'spell-chord', label: 'Spell the chord' },
] as const;

const INTERVAL_NAMES = ['unison', 'minor 2nd', 'major 2nd', 'minor 3rd', 'major 3rd', '4th', 'tritone', '5th', 'minor 6th', 'major 6th', '♭7', 'major 7th'];

/** Keys 1–9, 0, -, = answer C … B in note-picker order (ui-spec §7). */
export const NOTE_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '-', '='];

interface Attempt {
  q: FretboardQuestion;
  started: number;
  failed: boolean;
  found: Cell[];
  wrong: Cell[];
  feedback: string | null;
}

const same = (a: Cell, b: Cell) => a.string === b.string && a.fret === b.fret;

export function FretboardQuiz() {
  const { doc, update } = useTheoryDoc();
  const inst = doc?.instrument ?? DEFAULT_THEORY.instrument;
  const settings = doc?.quiz.settings.fretboard ?? DEFAULT_THEORY.quiz.settings.fretboard;
  const round = useQuizRound();
  const rng = useRef(mulberry32(Date.now()));
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const frets = neckFrets(inst);
  const focus = { strings: settings.strings, frets: settings.frets, accidentals: settings.accidentals };

  const ask = useCallback(
    (previous?: string, only?: string[]) => {
      const q = fretboardQuestion(settings.mode, inst, focus, round.history, rng.current, previous, only ?? round.only);
      setAttempt({ q, started: Date.now(), failed: false, found: [], wrong: [], feedback: null });
    },
    [settings.mode, settings.strings.join(), settings.frets.join(), settings.accidentals, inst.tuning.join(), round.history.length, round.only],
  );

  // A new question whenever the mode, focus or instrument changes.
  useEffect(() => {
    ask();
  }, [settings.mode, settings.strings.join(), settings.frets.join(), settings.accidentals, inst.tuning.join()]);

  const setSettings = (patch: Partial<FretboardQuizSettings>) => {
    update((d) => ({ ...d, quiz: { ...d.quiz, settings: { ...d.quiz.settings, fretboard: { ...d.quiz.settings.fretboard, ...patch } } } }));
    round.restart();
  };

  const finish = (a: Attempt, text: string, msEach = Date.now() - a.started) => {
    round.record({ quiz: 'fretboard', mode: a.q.mode, item: a.q.item, correct: !a.failed, ms: Math.round(msEach), text });
    ask(a.q.item);
  };

  const miss = (a: Attempt, cell: Cell | null, feedback: string) =>
    setAttempt({ ...a, failed: true, wrong: cell ? [...a.wrong, cell] : a.wrong, feedback });

  const answerNote = (pc: number) => {
    const a = attempt;
    if (!a || a.q.mode !== 'name-note') return;
    if (pc === a.q.answerPc) finish(a, cellText(inst, a.q.item));
    else miss(a, null, `✕ not ${pretty(plainName(pc))}. Try again.`);
  };

  const tap = (cell: Cell) => {
    const a = attempt;
    if (!a || a.q.mode === 'name-note') return;
    const pc = pcAt(inst, cell);
    const name = pretty(plainName(pc));
    if (a.q.mode === 'find-interval') {
      if (pc === a.q.answerPc) finish(a, cellText(inst, a.q.item));
      else miss(a, cell, `✕ that's ${name}, a ${INTERVAL_NAMES[mod12(pc - pcAt(inst, a.q.cell))]} above`);
      return;
    }
    const targets = a.q.targets;
    if (a.found.some((c) => same(c, cell))) return;
    if (targets.some((c) => same(c, cell))) {
      const found = [...a.found, cell];
      if (found.length === targets.length) {
        const text = a.q.mode === 'find-note' ? `every ${pretty(plainName(a.q.pc))}` : pretty(a.q.symbol);
        finish({ ...a, found }, text, (Date.now() - a.started) / targets.length);
      } else setAttempt({ ...a, found, feedback: null });
      return;
    }
    if (a.q.mode === 'spell-chord') {
      miss(a, cell, `✕ ${name} is not in ${pretty(a.q.symbol)}`);
      return;
    }
    const near = targets.filter((t) => t.string === cell.string).sort((x, y) => Math.abs(x.fret - cell.fret) - Math.abs(y.fret - cell.fret))[0];
    const diff = near ? cell.fret - near.fret : 0;
    const how = near && Math.abs(diff) <= 2 ? `, ${Math.abs(diff)} fret${Math.abs(diff) > 1 ? 's' : ''} too ${diff > 0 ? 'high' : 'low'}` : '';
    miss(a, cell, `✕ that's ${name}${how}`);
  };

  useEffect(() => {
    if (settings.mode !== 'name-note') return;
    const onKey = (e: KeyboardEvent) => {
      const pc = NOTE_KEYS.indexOf(e.key);
      if (pc >= 0 && !(e.target instanceof HTMLInputElement)) answerNote(pc);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const stats = roundStats(round.results);
  const q = attempt?.q;
  const dots: NeckDot[] = [];
  if (q && attempt) {
    if (q.mode === 'name-note') dots.push({ ...q.cell, label: '?', marker: 'question' });
    if (q.mode === 'find-interval') dots.push({ ...q.cell, label: pretty(plainName(pcAt(inst, q.cell))), marker: 'accent' });
    for (const c of attempt.found) dots.push({ ...c, label: pretty(plainName(pcAt(inst, c))), marker: 'ok' });
    for (const c of attempt.wrong) dots.push({ ...c, label: '', marker: 'wrong' });
  }
  const lowTwo = [inst.strings - 1, inst.strings - 2];
  const fretOptions = [[0, 5], [0, 12], [0, frets]] as const;

  return (
    <>
      <ToolHeader title="Fretboard quiz">
        <Segmented label="Quiz" value={settings.mode} onChange={(mode) => setSettings({ mode })} options={MODES} />
      </ToolHeader>
      {round.done ? (
        <RoundSummary results={round.results} onRestart={(only) => { round.restart(only); ask(undefined, only); }} />
      ) : (
        q && (
          <>
            <div className={styles.row}>
              <div className={styles.stack}>
                <span className={styles.cap}>{`round ${round.number} of ${ROUND}`}</span>
                <span className={styles.big} aria-live="polite">
                  {q.prompt}
                </span>
                {'targets' in q && (
                  <span className={styles.dimText}>
                    {attempt!.found.length} found · {q.targets.length - attempt!.found.length} to go · tap the neck
                  </span>
                )}
              </div>
              <span className={styles.stat}>
                <b>{stats.correct}</b>/{stats.answered} first try
              </span>
              <span className={styles.stat}>
                <b>{stats.streak}</b> streak
              </span>
              <span className={styles.stat}>
                <b>{stats.avgSeconds.toFixed(1)}s</b> avg
              </span>
            </div>
            <div className={styles.neck}>
              <TheoryNeck
                instrument={inst}
                frets={settings.frets[1]}
                dots={dots}
                window={q.mode === 'spell-chord' ? { lo: q.window[0], hi: q.window[1] } : null}
                onPick={q.mode === 'name-note' ? undefined : tap}
                label={q.prompt}
              />
            </div>
            {q.mode === 'name-note' && (
              <NotePicker label="Answer" selected={[]} onPick={answerNote} />
            )}
            {attempt!.feedback && (
              <Chip tone="error" size="lg">
                {attempt!.feedback}
              </Chip>
            )}
          </>
        )
      )}
      <div className={styles.row}>
        <span className={styles.cap}>practise</span>
        <Segmented
          label="Strings"
          value={settings.strings.length ? 'low' : 'all'}
          onChange={(v) => setSettings({ strings: v === 'all' ? [] : lowTwo })}
          options={[
            { value: 'all', label: 'All strings' },
            { value: 'low', label: `${[...inst.tuning].reverse().slice(-2).reverse().map((n) => pretty(n.replace(/-?\d+$/, ''))).join(' + ')} only` },
          ]}
        />
        <Segmented
          label="Frets"
          value={settings.frets.join('-')}
          onChange={(v) => setSettings({ frets: v.split('-').map(Number) as [number, number] })}
          options={fretOptions.map(([lo, hi]) => ({ value: `${lo}-${hi}`, label: `Frets ${lo}–${hi}` }))}
        />
        <Segmented
          label="Notes"
          value={settings.accidentals ? 'all' : 'naturals'}
          onChange={(v) => setSettings({ accidentals: v === 'all' })}
          options={[
            { value: 'naturals', label: 'Naturals' },
            { value: 'all', label: '+ sharps/flats' },
          ]}
        />
      </div>
      <FretboardStats instrument={inst} history={round.history} frets={frets} />
    </>
  );
}
```

Register it in `frontend/src/theory/tools.ts` (import `FretboardQuiz`) as the last entry:

```ts
  { slug: 'fretboard-quiz', label: 'Fretboard quiz', group: 'Practice', Component: FretboardQuiz },
```

- [ ] **Step 5: Run the tests**

Run: `npm --prefix frontend test -- src/theory`
Expected: all pass (fretboardQuiz 6).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/theory/useQuizRound.ts frontend/src/theory/RoundSummary.tsx frontend/src/theory/QuizStats.tsx frontend/src/theory/Theory.module.css frontend/src/theory/tools/FretboardQuiz.tsx frontend/src/theory/tools/fretboardQuiz.test.tsx frontend/src/theory/tools.ts
git commit -m "feat(theory): Fretboard quiz, first-try scoring, weak-spot heatmap, one save per round (D-19)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: The Theory quiz

**Files:**
- Create: `frontend/src/theory/tools/TheoryQuiz.tsx`
- Modify: `frontend/src/theory/tools.ts`
- Test: `frontend/src/theory/tools/theoryQuiz.test.tsx`

- [ ] **Step 1: Write the failing test**

The test clicks options in order until the question changes, so it doesn't need to know the answer.

```tsx
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';

import type { QuizAnswer } from '../../api/client';
import { renderTool } from './testing';

afterEach(() => vi.unstubAllGlobals());

const progress = () => screen.queryByText(/^round \d+ of 20$/)?.textContent ?? 'done';

/** Clicks options in order until the question changes; returns how many were wrong. */
function answerTheory(): number {
  const before = progress();
  const buttons = within(screen.getByRole('group', { name: 'Answers' })).getAllByRole('button');
  for (let i = 0; i < buttons.length; i++) {
    fireEvent.click(buttons[i]!);
    if (progress() !== before) return i;
  }
  throw new Error('no option advanced the question');
}

test('theory quiz: a wrong pick is crossed out and the question stays', async () => {
  renderTool('/theory/theory-quiz');
  await screen.findByRole('group', { name: 'Answers' });
  const wrong = answerTheory();
  expect(screen.getByText(/^round \d+ of 20$/)).toHaveTextContent('round 2 of 20');
  expect(screen.getByText(/first try/)).toHaveTextContent(`${wrong === 0 ? 1 : 0}/1 first try`);
});

test('theory quiz: topics are saved; a round of 20 is one PUT', async () => {
  const { puts } = renderTool('/theory/theory-quiz');
  await screen.findByRole('group', { name: 'Answers' });
  fireEvent.click(screen.getByRole('button', { name: 'Keys' }));
  fireEvent.click(screen.getByRole('button', { name: 'Chords' }));
  // The last topic can't be switched off.
  fireEvent.click(screen.getByRole('button', { name: 'Intervals' }));
  expect(screen.getByRole('button', { name: 'Intervals' })).toHaveAttribute('aria-pressed', 'true');
  for (let i = 0; i < 20; i++) answerTheory();
  expect(await screen.findByText(/ \/ 20 first try/)).toBeInTheDocument();
  await waitFor(() => expect(puts.some((p) => p.quiz.history.length === 20)).toBe(true));
  const saved = puts.find((p) => p.quiz.history.length === 20)!;
  expect(saved.quiz.settings.theory.topics).toEqual(['intervals']);
  expect(saved.quiz.history.every((a: QuizAnswer) => a.quiz === 'theory' && a.mode === 'intervals')).toBe(true);
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npm --prefix frontend test -- src/theory/tools/theoryQuiz.test.tsx`
Expected: FAIL (`Unable to find role="group" and name "Answers"`).

- [ ] **Step 3: Implement**

```tsx
// Theory quiz (D-19): keys, chords and intervals as four-option questions.
// Wrong options are plausible (neighbouring keys, one changed chord tone). A
// wrong pick is crossed out and the question stays; only the first try counts.
import { useCallback, useEffect, useRef, useState } from 'react';

import { DEFAULT_THEORY, type TheoryQuizSettings } from '../../api/client';
import { mulberry32, nextTheoryQuestion, type TheoryQuestion } from '../../music/quiz';
import { ToolHeader } from '../controls';
import { TheoryStats } from '../QuizStats';
import { RoundSummary } from '../RoundSummary';
import styles from '../Theory.module.css';
import { useTheoryDoc } from '../TheoryDoc';
import { ROUND, roundStats, useQuizRound } from '../useQuizRound';

const TOPICS = [
  { value: 'keys', label: 'Keys' },
  { value: 'chords', label: 'Chords' },
  { value: 'intervals', label: 'Intervals' },
] as const;

type Topic = TheoryQuizSettings['topics'][number];

interface Attempt {
  q: TheoryQuestion;
  started: number;
  wrong: number[];
}

export function TheoryQuiz() {
  const { doc, update } = useTheoryDoc();
  const topics = doc?.quiz.settings.theory.topics ?? DEFAULT_THEORY.quiz.settings.theory.topics;
  const round = useQuizRound();
  const rng = useRef(mulberry32(Date.now()));
  const [attempt, setAttempt] = useState<Attempt | null>(null);

  const ask = useCallback(
    (previous?: string, only?: string[]) =>
      setAttempt({ q: nextTheoryQuestion(topics, round.history, rng.current, previous, only ?? round.only), started: Date.now(), wrong: [] }),
    [topics, round.history, round.only],
  );

  useEffect(() => {
    ask();
  }, [topics.join()]);

  const toggleTopic = (topic: Topic) => {
    const next = topics.includes(topic) ? topics.filter((t) => t !== topic) : [...topics, topic];
    if (next.length === 0) return; // at least one topic, as theory.json requires
    update((d) => ({ ...d, quiz: { ...d.quiz, settings: { ...d.quiz.settings, theory: { topics: next } } } }));
    round.restart();
  };

  const choose = (i: number) => {
    const a = attempt;
    if (!a || a.wrong.includes(i)) return;
    if (i === a.q.answer) {
      round.record({ quiz: 'theory', mode: a.q.topic, item: a.q.item, correct: a.wrong.length === 0, ms: Date.now() - a.started, text: a.q.prompt });
      ask(a.q.item);
    } else setAttempt({ ...a, wrong: [...a.wrong, i] });
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const i = ['1', '2', '3', '4'].indexOf(e.key);
      if (i >= 0 && !round.done) choose(i);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const stats = roundStats(round.results);
  const q = attempt?.q;

  return (
    <>
      <ToolHeader title="Theory quiz">
        <div className={styles.choices} role="group" aria-label="Topics">
          {TOPICS.map((t) => (
            <button key={t.value} type="button" className={styles.chip} aria-pressed={topics.includes(t.value)} onClick={() => toggleTopic(t.value)}>
              {t.label}
            </button>
          ))}
        </div>
      </ToolHeader>
      {round.done ? (
        <RoundSummary results={round.results} onRestart={(only) => { round.restart(only); ask(undefined, only); }} />
      ) : (
        q && (
          <>
            <div className={styles.row}>
              <div className={styles.stack}>
                <span className={styles.cap}>{`round ${round.number} of ${ROUND}`}</span>
                <span className={styles.big} aria-live="polite">
                  {q.prompt}
                </span>
              </div>
              <span className={styles.stat}>
                <b>{stats.correct}</b>/{stats.answered} first try
              </span>
              <span className={styles.stat}>
                <b>{stats.streak}</b> streak
              </span>
            </div>
            <div className={styles.list} role="group" aria-label="Answers">
              {q.options.map((o, i) => (
                <button key={o} type="button" className={styles.option} disabled={attempt!.wrong.includes(i)} onClick={() => choose(i)}>
                  {i + 1}. {o}
                  {attempt!.wrong.includes(i) && ' ✕'}
                </button>
              ))}
            </div>
          </>
        )
      )}
      <TheoryStats history={round.history} />
    </>
  );
}
```

Register it in `tools.ts` (import `TheoryQuiz`), after Fretboard quiz:

```ts
  { slug: 'theory-quiz', label: 'Theory quiz', group: 'Practice', Component: TheoryQuiz },
```

With both earlier phases done, `tools.ts` reads:

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
import { FretboardQuiz } from './tools/FretboardQuiz';
import { NameThatChord } from './tools/NameThatChord';
import { NoteFinder } from './tools/NoteFinder';
import { Progressions } from './tools/Progressions';
import { ScaleFinder } from './tools/ScaleFinder';
import { ScalePositions } from './tools/ScalePositions';
import { ScalesOverChord } from './tools/ScalesOverChord';
import { TheoryQuiz } from './tools/TheoryQuiz';
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
  { slug: 'fretboard-quiz', label: 'Fretboard quiz', group: 'Practice', Component: FretboardQuiz },
  { slug: 'theory-quiz', label: 'Theory quiz', group: 'Practice', Component: TheoryQuiz },
];

export function toolBySlug(slug: string | undefined): ToolDef | undefined {
  return TOOLS.find((t) => t.slug === slug);
}
```

- [ ] **Step 4: Run everything**

Run: `npm --prefix frontend test && npm --prefix frontend run build`
Expected: everything passes, and the build is clean with no 500 kB warning (the Theory chunk is about 96 kB).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/theory/tools/TheoryQuiz.tsx frontend/src/theory/tools/theoryQuiz.test.tsx frontend/src/theory/tools.ts
git commit -m "feat(theory): Theory quiz, keys, chords and intervals with plausible wrong answers (D-19)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: README, screenshot, verification, push

**Files:**
- Modify: `README.md`
- Create: `docs/screenshots/theory-quiz.png`

- [ ] **Step 1: Update the README**

Append to the Theory tab feature bullet:

```markdown
  Two quizzes, a fretboard quiz (name, find, intervals, chord tones) and a theory quiz
  (keys, chords, intervals), ask about your weak spots more often and show them on a
  heatmap; the history is kept in `data/theory.json`
```

Under `## Screens`, add `![Theory: fretboard quiz](docs/screenshots/theory-quiz.png)`. Bump the count in "All … are captures", and add `theory-quiz=/theory/fretboard-quiz` to the capture command. In `## Run locally`, add one line saying that `data/theory.json` holds the Theory tab's instrument and quiz history, and that the API is its only writer.

- [ ] **Step 2: Capture the screenshot**

With the API and dev server running, answer a handful of questions first so the heatmap has cells in it.

Run: `node scripts/capture-screens.mjs theory-quiz=/theory/fretboard-quiz`
Expected: `docs/screenshots/theory-quiz.png` shows a question, the stats and the weak-spot heatmap. Compare it with `design/ui/dist/screens/theory-fretboard-quiz.html`.

- [ ] **Step 3: Full verification**

Run: `uv run pytest && npm --prefix frontend test && npm --prefix frontend run build`
Expected: everything passes. Then check in the running app:
- play a full round and see that `data/theory.json` gains 20 answers in one write;
- reload and see the heatmap persist;
- stop the API mid-round, leave the quiz, and see the "Couldn't save" banner; start the API again, press Retry, and see the answers arrive.

- [ ] **Step 4: Commit and push**

```bash
git add README.md docs/screenshots/theory-quiz.png
git commit -m "docs: README and screenshot for the Theory quizzes (D-19)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push origin main
```
