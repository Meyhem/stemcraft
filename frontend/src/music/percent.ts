// The one place the "position as a percentage of the song's sample length"
// convention lives. Timeline and ChordStrip both lay out against it and their
// header comments cross-reference each other, so it is arithmetic they have to
// agree on exactly -- two copies is one copy too many. Sample-domain integer
// arithmetic, same family as grid.ts (D-03).
import type { SampleIndex } from '../engine/types';

/**
 * `position` as a percentage of `durationSamples`. A zero (or absent) duration
 * has no meaningful percentage, so it yields 0 rather than NaN or Infinity --
 * the engine's duration is known before either strip renders, but a division
 * that produced `NaN%` would silently drop every element to the left edge.
 */
export function percentOf(durationSamples: SampleIndex | number, position: number): number {
  return durationSamples > 0 ? (position / durationSamples) * 100 : 0;
}
