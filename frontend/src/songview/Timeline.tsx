// UI spec §5, "Timeline": bar ruler, beat grid (faint), downbeat grid (bright),
// A-B region with bar labels, playhead. Everything is positioned as a percentage
// of the song's sample length, so the whole thing scales with its container and
// stays in the 48 kHz domain until the last moment (D-03).
import { useCallback, useRef, type MouseEvent } from 'react';

import { barStart, type Grid } from '../music/grid';
import { sampleIndex, type SampleIndex } from '../engine/types';
import { usePlayhead } from './usePlayhead';
import styles from './Timeline.module.css';

export interface TimelineProps {
  grid: Grid | null;
  durationSamples: SampleIndex;
  loop: { startBar: number; endBar: number } | null;
  loopArmed: boolean;
  getPosition(): SampleIndex;
  playing: boolean;
  onScrub(position: SampleIndex): void;
}

export function Timeline({
  grid,
  durationSamples,
  loop,
  loopArmed,
  getPosition,
  playing,
  onScrub,
}: TimelineProps) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const playheadRef = useRef<HTMLDivElement | null>(null);

  const pct = useCallback(
    (position: number) => (durationSamples > 0 ? (position / durationSamples) * 100 : 0),
    [durationSamples],
  );

  // Writes to a ref, never to state: this runs 60 times a second.
  const paint = useCallback(
    (position: SampleIndex) => {
      if (playheadRef.current) playheadRef.current.style.left = `${pct(position)}%`;
    },
    [pct],
  );
  usePlayhead(getPosition, paint, playing);

  const handleClick = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      const rect = (trackRef.current ?? event.currentTarget).getBoundingClientRect();
      if (rect.width === 0) return;
      const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
      onScrub(sampleIndex(ratio * durationSamples));
    },
    [durationSamples, onScrub],
  );

  return (
    <div className={styles.timeline}>
      {!grid && (
        <p className={styles.note}>
          No beat grid for this song yet &mdash; bars, snapping and the metronome need
          analysis to have run.
        </p>
      )}

      <div
        ref={trackRef}
        data-testid="timeline-track"
        className={styles.track}
        onClick={handleClick}
      >
        {grid?.beats.map((beat, i) => (
          <span key={`beat-${i}`} className={styles.beat} style={{ left: `${pct(beat)}%` }} />
        ))}
        {grid?.bars.map((bar, i) => (
          <span key={`bar-${i}`} className={styles.bar} style={{ left: `${pct(bar)}%` }}>
            {/* Bars are 1-indexed on screen, 0-indexed in the data. */}
            <b className={styles.barLabel}>{i + 1}</b>
          </span>
        ))}

        {grid && loop && (
          <div
            role="region"
            aria-label={`Loop bars ${loop.startBar + 1} to ${loop.endBar + 1}`}
            data-armed={loopArmed ? 'true' : 'false'}
            className={styles.region}
            style={{
              left: `${pct(barStart(grid, loop.startBar))}%`,
              width: `${pct(barStart(grid, loop.endBar)) - pct(barStart(grid, loop.startBar))}%`,
            }}
          >
            <b>{loop.startBar + 1}</b>
            <b>{loop.endBar + 1}</b>
          </div>
        )}

        <div ref={playheadRef} className={styles.playhead} />
      </div>
    </div>
  );
}
