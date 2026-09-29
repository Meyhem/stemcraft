// Scale positions and triad shapes (D-19). Every shape is computed from pitches
// and the tuning, so drop and open tunings get correct (if unfamiliar) shapes;
// CAGED is the one exception, which is defined by standard guitar tuning and
// says so instead of drawing something wrong (N-08).
import { mod12 } from './chordTones';
import { rowMidi, type Cell } from './positions';
import type { Spelled } from './spell';
import type { Instrument } from './tuning';

export interface Shape {
  label: string;
  /** The box or pattern number in `label`, which can skip when shapes were dropped. */
  number: number;
  /** Low to high pitch, which is play order. */
  cells: Cell[];
}

export interface FretWindow {
  label: string;
  lo: number;
  hi: number;
}

/** Exact E2 A2 D3 G3 B3 E4 guitar tuning. */
export function isStandardGuitar(inst: Instrument): boolean {
  return inst.kind === 'guitar' && inst.tuning.join(' ') === 'E2 A2 D3 G3 B3 E4';
}

/**
 * `perString` consecutive scale notes on each string, low string first,
 * starting from scale degree `start` on the lowest string: 2 per string gives
 * the pentatonic boxes, 3 gives the three-notes-per-string patterns.
 * Returns [] when no octave shift (0, +12, -12) places all notes within 0..maxFret.
 */
export function perStringShape(inst: Instrument, scale: readonly Spelled[], start: number, perString: number, maxFret: number): Cell[] {
  // Guard: empty scale or start out of range
  if (scale.length === 0 || start < 0 || start >= scale.length) return [];

  const open = rowMidi(inst);
  const lowRow = open.length - 1;
  const pcs = scale.map((n) => n.pc);
  const first = open[lowRow]! + mod12(pcs[start]! - open[lowRow]!);
  const pitches: number[] = [];
  for (let midi = first; pitches.length < perString * open.length; midi++) {
    if (pcs.includes(mod12(midi))) pitches.push(midi);
  }
  const place = (shift: number) =>
    pitches.map((midi, i) => {
      const string = lowRow - Math.floor(i / perString);
      return { string, fret: midi + shift - open[string]! };
    });

  // Try shifts: 0, +12, -12 in order
  for (const shift of [0, 12, -12]) {
    const cells = place(shift);
    if (cells.every((c) => c.fret >= 0 && c.fret <= maxFret)) {
      return cells;
    }
  }
  return [];
}

/** The five pentatonic boxes (5-note scales), box 1 starting on the root. Drop boxes with no playable cells; keep original numbering. */
export function pentatonicBoxes(inst: Instrument, scale: readonly Spelled[], maxFret: number): Shape[] {
  return scale
    .map((_, i) => ({ label: `Box ${i + 1}`, number: i + 1, cells: perStringShape(inst, scale, i, 2, maxFret) }))
    .filter((s) => s.cells.length > 0);
}

/** Seven three-notes-per-string patterns (7-note scales), pattern 1 starting on the root. Drop patterns with no playable cells; keep original numbering. */
export function threeNotesPerString(inst: Instrument, scale: readonly Spelled[], maxFret: number): Shape[] {
  return scale
    .map((_, i) => ({ label: `Pattern ${i + 1}`, number: i + 1, cells: perStringShape(inst, scale, i, 3, maxFret) }))
    .filter((s) => s.cells.length > 0);
}

/**
 * CAGED windows for standard guitar tuning, from where the root sits: C shape
 * ends on the root on the A string, A shape starts on it; G shape ends on the
 * root on the low E, E shape starts on it; D shape starts on the root on the D
 * string. Each window is five frets. Null for any other tuning.
 */
export function cagedWindows(inst: Instrument, rootPc: number): FretWindow[] | null {
  if (!isStandardGuitar(inst)) return null;
  const e = mod12(rootPc - 4);
  const a = mod12(rootPc - 9);
  const d = mod12(rootPc - 2);
  const win = (label: string, lo: number) => {
    const start = lo < 0 ? lo + 12 : lo;
    return { label, lo: start, hi: start + 4 };
  };
  return [win('C shape', a - 3), win('A shape', a), win('G shape', e - 3), win('E shape', e), win('D shape', d)].sort(
    (x, y) => x.lo - y.lo,
  );
}

export type Inversion = 0 | 1 | 2;
export const INVERSION_LABELS = ['Root position', '1st inversion', '2nd inversion'] as const;

/**
 * Adjacent string sets of three, low to high, as row triples (lowest string
 * first): guitar 6-5-4, 5-4-3, 4-3-2, 3-2-1; 4-string bass E-A-D, A-D-G.
 */
export function stringSets(inst: Instrument): number[][] {
  const rows = rowMidi(inst).length;
  const sets: number[][] = [];
  for (let low = rows - 1; low >= 2; low--) sets.push([low, low - 1, low - 2]);
  return sets;
}

/**
 * A triad (root, 3rd, 5th) in an inversion on one string set, closest to the
 * nut; the same shape an octave up is returned too when it fits on the neck.
 */
export function triadShapes(inst: Instrument, triad: readonly Spelled[], set: readonly number[], inversion: Inversion, maxFret: number): Cell[][] {
  const open = rowMidi(inst);
  const order = [0, 1, 2].map((i) => triad[(i + inversion) % 3]!.pc);
  const build = (octave: number) => {
    const cells: Cell[] = [];
    let prev = open[set[0]!]! + mod12(order[0]! - open[set[0]!]!) + 12 * octave;
    cells.push({ string: set[0]!, fret: prev - open[set[0]!]! });
    for (let i = 1; i < 3; i++) {
      const midi = prev + (mod12(order[i]! - prev) || 12);
      cells.push({ string: set[i]!, fret: midi - open[set[i]!]! });
      prev = midi;
    }
    return cells;
  };
  const out: Cell[][] = [];
  for (let octave = 0; octave < 3; octave++) {
    const cells = build(octave);
    const frets = cells.map((c) => c.fret);
    if (Math.min(...frets) < 0) continue;
    if (Math.max(...frets) > maxFret) break;
    const fretted = frets.filter((f) => f > 0);
    if (fretted.length === 0 || Math.max(...fretted) - Math.min(...fretted) <= 4) out.push(cells);
  }
  return out;
}
