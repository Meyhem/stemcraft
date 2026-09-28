import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { EngineClock } from './clock';
import { SAMPLE_RATE, sampleIndex } from './types';
import type { EngineController as EngineControllerType } from './EngineController';

// EngineController.create() needs a real AudioContext + AudioWorklet, neither
// of which exists under jsdom, so it can't be used to build a controller for
// these tests. Instead we reach the private constructor directly with
// hand-rolled fakes for the pieces countInAndPlay/pause/seek actually touch
// (context, cursorNode; stNode is untouched by any of them) — the same
// "mutable box" pattern the class already uses internally, applied one level
// out. This tests the cancellation logic in isolation without restructuring
// EngineController for testability.
//
// Even importing the module needs a stub first: @soundtouchjs/audio-worklet's
// SoundTouchNode class declaration is `class SoundTouchNode extends
// AudioWorkletNode`, and that `extends` expression is evaluated at
// module-load time, not at instantiation -- so EngineController.ts throws
// `AudioWorkletNode is not defined` on import alone under jsdom unless a
// global stands in for it first. A no-op class is enough: these tests never
// instantiate a SoundTouchNode, they only need the module to finish loading.
let EngineController: typeof EngineControllerType;

beforeAll(async () => {
  (globalThis as unknown as { AudioWorkletNode: unknown }).AudioWorkletNode = class {};
  ({ EngineController } = await import('./EngineController'));
});

function makeParam() {
  return {
    value: 0,
    setValueAtTime(v: number) {
      this.value = v;
      return this;
    },
    setTargetAtTime(v: number) {
      this.value = v;
      return this;
    },
  };
}

function makeCursorNode() {
  const parameters = new Map<string, ReturnType<typeof makeParam>>();
  for (const name of ['gain0', 'gain1', 'gain2', 'gain3', 'metronomeGain', 'playing', 'readRate']) {
    parameters.set(name, makeParam());
  }
  return { parameters, port: { postMessage: vi.fn() } };
}

let rafQueue: FrameRequestCallback[] = [];

function fakeRequestAnimationFrame(cb: FrameRequestCallback): number {
  rafQueue.push(cb);
  return rafQueue.length;
}

/** Invokes every callback queued so far (a single simulated animation frame). */
function flushOneFrame(): void {
  const queue = rafQueue;
  rafQueue = [];
  for (const cb of queue) cb(0);
}

/** Waits for countInAndPlay's Promise executor to actually run and queue its first tick. */
async function waitForRaf(maxMicrotasks = 20): Promise<void> {
  for (let i = 0; i < maxMicrotasks; i++) {
    if (rafQueue.length > 0) return;
    await Promise.resolve();
  }
}

beforeEach(() => {
  rafQueue = [];
  (globalThis as unknown as { requestAnimationFrame: typeof requestAnimationFrame }).requestAnimationFrame =
    fakeRequestAnimationFrame as unknown as typeof requestAnimationFrame;
});

function makeController(initialContextTime = 0) {
  const context = {
    currentTime: initialContextTime,
    state: 'running' as AudioContextState,
    sampleRate: SAMPLE_RATE,
    resume: vi.fn().mockResolvedValue(undefined),
  };
  const cursorNode = makeCursorNode();
  const stNode = {};
  // Stopped, exactly as create() builds it: the clock only advances once
  // play() has said so.
  const clock = new EngineClock({ contextTime: initialContextTime, position: sampleIndex(0), samplesPerSecond: 0 });
  const tempoState = { ratio: 1 };
  const endedBox = { fire: () => {} };
  const playingState = { playing: false };
  const durationFrames = 10_000_000;

  const Ctor = EngineController as unknown as new (
    context: unknown,
    cursorNode: unknown,
    stNode: unknown,
    clock: unknown,
    tempoState: unknown,
    endedBox: unknown,
    playingState: unknown,
    durationFrames: unknown,
  ) => EngineControllerType;

  const controller = new Ctor(
    context,
    cursorNode,
    stNode,
    clock,
    tempoState,
    endedBox,
    playingState,
    durationFrames,
  );
  return { controller, context, cursorNode, clock };
}

const BAR_STARTS = [0, 480, 960, 1440].map(sampleIndex);

