// The strum lane (D-20). Repaints every frame while playing, since the cursor
// moves continuously; all of it from the engine clock (U-05), none of it audio
// (D-07). aria-hidden: the neck's label already says what this bar holds.
import { useCallback, useRef } from 'react';

import type { SampleIndex } from '../engine/types';
import { beatPosition, type Grid } from '../music/grid';
import { guitarChordText, strokeIndexAt, type GuitarBar } from '../music/guitarSource';
import { usePlayhead } from '../songview/usePlayhead';
import { playAlongColors, type PlayAlongColors } from './colors';
import { useParentWidth } from './Neck';
import styles from './PlayAlong.module.css';
import { paintStrumLane, STRUM_LANE_H } from './strumLanePainter';

export interface StrumLaneProps {
  bars: GuitarBar[];
  nextOf(bar: number): number | null;
  grid: Grid;
  /** The strum's name, for the lane title ("folk"). */
  strum: string;
  getPosition(): SampleIndex;
  playing: boolean;
  seekNonce: number;
}

export function StrumLane({ bars, nextOf, grid, strum, getPosition, playing, seekNonce }: StrumLaneProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const width = useParentWidth(canvasRef);
  const colors = useRef<PlayAlongColors | null>(null);

  const paint = useCallback(
    (position: SampleIndex) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const dpr = window.devicePixelRatio || 1;
      if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(STRUM_LANE_H * dpr)) {
        canvas.width = Math.round(width * dpr);
        canvas.height = Math.round(STRUM_LANE_H * dpr);
        canvas.style.height = `${STRUM_LANE_H}px`;
      }
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      colors.current ??= playAlongColors();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const at = beatPosition(grid, position);
      const current = at ? bars[at.bar] : undefined;
      const nextIndex = at ? nextOf(at.bar) : null;
      const next = nextIndex === null ? undefined : bars[nextIndex];
      paintStrumLane(
        ctx,
        width,
        colors.current,
        current ? { bar: current, title: `Bar ${current.bar + 1} · ${guitarChordText(current)} · ${strum}` } : null,
        next ? { bar: next, title: `Next · bar ${next.bar + 1} · ${guitarChordText(next)}` } : null,
        grid.beatsPerBar,
        at?.frac ?? 0,
        current && at ? strokeIndexAt(current, at.frac * grid.beatsPerBar) : -1,
      );
    },
    [bars, nextOf, grid, strum, width],
  );
  usePlayhead(getPosition, paint, playing, seekNonce);

  return <canvas ref={canvasRef} className={styles.canvas} data-testid="strum-lane-canvas" aria-hidden="true" />;
}
