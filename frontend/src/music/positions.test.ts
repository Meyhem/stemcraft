import { describe, expect, test } from 'vitest';

import { positionAt, positionsOf, positionWindows, rowMidi } from './positions';
import { DEFAULT_INSTRUMENT, instrumentFor } from './tuning';

const bass4 = DEFAULT_INSTRUMENT;
const guitar = instrumentFor('guitar6', false);
const dropD = { ...guitar, tuning: ['D2', 'A2', 'D3', 'G3', 'B3', 'E4'] };

describe('positions', () => {
  test('row 0 is the highest string', () => {
    expect(rowMidi(bass4)).toEqual([43, 38, 33, 28]);
    expect(positionAt(bass4, { string: 3, fret: 5 })).toEqual({ string: 3, fret: 5, midi: 33, pc: 9 });
  });

  test('every A from fret 0 to 12 on a 4-string bass', () => {
    const cells = positionsOf(bass4, new Set([9]), 0, 12).map((p) => `${p.string}:${p.fret}`);
    expect(cells).toEqual(['0:2', '1:7', '2:0', '2:12', '3:5']);
  });

  test('drop D moves the low string only', () => {
    const d = positionsOf(dropD, new Set([2]), 0, 0).map((p) => p.string);
    expect(d).toEqual([3, 5]);
  });

  test('position windows start on each scale note of the lowest string, root first', () => {
    const w = positionWindows(bass4, 9, [9, 0, 2, 4, 7]);
    expect(w.map((x) => `${x.index}:${x.lo}-${x.hi}`)).toEqual(['1:5-8', '2:8-11', '3:10-13', '4:12-15', '5:3-6']);
    expect(positionWindows(guitar, 9, [9, 0, 2, 4, 7])[0]).toEqual({ index: 1, lo: 5, hi: 9 });
    expect(positionWindows(bass4, 4, [4, 6, 8, 9, 11, 1, 3])[0]).toEqual({ index: 1, lo: 12, hi: 15 });
  });
});
