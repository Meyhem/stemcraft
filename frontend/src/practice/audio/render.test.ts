import { describe, expect, test } from 'vitest';

import { DEFAULT_INSTRUMENT_SETTINGS } from '../../api/client';
import { STEM_ORDER } from '../../engine/types';
import { generate } from '../../music/practice/generate';
import type { PracticeLoop } from '../../music/practice/types';
import { beatFrames, LEAD_IN_BARS, renderPractice, STRUM_STAGGER_FRAMES } from './render';

function loopFor(instrument: 'bass' | 'guitar'): PracticeLoop {
  const r = generate(instrument, DEFAULT_INSTRUMENT_SETTINGS);
  if (!r.ok) throw new Error(r.error);
  return r.loop;
}
const energy = (xs: Float32Array, from: number, to: number) => {
  let e = 0;
  for (let i = from; i < to; i++) e += Math.abs(xs[i]!);
  return e;
};
const slot = (name: (typeof STEM_ORDER)[number]) => STEM_ORDER.indexOf(name);

test('beatFrames rounds once, to integer samples at 48 kHz', () => {
  expect(beatFrames(1, 120)).toBe(24_000);
  expect(beatFrames(1 / 3, 100)).toBe(9600);
  expect(beatFrames(1, 7 * 13)).toBe(Math.round(48_000 * 60 / 91));
});

describe('renderPractice', () => {
  const bpm = 120;
  const r = renderPractice(loopFor('bass'), bpm);

  test('two silent bars of lead-in, then four bars of loop; every stem the same length', () => {
    expect(r.loopStart).toBe(LEAD_IN_BARS * 4 * 24_000);
    expect(r.loopEnd).toBe(r.loopStart + 4 * 4 * 24_000);
    for (const s of r.stems) {
      expect(s.left).toHaveLength(r.loopEnd);
      expect(s.right).toHaveLength(r.loopEnd);
    }
    expect(energy(r.stems[slot('bass')]!.left, 0, r.loopStart)).toBe(0);
  });

  test('the grids are integer samples; the display grid starts at bar 1', () => {
    expect(r.grid.bars).toHaveLength(LEAD_IN_BARS + 4);
    expect(r.grid.beats).toHaveLength((LEAD_IN_BARS + 4) * 4);
    expect(r.grid.bars.every((b) => Number.isInteger(b))).toBe(true);
    expect(r.display.bars[0]).toBe(r.loopStart);
    expect(r.display.barCount).toBe(4);
    expect(r.display.beatsPerBar).toBe(4);
  });

  test('the reference bass sounds at every note onset in the bass slot; vocals are silent', () => {
    const bass = r.stems[slot('bass')]!.left;
    for (const beat of [0, 1, 2, 3, 4, 8, 12]) {
      const at = r.loopStart + beatFrames(beat, bpm);
      expect(energy(bass, at, at + 480)).toBeGreaterThan(1);
    }
    expect(energy(r.stems[slot('vocals')]!.left, 0, r.loopEnd)).toBe(0);
  });

  test('a release that runs past the loop end is folded onto the loop start, so the wrap is continuous', () => {
    const bass = r.stems[slot('bass')]!.left;
    // The last note ends exactly at loopEnd; its 30 ms release lands in the first 1440 samples of bar 1.
    const lastNoteOnly = renderPractice({ ...loopFor('bass'), notes: [loopFor('bass').notes.at(-1)!] }, bpm);
    const folded = lastNoteOnly.stems[slot('bass')]!.left;
    expect(energy(folded, r.loopStart, r.loopStart + 1000)).toBeGreaterThan(0);
    expect(bass.some((x) => Math.abs(x) > 0.99)).toBe(false);
  });

  test('guitar: strums go to the other slot, strings staggered; the backing bass to the bass slot', () => {
    const g = renderPractice(loopFor('guitar'), bpm);
    const other = g.stems[slot('other')]!.left;
    expect(energy(other, g.loopStart, g.loopStart + STRUM_STAGGER_FRAMES)).toBeGreaterThan(0);
    expect(energy(g.stems[slot('bass')]!.left, g.loopStart, g.loopStart + 480)).toBeGreaterThan(1);
  });
});

describe('the band', () => {
  const bass = loopFor('bass');
  test('drums in the drums slot on every bar; the pad in other, in bass mode', () => {
    const r = renderPractice(bass, 120, { chord_sound: 'pad', drum_groove: 'rock' });
    const drums = r.stems[slot('drums')]!.left;
    for (let bar = 0; bar < 4; bar++) {
      const at = r.loopStart + beatFrames(bar * 4, 120);
      expect(energy(drums, at, at + 480)).toBeGreaterThan(1);
    }
    expect(energy(drums, 0, r.loopStart)).toBe(0);
    expect(energy(r.stems[slot('other')]!.left, r.loopStart, r.loopEnd)).toBeGreaterThan(1);
  });

  test('guitar mode keeps other for the reference guitar: no pad mixed in', () => {
    const g = loopFor('guitar');
    const withBand = renderPractice(g, 120, { chord_sound: 'pad', drum_groove: 'rock' });
    const plain = renderPractice(g, 120);
    expect(withBand.stems[slot('other')]!.left).toEqual(plain.stems[slot('other')]!.left);
  });

  test('a drill has no harmony: the pad slot is silent', () => {
    const r = generate('bass', { ...DEFAULT_INSTRUMENT_SETTINGS, exercise: 'drill' });
    if (!r.ok) throw new Error(r.error);
    const out = renderPractice(r.loop, 120, { chord_sound: 'keys', drum_groove: 'funk' });
    expect(energy(out.stems[slot('other')]!.left, 0, out.loopEnd)).toBe(0);
  });
});
