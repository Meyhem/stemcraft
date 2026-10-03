import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import { DEFAULT_INSTRUMENT_SETTINGS, type InstrumentSettings } from '../api/client';
import { sampleIndex, type SampleIndex } from '../engine/types';
import { generate } from '../music/practice/generate';
import { gainsFor, usePracticeSession, type PracticeEngine } from './usePracticeSession';

function fakeEngine() {
  let position = 0;
  const engine = {
    replaceStems: vi.fn(),
    setGrid: vi.fn(),
    setLoop: vi.fn(),
    seek: vi.fn((p: SampleIndex) => void (position = p)),
    play: vi.fn(async () => {}),
    pause: vi.fn(),
    countInAndPlay: vi.fn(async () => {}),
    setStemGain: vi.fn(),
    setMetronome: vi.fn(),
    setMetronomeLevel: vi.fn(),
    setTempo: vi.fn(),
    getPositionSamples: vi.fn(() => sampleIndex(position)),
    dispose: vi.fn(async () => {}),
    moveTo(p: number) {
      position = p;
    },
  };
  return engine;
}

let frames: FrameRequestCallback[] = [];
beforeEach(() => {
  frames = [];
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => frames.push(cb));
  vi.stubGlobal('cancelAnimationFrame', () => {});
});
const tick = () => {
  const queue = frames;
  frames = [];
  queue.forEach((cb) => cb(0));
};

function setup(settings: InstrumentSettings = DEFAULT_INSTRUMENT_SETTINGS) {
  const engine = fakeEngine();
  const r = generate('bass', settings);
  if (!r.ok) throw new Error(r.error);
  const createEngine = vi.fn(async () => engine as unknown as PracticeEngine);
  const hook = renderHook((props: { settings: InstrumentSettings; loop: typeof r.loop }) =>
    usePracticeSession({ instrument: 'bass', settings: props.settings, loop: props.loop, createEngine }),
    { initialProps: { settings, loop: r.loop } },
  );
  return { engine, hook, createEngine, loop: r.loop };
}

test('gainsFor: each part in its slot, mutes as zero', () => {
  const levels = { click: 0.7, click_muted: false, ref: 0.8, ref_muted: false, backing: 0.6, backing_muted: true, chords: 0.5, chords_muted: false, drums: 0.4, drums_muted: false };
  expect(gainsFor('bass', levels)).toEqual({ vocals: 0, drums: 0.4, bass: 0.8, other: 0.5 });
  expect(gainsFor('guitar', levels)).toEqual({ vocals: 0, drums: 0.4, bass: 0, other: 0.8 });
  expect(gainsFor('bass', { ...levels, drums_muted: true, chords_muted: true }).drums).toBe(0);
});

