// The guitar Tabs' second TabSource (D-20): per bar a chord shape and a strum,
// generated from the chord chart. The style picks which shapes a chord may
// take, a Viterbi pass over the whole song picks one per bar so the hand moves
// as little as it can, and the strum says when to hit it. Deterministic: the
// same song and settings always draw the same shapes.
//
// Every fallback is written into the bar's substitutions and drawn, never
// silently swapped (N-08): a style with no shape for a chord, a position
// window with none in it, a simplified chord, a push with nothing to push into.
import type { PlayAlongGuitar } from '../api/client';
import { parseChord, type ChordTones } from './chordTones';
import { guitarChord, simplify } from './guitarChords';
import { degreesOf, shapesFor, type GuitarShape, type GuitarStyle } from './guitarShapes';
import { resolveKey, tonesText, type EmptyKind, type ResolvedKey } from './patterns';
import { strumStrokes, withoutDownbeat, type Stroke } from './strums';
import { chordLabels, nextBarOf, type BarSummary, type TabSource } from './tabSource';

export interface GuitarBar {
  bar: number;
  /** The analysis's label, as written. */
  label: string;
  empty: EmptyKind | 'no_shape' | null;
  /** Why an `unparsed` label could not be read. */
  reason: string | null;
  /** The chord as heard (transposed), before Simplify; null for an empty bar. */
  heard: string | null;
  /** The chord as played, after Simplify. */
  chord: string | null;
  shape: GuitarShape | null;
  /** Chord degree per row (row 0 = high e), null for a muted string. */
  degrees: (string | null)[];
  strokes: Stroke[];
  /** The chord an early (push) stroke plays, else null. */
  pushChord: string | null;
  substitutions: string[];
}

/** Which style to try next when a style has no shape for a chord. */
const CHAIN: Record<GuitarStyle, readonly GuitarStyle[]> = {
  open: ['open', 'barre', 'triad'],
  barre: ['barre', 'triad'],
  power: ['power', 'barre', 'triad'],
  triad: ['triad'],
};

const WINDOW = { low: [0, 5], mid: [5, 9] } as const;

const fits = (s: GuitarShape, [lo, hi]: readonly [number, number]) =>
  s.frets.every((f) => f === null || f === 0 || (f >= lo && f <= hi));

interface Draft {
  bar: number;
  label: string;
  empty: GuitarBar['empty'];
  reason: string | null;
  heard: string | null;
  chord: string | null;
  tones: ChordTones | null;
  candidates: GuitarShape[];
  substitutions: string[];
  missedWindow: 'low' | 'mid' | null;
}

function draftBar(bar: number, label: string, key: ResolvedKey, settings: PlayAlongGuitar, transpose: number): Draft {
  const base: Draft = {
    bar, label, empty: null, reason: null, heard: null, chord: null, tones: null,
    candidates: [], substitutions: [], missedWindow: null,
  };
  const parsed = parseChord(label, transpose);
  if (parsed.kind === 'no_chord') return { ...base, empty: 'no_chord' };
  if (parsed.kind === 'unclassified') return { ...base, empty: 'unclassified' };
  if (parsed.kind === 'unparsed') return { ...base, empty: 'unparsed', reason: parsed.reason };

  const tones = settings.simplify ? simplify(parsed.tones) : parsed.tones;
  const heard = tonesText(parsed.tones, key);
  const chord = tonesText(tones, key);
  const substitutions = chord !== heard ? [`${heard} → ${chord}`] : [];
  const read = guitarChord(tones, key);
  if (!read.ok) return { ...base, heard, chord, tones, empty: 'unparsed', reason: read.reason, substitutions };

  for (const style of CHAIN[settings.style]) {
    let candidates = shapesFor(style, read.chord);
    if (candidates.length === 0) continue;
    if (style !== settings.style) substitutions.push(`no ${settings.style} ${chord}, using ${style}`);
    if (style === 'triad' && tones.seventh !== null) substitutions.push(`${chord} as a ${tonesText(simplify(tones), key)} triad`);
    let missedWindow: Draft['missedWindow'] = null;
    if (settings.position !== 'auto' && style !== 'open') {
      const inWindow = candidates.filter((s) => fits(s, WINDOW[settings.position as 'low' | 'mid']));
      if (inWindow.length > 0) candidates = inWindow;
      else missedWindow = settings.position as 'low' | 'mid';
    }
    return { ...base, heard, chord, tones, candidates, substitutions, missedWindow };
  }
  return { ...base, heard, chord, tones, empty: 'no_shape', substitutions };
}

/** Within a shape: wide stretches and muted strings cost, and so does climbing the neck, a little. */
const shapeCost = (s: GuitarShape) => s.span + 0.5 * s.muted + 0.05 * s.anchor;
/** Between bars: the hand moving. Weighted most, so a song stays in one place when it can. */
const moveCost = (a: GuitarShape, b: GuitarShape) => 2 * Math.abs(a.anchor - b.anchor);

/** Viterbi over one run of consecutive bars that all have candidates. Ties keep the earlier (lower) candidate. */
function bestPath(states: GuitarShape[][]): GuitarShape[] {
  let cost = states[0]!.map(shapeCost);
  const back: number[][] = [];
  for (let k = 1; k < states.length; k++) {
    const prev = states[k - 1]!;
    const nextCost: number[] = [];
    const pointers: number[] = [];
    for (const s of states[k]!) {
      let best = Infinity;
      let arg = 0;
      prev.forEach((p, pi) => {
        const c = cost[pi]! + moveCost(p, s);
        if (c < best) {
          best = c;
          arg = pi;
        }
      });
      nextCost.push(best + shapeCost(s));
      pointers.push(arg);
    }
    cost = nextCost;
    back.push(pointers);
  }
  let arg = cost.indexOf(Math.min(...cost));
  const path: GuitarShape[] = new Array(states.length);
  for (let k = states.length - 1; k >= 0; k--) {
    path[k] = states[k]![arg]!;
    if (k > 0) arg = back[k - 1]![arg]!;
  }
  return path;
}

