export const SAMPLE_RATE = 48_000;

declare const sampleIndexBrand: unique symbol;
/** An integer sample offset in the 48 kHz stem domain (D-03). Never a float second. */
export type SampleIndex = number & { readonly [sampleIndexBrand]: true };

declare const secondsBrand: unique symbol;
export type Seconds = number & { readonly [secondsBrand]: true };

export function sampleIndex(n: number): SampleIndex {
  return Math.round(n) as SampleIndex;
}

export function seconds(n: number): Seconds {
  return n as Seconds;
}

export function samplesToSeconds(n: SampleIndex, sampleRate: number = SAMPLE_RATE): Seconds {
  return seconds(n / sampleRate);
}

export function secondsToSamples(n: Seconds, sampleRate: number = SAMPLE_RATE): SampleIndex {
  return sampleIndex(n * sampleRate);
}

/**
 * Converts a 48 kHz-domain sample index into an index on a buffer decoded at a
 * different AudioContext sample rate. 1.0 whenever the context runs at 48 kHz,
 * which is the requested rate (Task 6) and the expected case on desktop browsers.
 */
export function toDeviceDomain(n: SampleIndex, deviceSampleRate: number): number {
  return (n as number) * (deviceSampleRate / SAMPLE_RATE);
}

/**
 * Converts an index on a buffer decoded at a different AudioContext sample rate
 * back into a 48 kHz-domain sample index. Inverse of `toDeviceDomain`. 1.0 whenever
 * the context runs at 48 kHz, which is the requested rate (Task 6) and the expected
 * case on desktop browsers.
 */
export function toStemDomain(n: number, deviceSampleRate: number): SampleIndex {
  return sampleIndex(n * (SAMPLE_RATE / deviceSampleRate));
}
