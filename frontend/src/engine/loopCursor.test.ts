import { describe, expect, it, test } from 'vitest';

import { renderBlock } from './loopCursor';
import type { CursorState, FourStems, MixParams, StemChannels } from './loopCursor';

const SAMPLE_RATE = 48_000;

function zeroStem(length: number): StemChannels {
  return { left: new Float32Array(length), right: new Float32Array(length) };
}

function rampStem(length: number): StemChannels {
  const left = new Float32Array(length);
  const right = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    left[i] = i;
    right[i] = i;
  }
  return { left, right };
}

function constantStem(length: number, value: number): StemChannels {
  return { left: new Float32Array(length).fill(value), right: new Float32Array(length).fill(value) };
}

function sineStem(length: number, frequencyHz: number, amplitude: number, phase: number): StemChannels {
  const left = new Float32Array(length);
  const right = new Float32Array(length);
  const omega = (2 * Math.PI * frequencyHz) / SAMPLE_RATE;
  for (let i = 0; i < length; i++) {
    const v = amplitude * Math.sin(omega * i + phase);
    left[i] = v;
    right[i] = v;
  }
  return { left, right };
}

function fourStems(builder: (i: number) => StemChannels): FourStems {
  return [builder(0), builder(1), builder(2), builder(3)];
}

function makeStems(length: number, value: number): FourStems {
  return fourStems(() => constantStem(length, value));
}

// ---------------------------------------------------------------------------
// 1. Interpolation sanity
// ---------------------------------------------------------------------------

test('readRate 1 with no loop reproduces the ramp exactly', () => {
  const length = 20;
  const stems = fourStems(() => rampStem(length));
  const params: MixParams = {
    gains: [1, 0, 0, 0],
    readRate: 1,
    loop: null,
    crossfadeFrames: 0,
    playing: true,
    lengthFrames: length,
    metronome: null,
  };
  const cursor: CursorState = { position: 0, ended: false };
  const outLeft = new Float32Array(10);
  const outRight = new Float32Array(10);

  renderBlock(stems, params, cursor, outLeft, outRight);

  for (let i = 0; i < outLeft.length; i++) {
    expect(outLeft[i]).toBe(i);
    expect(outRight[i]).toBe(i);
  }
  expect(cursor.position).toBe(10);
});

test('readRate 0.5 with no loop yields the linear midpoint between ramp samples', () => {
  const length = 20;
  const stems = fourStems(() => rampStem(length));
  const params: MixParams = {
    gains: [1, 0, 0, 0],
    readRate: 0.5,
    loop: null,
    crossfadeFrames: 0,
    playing: true,
    lengthFrames: length,
    metronome: null,
  };
  const cursor: CursorState = { position: 0, ended: false };
  const outLeft = new Float32Array(10);
  const outRight = new Float32Array(10);

  renderBlock(stems, params, cursor, outLeft, outRight);

  // The ramp is exactly linear (left[i] = i), so interpolating it at any
  // fractional position p must reproduce p itself, with no approximation error.
  for (let i = 0; i < outLeft.length; i++) {
    const expected = i * 0.5;
    expect(outLeft[i]).toBeCloseTo(expected, 12);
    expect(outRight[i]).toBeCloseTo(expected, 12);
  }
});

// ---------------------------------------------------------------------------
// 2. Gain/mute mixing
// ---------------------------------------------------------------------------

test('gains mix stems with plain multiplication, mute is just gain 0', () => {
  const length = 10;
  const stems: FourStems = [
    constantStem(length, 1),
    constantStem(length, 2),
    constantStem(length, 4),
    constantStem(length, 8),
  ];
  const params: MixParams = {
    gains: [1, 0, 0.5, 0],
    readRate: 1,
    loop: null,
    crossfadeFrames: 0,
    playing: true,
    lengthFrames: length,
    metronome: null,
  };
  const cursor: CursorState = { position: 0, ended: false };
  const outLeft = new Float32Array(5);
  const outRight = new Float32Array(5);

  renderBlock(stems, params, cursor, outLeft, outRight);

  // 1*1 (vocals) + 4*0.5 (bass) = 3; drums and other are muted (gain 0).
  for (let i = 0; i < outLeft.length; i++) {
    expect(outLeft[i]).toBeCloseTo(3, 12);
    expect(outRight[i]).toBeCloseTo(3, 12);
  }
});

