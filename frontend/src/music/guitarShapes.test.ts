import { describe, expect, it } from 'vitest';

import { mod12, parseChord } from './chordTones';
import { guitarChord, type GuitarChord } from './guitarChords';
import { barreOf, degreesOf, GUITAR_OPEN, shapesFor, type GuitarShape } from './guitarShapes';
import type { ResolvedKey } from './patterns';

const KEY: ResolvedKey = { tonicPc: 7, mode: 'major' };

function chord(label: string): GuitarChord {
  const parsed = parseChord(label, 0);
  if (parsed.kind !== 'chord') throw new Error(label);
  const read = guitarChord(parsed.tones, KEY);
  if (!read.ok) throw new Error(read.reason);
  return read.chord;
}

const tabs = (shapes: GuitarShape[]) => shapes.map((s) => s.tab);
const pcsOf = (s: GuitarShape) =>
  new Set(s.frets.flatMap((f, row) => (f === null ? [] : [mod12(GUITAR_OPEN[row]! + f)])));
const lowestPc = (s: GuitarShape) => {
  const row = s.frets.reduce<number>((acc, f, r) => (f !== null ? r : acc), -1);
  return mod12(GUITAR_OPEN[row]! + s.frets[row]!);
};

describe('barreOf', () => {
  it('finds a flat finger across unbroken strings at the lowest fret', () => {
    expect(barreOf([1, 1, 2, 3, 3, 1])).toEqual({ fret: 1, from: 0, to: 5 }); // F, 133211
    expect(barreOf([3, 5, 5, 5, 3, null])).toEqual({ fret: 3, from: 0, to: 4 }); // C, x35553
  });

  it('is not a barre when four fingers are enough', () => {
    expect(barreOf([3, 0, 0, 0, 2, 3])).toBeNull(); // G, 320003
    expect(barreOf([2, 3, 2, 0, null, null])).toBeNull(); // D, xx0232
  });
});

describe('shapesFor open', () => {
  it('has the cowboy chords', () => {
    expect(tabs(shapesFor('open', chord('G')))).toContain('320003');
    expect(tabs(shapesFor('open', chord('C')))).toContain('x32010');
    expect(tabs(shapesFor('open', chord('D')))).toContain('xx0232');
    expect(tabs(shapesFor('open', chord('E:min')))).toContain('022000');
    expect(tabs(shapesFor('open', chord('A')))).toContain('x02220');
  });

  it('every open shape has an open string and nothing above fret 4', () => {
    for (const label of ['G', 'C', 'D', 'E:min', 'A:min', 'C:maj7', 'D:sus4']) {
      for (const s of shapesFor('open', chord(label))) {
        expect(s.frets).toContain(0);
        expect(Math.max(...s.frets.map((f) => f ?? 0))).toBeLessThanOrEqual(4);
      }
    }
  });

  it('has no open F', () => {
    expect(shapesFor('open', chord('F'))).toEqual([]);
  });
});

describe('shapesFor barre', () => {
  it('has the E and A shapes and nothing open', () => {
    expect(tabs(shapesFor('barre', chord('F')))).toContain('133211');
    expect(tabs(shapesFor('barre', chord('C')))).toContain('x35553');
    for (const s of shapesFor('barre', chord('B:min'))) {
      expect(s.frets).not.toContain(0);
      expect(s.barre).not.toBeNull();
      expect([4, 5]).toContain(s.barre!.to);
    }
  });
});

describe('shapesFor power', () => {
  it('is root, 5th and octave on low E or A', () => {
    expect(tabs(shapesFor('power', chord('G')))).toEqual(['355xxx', 'x-10-12-12-x-x']);
    expect(tabs(shapesFor('power', chord('E')))).toContain('022xxx');
    expect(tabs(shapesFor('power', chord('E:min')))).toContain('022xxx');
  });

  it('refuses a chord without a perfect 5th, or with a slash bass', () => {
    for (const label of ['B:dim', 'C:aug', 'B:hdim7', 'B:dim7', 'C/3']) expect(shapesFor('power', chord(label))).toEqual([]);
  });
});

describe('shapesFor triad', () => {
  it('plays exactly the three triad notes on three adjacent strings of the top four', () => {
    const c = chord('C');
    const shapes = shapesFor('triad', c);
    expect(shapes.length).toBeGreaterThan(4);
    for (const s of shapes) {
      const sounding = s.frets.flatMap((f, row) => (f === null ? [] : [row]));
      expect(sounding).toHaveLength(3);
      expect(sounding[2]! - sounding[0]!).toBe(2);
      expect(sounding[2]).toBeLessThanOrEqual(3);
      expect(pcsOf(s)).toEqual(new Set([0, 4, 7]));
      const frets = s.frets.filter((f): f is number => f !== null);
      expect(Math.max(...frets) - Math.min(...frets)).toBeLessThanOrEqual(3);
    }
  });

  it('keeps a slash bass lowest', () => {
    const shapes = shapesFor('triad', chord('C/3'));
    expect(shapes.length).toBeGreaterThan(0);
    for (const s of shapes) expect(lowestPc(s)).toBe(4);
  });

  it('is in order up the neck, the same every time', () => {
    const a = tabs(shapesFor('triad', chord('G')));
    expect(a).toEqual(tabs(shapesFor('triad', chord('G'))));
    const anchors = shapesFor('triad', chord('G')).map((s) => s.anchor);
    expect(anchors).toEqual([...anchors].sort((x, y) => x - y));
  });
});

describe('degreesOf', () => {
  it('labels each string with its chord degree', () => {
    const g = shapesFor('open', chord('G')).find((s) => s.tab === '320003')!;
    expect(degreesOf(g, chord('G').tones)).toEqual(['R', '3', 'R', '5', '3', 'R']);
    const em = shapesFor('open', chord('E:min')).find((s) => s.tab === '022000')!;
    expect(degreesOf(em, chord('E:min').tones)).toEqual(['R', '5', '♭3', 'R', '5', 'R']);
  });
});
