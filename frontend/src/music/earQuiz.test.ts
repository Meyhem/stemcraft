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
    expect(e).toBeGreaterThan(250);
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