// ---------------------------------------------------------------------------
// 3. Click detection — the R-01 regression test
// ---------------------------------------------------------------------------

// Four incommensurate frequencies: none divides evenly into the loop length
// (4800 samples @ 48 kHz = 100 ms), so the phase at the loop's tail never
// matches the phase at its head — a hard cut here is guaranteed to click.
const CLICK_FREQUENCIES = [437, 511, 663, 829] as const;
// Nonzero, distinct phases: without these, every sine is 0 at sample 0 (sin(0)
// = 0), so the "hard cut" seam would coincidentally compare two near-zero
// values and understate the click. Arbitrary distinct phases avoid that
// coincidence and make the loop-length-incommensurate mismatch actually show
// up in amplitude, not just in the underlying (correct) math.
const CLICK_PHASES = [0.7, 1.3, 2.1, 2.9] as const;
const CLICK_AMPLITUDE = 0.2; // per stem; 4 stems at gain 1 sum to at most 0.8, well under clipping
const CLICK_LOOP_LENGTH = 4800; // 100 ms @ 48 kHz
const CLICK_START = 0;
const CLICK_END = CLICK_START + CLICK_LOOP_LENGTH;
const CLICK_CROSSFADE = 480; // 10 ms
const CLICK_REPETITIONS = 2000; // stands in for the roadmap's 30+ minute soak

function buildClickStems(): FourStems {
  // Buffer only needs to cover one loop's worth of content (+1 sample for the
  // interpolator's lookahead) — every repetition replays the same buffer.
  const length = CLICK_END + 2;
  return [
    sineStem(length, CLICK_FREQUENCIES[0], CLICK_AMPLITUDE, CLICK_PHASES[0]),
    sineStem(length, CLICK_FREQUENCIES[1], CLICK_AMPLITUDE, CLICK_PHASES[1]),
    sineStem(length, CLICK_FREQUENCIES[2], CLICK_AMPLITUDE, CLICK_PHASES[2]),
    sineStem(length, CLICK_FREQUENCIES[3], CLICK_AMPLITUDE, CLICK_PHASES[3]),
  ];
}

function maxAdjacentDelta(out: Float32Array): number {
  let max = 0;
  for (let i = 1; i < out.length; i++) {
    const delta = Math.abs(out[i]! - out[i - 1]!);
    if (delta > max) max = delta;
  }
  return max;
}

// The threshold a continuous (non-clicking) render must stay under.
//
// For a single sine s(t) = A*sin(omega*t), the mean value theorem bounds the
// per-sample delta by |s'| <= A*omega, since |sin(a) - sin(b)| <= |a - b|.
// With readRate = 1 and all loop parameters integers, every non-crossfade
// sample is read at an exact integer position (frac = 0), so linear
// interpolation contributes no extra error there — the bound is exactly the
// sum of each stem's A*omega.
//
// Inside the crossfade window the output is a linear blend of two signals
// (tail and head) with blend weight t advancing by 1/crossfadeFrames per
// sample. Expanding x[n] = tail(n)*(1-t_n) + head(n)*t_n algebraically gives
//   x[n+1] - x[n] = (1-t)*Δtail + t*Δhead + Δt*(head(n) - tail(n))
// so the blended delta is bounded by the same per-signal delta bound D, plus
// an extra term Δt * (max amplitude spread between head and tail), where
// Δt = 1/crossfadeFrames and the amplitude spread is at most 2 * sum(A_i).
function computeMaxExpectedDelta(crossfadeFrames: number): number {
  const omega = CLICK_FREQUENCIES.map((f) => (2 * Math.PI * f) / SAMPLE_RATE);
  const perSignalDeltaBound = omega.reduce((sum, w) => sum + CLICK_AMPLITUDE * w, 0);
  const totalAmplitude = CLICK_AMPLITUDE * CLICK_FREQUENCIES.length;
  const crossfadeSlopeTerm = crossfadeFrames > 0 ? (2 * totalAmplitude) / crossfadeFrames : 0;
  const floatEpsilon = 1e-6; // slack for interpolation/summation rounding
  return perSignalDeltaBound + crossfadeSlopeTerm + floatEpsilon;
}

