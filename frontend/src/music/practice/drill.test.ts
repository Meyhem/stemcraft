import { describe, expect, test } from 'vitest';

import { DEFAULT_INSTRUMENT_SETTINGS, type InstrumentSettings } from '../../api/client';
import { drillLine, PERMUTATIONS } from './drill';

const withDrill = (patch: Partial<InstrumentSettings['drill']>, rest: Partial<InstrumentSettings> = {}): InstrumentSettings => ({
  ...DEFAULT_INSTRUMENT_SETTINGS,
  ...rest,
  drill: { ...DEFAULT_INSTRUMENT_SETTINGS.drill, ...patch },
});

test('24 distinct finger orders', () => {
  expect(PERMUTATIONS).toHaveLength(24);
  expect(new Set(PERMUTATIONS.map((p) => p.join(''))).size).toBe(24);
});

describe('drillLine', () => {
  test('chromatic 1-2-3-4 from fret 5, up and back, eighths: 4 bars on bass, 6 on guitar', () => {
    const bass = drillLine(withDrill({}), 'bass');
    if (!bass.ok) throw new Error(bass.error);
    expect(bass.loop.notes).toHaveLength(32);
    expect(bass.loop.bars).toHaveLength(4);
    expect(bass.loop.notes.slice(0, 5).map((n) => [n.string, n.fret, n.finger])).toEqual([
      [0, 5, 1], [0, 6, 2], [0, 7, 3], [0, 8, 4], [1, 5, 1],
    ]);
    expect(bass.loop.bars.map((b) => b.label)).toEqual(['E → A', 'D → G', 'G → D', 'A → E']);
    const guitar = drillLine(withDrill({}), 'guitar');
    if (!guitar.ok) throw new Error(guitar.error);
    expect(guitar.loop.bars).toHaveLength(6);
  });

  test('drills are named with sharps', () => {
    const r = drillLine(withDrill({ from_fret: 1 }), 'bass');
    if (!r.ok) throw new Error(r.error);
    expect(r.loop.notes[1]!.name).toBe('F♯');
  });

  test('permutations: one seeded finger order on every string', () => {
    const a = drillLine(withDrill({ drill: 'permutations' }, { seed: 3 }), 'bass');
    const b = drillLine(withDrill({ drill: 'permutations' }, { seed: 3 }), 'bass');
    expect(a).toEqual(b);
    if (!a.ok) throw new Error(a.error);
    const order = a.loop.notes.slice(0, 4).map((n) => n.finger);
    expect(a.loop.notes.slice(4, 8).map((n) => n.finger)).toEqual(order);
  });

  test('spider alternates two strings', () => {
    const r = drillLine(withDrill({ drill: 'spider', direction: 'up' }), 'bass');
    if (!r.ok) throw new Error(r.error);
    expect(r.loop.notes.slice(0, 4).map((n) => [n.string, n.finger])).toEqual([[0, 1], [1, 2], [0, 3], [1, 4]]);
  });

  test('octaves past fret 7 run off the neck, with a fix', () => {
    const r = drillLine(withDrill({ drill: 'octaves', from_fret: 8 }), 'bass');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe('Octaves from fret 8 reach fret 13; the neck stops at 12.');
    expect(r.fixes[0]!.apply(withDrill({ drill: 'octaves', from_fret: 8 })).drill.from_fret).toBe(7);
  });
});
