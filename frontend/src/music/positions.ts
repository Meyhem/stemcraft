// Where notes sit on a neck, for any tuning (D-19). Rows are numbered the way
// the neck is drawn (U-13): row 0 is the highest string, at the top, and the
// last row is the lowest string. Tunings are stored low string first, so every
// lookup goes through `rowMidi`.
import { mod12 } from './chordTones';
import { openMidi, type Instrument } from './tuning';

export interface Cell {
  /** 0 = highest string (top row). */
  string: number;
  fret: number;
}

export interface Position extends Cell {
  midi: number;
  pc: number;
}

/** Open-string MIDI per row, top row (highest string) first. */
export function rowMidi(inst: Instrument): number[] {
  return [...openMidi(inst)].reverse();
}

/** Every cell from fret `lo` to `hi` (inclusive) whose pitch class is in `pcs`. */
export function positionsOf(inst: Instrument, pcs: ReadonlySet<number>, lo: number, hi: number): Position[] {
  const out: Position[] = [];
  rowMidi(inst).forEach((open, string) => {
    for (let fret = lo; fret <= hi; fret++) {
      const midi = open + fret;
      if (pcs.has(mod12(midi))) out.push({ string, fret, midi, pc: mod12(midi) });
    }
  });
  return out;
}

export function positionAt(inst: Instrument, cell: Cell): Position {
  const midi = rowMidi(inst)[cell.string]! + cell.fret;
  return { ...cell, midi, pc: mod12(midi) };
}

export interface Window {
  /** 1-based, in the order the player meets them going up from the root. */
  index: number;
  lo: number;
  hi: number;
}

/**
 * One position per scale note: a box that starts on that note on the lowest
 * string, 4 frets wide on bass (one finger per fret) and 5 on guitar. Ordered
 * from the root going up the neck, wrapping at the 12th fret, so position 1 is
 * always the one that starts on the root. A minor pentatonic on a 4-string
 * bass: 5–8, 8–11, 10–13, 12–15, 3–6.
 */
export function positionWindows(inst: Instrument, rootPc: number, scalePcs: readonly number[]): Window[] {
  const lowest = openMidi(inst)[0]!;
  const fretOf = (pc: number) => mod12(pc - lowest) || 12;
  const rootFret = fretOf(rootPc);
  const span = inst.kind === 'bass' ? 3 : 4;
  return [...new Set(scalePcs.map(mod12))]
    .map(fretOf)
    .sort((a, b) => mod12(a - rootFret) - mod12(b - rootFret))
    .map((lo, i) => ({ index: i + 1, lo, hi: lo + span }));
}
