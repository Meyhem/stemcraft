import { describe, expect, test } from 'vitest';

import { DEFAULT_INSTRUMENT_SETTINGS, type InstrumentSettings } from '../../api/client';
import { arpeggioLine, arpeggioPath } from './arpeggio';

const withArp = (patch: Partial<InstrumentSettings['arpeggio']>, rest: Partial<InstrumentSettings> = {}): InstrumentSettings => ({
  ...DEFAULT_INSTRUMENT_SETTINGS,
  key: 0,
  ...rest,
  arpeggio: { ...DEFAULT_INSTRUMENT_SETTINGS.arpeggio, ...patch },
});

test('arpeggioPath', () => {
  expect(arpeggioPath([0, 4, 7, 11], 'up')).toEqual([0, 4, 7, 11]);
  expect(arpeggioPath([0, 4, 7, 11], 'up_down')).toEqual([0, 4, 7, 11, 7, 4]);
  expect(arpeggioPath([0, 4, 7], 'inversions')).toEqual([0, 4, 7, 4, 7, 12, 7, 12, 16]);
});

describe('arpeggioLine', () => {
  test('ii–V–I in C as 7ths, root up, one bar each', () => {
    const r = arpeggioLine(withArp({}), 'bass');
    if (!r.ok) throw new Error(r.error);
    expect(r.loop.bars.map((b) => b.label)).toEqual(['Dm7', 'G7', 'Cmaj7']);
    expect(r.loop.notes.map((n) => n.name)).toEqual(['D', 'F', 'A', 'C', 'G', 'B', 'D', 'F', 'C', 'E', 'G', 'B']);
  });

  test('the path cycles to fill each chord’s bars', () => {
    const r = arpeggioLine(withArp({ bars_per_chord: 2, rhythm: 'eighth', path: 'up_down' }), 'bass');
    if (!r.ok) throw new Error(r.error);
    expect(r.loop.bars).toHaveLength(6);
    expect(r.loop.notes).toHaveLength(6 * 8);
    expect(r.loop.notes.slice(0, 8).map((n) => n.name)).toEqual(['D', 'F', 'A', 'C', 'A', 'F', 'D', 'F']);
  });

  test('one chord: the key’s root with the chosen quality', () => {
    const r = arpeggioLine(withArp({ over: 'chord', quality: 'min7', tones: 'seventh' }, { key: 9 }), 'guitar');
    if (!r.ok) throw new Error(r.error);
    expect(r.loop.bars.map((b) => b.label)).toEqual(['Am7']);
    expect(r.loop.notes.slice(0, 4).map((n) => n.name)).toEqual(['A', 'C', 'E', 'G']);
  });

  test('a 7th asked of a triad plays the octave instead, and says so', () => {
    const r = arpeggioLine(withArp({ progression: 'pop' }, { key: 7 }), 'bass');
    if (!r.ok) throw new Error(r.error);
    expect(r.loop.bars[0]!.note).toBe('G has no 7th: root, 3rd, 5th, octave');
  });
});

test('arpeggio bars name their chords', () => {
  const r = arpeggioLine(withArp({}), 'bass');
  if (!r.ok) throw new Error(r.error);
  expect(r.loop.bars.map((b) => b.chord)).toEqual(['D:min7', 'G:7', 'C:maj7']);
});