test('sensitivity self-check: a hard cut (crossfadeFrames 0) produces a large click', () => {
  const stems = buildClickStems();
  const params: MixParams = {
    gains: [1, 1, 1, 1],
    readRate: 1,
    loop: { startFrame: CLICK_START, endFrame: CLICK_END },
    crossfadeFrames: 0,
    playing: true,
    lengthFrames: CLICK_END + 2,
    metronome: null,
  };
  const cursor: CursorState = { position: CLICK_START, ended: false };
  const frameCount = CLICK_REPETITIONS * CLICK_LOOP_LENGTH;
  const outLeft = new Float32Array(frameCount);
  const outRight = new Float32Array(frameCount);

  renderBlock(stems, params, cursor, outLeft, outRight);

  const threshold = computeMaxExpectedDelta(0);
  const observedMax = maxAdjacentDelta(outLeft);

  // If this fails, the detector itself is broken (too insensitive to prove
  // anything below) — the whole point of this test is to make sure a real
  // discontinuity actually trips the same threshold used to certify the
  // crossfaded render.
  expect(observedMax).toBeGreaterThan(threshold * 5);
});

test('crossfaded loop never clicks across 2000 repetitions', () => {
  const stems = buildClickStems();
  const params: MixParams = {
    gains: [1, 1, 1, 1],
    readRate: 1,
    loop: { startFrame: CLICK_START, endFrame: CLICK_END },
    crossfadeFrames: CLICK_CROSSFADE,
    playing: true,
    lengthFrames: CLICK_END + 2,
    metronome: null,
  };
  const cursor: CursorState = { position: CLICK_START, ended: false };
  const frameCount = CLICK_REPETITIONS * CLICK_LOOP_LENGTH;
  const outLeft = new Float32Array(frameCount);
  const outRight = new Float32Array(frameCount);

  renderBlock(stems, params, cursor, outLeft, outRight);

  const threshold = computeMaxExpectedDelta(CLICK_CROSSFADE);
  expect(maxAdjacentDelta(outLeft)).toBeLessThanOrEqual(threshold);
  expect(maxAdjacentDelta(outRight)).toBeLessThanOrEqual(threshold);
});

// ---------------------------------------------------------------------------
// 4 & 5. No drift, with integer and non-integer readRate
// ---------------------------------------------------------------------------

// NOTE on the closed form used here vs. the plan's prose:
//
// The plan doc / task brief describe the expected position after N
// repetitions as `startFrame + crossfadeFrames + N * loopLength`. Working
// through the actual rebase arithmetic shows that formula can't be what's
// meant literally: the rebase `pos = startFrame + crossfadeFrames + (pos -
// endFrame)` deliberately skips content already delivered as the crossfade's
// fade-in (that's what makes "nothing repeats" true), which means each wrap
// after the first advances the *content* consumed by only
// `(endFrame - startFrame) - crossfadeFrames` stem-domain samples, not the
// full loop length. Concretely: after any wrap, `pos` always rebases to
// exactly `startFrame + crossfadeFrames + overshoot` — a value that stays
// bounded near `startFrame`, never growing by `loopLength` per repetition.
// (`overshoot` here is `pos - endFrame` at the instant of the wrap; it's 0
// whenever readRate and the loop bounds are integers and line up exactly.)
//
// So "no drift" is tested here against the invariant that actually follows
// from the code: every single frame,
//   pos_after = pos_before + readRate - C * (1 if this frame wrapped else 0)
// where C = (endFrame - startFrame) - crossfadeFrames is a fixed constant.
// This is an exact algebraic identity (substitute the rebase formula in and
// it falls out directly), true for any readRate. It's what "the rebase
// arithmetic never accumulates error" (the brief's own stated purpose for
// this test) actually means: the SAME constant C must be subtracted at every
// wrap, over many thousands of wraps, with no creeping floating-point error.
//
// The reference model below computes the expected final position by jumping
// wrap-to-wrap (O(wrapCount) additions/multiplications), which performs many
// fewer floating-point operations than renderBlock's own frame-by-frame
// accumulation (O(frameCount) additions). Comparing the two is a real check:
// if renderBlock's iterative accumulation drifted, it would diverge from this
// low-operation-count reference, whereas comparing renderBlock against itself
// would not catch that.
function referenceFinalPosition(
  initialPosition: number,
  totalFrames: number,
  readRate: number,
  startFrame: number,
  endFrame: number,
  crossfadeFrames: number,
): number {
  const C = endFrame - startFrame - crossfadeFrames;
  let pos = initialPosition;
  let framesLeft = totalFrames;
  while (framesLeft > 0) {
    const remaining = endFrame - pos;
    const framesToWrap = Math.ceil(remaining / readRate);
    if (framesToWrap > framesLeft) {
      pos += framesLeft * readRate;
      framesLeft = 0;
    } else {
      pos += framesToWrap * readRate;
      pos -= C; // algebraically identical to startFrame + crossfadeFrames + (pos - endFrame)
      framesLeft -= framesToWrap;
    }
  }
  return pos;
}

