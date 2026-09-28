import { describe, expect, it } from 'vitest';

import { CLICK_LENGTH_FRAMES, clickSample, findBeatIndexAt } from './click';

const SR = 48_000;

describe('clickSample', () => {
  it('is silent before the onset and after the click decays', () => {
    expect(clickSample(-1, false, SR)).toBe(0);
    expect(clickSample(CLICK_LENGTH_FRAMES(SR), false, SR)).toBe(0);
    expect(clickSample(CLICK_LENGTH_FRAMES(SR) + 500, false, SR)).toBe(0);
  });

  it('decays in envelope from onset to the end of the burst', () => {
    const length = CLICK_LENGTH_FRAMES(SR);
    // Comparing two single frames conflates envelope decay with wherever those
    // frames happen to land on the sine (a phase artifact, not decay). Compare
    // peak magnitude over a window instead -- at least one full tone period
    // wide (48 frames at 1000 Hz, 30 at 1600 Hz; 64 is a safe round number) so
    // the window always captures a peak of the underlying tone, and what's left
    // to explain a lower peak in the later window is the envelope, not phase.
    const WINDOW = 64;
    const peakOver = (start: number, count: number) => {
      let max = 0;
      for (let i = start; i < start + count; i++) {
        max = Math.max(max, Math.abs(clickSample(i, false, SR)));
      }
      return max;
    };
    const early = peakOver(0, WINDOW);
    const late = peakOver(length - WINDOW, WINDOW);
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
