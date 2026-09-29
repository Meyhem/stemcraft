// UI spec §5, "Chord strip" -- now the second row of the Song view's time axis,
// directly under the bar ruler, read at a glance from ~1.5 m while playing.
// Runs of the same chord are merged into one segment (music/chords.ts), and
// segments are positioned in px by the shared TimeScale, the same mapping as
// the ruler and the waveforms, so a chord change sits on its bar line.
//
// The current-chord highlight is painted from this component's own rAF loop
// into a data attribute via refs, same pattern as Timeline's playhead and
// reading the same engine clock -- never React state, which at 60 fps would
// re-render a tree containing four canvases sixty times a second.
import { useCallback, useMemo, useRef } from 'react';

import type { ChordSegment } from '../api/client';
import type { SampleIndex } from '../engine/types';
import { chordIndexAt, chordLabelFits, displayChord, mergeChords } from '../music/chords';
import { xOf, type TimeScale } from '../music/timeScale';
import { usePlayhead } from './usePlayhead';
import axis from './Axis.module.css';
import styles from './ChordStrip.module.css';

// Kept exported from here: this is where the chord spelling was first defined.
export { formatChord } from '../music/chords';

/** px sizes of --ds-t-lg and --ds-t-sm, for the label-fit estimate only. */
const LABEL_PX = { regular: 24, compact: 15 };

export interface ChordStripProps {
  /** The analysis's per-bar segments; merged into runs here. */
  chords: ChordSegment[];
  scale: TimeScale;
  /** Fit zoom: smaller type, so more labels fit. */
  compact: boolean;
  getPosition(): SampleIndex;
  playing: boolean;
  /**
   * Bumped by the owner whenever it moves the engine cursor, so this readout
   * repaints after a scrub or a bar nudge made while paused (usePlayhead).
   */
  seekNonce: number;
}

export function ChordStrip({
  chords,
  scale,
  compact,
  getPosition,
  playing,
  seekNonce,
}: ChordStripProps) {
  const segments = useMemo(() => mergeChords(chords), [chords]);
  const segmentRefs = useRef<(HTMLDivElement | null)[]>([]);
  const currentIndex = useRef<number>(-1);

  const paint = useCallback(
    (position: SampleIndex) => {
      const next = chordIndexAt(segments, position);
      // Checks the element, not just last frame's index: a new chord list
      // mounts fresh segments at "false" while the index may be unchanged,
      // and an index-only diff would then leave the current chord unlit.
      const prevEl = currentIndex.current >= 0 ? segmentRefs.current[currentIndex.current] : null;
      if (prevEl && currentIndex.current !== next) prevEl.dataset.current = 'false';
      const nextEl = next >= 0 ? segmentRefs.current[next] : null;
      if (nextEl && nextEl.dataset.current !== 'true') nextEl.dataset.current = 'true';
      currentIndex.current = next;
    },
    [segments],
  );
  usePlayhead(getPosition, paint, playing, seekNonce);

  const fontPx = compact ? LABEL_PX.compact : LABEL_PX.regular;

  return (
    <div className={`${axis.row} ${styles.row}`} data-testid="chord-row">
      <div className={`${axis.head} ${axis.caption} ${styles.head}`}>Chords</div>
      <div
        className={`${axis.content} ${styles.track}`}
        data-compact={compact ? 'true' : 'false'}
        style={{ width: `${scale.contentWidth}px` }}
      >
        {segments.length === 0 ? (
          <p className={styles.note}>
            No chord chart for this song yet &mdash; it appears after analysis.
          </p>
        ) : (
          segments.map((segment, i) => {
            const { text, label } = displayChord(segment.chord);
            const left = xOf(scale, segment.start_sample);
            const width = Math.max(0, xOf(scale, segment.end_sample) - left);
            const quiet = segment.chord === 'N' || segment.chord === 'X';
            return (
              <div
                key={`${segment.start_sample}-${i}`}
                ref={(el) => {
                  segmentRefs.current[i] = el;
                }}
                className={styles.segment}
                data-current="false"
                data-quiet={quiet ? 'true' : 'false'}
                style={{ left: `${left}px`, width: `${width}px` }}
                aria-label={label}
                title={label}
              >
                {chordLabelFits(text, width, fontPx) && <span className={styles.label}>{text}</span>}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
