// A made-up groove for the loading bar (U-15): it pounds like the navbar pulse bar
// while there is nothing to hear yet. Pure, so the feel can be tested without a canvas.

/** 120 bpm. */
export const BEAT_SECONDS = 0.5;
const BEATS_PER_BAR = 4;

/** STEM_ORDER-indexed 0..1 levels at `seconds` since the loader appeared. */
export function grooveLevels(seconds: number): number[] {
  const beats = seconds / BEAT_SECONDS;
  const phase = beats - Math.floor(beats);
  const beatInBar = Math.floor(beats) % BEATS_PER_BAR;
  // Bass hits on 1 and 3; on 2 and 4 it is still ringing out from the beat before.
  const sinceBass = beatInBar % 2 === 0 ? phase : phase + 1;
  return [
    0.45 + 0.25 * Math.sin(seconds * 1.1), // vocals: a slow swell, no beat
    0.15 + 0.85 * Math.exp(-6 * phase), // drums: every beat
    0.2 + 0.8 * Math.exp(-3 * sinceBass), // bass
    0.35 + 0.3 * Math.exp(-5 * ((phase + 0.5) % 1)), // other: the offbeat
  ];
}
