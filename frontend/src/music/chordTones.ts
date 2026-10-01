// The analysis's chord labels, read into the intervals a bass line is built
// from (D-18). Labels are BTC's large vocabulary as recognize.py emits them: a
// bare root ("C#") is major, otherwise "root:quality" with one of 14
// qualities; "N" is no chord and "X" is unclassifiable. A "/degree" slash
// suffix is accepted too, though the current model never emits one, so a
// future chord or transcription source works unchanged.
//
// Pure arithmetic with no failure mode of its own: a label it cannot read is
// returned as `unparsed` with the label in the reason, never treated as major
// (N-08). The chords themselves are probabilistic (R-05); reading them is not.
import { pitchClassOf } from './theory';

export const mod12 = (n: number): number => ((n % 12) + 12) % 12;

/** Semitones above the root. A sus chord's 2 or 4 sits where the third would. */
export interface Shape {
  third: number;
  fifth: number;
  seventh: number | null;
}

export interface ChordTones extends Shape {
  /** Pitch class of the root, after transposition. */
  rootPc: number;
  /** Pitch class the bass plays: the slash note if there is one, else the root. */
  bassPc: number;
  quality: string;
}

export type ParsedChord =
  | { kind: 'chord'; tones: ChordTones }
  | { kind: 'no_chord' }
  | { kind: 'unclassified' }
  | { kind: 'unparsed'; reason: string };

const SHAPES: Record<string, Shape> = {
  maj: { third: 4, fifth: 7, seventh: null },
  min: { third: 3, fifth: 7, seventh: null },
  dim: { third: 3, fifth: 6, seventh: null },
  aug: { third: 4, fifth: 8, seventh: null },
  min6: { third: 3, fifth: 7, seventh: null },
  maj6: { third: 4, fifth: 7, seventh: null },
  min7: { third: 3, fifth: 7, seventh: 10 },
  minmaj7: { third: 3, fifth: 7, seventh: 11 },
  maj7: { third: 4, fifth: 7, seventh: 11 },
  '7': { third: 4, fifth: 7, seventh: 10 },
  dim7: { third: 3, fifth: 6, seventh: 9 },
  hdim7: { third: 3, fifth: 6, seventh: 10 },
  sus2: { third: 2, fifth: 7, seventh: null },
  sus4: { third: 5, fifth: 7, seventh: null },
};

/** The qualities recognize.py's _QUALITIES can produce. */
export const CHORD_QUALITIES: readonly string[] = Object.keys(SHAPES);

// Slash degrees are scale degrees of the chord root, where "b" is a degree
// flat, not a note name (the same reading chords.ts documents for display).
const DEGREES: Record<string, number> = {
  '1': 0,
  b2: 1,
  '2': 2,
  b3: 3,
  '3': 4,
  '4': 5,
  '#4': 6,
  b5: 6,
  '5': 7,
  '#5': 8,
  b6: 8,
  '6': 9,
  bb7: 9,
  b7: 10,
  '7': 11,
};

export function parseChord(label: string, transpose: number): ParsedChord {
  if (label === 'N') return { kind: 'no_chord' };
  if (label === 'X') return { kind: 'unclassified' };

  const [head = '', slash] = label.split('/');
  const [rootName = '', quality = 'maj'] = head.split(':');

  let rootPc: number;
  try {
    rootPc = pitchClassOf(rootName);
  } catch {
    return { kind: 'unparsed', reason: `unknown root "${rootName}" in chord "${label}"` };
  }
  const shape = SHAPES[quality];
  if (!shape) return { kind: 'unparsed', reason: `unknown chord quality "${quality}" in "${label}"` };

  let bassOffset = 0;
  if (slash !== undefined) {
    const degree = DEGREES[slash];
    if (degree === undefined) {
      return { kind: 'unparsed', reason: `unknown bass degree "${slash}" in chord "${label}"` };
    }
    bassOffset = degree;
  }

  const root = mod12(rootPc + transpose);
  return {
    kind: 'chord',
    tones: { rootPc: root, bassPc: mod12(root + bassOffset), ...shape, quality },
  };
}

/** The same root and bass with another quality's intervals (Simplify, D-20). */
export function withQuality(tones: ChordTones, quality: string): ChordTones {
  const shape = SHAPES[quality];
  if (!shape) throw new Error(`unknown chord quality "${quality}"`);
  return { ...tones, ...shape, quality };
}
