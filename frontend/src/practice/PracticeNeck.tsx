// The Practice neck for single-note lines (D-22): the current bar's notes
// numbered in order, the sounding one lit, the next bar as dashed rings; on 4
// or 6 strings (neckPainter's layouts). Drills show the finger on each dot.
// Painted from the engine clock (U-05); it never plays (invariant 7).
import { useCallback, useRef } from 'react';

import type { SampleIndex } from '../engine/types';
import type { Grid } from '../music/grid';
import type { PracticeLoop } from '../music/practice/types';
import { playAlongColors, type PlayAlongColors } from '../playalong/colors';
import { useParentWidth } from '../playalong/Neck';
import { BASS_LAYOUT, GUITAR_LINE_LAYOUT, paintNeck, type NeckBar } from '../playalong/neckPainter';
import { usePlayhead } from '../songview/usePlayhead';
import styles from './Practice.module.css';
import { beatAt } from './practiceStaffPainter';

export function neckBarsOf(loop: PracticeLoop): NeckBar[] {
  return loop.bars.map((_, b) => ({
    notes: loop.notes
      .filter((n) => n.start >= b * 4 && n.start < (b + 1) * 4)
      .map((n) => ({
        name: n.finger !== null ? String(n.finger) : n.name,
        position: { string: n.string, fret: n.fret },
        approach: n.kind === 'approach',
      })),
  }));
}

/** Index, within bar `bar`'s notes, of the one sounding at `beat` (beats into the loop), or -1. */
export function hotIndex(loop: PracticeLoop, bar: number, beat: number): number {
  const inBar = loop.notes.filter((n) => n.start >= bar * 4 && n.start < (bar + 1) * 4);
  return inBar.findIndex((n) => beat >= n.start && beat < n.start + n.dur);
}

export interface PracticeNeckProps {
  loop: PracticeLoop;
  display: Grid;
  getPosition(): SampleIndex;
  playing: boolean;
  seekNonce: number;
}

export function PracticeNeck({ loop, display, getPosition, playing, seekNonce }: PracticeNeckProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const width = useParentWidth(canvasRef);
  const colors = useRef<PlayAlongColors | null>(null);
  const bars = useRef<{ loop: PracticeLoop; bars: NeckBar[] } | null>(null);
  const last = useRef<string>('');
  const layout = loop.strings === 4 ? BASS_LAYOUT : GUITAR_LINE_LAYOUT;

  const paint = useCallback(
    (position: SampleIndex) => {
      const canvas = canvasRef.current;
      if (!canvas || width === 0) return;
      if (bars.current?.loop !== loop) bars.current = { loop, bars: neckBarsOf(loop) };
      const beat = beatAt(display, position);
      const bar = beat === null ? 0 : Math.floor(beat / 4) % loop.bars.length;
      const hot = beat === null ? -1 : hotIndex(loop, bar, beat % (loop.bars.length * 4));
      const key = `${width}:${bar}:${hot}:${beat === null}`;
      if (key === last.current && bars.current.loop === loop) return;
      last.current = key;
      const dpr = window.devicePixelRatio || 1;
      if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(layout.height * dpr)) {
        canvas.width = Math.round(width * dpr);
        canvas.height = Math.round(layout.height * dpr);
        canvas.style.height = `${layout.height}px`;
      }
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      colors.current ??= playAlongColors();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const current = bars.current.bars[bar] ?? null;
      const next = bars.current.bars[(bar + 1) % loop.bars.length] ?? null;
      canvas.setAttribute(
        'aria-label',
        `Bar ${bar + 1}: ${current?.notes.map((n) => n.name).join(' ') ?? ''}. Next: ${next?.notes.map((n) => n.name).join(' ') ?? ''}`,
      );
      paintNeck(ctx, width, colors.current, current, next, hot, layout);
    },
    [width, loop, display, layout],
  );
  usePlayhead(getPosition, paint, playing, seekNonce);

  return (
    <div className={styles.neck}>
      <canvas ref={canvasRef} className={styles.canvas} />
    </div>
  );
}
