import { describe, expect, test } from 'vitest';

import { rampLimits, rampState, tapTempo } from './tempo';

const ramp = { on: true, start: 80, target: 120, step: 5, every_loops: 2 };

describe('rampState', () => {
  test('steps up every two loops, and holds at the target', () => {
    expect(rampState(ramp, 0)).toEqual({ bpm: 80, step: 0, steps: 8, loopInStep: 1 });
    expect(rampState(ramp, 1)).toEqual({ bpm: 80, step: 0, steps: 8, loopInStep: 2 });
    expect(rampState(ramp, 2)).toEqual({ bpm: 85, step: 1, steps: 8, loopInStep: 1 });
    expect(rampState(ramp, 16)).toEqual({ bpm: 120, step: 8, steps: 8, loopInStep: null });
    expect(rampState(ramp, 99).bpm).toBe(120);
  });

  test('a last step shorter than the others lands exactly on the target', () => {
    expect(rampState({ ...ramp, target: 102 }, 10).bpm).toBe(102);
    expect(rampState({ ...ramp, target: 102 }, 8).bpm).toBe(100);
  });

  test('ramps down too', () => {
    expect(rampState({ ...ramp, start: 120, target: 100 }, 2).bpm).toBe(115);
  });
});

test('rampLimits is the engine’s 0.5–1.5× range, inside 40–220', () => {
  expect(rampLimits(80)).toEqual({ lo: 40, hi: 120 });
  expect(rampLimits(75)).toEqual({ lo: 40, hi: 112 });
  expect(rampLimits(200)).toEqual({ lo: 100, hi: 220 });
});

describe('tapTempo', () => {
  test('averages the last taps', () => {
    expect(tapTempo([0, 500, 1000, 1500])).toBe(120);
    expect(tapTempo([0, 600])).toBe(100);
  });
  test('needs two taps, and a pause over two seconds starts again', () => {
    expect(tapTempo([0])).toBeNull();
    expect(tapTempo([0, 500, 4000])).toBeNull();
    expect(tapTempo([0, 500, 4000, 4500])).toBe(120);
  });
  test('stays in 40–220', () => {
    expect(tapTempo([0, 100])).toBe(220);
    expect(tapTempo([0, 1900])).toBe(40);
  });
});
