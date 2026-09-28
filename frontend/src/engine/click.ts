// Metronome click synthesis. D6-03: the click is generated in the *input*
// domain and mixed with the stems before the stretcher, so it shares the
// music's timebase and the music's latency exactly. A click generated after
// the stretcher would arrive early by the stretcher's buffer -- N-06's
// 50-100 ms -- and the error would change with tempo.
//
// Pure functions over numbers: no AudioContext, no worklet, fully testable.

const CLICK_MS = 25;
const TONE_HZ = 1000;
const ACCENT_TONE_HZ = 1600;
const ACCENT_GAIN = 1.0;
const PLAIN_GAIN = 0.6;

export function CLICK_LENGTH_FRAMES(sampleRate: number): number {
  return Math.round((CLICK_MS / 1000) * sampleRate);
}

/**
 * One sample of a short exponentially-decaying sine burst, `framesSinceOnset`
 * frames into the click. 0 outside the burst. Amplitude never exceeds 1.
 */
export function clickSample(
  framesSinceOnset: number,
  accented: boolean,
  sampleRate: number,
): number {
  const length = CLICK_LENGTH_FRAMES(sampleRate);
  if (framesSinceOnset < 0 || framesSinceOnset >= length) return 0;
  const t = framesSinceOnset / sampleRate;
  // length / 5: a ~5 ms time constant over the 25 ms burst.
  const envelope = Math.exp(-framesSinceOnset / (length / 5));
  const hz = accented ? ACCENT_TONE_HZ : TONE_HZ;
  const gain = accented ? ACCENT_GAIN : PLAIN_GAIN;
  return Math.sin(2 * Math.PI * hz * t) * envelope * gain;
}

/**
 * Index of the latest beat at or before `position`, or -1 if `position` is
 * before the first beat. Binary search rather than a carried index: the cursor
 * jumps at every loop wrap and every seek, and a carried index would have to be
 * invalidated at both -- less error-prone to just search. This does run once
 * per frame (128 times a block, from loopCursor's sample loop), not once per
 * block: log2(beats) comparisons on a few thousand beats is a handful of
 * integer compares per sample, which the render budget absorbs. The reason to
 * prefer it is correctness across jumps, not a lower call count.
 */
export function findBeatIndexAt(beats: Float64Array, position: number): number {
  if (beats.length === 0 || position < beats[0]!) return -1;
  let lo = 0;
  let hi = beats.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (beats[mid]! <= position) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}
