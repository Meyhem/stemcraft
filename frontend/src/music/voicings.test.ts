import { describe, expect, test } from 'vitest';

import { chordInfo, type ChordInfo } from './spell';
import { DEFAULT_INSTRUMENT, instrumentFor } from './tuning';
import { bassArpeggios, guitarVoicings, isPlayable, tabOf } from './voicings';

const guitar = instrumentFor('guitar6', false);
const chord = (s: string): ChordInfo => {
  const r = chordInfo(s);
  if (!r.ok) throw new Error(r.reason);
  return r.chord;
};

describe('guitar voicings', () => {
  test('tab notation, low string first', () => {
    expect(tabOf([0, 1, 0, 2, 0, null])).toBe('x02010');
    expect(tabOf([12, 13, 12, 14, 12, null])).toBe('x-12-14-12-13-12');
  });

  test('Am7 includes the open shape and the E-shape barre', () => {
    const tabs = guitarVoicings(guitar, chord('Am7')).map((v) => v.tab);
    expect(tabs).toContain('x02010');
    expect(tabs).toContain('575555');
  });

  test.each(['C', 'Am', 'Am7', 'G7', 'Dmaj7', 'F#m7b5', 'Bdim7', 'Esus4', 'C/E', 'Cadd9', 'A9'])(
    'every %s voicing obeys the rules',
    (s) => {
      const c = chord(s);
      const vs = guitarVoicings(guitar, c);
      expect(vs.length).toBeGreaterThan(0);
      expect(vs.length).toBeLessThanOrEqual(9);
      for (const v of vs) expect(isPlayable(guitar, c, v.frets), v.tab).toBe(true);
      const starts = vs.map((v) => Math.min(...v.frets.filter((f): f is number => f !== null && f > 0)));
      expect([...starts].sort((a, b) => a - b)).toEqual(starts);
    },
  );

  test('labels', () => {
    const vs = guitarVoicings(guitar, chord('Am7'));
    expect(vs.find((v) => v.tab === 'x02010')?.label).toBe('Open');
    expect(vs.find((v) => v.tab === '575555')?.label).toBe('Root on 6th string · fret 5');
  });

  test('isPlayable rejects wrong notes, a wrong bass and stretches', () => {
    const am7 = chord('Am7');
    expect(isPlayable(guitar, am7, [0, 1, 0, 2, 0, null])).toBe(true);
    expect(isPlayable(guitar, am7, [0, 1, 2, 2, 0, null])).toBe(false); // A on G string: no ♭7
    expect(isPlayable(guitar, am7, [0, 1, 0, 2, 0, 0])).toBe(false); // low E is the bass
    expect(isPlayable(guitar, am7, [0, 1, 0, 2, null, 5])).toBe(false); // gap in the strings
  });
});

describe('bass arpeggios', () => {
  test('Am7 from the root on the E string, in play order', () => {
    const [first] = bassArpeggios(DEFAULT_INSTRUMENT, chord('Am7'));
    expect(first!.label).toBe('From the root on the E string');
    expect(first!.cells).toEqual([
      { string: 3, fret: 5 },
      { string: 3, fret: 8 },
      { string: 2, fret: 7 },
      { string: 1, fret: 5 },
      { string: 1, fret: 7 },
    ]);
  });

  test('root, fifth, octave', () => {
    const shapes = bassArpeggios(DEFAULT_INSTRUMENT, chord('G'));
    expect(shapes.find((s) => s.label === 'Root, 5th, octave')!.cells).toEqual([
      { string: 3, fret: 3 },
      { string: 2, fret: 5 },
      { string: 1, fret: 5 },
    ]);
  });
});
