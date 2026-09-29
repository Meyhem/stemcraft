// UI spec §5, "Timeline": the bar ruler row at the top of the Song view's time
// axis, plus the overlay every row shares -- beat grid (faint), bar and phrase
// lines, the A-B region and the playhead. Positions come from the shared
// TimeScale in px (music/timeScale.ts), the same mapping as the chord row and
// the waveforms, and stay in the 48 kHz sample domain until that last step
// (D-03).
//
// Renders two siblings into SongView's scrolling canvas: the ruler row, and an
// overlay absolutely positioned over the content area of *every* row, so the
// grid, the loop and the playhead span the chords and lanes too and pass under
// the sticky 200px heads.
//
// Follow-playhead lives here, in the playhead's own rAF painter: the painter
// already knows the playhead's x every frame, so it is the one place that can
// page the view without a React render per frame.
import { useCallback, useLayoutEffect, useRef, type MouseEvent } from 'react';

import { barStart, type Grid } from '../music/grid';
import {
  followScrollLeft,
  LANE_HEAD_PX,
  recentreScrollLeft,
  rulerLabelEvery,
  sampleAtX,
  showBeatLines,
  xOf,
  type TimeScale,
} from '../music/timeScale';
import type { SampleIndex } from '../engine/types';
import { usePlayhead } from './usePlayhead';
import axis from './Axis.module.css';
import styles from './Timeline.module.css';

export interface TimelineProps {
  grid: Grid | null;
  durationSamples: SampleIndex;
  scale: TimeScale;
  loop: { startBar: number; endBar: number } | null;
  loopArmed: boolean;
  getPosition(): SampleIndex;
  playing: boolean;
  /**
   * Bumped by the owner whenever it moves the engine cursor, so this readout
   * repaints after a scrub or a bar nudge made while paused (usePlayhead).
   */
  seekNonce: number;
  onScrub(position: SampleIndex): void;
  /** The horizontal scroll container the axis lives in; null until mounted. */
  scroller: HTMLElement | null;
  /** Keep the playhead in view by paging the scroller. */
  follow: boolean;
}

export function Timeline({
  grid,
  durationSamples,
  scale,
  loop,
  loopArmed,
  getPosition,
  playing,
  seekNonce,
  onScrub,
  scroller,
  follow,
}: TimelineProps) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const playheadRef = useRef<HTMLDivElement | null>(null);

  // Writes to a ref and the scroller, never to state: this runs 60 times a second.
  //
  // Follow pages the view while playing, and while paused only when the playhead itself
  // moved -- first paint, or a seek (a new seekNonce). This painter also re-runs on every
  // zoom; paging then would drag an at-the-pointer or drag-to-range zoom straight back
  // to a paused playhead, so no anchored zoom could ever land.
  const pagedFor = useRef<number | null>(null);
  const followWas = useRef(false);
  const paint = useCallback(
    (position: SampleIndex) => {
      const x = xOf(scale, position);
      if (playheadRef.current) playheadRef.current.style.left = `${x}px`;
      // Switching follow on is also a request to see the playhead.
      const moved = pagedFor.current !== seekNonce || (follow && !followWas.current);
      pagedFor.current = seekNonce;
      followWas.current = follow;
      if (follow && scroller && (playing || moved)) {
        const next = followScrollLeft(x, scroller.scrollLeft, scroller.clientWidth - LANE_HEAD_PX, playing);
        if (next !== null) scroller.scrollLeft = next;
      }
    },
    [scale, follow, scroller, playing, seekNonce],
  );
  usePlayhead(getPosition, paint, playing, seekNonce);

  // A zoom change re-centres on the playhead, follow or not: the bar you were
  // looking at must not fly off-screen because the axis got wider. Not on
  // mount -- only on a change of scale. Layout effect, so the scroll lands in
  // the same frame as the new content width.
  const lastPxPerSample = useRef(scale.pxPerSample);
  useLayoutEffect(() => {
    if (lastPxPerSample.current === scale.pxPerSample) return;
    lastPxPerSample.current = scale.pxPerSample;
    if (!scroller) return;
    const x = xOf(scale, getPosition());
    scroller.scrollLeft = recentreScrollLeft(x, scroller.clientWidth - LANE_HEAD_PX);
  }, [scale, scroller, getPosition]);

  const handleClick = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      // The rect's left is where the content starts on screen, already shifted
      // by the scroll, so the offset from it is a content-space x.
      const rect = (trackRef.current ?? event.currentTarget).getBoundingClientRect();
      onScrub(sampleAtX(scale, event.clientX - rect.left, durationSamples));
    },
    [scale, durationSamples, onScrub],
  );

  const width = `${scale.contentWidth}px`;
  const every = rulerLabelEvery(scale.pxPerBar);
  const beats = grid && showBeatLines(scale.pxPerBar) ? grid.beats : [];

  return (
    <>
      <div className={`${axis.row} ${styles.row}`} data-testid="ruler-row">
        <div className={`${axis.head} ${axis.caption} ${styles.head}`}>Bar</div>
        <div
          ref={trackRef}
          data-testid="timeline-track"
          className={`${axis.content} ${styles.track}`}
          style={{ width }}
          onClick={handleClick}
        >
          {grid ? (
            grid.bars.map((bar, i) =>
              i % every === 0 ? (
                // Bars are 1-indexed on screen, 0-indexed in the data.
                <b
                  key={i}
                  className={styles.barLabel}
                  data-phrase={i % 4 === 0 ? 'true' : 'false'}
                  style={{ left: `${xOf(scale, bar)}px` }}
                >
                  {i + 1}
                </b>
              ) : null,
            )
          ) : (
            <span className={styles.note}>Bars need analysis to have run</span>
          )}
        </div>
      </div>

      <div className={styles.overlay} style={{ left: `${LANE_HEAD_PX}px`, width }}>
        {beats.map((beat, i) => (
          <span key={`beat-${i}`} className={styles.line} data-line="beat" style={{ left: `${xOf(scale, beat)}px` }} />
        ))}
        {grid?.bars.map((bar, i) => (
          <span
            key={`bar-${i}`}
            className={styles.line}
            data-line={i % 4 === 0 ? 'phrase' : 'bar'}
            style={{ left: `${xOf(scale, bar)}px` }}
          />
        ))}

        {grid && loop && (
          <div
            role="region"
            aria-label={`Loop bars ${loop.startBar + 1} to ${loop.endBar + 1}`}
            data-armed={loopArmed ? 'true' : 'false'}
            className={styles.region}
            style={{
              left: `${xOf(scale, barStart(grid, loop.startBar))}px`,
              // A caller bug upstream (an inverted loop) must not render as a
              // silently clamped-to-zero-width, invisible region.
              width: `${Math.max(
                0,
                xOf(scale, barStart(grid, loop.endBar)) - xOf(scale, barStart(grid, loop.startBar)),
              )}px`,
            }}
          >
            <b className={styles.tag}>{loop.startBar + 1}</b>
            <b className={`${styles.tag} ${styles.tagEnd}`}>{loop.endBar + 1}</b>
          </div>
        )}

        <div ref={playheadRef} data-testid="playhead" className={styles.playhead} />
      </div>
    </>
  );
}
