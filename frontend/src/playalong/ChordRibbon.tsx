// The whole chord chart as one cell per bar (D-18): where you are, where the
// loop is, and a quick way to set it. Click sets the loop start, shift-click
// the end, with the same one-bar minimum and no inversion as Set A / Set B.
// The current bar is lit from the engine clock into a data attribute (U-05),
// the same pattern as ChordStrip, never React state.
import { useCallback, useRef, type MouseEvent } from 'react';

import type { Loop } from '../api/client';
import type { SampleIndex } from '../engine/types';
import type { PlacedBar } from '../music/fingering';
import { barAt, type Grid } from '../music/grid';
import type { ResolvedKey } from '../music/patterns';
import { chordText } from '../music/tabSource';
import { usePlayhead } from '../songview/usePlayhead';
import styles from './PlayAlong.module.css';

export interface ChordRibbonProps {
  bars: PlacedBar[];
  songKey: ResolvedKey;
  loop: Loop | null;
  grid: Grid;
  getPosition(): SampleIndex;
  playing: boolean;
  seekNonce: number;
  onLoopBars(startBar: number, endBar: number): void;
}

export function ChordRibbon({ bars, songKey, loop, grid, getPosition, playing, seekNonce, onLoopBars }: ChordRibbonProps) {
  const cells = useRef<(HTMLButtonElement | null)[]>([]);
  const lit = useRef(-1);

  const paint = useCallback(
    (position: SampleIndex) => {
      const bar = barAt(grid, position);
      if (bar === lit.current && cells.current[bar]?.dataset.current === 'true') return;
      const previous = lit.current >= 0 ? cells.current[lit.current] : null;
      if (previous) previous.dataset.current = 'false';
      const cell = bar >= 0 ? cells.current[bar] : null;
      if (cell) cell.dataset.current = 'true';
      lit.current = bar;
    },
    [grid],
  );
  usePlayhead(getPosition, paint, playing, seekNonce);

  const select = (bar: number, event: MouseEvent) => {
    if (event.shiftKey) {
      const start = loop?.start_bar ?? 0;
      if (bar < start) return;
      onLoopBars(start, bar + 1);
      return;
    }
    onLoopBars(bar, Math.max(loop?.end_bar ?? 0, bar + 1));
  };

  return (
    <div className={styles.ribbon} role="group" aria-label="Chord chart by bar. Click sets the loop start, shift-click the end.">
      {bars.map((b, i) => {
        const inLoop = loop !== null && i >= loop.start_bar && i < loop.end_bar;
        const text = b.plan.empty ? (b.plan.empty === 'no_chord' ? '–' : '?') : chordText(b, songKey);
        return (
          <button
            key={i}
            type="button"
            ref={(el) => {
              cells.current[i] = el;
            }}
            className={styles.cell}
            data-current="false"
            data-in-loop={inLoop ? 'true' : 'false'}
            aria-label={`Bar ${i + 1}, ${chordText(b, songKey)}`}
            onClick={(event) => select(i, event)}
          >
            <span className={styles.cellBar}>{i + 1}</span>
            {text}
          </button>
        );
      })}
    </div>
  );
}
