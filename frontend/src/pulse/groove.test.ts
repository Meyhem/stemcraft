import { describe, expect, it } from 'vitest';

import { BEAT_SECONDS, grooveLevels } from './groove';

// STEM_ORDER: vocals, drums, bass, other.
const DRUMS = 1;
const BASS = 2;

describe('grooveLevels', () => {
  it('gives one 0..1 level per stem at any time', () => {
    for (let t = 0; t < 10; t += 0.037) {
      const levels = grooveLevels(t);
      expect(levels).toHaveLength(4);
      for (const level of levels) {
        expect(level).toBeGreaterThanOrEqual(0);
        expect(level).toBeLessThanOrEqual(1);
      }
    }
  });

  it('the drums hit on every beat and decay between them', () => {
    const onBeat = grooveLevels(BEAT_SECONDS)[DRUMS]!;
    const between = grooveLevels(BEAT_SECONDS * 1.5)[DRUMS]!;
    expect(onBeat).toBeCloseTo(1);
    expect(between).toBeLessThan(0.5);
  });

  it('the bass hits on beats 1 and 3 only', () => {
    const one = grooveLevels(0)[BASS]!;
    const two = grooveLevels(BEAT_SECONDS)[BASS]!;
    const three = grooveLevels(BEAT_SECONDS * 2)[BASS]!;
    expect(one).toBeCloseTo(1);
    expect(three).toBeCloseTo(1);
    expect(two).toBeLessThan(0.5);
  });

  it('the rhythm section repeats every bar', () => {
    const bar = BEAT_SECONDS * 4;
    for (const t of [0.1, 0.6, 1.3]) {
      expect(grooveLevels(t + bar)[DRUMS]).toBeCloseTo(grooveLevels(t)[DRUMS]!);
      expect(grooveLevels(t + bar)[BASS]).toBeCloseTo(grooveLevels(t)[BASS]!);
    }
  });
});
