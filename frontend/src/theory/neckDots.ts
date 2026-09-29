// Spelled notes -> dots on the neck (D-19). The label is the note, its interval
// from the root, its scale degree, or nothing; the root is marked (U-13); a dot
// outside the highlighted position is dimmed, not hidden.
import { positionsOf } from '../music/positions';
import { pretty, type Spelled } from '../music/spell';
import type { Instrument } from '../music/tuning';
import type { NeckDot } from './TheoryNeck';

export type LabelMode = 'note' | 'interval' | 'degree' | 'none';

export function noteDots(
  inst: Instrument,
  notes: readonly Spelled[],
  options: { lo: number; hi: number; labels: LabelMode; window?: { lo: number; hi: number } | null },
): NeckDot[] {
  const rootPc = notes[0]?.pc;
  const byPc = new Map(notes.map((n, i) => [n.pc, { note: n, degree: i + 1 }]));
  return positionsOf(inst, new Set(byPc.keys()), options.lo, options.hi).map((p) => {
    const { note, degree } = byPc.get(p.pc)!;
    const label =
      options.labels === 'note' ? pretty(note.name)
      : options.labels === 'interval' ? note.interval
      : options.labels === 'degree' ? String(degree)
      : '';
    const w = options.window;
    return {
      string: p.string,
      fret: p.fret,
      label,
      marker: p.pc === rootPc ? 'root' : 'tone',
      dim: w ? p.fret < w.lo || p.fret > w.hi : false,
    };
  });
}
