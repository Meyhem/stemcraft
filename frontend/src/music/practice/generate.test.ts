import { describe, expect, test } from 'vitest';

import { DEFAULT_INSTRUMENT_SETTINGS, type ExerciseKind, type InstrumentSettings } from '../../api/client';
import { PROGRESSIONS } from '../progressions';
import { SCALES } from '../spell';
import { generate, regenerable } from './generate';
import { BEATS_PER_BAR } from './types';

const base = (exercise: ExerciseKind, patch: Partial<InstrumentSettings> = {}): InstrumentSettings => ({
  ...DEFAULT_INSTRUMENT_SETTINGS,
  exercise,
  ...patch,
});

function assertValid(r: ReturnType<typeof generate>, strings: number) {
  if (!r.ok) throw new Error(r.error);
  const end = r.loop.bars.length * BEATS_PER_BAR;
  for (const n of r.loop.notes) {
    expect(n.fret).toBeGreaterThanOrEqual(0);
    expect(n.fret).toBeLessThanOrEqual(12);
    expect(n.string).toBeLessThan(strings);
    expect(n.start + n.dur).toBeLessThanOrEqual(end + 1e-9);
  }
}

describe('every exercise fits the neck and whole bars', () => {
  for (const instrument of ['bass', 'guitar'] as const) {
    const strings = instrument === 'bass' ? 4 : 6;
    test(`${instrument}: grooves over every progression`, () => {
      for (const p of PROGRESSIONS) {
        assertValid(generate(instrument, base('groove', { groove: { ...DEFAULT_INSTRUMENT_SETTINGS.groove, progression: p.id as never } })), strings);
      }
    });
    test(`${instrument}: every scale in one position`, () => {
      for (const s of SCALES) {
        assertValid(generate(instrument, base('scale', { key: 9, scale: { ...DEFAULT_INSTRUMENT_SETTINGS.scale, scale: s.id } })), strings);
      }
    });
    test(`${instrument}: arpeggios and drills`, () => {
      assertValid(generate(instrument, base('arpeggio')), strings);
      for (const drill of ['chromatic', 'permutations', 'spider', 'crossing', 'octaves'] as const) {
        assertValid(generate(instrument, base('drill', { drill: { ...DEFAULT_INSTRUMENT_SETTINGS.drill, drill } })), strings);
      }
    });
  }
});

test('regenerable only where a seed changes something', () => {
  expect(regenerable('bass', base('groove'))).toBe(true);
  expect(regenerable('bass', base('groove', { groove: { ...DEFAULT_INSTRUMENT_SETTINGS.groove, approach: 'none' } }))).toBe(false);
  expect(regenerable('guitar', base('groove'))).toBe(false);
  expect(regenerable('bass', base('scale'))).toBe(false);
  expect(regenerable('bass', base('drill', { drill: { ...DEFAULT_INSTRUMENT_SETTINGS.drill, drill: 'permutations' } }))).toBe(true);
  expect(regenerable('bass', base('drill'))).toBe(false);
});
