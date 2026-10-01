// U-15: everything that loads says so with a small cousin of the navbar pulse bar
// (U-14): the four stem glows pounding to a made-up 120 bpm groove. The label is
// the message; the bar is decoration and hidden from assistive tech.
//
// D-07: nothing here plays or meters audio. D-13: the loop paints straight to the
// canvas and never goes through React state.
import { useEffect, useRef } from 'react';

import { blobsFor } from '../pulse/blobs';
import { grooveLevels } from '../pulse/groove';
import { paintBlobs } from '../pulse/paint';
import { resolveStemColors } from '../pulse/stemColors';
import styles from './Loader.module.css';

export interface LoaderProps {
  /** What is loading, e.g. "Loading song…". Always shown: the bar alone says nothing. */
  label: string;
  /** `page` stands in for a whole screen's content; `inline` sits in a component's place. */
  size?: 'page' | 'inline';
  className?: string;
}

const WIDTH_PX = { page: 360, inline: 48 } as const;
const BAR_PX = { page: 6, inline: 3 } as const;
/** blobsFor drifts at the navbar's unhurried pace; a loader should look busier. */
const DRIFT_RATE = 2.6;
/** The still frame under reduced motion: every stem lit, glows spread out. */
const STILL_LEVELS = [0.6, 0.6, 0.6, 0.6];
const ALL_AUDIBLE = [1, 1, 1, 1];

export function Loader({ label, size = 'inline', className }: LoaderProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const colors = resolveStemColors('Loader');
    if (!colors) return;

    const dpr = window.devicePixelRatio || 1;
    const width = Math.round(WIDTH_PX[size] * dpr);
    const height = Math.round(BAR_PX[size] * dpr);
    canvas.width = width;
    canvas.height = height;

    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      paintBlobs(ctx, blobsFor(STILL_LEVELS, ALL_AUDIBLE, 0, width), colors, width, height);
      return;
    }

    const start = performance.now();
    let handle = 0;
    const tick = (now: number) => {
      const seconds = Math.max(0, (now - start) / 1000);
      const blobs = blobsFor(grooveLevels(seconds), ALL_AUDIBLE, seconds * DRIFT_RATE, width);
      paintBlobs(ctx, blobs, colors, width, height);
      handle = requestAnimationFrame(tick);
    };
    handle = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(handle);
  }, [size]);

  return (
    <div role="status" className={[styles.loader, styles[size], className].filter(Boolean).join(' ')}>
      <canvas
        ref={canvasRef}
        aria-hidden="true"
        className={styles.bar}
        style={{ width: WIDTH_PX[size], height: BAR_PX[size] }}
      />
      <span>{label}</span>
    </div>
  );
}
