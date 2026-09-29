// Chord shapes -> dots for ShapeCard (D-19): intervals on a guitar voicing,
// play-order numbers on a bass arpeggio; the root marked either way (U-13).
import { mod12 } from '../music/chordTones';
import { positionAt, type Cell } from '../music/positions';
import { pcOf, type ChordInfo } from '../music/spell';
import type { Instrument } from '../music/tuning';
import type { Voicing } from '../music/voicings';
import type { NeckDot } from './TheoryNeck';

function intervalOf(chord: ChordInfo, pc: number): string {
  const all = chord.extraBass ? [...chord.notes, chord.extraBass] : chord.notes;
  return all.find((n) => n.pc === pc)?.interval ?? '';
}

export function voicingDots(inst: Instrument, chord: ChordInfo, v: Voicing): NeckDot[] {
  const rootPc = pcOf(chord.root)!;
  return v.frets.map((fret, string) => {
    if (fret === null) return { string, fret: 0, label: '', marker: 'mute' as const };
    const pc = positionAt(inst, { string, fret }).pc;
    return { string, fret, label: intervalOf(chord, pc), marker: pc === rootPc ? ('root' as const) : ('tone' as const) };
  });
}

export function orderDots(inst: Instrument, rootPc: number, cells: readonly Cell[]): NeckDot[] {
  return cells.map((cell, i) => ({
    ...cell,
    label: String(i + 1),
    marker: mod12(positionAt(inst, cell).pc - rootPc) === 0 ? 'root' : 'tone',
  }));
}
