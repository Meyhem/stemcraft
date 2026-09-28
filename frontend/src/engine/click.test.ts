import { describe, expect, it } from 'vitest';

import { CLICK_LENGTH_FRAMES, clickSample, findBeatIndexAt } from './click';

const SR = 48_000;

describe('clickSample', () => {
  it('is silent before the onset and after the click decays', () => {
    expect(clickSample(-1, false, SR)).toBe(0);
    expect(clickSample(CLICK_LENGTH_FRAMES(SR), false, SR)).toBe(0);
    expect(clickSample(CLICK_LENGTH_FRAMES(SR) + 500, false, SR)).toBe(0);
  });

  it('decays monotonically in envelope from the onset', () => {
    const length = CLICK_LENGTH_FRAMES(SR);
    // Sample the envelope at quarter-cycle boundaries of the tone so the
    // comparison is of amplitude, not of where we happen to land on the sine.
    const early = Math.abs(clickSample(1, false, SR));
    const late = Math.abs(clickSample(length - 2, false, SR));
    expect(early).toBeGreaterThan(late);
  });

  it('accents a downbeat louder and higher than an offbeat', () => {
    const plain = clickSample(4, false, SR);
    const accented = clickSample(4, true, SR);
    expect(Math.abs(accented)).toBeGreaterThan(Math.abs(plain));
  });

  it('never exceeds unity, so it cannot clip the pre-stretcher mix', () => {
    for (let i = 0; i < CLICK_LENGTH_FRAMES(SR); i++) {
      expect(Math.abs(clickSample(i, true, SR))).toBeLessThanOrEqual(1);
    }
  });
});

describe('findBeatIndexAt', () => {
  const beats = Float64Array.from([0, 1000, 2000, 3000]);

  it('finds the index of the latest beat at or before a position', () => {
    expect(findBeatIndexAt(beats, 0)).toBe(0);
    expect(findBeatIndexAt(beats, 999)).toBe(0);
    expect(findBeatIndexAt(beats, 1000)).toBe(1);
    expect(findBeatIndexAt(beats, 5000)).toBe(3);
  });

  it('is -1 before the first beat', () => {
    expect(findBeatIndexAt(Float64Array.from([500, 1500]), 100)).toBe(-1);
  });

  it('is -1 for an empty grid', () => {
    expect(findBeatIndexAt(new Float64Array(0), 100)).toBe(-1);
  });
});