describe('usePracticeSession', () => {
  test('creates one engine, hands it the grid and the loop, and parks at bar 1', async () => {
    const { engine, hook, createEngine } = setup();
    await waitFor(() => expect(hook.result.current.rendered).not.toBeNull());
    const r = hook.result.current.rendered!;
    expect(createEngine).toHaveBeenCalledTimes(1);
    expect(engine.setGrid).toHaveBeenCalledWith(r.grid.bars, r.grid.beats);
    expect(engine.setLoop).toHaveBeenCalledWith({ startFrame: r.loopStart, endFrame: r.loopEnd });
    expect(engine.seek).toHaveBeenLastCalledWith(r.loopStart);
    expect(engine.setStemGain).toHaveBeenCalledWith('bass', 0.8);
    expect(engine.setMetronomeLevel).toHaveBeenCalledWith(0.7);
  });

  test('the first play counts in; pause then play resumes without one', async () => {
    const { engine, hook } = setup();
    await waitFor(() => expect(hook.result.current.rendered).not.toBeNull());
    const r = hook.result.current.rendered!;
    act(() => hook.result.current.togglePlay());
    expect(engine.countInAndPlay).toHaveBeenCalledWith(r.loopStart, 1, r.grid.bars, expect.any(Function));
    act(() => hook.result.current.togglePlay());
    expect(engine.pause).toHaveBeenCalled();
    act(() => hook.result.current.togglePlay());
    expect(engine.play).toHaveBeenCalledTimes(1);
    expect(engine.countInAndPlay).toHaveBeenCalledTimes(1);
  });

  test('a new loop replaces the stems in the same engine', async () => {
    const { engine, hook, createEngine, loop } = setup();
    await waitFor(() => expect(hook.result.current.rendered).not.toBeNull());
    const other = generate('bass', { ...DEFAULT_INSTRUMENT_SETTINGS, exercise: 'drill' });
    if (!other.ok) throw new Error(other.error);
    hook.rerender({ settings: DEFAULT_INSTRUMENT_SETTINGS, loop: other.loop });
    await waitFor(() => expect(engine.replaceStems).toHaveBeenCalledTimes(1));
    expect(createEngine).toHaveBeenCalledTimes(1);
    expect(loop).not.toBe(other.loop);
  });

  test('the ramp steps at the loop wrap, as a tempo ratio over the start', async () => {
    const settings = { ...DEFAULT_INSTRUMENT_SETTINGS, count_in_bars: 0 as const, ramp: { on: true, start: 80, target: 120, step: 5, every_loops: 1 } };
    const { engine, hook } = setup(settings);
    await waitFor(() => expect(hook.result.current.rendered).not.toBeNull());
    const r = hook.result.current.rendered!;
    expect(r.bpm).toBe(80);
    act(() => hook.result.current.togglePlay());
    engine.moveTo(r.loopEnd - 100);
    act(() => tick());
    engine.moveTo(r.loopStart + 100);
    act(() => tick());
    expect(hook.result.current.loopsDone).toBe(1);
    expect(engine.setTempo).toHaveBeenLastCalledWith(85 / 80);
  });

  test('an engine that cannot start is an error, quoted', async () => {
    const r = generate('bass', DEFAULT_INSTRUMENT_SETTINGS);
    if (!r.ok) throw new Error(r.error);
    const hook = renderHook(() =>
      usePracticeSession({
        instrument: 'bass',
        settings: DEFAULT_INSTRUMENT_SETTINGS,
        loop: r.loop,
        createEngine: async () => {
          throw new Error('The browser’s audio runs at 44100 Hz');
        },
      }),
    );
    await waitFor(() => expect(hook.result.current.error).toBe('The browser’s audio runs at 44100 Hz'));
  });

  test('disposes the engine on unmount', async () => {
    const { engine, hook } = setup();
    await waitFor(() => expect(hook.result.current.rendered).not.toBeNull());
    hook.unmount();
    expect(engine.dispose).toHaveBeenCalled();
  });
});

test('changing the groove re-renders; changing a level does not', async () => {
  const { engine, hook, loop } = setup();
  await waitFor(() => expect(hook.result.current.rendered).not.toBeNull());
  hook.rerender({ settings: { ...DEFAULT_INSTRUMENT_SETTINGS, levels: { ...DEFAULT_INSTRUMENT_SETTINGS.levels, drums: 0.1 } }, loop });
  await new Promise((r) => setTimeout(r, 0));
  expect(engine.replaceStems).not.toHaveBeenCalled();
  hook.rerender({ settings: { ...DEFAULT_INSTRUMENT_SETTINGS, backing: { chord_sound: 'pad', drum_groove: 'funk' } }, loop });
  await waitFor(() => expect(engine.replaceStems).toHaveBeenCalledTimes(1));
});

test('a muted click is level 0, so the count-in is silent too', async () => {
  const muted = { ...DEFAULT_INSTRUMENT_SETTINGS, levels: { ...DEFAULT_INSTRUMENT_SETTINGS.levels, click_muted: true } };
  const { engine, hook } = setup(muted);
  await waitFor(() => expect(hook.result.current.rendered).not.toBeNull());
  expect(engine.setMetronomeLevel).toHaveBeenLastCalledWith(0);
});
