import { expect, test } from 'vitest';

import {
  SAMPLE_RATE,
  SampleIndex,
  Seconds,
  sampleIndex,
  samplesToSeconds,
  seconds,
  secondsToSamples,
  toDeviceDomain,
} from './types';

test('round-trip conversion preserves exact sample counts for whole seconds', () => {
  const result = secondsToSamples(samplesToSeconds(sampleIndex(48_000)));
  expect(result).toBe(48_000);
});

test('samplesToSeconds converts 72_000 samples to 1.5 seconds', () => {
  const result = samplesToSeconds(sampleIndex(72_000));
  expect(result).toBe(1.5);
});

test('toDeviceDomain returns identity at matching rates', () => {
  const result = toDeviceDomain(sampleIndex(48_000), 48_000);
  expect(result).toBe(48_000);
});

test('toDeviceDomain scales correctly for different sample rates', () => {
  const result = toDeviceDomain(sampleIndex(48_000), 44_100);
  expect(result).toBe(44_100);
});

test('sampleIndex rounds fractional values', () => {
  const result = sampleIndex(10.6);
  expect(result).toBe(11);
});
