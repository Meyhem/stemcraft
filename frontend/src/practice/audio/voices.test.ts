import { describe, expect, test } from 'vitest';

import { SAMPLE_RATE } from '../../engine/types';
import { bassNote, midiHz, pluckNote, RELEASE_FRAMES } from './voices';

const peak = (xs: Float32Array) => xs.reduce((m, x) => Math.max(m, Math.abs(x)), 0);

/** Upward zero crossings per second over [from, to) seconds: the fundamental, once harmonics have died. */
function crossingsHz(xs: Float32Array, from: number, to: number) {
  let n = 0;
  for (let i = Math.round(from * SAMPLE_RATE) + 1; i < to * SAMPLE_RATE; i++) if (xs[i - 1]! < 0 && xs[i]! >= 0) n++;
  return n / (to - from);
}

test('midiHz', () => {
  expect(midiHz(69)).toBe(440);
  expect(midiHz(33)).toBeCloseTo(55, 6);
});

describe('bassNote', () => {
  test('is the note’s length plus the release, never clips, and fades to silence', () => {
    const xs = bassNote(33, SAMPLE_RATE);
    expect(xs).toHaveLength(SAMPLE_RATE + RELEASE_FRAMES);
    expect(peak(xs)).toBeLessThan(1);
    expect(peak(xs)).toBeGreaterThan(0.2);
    expect(Math.abs(xs[0]!)).toBeLessThan(1e-3);
    expect(Math.abs(xs.at(-1)!)).toBeLessThan(1e-3);
  });

  test('sounds at its pitch', () => {
    const xs = bassNote(45, SAMPLE_RATE); // A2, 110 Hz
    expect(crossingsHz(xs, 0.5, 0.9)).toBeGreaterThan(107);
    expect(crossingsHz(xs, 0.5, 0.9)).toBeLessThan(113);
  });
});

describe('pluckNote', () => {
  test('is deterministic for a seed and sounds at its pitch', () => {
    const a = pluckNote(57, SAMPLE_RATE / 2, 9); // A3, 220 Hz
    expect(pluckNote(57, SAMPLE_RATE / 2, 9)).toEqual(a);
    expect(peak(a)).toBeLessThan(1);
    // Karplus-Strong repeats itself every period once its upper partials have decayed: compare one period with the next, well after the attack.
    const period = Math.round(SAMPLE_RATE / midiHz(57));
    let diff = 0;
    let energy = 0;
    for (let i = 12000; i < 12000 + period; i++) {
      diff += Math.abs(a[i]! - a[i + period]!);
      energy += Math.abs(a[i]!);
    }
    expect(diff / energy).toBeLessThan(0.1);
  });
});