describe('EngineController transport and the clock', () => {
  it('does not advance the reported position while stopped', async () => {
    const { controller, context } = makeController(0);
    await controller.play();
    context.currentTime = 1;
    expect(controller.getPositionSamples()).toBe(SAMPLE_RATE);

    controller.pause();
    // A whole second of real time passes with the transport stopped: the
    // cursor is not moving, so neither may the position the UI reads.
    context.currentTime = 2;
    expect(controller.getPositionSamples()).toBe(SAMPLE_RATE);
  });

  it('resumes from where it was paused rather than from the old anchor', async () => {
    const { controller, context } = makeController(0);
    await controller.play();
    context.currentTime = 1;
    controller.pause();

    context.currentTime = 5; // four seconds of sitting still
    await controller.play();
    context.currentTime = 6;

    // One second of playback after the pause, not five.
    expect(controller.getPositionSamples()).toBe(2 * SAMPLE_RATE);
  });

  it('seeking while paused leaves the position exactly where it was put', () => {
    const { controller, context } = makeController(0);
    controller.seek(sampleIndex(123_456));
    context.currentTime = 2;
    expect(controller.getPositionSamples()).toBe(123_456);
  });
});

describe('EngineController.countInAndPlay cancellation', () => {
  it('restores gains exactly once when the cursor reaches from (normal path)', async () => {
    const { controller, context } = makeController(0);
    const restoreGains = vi.fn();
    const from = sampleIndex(960); // countFrom (bars=1) resolves to 480

    const done = controller.countInAndPlay(from, 1, BAR_STARTS, restoreGains);
    await waitForRaf();

    // Not yet at `from`: 0.001s * 48000 = 48 samples past countFrom (480), well short of 960.
    context.currentTime = 0.001;
    flushOneFrame();
    await waitForRaf();
    expect(restoreGains).not.toHaveBeenCalled();

    // Comfortably past `from`.
    context.currentTime = 0.02;
    flushOneFrame();
    await done;

    expect(restoreGains).toHaveBeenCalledTimes(1);
  });

  it('a count-in interrupted by pause() restores gains and its promise settles rather than hanging', async () => {
    const { controller } = makeController(0);
    const restoreGains = vi.fn();
    const from = sampleIndex(960);

    const done = controller.countInAndPlay(from, 1, BAR_STARTS, restoreGains);
    await waitForRaf();

    controller.pause(); // cancelCountIn() runs synchronously here: restores gains, bumps generation

    expect(restoreGains).toHaveBeenCalledTimes(1);

    // The stale tick still queued from before the pause must notice the
    // generation changed and resolve without touching gains again.
    flushOneFrame();
    await done;

    expect(restoreGains).toHaveBeenCalledTimes(1);
  });

  it('a count-in interrupted by seek() restores gains and its promise settles rather than hanging', async () => {
    const { controller } = makeController(0);
    const restoreGains = vi.fn();
    const from = sampleIndex(960);

    const done = controller.countInAndPlay(from, 1, BAR_STARTS, restoreGains);
    await waitForRaf();

    controller.seek(sampleIndex(500));

    expect(restoreGains).toHaveBeenCalledTimes(1);

    flushOneFrame();
    await done;

    expect(restoreGains).toHaveBeenCalledTimes(1);
  });

  it('a second countInAndPlay while the first is pending does not later fire the first restoreGains', async () => {
    const { controller, context } = makeController(0);
    const restoreGains1 = vi.fn();
    const restoreGains2 = vi.fn();

    const done1 = controller.countInAndPlay(sampleIndex(960), 1, BAR_STARTS, restoreGains1);
    await waitForRaf();

    // Supersede before the first ever reaches its `from`.
    const done2 = controller.countInAndPlay(sampleIndex(1440), 1, BAR_STARTS, restoreGains2);
    await waitForRaf();

    // The first's restore ran once, synchronously, as part of being cancelled.
    expect(restoreGains1).toHaveBeenCalledTimes(1);

    // Flushing frames -- including the first's now-stale queued tick -- must
    // not call the first's restore again, however many times it's polled.
    flushOneFrame();
    flushOneFrame();
    expect(restoreGains1).toHaveBeenCalledTimes(1);
    expect(restoreGains2).not.toHaveBeenCalled();

    // Let the second one actually complete.
    context.currentTime = 1; // comfortably past the second count-in's `from`
    flushOneFrame();
    await done1;
    await done2;

    expect(restoreGains1).toHaveBeenCalledTimes(1);
    expect(restoreGains2).toHaveBeenCalledTimes(1);
  });
});
