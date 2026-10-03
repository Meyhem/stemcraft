import { describe, expect, test } from 'vitest';

import { SAMPLE_RATE } from '../../engine/types';
import { chordHits, keysNote, padNote, voicing } from './pad';
import { RELEASE_FRAMES } from './voices';

const peak = (xs: Float32Array, from = 0, to = xs.length) => {
  let m = 0;
  for (let i = from; i < to; i++) m = Math.max(m, Math.abs(xs[i]!));
  return m;
};

describe('voicing', () => {
  test('close position from the root, inside C3–C5', () => {
    expect(voicing('G')).toEqual([55, 59, 62]);
    expect(voicing('E:min')).toEqual([52, 55, 59]);
    expect(voicing('Gb:min7')).toEqual([54, 57, 61, 64]);
    expect(voicing('B:hdim7')).toEqual([59, 62, 65, 69]);
  });
  test('null for no chord or an unreadable one', () => {
    expect(voicing('N')).toBeNull();
    expect(voicing('Q:wat')).toBeNull();
  });
});

test('the pad swells in; keys strike at once; both end silent and below clipping', () => {
  const pad = padNote(60, SAMPLE_RATE);
  const keys = keysNote(60, SAMPLE_RATE);
  expect(pad).toHaveLength(SAMPLE_RATE + RELEASE_FRAMES);
  expect(peak(pad, 0, 480)).toBeLessThan(peak(pad, 9600, 14400) / 4);
  expect(peak(keys, 0, 480)).toBeGreaterThan(peak(keys, 9600, 14400));
  for (const xs of [pad, keys]) {
    expect(peak(xs)).toBeLessThan(0.5);
    expect(Math.abs(xs.at(-1)!)).toBeLessThan(1e-3);
  }
});

test('chordHits', () => {
  expect(chordHits('pad')).toEqual([{ beat: 0, dur: 4 }]);
  expect(chordHits('keys')).toEqual([{ beat: 0, dur: 2 }, { beat: 2, dur: 2 }]);
});
