# Guess the Note Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a third Theory quiz, **Guess the note**. A note is played in the bass or guitar voice, optionally after a reference A, and the player names it with the note buttons or taps it on the neck.

**Architecture:**
- The quiz logic is pure TypeScript next to `quiz.ts`, reusing its focus, weighting and RNG.
- Each question is rendered offline into four stem-shaped `Float32Array`s at 48 kHz, using Practice's existing voices, and played once through one `EngineController` per visit (D-22's audio path, recorded as D-23).
- `theory.json` gains `quiz.settings.ear`, the quiz kind `"ear"` and the tool slug `"guess-note"`. The change only adds fields, and the schema stays at v1.

**Tech Stack:** as the Theory tab: React + TypeScript + Vitest (jsdom) in `frontend/`, pydantic in `packages/stemcraft_lib`, `uv run pytest`.

**Spec:** `docs/superpowers/specs/2026-10-03-guess-the-note-design.md`
**Depends on:** Theory quizzes (D-19) and Practice Phase A (D-22), both shipped.

## Global Constraints

- **48 kHz everywhere** (invariant 4). Every frame count is an integer computed from `SAMPLE_RATE`.
- **The API never imports torch** (invariant 1). Nothing here touches the worker.
- **No second audio path.** The Theory tab plays only through `EngineController`: no `new AudioContext`, `OscillatorNode` or `AudioBufferSourceNode` in `theory/`.
- **Fail loudly** (N-08). An engine that cannot start is shown with its real message, and the quiz is not offered without sound.
- **Relaxed practice.** No score, rounds, streaks or timer. Only the first try is recorded, and replays are free.
- Defaults: `answer: "name"`, `reference: "a"`, `strings: []`, `frets: [0, 12]`, `accidentals: false`.
- History: `quiz: "ear"`, `mode: "<answer>/<reference>"`, `item: "m<midi>"`.
- Note names: `plainName` and `pretty` (sharps, plus E♭/B♭, as in the other quizzes), with the octave in scientific pitch (`G2`).
- Work on `main`. Commit after each task. Push only at the end of Task 6, after README upkeep (CLAUDE.md).
- Commands: `uv run pytest`, `npm --prefix frontend test -- --run <path>`, `npm --prefix frontend run typecheck`.

## File map

| File | Change |
|---|---|
| `packages/stemcraft_lib/src/stemcraft_lib/theory.py` (+ `tests/test_theory.py`) | `EarQuizSettings`, `"ear"` quiz kind, `"guess-note"` tool |
| `frontend/src/api/client.ts` | mirror: `EarQuizSettings`, `QuizAnswer.quiz`, `TheoryTool`, `DEFAULT_THEORY` |
| `frontend/src/theory/InstrumentFooter.tsx` | carry the ear focus over on an instrument change |
| `frontend/src/music/quiz.ts` | export `checkFocus`, `SEMITONE_NAMES`; `QuizKind` gains `'ear'` |
| `frontend/src/music/earQuiz.ts` (+ test) | **new**: `referenceMidi`, `pitchLabel`, `earQuestion`, `judgeName`, `judgeNeck` |
| `frontend/src/theory/audio/guessRender.ts` (+ test) | **new**: `renderGuess` |
| `frontend/src/theory/useGuessSound.ts` (+ test) | **new**: one engine per visit, play/replay |
| `frontend/src/theory/FocusControls.tsx` | **new**: the strings/frets/notes row, taken out of `FretboardQuiz` |
| `frontend/src/theory/tools/FretboardQuiz.tsx` | use `FocusControls` and `SEMITONE_NAMES` from `quiz.ts` |
| `frontend/src/theory/tools/GuessNote.tsx` (+ `guessNote.test.tsx`) | **new**: the screen |
| `frontend/src/theory/tools.ts` | register `guess-note` after Fretboard quiz |
| `design/*`, the Theory spec, `README.md`, `docs/screenshots/` | D-23, the amended non-goal, the README, a screenshot |

---

### Task 1: `theory.json` learns the ear quiz

