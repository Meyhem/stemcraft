import { describe, expect, test } from 'vitest';

import { cagedWindows, isStandardGuitar, pentatonicBoxes, perStringShape, stringSets, threeNotesPerString, triadShapes } from './shapes';
import { SCALES, chordInfo, scaleNotes, type ChordInfo } from './spell';
import { DEFAULT_INSTRUMENT, instrumentFor, neckFrets } from './tuning';
import { rowMidi } from './positions';

const guitar = instrumentFor('guitar6', false);
const bass4 = DEFAULT_INSTRUMENT;
const bass5 = instrumentFor('bass5', false);
const guitarDropD = { ...guitar, tuning: ['D2', 'A2', 'D3', 'G3', 'B3', 'E4'] };

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
    expect(cagedWindows(guitarDropD, 0)).toBeNull();
  });

  test('maxFret regression: C harmonic-minor Pattern 3 on bass4 has no playable shapes over fret 15', () => {
    const shapes = threeNotesPerString(bass4, scaleNotes('C', 'harmonic-minor'), 15);
    // Pattern 3 should be dropped or have no cells
    const pattern3 = shapes.find((s) => s.label === 'Pattern 3');
    expect(pattern3?.cells.length === 0 || pattern3 === undefined).toBe(true);
  });

  test('guard: empty scale returns empty shape', () => {
    expect(perStringShape(bass4, [], 0, 2, 15)).toEqual([]);
  });

  test('guard: start out of range returns empty shape', () => {
    const scale = scaleNotes('C', 'major');
    expect(perStringShape(bass4, scale, -1, 3, 15)).toEqual([]);
    expect(perStringShape(bass4, scale, scale.length, 3, 15)).toEqual([]);
  });

  test('isStandardGuitar: exact E2 A2 D3 G3 B3 E4 tuning', () => {
    expect(isStandardGuitar(guitar)).toBe(true);
    expect(isStandardGuitar(bass4)).toBe(false);
    expect(isStandardGuitar(guitarDropD)).toBe(false);
  });
});

describe('scale shape invariants', () => {
  // Pentatonic boxes (5-note scales): 5 degrees
  const pentatonicScales = SCALES.filter((s) => s.id === 'major-pentatonic' || s.id === 'minor-pentatonic');

  test.each(pentatonicScales)('$id boxes: every box has exactly 2 notes per string', (scaleInfo) => {
    for (let root = 0; root < 12; root++) {
      const rootName = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'][root]!;
      const scale = scaleNotes(rootName, scaleInfo.id as any);
      const instList = [bass4, bass5, guitar, guitarDropD];

      for (const inst of instList) {
        const maxFret = neckFrets(inst);
        const boxes = pentatonicBoxes(inst, scale, maxFret);
        for (const box of boxes) {
          if (box.cells.length > 0) {
            // 2 notes per string, so 2 * (number of strings) notes
            expect(box.cells).toHaveLength(2 * rowMidi(inst).length);
            // All notes strictly ascending
            const midis = box.cells.map((c) => rowMidi(inst)[c.string]! + c.fret);
            for (let i = 1; i < midis.length; i++) {
              expect(midis[i]).toBeGreaterThan(midis[i - 1]!);
            }
            // No negative frets
            expect(Math.min(...box.cells.map((c) => c.fret))).toBeGreaterThanOrEqual(0);
            // No frets above maxFret
            expect(Math.max(...box.cells.map((c) => c.fret))).toBeLessThanOrEqual(maxFret);
          }
        }
      }
    }
  });

  // Three-notes-per-string (7-note scales): 7 degrees
  const sevenNoteScales = SCALES.filter((s) =>
    ['major', 'minor', 'dorian', 'phrygian', 'lydian', 'mixolydian', 'locrian', 'harmonic-minor', 'melodic-minor'].includes(
      s.id,
    ),
  );

  test.each(sevenNoteScales)('$id patterns: every pattern has exactly 3 notes per string', (scaleInfo) => {
    for (let root = 0; root < 12; root++) {
      const rootName = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'][root]!;
      const scale = scaleNotes(rootName, scaleInfo.id as any);
      const instList = [bass4, bass5, guitar, guitarDropD];

      for (const inst of instList) {
        const maxFret = neckFrets(inst);
        const patterns = threeNotesPerString(inst, scale, maxFret);
        for (const pattern of patterns) {
          if (pattern.cells.length > 0) {
            // 3 notes per string
            expect(pattern.cells).toHaveLength(3 * rowMidi(inst).length);
            // All notes strictly ascending
            const midis = pattern.cells.map((c) => rowMidi(inst)[c.string]! + c.fret);
            for (let i = 1; i < midis.length; i++) {
              expect(midis[i]).toBeGreaterThan(midis[i - 1]!);
            }
            // No negative frets
            expect(Math.min(...pattern.cells.map((c) => c.fret))).toBeGreaterThanOrEqual(0);
            // No frets above maxFret
            expect(Math.max(...pattern.cells.map((c) => c.fret))).toBeLessThanOrEqual(maxFret);
          }
        }
      }
    }
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

describe('triad shape invariants', () => {
  const triadKinds = ['maj', 'm', 'dim', 'aug'] as const;

  test.each(triadKinds)('$0 triads: every voicing has exactly 3 chord tones in ascending pitch', (kind) => {
    for (let root = 0; root < 12; root++) {
      const rootName = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'][root]!;
      const chordSymbol = kind === 'maj' ? rootName : kind === 'dim' ? `${rootName}dim` : kind === 'aug' ? `${rootName}aug` : `${rootName}m`;
      const chordInfo = chord(chordSymbol);
      const instList = [bass4, guitar];

      for (const inst of instList) {
        const maxFret = neckFrets(inst);
        const sets = stringSets(inst);
        for (const set of sets) {
          for (let inv = 0; inv < 3; inv++) {
            const shapes = triadShapes(inst, chordInfo.notes, set, inv as any, maxFret);
            for (const shape of shapes) {
              // Exactly 3 chord tones
              expect(shape).toHaveLength(3);
              // Ascending pitch
              const midis = shape.map((c) => rowMidi(inst)[c.string]! + c.fret);
              for (let i = 1; i < midis.length; i++) {
                expect(midis[i]).toBeGreaterThan(midis[i - 1]!);
              }
              // No negative frets
              expect(Math.min(...shape.map((c) => c.fret))).toBeGreaterThanOrEqual(0);
              // No frets above maxFret
              expect(Math.max(...shape.map((c) => c.fret))).toBeLessThanOrEqual(maxFret);
              // Fretted span <= 4
              const fretted = shape.map((c) => c.fret).filter((f) => f > 0);
              if (fretted.length > 0) {
                expect(Math.max(...fretted) - Math.min(...fretted)).toBeLessThanOrEqual(4);
              }
            }
          }
        }
      }
    }
  });
});

describe('CAGED windows', () => {
  test('standard guitar has exactly 5 windows of width 5 for every root', () => {
    for (let root = 0; root < 12; root++) {
      const windows = cagedWindows(guitar, root);
      expect(windows).not.toBeNull();
      expect(windows!).toHaveLength(5);
      for (const w of windows!) {
        expect(w.hi - w.lo).toBe(4); // width 5 = hi - lo = 4
      }
    }
  });

  test('non-standard tunings return null', () => {
    expect(cagedWindows(bass4, 0)).toBeNull();
    expect(cagedWindows(bass5, 0)).toBeNull();
    expect(cagedWindows(guitarDropD, 0)).toBeNull();
  });
});
