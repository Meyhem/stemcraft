// Where a practice line's notes sit on the neck (D-22). Standard tuning only,
// frets 0-12, string 0 = the lowest string, as in fingering.ts. A line keeps a
// hand window (one finger per fret plus a stretch, as positions.ts) and moves it
// only when a note is outside it, so scales stay in their box and arpeggios
// follow the hand from chord to chord. Deterministic.
import type { PracticeInstrument } from '../../api/client';
import { mod12 } from '../chordTones';
import { pretty } from '../spell';

export const TUNINGS: Record<PracticeInstrument, readonly number[]> = {
  bass: [28, 33, 38, 43],
  guitar: [40, 45, 50, 55, 59, 64],
};
export const STRING_NAMES: Record<PracticeInstrument, readonly string[]> = {
  bass: ['E', 'A', 'D', 'G'],
  guitar: ['E', 'A', 'D', 'G', 'B', 'e'],
};
/** Frets above the index finger the hand reaches: 4 frets on bass, 5 on guitar (positions.ts). */
export const HAND_SPAN: Record<PracticeInstrument, number> = { bass: 3, guitar: 4 };
export const PRACTICE_MAX_FRET = 12;

export interface Fretted {
  string: number;
  fret: number;
}

export function positionsOn(midi: number, inst: PracticeInstrument): Fretted[] {
  const out: Fretted[] = [];
  TUNINGS[inst].forEach((open, string) => {
    const fret = midi - open;
    if (fret >= 0 && fret <= PRACTICE_MAX_FRET) out.push({ string, fret });
  });
  return out;
}

export type PlacedLine = { ok: true; frets: Fretted[]; anchor: number } | { ok: false; midi: number };

/**
 * Frets for a line of pitches. `startAnchor` is the index finger's fret. An open
 * string always counts as in reach. Among notes in reach the lowest string wins;
 * with none in reach the nearest fret wins and the hand moves to it.
 */
export function placeLine(midis: readonly number[], inst: PracticeInstrument, startAnchor: number): PlacedLine {
  const span = HAND_SPAN[inst];
  const clampAnchor = (a: number) => Math.max(0, Math.min(PRACTICE_MAX_FRET - span, a));
  let anchor = clampAnchor(startAnchor);
  const frets: Fretted[] = [];
  for (const midi of midis) {
    const candidates = positionsOn(midi, inst);
    if (candidates.length === 0) return { ok: false, midi };
    const inReach = candidates.find((c) => c.fret === 0 || (c.fret >= anchor && c.fret <= anchor + span));
    if (inReach) {
      frets.push(inReach);
      continue;
    }
    const nearest = candidates.reduce((best, c) => (Math.abs(c.fret - anchor) < Math.abs(best.fret - anchor) ? c : best));
    frets.push(nearest);
    anchor = clampAnchor(nearest.fret > anchor + span ? nearest.fret - span : nearest.fret);
  }
  return { ok: true, frets, anchor };
}

const SHARPS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

/** Drills have no key, so they are named with sharps (the spelling rule, D-22). */
export function sharpName(pc: number): string {
  return pretty(SHARPS[mod12(pc)]!);
}

/** The lowest pitch of this pitch class on the instrument's lowest string. */
export function lowestMidiOf(pc: number, inst: PracticeInstrument): number {
  const low = TUNINGS[inst][0]!;
  return low + mod12(pc - low);
}