const DRIFT_START = 1000;
const DRIFT_LOOP_LENGTH = 4800;
const DRIFT_END = DRIFT_START + DRIFT_LOOP_LENGTH;
const DRIFT_CROSSFADE = 480;
const DRIFT_TOTAL_FRAMES = 2_000_000; // several hundred wraps at either readRate below

// Tight relative to the loop-scale quantities involved (crossfadeFrames = 480,
// loopLength = 4800): a real logic bug (wrong constant, off-by-one in the
// rebase, a dropped wrap) would misplace the cursor by an amount on that
// order, not by a sub-microscopic amount. This epsilon only has to absorb
// float64 rounding: each addition carries ~2^-52 relative error, and even a
// pessimistic linear accumulation over 2,000,000 additions of O(1e4)-sized
// values is bounded by roughly 2e6 * 2^-52 * 1e4 ~= 4.4e-6.
const DRIFT_EPSILON = 1e-3;

test('no drift across many loop repetitions at readRate 1', () => {
  const length = DRIFT_END + 2;
  const stems = fourStems(() => zeroStem(length));
  const params: MixParams = {
    gains: [1, 0, 0, 0],
    readRate: 1,
    loop: { startFrame: DRIFT_START, endFrame: DRIFT_END },
    crossfadeFrames: DRIFT_CROSSFADE,
    playing: true,
    lengthFrames: length,
    metronome: null,
  };
  const cursor: CursorState = { position: DRIFT_START, ended: false };
  const outLeft = new Float32Array(DRIFT_TOTAL_FRAMES);
  const outRight = new Float32Array(DRIFT_TOTAL_FRAMES);

  renderBlock(stems, params, cursor, outLeft, outRight);

  const expected = referenceFinalPosition(
    DRIFT_START,
    DRIFT_TOTAL_FRAMES,
    1,
    DRIFT_START,
    DRIFT_END,
    DRIFT_CROSSFADE,
  );
  expect(Math.abs(cursor.position - expected)).toBeLessThan(DRIFT_EPSILON);
});

test('no drift across many loop repetitions at a non-integer readRate (0.7)', () => {
  const length = DRIFT_END + 2;
  const stems = fourStems(() => zeroStem(length));
  const readRate = 0.7;
  const params: MixParams = {
    gains: [1, 0, 0, 0],
    readRate,
    loop: { startFrame: DRIFT_START, endFrame: DRIFT_END },
    crossfadeFrames: DRIFT_CROSSFADE,
    playing: true,
    lengthFrames: length,
    metronome: null,
  };
  const cursor: CursorState = { position: DRIFT_START, ended: false };
  const outLeft = new Float32Array(DRIFT_TOTAL_FRAMES);
  const outRight = new Float32Array(DRIFT_TOTAL_FRAMES);

  renderBlock(stems, params, cursor, outLeft, outRight);

  const expected = referenceFinalPosition(
    DRIFT_START,
    DRIFT_TOTAL_FRAMES,
    readRate,
    DRIFT_START,
    DRIFT_END,
    DRIFT_CROSSFADE,
  );
  expect(Math.abs(cursor.position - expected)).toBeLessThan(DRIFT_EPSILON);
});

// ---------------------------------------------------------------------------
// 6. No content repeats or is skipped across the wrap
// ---------------------------------------------------------------------------

