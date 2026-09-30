// The navbar pulse bar's picture, as geometry: two soft glows per audible stem
// that wander along the bar and swell with that stem's level. Pure, so the
// look can be tested without a canvas.

export interface Blob {
  /** STEM_ORDER index. */
  stem: number;
  /** Canvas pixels. */
  center: number;
  radius: number;
  /** Peak opacity, at the centre. */
  alpha: number;
}

const BLOBS_PER_STEM = 2;
/** Below this a stem is as good as silenced and its glows are not drawn. */
const MIN_WEIGHT = 0.01;

/**
 * `levels` and `weights` are STEM_ORDER-indexed and 0..1: how loud the stem is
 * right now, and how audible it is in the mix (0 when muted). `driftSeconds`
 * only moves the glows; it is not the song position.
 */
export function blobsFor(
  levels: readonly number[],
  weights: readonly number[],
  driftSeconds: number,
  width: number,
): Blob[] {
  const blobs: Blob[] = [];
  for (let stem = 0; stem < levels.length; stem++) {
    const weight = weights[stem] ?? 0;
    if (weight < MIN_WEIGHT) continue;
    const level = levels[stem]!;
    for (let k = 0; k < BLOBS_PER_STEM; k++) {
      // Each stem drifts at its own slow rate and phase, so the glows cross
      // and blend instead of marching together.
      const phase = driftSeconds * (0.21 + 0.07 * stem) + stem * 1.7 + k * 3.1;
      blobs.push({
        stem,
        center: width * (0.5 + 0.42 * Math.sin(phase)),
        radius: width * (0.05 + 0.22 * level),
        alpha: (0.25 + 0.75 * level) * weight,
      });
    }
  }
  return blobs;
}
