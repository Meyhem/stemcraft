import { describe, expect, test } from 'vitest';

import { DEFAULT_INSTRUMENT_SETTINGS, type InstrumentSettings } from '../../api/client';
import { pathOrder, scaleLine, timed } from './scale';

const withScale = (patch: Partial<InstrumentSettings['scale']>, rest: Partial<InstrumentSettings> = {}): InstrumentSettings => ({
  ...DEFAULT_INSTRUMENT_SETTINGS,
  key: 9,
  ...rest,
  scale: { ...DEFAULT_INSTRUMENT_SETTINGS.scale, ...patch },
});

describe('pathOrder', () => {
  test('up and down plays the top once and leaves the root to the wrap', () => {
    expect(pathOrder(4, 'up_down')).toEqual([0, 1, 2, 3, 2, 1]);
    expect(pathOrder(4, 'down')).toEqual([3, 2, 1, 0]);
  });
  test('sequences climb then descend', () => {
    expect(pathOrder(4, 'thirds')).toEqual([0, 2, 1, 3, 3, 1, 2, 0]);
    expect(pathOrder(4, 'groups3')).toEqual([0, 1, 2, 1, 2, 3, 3, 2, 1, 2, 1, 0]);
  });
});

test('timed rounds up to whole bars and holds the last note to the bar line', () => {
  expect(timed(14, 0.5)).toEqual({
    starts: [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5, 5.5, 6, 6.5],
    durs: [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 1.5],
    barCount: 2,
  });
});

describe('scaleLine', () => {
  test('A minor pentatonic, fifth-fret box, up and down in eighths', () => {
    const r = scaleLine(withScale({}), 'bass');
    if (!r.ok) throw new Error(r.error);
    expect(r.loop.notes.map((n) => n.name)).toEqual(['A', 'C', 'D', 'E', 'G', 'A', 'C', 'D', 'C', 'A', 'G', 'E', 'D', 'C']);
    expect(r.loop.notes.slice(0, 2).map((n) => [n.string, n.fret])).toEqual([[0, 5], [0, 8]]);
    expect(r.loop.bars.map((b) => b.label)).toEqual(['A Minor pentatonic', '']);
  });

  test('flat keys spell with flats', () => {
    const r = scaleLine(withScale({ scale: 'major', from_fret: 1 }, { key: 5 }), 'bass');
    if (!r.ok) throw new Error(r.error);
    expect(r.loop.notes.map((n) => n.name)).toContain('B♭');
  });

  test('six strings on guitar', () => {
    const r = scaleLine(withScale({}), 'guitar');
    if (!r.ok) throw new Error(r.error);
    expect(new Set(r.loop.notes.map((n) => n.string)).size).toBe(6);
  });

  test('two octaves that run off the neck fail with the note, the fret and the fixes', () => {
    const r = scaleLine(withScale({ scale: 'blues', shape: 'two_octaves', from_fret: 9 }, { key: 2 }), 'bass');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe('Two octaves of D Blues do not fit from fret 9: the top D needs fret 19 on the G string; the neck stops at 12.');
    expect(r.fixes.map((f) => f.label)).toEqual(['Start from fret 0', 'One position']);
    expect(r.fixes[1]!.apply(withScale({ shape: 'two_octaves' })).scale.shape).toBe('position');
  });

  test('a box past the 12th fret is refused with a fix', () => {
    const r = scaleLine(withScale({ from_fret: 11 }), 'bass');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe('Frets 11–14 run past the 12th fret.');
    expect(r.fixes[0]!.apply(withScale({ from_fret: 11 })).scale.from_fret).toBe(9);
  });
});

test('a scale drones its tonic triad', () => {
  const r = scaleLine(withScale({}), 'bass');
  if (!r.ok) throw new Error(r.error);
  expect(r.loop.bars.map((b) => b.chord)).toEqual(['A:min', 'A:min']);
  const major = scaleLine(withScale({ scale: 'lydian' }, { key: 0 }), 'bass');
  if (!major.ok) throw new Error(major.error);
  expect(major.loop.bars[0]!.chord).toBe('C');
});
