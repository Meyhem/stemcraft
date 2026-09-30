// U-14: the navbar's bottom border glows with the stems you can hear. Two soft
// glows per audible stem drift along a 3px bar and swell with that stem's own
// level, so muting a stem takes its colour out of the bar.
//
// D-07: nothing here plays or meters audio. Levels are the load-time stem
// envelopes read at the engine clock's position; audibility is the gain the
// engine was last given (so a count-in, which silences the stems inside the
// engine, darkens the bar too). D-13: the loop paints straight to the canvas
// and never goes through React state.
import { useContext, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

import { PulseSlotContext } from '../app/pulseSlot';
import { STEM_ORDER } from '../engine/types';
import { useSongSession } from '../session/SongSession';
import { resolveColor } from '../ui/resolveColor';
import { blobsFor } from './blobs';
import { follow, levelAt } from './levels';
import { paintBlobs, parseHex, type Rgb } from './paint';
import styles from './StemPulseBar.module.css';

const BAR_PX = 3;
/** How fast a mute or solo fades its glows in and out, per second. */
const WEIGHT_RATE = 8;
/** A backgrounded tab resumes with one huge frame; do not let it fling the glows. */
const MAX_FRAME_SECONDS = 0.05;

export function StemPulseBar() {
  const slot = useContext(PulseSlotContext);
  const { engine, playing } = useSongSession();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  // Survives a pause, so the glows resume where they were instead of jumping.
  const drift = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!engine || !playing || !slot || !canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // A canvas cannot read var(--ds-*); resolved once per run (U-02).
    const colors: Rgb[] = [];
    for (const name of STEM_ORDER) {
      const resolved = resolveColor(`var(--ds-${name})`);
      const rgb = parseHex(resolved);
      if (!rgb) {
        // N-08: say why there is no bar rather than painting a wrong colour.
        console.error(`StemPulseBar: --ds-${name} resolved to "${resolved}", expected #RRGGBB`);
        return;
      }
      colors.push(rgb);
    }

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

      const position = engine.getPositionSamples();
      STEM_ORDER.forEach((name, i) => {
        const summary = engine.stemSummaries[i];
        levels[i] = follow(levels[i]!, summary ? levelAt(summary, position) : 0, dt);
        // A boost above unity is still just "audible" here.
        const audible = Math.min(1, engine.getStemGain(name));
        weights[i] = weights[i]! + (audible - weights[i]!) * Math.min(1, dt * WEIGHT_RATE);
      });

      paintBlobs(ctx, blobsFor(levels, weights, drift.current, width), colors, width, height);
      handle = requestAnimationFrame(tick);
    };
    handle = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(handle);
  }, [engine, playing, slot]);

  if (!slot) return null;
  return createPortal(
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className={playing ? `${styles.bar} ${styles.playing}` : styles.bar}
    />,
    slot,
  );
}