**Files:**
- Modify: `packages/stemcraft_lib/src/stemcraft_lib/theory.py`
- Test: `packages/stemcraft_lib/tests/test_theory.py`
- Modify: `frontend/src/api/client.ts:412-472`
- Modify: `frontend/src/theory/InstrumentFooter.tsx:35-40`
- Test: `frontend/src/theory/tools/fretboardQuiz.test.tsx` (an instrument-change test for the ear focus goes in Task 5's test file; here only the types must compile)

**Interfaces:**
- Produces (TS): `EarQuizSettings { answer: 'name' | 'neck'; reference: 'a' | 'none'; strings: number[]; frets: [number, number]; accidentals: boolean }`; `TheoryDoc['quiz']['settings'].ear`; `QuizAnswer.quiz: 'fretboard' | 'theory' | 'ear'`; `TheoryTool` includes `'guess-note'`.

- [ ] **Step 1: Write the failing Python tests** (append to `test_theory.py`)

```python
def test_ear_settings_default_and_old_files_read(tmp_path):
    # A file written before the ear quiz existed has no "ear": it reads with the defaults.
    raw = Theory().model_dump(mode="json")
    del raw["quiz"]["settings"]["ear"]
    theory_path(tmp_path).write_text(json.dumps(raw))
    ear = read_theory(tmp_path).quiz.settings.ear
    assert (ear.answer, ear.reference, ear.strings, ear.frets, ear.accidentals) == ("name", "a", [], (0, 12), False)


def test_ear_answers_and_tool_round_trip(tmp_path):
    theory = Theory.model_validate(
        {
            "last_tool": "guess-note",
            "quiz": {
                "settings": {"ear": {"answer": "neck", "reference": "none", "frets": [0, 5]}},
                "history": [{"quiz": "ear", "mode": "neck/none", "item": "m43", "correct": False, "at": "2026-10-03T00:00:00Z"}],
            },
        }
    )
    write_theory(tmp_path, theory)
    back = read_theory(tmp_path)
    assert back.last_tool == "guess-note"
    assert back.quiz.settings.ear.answer == "neck"
    assert back.quiz.history[0].quiz == "ear"


@pytest.mark.parametrize(
    "ear",
    [{"answer": "hum"}, {"reference": "c"}, {"frets": [7, 3]}, {"tempo": 90}],
)
def test_bad_ear_settings_are_rejected(ear):
    with pytest.raises(ValidationError):
        Theory.model_validate({"quiz": {"settings": {"ear": ear}}})
```

Add `from pydantic import ValidationError` to the imports if the file does not have it yet.

- [ ] **Step 2: Run them and see them fail**

Run: `uv run pytest packages/stemcraft_lib/tests/test_theory.py -q`
Expected: FAIL. `ear` is an unknown field (`extra="forbid"`), and `"guess-note"` and `"ear"` are not in the Literals.

- [ ] **Step 3: Implement in `theory.py`**

Add `"guess-note"` to `Tool` after `"fretboard-quiz"`. Move the fret check into a function both settings classes share:

```python
def _fret_range(frets: tuple[int, int]) -> tuple[int, int]:
    lo, hi = frets
    if not 0 <= lo < hi <= 24:
        raise ValueError(f"fret range must satisfy 0 <= lo < hi <= 24, got {lo}-{hi}")
    return frets


class FretboardQuizSettings(_Strict):
    mode: Literal["name-note", "find-note", "find-interval", "spell-chord"] = "find-note"
    strings: list[int] = Field(default_factory=list)  # rows, 0 = highest string; empty = all
    frets: tuple[int, int] = (0, 12)
    accidentals: bool = False

    @field_validator("frets")
    @classmethod
    def _range(cls, frets: tuple[int, int]) -> tuple[int, int]:
        return _fret_range(frets)


class EarQuizSettings(_Strict):
    """Guess the note: how the player answers, whether an A is played first, and
    the same focus as the Fretboard quiz (stored apart from it)."""

    answer: Literal["name", "neck"] = "name"
    reference: Literal["a", "none"] = "a"
    strings: list[int] = Field(default_factory=list)
    frets: tuple[int, int] = (0, 12)
    accidentals: bool = False

    @field_validator("frets")
    @classmethod
    def _range(cls, frets: tuple[int, int]) -> tuple[int, int]:
        return _fret_range(frets)
```

In `QuizSettings` add `ear: EarQuizSettings = Field(default_factory=EarQuizSettings)`. In `QuizAnswer` change it to `quiz: Literal["fretboard", "theory", "ear"]`.

- [ ] **Step 4: Run the Python tests and see them pass**

Run: `uv run pytest packages/stemcraft_lib/tests/test_theory.py packages/stemcraft_api/tests/test_theory_routes.py -q`
Expected: PASS

- [ ] **Step 5: Mirror the change in `client.ts`**

```ts
export type TheoryTool =
  | 'scale-finder' | 'chord-finder' | 'note-finder' | 'name-that-chord'
  | 'scale-positions' | 'triads' | 'arpeggios'
  | 'chords-in-key' | 'circle-of-fifths' | 'progressions' | 'scales-over-chord'
  | 'fretboard-quiz' | 'guess-note' | 'theory-quiz';

export interface EarQuizSettings {
  answer: 'name' | 'neck';
  reference: 'a' | 'none';
  /** Rows (0 = highest string); empty = every string. */
  strings: number[];
  frets: [number, number];
  accidentals: boolean;
}
```

Change `QuizAnswer.quiz` to `'fretboard' | 'theory' | 'ear'`, change `TheoryDoc.quiz.settings` to `{ fretboard: FretboardQuizSettings; theory: TheoryQuizSettings; ear: EarQuizSettings }`, and add to `DEFAULT_THEORY.quiz.settings`:

```ts
      ear: { answer: 'name', reference: 'a', strings: [], frets: [0, 12], accidentals: false },
```

- [ ] **Step 6: Carry the ear focus over on an instrument change** (`InstrumentFooter.tsx`)

```ts
  const set = (next: Instrument) =>
    update((d) => {
      const fretboard = focusFor(d.quiz.settings.fretboard, d.instrument, next);
      // A document saved before the ear quiz existed (kept from an unsaved tab) may lack it.
      const ear = focusFor(d.quiz.settings.ear ?? DEFAULT_THEORY.quiz.settings.ear, d.instrument, next);
      const unchanged = fretboard === d.quiz.settings.fretboard && ear === d.quiz.settings.ear;
      const quiz = unchanged ? d.quiz : { ...d.quiz, settings: { ...d.quiz.settings, fretboard, ear } };
      return { ...d, instrument: next, quiz };
    });
```

Update the file's header comment so it says both quiz focuses are carried over.

- [ ] **Step 7: Typecheck and run the Theory tests**

Run: `npm --prefix frontend run typecheck && npm --prefix frontend test -- --run src/theory src/screens/Theory.test.tsx`
Expected: PASS. A test fixture typed as a full `TheoryDoc` that is missing `ear` is fixed by adding the default, never by loosening the type.

- [ ] **Step 8: Commit**

```bash
git add packages/stemcraft_lib frontend/src/api/client.ts frontend/src/theory/InstrumentFooter.tsx frontend/src
git commit -m "feat(theory): theory.json learns the ear quiz's settings and answers (D-23)"
```

---

### Task 2: The question and the judging (`earQuiz.ts`)

**Files:**
- Modify: `frontend/src/music/quiz.ts` (export `checkFocus`; add `SEMITONE_NAMES`; `QuizKind` gains `'ear'`)
- Modify: `frontend/src/theory/tools/FretboardQuiz.tsx` (import `SEMITONE_NAMES` from `quiz.ts` and delete the local copy)
- Create: `frontend/src/music/earQuiz.ts`
- Test: `frontend/src/music/earQuiz.test.ts`

**Interfaces:**
- Consumes: `focusCells`, `pickItem`, `weakness`, `plainName`, `QuizFocusError`, `FretboardFocus`, `Rng`, `mulberry32` (all in `quiz.ts`); `positionAt` (`positions.ts`); `pretty` (`spell.ts`); `mod12` (`chordTones.ts`).
- Produces:
  - `type EarAnswer = 'name' | 'neck'`, `type EarReference = 'a' | 'none'`
  - `interface EarQuestion { item: string; mode: string; midi: number; reference: number | null }`
  - `earMode(answer: EarAnswer, reference: EarReference): string` (`"name/a"`)
  - `referenceMidi(target: number): number`
  - `pitchLabel(midi: number): string` (`43 → "G2"`)
  - `earQuestion(answer, reference, inst, focus, history, rng, previous?): EarQuestion` (throws `QuizFocusError`)
  - `judgeName(target: number, pc: number): string | null` (null = right)
  - `judgeNeck(target: number, tapped: number): string | null` (null = right)

- [ ] **Step 1: Make the shared pieces available in `quiz.ts`**

Change `function checkFocus` to `export function checkFocus`, change `QuizKind` to `'fretboard' | 'theory' | 'ear'`, and move the list out of `FretboardQuiz.tsx`:

```ts
/** Interval names by semitones, 0–11, as the quizzes' feedback says them. */
export const SEMITONE_NAMES = ['unison', 'minor 2nd', 'major 2nd', 'minor 3rd', 'major 3rd', '4th', 'tritone', '5th', 'minor 6th', 'major 6th', 'minor 7th', 'major 7th'];
```

In `FretboardQuiz.tsx` delete its `SEMITONE_NAMES` constant and import it from `../../music/quiz`.

- [ ] **Step 2: Write the failing tests** (`earQuiz.test.ts`)

```ts
import { describe, expect, test } from 'vitest';

import { earQuestion, judgeName, judgeNeck, pitchLabel, referenceMidi } from './earQuiz';
import { positionAt } from './positions';
import { focusCells, mulberry32, QuizFocusError, type Answer } from './quiz';
import { DEFAULT_INSTRUMENT } from './tuning';

const ALL = { strings: [], frets: [0, 12] as [number, number], accidentals: true };

describe('referenceMidi', () => {
  test('is an A at most a tritone away, the lower one on a tie', () => {
    expect(referenceMidi(45)).toBe(45); // A2 itself
    expect(referenceMidi(48)).toBe(45); // C3: A2 is 3 below
    expect(referenceMidi(51)).toBe(45); // E♭3: a tritone either way, so the lower A
    expect(referenceMidi(52)).toBe(57); // E3: A3 is 5 above
    for (let m = 28; m < 80; m++) {
      const r = referenceMidi(m);
      expect(r % 12).toBe(9);
      expect(Math.abs(r - m)).toBeLessThanOrEqual(6);
    }
  });
});

test('pitchLabel is the plain name plus the scientific octave', () => {
  expect(pitchLabel(43)).toBe('G2');
  expect(pitchLabel(28)).toBe('E1');
  expect(pitchLabel(70)).toBe('B♭4');
});

describe('earQuestion', () => {
  test('asks only pitches the focus holds, and plays an A first only with the reference on', () => {
    const focus = { strings: [3], frets: [0, 5] as [number, number], accidentals: false };
    const allowed = new Set(focusCells(DEFAULT_INSTRUMENT, focus).map((c) => positionAt(DEFAULT_INSTRUMENT, c).midi));
    const rng = mulberry32(1);
    for (let i = 0; i < 50; i++) {
      const q = earQuestion('name', 'a', DEFAULT_INSTRUMENT, focus, [], rng);
      expect(allowed.has(q.midi)).toBe(true);
      expect(q.item).toBe(`m${q.midi}`);
      expect(q.mode).toBe('name/a');
      expect(q.reference).toBe(referenceMidi(q.midi));
    }
    expect(earQuestion('neck', 'none', DEFAULT_INSTRUMENT, focus, [], rng).reference).toBeNull();
  });

  test('never asks the same pitch twice in a row', () => {
    const rng = mulberry32(7);
    let prev: string | undefined;
    for (let i = 0; i < 100; i++) {
      const q = earQuestion('name', 'a', DEFAULT_INSTRUMENT, ALL, [], rng, prev);
      expect(q.item).not.toBe(prev);
      prev = q.item;
    }
  });

  test('a pitch answered wrongly comes up more often than one always answered right', () => {
    const focus = { strings: [3], frets: [0, 1] as [number, number], accidentals: true }; // E1 and F1 only
    const answer = (item: string, correct: boolean): Answer => ({ quiz: 'ear', mode: 'name/a', item, correct, at: '' });
    const history = [...Array(5)].flatMap(() => [answer('m28', false), answer('m29', true)]);
    const rng = mulberry32(3);
    let e = 0;
    for (let i = 0; i < 400; i++) if (earQuestion('name', 'a', DEFAULT_INSTRUMENT, focus, history, rng).item === 'm28') e++;
    expect(e).toBeGreaterThan(300);
  });

  test('a focus with nothing in it says why', () => {
    expect(() => earQuestion('name', 'a', DEFAULT_INSTRUMENT, { strings: [9], frets: [0, 12], accidentals: true }, [], mulberry32(1))).toThrow(QuizFocusError);
  });
});

describe('judging', () => {
  test('a name is right in any octave', () => {
    expect(judgeName(43, 7)).toBeNull();
    expect(judgeName(43, 9)).toBe('✕ not A. Try again.');
  });

  test('a tap must be the exact pitch, and a miss says how far off it is', () => {
    expect(judgeNeck(43, 43)).toBeNull();
    expect(judgeNeck(43, 55)).toBe('✕ right note, an octave too high');
    expect(judgeNeck(43, 19)).toBe('✕ right note, 2 octaves too low');
    expect(judgeNeck(43, 41)).toBe("✕ that's F2, a major 2nd too low");
    expect(judgeNeck(43, 50)).toBe("✕ that's D3, a 5th too high");
    expect(judgeNeck(43, 30)).toBe("✕ that's F♯1, more than an octave too low");
  });
});
```

- [ ] **Step 3: Run them and see them fail**

Run: `npm --prefix frontend test -- --run src/music/earQuiz.test.ts`
Expected: FAIL, "Failed to resolve import './earQuiz'"

- [ ] **Step 4: Implement `earQuiz.ts`**

```ts
// Guess the note (D-23): a note is played (an A first, unless the reference is
// off), and the player names it or finds it on the neck. Targets come from the
// same focus as the Fretboard quiz, so every note is on the neck in front of
// the player; weighting, the RNG and "never twice in a row" are quiz.ts's.
// Naming is by pitch class (any octave), the neck by exact pitch.
import type { QuizAnswer } from '../api/client';
import { mod12 } from './chordTones';
import { positionAt } from './positions';
import { checkFocus, focusCells, SEMITONE_NAMES, pickItem, plainName, QuizFocusError, weakness, type FretboardFocus, type Rng } from './quiz';
import { pretty } from './spell';
import type { Instrument } from './tuning';

export type EarAnswer = 'name' | 'neck';
export type EarReference = 'a' | 'none';

export interface EarQuestion {
  /** `m<midi>`: the history item. */
  item: string;
  /** `<answer>/<reference>`: the history mode. Knowing a note after an A is not knowing it cold. */
  mode: string;
  midi: number;
  /** The A played first, or null for none. */
  reference: number | null;
}

export const earMode = (answer: EarAnswer, reference: EarReference) => `${answer}/${reference}`;

/** The A nearest the target: at most a tritone away, the lower one on a tie. */
export function referenceMidi(target: number): number {
  const above = mod12(target - 9); // semitones from the A at or below
  return above <= 6 ? target - above : target - above + 12;
}

/** "G2": the quizzes' plain name with the scientific octave. */
export function pitchLabel(midi: number): string {
  return `${pretty(plainName(mod12(midi)))}${Math.floor(midi / 12) - 1}`;
}

export function earQuestion(
  answer: EarAnswer,
  reference: EarReference,
  inst: Instrument,
  focus: FretboardFocus,
  history: readonly QuizAnswer[],
  rng: Rng,
  previous?: string,
): EarQuestion {
  checkFocus(inst, focus);
  const cells = focusCells(inst, focus);
  if (cells.length === 0) throw new QuizFocusError('naturals');
  const mode = earMode(answer, reference);
  const items = [...new Set(cells.map((c) => positionAt(inst, c).midi))].sort((a, b) => a - b).map((m) => `m${m}`);
  const item = pickItem(items, (i) => weakness(history, 'ear', mode, i), rng, previous);
  const midi = Number(item.slice(1));
  return { item, mode, midi, reference: reference === 'a' ? referenceMidi(midi) : null };
}

/** Null when right: any octave of the note. */
export function judgeName(target: number, pc: number): string | null {
  return mod12(pc) === mod12(target) ? null : `✕ not ${pretty(plainName(pc))}. Try again.`;
}

/** Null when right: the exact pitch, on any string. */
export function judgeNeck(target: number, tapped: number): string | null {
  const d = tapped - target;
  if (d === 0) return null;
  const dir = d > 0 ? 'high' : 'low';
  const n = Math.abs(d);
  if (n % 12 === 0) return `✕ right note, ${n === 12 ? 'an octave' : `${n / 12} octaves`} too ${dir}`;
  const that = `✕ that's ${pitchLabel(tapped)}`;
  return n > 12 ? `${that}, more than an octave too ${dir}` : `${that}, a ${SEMITONE_NAMES[n]} too ${dir}`;
}
```

- [ ] **Step 5: Run the tests and see them pass, including the quiz tests that must not change**

Run: `npm --prefix frontend test -- --run src/music/earQuiz.test.ts src/music/quiz.test.ts src/theory/tools/fretboardQuiz.test.tsx`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add frontend/src/music/earQuiz.ts frontend/src/music/earQuiz.test.ts frontend/src/music/quiz.ts frontend/src/theory/tools/FretboardQuiz.tsx
git commit -m "feat(theory): guess-the-note questions, reference A and judging (D-23)"
```

