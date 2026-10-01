// U-14 on the album splitter: the master is all there is, so every stem colour
// swells with the same level and only their drift tells them apart. Levels come
// from the album's peaks read at the <audio> element's clock, never metered (D-07).
import { useMemo } from 'react';

import { follow } from './levels';
import { envelopeAt, pounded, settle } from './masterLevel';
import { PulseBar, type PulseFrame } from './PulseBar';

export function AlbumPulseBar({
  playing,
  envelope,
  bucketsPerSecond,
  getSeconds,
}: {
  playing: boolean;
  /** 0..1 per bucket, as WaveformMarkers draws it. Null until the peaks load. */
  envelope: readonly number[] | null;
  bucketsPerSecond: number;
  getSeconds: () => number;
}) {
  const frame = useMemo<PulseFrame | null>(() => {
    if (!envelope || envelope.length === 0 || bucketsPerSecond <= 0) return null;
    const peak = envelope.reduce((max, value) => Math.max(max, value), 0);
    // Seeded from the first frame, so the bar does not open on a two-second flare.
    let average: number | null = null;
    let level = 0;
    return (dt, levels, weights) => {
      const now = envelopeAt(envelope, peak, bucketsPerSecond, getSeconds());
      average = average === null ? now : settle(average, now, dt);
      level = follow(level, pounded(now, average), dt);
      levels.fill(level);
      weights.fill(1);
    };
  }, [envelope, bucketsPerSecond, getSeconds]);

  return <PulseBar owner="AlbumPulseBar" playing={playing} frame={frame} />;
}
