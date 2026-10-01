// Where the Play along screen gets its notes (D-18). The screen asks a
// TabSource for placed bars and does not care how they were made: today the
// only source generates patterns from the chord chart; a transcription job
// (the deferred "Tabs (bonus)", tech spec §12) will be a second source with
// the same shape.
import type { Analysis, Song } from '../api/client';
import { placeBars, type PlacedBar } from './fingering';
import type { Grid } from './grid';
import { planBar, resolveKey, tonesText, type ResolvedKey } from './patterns';

/** The armed loop, 0-based bars, end exclusive (as stored in song.json). */
export interface LoopBars {
  startBar: number;
  endBar: number;
}

export interface TabSourceInput {
  song: Song;
  analysis: Analysis;
  grid: Grid;
  loop: LoopBars | null;
}

/** A source's bars: PlacedBar for the bass patterns, GuitarBar for guitar (D-20). */
export type TabResult<Bar> =
  | { ok: true; key: ResolvedKey; bars: Bar[]; nextOf(bar: number): number | null }
  | { ok: false; error: string };

export interface TabSource<Bar> {
  barsFor(input: TabSourceInput): TabResult<Bar>;
}

/** One label per bar, indexed by bar number. A bar the analysis skipped is "N", never a shift. */
export function chordLabels(analysis: Analysis): string[] {
  const count = analysis.chords.reduce((max, c) => Math.max(max, c.bar + 1), 0);
  const labels = new Array<string>(count).fill('N');
  for (const c of analysis.chords) labels[c.bar] = c.chord;
  return labels;
}

export function nextBarOf(count: number, loop: LoopBars | null) {
  return (bar: number): number | null => {
    if (loop && bar === loop.endBar - 1 && loop.startBar < count) return loop.startBar;
    return bar + 1 < count ? bar + 1 : null;
  };
}

export const patternSource: TabSource<PlacedBar> = {
  barsFor({ song, analysis, grid, loop }) {
    const transpose = song.playback.pitch_semitones;
    const key = resolveKey(song.play_along.key, analysis.key_candidates, transpose);
    if (!key) {
      return { ok: false, error: 'The analysis found no key candidates, so there is no key to build patterns in.' };
    }
    const labels = chordLabels(analysis);
    const nextOf = nextBarOf(labels.length, loop);
    const { pattern } = song.play_along;
    const plans = labels.map((label, bar) => {
      const next = nextOf(bar);
      return planBar({
        bar,
        label,
        nextLabel: next === null ? null : labels[next]!,
        key,
        pattern,
        beatsPerBar: grid.beatsPerBar,
        transpose,
      });
    });
    return { ok: true, key, bars: placeBars(plans, { approach: pattern.approach, key, nextOf }), nextOf };
  },
};

/** The bar's chord as heard (transposed), e.g. "F♯m", "C/E", or what the bar is instead. */
export function chordText(bar: PlacedBar, key: ResolvedKey): string {
  const { plan } = bar;
  if (plan.empty === 'no_chord') return 'no chord';
  if (plan.empty === 'unclassified') return 'unclassified';
  if (plan.empty === 'unparsed') return `unreadable chord "${plan.label}"`;
  return tonesText(plan.tones!, key);
}

/** Index of the note sounding `beatsInto` beats into the bar, or -1. */
export function noteIndexAt(bar: PlacedBar, beatsInto: number): number {
  return bar.notes.findIndex((n) => beatsInto >= n.beat && beatsInto < n.beat + n.beats);
}

/** One line for screen readers and tests: "Bar 5, G: G B D C♯". */
export function describeBar(bar: PlacedBar | undefined, key: ResolvedKey): string {
  if (!bar) return 'past the end of the chord chart';
  const head = `Bar ${bar.plan.bar + 1}, ${chordText(bar, key)}`;
  return bar.notes.length > 0 ? `${head}: ${bar.notes.map((n) => n.name).join(' ')}` : head;
}

/** What the readout and the ribbon need from a bar, whichever instrument made it. */
export interface BarSummary {
  bar: number;
  /** The chord as played, or what the bar is instead ("no chord"). */
  text: string;
  /** The ribbon cell: the chord as heard, "–" for no chord, "?" for unreadable. */
  cell: string;
  /** Under the cell: what Simplify reduced it to ("→ Em"), else null. */
  sub: string | null;
  /** Every substitution and reason for this bar, for the readout chip; "" if none. */
  note: string;
}

export function bassSummaries(bars: readonly PlacedBar[], key: ResolvedKey): BarSummary[] {
  return bars.map((b) => ({
    bar: b.plan.bar,
    text: chordText(b, key),
    cell: b.plan.empty ? (b.plan.empty === 'no_chord' ? '–' : '?') : chordText(b, key),
    sub: null,
    note: b.plan.substitution ?? b.plan.reason ?? '',
  }));
}
