// The Tab view's neck (D-21): the Play along painter fed by the transcription -- this
// bar's notes numbered in play order, the sounding one lit, the next bar dashed, unsure
// and shifted notes marked (U-16). Painted from the engine clock (U-05); never plays (D-07).
import { useCallback, useRef } from 'react';

import type { SampleIndex } from '../engine/types';
import { noteAt, type TabBar } from '../music/bassTab';
import { beatPosition, type Grid } from '../music/grid';
import { usePlayhead } from '../songview/usePlayhead';
import { playAlongColors, type PlayAlongColors } from './colors';
import { useParentWidth } from './Neck';
import { NECK_H, paintNeck } from './neckPainter';
import styles from './PlayAlong.module.css';

export interface TabNeckProps {
  bars: TabBar[];
  /** The bar after `bar` (the loop start at an armed loop's end), or null. */
  nextOf(bar: number): number | null;
  grid: Grid;
  getPosition(): SampleIndex;
  playing: boolean;
  seekNonce: number;
}

/** One line for screen readers and tests: "Bar 5: G G D B♭?". */
export function describeTabBar(bar: TabBar | undefined): string {
  if (!bar) return 'past the last bar';
  if (bar.notes.length === 0) return `Bar ${bar.bar + 1}, no notes`;
  return `Bar ${bar.bar + 1}: ${bar.notes.map((n) => (n.unsure ? `${n.name}?` : n.name)).join(' ')}`;
}

export function TabNeck({ bars, nextOf, grid, getPosition, playing, seekNonce }: TabNeckProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const width = useParentWidth(canvasRef);
  const colors = useRef<PlayAlongColors | null>(null);
  const last = useRef<{ bars: TabBar[]; bar: number; hot: number; width: number } | null>(null);

  const paint = useCallback(
    (position: SampleIndex) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const at = beatPosition(grid, position);
      const barIndex = at?.bar ?? -1;
      const current = at ? bars[at.bar] : undefined;
      const hot = current ? noteAt(current.notes, position) : -1;
      const seen = last.current;
      if (seen && seen.bars === bars && seen.bar === barIndex && seen.hot === hot && seen.width === width) return;

      const nextIndex = at ? nextOf(at.bar) : null;
      const next = nextIndex === null ? undefined : bars[nextIndex];
      canvas.setAttribute(
        'aria-label',
        at ? `${describeTabBar(current)}. Next: ${describeTabBar(next)}` : 'Before the first bar',
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
    [bars, nextOf, grid, width],
  );
  usePlayhead(getPosition, paint, playing, seekNonce);

  return (
    <canvas ref={canvasRef} className={styles.canvas} data-testid="tab-neck-canvas" role="img" aria-label="Bass neck" />
  );
}
