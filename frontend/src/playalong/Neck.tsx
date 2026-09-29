// Play along's neck (D-18). A canvas painted from the engine clock through
// usePlayhead, never from React state at audio rate (U-05). It draws; it never
// plays (D-07). The neck is still between notes, so a frame repaints only when
// the bar, the lit note, the width or the bars themselves change.
import { useCallback, useLayoutEffect, useRef, useState, type RefObject } from 'react';

import type { SampleIndex } from '../engine/types';
import type { PlacedBar } from '../music/fingering';
import { beatPosition, type Grid } from '../music/grid';
import type { ResolvedKey } from '../music/patterns';
import { describeBar, noteIndexAt } from '../music/tabSource';
import { usePlayhead } from '../songview/usePlayhead';
import { playAlongColors, type PlayAlongColors } from './colors';
import { NECK_H, paintNeck } from './neckPainter';
import styles from './PlayAlong.module.css';

export interface NeckProps {
  bars: PlacedBar[];
  nextOf(bar: number): number | null;
  songKey: ResolvedKey;
  grid: Grid;
  getPosition(): SampleIndex;
  playing: boolean;
  seekNonce: number;
}

/** Tracks the width of the canvas's parent, so the neck fills its panel. */
export function useParentWidth(ref: RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const parent = ref.current?.parentElement;
    if (!parent) return;
    const measure = () => setWidth(parent.clientWidth);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(parent);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}

export function Neck({ bars, nextOf, songKey, grid, getPosition, playing, seekNonce }: NeckProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const width = useParentWidth(canvasRef);
  const colors = useRef<PlayAlongColors | null>(null);
  const last = useRef<{ bars: PlacedBar[]; bar: number; hot: number; width: number } | null>(null);

  const paint = useCallback(
    (position: SampleIndex) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const at = beatPosition(grid, position);
      const barIndex = at?.bar ?? -1;
      const current = at ? bars[at.bar] : undefined;
      const hot = current && at ? noteIndexAt(current, at.frac * grid.beatsPerBar) : -1;
      const seen = last.current;
      if (seen && seen.bars === bars && seen.bar === barIndex && seen.hot === hot && seen.width === width) return;

      const nextIndex = at ? nextOf(at.bar) : null;
      const next = nextIndex === null ? undefined : bars[nextIndex];
      canvas.setAttribute(
        'aria-label',
        at ? `${describeBar(current, songKey)}. Next: ${describeBar(next, songKey)}` : 'Before the first bar',
      );

      const dpr = window.devicePixelRatio || 1;
      if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(NECK_H * dpr)) {
        canvas.width = Math.round(width * dpr);
        canvas.height = Math.round(NECK_H * dpr);
        canvas.style.height = `${NECK_H}px`;
      }
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      last.current = { bars, bar: barIndex, hot, width };
      colors.current ??= playAlongColors();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      paintNeck(ctx, width, colors.current, current ?? null, next ?? null, hot);
    },
    [bars, nextOf, songKey, grid, width],
  );
  usePlayhead(getPosition, paint, playing, seekNonce);

  return <canvas ref={canvasRef} className={styles.canvas} data-testid="neck-canvas" role="img" aria-label="Bass neck" />;
}
