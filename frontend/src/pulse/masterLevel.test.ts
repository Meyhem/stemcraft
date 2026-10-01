import { describe, expect, it } from 'vitest';

import { envelopeAt, pounded, settle } from './masterLevel';

describe('envelopeAt', () => {
  it('reads the bucket under the position, relative to the peak', () => {
    expect(envelopeAt([0.1, 0.4, 0.8], 0.8, 10, 0.15)).toBeCloseTo(0.5);
  });

  it('is silent past the end and for an all-silent envelope', () => {
    expect(envelopeAt([0.5], 0.5, 10, 3)).toBe(0);
    expect(envelopeAt([0, 0], 0, 10, 0)).toBe(0);
  });
});

describe('pounded', () => {
  it('exaggerates the swing around the average, so a loud master still pulses', () => {
    expect(pounded(0.65, 0.53)).toBeGreaterThan(0.8);
    expect(pounded(0.42, 0.53)).toBeLessThan(0.3);
  });

  it('stays in 0..1 and is dark in silence', () => {
    expect(pounded(1, 0.2)).toBe(1);
    expect(pounded(0, 0.5)).toBe(0);
    expect(pounded(0, 0)).toBe(0);
  });
});

describe('settle', () => {
  it('drifts toward the level without jumping to it', () => {
    const next = settle(0, 1, 0.1);
    expect(next).toBeGreaterThan(0);
    expect(next).toBeLessThan(0.1);
  });
});
