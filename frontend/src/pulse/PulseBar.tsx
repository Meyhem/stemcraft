// U-14: the navbar's bottom border glows with what you can hear. Two soft glows
// per stem colour drift along a 3px bar and swell with that stem's level. This is
// the canvas and its loop; what the levels are is up to the caller (the song's
// stems in StemPulseBar, the album master in AlbumPulseBar).
//
// D-07: nothing here plays or meters audio. D-13: the loop paints straight to the
// canvas and never goes through React state.
import { useContext, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

import { PulseSlotContext } from '../app/pulseSlot';
import { STEM_ORDER } from '../engine/types';
import { blobsFor } from './blobs';
import { paintBlobs } from './paint';
import styles from './PulseBar.module.css';
import { resolveStemColors } from './stemColors';

const BAR_PX = 3;
/** A backgrounded tab resumes with one huge frame; do not let it fling the glows. */
const MAX_FRAME_SECONDS = 0.05;

/**
 * Called once per animation frame with the seconds since the last one. Updates the
 * STEM_ORDER-indexed 0..1 `levels` (how loud) and `weights` (how audible) in place;
 * both start at 0 on every play.
 */
export type PulseFrame = (dtSeconds: number, levels: number[], weights: number[]) => void;

export function PulseBar({
  owner,
  playing,
  frame,
}: {
  /** Named in the log when a stem colour token cannot be resolved (N-08). */
  owner: string;
  playing: boolean;
  /** Null when there is nothing to pulse with; the bar then stays dark. */
  frame: PulseFrame | null;
}) {
  const slot = useContext(PulseSlotContext);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  // Survives a pause, so the glows resume where they were instead of jumping.
  const drift = useRef(0);
  const animating = playing && frame !== null;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!animating || !frame || !slot || !canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Resolved once per run.
    const colors = resolveStemColors(owner);
    if (!colors) return;

    const levels = STEM_ORDER.map(() => 0);
    const weights = STEM_ORDER.map(() => 0);
    let last = performance.now();
    let handle = 0;

    const tick = (now: number) => {
      const dt = Math.min(MAX_FRAME_SECONDS, Math.max(0, (now - last) / 1000));
      last = now;
      drift.current += dt;

      const dpr = window.devicePixelRatio || 1;
      const width = Math.round(slot.clientWidth * dpr);
      const height = Math.round(BAR_PX * dpr);
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }

      frame(dt, levels, weights);
      paintBlobs(ctx, blobsFor(levels, weights, drift.current, width), colors, width, height);
      handle = requestAnimationFrame(tick);
    };
    handle = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(handle);
  }, [animating, frame, slot, owner]);

  if (!slot) return null;
  return createPortal(
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className={animating ? `${styles.bar} ${styles.playing}` : styles.bar}
    />,
    slot,
  );
}
