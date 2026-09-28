// UI spec §5, "Chord strip": runs under the timeline, read at a glance from
// ~1.5 m while playing. Segments position by their own start_sample/end_sample
// (the analysis already aligned them to bars) as a percentage of the song's
// sample length, same convention as Timeline. The current-chord highlight is
// painted from this component's own rAF loop into a ref, same pattern as
// Timeline's playhead and reading the same engine clock -- never React state,
// which at 60 fps would re-render a tree containing four canvases sixty times
// a second.
import { useCallback, useRef } from 'react';

import type { ChordSegment } from '../api/client';
import { sampleIndex, type SampleIndex } from '../engine/types';
import type { Grid } from '../music/grid';
import { percentOf } from '../music/percent';
import { usePlayhead } from './usePlayhead';
import styles from './ChordStrip.module.css';

export interface ChordStripProps {
  chords: ChordSegment[];
  grid: Grid | null;
  durationSamples: SampleIndex;
  getPosition(): SampleIndex;
  playing: boolean;
  /**
   * Bumped by the owner whenever it moves the engine cursor, so this readout
   * repaints after a scrub or a bar nudge made while paused (usePlayhead).
   */
  seekNonce: number;
}

/**
 * "G:maj" -> "G", "E:min" -> "Em", "C:maj7" -> "Cmaj7", "N" -> no chord,
 * "X" -> unclassifiable. The wire format is BTC's; this is the reading of it.
 * Both N and X are rendered as marks with labels rather than as blanks -- a gap
 * in the strip would read as a rendering bug instead of as "the model had
 * nothing to say here" (N-08's spirit applied to a display).
 */
export function formatChord(chord: string): { text: string; label: string } {
  if (chord === 'N') return { text: '–', label: 'no chord' };
  if (chord === 'X') return { text: '?', label: 'unclassified' };
  const [root, quality] = chord.split(':');
  if (!quality) return { text: chord, label: chord };
  if (quality === 'maj') return { text: root!, label: `${root} major` };
  if (quality === 'min') return { text: `${root}m`, label: `${root} minor` };
  return { text: `${root}${quality}`, label: `${root} ${quality}` };
}

export function ChordStrip({
  chords,
  grid,
  durationSamples,
  getPosition,
  playing,
  seekNonce,
}: ChordStripProps) {
  const segmentRefs = useRef<(HTMLDivElement | null)[]>([]);
  const currentIndex = useRef<number>(-1);

  const findCurrent = useCallback(
    (position: SampleIndex) => {
      // Segments are in ascending order. Rather than rescan the whole array
      // every frame, walk from last frame's answer -- the playhead almost
      // always advances by a hair between ticks, so this is O(1) amortized in
      // realistic playback, matching Timeline's painter (and barAt's own
      // walk-from-the-last-answer discipline for the same reason).
      if (chords.length === 0) return -1;
      let i = currentIndex.current >= 0 ? currentIndex.current : 0;
      while (i + 1 < chords.length && position >= sampleIndex(chords[i + 1]!.start_sample)) {
        i++;
      }
      while (i > 0 && position < sampleIndex(chords[i]!.start_sample)) {
        i--;
      }
      return position >= sampleIndex(chords[i]!.start_sample) ? i : -1;
    },
    [chords],
  );

  const paint = useCallback(
    (position: SampleIndex) => {
      const next = findCurrent(position);
      if (next === currentIndex.current) return;
      const prevEl = currentIndex.current >= 0 ? segmentRefs.current[currentIndex.current] : null;
      if (prevEl) prevEl.dataset.current = 'false';
      const nextEl = next >= 0 ? segmentRefs.current[next] : null;
      if (nextEl) nextEl.dataset.current = 'true';
      currentIndex.current = next;
    },
    [findCurrent],
  );
  usePlayhead(getPosition, paint, playing, seekNonce);

  const pct = useCallback(
    (position: number) => percentOf(durationSamples, position),
    [durationSamples],
  );

  if (chords.length === 0) {
    return (
      <div className={styles.strip}>
        <p className={styles.note}>No chord chart for this song yet.</p>
      </div>
    );
  }

  return (
    <div className={styles.strip} data-testid="chord-strip">
      <div className={styles.track}>
        {chords.map((segment, i) => {
          const { text, label } = formatChord(segment.chord);
          const left = pct(segment.start_sample);
          const width = Math.max(0, pct(segment.end_sample) - pct(segment.start_sample));
          return (
            <div
              key={`${segment.start_sample}-${i}`}
              ref={(el) => {
                segmentRefs.current[i] = el;
              }}
              className={styles.segment}
              data-current="false"
              style={{ left: `${left}%`, width: `${width}%` }}
              aria-label={label}
            >
              {text}
            </div>
          );
        })}
        {grid?.bars.map((bar, i) => (
          <span key={`bar-${i}`} className={styles.barTick} style={{ left: `${pct(bar)}%` }} />
        ))}
      </div>
    </div>
  );
}
