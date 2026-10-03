// The Practice tab staff (D-22): a canvas painted from the engine clock through
// usePlayhead, every frame while playing (the view glides), never from React
// state at audio rate (U-05). It draws; it never plays (invariant 7).
import { useCallback, useRef } from 'react';

import type { SampleIndex } from '../engine/types';
import type { Grid } from '../music/grid';
import type { PracticeLoop } from '../music/practice/types';
import { playAlongColors, type PlayAlongColors } from '../playalong/colors';
import { useParentWidth } from '../playalong/Neck';
import { usePlayhead } from '../songview/usePlayhead';
import styles from './Practice.module.css';
import { beatAt, paintPracticeStaff, practiceStaffHeight } from './practiceStaffPainter';

export interface PracticeStaffProps {
  loop: PracticeLoop;
  display: Grid;
  getPosition(): SampleIndex;
  playing: boolean;
  seekNonce: number;
}

export function PracticeStaff({ loop, display, getPosition, playing, seekNonce }: PracticeStaffProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const width = useParentWidth(canvasRef);
  const colors = useRef<PlayAlongColors | null>(null);
  const height = practiceStaffHeight(loop.strings);

  const paint = useCallback(
    (position: SampleIndex) => {
      const canvas = canvasRef.current;
      if (!canvas || width === 0) return;
      const dpr = window.devicePixelRatio || 1;
      if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
        canvas.width = Math.round(width * dpr);
        canvas.height = Math.round(height * dpr);
        canvas.style.height = `${height}px`;
      }
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      colors.current ??= playAlongColors();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      paintPracticeStaff(ctx, { width, loop, beat: beatAt(display, position), colors: colors.current });
    },
    [width, height, loop, display],
  );
  usePlayhead(getPosition, paint, playing, seekNonce);

  return (
    <div className={styles.staff}>
      <canvas ref={canvasRef} className={styles.canvas} role="img" aria-label={`Tab, ${loop.bars.length} bars, looping`} />
    </div>
  );
}
