// The beat lane (D-18). Repaints every frame while playing, since the cursor
// moves continuously; all of it from the engine clock (U-05), none of it audio
// (D-07). aria-hidden: the neck's label already says what this bar holds.
import { useCallback, useRef } from 'react';

import type { SampleIndex } from '../engine/types';
import type { PlacedBar } from '../music/fingering';
import { beatPosition, type Grid } from '../music/grid';
import type { ResolvedKey } from '../music/patterns';
import { chordText, noteIndexAt } from '../music/tabSource';
import { usePlayhead } from '../songview/usePlayhead';
import { LANE_H, paintBeatLane } from './beatLanePainter';
import { playAlongColors, type PlayAlongColors } from './colors';
import { useParentWidth } from './Neck';
import styles from './PlayAlong.module.css';

export interface BeatLaneProps {
  bars: PlacedBar[];
  nextOf(bar: number): number | null;
  songKey: ResolvedKey;
  grid: Grid;
  getPosition(): SampleIndex;
  playing: boolean;
  seekNonce: number;
}

export function BeatLane({ bars, nextOf, songKey, grid, getPosition, playing, seekNonce }: BeatLaneProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const width = useParentWidth(canvasRef);
  const colors = useRef<PlayAlongColors | null>(null);

  const paint = useCallback(
    (position: SampleIndex) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const dpr = window.devicePixelRatio || 1;
      if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(LANE_H * dpr)) {
        canvas.width = Math.round(width * dpr);
        canvas.height = Math.round(LANE_H * dpr);
        canvas.style.height = `${LANE_H}px`;
      }
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      colors.current ??= playAlongColors();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const at = beatPosition(grid, position);
      const current = at ? bars[at.bar] : undefined;
      const nextIndex = at ? nextOf(at.bar) : null;
      const next = nextIndex === null ? undefined : bars[nextIndex];
      paintBeatLane(
        ctx,
        width,
        colors.current,
        current ? { bar: current, title: `Bar ${current.plan.bar + 1} · ${chordText(current, songKey)}` } : null,
        next ? { bar: next, title: `Next · bar ${next.plan.bar + 1} · ${chordText(next, songKey)}` } : null,
        grid.beatsPerBar,
        at?.frac ?? 0,
        current && at ? noteIndexAt(current, at.frac * grid.beatsPerBar) : -1,
      );
    },
    [bars, nextOf, songKey, grid, width],
  );
  usePlayhead(getPosition, paint, playing, seekNonce);

  return <canvas ref={canvasRef} className={styles.canvas} data-testid="beat-lane-canvas" aria-hidden="true" />;
}
