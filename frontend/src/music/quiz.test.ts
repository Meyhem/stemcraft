import { Note } from 'tonal';
import { describe, expect, test } from 'vitest';

import {
  NothingToPractise,
  QuizFocusError,
  cellItem,
  cellKey,
  focusCells,
  focusFor,
  fretboardQuestion,
  mulberry32,
  nextTheoryQuestion,
  parseCellKey,
  pcAt,
  pickItem,
  plainName,
  restrict,
  shuffle,
  theoryItems,
  theoryQuestion,
  weakness,
  type Answer,
} from './quiz';
import { chordInfo } from './spell';
import { DEFAULT_INSTRUMENT, PRESETS, instrumentFor, neckFrets, type Instrument } from './tuning';

const bass4 = DEFAULT_INSTRUMENT;
const at = '2026-09-29T00:00:00Z';
const ans = (item: string, correct: boolean, ms: number, mode = 'name-note'): Answer => ({ quiz: 'fretboard', mode, item, correct, at });
/** A cell item of the default bass, written out rather than built with cellItem. */
const B = (cell: string) => `E1-A1-D2-G2/${cell}`;

describe('weighting', () => {
  test('never asked is weakest; weakness uses only the last five answers', () => {
    expect(weakness([], 'fretboard', 'name-note', 's0f1')).toBe(1);
    const history = [ans('s0f1', false, 9000), ...Array.from({ length: 5 }, () => ans('s0f1', true, 1500))];
    expect(weakness(history, 'fretboard', 'name-note', 's0f1')).toBe(0);
    expect(weakness([ans('s0f1', false, 6000)], 'fretboard', 'name-note', 's0f1')).toBe(1);
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

test('restrict keeps the listed items and refuses a list that matches none', () => {
  expect(restrict(['a', 'b', 'c'], ['b'])).toEqual(['b']);
  expect(() => restrict(['a', 'b'], ['z'])).toThrow(NothingToPractise);
  expect(restrict(['a', 'b'])).toEqual(['a', 'b']);
  expect(restrict(['a', 'b'], [])).toEqual(['a', 'b']);
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
    const allowed = new Set(focusCells(bass4, focus).map((c) => B(cellKey(c))));
    for (const mode of ['name-note', 'find-interval'] as const) {
      const q = fretboardQuestion(mode, bass4, focus, [], rng);
      expect(allowed.has(q.item)).toBe(true);
    }
  });

  test('only asks about the listed items', () => {
    const rng = mulberry32(4);
    for (let i = 0; i < 10; i++) expect(fretboardQuestion('name-note', bass4, focus, [], rng, undefined, [B('s2f7')]).item).toBe(B('s2f7'));
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

describe('cell items carry the tuning they were asked on', () => {
  const dropD: Instrument = { ...bass4, tuning: ['D1', 'A1', 'D2', 'G2'] };
  const focus = { strings: [], frets: [0, 12] as [number, number], accidentals: true };

  test('the item is the tuning, low string first, then the cell; a bare cell key still parses', () => {
    expect(cellItem(bass4, { string: 2, fret: 7 })).toBe('E1-A1-D2-G2/s2f7');
    expect(parseCellKey('E1-A1-D2-G2/s2f7')).toEqual({ string: 2, fret: 7 });
    expect(parseCellKey('s2f7')).toEqual({ string: 2, fret: 7 });
    expect(parseCellKey('E1-A1-D2-G2/n7')).toBeNull();
    expect(parseCellKey('/s2f7')).toBeNull();
  });

  test('name the note and find the interval ask under the tuning; find the note and spell the chord do not', () => {
    for (const mode of ['name-note', 'find-interval'] as const) {
      expect(fretboardQuestion(mode, dropD, focus, [], mulberry32(1)).item).toMatch(/^D1-A1-D2-G2\/s\df\d+$/);
    }
    expect(fretboardQuestion('find-note', dropD, focus, [], mulberry32(1)).item).toMatch(/^n\d+$/);
  });

  test('answers from another tuning, or from before items carried one, do not weigh a cell', () => {
    const wrong = (item: string) => Array.from({ length: 5 }, () => ans(item, false, 6000));
    const history = [...wrong('E1-A1-D2-G2/s3f3'), ...wrong('s3f5'), ...wrong('D1-A1-D2-G2/s3f1')];
    expect(weakness(history, 'fretboard', 'name-note', 'D1-A1-D2-G2/s3f3')).toBe(1); // never asked in drop D: unknown, so weak
  });

  test('a practise list from another tuning matches nothing here', () => {
    expect(() => fretboardQuestion('name-note', dropD, focus, [], mulberry32(3), undefined, ['E1-A1-D2-G2/s3f3'])).toThrow(NothingToPractise);
    expect(fretboardQuestion('name-note', dropD, focus, [], mulberry32(3), undefined, ['D1-A1-D2-G2/s3f3']).item).toBe('D1-A1-D2-G2/s3f3');
  });
});

describe('practise settings on another instrument', () => {
  const guitar = instrumentFor('guitar6', false);
  const bass5 = instrumentFor('bass5', false);
  const f = (strings: number[], frets: [number, number] = [0, 5]) => ({ mode: 'name-note' as const, strings, frets, accidentals: false });

  test('the low two strings stay the low two; rows the new instrument lacks become every string; others are kept', () => {
    expect(focusFor(f([3, 2]), bass4, guitar).strings).toEqual([5, 4]);
    expect(focusFor(f([2, 3]), bass4, bass5).strings).toEqual([4, 3]);
    expect(focusFor(f([5, 4]), guitar, bass4).strings).toEqual([3, 2]);
    expect(focusFor(f([5, 0]), guitar, bass4).strings).toEqual([]);
    expect(focusFor(f([0, 1]), guitar, bass4).strings).toEqual([0, 1]);
    expect(focusFor(f([]), guitar, bass4).strings).toEqual([]);
  });

  test('every fret stays every fret on the new neck; a narrower range is kept', () => {
    expect(focusFor(f([], [0, 17]), guitar, bass4).frets).toEqual([0, 15]);
    expect(focusFor(f([], [0, 15]), bass4, guitar).frets).toEqual([0, 17]);
    expect(focusFor(f([], [0, 12]), bass4, guitar).frets).toEqual([0, 12]);
  });

  test('a new tuning or left-handedness on the same instrument changes nothing', () => {
    const settings = f([3, 2], [0, 15]);
    expect(focusFor(settings, bass4, { ...bass4, tuning: ['D1', 'A1', 'D2', 'G2'], left_handed: true })).toBe(settings);
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

// ============================================================================
// Property checks. The oracles below are written from the spec and from
// semitone tables, not from quiz.ts, so a defect in the generators shows up here.
// ============================================================================

const LETTERS = 'CDEFGAB';
const LETTER_PC: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const NATURAL_PCS = [0, 2, 4, 5, 7, 9, 11];
const m12 = (n: number) => ((n % 12) + 12) % 12;

/** "B♭", "Bb", "F𝄪" -> its letter and pitch class, without tonal. */
function parseName(text: string): { letter: string; pc: number } {
  const m = /^([A-G])(.*)$/u.exec(text);
  if (!m) throw new Error(`not a note name: ${text}`);
  let pc = LETTER_PC[m[1]!]!;
  for (const ch of Array.from(m[2]!)) {
    const delta = { '♯': 1, '#': 1, '♭': -1, b: -1, '𝄪': 2, '𝄫': -2 }[ch];
    if (delta === undefined) throw new Error(`not a note name: ${text}`);
    pc += delta;
  }
  return { letter: m[1]!, pc: m12(pc) };
}

const letterAt = (letter: string, steps: number) => LETTERS[(LETTERS.indexOf(letter) + steps + 7 * 4) % 7]!;
const iota = (n: number) => Array.from({ length: n }, (_, i) => i);

describe('property: fretboard questions over every tuning and focus', () => {
  const instruments: [string, Instrument][] = [
    ...PRESETS.map((p): [string, Instrument] => [p.id, { kind: p.kind, strings: p.notes.length, tuning: [...p.notes], left_handed: false }]),
    ['bass4-left', { ...bass4, left_handed: true }],
    ['bass5-left', { kind: 'bass', strings: 5, tuning: ['B0', 'E1', 'A1', 'D2', 'G2'], left_handed: true }],
  ];
  const fretRanges: [number, number][] = [[0, 0], [0, 12], [12, 17], [3, 7], [0, 17], [16, 20], [5, 2], [14, 14]];
  const stringSets = (n: number): number[][] => [[], [0], [n - 1], [0, n - 1], [1, 0], [n], [0, 0]];

  const midiOf = (inst: Instrument, c: { string: number; fret: number }) =>
    Note.midi(inst.tuning[inst.tuning.length - 1 - c.string]!)! + c.fret;

  /** The cells the focus allows, from the spec: real rows x frets clamped to the neck, naturals unless accidentals. */
  function expectedCells(inst: Instrument, f: { strings: number[]; frets: [number, number]; accidentals: boolean }) {
    const rows = (f.strings.length ? f.strings : iota(inst.strings)).filter((s, i, all) => s >= 0 && s < inst.strings && all.indexOf(s) === i);
    const lo = Math.max(0, f.frets[0]);
    const hi = Math.min(neckFrets(inst), f.frets[1]);
    const out: { string: number; fret: number }[] = [];
    for (const string of rows) {
      for (let fret = lo; fret <= hi; fret++) {
        if (f.accidentals || NATURAL_PCS.includes(m12(midiOf(inst, { string, fret })))) out.push({ string, fret });
      }
    }
    return out;
  }

  const configs = instruments.flatMap(([name, inst]) =>
    stringSets(inst.strings).flatMap((strings) =>
      fretRanges.flatMap((frets) =>
        [false, true].map((accidentals) => ({ name, inst, focus: { strings, frets, accidentals } })),
      ),
    ),
  );
  const label = (c: (typeof configs)[number]) => `${c.name} strings=[${c.focus.strings}] frets=${c.focus.frets} acc=${c.focus.accidentals}`;

  test('focusCells matches the spec for the whole matrix (order: given strings, then frets ascending)', () => {
    for (const c of configs) {
      expect(focusCells(c.inst, c.focus).map(cellKey), label(c)).toEqual(expectedCells(c.inst, c.focus).map(cellKey));
    }
  });

  test('left-handed changes nothing about the rows', () => {
    const focus = { strings: [], frets: [0, 12] as [number, number], accidentals: true };
    expect(focusCells({ ...bass4, left_handed: true }, focus)).toEqual(focusCells(bass4, focus));
  });

  const focusError = (fn: () => unknown, problem: string, message: RegExp) => {
    let caught: unknown;
    try { fn(); } catch (e) { caught = e; }
    expect(caught).toBeInstanceOf(QuizFocusError);
    expect((caught as QuizFocusError).problem).toBe(problem);
    expect((caught as QuizFocusError).message).toMatch(message);
  };

  test('an unusable focus is a QuizFocusError whose message names the real cause', () => {
    const halfDown = { kind: 'bass', strings: 4, tuning: ['Eb1', 'Ab1', 'Db2', 'Gb2'], left_handed: false } as Instrument;
    const nothing = { strings: [], frets: [0, 0] as [number, number], accidentals: false };
    for (const mode of ['name-note', 'find-note', 'find-interval'] as const) {
      focusError(() => fretboardQuestion(mode, halfDown, nothing, [], mulberry32(1)), 'naturals', /Accidentals are off and no natural note/);
    }
    const q = (mode: 'name-note' | 'spell-chord' | 'find-interval', strings: number[], frets: [number, number]) => () =>
      fretboardQuestion(mode, bass4, { strings, frets, accidentals: true }, [], mulberry32(1));
    for (const mode of ['name-note', 'find-interval', 'spell-chord'] as const) {
      focusError(q(mode, [], [5, 2]), 'frets', /fret range is empty or reversed/);
      focusError(q(mode, [], [16, 20]), 'frets', /fret range is empty or reversed/);
      focusError(q(mode, [7], [0, 12]), 'strings', /No such string/);
    }
    // One cell has no second cell to be an interval from.
    focusError(q('find-interval', [0], [0, 0]), 'interval', /No interval can be asked/);
    // Rows that do not exist are dropped, the ones that do stay.
    expect(focusCells(bass4, { strings: [9, 2], frets: [0, 1], accidentals: true }).map(cellKey)).toEqual(['s2f0', 's2f1']);
  });

  const SEMITONES: Record<string, number> = { 'minor 3rd': 3, 'major 3rd': 4, '4th': 5, '5th': 7, '♭7': 10, octave: 12 };
  const TONES = { '': [0, 4, 7], m: [0, 3, 7] } as Record<string, number[]>;

  test('every mode is producible or explicitly refused, and every question is sound', () => {
    for (const c of configs) {
      const expected = expectedCells(c.inst, c.focus);
      const neck = neckFrets(c.inst);
      const lo = Math.max(0, c.focus.frets[0]);
      const hi = Math.min(neck, c.focus.frets[1]);
      const rows = (c.focus.strings.length ? c.focus.strings : iota(c.inst.strings)).filter((s, i, all) => s >= 0 && s < c.inst.strings && all.indexOf(s) === i);
      const pcOfCell = (cell: { string: number; fret: number }) => m12(midiOf(c.inst, cell));
      const inNeck = (cell: { string: number; fret: number }) =>
        Number.isInteger(cell.string) && Number.isInteger(cell.fret) && cell.string >= 0 && cell.string < c.inst.strings && cell.fret >= 0 && cell.fret <= neck;
      // Independent oracle for find-interval: an origin qualifies when some interval's pitch class is held by another focus cell.
      const targetsOfInterval = (origin: { string: number; fret: number }, semis: number) =>
        expected.filter((t) => cellKey(t) !== cellKey(origin) && pcOfCell(t) === m12(pcOfCell(origin) + semis));
      const qualifying = expected.filter((o) => Object.values(SEMITONES).some((semis) => targetsOfInterval(o, semis).length > 0));
      // Cell items from the spec: the tuning low string first, joined by '-', then the cell.
      const itemOf = (cell: { string: number; fret: number }) => `${c.inst.tuning.join('-')}/s${cell.string}f${cell.fret}`;
      for (const mode of ['name-note', 'find-note', 'find-interval', 'spell-chord'] as const) {
        const where0 = `${label(c)} ${mode}`;
        const problem =
          rows.length === 0 ? 'strings'
          : lo > hi ? 'frets'
          : mode === 'spell-chord' ? null
          : expected.length === 0 ? 'naturals'
          : mode === 'find-interval' && qualifying.length === 0 ? 'interval'
          : null;
        const rng = mulberry32(17);
        if (problem) {
          focusError(() => fretboardQuestion(mode, c.inst, c.focus, [], rng), problem, /^No notes to ask about\./);
          continue;
        }
        let previous: string | undefined;
        for (let n = 0; n < 6; n++) {
          const q = fretboardQuestion(mode, c.inst, c.focus, [], rng, previous);
          const where = where0;
          expect(q.prompt.includes('NaN') || q.prompt.includes('undefined'), where).toBe(false);
          if (q.mode === 'name-note' || q.mode === 'find-interval') {
            expect((q.mode === 'name-note' ? expected : qualifying).map(itemOf), where).toContain(q.item);
            expect(q.cell, where).toEqual(parseCellKey(q.item));
            expect(inNeck(q.cell), where).toBe(true);
            const pc = pcOfCell(q.cell);
            expect(pcAt(c.inst, q.cell), where).toBe(pc);
            if (q.mode === 'name-note') expect(q.answerPc, where).toBe(pc);
            else {
              const label_ = /^Tap the (.+) above this note$/.exec(q.prompt)?.[1];
              expect(SEMITONES[label_!], `${where} ${q.prompt}`).toBeDefined();
              expect(q.interval, where).toEqual({ label: label_, semitones: SEMITONES[label_!] });
              expect(q.answerPc, where).toBe(m12(pc + SEMITONES[label_!]!));
              const want = targetsOfInterval(q.cell, SEMITONES[label_!]!).map(cellKey);
              expect(want.length, where).toBeGreaterThan(0);
              expect(q.targets.map(cellKey).sort(), where).toEqual([...want].sort());
              expect(q.targets.map(cellKey), where).not.toContain(cellKey(q.cell));
              expect(q.targets.every((t) => pcOfCell(t) === q.answerPc && inNeck(t) && expected.some((e) => cellKey(e) === cellKey(t))), where).toBe(true);
            }
            expect(Number.isInteger(q.answerPc) && q.answerPc >= 0 && q.answerPc < 12, where).toBe(true);
          } else if (q.mode === 'find-note') {
            expect(q.item, where).toBe(`n${q.pc}`);
            expect(Number.isInteger(q.pc) && q.pc >= 0 && q.pc < 12, where).toBe(true);
            const want = expected.filter((cell) => pcOfCell(cell) === q.pc).map(cellKey);
            expect(want.length, where).toBeGreaterThan(0);
            expect(q.targets.map(cellKey).sort(), where).toEqual([...want].sort());
            expect(q.targets.every(inNeck), where).toBe(true);
          } else {
            expect(q.symbol, where).toBe(q.item);
            expect(chordInfo(q.symbol).ok, where).toBe(true);
            const [wLo, wHi] = q.window;
            expect(wLo >= lo && wHi <= hi && wLo <= wHi, `${where} window ${q.window}`).toBe(true);
            expect(wHi - wLo + 1, where).toBe(Math.min(4, hi - lo + 1));
            const m = /^([A-G])(m?)$/.exec(q.symbol)!;
            const tones = new Set(TONES[m[2]!]!.map((s) => m12(LETTER_PC[m[1]!]! + s)));
            // Only the focus rows, in the window; accidentals do not restrict a chord tone.
            const want = rows.flatMap((string) =>
              iota(wHi - wLo + 1).map((i) => ({ string, fret: wLo + i })).filter((cell) => tones.has(pcOfCell(cell))),
            );
            expect(want.length, where).toBeGreaterThan(0);
            expect(q.targets.map(cellKey).sort(), where).toEqual(want.map(cellKey).sort());
            expect(q.targets.every((t) => inNeck(t) && rows.includes(t.string)), where).toBe(true);
          }
          previous = q.item;
        }
      }
    }
  }, 60_000);

  test('find-interval: the octave is offered only when another cell holds the same pitch class', () => {
    const oneString = { strings: [3], frets: [0, 12] as [number, number], accidentals: false }; // E F G A B C D E: the two E's
    const seen = new Set<string>();
    for (let seed = 0; seed < 200; seed++) {
      const q = fretboardQuestion('find-interval', bass4, oneString, [], mulberry32(seed));
      if (q.mode !== 'find-interval') throw new Error('mode');
      seen.add(q.interval.label);
      if (q.interval.label === 'octave') {
        expect([B('s3f0'), B('s3f12')]).toContain(q.item);
        expect(q.targets.map(cellKey)).toEqual([q.item === B('s3f0') ? 's3f12' : 's3f0']);
        expect(q.targets.map(cellKey)).not.toContain(cellKey(q.cell));
      }
    }
    expect(seen.has('octave')).toBe(true);
    const short = { strings: [3], frets: [0, 7] as [number, number], accidentals: true }; // 8 semitones: no pitch class repeats
    for (let seed = 0; seed < 200; seed++) {
      const q = fretboardQuestion('find-interval', bass4, short, [], mulberry32(seed));
      if (q.mode !== 'find-interval') throw new Error('mode');
      expect(q.interval.label).not.toBe('octave');
      expect(q.targets.length).toBeGreaterThan(0);
    }
  });

  test('find-interval: an accidental answer is not asked when accidentals are off', () => {
    // Open E string, naturals, frets 0..1: E and F. A 3rd above E is G#/G, neither is in focus; nothing is answerable.
    focusError(
      () => fretboardQuestion('find-interval', bass4, { strings: [3], frets: [0, 1], accidentals: false }, [], mulberry32(1)),
      'interval',
      /No interval can be asked/,
    );
  });

  test('spell-chord: targets stay on the focus strings, and accidentals do not thin the chord', () => {
    const only3 = { strings: [3], frets: [0, 12] as [number, number], accidentals: false };
    for (let seed = 0; seed < 30; seed++) {
      const q = fretboardQuestion('spell-chord', bass4, only3, [], mulberry32(seed));
      if (q.mode !== 'spell-chord') throw new Error('mode');
      expect(q.targets.every((t) => t.string === 3)).toBe(true);
      expect(q.targets.length).toBeGreaterThan(0);
    }
    // Bm's F♯ is not a natural note, but with accidentals off it is still a chord tone. Window 0..3 of the E string has F♯ at fret 2.
    const q = fretboardQuestion('spell-chord', bass4, { strings: [3], frets: [0, 3], accidentals: false }, [], mulberry32(1), undefined, ['Bm']);
    if (q.mode !== 'spell-chord') throw new Error('mode');
    expect(q.targets.map(cellKey)).toEqual(['s3f2']);
    // A chord with no tone on the chosen strings in the window is not offered: on the open E string only chords holding E are.
    for (let seed = 0; seed < 30; seed++) {
      const r = fretboardQuestion('spell-chord', bass4, { strings: [3], frets: [0, 0], accidentals: true }, [], mulberry32(seed));
      if (r.mode !== 'spell-chord') throw new Error('mode');
      expect(r.targets).toEqual([{ string: 3, fret: 0 }]);
    }
  });

  test('never the same item twice in a row, in any mode', () => {
    const focus = { strings: [], frets: [0, 7] as [number, number], accidentals: false };
    for (const mode of ['name-note', 'find-note', 'find-interval', 'spell-chord'] as const) {
      const rng = mulberry32(31);
      let previous: string | undefined;
      for (let i = 0; i < 300; i++) {
        const q = fretboardQuestion(mode, bass4, focus, [], rng, previous);
        expect(q.item, mode).not.toBe(previous);
        previous = q.item;
      }
    }
  });

  test('a single possible item may repeat (there is nothing else to ask)', () => {
    const one = { strings: [0], frets: [0, 0] as [number, number], accidentals: true };
    const q = fretboardQuestion('name-note', bass4, one, [], mulberry32(1), B('s0f0'));
    expect(q.item).toBe(B('s0f0'));
  });

  test('the same seed gives the same question, whatever the mode', () => {
    for (const mode of ['name-note', 'find-note', 'find-interval', 'spell-chord'] as const) {
      const a = fretboardQuestion(mode, bass4, { strings: [], frets: [0, 12], accidentals: true }, [], mulberry32(77));
      const b = fretboardQuestion(mode, bass4, { strings: [], frets: [0, 12], accidentals: true }, [], mulberry32(77));
      expect(a).toEqual(b);
    }
  });

  test('only lists work in every mode; one that matches nothing is NothingToPractise, never another question', () => {
    const focus = { strings: [], frets: [0, 12] as [number, number], accidentals: false };
    for (let s = 0; s < 8; s++) {
      expect(fretboardQuestion('find-note', bass4, focus, [], mulberry32(s), undefined, ['n7']).item).toBe('n7');
      expect(fretboardQuestion('spell-chord', bass4, focus, [], mulberry32(s), undefined, ['Dm']).item).toBe('Dm');
      const iv = fretboardQuestion('find-interval', bass4, focus, [], mulberry32(s), undefined, [B('s2f7')]);
      expect(iv.item).toBe(B('s2f7'));
    }
    // n1 (C sharp) is not in a naturals-only focus; Zm is not a chord we ask; s0f99 is off the neck; s3f1x is not a cell.
    expect(() => fretboardQuestion('find-note', bass4, focus, [], mulberry32(3), undefined, ['n1'])).toThrow(NothingToPractise);
    expect(() => fretboardQuestion('spell-chord', bass4, focus, [], mulberry32(3), undefined, ['Zm'])).toThrow(NothingToPractise);
    expect(() => fretboardQuestion('name-note', bass4, focus, [], mulberry32(3), undefined, [B('s0f99')])).toThrow(NothingToPractise);
    expect(() => fretboardQuestion('name-note', bass4, focus, [], mulberry32(3), undefined, [B('s3f1x')])).toThrow(/normal round/);
    // A bare cell key (an answer from before items carried their tuning) is not an item any more.
    expect(() => fretboardQuestion('name-note', bass4, focus, [], mulberry32(3), undefined, ['s2f7'])).toThrow(NothingToPractise);
    // An origin that cannot be asked as an interval (its only target would be itself) does not count as in focus.
    const lone = { strings: [3], frets: [0, 12] as [number, number], accidentals: false };
    expect(() => fretboardQuestion('find-interval', bass4, lone, [], mulberry32(3), undefined, [B('s3f99')])).toThrow(NothingToPractise);
    // [] and undefined mean unrestricted.
    expect(fretboardQuestion('find-note', bass4, focus, [], mulberry32(3), undefined, []).item).toMatch(/^n\d+$/);
  });

  test('a weak cell is asked about more often (probability 0.15 + weakness)', () => {
    const focus = { strings: [3], frets: [0, 5] as [number, number], accidentals: false }; // s3f0 s3f1 s3f3 s3f5
    const strong = ['s3f0', 's3f1', 's3f5'].flatMap((k) => Array.from({ length: 5 }, () => ans(B(k), true, 0)));
    const history = [...strong, ...Array.from({ length: 5 }, () => ans(B('s3f3'), false, 6000))];
    const rng = mulberry32(2026);
    let weak = 0;
    for (let i = 0; i < 4000; i++) if (fretboardQuestion('name-note', bass4, focus, history, rng).item === B('s3f3')) weak++;
    expect(weak / 4000).toBeGreaterThan(1.15 / 1.6 - 0.03);
    expect(weak / 4000).toBeLessThan(1.15 / 1.6 + 0.03);
  });

  test('plainName covers all twelve pitch classes with players\' spellings', () => {
    expect(iota(12).map(plainName)).toEqual(['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'G#', 'A', 'Bb', 'B']);
    expect(plainName(-1)).toBe('B');
    expect(plainName(25)).toBe('C#');
  });
});

describe('property: theory questions for every item', () => {
  const KEY_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
  const CHORD_TONES: Record<string, number[]> = { '': [0, 4, 7], m: [0, 3, 7], '7': [0, 4, 7, 10], maj7: [0, 4, 7, 11], m7: [0, 3, 7, 10] };
  const CHORD_LETTER_STEPS = [0, 2, 4, 6];
  const IVL_SEMIS: Record<string, number> = { '2m': 1, '2M': 2, '3m': 3, '3M': 4, '4P': 5, '5d': 6, '5P': 7, '6m': 8, '6M': 9, '7m': 10, '7M': 11 };
  const LABEL_SEMIS: Record<string, number> = {
    'minor 2nd': 1, 'major 2nd': 2, 'minor 3rd': 3, 'major 3rd': 4, 'perfect 4th': 5, tritone: 6,
    'perfect 5th': 7, 'minor 6th': 8, 'major 6th': 9, 'minor 7th': 10, 'major 7th': 11,
  };
  const split = (chord: string) => {
    const m = /^([A-G][#b♯♭]?)(.*)$/u.exec(chord)!;
    return { root: m[1]!, quality: m[2]! };
  };
  const chordIdentity = (text: string) => {
    const { root, quality } = split(text);
    return `${parseName(root).pc}${quality}`;
  };

  const all = theoryItems(['keys', 'chords', 'intervals']);
  const seeds = [1, 2, 3];

  test('the item list is complete and unique', () => {
    expect(all).toHaveLength(233);
    expect(new Set(all).size).toBe(233);
    expect(theoryItems([])).toEqual([]);
    expect(theoryItems(['keys', 'chords'])).toHaveLength(156);
    expect(theoryItems(['keys']).every((i) => /^(v|rel|sig):/.test(i))).toBe(true);
    expect(theoryItems(['chords']).every((i) => /^(notes|name):/.test(i))).toBe(true);
    expect(theoryItems(['intervals']).every((i) => /^ivl:[A-G]:/.test(i))).toBe(true);
  });

  test('every item: four distinct options, a valid answer index, the item and topic echoed', () => {
    for (const item of all) {
      for (const seed of seeds) {
        const q = theoryQuestion(item, mulberry32(seed));
        expect(q.item).toBe(item);
        expect(q.topic).toBe(theoryItems(['keys']).includes(item) ? 'keys' : theoryItems(['chords']).includes(item) ? 'chords' : 'intervals');
        expect(q.options, item).toHaveLength(4);
        expect(new Set(q.options).size, item).toBe(4);
        expect(Number.isInteger(q.answer) && q.answer >= 0 && q.answer < 4, item).toBe(true);
        expect(q.options.every((o) => typeof o === 'string' && o.length > 0 && !o.includes('undefined') && !o.includes('NaN')), item).toBe(true);
      }
    }
  });

  test('the same seed gives the same question; the answer is right whatever the shuffle', () => {
    for (const item of all) {
      const a = theoryQuestion(item, mulberry32(5));
      expect(theoryQuestion(item, mulberry32(5))).toEqual(a);
      const rights = new Set(seeds.map((s) => { const q = theoryQuestion(item, mulberry32(s)); return q.options[q.answer]; }));
      expect(rights.size, item).toBe(1);
    }
  });

  test('V chord of the key: the right root and quality, spelled by letter; distractors are other chords', () => {
    for (const item of theoryItems(['keys']).filter((i) => i.startsWith('v:'))) {
      const key = parseName(item.slice(2));
      const q = theoryQuestion(item, mulberry32(4));
      expect(q.prompt).toBe(`What's the V chord in ${item.slice(2).replace('b', '♭').replace('#', '♯')} major?`);
      const right = q.options[q.answer]!;
      expect(right, item).toMatch(/^[A-G][♯♭]?$/u); // a major triad: no quality suffix
      const parsed = parseName(right);
      expect(parsed.pc, item).toBe(m12(key.pc + 7));
      expect(parsed.letter, item).toBe(letterAt(key.letter, 4));
      const identities = q.options.map((o) => {
        expect(o, `${item} ${o}`).toMatch(/^[A-G][♯♭]?m?$/u);
        return `${parseName(o.replace(/m$/, '')).pc}${o.endsWith('m') ? 'm' : ''}`;
      });
      expect(new Set(identities).size, `${item}: options must be pitch-distinct ${q.options}`).toBe(4);
      expect(identities.filter((id) => id === `${m12(key.pc + 7)}`)).toHaveLength(1);
    }
  });

  test('relative minor: three semitones down, letter two down; distractors are other minors', () => {
    for (const item of theoryItems(['keys']).filter((i) => i.startsWith('rel:'))) {
      const key = parseName(item.slice(4));
      const q = theoryQuestion(item, mulberry32(4));
      const roots = q.options.map((o) => {
        expect(o, item).toMatch(/^[A-G][♯♭]? minor$/u);
        return parseName(o.replace(' minor', ''));
      });
      expect(roots[q.answer]!.pc, item).toBe(m12(key.pc - 3));
      expect(roots[q.answer]!.letter, item).toBe(letterAt(key.letter, -2));
      expect(new Set(roots.map((r) => r.pc)).size, `${item}: ${q.options}`).toBe(4);
    }
  });

  test('key signature: circle-of-fifths count; distractors are other counts', () => {
    const text = (pc: number) => {
      const n = (7 * pc) % 12;
      if (n === 0) return 'no sharps or flats';
      const [count, kind] = n <= 6 ? [n, 'sharp'] : [12 - n, 'flat'];
      return `${count} ${kind}${count === 1 ? '' : 's'}`;
    };
    for (const item of theoryItems(['keys']).filter((i) => i.startsWith('sig:'))) {
      const q = theoryQuestion(item, mulberry32(4));
      expect(q.options[q.answer], item).toBe(text(parseName(item.slice(4)).pc));
      expect(q.options.filter((o) => o === text(parseName(item.slice(4)).pc))).toHaveLength(1);
    }
    expect(text(0)).toBe('no sharps or flats');
    expect(text(7)).toBe('1 sharp');
    expect(text(5)).toBe('1 flat');
  });

  test('notes of a chord: the right tones, letter-correct; every distractor is a different pitch set', () => {
    for (const item of theoryItems(['chords']).filter((i) => i.startsWith('notes:'))) {
      const { root, quality } = split(item.slice(6));
      const rootNote = parseName(root);
      const q = theoryQuestion(item, mulberry32(4));
      const tokens = q.options[q.answer]!.split(' ');
      const want = CHORD_TONES[quality]!;
      expect(tokens, item).toHaveLength(want.length);
      tokens.forEach((t, i) => {
        const n = parseName(t);
        expect(n.pc, `${item} ${t}`).toBe(m12(rootNote.pc + want[i]!));
        expect(n.letter, `${item} ${t}`).toBe(letterAt(rootNote.letter, CHORD_LETTER_STEPS[i]!));
      });
      const sets = q.options.map((o) => o.split(' ').map((t) => parseName(t).pc).join(','));
      expect(new Set(sets).size, `${item}: ${q.options}`).toBe(4);
      expect(sets.filter((s) => s === sets[q.answer])).toHaveLength(1);
      // Distractors are chords on the same root, so they are plausible.
      for (const s of sets) expect(s.split(',')[0], item).toBe(String(rootNote.pc));
    }
  });

  test('name these notes: the option whose tones are those notes is exactly the answer', () => {
    for (const item of theoryItems(['chords']).filter((i) => i.startsWith('name:'))) {
      const { root, quality } = split(item.slice(5));
      const q = theoryQuestion(item, mulberry32(4));
      const shown = /^Which chord is (.+)\?$/u.exec(q.prompt)![1]!.split(' ').map((t) => parseName(t).pc);
      expect(shown, item).toEqual(CHORD_TONES[quality]!.map((s) => m12(parseName(root).pc + s)));
      const sets = q.options.map((o) => {
        const p = split(o);
        expect(CHORD_TONES[p.quality], `${item} option ${o}`).toBeDefined();
        return CHORD_TONES[p.quality]!.map((s) => m12(parseName(p.root).pc + s)).sort((a, b) => a - b).join(',');
      });
      const target = [...shown].sort((a, b) => a - b).join(',');
      expect(sets.filter((s) => s === target), item).toHaveLength(1);
      expect(sets[q.answer], item).toBe(target);
      expect(new Set(sets).size, `${item}: ${q.options}`).toBe(4);
      expect(chordIdentity(q.options[q.answer]!), item).toBe(chordIdentity(item.slice(5)));
    }
  });

  test('intervals: the note named is the interval above the start, and the label is the right one', () => {
    for (const item of theoryItems(['intervals'])) {
      const [, from, name] = item.split(':') as [string, string, string];
      const q = theoryQuestion(item, mulberry32(4));
      const m = /^(.+) up to (.+) is a…$/u.exec(q.prompt)!;
      const start = parseName(m[1]!);
      const end = parseName(m[2]!);
      expect(start.pc, item).toBe(LETTER_PC[from]);
      expect(m12(end.pc - start.pc), item).toBe(IVL_SEMIS[name]);
      if (name !== '5d') expect((((LETTERS.indexOf(end.letter) - LETTERS.indexOf(start.letter)) % 7) + 7) % 7 + 1, item).toBe(Number(name[0]));
      const semis = q.options.map((o) => LABEL_SEMIS[o]);
      expect(semis.every((s) => s !== undefined), `${item}: ${q.options}`).toBe(true);
      expect(semis[q.answer], item).toBe(IVL_SEMIS[name]);
      expect(new Set(semis).size, item).toBe(4);
    }
  });

  test('an unknown or malformed item is refused loudly, not answered with a guess (N-08)', () => {
    for (const bad of ['', 'bogus', 'v:', 'v:H', 'v:C#', 'v:Gb', 'rel:Xyz', 'sig:', 'notes:Xyz', 'notes:', 'name:C13', 'name:H', 'ivl:C', 'ivl:C:9M', 'ivl:H:3M', 'ivl:C:8P', 's0f1']) {
      expect(() => theoryQuestion(bad, mulberry32(1)), bad).toThrow(/quiz item/i);
    }
  });

  test('next question: topics, only, previous and history weighting', () => {
    expect(() => nextTheoryQuestion([], [], mulberry32(1))).toThrow(/no quiz items/i);
    expect(() => nextTheoryQuestion(['keys'], [], mulberry32(1), undefined, ['notes:Cm'])).toThrow(NothingToPractise);
    expect(nextTheoryQuestion(['keys'], [], mulberry32(1), undefined, []).topic).toBe('keys');
    for (const topics of [['keys'], ['chords'], ['intervals'], ['keys', 'chords']] as const) {
      const rng = mulberry32(8);
      let previous: string | undefined;
      for (let i = 0; i < 60; i++) {
        const q = nextTheoryQuestion(topics, [], rng, previous);
        expect(topics).toContain(q.topic);
        expect(q.item).not.toBe(previous);
        previous = q.item;
      }
    }
    const t = (item: string, correct: boolean, ms: number): Answer => ({ quiz: 'theory', mode: 'keys', item, correct, at });
    const history = [
      ...Array.from({ length: 5 }, () => t('v:C', false, 6000)),
      ...Array.from({ length: 5 }, () => t('v:D', true, 0)),
      ...Array.from({ length: 5 }, () => t('v:E', true, 0)),
    ];
    const rng = mulberry32(6);
    let weak = 0;
    for (let i = 0; i < 4000; i++) if (nextTheoryQuestion(['keys'], history, rng, undefined, ['v:C', 'v:D', 'v:E']).item === 'v:C') weak++;
    expect(weak / 4000).toBeGreaterThan(1.15 / 1.45 - 0.03);
    expect(weak / 4000).toBeLessThan(1.15 / 1.45 + 0.03);
  });
});

describe('property: weighting', () => {
  const at2 = (quiz: 'fretboard' | 'theory', mode: string, item: string, correct: boolean, ms: number): Answer => ({ quiz, mode, item, correct, at });

  test('exact values: the wrong rate, answer time is ignored', () => {
    const h = [true, true, false, true, false].map((c, i) => ans('s1f1', c, [100, 3000, 60000, 0, 9000][i]!));
    expect(weakness(h, 'fretboard', 'name-note', 's1f1')).toBeCloseTo(0.4, 12);
    expect(weakness([ans('x', true, 60000)], 'fretboard', 'name-note', 'x')).toBe(0);
    expect(weakness([ans('x', false, 0)], 'fretboard', 'name-note', 'x')).toBe(1);
  });

  test('only the last five answers of the same quiz, mode and item count', () => {
    const history: Answer[] = [
      ...Array.from({ length: 4 }, () => ans('a', false, 6000)), // older than the last five: forgotten
      at2('theory', 'name-note', 'a', false, 6000), // other quiz
      ans('b', false, 6000), // other item
      ans('a', false, 6000, 'find-note'), // other mode
      ...Array.from({ length: 5 }, () => ans('a', true, 0)),
    ];
    expect(weakness(history, 'fretboard', 'name-note', 'a')).toBe(0);
    expect(weakness(history, 'theory', 'name-note', 'a')).toBeCloseTo(1);
    expect(weakness(history, 'fretboard', 'find-note', 'a')).toBeCloseTo(1);
  });

  test('matches an independent computation over a random history of every combination', () => {
    const rng = mulberry32(99);
    const quizzes = ['fretboard', 'theory'] as const;
    const modes = ['name-note', 'find-note'];
    const items = ['s0f0', 's0f1', 'n7'];
    const history = Array.from({ length: 400 }, () =>
      at2(quizzes[Math.floor(rng() * 2)]!, modes[Math.floor(rng() * 2)]!, items[Math.floor(rng() * 3)]!, rng() < 0.5, Math.floor(rng() * 12000)),
    );
    for (const quiz of quizzes) for (const mode of modes) for (const item of items) {
      const last = history.filter((a) => a.quiz === quiz && a.mode === mode && a.item === item).slice(-5);
      const wrong = last.filter((a) => !a.correct).length;
      const want = wrong / last.length;
      expect(weakness(history, quiz, mode, item)).toBeCloseTo(want, 12);
      expect(want).toBeGreaterThanOrEqual(0);
      expect(want).toBeLessThanOrEqual(1);
    }
  });

  test('weakness never leaves 0..1 even for a corrupt negative time', () => {
    const w = weakness([ans('x', true, -5000)], 'fretboard', 'name-note', 'x');
    expect(w).toBeGreaterThanOrEqual(0);
    expect(w).toBeLessThanOrEqual(1);
  });

  test('pickItem: probability is proportional to 0.15 + weakness', () => {
    const weights: Record<string, number> = { a: 1, b: 0.5, c: 0 };
    const rng = mulberry32(123);
    const counts = { a: 0, b: 0, c: 0 };
    const N = 30000;
    for (let i = 0; i < N; i++) counts[pickItem(['a', 'b', 'c'], (k) => weights[k]!, rng) as 'a' | 'b' | 'c']++;
    const total = 1.15 + 0.65 + 0.15;
    expect(counts.a / N).toBeCloseTo(1.15 / total, 1);
    expect(Math.abs(counts.a / N - 1.15 / total)).toBeLessThan(0.015);
    expect(Math.abs(counts.b / N - 0.65 / total)).toBeLessThan(0.015);
    expect(Math.abs(counts.c / N - 0.15 / total)).toBeLessThan(0.015);
  });

  test('pickItem: with a previous item the rest share its probability in proportion', () => {
    const weights: Record<string, number> = { a: 1, b: 0.5, c: 0 };
    const rng = mulberry32(321);
    const counts = { a: 0, b: 0, c: 0 };
    const N = 20000;
    for (let i = 0; i < N; i++) counts[pickItem(['a', 'b', 'c'], (k) => weights[k]!, rng, 'a') as 'a' | 'b' | 'c']++;
    expect(counts.a).toBe(0);
    expect(Math.abs(counts.b / N - 0.65 / 0.8)).toBeLessThan(0.015);
    expect(Math.abs(counts.c / N - 0.15 / 0.8)).toBeLessThan(0.015);
  });

  test('pickItem: never the previous item, for any list of two or more', () => {
    const rng = mulberry32(5);
    for (const items of [['a', 'b'], ['a', 'b', 'c'], iota(30).map(String)]) {
      for (let i = 0; i < 500; i++) {
        const previous = items[Math.floor(rng() * items.length)]!;
        expect(pickItem(items, () => rng(), rng, previous)).not.toBe(previous);
      }
    }
  });

  test('pickItem: edge cases', () => {
    const rng = mulberry32(1);
    expect(pickItem(['only'], () => 1, rng, 'only')).toBe('only');
    expect(pickItem(['a', 'a'], () => 1, rng, 'a')).toBe('a'); // nothing else to offer
    expect(() => pickItem([], () => 1, rng)).toThrow(/no items/i);
    // rng() at the very top of its range still picks a real item
    expect(pickItem(['a', 'b'], () => 0, () => 0.9999999999)).toBe('b');
    expect(pickItem(['a', 'b'], () => 0, () => 0)).toBe('a');
  });

  test('pickItem is repeatable under the same seed and does not mutate its input', () => {
    const items = ['a', 'b', 'c', 'd'];
    const copy = [...items];
    const run = (seed: number) => { const r = mulberry32(seed); return Array.from({ length: 50 }, () => pickItem(items, (i) => (i === 'b' ? 1 : 0.2), r)); };
    expect(run(11)).toEqual(run(11));
    expect(run(11)).not.toEqual(run(12));
    expect(items).toEqual(copy);
  });

  test('restrict: keeps order, never mutates, falls back to everything when nothing matches', () => {
    const items = ['a', 'b', 'c'];
    expect(restrict(items, ['c', 'a'])).toEqual(['a', 'c']);
    expect(restrict(items, [])).toEqual(items);
    expect(restrict(items, ['z', 'b'])).toEqual(['b']);
    expect(restrict(items)).not.toBe(items);
    expect(items).toEqual(['a', 'b', 'c']);
  });

  test('mulberry32: deterministic, in [0, 1), spread evenly', () => {
    const a = mulberry32(12345);
    const b = mulberry32(12345);
    const xs = Array.from({ length: 100000 }, () => a());
    expect(xs.slice(0, 1000)).toEqual(Array.from({ length: 1000 }, () => b()));
    expect(xs.every((x) => x >= 0 && x < 1)).toBe(true);
    expect(xs.reduce((s, x) => s + x, 0) / xs.length).toBeCloseTo(0.5, 1);
    const buckets = new Array<number>(10).fill(0);
    for (const x of xs) buckets[Math.floor(x * 10)]!++;
    for (const n of buckets) expect(Math.abs(n - 10000)).toBeLessThan(400);
    expect(mulberry32(0)()).not.toBe(mulberry32(1)());
    expect(mulberry32(-1)()).toBeGreaterThanOrEqual(0);
    expect(mulberry32(1.5)()).toBeLessThan(1);
  });

  test('shuffle: a permutation, seeded, input untouched', () => {
    const xs = iota(20);
    const out = shuffle(xs, mulberry32(3));
    expect([...out].sort((p, q) => p - q)).toEqual(xs);
    expect(shuffle(xs, mulberry32(3))).toEqual(out);
    expect(out).not.toEqual(xs);
    expect(xs).toEqual(iota(20));
    expect(shuffle([], mulberry32(1))).toEqual([]);
  });
});
