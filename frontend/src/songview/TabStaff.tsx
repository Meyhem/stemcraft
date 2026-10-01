// UI spec §5 "Tab staff" (D-21, U-16): one row of the shared time axis. The 200 px head
// names the strings; the canvas is the size of the visible slice, sticky at the content
// area's left edge (as StemLane's), repainted on scroll and resize, and from the engine
// clock only when the sounding note changes (D-07, U-05). It never plays.
import { useCallback, useEffect, useRef } from 'react';

import type { SampleIndex } from '../engine/types';
import { noteAt, type TabNote } from '../music/bassTab';
import type { Grid } from '../music/grid';
import { LANE_HEAD_PX, type TimeScale } from '../music/timeScale';
import { playAlongColors, type PlayAlongColors } from '../playalong/colors';
import axis from './Axis.module.css';
import { paintStaff, STAFF_H, staffStringY } from './tabStaffPainter';
import styles from './TabStaff.module.css';
import { usePlayhead } from './usePlayhead';

export interface TabStaffProps {
  notes: readonly TabNote[];
  scale: TimeScale;
  scroller: HTMLElement | null;
  grid: Grid | null;
  getPosition(): SampleIndex;
  playing: boolean;
  seekNonce: number;
}

const NAMES = ['E', 'A', 'D', 'G'];

export function TabStaff({ notes, scale, scroller, grid, getPosition, playing, seekNonce }: TabStaffProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const colors = useRef<PlayAlongColors | null>(null);
  const hot = useRef(-1);

  const paint = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const scrollLeft = scroller?.scrollLeft ?? 0;
    const viewport = scroller ? Math.max(0, scroller.clientWidth - LANE_HEAD_PX) : scale.contentWidth;
    // Never wider than what is left of the row: at Fit the content is the viewport.
    const width = Math.max(0, Math.min(Math.ceil(viewport), Math.ceil(scale.contentWidth - scrollLeft)));
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(STAFF_H * dpr)) {
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(STAFF_H * dpr);
      canvas.style.width = `${width}px`;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    colors.current ??= playAlongColors();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    paintStaff(ctx, {
      width,
      scrollLeft,
      scale,
      notes,
      hot: hot.current,
      bars: grid?.bars ?? [],
      beats: grid?.beats ?? [],
      colors: colors.current,
    });
  }, [notes, scale, scroller, grid]);

  useEffect(() => {
    paint();
  }, [paint]);

  // Repaint the visible slice on every pan and on a viewport resize, at most once a frame.
  useEffect(() => {
    if (!scroller) return;
    let handle = 0;
    const schedule = () => {
      if (handle) return;
      handle = requestAnimationFrame(() => {
        handle = 0;
        paint();
      });
    };
    scroller.addEventListener('scroll', schedule, { passive: true });
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule);
    observer?.observe(scroller);
    return () => {
      scroller.removeEventListener('scroll', schedule);
      observer?.disconnect();
      cancelAnimationFrame(handle);
    };
  }, [scroller, paint]);

  // The staff is still between notes: a frame repaints only when the sounding note changes.
  const onFrame = useCallback(
    (position: SampleIndex) => {
      const next = noteAt(notes, position);
      if (next === hot.current) return;
      hot.current = next;
      paint();
    },
    [notes, paint],
  );
  usePlayhead(getPosition, onFrame, playing, seekNonce);

  return (
    <div className={styles.row} role="group" aria-label="Bass tab">
      <div className={`${axis.head} ${styles.head}`}>
        {NAMES.map((name, s) => (
          <span key={name} className={styles.string} style={{ top: `${staffStringY(s) - 10}px` }}>
            {name}
          </span>
        ))}
      </div>
      <div className={styles.lane} style={{ width: `${scale.contentWidth}px` }}>
        <canvas
          ref={canvasRef}
          className={styles.canvas}
          data-testid="tab-staff-canvas"
          role="img"
          aria-label={`Bass tab, ${notes.length} notes`}
        />
      </div>
    </div>
  );
}
