// How loud a stem is at the cursor, for the navbar pulse bar. Derived from the
// envelope the engine computed at load (stemPeaks.ts) rather than metered on
// the audio thread: the envelope indexed by the engine clock follows loops,
// seeks and tempo for free, and the worklet stays out of it.
import { ENVELOPE_BUCKETS_PER_SECOND, type StemSummary } from '../engine/stemPeaks';
import { SAMPLE_RATE, type SampleIndex } from '../engine/types';

/** How long a glow takes to fall to ~37% after a hit. Short enough to read as a beat. */
const RELEASE_SECONDS = 0.12;

/** 0..1, relative to the stem's own peak. `position` is in the 48 kHz stem domain (D-03). */
export function levelAt(summary: StemSummary, position: SampleIndex): number {
  // U-10: an empty stem normalised to its own peak would pulse hardest of all.
  if (summary.nearSilent) return 0;
  const bucket = Math.floor(((position as number) / SAMPLE_RATE) * ENVELOPE_BUCKETS_PER_SECOND);
  const raw = summary.envelope[bucket] ?? 0;
  return Math.min(1, raw / summary.peak);
}

/** Instant attack, exponential release: a hit lands on its frame and then decays. */
export function follow(previous: number, target: number, dtSeconds: number): number {
  const decayed = previous * Math.exp(-dtSeconds / RELEASE_SECONDS);
  return target > decayed ? target : decayed;
}
