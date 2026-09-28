// D6-01/D6-02: the Song view's stem waveforms and its near-silent marks are
// derived in the browser from the buffers the engine already decoded. peaks.json
// covers the mix only, and four more HTTP round trips inside N-03's 3 s budget
// buy nothing the decoded PCM does not already hold.
import type { StemName } from './EngineController';

/**
 * Mirrors NEAR_SILENT_THRESHOLD in
 * packages/stemcraft_worker/src/stemcraft_worker/kinds/separate_song.py (~-34 dBFS).
 * If one moves, move the other: a lane marked empty here and not there (or the
 * reverse) is exactly the kind of quiet disagreement N-08 forbids.
 */
export const NEAR_SILENT_THRESHOLD = 0.02;

export interface StemSummary {
  name: StemName;
  /** Absolute peak per bucket, 0..1. wavesurfer renders this directly. */
  envelope: Float32Array;
  /** Absolute peak over the whole stem. */
  peak: number;
  /** U-10: an empty lane is marked, never left as an unexplained flat line. */
  nearSilent: boolean;
}

interface ChannelSource {
  length: number;
  sampleRate: number;
  numberOfChannels: number;
  getChannelData(channel: number): Float32Array;
}

export function summariseStem(
  buffer: ChannelSource,
  name: StemName,
  bucketsPerSecond = 100,
): StemSummary {
  const channels: Float32Array[] = [];
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) channels.push(buffer.getChannelData(ch));

  const framesPerBucket = Math.max(1, Math.round(buffer.sampleRate / bucketsPerSecond));
  const bucketCount = Math.ceil(buffer.length / framesPerBucket);
  const envelope = new Float32Array(bucketCount);
  let peak = 0;

  for (let bucket = 0; bucket < bucketCount; bucket++) {
    const start = bucket * framesPerBucket;
    const end = Math.min(start + framesPerBucket, buffer.length);
    let localPeak = 0;
    for (const channel of channels) {
      for (let i = start; i < end; i++) {
        const magnitude = Math.abs(channel[i]!);
        if (magnitude > localPeak) localPeak = magnitude;
      }
    }
    envelope[bucket] = localPeak;
    if (localPeak > peak) peak = localPeak;
  }

  return { name, envelope, peak, nearSilent: peak < NEAR_SILENT_THRESHOLD };
}
