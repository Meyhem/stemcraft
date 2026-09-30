import { describe, expect, it } from 'vitest';

import type { StemSummary } from '../engine/stemPeaks';
import { sampleIndex } from '../engine/types';
import { follow, levelAt } from './levels';

function summary(envelope: number[], overrides: Partial<StemSummary> = {}): StemSummary {
  return {
    name: 'bass',
    envelope: Float32Array.from(envelope),
    peak: Math.max(...envelope),
    nearSilent: false,
    ...overrides,
  };
}

describe('levelAt', () => {
  it('reads the envelope bucket under the cursor: 100 buckets a second at 48 kHz', () => {
    const s = summary([0.1, 0.4, 0.2]);
    expect(levelAt(s, sampleIndex(0))).toBeCloseTo(0.25);
    expect(levelAt(s, sampleIndex(479))).toBeCloseTo(0.25);
    expect(levelAt(s, sampleIndex(480))).toBeCloseTo(1);
    expect(levelAt(s, sampleIndex(960))).toBeCloseTo(0.5);
  });

  it('normalises to the stem peak, so a quiet stem still reaches 1', () => {
    expect(levelAt(summary([0.05, 0.1]), sampleIndex(480))).toBeCloseTo(1);
  });

  it('is zero past the end of the envelope', () => {
    expect(levelAt(summary([0.5]), sampleIndex(48_000))).toBe(0);
  });

  it('is zero for a near-silent stem: normalised noise must not pulse (U-10)', () => {
    const s = summary([0.004, 0.008], { nearSilent: true });
    expect(levelAt(s, sampleIndex(480))).toBe(0);
  });
});

describe('follow', () => {
  it('jumps up to a louder target at once', () => {
    expect(follow(0.2, 0.9, 0.016)).toBe(0.9);
  });

  it('falls towards a quieter target gradually', () => {
    const next = follow(1, 0, 0.016);
    expect(next).toBeGreaterThan(0.8);
    expect(next).toBeLessThan(1);
  });

  it('never falls below the target', () => {
    expect(follow(1, 0.6, 10)).toBe(0.6);
  });
});
