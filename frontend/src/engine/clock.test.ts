import { expect, test } from 'vitest';

import { sampleIndex } from './types';
import { EngineClock } from './clock';

test('extrapolates position at real-time tempo', () => {
  const clock = new EngineClock({
    contextTime: 10,
    position: sampleIndex(48_000),
    samplesPerSecond: 48_000,
  });

  const result = clock.positionAt(11);
  expect(result).toBe(96_000);
});

test('extrapolates position with tempo scaling', () => {
  const clock = new EngineClock({
    contextTime: 10,
    position: sampleIndex(48_000),
    samplesPerSecond: 24_000,
  });

  const result = clock.positionAt(11);
  expect(result).toBe(72_000);
});

test('resync updates the anchor and does not leak stale state', () => {
  const clock = new EngineClock({
    contextTime: 10,
    position: sampleIndex(48_000),
    samplesPerSecond: 48_000,
  });

  clock.resync({
    contextTime: 11,
    position: sampleIndex(90_000),
    samplesPerSecond: 48_000,
  });

  const result = clock.positionAt(12);
  expect(result).toBe(138_000);
});