---

### Task 3: Render a question to audio (`guessRender.ts`)

**Files:**
- Create: `frontend/src/theory/audio/guessRender.ts`
- Test: `frontend/src/theory/audio/guessRender.test.ts`

**Interfaces:**
- Consumes: `bassNote(midi, frames)`, `pluckNote(midi, frames, seed)`, `RELEASE_FRAMES`, `midiHz` (`practice/audio/voices.ts`); `SAMPLE_RATE`, `STEM_ORDER`, `StemName` (`engine/types.ts`); `StemChannels` (`engine/loopCursor.ts`).
- Produces: `renderGuess(kind: 'bass' | 'guitar', target: number, reference: number | null): StemChannels[]` (STEM_ORDER, equal lengths); `REFERENCE_FRAMES`, `TARGET_FRAMES`, `TARGET_AT`, `VOICE_SLOT`.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, test } from 'vitest';

import { SAMPLE_RATE, STEM_ORDER } from '../../engine/types';
import { RELEASE_FRAMES } from '../../practice/audio/voices';
import { REFERENCE_FRAMES, renderGuess, TARGET_AT, TARGET_FRAMES, VOICE_SLOT } from './guessRender';

const peak = (xs: Float32Array, from = 0, to = xs.length) => {
  let m = 0;
  for (let i = from; i < to; i++) m = Math.max(m, Math.abs(xs[i]!));
  return m;
};

