// frontend/src/music/fingering.ts
// Where on the neck each planned note is played (D-18). The same G can be E3,
// A10 or an octave up on D5/G0; a line that jumps between them bar to bar is
// unplayable at tempo. So the choice is made over the whole song at once: each
// bar's state is (bass note octave, hand position), and a Viterbi pass finds
// the cheapest path through them, costed by hand movement between bars, stretch
// within a bar and a mild preference for low positions. Deterministic: the same
// song and settings always draw the same neck.
//
// 4-string bass, standard EADG tuning, frets 0-12.
import type { PatternApproach } from '../api/client';
import { mod12 } from './chordTones';
import { approachPitch, spell, type BarPlan, type ResolvedKey } from './patterns';

/** MIDI of the open strings, low E first. */
export const OPEN_STRINGS: readonly number[] = [28, 33, 38, 43];
export const MAX_FRET = 12;
export const LOWEST = OPEN_STRINGS[0]!;
export const HIGHEST = OPEN_STRINGS[OPEN_STRINGS.length - 1]! + MAX_FRET;

/** A hand position spans anchor..anchor+SPAN: one finger per fret plus a one-fret stretch. */
const SPAN = 4;
const MAX_ANCHOR = MAX_FRET - SPAN;

export interface Position {
  /** 0 = low E. */
  string: number;
  fret: number;
}

export interface PlacedNote {
  midi: number;
  name: string;
  beat: number;
  beats: number;
  approach: boolean;
  position: Position;
}

export interface PlacedBar {
  plan: BarPlan;
  bassMidi: number | null;
  anchor: number | null;
  notes: PlacedNote[];
}

export interface PlaceOptions {
  approach: PatternApproach;
  key: ResolvedKey;
  /** Index of the bar that follows `bar` (the loop start at a loop's end), or null. */
  nextOf(bar: number): number | null;
}

export function positionsOf(midi: number): Position[] {
  const out: Position[] = [];
  OPEN_STRINGS.forEach((open, string) => {
    const fret = midi - open;
    if (fret >= 0 && fret <= MAX_FRET) out.push({ string, fret });
  });
  return out;
}

const inWindow = (p: Position, anchor: number) =>
  p.fret === 0 || (p.fret >= anchor && p.fret <= anchor + SPAN);

/** The candidate nearest `fromFret`. Ties go to the lower string, which is listed first. */
function nearest(candidates: Position[], fromFret: number): Position | null {
  let best: Position | null = null;
  for (const c of candidates) {
    if (!best || Math.abs(c.fret - fromFret) < Math.abs(best.fret - fromFret)) best = c;
  }
  return best;
}

interface State {
  bassMidi: number;
  anchor: number;
  cost: number;
  /** One per `tone` slot, in order. Approach slots are placed afterwards. */
  positions: Position[];
}

function barStates(plan: BarPlan): State[] {
  if (plan.bassPc === null) return [];
  const tones = plan.slots.flatMap((s) => (s.tone.kind === 'tone' ? [s.tone.semis] : []));
  const top = Math.max(0, ...tones);
  const out: State[] = [];
  for (let bassMidi = LOWEST; bassMidi + top <= HIGHEST; bassMidi++) {
    if (mod12(bassMidi) !== plan.bassPc) continue;
    for (let anchor = 1; anchor <= MAX_ANCHOR; anchor++) {
      let cost = 0.05 * anchor;
      let fromFret = anchor;
      const positions: Position[] = [];
      for (const semis of tones) {
        const p = nearest(positionsOf(bassMidi + semis).filter((c) => inWindow(c, anchor)), fromFret);
        if (!p) break;
        if (p.fret === anchor + SPAN) cost += 1;
        cost += 0.1 * Math.abs((p.fret || anchor) - fromFret);
        positions.push(p);
        fromFret = p.fret || anchor;
      }
      if (positions.length === tones.length) out.push({ bassMidi, anchor, cost, positions });
    }
  }
  return out;
}

const transition = (a: State, b: State) =>
  Math.abs(a.anchor - b.anchor) + (Math.abs(a.bassMidi - b.bassMidi) > 7 ? 1 : 0);

/** Viterbi over one run of consecutive bars that all have states. */
function bestPath(states: State[][]): State[] {
  let cost = states[0]!.map((s) => s.cost);
  const back: number[][] = [];
  for (let k = 1; k < states.length; k++) {
    const prev = states[k - 1]!;
    const nextCost: number[] = [];
    const pointers: number[] = [];
    for (const s of states[k]!) {
      let best = Infinity;
      let arg = 0;
      prev.forEach((p, pi) => {
        const c = cost[pi]! + transition(p, s);
        if (c < best) {
          best = c;
          arg = pi;
        }
      });
      nextCost.push(best + s.cost);
      pointers.push(arg);
    }
    cost = nextCost;
    back.push(pointers);
  }
  let arg = cost.indexOf(Math.min(...cost));
  const path: State[] = new Array(states.length);
  for (let k = states.length - 1; k >= 0; k--) {
    path[k] = states[k]![arg]!;
    if (k > 0) arg = back[k - 1]![arg]!;
  }
  return path;
}

export function placeBars(plans: BarPlan[], options: PlaceOptions): PlacedBar[] {
  const states = plans.map(barStates);
  const chosen: (State | null)[] = plans.map(() => null);
  // An empty bar breaks the chain: the hand is free to move during a rest.
  let i = 0;
  while (i < plans.length) {
    if (states[i]!.length === 0) {
      i++;
      continue;
    }
    let j = i;
    while (j < plans.length && states[j]!.length > 0) j++;
    bestPath(states.slice(i, j)).forEach((s, k) => (chosen[i + k] = s));
    i = j;
  }
  return plans.map((plan, index) => placeOne(plan, index, chosen, options));
}

function placeOne(
  plan: BarPlan,
  index: number,
  chosen: (State | null)[],
  { approach, key, nextOf }: PlaceOptions,
): PlacedBar {
  const state = chosen[index] ?? null;
  if (!state) return { plan, bassMidi: null, anchor: null, notes: [] };
  const notes: PlacedNote[] = [];
  let t = 0;
  for (const slot of plan.slots) {
    if (slot.tone.kind === 'tone') {
      const midi = state.bassMidi + slot.tone.semis;
      notes.push({
        midi,
        name: spell(mod12(midi), key),
        beat: slot.beat,
        beats: slot.beats,
        approach: false,
        position: state.positions[t++]!,
      });
      continue;
    }
    const target = nextOf(index);
    const next = target === null ? null : (chosen[target] ?? null);
    if (!next || approach === 'none') {
      throw new Error(`bar ${plan.bar + 1}: an approach slot, but the next bar has no notes to approach`);
    }
    const midi = approachPitch(approach, next.bassMidi, key, LOWEST);
    const candidates = positionsOf(midi);
    const position =
      nearest(candidates.filter((c) => inWindow(c, state.anchor)), state.anchor) ??
      nearest(candidates, state.anchor);
    if (!position) throw new Error(`bar ${plan.bar + 1}: approach note ${midi} is off the neck`);
    notes.push({ midi, name: spell(mod12(midi), key), beat: slot.beat, beats: slot.beats, approach: true, position });
  }
  return { plan, bassMidi: state.bassMidi, anchor: state.anchor, notes };
}