function chooseShapes(drafts: Draft[]): (GuitarShape | null)[] {
  const chosen: (GuitarShape | null)[] = drafts.map(() => null);
  // An empty bar breaks the chain: the hand is free to move during a rest.
  let i = 0;
  while (i < drafts.length) {
    if (drafts[i]!.candidates.length === 0) {
      i++;
      continue;
    }
    let j = i;
    while (j < drafts.length && drafts[j]!.candidates.length > 0) j++;
    bestPath(drafts.slice(i, j).map((d) => d.candidates)).forEach((s, k) => (chosen[i + k] = s));
    i = j;
  }
  return chosen;
}

/** D-20's pipeline over bare chord labels: draft each bar, choose shapes, add strums and pushes. */
export function guitarBars(
  labels: readonly string[],
  key: ResolvedKey,
  settings: PlayAlongGuitar,
  beatsPerBar: number,
  transpose: number,
  nextOf: (bar: number) => number | null,
): GuitarBar[] {
  const drafts = labels.map((label, bar) => draftBar(bar, label, key, settings, transpose));
  const chosen = chooseShapes(drafts);

  const bars: GuitarBar[] = drafts.map((d, index) => {
    const shape = chosen[index] ?? null;
    const substitutions = [...d.substitutions];
    if (shape && d.missedWindow) substitutions.push(`no ${d.missedWindow}-position ${d.chord}, fret ${shape.anchor}`);
    let strokes = shape ? strumStrokes(settings.strum, beatsPerBar) : [];
    let pushChord: string | null = null;
    const early = strokes.findIndex((s) => s.early);
    if (early >= 0) {
      const target = nextOf(index);
      if (target !== null && chosen[target]) {
        pushChord = drafts[target]!.chord;
      } else {
        strokes = strokes.map((s) => ({ ...s, early: false }));
        substitutions.push(target === null ? 'no push past the last bar' : 'no push into an empty bar');
      }
    }
    return {
      bar: d.bar,
      label: d.label,
      empty: d.empty,
      reason: d.reason,
      heard: d.heard,
      chord: d.chord,
      shape,
      degrees: shape && d.tones ? degreesOf(shape, d.tones) : [],
      strokes,
      pushChord,
      substitutions,
    };
  });

  // A bar pushed into has its downbeat tied over from the push.
  bars.forEach((b, index) => {
    if (b.pushChord === null) return;
    const target = nextOf(index)!;
    bars[target] = { ...bars[target]!, strokes: withoutDownbeat(bars[target]!.strokes) };
  });
  return bars;
}

export const guitarSource: TabSource<GuitarBar> = {
  barsFor({ song, analysis, grid, loop }) {
    const transpose = song.playback.pitch_semitones;
    const key = resolveKey(song.play_along.key, analysis.key_candidates, transpose);
    if (!key) {
      return { ok: false, error: 'The analysis found no key candidates, so there is no key to spell the chords in.' };
    }
    const labels = chordLabels(analysis);
    const nextOf = nextBarOf(labels.length, loop);
    return { ok: true, key, bars: guitarBars(labels, key, song.play_along.guitar, grid.beatsPerBar, transpose, nextOf), nextOf };
  },
};

/** The chord as played, or what the bar is instead. */
export function guitarChordText(bar: GuitarBar): string {
  if (bar.empty === 'no_chord') return 'no chord';
  if (bar.empty === 'unclassified') return 'unclassified';
  if (bar.empty === 'unparsed') return `unreadable chord "${bar.label}"`;
  return bar.chord!;
}

/** What an empty neck says, or null when the bar has a shape. */
export function guitarEmptyText(bar: GuitarBar): string | null {
  if (bar.shape) return null;
  if (bar.empty === 'no_shape') return `no playable shape for ${bar.chord}`;
  return guitarChordText(bar);
}

/** Index of the stroke sounding `beatsInto` beats into the bar (each lasts an eighth), or -1. */
export function strokeIndexAt(bar: GuitarBar, beatsInto: number): number {
  return bar.strokes.findIndex((s) => beatsInto >= s.beat && beatsInto < s.beat + 0.5);
}

/** One line for screen readers and tests: "Bar 5, G: 320003". */
export function describeGuitarBar(bar: GuitarBar | undefined): string {
  if (!bar) return 'past the end of the chord chart';
  const head = `Bar ${bar.bar + 1}, ${guitarChordText(bar)}`;
  return bar.shape ? `${head}: ${bar.shape.tab}` : head;
}

export function guitarSummaries(bars: readonly GuitarBar[]): BarSummary[] {
  return bars.map((b) => ({
    bar: b.bar,
    text: guitarChordText(b),
    cell:
      b.empty === 'no_chord' ? '–' : b.empty === 'unclassified' || b.empty === 'unparsed' ? '?' : (b.heard ?? b.chord!),
    sub: b.heard !== null && b.chord !== null && b.heard !== b.chord ? `→ ${b.chord}` : null,
    note: [...b.substitutions, ...(b.reason ? [b.reason] : [])].join(' · '),
  }));
}