describe('renderGuess', () => {
  test.each(['bass', 'guitar'] as const)('%s: the voice is in its slot, the other slots are silent, nothing clips', (kind) => {
    const stems = renderGuess(kind, 43, 45);
    expect(stems).toHaveLength(STEM_ORDER.length);
    const slot = STEM_ORDER.indexOf(VOICE_SLOT[kind]);
    stems.forEach((s, i) => {
      expect(s.left.length).toBe(stems[0]!.left.length);
      expect(s.right.length).toBe(s.left.length);
      if (i === slot) {
        expect(peak(s.left)).toBeGreaterThan(0.1);
        expect(peak(s.left)).toBeLessThan(1);
        expect(s.right).toEqual(s.left);
        expect(s.right.buffer).not.toBe(s.left.buffer); // the engine transfers each channel's buffer
      } else expect(peak(s.left) + peak(s.right)).toBe(0);
    });
  });

  test('with a reference: the A from frame 0, a gap of silence, then the target at TARGET_AT', () => {
    const voice = renderGuess('bass', 43, 45)[STEM_ORDER.indexOf('bass')]!.left;
    expect(voice.length).toBe(TARGET_AT + TARGET_FRAMES + RELEASE_FRAMES);
    expect(peak(voice, 0, SAMPLE_RATE / 10)).toBeGreaterThan(0.1);
    expect(peak(voice, REFERENCE_FRAMES + RELEASE_FRAMES, TARGET_AT)).toBe(0);
    expect(peak(voice, TARGET_AT, TARGET_AT + SAMPLE_RATE / 10)).toBeGreaterThan(0.1);
  });

  test('without a reference: only the target, from frame 0', () => {
    const voice = renderGuess('guitar', 55, null)[STEM_ORDER.indexOf('other')]!.left;
    expect(voice.length).toBe(TARGET_FRAMES + RELEASE_FRAMES);
    expect(peak(voice, 0, SAMPLE_RATE / 10)).toBeGreaterThan(0.05);
  });

  test('is deterministic', () => {
    expect(renderGuess('guitar', 55, 57)[3]!.left).toEqual(renderGuess('guitar', 55, 57)[3]!.left);
  });
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `npm --prefix frontend test -- --run src/theory/audio/guessRender.test.ts`
Expected: FAIL, module not found

- [ ] **Step 3: Implement**

```ts
// Guess the note's sound (D-23): the question as four stem-shaped buffers at
// 48 kHz for the engine, in the Practice tab's voices (D-22). The voice sits in
// the slot Practice uses for that instrument; the other slots are silent. With
// a reference, the A rings, a short silence follows, then the target.
import type { StemChannels } from '../../engine/loopCursor';
import { SAMPLE_RATE, STEM_ORDER, type StemName } from '../../engine/types';
import { bassNote, pluckNote } from '../../practice/audio/voices';

export const REFERENCE_FRAMES = Math.round(0.8 * SAMPLE_RATE);
const GAP_FRAMES = Math.round(0.25 * SAMPLE_RATE);
export const TARGET_FRAMES = Math.round(1.4 * SAMPLE_RATE);
/** Where the target starts when an A is played first. The A's release ends inside the gap. */
export const TARGET_AT = REFERENCE_FRAMES + GAP_FRAMES;

export const VOICE_SLOT: Record<'bass' | 'guitar', StemName> = { bass: 'bass', guitar: 'other' };

function voice(kind: 'bass' | 'guitar', midi: number, frames: number): Float32Array {
  // The pluck's noise is seeded by the pitch, so a replay sounds the same.
  return kind === 'bass' ? bassNote(midi, frames) : pluckNote(midi, frames, midi);
}

export function renderGuess(kind: 'bass' | 'guitar', target: number, reference: number | null): StemChannels[] {
  const at = reference === null ? 0 : TARGET_AT;
  const note = voice(kind, target, TARGET_FRAMES);
  const mono = new Float32Array(at + note.length);
  if (reference !== null) mono.set(voice(kind, reference, REFERENCE_FRAMES), 0);
  mono.set(note, at);
  // Each channel its own buffer: the engine transfers them to the worklet.
  return STEM_ORDER.map((name) =>
    name === VOICE_SLOT[kind]
      ? { left: mono, right: mono.slice() }
      : { left: new Float32Array(mono.length), right: new Float32Array(mono.length) },
  );
}
```

- [ ] **Step 4: Run them and see them pass**

Run: `npm --prefix frontend test -- --run src/theory/audio/guessRender.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/theory/audio
git commit -m "feat(theory): render a guess-the-note question as engine stems (D-23)"
```

---

### Task 4: One engine per visit (`useGuessSound.ts`)

**Files:**
- Create: `frontend/src/theory/useGuessSound.ts`
- Test: `frontend/src/theory/useGuessSound.test.tsx`

**Interfaces:**
- Consumes: `EngineController.createFromStems(stems)`, `.replaceStems`, `.seek`, `.play`, `.pause`, `.onEnded`, `.dispose` (`engine/EngineController.ts`, imported lazily as in `usePracticeSession.ts`, because its SoundTouch node needs AudioWorklet at import time); `sampleIndex` (`engine/types.ts`).
- Produces:
  - `interface GuessEngine { replaceStems(s: readonly StemChannels[]): void; seek(p: SampleIndex): void; play(): Promise<void>; pause(): void; onEnded(cb: () => void): () => void; dispose(): Promise<void> }`
  - `guessEngine: { create(stems: readonly StemChannels[]): Promise<GuessEngine> }`, the seam tests spy on
  - `useGuessSound(): { play(stems: readonly StemChannels[]): Promise<void>; replay(): Promise<void>; playing: boolean; error: string | null }`

- [ ] **Step 1: Write the failing tests**

```tsx
import { act, renderHook } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';

import type { StemChannels } from '../engine/loopCursor';
import { fakeEngine } from './tools/testing';
import { guessEngine, useGuessSound } from './useGuessSound';

afterEach(() => vi.restoreAllMocks());

const stems = (n = 4): StemChannels[] => Array.from({ length: 4 }, () => ({ left: new Float32Array(n), right: new Float32Array(n) }));

test('the first play creates the engine with those stems; later plays swap stems into the same engine', async () => {
  const e = fakeEngine();
  const create = vi.spyOn(guessEngine, 'create').mockResolvedValue(e);
  const { result } = renderHook(() => useGuessSound());
  const first = stems(1);
  await act(() => result.current.play(first));
  expect(create).toHaveBeenCalledWith(first);
  expect(e.replaceStems).not.toHaveBeenCalled();
  expect(e.play).toHaveBeenCalledTimes(1);
  expect(result.current.playing).toBe(true);
  const second = stems(2);
  await act(() => result.current.play(second));
  expect(create).toHaveBeenCalledTimes(1);
  expect(e.replaceStems).toHaveBeenCalledWith(second);
  expect(e.play).toHaveBeenCalledTimes(2);
});

test('the engine ending stops "playing"; replay plays the same stems from the top', async () => {
  const e = fakeEngine();
  vi.spyOn(guessEngine, 'create').mockResolvedValue(e);
  const { result } = renderHook(() => useGuessSound());
  await act(() => result.current.play(stems()));
  act(() => e.end());
  expect(result.current.playing).toBe(false);
  await act(() => result.current.replay());
  expect(e.seek).toHaveBeenLastCalledWith(0);
  expect(e.replaceStems).not.toHaveBeenCalled();
  expect(result.current.playing).toBe(true);
});

test('an engine that cannot start is the error, word for word, and a later play tries again', async () => {
  vi.spyOn(guessEngine, 'create').mockRejectedValueOnce(new Error("The browser's audio runs at 44100 Hz"));
  const { result } = renderHook(() => useGuessSound());
  await act(() => result.current.play(stems()));
  expect(result.current.error).toBe("The browser's audio runs at 44100 Hz");
  expect(result.current.playing).toBe(false);
  const e = fakeEngine();
  vi.spyOn(guessEngine, 'create').mockResolvedValue(e);
  await act(() => result.current.play(stems()));
  expect(result.current.error).toBeNull();
});

test('leaving the tool disposes the engine', async () => {
  const e = fakeEngine();
  vi.spyOn(guessEngine, 'create').mockResolvedValue(e);
  const { result, unmount } = renderHook(() => useGuessSound());
  await act(() => result.current.play(stems()));
  unmount();
  expect(e.dispose).toHaveBeenCalled();
});
```

Add the fake engine to `frontend/src/theory/tools/testing.tsx`, so Task 5 can use it too (also import `GuessEngine` from `'../useGuessSound'` there):

```tsx
/** A GuessEngine that records calls; `end()` fires its ended listener as the worklet would. */
export function fakeEngine() {
  let ended = () => {};
  const e = {
    replaceStems: vi.fn(),
    seek: vi.fn(),
    play: vi.fn(async () => {}),
    pause: vi.fn(),
    onEnded: vi.fn((cb: () => void) => {
      ended = cb;
      return () => {};
    }),
    dispose: vi.fn(async () => {}),
    end: () => ended(),
  };
  return e satisfies GuessEngine & { end(): void };
}
```

- [ ] **Step 2: Run them and see them fail**

Run: `npm --prefix frontend test -- --run src/theory/useGuessSound.test.tsx`
Expected: FAIL, module not found

- [ ] **Step 3: Implement**

```ts
// Guess the note's playback (D-23): one engine for the visit, as Practice does
// (D-22), so the Theory tab gets no second audio path or clock. The first play
// creates it with the question's stems (inside the click that asked for sound, so
// the browser lets the context start); each later question swaps its stems in.
// An engine that cannot start is the error, as it is (N-08).
import { useCallback, useEffect, useRef, useState } from 'react';

import type { StemChannels } from '../engine/loopCursor';
import { sampleIndex, type SampleIndex } from '../engine/types';

export interface GuessEngine {
  replaceStems(stems: readonly StemChannels[]): void;
  seek(position: SampleIndex): void;
  play(): Promise<void>;
  pause(): void;
  onEnded(cb: () => void): () => void;
  dispose(): Promise<void>;
}

// Imported on first use: the engine's SoundTouch node extends AudioWorkletNode at import time, which jsdom lacks.
export const guessEngine = {
  async create(stems: readonly StemChannels[]): Promise<GuessEngine> {
    const { EngineController } = await import('../engine/EngineController');
    return EngineController.createFromStems(stems);
  },
};

export function useGuessSound() {
  const engine = useRef<GuessEngine | null>(null);
  const creating = useRef<Promise<GuessEngine> | null>(null);
  const gone = useRef(false);
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const start = async (e: GuessEngine) => {
    e.seek(sampleIndex(0));
    setPlaying(true);
    await e.play();
  };

  const play = useCallback(async (stems: readonly StemChannels[]) => {
    try {
      // The play that creates the engine hands it these stems; one that arrives while it is being created swaps them in.
      const fresh = creating.current === null;
      creating.current ??= guessEngine.create(stems).then((e) => {
        e.onEnded(() => setPlaying(false));
        if (gone.current) void e.dispose();
        else engine.current = e;
        return e;
      });
      const e = await creating.current;
      if (gone.current) return;
      if (!fresh) e.replaceStems(stems);
      await start(e);
      setError(null);
    } catch (err) {
      creating.current = null;
      setPlaying(false);
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  const replay = useCallback(async () => {
    const e = engine.current;
    if (!e) return;
    e.pause();
    await start(e);
  }, []);

  useEffect(
    () => () => {
      gone.current = true;
      void engine.current?.dispose();
      engine.current = null;
    },
    [],
  );

  return { play, replay, playing, error };
}
```

- [ ] **Step 4: Run them and see them pass**

Run: `npm --prefix frontend test -- --run src/theory/useGuessSound.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/theory/useGuessSound.ts frontend/src/theory/useGuessSound.test.tsx frontend/src/theory/tools/testing.tsx
git commit -m "feat(theory): one engine per visit plays guess-the-note questions (D-23)"
```

---

### Task 5: The Guess the note screen

**Files:**
- Create: `frontend/src/theory/FocusControls.tsx` (taken out of `FretboardQuiz.tsx`)
- Modify: `frontend/src/theory/tools/FretboardQuiz.tsx` (use it)
- Create: `frontend/src/theory/tools/GuessNote.tsx`
- Modify: `frontend/src/theory/tools.ts` (register it)
- Test: `frontend/src/theory/tools/guessNote.test.tsx`

**Interfaces:**
- Consumes: everything from Tasks 1–4; `TheoryNeck` (`dots`, `onPick`, `frets`, `label`, `NeckDot` markers `'wrong'`); `NotePicker({ label, selected, onPick })`; `NOTE_KEYS` (exported from `FretboardQuiz.tsx`); `useQuizHistory`, `useQuizRng`, `quizKey`, `seeds` (`useQuizHistory.ts`); `StartFresh`, `HelpBox`, `ToolHeader`, `Segmented`, `Button`, `Chip`, `Panel`; `renderTool`, `fakeEngine` (`tools/testing.tsx`).
- Produces: `FocusControls({ inst, focus, onChange })`, where `focus: { strings: number[]; frets: [number, number]; accidentals: boolean }` and `onChange(patch: Partial<typeof focus>)`; the `GuessNote` component; the `/theory/guess-note` route through `TOOLS`.

- [ ] **Step 1: Take the focus row out into `FocusControls`, a refactor with the existing tests as the safety net**

Move the `practise` row out of `FretboardQuiz.tsx` unchanged into `theory/FocusControls.tsx`: `lowTwo`, `stringsValue`, `lowNames`, `fretOptions`, the three `Segmented` controls and the `sameSet` helper. Pass in `inst`, `focus` and `onChange`, and compute `rows` and `frets` inside with `inst.tuning.length` and `neckFrets(inst)`:

```tsx
// The "practise" row both fretboard quizzes share: which strings, which frets,
// naturals or all notes. The values are saved per quiz; this only draws them.
import type { Instrument } from '../music/tuning';
import { neckFrets } from '../music/tuning';
import { pretty } from '../music/spell';
import { Segmented } from '../ui';
import styles from './Theory.module.css';

export interface Focus {
  strings: number[];
  frets: [number, number];
  accidentals: boolean;
}

const sameSet = (a: readonly number[], b: readonly number[]) => a.length === b.length && a.every((x) => b.includes(x));

export function FocusControls({ inst, focus, onChange }: { inst: Instrument; focus: Focus; onChange: (patch: Partial<Focus>) => void }) {
  const rows = inst.tuning.length;
  const frets = neckFrets(inst);
  // … the body moved verbatim from FretboardQuiz: lowTwo, stringsValue, lowNames, fretOptions and the <div className={styles.row}> with its three Segmented …
}
```

In `FretboardQuiz.tsx`, replace the row with `<FocusControls inst={inst} focus={focus} onChange={setSettings} />`, and delete the moved locals and `sameSet` if nothing else uses them.

Run: `npm --prefix frontend test -- --run src/theory/tools/fretboardQuiz.test.tsx`
Expected: PASS, unchanged. Commit:

```bash
git add frontend/src/theory/FocusControls.tsx frontend/src/theory/tools/FretboardQuiz.tsx
git commit -m "refactor(theory): the quiz focus row is its own component"
```

- [ ] **Step 2: Write the failing screen tests** (`guessNote.test.tsx`)

```tsx
import { act, cleanup, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import { DEFAULT_THEORY, type TheoryDoc } from '../../api/client';
import { positionAt, type Cell } from '../../music/positions';
import { DEFAULT_INSTRUMENT } from '../../music/tuning';
import * as render from '../audio/guessRender';
import { forgetUnsavedTheory } from '../TheoryDoc';
import { guessEngine } from '../useGuessSound';
import { seeds } from '../useQuizHistory';
import { fakeEngine, renderTool } from './testing';

afterEach(() => {
  cleanup();
  forgetUnsavedTheory();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

let engine: ReturnType<typeof fakeEngine>;
let create: ReturnType<typeof vi.spyOn>;
let rendered: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.spyOn(seeds, 'next').mockReturnValue(20261003);
  engine = fakeEngine();
  create = vi.spyOn(guessEngine, 'create').mockResolvedValue(engine);
  rendered = vi.spyOn(render, 'renderGuess');
});

const KEYS = ['C', 'C♯/D♭', 'D', 'E♭', 'E', 'F', 'F♯/G♭', 'G', 'A♭', 'A', 'B♭', 'B'];
const STRING = ['G', 'D', 'A', 'E'];
const ear = (settings: Partial<TheoryDoc['quiz']['settings']['ear']> = {}): Partial<TheoryDoc> => ({
  last_tool: 'guess-note',
  quiz: { ...DEFAULT_THEORY.quiz, settings: { ...DEFAULT_THEORY.quiz.settings, ear: { ...DEFAULT_THEORY.quiz.settings.ear, ...settings } } },
});

const target = () => rendered.mock.calls.at(-1)![1] as number;
const reference = () => rendered.mock.calls.at(-1)![2] as number | null;
const play = async () => {
  fireEvent.click(await screen.findByRole('button', { name: '▶ Play' }));
  await act(async () => {});
};
const answers = () => within(screen.getByRole('group', { name: 'Answer' }));
const tap = (c: Cell) => fireEvent.click(screen.getByRole('button', { name: `${STRING[c.string]} string, ${c.fret === 0 ? 'open' : `fret ${c.fret}`}` }));
const cellsOf = (midi: number): Cell[] =>
  [0, 1, 2, 3].flatMap((string) => Array.from({ length: 13 }, (_, fret) => ({ string, fret }))).filter((c) => positionAt(DEFAULT_INSTRUMENT, c).midi === midi);

test('nothing sounds until Play; then the question plays with an A first, and the next ones play by themselves', async () => {
  renderTool('/theory/guess-note', { theory: ear() });
  expect(await screen.findByText('A, then which note?')).toBeInTheDocument();
  expect(create).not.toHaveBeenCalled();
  await play();
  expect(create).toHaveBeenCalledTimes(1);
  expect(reference()).not.toBeNull();
  fireEvent.click(answers().getByRole('button', { name: KEYS[target() % 12]! }));
  await act(async () => {});
  expect(engine.replaceStems).toHaveBeenCalledTimes(1);
  expect(screen.getByText(/^That was /)).toBeInTheDocument();
});

test('a wrong name is explained and the question stays; only the first try is recorded', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  const { puts } = renderTool('/theory/guess-note', { theory: ear() });
  await play();
  const t = target();
  fireEvent.click(answers().getByRole('button', { name: KEYS[(t + 1) % 12]! }));
  expect(screen.getByRole('status')).toHaveTextContent('✕ not');
  expect(target()).toBe(t);
  fireEvent.click(answers().getByRole('button', { name: KEYS[t % 12]! }));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(600);
  });
  expect(puts.at(-1)!.quiz.history.at(-1)).toMatchObject({ quiz: 'ear', mode: 'name/a', item: `m${t}`, correct: false });
});

test('on the neck, every cell with the exact pitch is right, and an octave off is said', async () => {
  renderTool('/theory/guess-note', { theory: ear({ answer: 'neck', reference: 'none' }) });
  expect(await screen.findByText('Which note?')).toBeInTheDocument();
  await play();
  expect(reference()).toBeNull();
  const t = target();
  const octave = cellsOf(t + 12)[0] ?? cellsOf(t - 12)[0];
  if (octave) {
    tap(octave);
    expect(screen.getByRole('status')).toHaveTextContent('✕ right note, an octave too');
  }
  const right = cellsOf(t);
  tap(right[right.length - 1]!);
  await act(async () => {});
  expect(screen.getByText(/^That was /)).toBeInTheDocument();
});

test('Space plays the question again without answering it', async () => {
  renderTool('/theory/guess-note', { theory: ear() });
  await play();
  const t = target();
  fireEvent.keyDown(window, { key: ' ' });
  await act(async () => {});
  expect(engine.play).toHaveBeenCalledTimes(2);
  expect(target()).toBe(t);
});

test('the digit keys answer in name mode', async () => {
  renderTool('/theory/guess-note', { theory: ear() });
  await play();
  const t = target();
  fireEvent.keyDown(window, { key: ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '-', '='][t % 12]! });
  await act(async () => {});
  expect(screen.getByText(/^That was /)).toBeInTheDocument();
});

test('an engine that cannot start is shown as it is, and no answer is offered', async () => {
  create.mockRejectedValue(new Error("The browser's audio runs at 44100 Hz and would not switch to 48000 Hz"));
  renderTool('/theory/guess-note', { theory: ear() });
  await play();
  expect(screen.getByRole('alert')).toHaveTextContent("Can't play the note: The browser's audio runs at 44100 Hz");
  expect(screen.queryByRole('group', { name: 'Answer' })).toBeNull();
});

test('the answer and reference settings are saved', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  const { puts } = renderTool('/theory/guess-note', { theory: ear() });
  await screen.findByText('A, then which note?');
  fireEvent.click(screen.getByRole('button', { name: 'On the neck' }));
  fireEvent.click(screen.getByRole('button', { name: 'No reference' }));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(600);
  });
  expect(puts.at(-1)!.quiz.settings.ear).toMatchObject({ answer: 'neck', reference: 'none' });
});

test('a focus with nothing in it says so and offers to widen it', async () => {
  renderTool('/theory/guess-note', { theory: ear({ strings: [9] }) });
  expect(await screen.findByRole('alert')).toHaveTextContent('No notes to ask about.');
  expect(screen.getByRole('button', { name: 'Widen the focus' })).toBeInTheDocument();
});

test('the ear focus follows a change of instrument', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  const { puts } = renderTool('/theory/guess-note', { theory: ear({ strings: [3, 2] }) });
  await screen.findByText('A, then which note?');
  fireEvent.change(screen.getByRole('combobox', { name: 'Instrument' }), { target: { value: 'guitar6' } });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(600);
  });
  expect(puts.at(-1)!.quiz.settings.ear.strings).toEqual([5, 4]);
});
```

The test sees which note was asked by spying on `renderGuess`, so the screen exposes nothing extra for tests. Because a spy on an ES module export only works if `GuessNote.tsx` calls `renderGuess` through the module namespace, import it there as `import * as guessAudio from '../audio/guessRender'` and call `guessAudio.renderGuess(...)`, with a one-line comment saying why.

- [ ] **Step 3: Run them and see them fail**

Run: `npm --prefix frontend test -- --run src/theory/tools/guessNote.test.tsx`
Expected: FAIL. `/theory/guess-note` is not a route yet.

- [ ] **Step 4: Implement `GuessNote.tsx`**

```tsx
// Guess the note (D-23): a note is played in the instrument's voice, an A first
// unless the reference is off, and the player names it or finds it on the neck.
// Relaxed practice like the other quizzes: no score, rounds, streaks or clocks;
// a wrong answer is explained and the question stays; replays are free. Nothing
// sounds before Play (browsers need a gesture); after it, each question plays by
// itself. Without sound there is no quiz: the engine's error is shown (N-08).
import { useEffect, useRef, useState } from 'react';

import { DEFAULT_THEORY, type EarQuizSettings, type QuizAnswer } from '../../api/client';
import { earQuestion, judgeName, judgeNeck, pitchLabel, type EarQuestion } from '../../music/earQuiz';
import type { Cell } from '../../music/positions';
import { positionAt } from '../../music/positions';
import { focusFrets, QuizFocusError } from '../../music/quiz';
import { neckFrets } from '../../music/tuning';
import { Button, Chip, Panel, Segmented } from '../../ui';
// A namespace import so a test can spy on renderGuess to learn which note was asked.
import * as guessAudio from '../audio/guessRender';
import { HelpBox, NotePicker, ToolHeader } from '../controls';
import { FocusControls } from '../FocusControls';
import { StartFresh } from '../StartFresh';
import styles from '../Theory.module.css';
import { TheoryNeck, type NeckDot } from '../TheoryNeck';
import { useTheoryDoc } from '../TheoryDoc';
import { useGuessSound } from '../useGuessSound';
import { quizKey, useQuizHistory, useQuizRng } from '../useQuizHistory';
import { NOTE_KEYS } from './FretboardQuiz';

const ANSWERS = [
  { value: 'name', label: 'Name it' },
  { value: 'neck', label: 'On the neck' },
] as const;
const REFERENCES = [
  { value: 'a', label: 'A first' },
  { value: 'none', label: 'No reference' },
] as const;

const HELP: Record<EarQuizSettings['answer'], string> = {
  name: 'Listen, then name the note with the buttons or the keys 1–9, 0, - and = for C … B. Any octave counts. Space plays it again as often as you like; only your first answer is remembered, to bring tricky notes back a little more often.',
  neck: 'Listen, then tap where the note is. It must be the same pitch, not just the same name, but any string will do. Space plays it again as often as you like.',
};

interface Attempt {
  q: EarQuestion;
  failed: boolean;
  wrong: Cell[];
  feedback: string | null;
}

interface Problem {
  kind: 'focus' | 'other';
  message: string;
}

export function GuessNote() {
  const { doc, update } = useTheoryDoc();
  const inst = doc?.instrument ?? DEFAULT_THEORY.instrument;
  const settings = doc?.quiz.settings.ear ?? DEFAULT_THEORY.quiz.settings.ear;
  const practice = useQuizHistory();
  const rng = useQuizRng();
  const sound = useGuessSound();
  // Whether the player has pressed Play: until then nothing may sound, and nothing can be answered.
  const armedRef = useRef(false);
  const [armed, setArmed] = useState(false);
  const attemptRef = useRef<Attempt | null>(null);
  const [attempt, setAttemptState] = useState<Attempt | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [last, setLast] = useState<number | null>(null);
  const lastItem = useRef<string | undefined>(undefined);
  const setAttempt = (a: Attempt | null) => {
    attemptRef.current = a;
    setAttemptState(a);
  };

  const focus = { strings: settings.strings, frets: settings.frets, accidentals: settings.accidentals };
  const [, hi] = focusFrets(inst, focus);

  const say = (q: EarQuestion) => void sound.play(guessAudio.renderGuess(inst.kind, q.midi, q.reference));

  const draw = (extra: readonly QuizAnswer[]) => {
    try {
      const q = earQuestion(settings.answer, settings.reference, inst, focus, [...practice.history, ...extra], rng, lastItem.current);
      lastItem.current = q.item;
      setProblem(null);
      setAttempt({ q, failed: false, wrong: [], feedback: null });
      if (armedRef.current) say(q);
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      const kind = error instanceof QuizFocusError ? 'focus' : 'other';
      if (kind === 'other') console.error(error);
      setAttempt(null);
      setProblem({ kind, message: error.message });
    }
  };

  const focusKey = [doc !== null, settings.answer, settings.reference, settings.strings.join(), settings.frets.join(), settings.accidentals, inst.kind, inst.tuning.join()].join('|');
  useEffect(() => {
    setLast(null);
    if (doc) draw([]);
    else {
      setAttempt(null);
      setProblem(null);
    }
    // Keyed on the focus alone, as in the Fretboard quiz.
  }, [focusKey]);

  const setSettings = (patch: Partial<EarQuizSettings>) => {
    if ((Object.keys(patch) as (keyof EarQuizSettings)[]).every((k) => JSON.stringify(patch[k]) === JSON.stringify(settings[k]))) return;
    update((d) => ({
      ...d,
      quiz: { ...d.quiz, settings: { ...d.quiz.settings, ear: { ...(d.quiz.settings.ear ?? DEFAULT_THEORY.quiz.settings.ear), ...patch } } },
    }));
  };

  const start = () => {
    armedRef.current = true;
    setArmed(true);
    if (attemptRef.current) say(attemptRef.current.q);
  };
  const again = () => (armedRef.current ? void sound.replay() : start());

  const finish = (a: Attempt) => {
    setAttempt(null);
    const stored = practice.record({ quiz: 'ear', mode: a.q.mode, item: a.q.item, correct: !a.failed });
    setLast(a.q.midi);
    draw([stored]);
  };

  const answerName = (pc: number) => {
    const a = attemptRef.current;
    if (!doc || !a || !armedRef.current || settings.answer !== 'name') return;
    const feedback = judgeName(a.q.midi, pc);
    if (feedback === null) finish(a);
    else setAttempt({ ...a, failed: true, feedback });
  };

  const tap = (cell: Cell) => {
    const a = attemptRef.current;
    if (!doc || !a || !armedRef.current || settings.answer !== 'neck') return;
    const feedback = judgeNeck(a.q.midi, positionAt(inst, cell).midi);
    if (feedback === null) return finish(a);
    const known = a.wrong.some((w) => w.string === cell.string && w.fret === cell.fret);
    setAttempt({ ...a, failed: true, wrong: known ? a.wrong : [...a.wrong, cell], feedback });
  };

  // Space replays in both modes; the note keys answer in name mode. Shift is let through for the digits (as in the Fretboard quiz).
  const onKey = useRef<(e: KeyboardEvent) => void>(() => {});
  onKey.current = (e) => {
    const key = quizKey(e, { shift: true });
    if (key === ' ') {
      e.preventDefault(); // not a page scroll
      again();
      return;
    }
    const pc = key === null ? -1 : NOTE_KEYS.indexOf(key);
    if (pc >= 0) answerName(pc);
  };
  useEffect(() => {
    const listener = (e: KeyboardEvent) => onKey.current(e);
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, []);

  const widen = () => setSettings({ strings: [], frets: [0, neckFrets(inst)], accidentals: true });

  const header = (
    <ToolHeader title="Guess the note">
      {doc && <Segmented label="Answer" value={settings.answer} onChange={(answer) => setSettings({ answer })} options={ANSWERS} />}
    </ToolHeader>
  );

  if (!doc) {
    return (
      <>
        {header}
        <p className={styles.errorText} role="alert">
          The quiz needs theory.json, which could not be read (see above), so it has nowhere to keep your place. Nothing was started.
        </p>
      </>
    );
  }

  const q = attempt?.q;
  const dots: NeckDot[] = (attempt?.wrong ?? []).map((c) => ({ ...c, label: '', marker: 'wrong' }));
  const prompt = settings.reference === 'a' ? 'A, then which note?' : 'Which note?';

  return (
    <>
      {header}
      {problem ? (
        <Panel className={styles.stack}>
          <p className={styles.errorText} role="alert">
            {problem.message}
          </p>
          <div className={styles.row}>{problem.kind === 'focus' && <Button onClick={widen}>Widen the focus</Button>}</div>
        </Panel>
      ) : sound.error ? (
        <p className={styles.errorText} role="alert">
          Can't play the note: {sound.error}
        </p>
      ) : (
        q && (
          <>
            <div className={styles.row}>
              <div className={styles.stack}>
                <span className={styles.big} aria-live="polite">
                  {prompt}
                </span>
                <span className={styles.dimText}>
                  {settings.answer === 'name' ? 'Space plays it again · keys 1–9, 0, - and = answer C … B' : 'Space plays it again · tap where it is'}
                </span>
                {last !== null && <span className={styles.dimText}>That was {pitchLabel(last)}</span>}
              </div>
              <Button onClick={again}>{armed ? (sound.playing ? 'Playing…' : '↻ Replay') : '▶ Play'}</Button>
            </div>
            {armed &&
              (settings.answer === 'neck' ? (
                <div className={styles.neck}>
                  <TheoryNeck instrument={inst} frets={Math.max(1, hi)} dots={dots} onPick={tap} label={prompt} />
                </div>
              ) : (
                <NotePicker label="Answer" selected={[]} onPick={answerName} />
              ))}
          </>
        )
      )}
      <div role="status">
        {attempt?.feedback && (
          <Chip tone="error" size="lg">
            {attempt.feedback}
          </Chip>
        )}
      </div>
      <FocusControls inst={inst} focus={focus} onChange={setSettings} />
      <div className={styles.row}>
        <span className={styles.cap}>reference</span>
        <Segmented label="Reference" value={settings.reference} onChange={(reference) => setSettings({ reference })} options={REFERENCES} />
      </div>
      <HelpBox>{HELP[settings.answer]}</HelpBox>
      <StartFresh onReset={practice.resetHistory} />
    </>
  );
}
```

The Play button's accessible name changes from `▶ Play` to `↻ Replay` (`Playing…` while it sounds), and the tests rely on that. `widen` is the Fretboard quiz's: every string, the whole neck, all notes.

- [ ] **Step 5: Register the tool** (`tools.ts`)

```ts
import { GuessNote } from './tools/GuessNote';
// …
  { slug: 'fretboard-quiz', label: 'Fretboard quiz', group: 'Practice', Component: FretboardQuiz },
  { slug: 'guess-note', label: 'Guess the note', group: 'Practice', Component: GuessNote },
  { slug: 'theory-quiz', label: 'Theory quiz', group: 'Practice', Component: TheoryQuiz },
```

- [ ] **Step 6: Run the new tests, then the whole frontend suite and the typecheck**

Run: `npm --prefix frontend test -- --run src/theory/tools/guessNote.test.tsx`
Expected: PASS

Run: `npm --prefix frontend test -- --run && npm --prefix frontend run typecheck`
Expected: PASS. A test that lists the rail's tools (for example in `screens/Theory.test.tsx`) gets `Guess the note` added between `Fretboard quiz` and `Theory quiz`.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/theory
git commit -m "feat(theory): Guess the note, a third quiz that plays the note (D-23)"
```

---

### Task 6: Verify by ear, docs, README, push

**Files:**
- Modify: `design/tech-spec-stemcraft.md` (add D-23 after D-22)
- Modify: `design/domain-spec.md`, `design/ui-spec.md` (the Theory sections: the third quiz)
- Modify: `docs/superpowers/specs/2026-09-29-music-theory-design.md` (the Sound non-goal now points to the guess-the-note spec)
- Modify: `docs/superpowers/specs/2026-10-03-guess-the-note-design.md` (Status: implemented)
- Modify: `README.md`; Create: `docs/screenshots/theory-guess-note.png`

> The working tree had unrelated uncommitted edits to `README.md` and `design/*` when this plan was written. Before editing those files, run `git status` and `git diff` on them. Stage only your own hunks (`git add -p`), and do not commit someone else's work in progress.

- [ ] **Step 1: Verify by ear in the browser**

Start the app with the `dev-setup` skill (API + Vite; the worker is not needed). Open `/theory/guess-note` and check:
1. Nothing sounds before **▶ Play**. After it, you hear an A, a gap, and then the note, with no click at the start or the end.
2. A right answer plays the next question at once, and "That was …" names the previous one.
3. **No reference** plays only the note.
4. Switch the instrument to guitar: you hear the plucked voice, and the neck answer accepts the same pitch on two different strings.
5. Space replays, and it does not scroll the page.

Take a screenshot of the neck mode with one wrong tap marked, and save it as `docs/screenshots/theory-guess-note.png`.

- [ ] **Step 2: Record D-23** in `design/tech-spec-stemcraft.md` after D-22, in the same format:

```markdown
- **D-23 — Ear training (Guess the note) renders each question in the browser and plays it through the existing engine.**
  - *Because:* the Theory spec deferred sound until it was clear how a second audio source would coexist with the engine. D-22 answered that: render offline at 48 kHz into stem-shaped buffers and hand them to one `EngineController` per visit. A question is one short buffer (an A, a gap, the target) in Practice's own bass or guitar voice, swapped in with `replaceStems`.
  - *Rejected:* an `AudioBufferSourceNode` or oscillator on its own `AudioContext` (a second audio path beside the engine, which the Theory spec said not to add without a design); sampled instruments (assets to ship and license, for a sound the synths already make); naming without a reference by default (absolute pitch, which most adults never learn; it stays available as a setting).
  - *Reversibility:* two-way. `quiz.settings.ear`, the `"ear"` quiz kind and the `guess-note` slug only add fields to `theory.json` v1.
```

- [ ] **Step 3: Update the specs and the README**

In `domain-spec.md` and `ui-spec.md`, add Guess the note next to the Fretboard and Theory quizzes: what it plays, the two answer modes, the reference setting, Play then autoplay, Space to replay. In the Theory design spec, change the **Sound** non-goal to: "Superseded for single notes by [Guess the note](2026-10-03-guess-the-note-design.md) (D-23). Interval, chord and melody ear training remain future work." In the README, add a feature bullet under Theory ("Guess the note: hear a note in bass or guitar voice, after a reference A or cold, and name it or find it on the neck") and the screenshot.

- [ ] **Step 4: Run every check once**

Run: `uv run pytest -q && npm --prefix frontend test -- --run && npm --prefix frontend run typecheck && npm --prefix frontend run build`
Expected: all PASS

- [ ] **Step 5: Commit and push** (standing authorization, `main` only, never forced)

```bash
git add -p README.md design/tech-spec-stemcraft.md design/domain-spec.md design/ui-spec.md
git add docs/screenshots/theory-guess-note.png docs/superpowers/specs/2026-09-29-music-theory-design.md docs/superpowers/specs/2026-10-03-guess-the-note-design.md
git commit -m "docs: Guess the note in the README and design docs (D-23)"
git push origin main
```
