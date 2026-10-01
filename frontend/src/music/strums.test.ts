import { describe, expect, it } from 'vitest';

import { strumStrokes, withoutDownbeat } from './strums';

const pattern = (strokes: ReturnType<typeof strumStrokes>) =>
  strokes.map((s) => `${s.beat}${s.dir === 'down' ? 'D' : 'U'}${s.early ? '!' : ''}`).join(' ');

describe('strumStrokes', () => {
  it.each([
    ['whole', 4, '0D'],
    ['half', 4, '0D 2D'],
    ['quarters', 4, '0D 1D 2D 3D'],
    ['eighths', 4, '0D 0.5U 1D 1.5U 2D 2.5U 3D 3.5U'],
    ['folk', 4, '0D 1D 1.5U 2.5U 3D 3.5U'],
    ['push', 4, '0D 1D 1.5U 2.5U 3D 3.5U!'],
    ['whole', 3, '0D'],
    ['half', 3, '0D 2D'],
    ['folk', 3, '0D 1D 1.5U 2.5U'],
    ['push', 3, '0D 1D 1.5U 2.5U!'],
  ] as const)('%s in %i/4', (strum, beats, expected) => {
    expect(pattern(strumStrokes(strum, beats))).toBe(expected);
  });

  it('accents only the first stroke', () => {
    expect(strumStrokes('eighths', 4).map((s) => s.accent)).toEqual([true, false, false, false, false, false, false, false]);
  });
});

describe('withoutDownbeat', () => {
  it('drops the beat-1 down-stroke and accents what is left first', () => {
    const tied = withoutDownbeat(strumStrokes('folk', 4));
    expect(pattern(tied)).toBe('1D 1.5U 2.5U 3D 3.5U');
    expect(tied[0]!.accent).toBe(true);
  });
});
