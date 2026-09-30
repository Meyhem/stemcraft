import { expect, test } from 'vitest';

import {
  TEMPO_MAX,
  TEMPO_MIN,
  clampTempo,
  SAMPLE_RATE,
  SampleIndex,
  Seconds,
  sampleIndex,
  samplesToSeconds,
  seconds,
  secondsToSamples,
  toDeviceDomain,
  toStemDomain,
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

test('toStemDomain returns identity at matching rates', () => {
  const result = toStemDomain(48_000, 48_000);
  expect(result).toBe(48_000);
});

test('toStemDomain round-trips through toDeviceDomain at a non-48kHz rate', () => {
  const original = sampleIndex(48_000);
  const deviceValue = toDeviceDomain(original, 44_100);
  expect(deviceValue).not.toBe(original as number); // sanity: ratio isn't a no-op
  const roundTripped = toStemDomain(deviceValue, 44_100);
  expect(roundTripped).toBe(original);
});

test('clampTempo keeps the N-04 range of 50 to 150 %', () => {
  expect(TEMPO_MIN).toBe(0.5);
  expect(TEMPO_MAX).toBe(1.5);
  expect(clampTempo(0.2)).toBe(0.5);
  expect(clampTempo(1.2)).toBe(1.2);
  expect(clampTempo(1.7)).toBe(1.5);
});
