import { describe, expect, it } from 'vitest';

import { NEAR_SILENT_THRESHOLD, summariseStem } from './stemPeaks';

/** A stand-in for AudioBuffer: jsdom has no Web Audio, and we only need these. */
function fakeBuffer(samples: Float32Array, sampleRate = 48_000) {
  return {
    length: samples.length,
    sampleRate,
    numberOfChannels: 1,
    getChannelData: () => samples,
  };
}

describe('summariseStem', () => {
  it('buckets the envelope at the requested rate', () => {
    const samples = new Float32Array(48_000).fill(0.5);
    const summary = summariseStem(fakeBuffer(samples), 'bass', 100);
    expect(summary.envelope.length).toBe(100);
    expect(summary.envelope[0]).toBeCloseTo(0.5);
  });

  it('takes the absolute peak in each bucket, not the mean', () => {
    const samples = new Float32Array(48_000);
    samples[10] = -0.9; // one loud negative sample in bucket 0
    const summary = summariseStem(fakeBuffer(samples), 'drums', 100);
    expect(summary.envelope[0]).toBeCloseTo(0.9);
    expect(summary.envelope[1]).toBe(0);
  });

  it('marks a near-silent stem (U-10)', () => {
    const samples = new Float32Array(48_000).fill(0.005);
    const summary = summariseStem(fakeBuffer(samples), 'vocals', 100);
    expect(summary.nearSilent).toBe(true);
    expect(summary.peak).toBeLessThan(NEAR_SILENT_THRESHOLD);
  });

  it('does not mark a stem that is merely quiet', () => {
    const samples = new Float32Array(48_000).fill(0.05);
    expect(summariseStem(fakeBuffer(samples), 'other', 100).nearSilent).toBe(false);
  });

  it("uses the worker's own threshold, so the UI and the job agree", () => {
    // packages/stemcraft_worker/.../separate_song.py NEAR_SILENT_THRESHOLD
    expect(NEAR_SILENT_THRESHOLD).toBe(0.02);
  });

  it('mixes both channels rather than reading only the left', () => {
    const left = new Float32Array(48_000);
    const right = new Float32Array(48_000).fill(0.8);
    const buffer = {
      length: 48_000,
      sampleRate: 48_000,
      numberOfChannels: 2,
      getChannelData: (ch: number) => (ch === 0 ? left : right),
    };
    const summary = summariseStem(buffer, 'bass', 100);
    expect(summary.nearSilent).toBe(false);
    expect(summary.envelope[0]).toBeCloseTo(0.8);
  });
});
