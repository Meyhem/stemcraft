import { Note } from 'tonal';
import { describe, expect, test } from 'vitest';

import {
  QuizFocusError,
  cellKey,
  focusCells,
  fretboardQuestion,
  heatmap,
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
  weakestFacts,
  weakness,
  type Answer,
} from './quiz';
import { chordInfo } from './spell';
import { DEFAULT_INSTRUMENT, PRESETS, neckFrets, type Instrument } from './tuning';

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

  test('an unusable focus is a clear QuizFocusError, never a guess', () => {
    const halfDown = { kind: 'bass', strings: 4, tuning: ['Eb1', 'Ab1', 'Db2', 'Gb2'], left_handed: false } as Instrument;
    const nothing = { strings: [], frets: [0, 0] as [number, number], accidentals: false };
    for (const mode of ['name-note', 'find-note', 'find-interval'] as const) {
      expect(() => fretboardQuestion(mode, halfDown, nothing, [], mulberry32(1))).toThrow(QuizFocusError);
      expect(() => fretboardQuestion(mode, halfDown, nothing, [], mulberry32(1))).toThrow(/leave nothing/);
    }
    expect(() => fretboardQuestion('name-note', bass4, { strings: [], frets: [5, 2], accidentals: true }, [], mulberry32(1))).toThrow(QuizFocusError);
    expect(() => fretboardQuestion('name-note', bass4, { strings: [7], frets: [0, 12], accidentals: true }, [], mulberry32(1))).toThrow(QuizFocusError);
    expect(() => fretboardQuestion('name-note', bass4, { strings: [], frets: [16, 20], accidentals: true }, [], mulberry32(1))).toThrow(QuizFocusError);
    expect(() => fretboardQuestion('spell-chord', bass4, { strings: [], frets: [16, 20], accidentals: true }, [], mulberry32(1))).toThrow(QuizFocusError);
    // Rows that do not exist are dropped, the ones that do stay.
    expect(focusCells(bass4, { strings: [9, 2], frets: [0, 1], accidentals: true }).map(cellKey)).toEqual(['s2f0', 's2f1']);
  });

  const SEMITONES: Record<string, number> = { 'minor 3rd': 3, 'major 3rd': 4, '4th': 5, '5th': 7, '♭7': 10, octave: 0 };
  const TONES = { '': [0, 4, 7], m: [0, 3, 7] } as Record<string, number[]>;

  test('every mode is producible or explicitly refused, and every question is sound', () => {
    for (const c of configs) {
      const expected = expectedCells(c.inst, c.focus);
      const neck = neckFrets(c.inst);
      const lo = Math.max(0, c.focus.frets[0]);
      const hi = Math.min(neck, c.focus.frets[1]);
      const inNeck = (cell: { string: number; fret: number }) =>
        Number.isInteger(cell.string) && Number.isInteger(cell.fret) && cell.string >= 0 && cell.string < c.inst.strings && cell.fret >= 0 && cell.fret <= neck;
      for (const mode of ['name-note', 'find-note', 'find-interval', 'spell-chord'] as const) {
        const emptyFocus = mode === 'spell-chord' ? lo > hi : expected.length === 0;
        const rng = mulberry32(17);
        if (emptyFocus) {
          expect(() => fretboardQuestion(mode, c.inst, c.focus, [], rng), `${label(c)} ${mode}`).toThrow(QuizFocusError);
          continue;
        }
        let previous: string | undefined;
        for (let n = 0; n < 6; n++) {
          const q = fretboardQuestion(mode, c.inst, c.focus, [], rng, previous);
          const where = `${label(c)} ${mode}`;
          expect(q.prompt.includes('NaN') || q.prompt.includes('undefined'), where).toBe(false);
          if (q.mode === 'name-note' || q.mode === 'find-interval') {
            expect(expected.map(cellKey), where).toContain(q.item);
            expect(q.cell, where).toEqual(parseCellKey(q.item));
            expect(inNeck(q.cell), where).toBe(true);
            const pc = m12(midiOf(c.inst, q.cell));
            expect(pcAt(c.inst, q.cell), where).toBe(pc);
            if (q.mode === 'name-note') expect(q.answerPc, where).toBe(pc);
            else {
              const label_ = /^Tap the (.+) above this note$/.exec(q.prompt)?.[1];
              expect(SEMITONES[label_!], `${where} ${q.prompt}`).toBeDefined();
              expect(q.answerPc, where).toBe(m12(pc + SEMITONES[label_!]!));
            }
            expect(Number.isInteger(q.answerPc) && q.answerPc >= 0 && q.answerPc < 12, where).toBe(true);
          } else if (q.mode === 'find-note') {
            expect(q.item, where).toBe(`n${q.pc}`);
            expect(Number.isInteger(q.pc) && q.pc >= 0 && q.pc < 12, where).toBe(true);
            const want = expected.filter((cell) => m12(midiOf(c.inst, cell)) === q.pc).map(cellKey);
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
            const want = iota(c.inst.strings).flatMap((string) =>
              iota(wHi - wLo + 1).map((i) => ({ string, fret: wLo + i })).filter((cell) => tones.has(m12(midiOf(c.inst, cell)))),
            );
            expect(want.length, where).toBeGreaterThan(0);
            expect(q.targets.map(cellKey).sort(), where).toEqual(want.map(cellKey).sort());
            expect(q.targets.every(inNeck), where).toBe(true);
          }
          previous = q.item;
        }
      }
    }
  }, 30_000);

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
    const q = fretboardQuestion('name-note', bass4, one, [], mulberry32(1), 's0f0');
    expect(q.item).toBe('s0f0');
  });

  test('the same seed gives the same question, whatever the mode', () => {
    for (const mode of ['name-note', 'find-note', 'find-interval', 'spell-chord'] as const) {
      const a = fretboardQuestion(mode, bass4, { strings: [], frets: [0, 12], accidentals: true }, [], mulberry32(77));
      const b = fretboardQuestion(mode, bass4, { strings: [], frets: [0, 12], accidentals: true }, [], mulberry32(77));
      expect(a).toEqual(b);
    }
  });

  test('only lists work for find-note and spell-chord, and fall back when they match nothing in focus', () => {
    const focus = { strings: [], frets: [0, 12] as [number, number], accidentals: false };
    for (let s = 0; s < 8; s++) {
      expect(fretboardQuestion('find-note', bass4, focus, [], mulberry32(s), undefined, ['n7']).item).toBe('n7');
      expect(fretboardQuestion('spell-chord', bass4, focus, [], mulberry32(s), undefined, ['Dm']).item).toBe('Dm');
    }
    // n1 (C sharp) is not in a naturals-only focus, so the list matches nothing and everything is asked.
    expect(fretboardQuestion('find-note', bass4, focus, [], mulberry32(3), undefined, ['n1']).item).toMatch(/^n(0|2|4|5|7|9|11)$/);
  });

  test('a weak cell is asked about more often (probability 0.15 + weakness)', () => {
    const focus = { strings: [3], frets: [0, 5] as [number, number], accidentals: false }; // s3f0 s3f1 s3f3 s3f5
    const strong = ['s3f0', 's3f1', 's3f5'].flatMap((k) => Array.from({ length: 5 }, () => ans(k, true, 0)));
    const history = [...strong, ...Array.from({ length: 5 }, () => ans('s3f3', false, 6000))];
    const rng = mulberry32(2026);
    let weak = 0;
    for (let i = 0; i < 4000; i++) if (fretboardQuestion('name-note', bass4, focus, history, rng).item === 's3f3') weak++;
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
    const t = (item: string, correct: boolean, ms: number): Answer => ({ quiz: 'theory', mode: 'keys', item, correct, ms, at });
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
  const at2 = (quiz: 'fretboard' | 'theory', mode: string, item: string, correct: boolean, ms: number): Answer => ({ quiz, mode, item, correct, ms, at });

  test('exact values', () => {
    // 5 answers, 2 wrong, average 3000 ms: 0.6*0.4 + 0.4*0.5
    const h = [true, true, false, true, false].map((c, i) => ans('s1f1', c, [3000, 3000, 3000, 3000, 3000][i]!));
    expect(weakness(h, 'fretboard', 'name-note', 's1f1')).toBeCloseTo(0.44, 12);
    // slowness saturates at 6000 ms
    expect(weakness([ans('x', true, 60000)], 'fretboard', 'name-note', 'x')).toBeCloseTo(0.4, 12);
    expect(weakness([ans('x', true, 0)], 'fretboard', 'name-note', 'x')).toBe(0);
    // a correct, slow answer is not as weak as a wrong, fast one
    expect(weakness([ans('x', false, 0)], 'fretboard', 'name-note', 'x')).toBeCloseTo(0.6, 12);
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
      const avg = last.reduce((s, a) => s + a.ms, 0) / last.length;
      const want = 0.6 * (wrong / last.length) + 0.4 * Math.min(avg / 6000, 1);
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

describe('property: derived stats', () => {
  const th = (mode: string, item: string, correct: boolean, ms: number): Answer => ({ quiz: 'theory', mode, item, correct, ms, at });

  test('heatmap: last five across modes per cell, ignoring non-cells and the theory quiz', () => {
    const history: Answer[] = [
      ans('s0f0', false, 6000),
      ans('s0f0', true, 0, 'find-interval'),
      ans('s3f12', true, 0),
      ans('n7', false, 6000, 'find-note'),
      ans('Dm', false, 6000, 'spell-chord'),
      th('keys', 's1f1', false, 6000), // a theory fact that happens to look like a cell
      th('keys', 'v:C', false, 6000),
      ans('s10', false, 6000), // not a cell key
      ans('sxf1', false, 6000),
      ans('s1f', false, 6000),
      ans('s1f1x', false, 6000),
    ];
    const before = JSON.stringify(history);
    expect(heatmap(history)).toEqual([
      { string: 0, fret: 0, weakness: 0.5 },
      { string: 3, fret: 12, weakness: 0 },
    ]);
    expect(JSON.stringify(history)).toBe(before);
    expect(heatmap([])).toEqual([]);
  });

  test('heatmap: matches an independent computation on a random history and is repeatable', () => {
    const rng = mulberry32(2);
    const cells = ['s0f0', 's1f3', 's2f7', 's3f12'];
    const modes = ['name-note', 'find-interval'];
    const history = Array.from({ length: 200 }, () => ans(cells[Math.floor(rng() * 4)]!, rng() < 0.6, Math.floor(rng() * 9000), modes[Math.floor(rng() * 2)]));
    const got = heatmap(history);
    expect(heatmap(history)).toEqual(got);
    for (const cell of cells) {
      const last = history.filter((a) => a.item === cell).slice(-5);
      const want = 0.6 * (last.filter((a) => !a.correct).length / last.length) + 0.4 * Math.min(last.reduce((s, a) => s + a.ms, 0) / last.length / 6000, 1);
      const c = parseCellKey(cell)!;
      expect(got.find((g) => g.string === c.string && g.fret === c.fret)!.weakness).toBeCloseTo(want, 12);
    }
    expect(got).toHaveLength(4);
  });

  test('heatmap order is fixed by the history (first time each cell was asked), not by chance', () => {
    const h = [ans('s2f2', true, 0), ans('s0f5', true, 0), ans('s2f2', false, 0), ans('s1f1', true, 0)];
    expect(heatmap(h).map(cellKey)).toEqual(['s2f2', 's0f5', 's1f1']);
  });

  test('weakestFacts: theory answers only, weakest first, ties keep the order first asked', () => {
    const history: Answer[] = [
      th('keys', 'v:C', true, 0),
      th('keys', 'v:D', true, 0),
      th('keys', 'v:A', true, 0),
      th('chords', 'notes:Cm', false, 6000),
      ans('s0f0', false, 6000), // fretboard: ignored
      ans('v:G', false, 6000),
    ];
    const facts = weakestFacts(history, 10);
    expect(facts.map((f) => f.item)).toEqual(['notes:Cm', 'v:C', 'v:D', 'v:A']);
    expect(facts.map((f) => f.weakness)).toEqual([1, 0, 0, 0]);
    expect(weakestFacts(history, 10)).toEqual(facts); // repeatable
    expect(weakestFacts([...history].reverse(), 10).map((f) => f.item)).toEqual(['notes:Cm', 'v:A', 'v:D', 'v:C']);
    expect(weakestFacts(history, 2).map((f) => f.item)).toEqual(['notes:Cm', 'v:C']);
    expect(weakestFacts(history, 0)).toEqual([]);
    expect(weakestFacts(history, -1)).toEqual([]);
    expect(weakestFacts([], 3)).toEqual([]);
  });

  test('weakestFacts uses the last five answers of each fact', () => {
    const history = [th('keys', 'v:C', false, 6000), ...Array.from({ length: 5 }, () => th('keys', 'v:C', true, 0)), th('keys', 'v:D', false, 6000)];
    expect(weakestFacts(history, 2)).toEqual([
      { item: 'v:D', weakness: 1 },
      { item: 'v:C', weakness: 0 },
    ]);
  });
});
