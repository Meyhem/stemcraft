import { describe, expect, test } from 'vitest';

import { SAMPLE_RATE } from '../../engine/types';
import { drumHit, drumHits, GROOVES } from './drums';

const peak = (xs: Float32Array) => xs.reduce((m, x) => Math.max(m, Math.abs(x)), 0);

describe('drumHit', () => {
  test('each voice is short, loud enough, below clipping, and ends silent', () => {
    for (const voice of ['kick', 'snare', 'hat'] as const) {
      const xs = drumHit(voice, 1);
      expect(xs.length).toBeLessThanOrEqual(0.4 * SAMPLE_RATE);
      expect(peak(xs)).toBeGreaterThan(0.2);
      expect(peak(xs)).toBeLessThan(1);
      expect(Math.abs(xs.at(-1)!)).toBeLessThan(1e-3);
    }
  });
  test('deterministic for a seed', () => {
    expect(drumHit('snare', 4)).toEqual(drumHit('snare', 4));
  });
});

describe('drumHits', () => {
  test('rock: kick on 1 and 3, snare on 2 and 4, hats on eighths, every bar', () => {
    const hits = drumHits('rock', 2);
    expect(hits.filter((h) => h.voice === 'kick').map((h) => h.beat)).toEqual([0, 2, 4, 6]);
    expect(hits.filter((h) => h.voice === 'snare').map((h) => h.beat)).toEqual([1, 3, 5, 7]);
    expect(hits.filter((h) => h.voice === 'hat')).toHaveLength(16);
  });
  test('shuffle is in triplets', () => {
    const hats = drumHits('shuffle', 1).filter((h) => h.voice === 'hat').map((h) => h.beat);
    expect(hats).toEqual([0, 2 / 3, 1, 5 / 3, 2, 8 / 3, 3, 11 / 3]);
  });
  test('every groove has a kick on the downbeat and stays inside its bars', () => {
    for (const [name, p] of Object.entries(GROOVES)) {
      expect(p.kick[0], name).toBe(0);
      for (const h of drumHits(name as never, 3)) expect(h.beat).toBeLessThan(12);
    }
  });
});
