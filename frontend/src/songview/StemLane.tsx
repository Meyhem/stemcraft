// UI spec §5, "Stem strip" -- the signature component. Identity is carried by
// fixed order, a permanent text label and a fixed lane position (U-01); hue is
// an accelerator, never the only signal.
//
// D-07: nothing here plays. The waveform is painted from the precomputed stem
// envelope onto a canvas; there is no URL, no media element, and no cursor -- the
// playhead belongs to Timeline, driven by the engine clock (U-05).
//
// The canvas is the size of the VISIBLE part of the lane, sticky at the left edge of
// the content area, and repaints its slice on scroll. It used to be wavesurfer laid out
// at the full content width, which draws every pixel of that width up front: at close
// zoom a long song is tens of thousands of px per lane, four lanes, twice over (wave
// and progress). A viewport canvas costs the same at every zoom.
//
// A lane is one row of the Song view's scrolling time axis: the controls are
// the row's sticky 200px head, and the waveform is exactly the axis's content
// width, so it lines up with the bar ruler and the chord row above it.
import type { CSSProperties } from 'react';
import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';

import type { StemName } from '../engine/EngineController';
import type { StemSummary } from '../engine/stemPeaks';
import { LANE_HEAD_PX } from '../music/timeScale';
import { columnHeights } from '../music/zoom';
import { Button } from '../ui';
import { resolveColor } from '../ui/resolveColor';
import axis from './Axis.module.css';
import styles from './StemLane.module.css';

const STEM_COLOR: Record<StemName, string> = {
  vocals: 'var(--ds-vocals)',
  drums: 'var(--ds-drums)',
  bass: 'var(--ds-bass)',
  other: 'var(--ds-other)',
};

const LANE_H = 64;

export interface StemLaneProps {
  summary: StemSummary;
  /** The time axis content width in px (TimeScale.contentWidth). */
  width: number;
  /** The horizontal scroller the axis lives in; the canvas paints its visible slice. */
  scroller: HTMLElement | null;
  muted: boolean;
  soloed: boolean;
  gainDb: number;
  anySoloed: boolean;
  onMuteToggle(): void;
  onSoloToggle(): void;
  onGainChange(db: number): void;
}

export function StemLane({
  summary,
  width,
  scroller,
  muted,
  soloed,
  gainDb,
  anySoloed,
  onMuteToggle,
  onSoloToggle,
  onGainChange,
}: StemLaneProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const { name, envelope, nearSilent } = summary;
  const silenced = muted || (anySoloed && !soloed);

  // Canvas cannot read CSS variables (resolveColor); resolved per stem.
  const color = useRef('');
  useLayoutEffect(() => {
    color.current = resolveColor(STEM_COLOR[name]);
  }, [name]);

  const paint = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const scrollLeft = scroller?.scrollLeft ?? 0;
    const viewport = scroller ? Math.max(0, scroller.clientWidth - LANE_HEAD_PX) : width;
    // Never wider than what is left of the lane: at Fit the content is the viewport.
    const columns = Math.max(0, Math.min(Math.ceil(viewport), Math.ceil(width - scrollLeft)));
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(columns * dpr) || canvas.height !== Math.round(LANE_H * dpr)) {
      canvas.width = Math.round(columns * dpr);
      canvas.height = Math.round(LANE_H * dpr);
      canvas.style.width = `${columns}px`;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, columns, LANE_H);
    // Raw amplitude, not normalised: a near-silent stem must LOOK near-silent (U-10).
    const heights = columnHeights(envelope, width, scrollLeft, columns, false);
    const mid = LANE_H / 2;
    const half = LANE_H / 2 - 2;
    ctx.fillStyle = color.current;
    for (let i = 0; i < heights.length; i++) {
      const bar = Math.max(0.5, heights[i]! * half);
      ctx.fillRect(i, mid - bar, 1, bar * 2);
    }
  }, [envelope, width, scroller]);

  useLayoutEffect(() => {
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

  return (
    <div
      role="group"
      aria-label={`${name} stem`}
      className={styles.lane}
      data-silenced={silenced ? 'true' : 'false'}
      data-near-silent={nearSilent ? 'true' : 'false'}
      // UI spec §5, Slider row: "Gain fill takes the stem hue" -- exposed as a
      // custom property so the CSS module can drive accent-color on the native
      // range input without a stem-conditional class per lane.
      style={{ '--lane-hue': STEM_COLOR[name] } as CSSProperties}
    >
      <div className={`${axis.head} ${styles.controls}`}>
        <span className={styles.name}>{name}</span>
        <div className={styles.buttons}>
          <Button
            tier="perform"
            className={styles.ms}
            aria-label={`Mute ${name}`}
            aria-pressed={muted}
            disabled={nearSilent}
            onClick={onMuteToggle}
          >
            M
          </Button>
          <Button
            tier="perform"
            className={styles.ms}
            aria-label={`Solo ${name}`}
            aria-pressed={soloed}
            disabled={nearSilent}
            onClick={onSoloToggle}
          >
            S
          </Button>
        </div>
        <label className={styles.gain}>
          <span className={styles.srOnly}>{name} gain</span>
          <input
            type="range"
            aria-label={`${name} gain`}
            min={-60}
            max={6}
            step={0.5}
            value={gainDb}
            disabled={nearSilent}
            onChange={(event) => onGainChange(Number(event.target.value))}
          />
          {/* UI spec §5: every slider mirrors its value as a mono readout --
              a knob position is unreadable at 1.5 m (U-C1). */}
          <output className={styles.readout}>{gainDb.toFixed(1)} dB</output>
        </label>
      </div>

      <div className={styles.waveWrap} style={{ width: `${width}px` }}>
        <div data-testid={`${name}-wave`} className={styles.wave} style={{ width: `${width}px` }}>
          <canvas ref={canvasRef} className={styles.canvas} data-testid={`${name}-canvas`} />
        </div>
        {nearSilent && (
          <span className={styles.pill}>
            near-silent &mdash; this song has no {name} the model could find
          </span>
        )}
      </div>
    </div>
  );
}