test('the crossfade is monotonic and strictly between tail-only and head-only values', () => {
  const startFrame = 0;
  const loopLength = 100;
  const endFrame = loopLength;
  const crossfadeFrames = 20;
  const length = endFrame + 2;
  const stems = fourStems(() => rampStem(length));
  const params: MixParams = {
    gains: [1, 0, 0, 0],
    readRate: 1,
    loop: { startFrame, endFrame },
    crossfadeFrames,
    playing: true,
    lengthFrames: length,
    metronome: null,
  };
  const cursor: CursorState = { position: startFrame, ended: false };
  const outLeft = new Float32Array(loopLength);
  const outRight = new Float32Array(loopLength);

  renderBlock(stems, params, cursor, outLeft, outRight);

  // Note: the tail (values ~80..99) and head (values ~0..19) are far apart in
  // magnitude for a ramp — unlike a periodic signal, there's no reason the
  // *blended output* itself should be monotonically increasing sample to
  // sample (it isn't: the blend swings from ~80 down toward ~20 as the head's
  // small values take over). What must hold, at every sample, is the weaker
  // and more fundamental property: the blend is a genuine convex combination,
  // so it always lies strictly between the tail-only and head-only values —
  // proof that both signals actually contribute (no double-counting one side
  // at full weight mid-window) and that the two weights still sum to 1 (no
  // overshoot past either endpoint).
  const tailStart = endFrame - crossfadeFrames;
  let previousT = -Infinity;
  for (let i = tailStart; i < endFrame; i++) {
    const tailOnly = i; // ramp value at the nominal tail position
    const headOnly = startFrame + (i - tailStart); // ramp value at the corresponding head position
    const blended = outLeft[i];
    const t = (i - tailStart) / crossfadeFrames;

    if (i === tailStart) {
      // t = 0 at the very first crossfade sample: pure tail, by construction.
      expect(blended).toBe(tailOnly);
    } else {
      expect(blended).toBeGreaterThan(headOnly);
      expect(blended).toBeLessThan(tailOnly);
    }

    // The blend weight itself progresses monotonically from 0 toward 1 across
    // the window — that's what "monotonic crossfade" means, not that the
    // resulting sample values happen to be monotonic.
    expect(t).toBeGreaterThan(previousT);
    previousT = t;
  }

  // The frame immediately after the wrap must continue from exactly where
  // the crossfade left off — the content already delivered as the fade-in is
  // not replayed.
  expect(cursor.position).toBe(startFrame + crossfadeFrames);
});

// ---------------------------------------------------------------------------
// 7. Transport: play/pause gate and end-of-stem stop
// ---------------------------------------------------------------------------

describe('transport', () => {
  it('renders silence and does not advance the cursor while paused', () => {
    const stems = makeStems(1000, 0.5);
    const cursor: CursorState = { position: 100, ended: false };
    const outL = new Float32Array(128);
    const outR = new Float32Array(128);

    renderBlock(
      stems,
      { gains: [1, 1, 1, 1], readRate: 1, loop: null, crossfadeFrames: 0, playing: false, lengthFrames: 1000, metronome: null },
      cursor,
      outL,
      outR,
    );

    expect(cursor.position).toBe(100);
    expect(outL.every((s) => s === 0)).toBe(true);
    expect(outR.every((s) => s === 0)).toBe(true);
  });

  it('advances and sounds while playing', () => {
    const stems = makeStems(1000, 0.5);
    const cursor: CursorState = { position: 0, ended: false };
    const outL = new Float32Array(128);
    const outR = new Float32Array(128);

    renderBlock(
      stems,
      { gains: [1, 1, 1, 1], readRate: 1, loop: null, crossfadeFrames: 0, playing: true, lengthFrames: 1000, metronome: null },
      cursor,
      outL,
      outR,
    );

    expect(cursor.position).toBe(128);
    expect(outL[0]).toBeCloseTo(2.0); // four stems at 0.5, unity gain
  });

  it('stops at the end of the stems instead of reading past them', () => {
    const stems = makeStems(200, 0.5);
    const cursor: CursorState = { position: 150, ended: false };
    const outL = new Float32Array(128);
    const outR = new Float32Array(128);

    renderBlock(
      stems,
      { gains: [1, 1, 1, 1], readRate: 1, loop: null, crossfadeFrames: 0, playing: true, lengthFrames: 200, metronome: null },
      cursor,
      outL,
      outR,
    );

    expect(cursor.ended).toBe(true);
    expect(cursor.position).toBe(200);
    // Frames past the end are silent, not garbage or a repeat of the last sample.
    expect(outL[100]).toBe(0);
  });

  it('never ends while a loop is armed, however long it plays', () => {
    const stems = makeStems(1000, 0.5);
    const cursor: CursorState = { position: 900, ended: false };
    const outL = new Float32Array(128);
    const outR = new Float32Array(128);

    for (let block = 0; block < 100; block++) {
      renderBlock(
        stems,
        {
          gains: [1, 1, 1, 1],
          readRate: 1,
          loop: { startFrame: 100, endFrame: 500 },
          crossfadeFrames: 24,
          playing: true,
          lengthFrames: 1000,
          metronome: null,
        },
        cursor,
        outL,
        outR,
      );
    }

    expect(cursor.ended).toBe(false);
    expect(cursor.position).toBeGreaterThanOrEqual(100);
    expect(cursor.position).toBeLessThan(500);
  });
});

