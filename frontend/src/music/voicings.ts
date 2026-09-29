// Chord shapes (D-19): guitar voicings found by search, and bass arpeggio
// shapes. Nothing is looked up from a chord dictionary, so any tuning works and
// every result can be checked against the rules below by the tests.
import { mod12 } from './chordTones';
import { rowMidi, type Cell } from './positions';
import type { ChordInfo } from './spell';
import { pcOf } from './spell';
import type { Instrument } from './tuning';

export interface Voicing {
  /** Fret per row (row 0 = highest string); null = muted. */
  frets: (number | null)[];
  /** "x02010": low string first, dashes between frets when any is above 9. */
  tab: string;
  label: string;
}

const ORDINAL = ['1st', '2nd', '3rd', '4th', '5th', '6th'];

export function tabOf(frets: readonly (number | null)[]): string {
  const low = [...frets].reverse();
  const parts = low.map((f) => (f === null ? 'x' : String(f)));
  return low.some((f) => f !== null && f > 9) ? parts.join('-') : parts.join('');
}

function fingers(fretted: number[]): number {
  if (fretted.length === 0) return 0;
  const min = Math.min(...fretted);
  const atMin = fretted.filter((f) => f === min).length;
  // Two or more strings at the lowest fret are one barre finger.
  return atMin >= 2 ? 1 + fretted.filter((f) => f > min).length : fretted.length;
}

/**
 * The rules every voicing obeys (also what the tests assert):
 * - sounding strings are one unbroken run of at least 4 strings;
 * - the lowest sounding note is the chord's bass (root, or slash note);
 * - every chord tone sounds, except that a chord of 4+ notes may drop its 5th;
 * - no other notes;
 * - fretted notes span at most 4 frets (max − min ≤ 3) and need at most 4 fingers.
 */
export function isPlayable(inst: Instrument, chord: ChordInfo, frets: readonly (number | null)[]): boolean {
  const open = rowMidi(inst);
  const sounding = frets.map((f, row) => (f === null ? null : { row, midi: open[row]! + f, fret: f }));
  const rows = sounding.filter((s) => s !== null).map((s) => s!.row);
  if (rows.length < 4 || rows[rows.length - 1]! - rows[0]! !== rows.length - 1) return false;
  const tones = new Set(chord.notes.map((n) => n.pc));
  const bassPc = pcOf(chord.bass ?? chord.root)!;
  if (chord.extraBass) tones.add(chord.extraBass.pc);
  const notes = sounding.filter((s) => s !== null).map((s) => s!);
  const lowest = notes.reduce((a, b) => (b.midi < a.midi ? b : a));
  if (mod12(lowest.midi) !== bassPc) return false;
  const played = new Set(notes.map((n) => mod12(n.midi)));
  if ([...played].some((pc) => !tones.has(pc))) return false;
  const fifth = chord.notes.find((n) => n.interval === '5')?.pc;
  const required = [...tones].filter((pc) => !(chord.notes.length >= 4 && pc === fifth));
  if (required.some((pc) => !played.has(pc))) return false;
  const fretted = notes.map((n) => n.fret).filter((f) => f > 0);
  if (fretted.length && Math.max(...fretted) - Math.min(...fretted) > 3) return false;
  return fingers(fretted) <= 4;
}

function label(frets: readonly (number | null)[], slash: boolean): string {
  const fretted = frets.filter((f): f is number => f !== null && f > 0);
  const hasOpen = frets.some((f) => f === 0);
  if (hasOpen && Math.max(0, ...fretted) <= 4) return 'Open';
  const bassRow = frets.reduce<number>((acc, f, row) => (f !== null ? row : acc), 0);
  return `${slash ? 'Bass' : 'Root'} on ${ORDINAL[bassRow]} string · fret ${frets[bassRow]}`;
}

/** Up to `limit` guitar voicings, lowest on the neck first, one per starting fret. */
export function guitarVoicings(inst: Instrument, chord: ChordInfo, limit = 9): Voicing[] {
  const open = rowMidi(inst);
  const tones = new Set(chord.notes.map((n) => n.pc));
  if (chord.extraBass) tones.add(chord.extraBass.pc);
  const best = new Map<number, { frets: (number | null)[]; score: number }>();
  for (let lo = 1; lo <= 12; lo++) {
    const options = open.map((o) => {
      const opts: (number | null)[] = [null];
      if (lo === 1 && tones.has(mod12(o))) opts.push(0);
      for (let f = lo; f <= lo + 3; f++) if (tones.has(mod12(o + f))) opts.push(f);
      return opts;
    });
    const pick: (number | null)[] = [];
    const walk = (row: number) => {
      if (row === open.length) {
        if (!isPlayable(inst, chord, pick)) return;
        const fretted = pick.filter((f): f is number => f !== null && f > 0);
        const min = fretted.length ? Math.min(...fretted) : 0;
        const sounding = pick.filter((f) => f !== null).length;
        const score = sounding * 10 + pick.filter((f) => f === 0).length - fingers(fretted);
        const prev = best.get(min);
        if (!prev || score > prev.score) best.set(min, { frets: [...pick], score });
        return;
      }
      for (const o of options[row]!) {
        pick[row] = o;
        walk(row + 1);
      }
    };
    walk(0);
  }
  return [...best.entries()]
    .sort((a, b) => b[1].score - a[1].score || a[0] - b[0])
    .slice(0, limit)
    .sort((a, b) => a[0] - b[0])
    .map(([, v]) => ({ frets: v.frets, tab: tabOf(v.frets), label: label(v.frets, chord.bass !== null && chord.bass !== chord.root) }));
}

export interface ArpeggioShape {
  label: string;
  /** In play order, low to high. */
  cells: Cell[];
}

/**
 * Places `steps` (semitones above the root, ascending) starting from the root on
 * row `rootRow`, each on the lowest string it fits on within one-finger-per-fret
 * reach of the root (root fret −1 … +3). Stops at the first note that does not fit.
 */
function arpeggio(inst: Instrument, rootPc: number, rootRow: number, steps: number[]): Cell[] {
  const open = rowMidi(inst);
  const rootFret = mod12(rootPc - open[rootRow]!) || 12;
  const rootMidi = open[rootRow]! + rootFret;
  const cells: Cell[] = [];
  let row = rootRow;
  for (const step of steps) {
    const midi = rootMidi + step;
    let placed = false;
    for (let r = row; r >= 0; r--) {
      const fret = midi - open[r]!;
      if (fret >= Math.max(0, rootFret - 1) && fret <= rootFret + 3) {
        cells.push({ string: r, fret });
        row = r;
        placed = true;
        break;
      }
    }
    if (!placed) break;
  }
  return cells;
}

/** Bass arpeggio cards: the chord from the root on the two lowest strings, and root–5th–octave. */
export function bassArpeggios(inst: Instrument, chord: ChordInfo): ArpeggioShape[] {
  const rootPc = pcOf(chord.root)!;
  const semis = chord.notes.map((n) => mod12(n.pc - rootPc)).sort((a, b) => a - b);
  const steps = [...semis, 12];
  const low = inst.strings - 1;
  const names = [...inst.tuning].reverse().map((n) => n.replace(/\d+$/, ''));
  return [
    { label: `From the root on the ${names[low]} string`, cells: arpeggio(inst, rootPc, low, steps) },
    { label: `From the root on the ${names[low - 1]} string`, cells: arpeggio(inst, rootPc, low - 1, steps) },
    { label: 'Root, 5th, octave', cells: arpeggio(inst, rootPc, low, [0, 7, 12]) },
  ].filter((s) => s.cells.length >= 3);
}
