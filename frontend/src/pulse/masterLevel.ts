// The album splitter has no stems, only the master and its coarse peaks (10 per
// second). Mastered audio sits near its own peak almost all the time, so read raw
// the bar would just glow; the swing around the recent average is what reads as a
// pulse. Pure, so the feel can be tested without a canvas.

/** How far a bucket's swing away from the recent average is exaggerated. */
const CONTRAST = 2.5;
/** How long the recent average takes to move ~63% of the way to a new loudness. */
const AVERAGE_SECONDS = 2;

/** 0..1 loudness of the bucket under `seconds`, relative to the envelope's own peak. */
export function envelopeAt(
  envelope: readonly number[],
  peak: number,
  bucketsPerSecond: number,
  seconds: number,
): number {
  if (peak <= 0) return 0;
  const raw = envelope[Math.floor(seconds * bucketsPerSecond)] ?? 0;
  return Math.min(1, raw / peak);
}

/** The slow average `level` is measured against, one frame on. */
export function settle(average: number, level: number, dtSeconds: number): number {
  return average + (level - average) * (1 - Math.exp(-dtSeconds / AVERAGE_SECONDS));
}

/**
 * A loud bucket swells past the average and a quiet one sinks below it; silence is
 * still dark, since the average itself falls to nothing there.
 */
export function pounded(level: number, average: number): number {
  return Math.min(1, Math.max(0, average + CONTRAST * (level - average)));
}
