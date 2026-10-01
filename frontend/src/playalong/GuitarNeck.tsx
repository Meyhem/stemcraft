// The guitar Tabs neck (D-20): this bar's shape and the next, painted from the
// engine clock through usePlayhead, never from React state at audio rate
// (U-05). It draws; it never plays (D-07). It repaints only when the bar, the
// stroke under the playhead, the width or the bars themselves change.
import { useCallback, useRef } from 'react';

import type { SampleIndex } from '../engine/types';
import { beatPosition, type Grid } from '../music/grid';
import { describeGuitarBar, strokeIndexAt, type GuitarBar } from '../music/guitarSource';
import { usePlayhead } from '../songview/usePlayhead';
import { playAlongColors, type PlayAlongColors } from './colors';
import { GUITAR_NECK_H, paintGuitarNeck } from './guitarNeckPainter';
import { useParentWidth } from './Neck';
import styles from './PlayAlong.module.css';

export interface GuitarNeckProps {
  bars: GuitarBar[];
  nextOf(bar: number): number | null;
  grid: Grid;
  getPosition(): SampleIndex;
  playing: boolean;
  seekNonce: number;
}

export function GuitarNeck({ bars, nextOf, grid, getPosition, playing, seekNonce }: GuitarNeckProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const width = useParentWidth(canvasRef);
  const colors = useRef<PlayAlongColors | null>(null);
  const last = useRef<{ bars: GuitarBar[]; bar: number; hot: number; width: number } | null>(null);

  const paint = useCallback(
    (position: SampleIndex) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const at = beatPosition(grid, position);
      const barIndex = at?.bar ?? -1;
      const current = at ? bars[at.bar] : undefined;
      const hot = current && at ? strokeIndexAt(current, at.frac * grid.beatsPerBar) : -1;
      const seen = last.current;
      if (seen && seen.bars === bars && seen.bar === barIndex && seen.hot === hot && seen.width === width) return;

      const nextIndex = at ? nextOf(at.bar) : null;
      const next = nextIndex === null ? undefined : bars[nextIndex];
      canvas.setAttribute(
        'aria-label',
        at ? `${describeGuitarBar(current)}. Next: ${describeGuitarBar(next)}` : 'Before the first bar',
      );

      const dpr = window.devicePixelRatio || 1;
      if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(GUITAR_NECK_H * dpr)) {
        canvas.width = Math.round(width * dpr);
        canvas.height = Math.round(GUITAR_NECK_H * dpr);
        canvas.style.height = `${GUITAR_NECK_H}px`;
      }
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      last.current = { bars, bar: barIndex, hot, width };
      colors.current ??= playAlongColors();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      paintGuitarNeck(ctx, width, colors.current, current ?? null, next ?? null, hot >= 0);
    },
    [bars, nextOf, grid, width],
  );
  usePlayhead(getPosition, paint, playing, seekNonce);

  return <canvas ref={canvasRef} className={styles.canvas} data-testid="guitar-neck-canvas" role="img" aria-label="Guitar neck" />;
}
