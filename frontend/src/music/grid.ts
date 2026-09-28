// Bar <-> sample arithmetic over Phase 5's beat grid. Loops are stored in
// song.json as *bar numbers* (user-meaningful, and they survive a re-analysis
// that moves the sample indices underneath them, tech spec §5); the engine only
// speaks sample indices. This module is the only place that conversion happens,
// and it is pure arithmetic over integers -- no float seconds anywhere (D-03).
import type { BeatGrid } from '../api/client';
import { sampleIndex, type SampleIndex } from '../engine/types';

export interface Grid {
  /** Downbeats: the sample index each bar starts on, ascending. */
  bars: SampleIndex[];
  /** Every beat, ascending. Drawn faintly; the metronome reads these. */
  beats: SampleIndex[];
  /** Derived from downbeat spacing, never configured: 4 for 4/4, 3 for 3/4. */
  beatsPerBar: number;
  bpm: number;
  /** Number of bars the analysis actually found. Bars beyond this extrapolate. */
  barCount: number;
  /** Median bar length, used to extrapolate past the last downbeat. */
  medianBarSamples: number;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1
    ? sorted[mid]!
    : Math.round((sorted[mid - 1]! + sorted[mid]!) / 2);
}

export function buildGrid(beatGrid: BeatGrid): Grid | null {
  const bars = beatGrid.downbeats.map(sampleIndex);
  // One downbeat gives a bar start but no bar *length*, and every consumer here
  // needs a length (extrapolation, snapping, the ruler). Two is the floor.
  if (bars.length < 2) return null;

  const barLengths: number[] = [];
  for (let i = 1; i < bars.length; i++) barLengths.push(bars[i]! - bars[i - 1]!);
  const medianBarSamples = median(barLengths);

  const beats = beatGrid.beats.map(sampleIndex);
  // Count the beats inside one representative bar rather than trusting a time
  // signature nobody stored: beat_this reports beats and downbeats, not meter.
  const firstBarBeats = beats.filter((b) => b >= bars[0]! && b < bars[1]!).length;

  return {
    bars,
    beats,
    beatsPerBar: firstBarBeats > 0 ? firstBarBeats : 4,
    bpm: beatGrid.bpm,
    barCount: bars.length,
    medianBarSamples,
  };
}

export function barStart(grid: Grid, bar: number): SampleIndex {
  if (bar <= 0) return grid.bars[0]!;
  if (bar < grid.barCount) return grid.bars[bar]!;
  // Past the analysis: keep counting at the median bar length rather than
  // clamping, so a loop set near the end of a song with a short tail still has
  // an end bar to point at.
  const last = grid.bars[grid.barCount - 1]!;
  return sampleIndex(last + (bar - (grid.barCount - 1)) * grid.medianBarSamples);
}

export function barAt(grid: Grid, position: SampleIndex): number {
  if (position < grid.bars[0]!) return -1;
  // Binary search: the ruler calls this once per animation frame.
  let lo = 0;
  let hi = grid.barCount - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (grid.bars[mid]! <= position) lo = mid;
    else hi = mid - 1;
  }
  if (lo === grid.barCount - 1 && grid.medianBarSamples > 0) {
    const past = position - grid.bars[lo]!;
    return lo + Math.floor(past / grid.medianBarSamples);
  }
  return lo;
}

export function snapToBar(grid: Grid, position: SampleIndex): number {
  const bar = Math.max(0, barAt(grid, position));
  const here = barStart(grid, bar);
  const next = barStart(grid, bar + 1);
  return position - here <= next - position ? bar : bar + 1;
}
