// Tempo for the Practice tab (D-22): the ramp's schedule and tap tempo. The ramp
// is applied as the engine's tempo ratio over the rendered start BPM, so its
// reach is the engine's 0.5-1.5x (N-04); practice.py enforces the same range.
import type { PracticeRamp } from '../api/client';

export const BPM_MIN = 40;
export const BPM_MAX = 220;
const TAP_RESET_MS = 2000;
const TAPS_KEPT = 5;

export function rampLimits(start: number): { lo: number; hi: number } {
  return { lo: Math.max(BPM_MIN, Math.ceil(start * 0.5)), hi: Math.min(BPM_MAX, Math.floor(start * 1.5)) };
}

export interface RampState {
  bpm: number;
  /** Steps taken so far, 0 at the start. */
  step: number;
  /** Steps to the target. */
  steps: number;
  /** Which loop of the current step is playing, 1-based; null once the target holds. */
  loopInStep: number | null;
}

export function rampState(ramp: PracticeRamp, loopsDone: number): RampState {
  const distance = ramp.target - ramp.start;
  const steps = Math.ceil(Math.abs(distance) / ramp.step);
  const step = Math.min(steps, Math.floor(loopsDone / ramp.every_loops));
  const moved = Math.min(Math.abs(distance), step * ramp.step);
  return {
    bpm: ramp.start + Math.sign(distance) * moved,
    step,
    steps,
    loopInStep: step >= steps ? null : (loopsDone % ramp.every_loops) + 1,
  };
}

/** BPM from tap times (ms, newest last): the mean of the last few gaps, or null with fewer than two taps since a pause. */
export function tapTempo(taps: readonly number[]): number | null {
  let from = 0;
  for (let i = 1; i < taps.length; i++) if (taps[i]! - taps[i - 1]! > TAP_RESET_MS) from = i;
  const run = taps.slice(from).slice(-TAPS_KEPT);
  if (run.length < 2) return null;
  const mean = (run.at(-1)! - run[0]!) / (run.length - 1);
  return Math.min(BPM_MAX, Math.max(BPM_MIN, Math.round(60_000 / mean)));
}
