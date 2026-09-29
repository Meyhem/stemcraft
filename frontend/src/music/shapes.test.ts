import { describe, expect, test } from 'vitest';

import { cagedWindows, pentatonicBoxes, perStringShape, stringSets, threeNotesPerString, triadShapes } from './shapes';
import { chordInfo, scaleNotes, type ChordInfo } from './spell';
import { DEFAULT_INSTRUMENT, instrumentFor } from './tuning';

const guitar = instrumentFor('guitar6', false);
const bass4 = DEFAULT_INSTRUMENT;
const cells = (cs: { string: number; fret: number }[]) => cs.map((c) => `${c.string}:${c.fret}`).join(' ');
const chord = (s: string): ChordInfo => {
  const r = chordInfo(s);
  if (!r.ok) throw new Error(r.reason);
  return r.chord;
};

describe('scale shapes', () => {
  test('pentatonic box 1 of A minor on guitar is the familiar fret 5 box', () => {
    const [box1] = pentatonicBoxes(guitar, scaleNotes('A', 'minor-pentatonic'), 17);
    expect(cells(box1!.cells)).toBe('5:5 5:8 4:5 4:7 3:5 3:7 2:5 2:7 1:5 1:8 0:5 0:8');
  });

  test('five boxes, each two notes per string', () => {
    const boxes = pentatonicBoxes(guitar, scaleNotes('A', 'minor-pentatonic'), 17);
    expect(boxes.map((b) => b.label)).toEqual(['Box 1', 'Box 2', 'Box 3', 'Box 4', 'Box 5']);
    for (const b of boxes) expect(b.cells).toHaveLength(12);
  });

  test('three notes per string, G major pattern 1', () => {
    const [p1] = threeNotesPerString(guitar, scaleNotes('G', 'major'), 17);
    expect(cells(p1!.cells)).toBe('5:3 5:5 5:7 4:3 4:5 4:7 3:4 3:5 3:7 2:4 2:5 2:7 1:5 1:7 1:8 0:5 0:7 0:8');
  });

  test('a shape that would start below the nut moves up an octave', () => {
    const shape = perStringShape(bass4, scaleNotes('E', 'minor-pentatonic'), 0, 2, 15);
    expect(Math.min(...shape.map((c) => c.fret))).toBeGreaterThanOrEqual(0);
  });

  test('CAGED windows for C, standard tuning only', () => {
    expect(cagedWindows(guitar, 0)!.map((w) => `${w.label} ${w.lo}-${w.hi}`)).toEqual([
      'C shape 0-4', 'A shape 3-7', 'G shape 5-9', 'E shape 8-12', 'D shape 10-14',
    ]);
    expect(cagedWindows(bass4, 0)).toBeNull();
    expect(cagedWindows({ ...guitar, tuning: ['D2', 'A2', 'D3', 'G3', 'B3', 'E4'] }, 0)).toBeNull();
  });
});

describe('triads', () => {
  test('string sets, lowest string first', () => {
    expect(stringSets(guitar)).toEqual([[5, 4, 3], [4, 3, 2], [3, 2, 1], [2, 1, 0]]);
    expect(stringSets(bass4)).toEqual([[3, 2, 1], [2, 1, 0]]);
  });

  test('C major on the G, B and E strings in each inversion, plus the octave up', () => {
    const c = chord('C').notes;
    expect(triadShapes(guitar, c, [2, 1, 0], 0, 17).map(cells)).toEqual(['2:5 1:5 0:3', '2:17 1:17 0:15']);
    expect(triadShapes(guitar, c, [2, 1, 0], 1, 17).map(cells)).toEqual(['2:9 1:8 0:8']);
    expect(triadShapes(guitar, c, [2, 1, 0], 2, 17).map(cells)).toEqual(['2:0 1:1 0:0', '2:12 1:13 0:12']);
  });

  test('G major on the low three bass strings', () => {
    expect(triadShapes(bass4, chord('G').notes, [3, 2, 1], 0, 15).map(cells)).toEqual(['3:3 2:2 1:0', '3:15 2:14 1:12']);
  });
});
