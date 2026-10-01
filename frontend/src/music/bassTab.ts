// The transcribed bass line, made playable (D-21): transposed to what is heard,
// fitted onto a 4-string EADG neck, fingered, and grouped by bar for the neck.
// A sibling of TabSource rather than one of its implementations: its input is
// the transcription, not the chord chart.
//
// U-16: nothing is hidden or corrected silently. A note off the neck moves by
// octaves and records how far (`octave`); a low-confidence note keeps its place
// and is marked unsure.
import type { TranscribedNote } from '../api/client';
import { sampleIndex } from '../engine/types';
import { mod12 } from './chordTones';
import { HIGHEST, LOWEST, positionsOf, type Position } from './fingering';
import { barAt, type Grid } from './grid';
import { spell, type ResolvedKey } from './patterns';

/** Below this mean CREPE periodicity a note is drawn as unsure (U-16). */
export const UNSURE_BELOW = 0.75;
const SHARPS = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
/** A rest this long (2 s) frees the hand: the fingering chain restarts after it. */
const DEFAULT_RESET_GAP = 96_000;

export interface TabNote {
  /** Sample indices at 48 kHz, end exclusive. */
  start: number;
  end: number;
  /** Sounding pitch on the neck: recorded + pitch shift, then moved by `octave`. */
  midi: number;
  name: string;
  /** Octaves moved to fit the neck: +1 is "↑8", -1 "↓8", 0 as heard. */
  octave: number;
  unsure: boolean;
  position: Position;
}

export interface TabBar {
  bar: number;
  notes: TabNote[];
}

function fit(midi: number): { midi: number; octave: number } {
  let m = midi;
  let octave = 0;
  while (m < LOWEST) {
    m += 12;
    octave++;
  }
  while (m > HIGHEST) {
    m -= 12;
    octave--;
  }
  return { midi: m, octave };
}

// Hand movement between consecutive fretted notes (an open string moves nothing),
// a small price for crossing strings, and a mild preference for low positions.
const stepCost = (a: Position, b: Position) =>
  (a.fret === 0 || b.fret === 0 ? 0 : Math.abs(a.fret - b.fret)) + (a.string === b.string ? 0 : 0.3);
const placeCost = (p: Position) => 0.05 * p.fret;

/** Viterbi over one chain of notes; returns the chosen state index per note. */
function bestChain(states: Position[][]): number[] {
  let cost = states[0]!.map(placeCost);
  const back: number[][] = [];
  for (let i = 1; i < states.length; i++) {
    const prev = states[i - 1]!;
    const next: number[] = [];
    const pointers: number[] = [];
    for (const p of states[i]!) {
      let best = Infinity;
      let arg = 0;
      prev.forEach((q, k) => {
        const c = cost[k]! + stepCost(q, p);
        if (c < best) {
          best = c;
          arg = k;
        }
      });
      next.push(best + placeCost(p));
      pointers.push(arg);
    }
    cost = next;
    back.push(pointers);
  }
  const path = new Array<number>(states.length);
  let arg = cost.indexOf(Math.min(...cost));
  for (let i = states.length - 1; i >= 0; i--) {
    path[i] = arg;
    if (i > 0) arg = back[i - 1]![arg]!;
  }
  return path;
}

export function placeTranscription(
  notes: readonly TranscribedNote[],
  pitchSemitones: number,
  opts: { key?: ResolvedKey | null; resetGapSamples?: number } = {},
): TabNote[] {
  const reset = opts.resetGapSamples ?? DEFAULT_RESET_GAP;
  const fitted = notes.map((n) => fit(n.midi + pitchSemitones));
  // fit() guarantees LOWEST..HIGHEST, and every pitch there has a position.
  const states = fitted.map((f) => positionsOf(f.midi));
  const chosen: number[] = [];
  let from = 0;
  for (let i = 1; i <= notes.length; i++) {
    if (i === notes.length || notes[i]!.start - notes[i - 1]!.end > reset) {
      chosen.push(...bestChain(states.slice(from, i)));
      from = i;
    }
  }
  return notes.map((n, i) => {
    const { midi, octave } = fitted[i]!;
    return {
      start: n.start,
      end: n.end,
      midi,
      name: opts.key ? spell(mod12(midi), opts.key) : SHARPS[mod12(midi)]!,
      octave,
      unsure: n.confidence < UNSURE_BELOW,
      position: states[i]![chosen[i]!]!,
    };
  });
}

/** Notes grouped by the bar their onset falls in; a note before the first downbeat is not in any bar. */
export function tabBars(notes: readonly TabNote[], grid: Grid): TabBar[] {
  const last = notes.length > 0 ? barAt(grid, sampleIndex(notes[notes.length - 1]!.start)) : -1;
  const count = Math.max(grid.barCount, last + 1);
  const bars: TabBar[] = Array.from({ length: count }, (_, bar) => ({ bar, notes: [] }));
  for (const note of notes) {
    const bar = barAt(grid, sampleIndex(note.start));
    if (bar >= 0) bars[bar]!.notes.push(note);
  }
  return bars;
}

/** Index of the note sounding at `position`, or -1. Notes are ascending and disjoint. */
export function noteAt(notes: readonly TabNote[], position: number): number {
  let lo = 0;
  let hi = notes.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const note = notes[mid]!;
    if (position < note.start) hi = mid - 1;
    else if (position >= note.end) lo = mid + 1;
    else return mid;
  }
  return -1;
}

export function tabCounts(notes: readonly TabNote[]): { total: number; unsure: number; shifted: number } {
  return {
    total: notes.length,
    unsure: notes.filter((x) => x.unsure).length,
    shifted: notes.filter((x) => x.octave !== 0).length,
  };
}
