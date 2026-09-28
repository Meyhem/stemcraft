import { describe, expect, it } from 'vitest';

import { sampleIndex } from '../engine/types';
import { percentOf } from './percent';

describe('percentOf', () => {
  it('expresses a position as a percentage of the duration', () => {
    expect(percentOf(sampleIndex(48_000), 24_000)).toBe(50);
    expect(percentOf(sampleIndex(48_000), 0)).toBe(0);
    expect(percentOf(sampleIndex(48_000), 48_000)).toBe(100);
  });

  it('yields 0 for a zero duration rather than NaN or Infinity', () => {
    expect(percentOf(sampleIndex(0), 0)).toBe(0);
    expect(percentOf(sampleIndex(0), 1_000)).toBe(0);
  });

  it('does not clamp: a position past the end reads past 100%', () => {
    expect(percentOf(sampleIndex(48_000), 96_000)).toBe(200);
  });
});