// ---------------------------------------------------------------------------
// 8. Metronome click, mixed pre-stretcher (D6-03)
// ---------------------------------------------------------------------------

describe('metronome', () => {
  const metronome = (gain: number) => ({
    beats: Float64Array.from([0, 480, 960, 1440]),
    downbeatFlags: Uint8Array.from([1, 0, 0, 0]),
    gain,
    sampleRate: 48_000,
  });

  it('adds a click at a beat and nothing between beats', () => {
    const stems = makeStems(4000, 0); // silent stems: whatever we hear is the click
    const cursor: CursorState = { position: 0, ended: false };
    const outL = new Float32Array(128);
    const outR = new Float32Array(128);

    renderBlock(
      stems,
      {
        gains: [1, 1, 1, 1],
        readRate: 1,
        loop: null,
        crossfadeFrames: 0,
        playing: true,
        lengthFrames: 4000,
        metronome: metronome(1),
      },
      cursor,
      outL,
      outR,
    );

    expect(Math.max(...outL)).toBeGreaterThan(0); // the downbeat at 0 sounded
    // Comparing two single samples conflates envelope decay with wherever
    // those frames happen to land on the click tone's sine (a phase artifact,
    // not decay). Compare peak magnitude over two windows across the block
    // instead: the click decays, so the first half of the block should peak
    // higher than the second half.
    const peakOver = (arr: Float32Array, start: number, end: number) => {
      let max = 0;
      for (let i = start; i < end; i++) max = Math.max(max, Math.abs(arr[i]!));
      return max;
    };
    expect(peakOver(outL, 64, 128)).toBeLessThan(peakOver(outL, 0, 64));
  });

  it('is silent when the metronome is off', () => {
    const stems = makeStems(4000, 0);
    const cursor: CursorState = { position: 0, ended: false };
    const outL = new Float32Array(128);
    const outR = new Float32Array(128);

    renderBlock(
      stems,
      {
        gains: [1, 1, 1, 1],
        readRate: 1,
        loop: null,
        crossfadeFrames: 0,
        playing: true,
        lengthFrames: 4000,
        metronome: null,
      },
      cursor,
      outL,
      outR,
    );

    expect(outL.every((s) => s === 0)).toBe(true);
  });

  it('clicks in both channels equally, so it sits centred in the mix', () => {
    const stems = makeStems(4000, 0);
    const cursor: CursorState = { position: 0, ended: false };
    const outL = new Float32Array(128);
    const outR = new Float32Array(128);

    renderBlock(
      stems,
      {
        gains: [1, 1, 1, 1],
        readRate: 1,
        loop: null,
        crossfadeFrames: 0,
        playing: true,
        lengthFrames: 4000,
        metronome: metronome(1),
      },
      cursor,
      outL,
      outR,
    );

    expect(Array.from(outL)).toEqual(Array.from(outR));
  });

  it('still clicks after a loop wrap, because the beat is found from the cursor', () => {
    const stems = makeStems(4000, 0);
    // Cursor lands just before the loop start's beat after wrapping.
    const cursor: CursorState = { position: 1430, ended: false };
    const outL = new Float32Array(128);
    const outR = new Float32Array(128);

    renderBlock(
      stems,
      {
        gains: [1, 1, 1, 1],
        readRate: 1,
        loop: { startFrame: 0, endFrame: 1440 },
        crossfadeFrames: 0,
        playing: true,
        lengthFrames: 4000,
        metronome: metronome(1),
      },
      cursor,
      outL,
      outR,
    );

    // The wrap puts the cursor back at 0, which is a downbeat: it must sound.
    expect(Math.max(...outL.slice(20))).toBeGreaterThan(0);
  });
});
