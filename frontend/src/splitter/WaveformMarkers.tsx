// The album waveform: zoomable, pannable, with draggable split boundaries.
//
// D-07 / invariant 7: nothing here plays audio. The waveform is painted from the
// precomputed envelope, and the playhead comes from the screen's <audio> element via
// `getPlayheadSample`. wavesurfer is deliberately not used for this view: it lays a
// waveform out at its full pixel width, and a 81-minute album at useful zoom is hundreds
// of thousands of pixels wide. Instead one viewport-sized <canvas> sticks to the left of
// a scroll container and repaints only the visible slice, so the cost is independent of
// zoom. (StemLane keeps wavesurfer: a song is a few thousand pixels wide.)
//
// Invariant 4: every position this component reports is an integer sample index at
// 48 kHz. Pointer positions are rounded at the point of conversion, never handed on as
// float seconds.
import {
  Fragment,
  type KeyboardEvent as ReactKeyboardEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { followScrollLeft } from '../music/timeScale';
import { Button } from '../ui';
import { resolveColor } from '../ui/resolveColor';
import { PauseIcon, PlayIcon } from './icons';
import { formatTimestamp, SAMPLE_RATE } from './time';
import {
  clampZoom,
  columnHeights,
  fitPxPerSecond,
  scrollLeftAfterZoom,
  tickInterval,
  tickLabel,
  ZOOM_STEP,
} from './view';
import styles from './WaveformMarkers.module.css';

// U-02: a boundary must be placeable without a mouse. 0.1 s of nudge, 1 s of
// travel -- enough to cross a gap between tracks in a handful of presses.
const FINE_STEP = SAMPLE_RATE / 10; // 4800
const COARSE_STEP = SAMPLE_RATE; // 48000

// Canvas layout, px. The ruler is the top strip; a click there seeks, a click below it
// adds a boundary.
const RULER_H = 24;
const WAVE_H = 140;
const HEIGHT = RULER_H + WAVE_H;
const FOLLOW_PAUSE_MS = 3000;

export interface WaveformMarkersProps {
  peaks: number[]; // the envelope, 0..1, as peaks.json stores it
  totalSamples: number;
  splitPoints: number[]; // sample indices, sorted
  /** Read every frame while playing; never routed through React state (U-05). */
  getPlayheadSample(): number;
  playing: boolean;
  /** Bumped by the owner when it moves the audio cursor while paused, so this repaints. */
  seekNonce: number;
  onTogglePlay(): void;
  onMove(index: number, sample: number): void; // a marker dragged
  onAdd(sample: number): void; // a click on empty waveform
  onRemove(index: number): void; // a marker's × pressed
  onScrub(sample: number): void; // seek the <audio> element
}

function percent(sample: number, totalSamples: number): string {
  if (totalSamples <= 0) return '0%';
  return `${(sample / totalSamples) * 100}%`;
}

export function WaveformMarkers({
  peaks,
  totalSamples,
  splitPoints,
  getPlayheadSample,
  playing,
  seekNonce,
  onTogglePlay,
  onMove,
  onAdd,
  onRemove,
  onScrub,
}: WaveformMarkersProps) {
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const playheadRef = useRef<HTMLDivElement | null>(null);
  const readoutRef = useRef<HTMLOutputElement | null>(null);

  const totalSeconds = totalSamples / SAMPLE_RATE;
  const [viewportWidth, setViewportWidth] = useState(0);
  // null = "fit": the whole album across the viewport, following resizes.
  const [zoom, setZoom] = useState<number | null>(null);
  const fit = fitPxPerSecond(viewportWidth, totalSeconds);
  const pxPerSecond = zoom === null ? fit : clampZoom(zoom, fit);
  const contentWidth =
    zoom === null && viewportWidth > 0
      ? Math.floor(viewportWidth) // fit must never overflow by a rounding pixel
      : Math.round(totalSeconds * pxPerSecond);

  // What matters at a glance is how much of the album is on screen, not px/s (0.2 px/s
  // at fit on a long album says nothing). Without a measured viewport, fall back to px/s.
  const zoomLabel =
    zoom === null
      ? 'Whole album'
      : viewportWidth > 0
        ? `${tickLabel(viewportWidth / pxPerSecond, 1)} in view`
        : `${Math.round(pxPerSecond * 10) / 10} px/s`;

  const totalLabel = useMemo(() => formatTimestamp(totalSamples), [totalSamples]);

  // ---- painting ---------------------------------------------------------

  // Canvas cannot read CSS variables (see resolveColor); resolved once.
  const colors = useRef({ played: '', rest: '', tick: '', label: '' });
  useEffect(() => {
    colors.current = {
      played: resolveColor('var(--ds-accent)'),
      rest: resolveColor('var(--ds-text-2)'),
      tick: resolveColor('var(--ds-border-strong)'),
      label: resolveColor('var(--ds-text-2)'),
    };
  }, []);

  // The owner's clock, read by the painter without becoming a dependency.
  const getPlayheadSampleRef = useRef(getPlayheadSample);
  getPlayheadSampleRef.current = getPlayheadSample;

  // Everything the painter reads lives in refs, so a 60 fps frame never goes through
  // React.
  const live = useRef({ pxPerSecond, contentWidth, totalSamples, playing, peaks });
  live.current = { pxPerSecond, contentWidth, totalSamples, playing, peaks };

  const draw = useCallback(() => {
    const scroller = scrollerRef.current;
    const canvas = canvasRef.current;
    if (!scroller || !canvas) return;
    const width = scroller.clientWidth;
    if (width <= 0) return;
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(HEIGHT * dpr)) {
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(HEIGHT * dpr);
      canvas.style.width = `${width}px`;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const { pxPerSecond: pps, peaks: envelope, totalSamples: total } = live.current;
    const scrollLeft = scroller.scrollLeft;
    const palette = colors.current;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, HEIGHT);

    // Ruler.
    const interval = tickInterval(pps);
    ctx.font = '11px ui-monospace, Menlo, Consolas, monospace';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = palette.tick;
    const firstTick = Math.floor(scrollLeft / pps / interval);
    const lastTick = Math.ceil((scrollLeft + width) / pps / interval);
    for (let n = firstTick; n <= lastTick; n++) {
      const x = Math.round(n * interval * pps - scrollLeft) + 0.5;
      ctx.fillRect(x, RULER_H - 8, 1, 8);
    }
    ctx.fillStyle = palette.label;
    for (let n = firstTick; n <= lastTick; n++) {
      const seconds = n * interval;
      const x = seconds * pps - scrollLeft;
      ctx.fillText(tickLabel(seconds, interval), x + 4, RULER_H / 2 - 2);
    }

    // Waveform: played part in the accent, the rest in a light grey, split at the playhead.
    const heights = columnHeights(envelope, total / SAMPLE_RATE, pps, scrollLeft, Math.ceil(width));
    const playheadX = (getPlayheadSampleRef.current() / total) * live.current.contentWidth - scrollLeft;
    const mid = RULER_H + WAVE_H / 2;
    const half = WAVE_H / 2 - 4;
    for (const [color, from, to] of [
      [palette.played, 0, Math.min(heights.length, Math.max(0, Math.ceil(playheadX)))],
      [palette.rest, Math.min(heights.length, Math.max(0, Math.ceil(playheadX))), heights.length],
    ] as const) {
      ctx.fillStyle = color;
      for (let i = from; i < to; i++) {
        const bar = Math.max(1, heights[i]! * half); // silence still draws a hairline
        ctx.fillRect(i, mid - bar, 1, bar * 2);
      }
    }
  }, []);

  // The view follows the playhead only when the playhead is what moved: while playing, or
  // on a seek. A zoom or a resize repaints WITHOUT following -- otherwise zooming at the
  // pointer would be undone the same frame by a jump back to a playhead that is off
  // screen. Panning or zooming by hand also suspends following for a moment, so playback
  // does not fight someone looking at another part of the album.
  const manualUntil = useRef(0);

  // One frame: optionally follow (page the view), place the playhead and readout, repaint.
  const frame = useCallback((follow: boolean) => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const { contentWidth: cw, totalSamples: total, playing: isPlaying } = live.current;
    const sample = getPlayheadSampleRef.current();
    const x = total > 0 ? (sample / total) * cw : 0;
    if (follow && performance.now() >= manualUntil.current) {
      const next = followScrollLeft(x, scroller.scrollLeft, scroller.clientWidth, isPlaying);
      if (next !== null) scroller.scrollLeft = next;
    }
    if (playheadRef.current) playheadRef.current.style.left = `${x}px`;
    if (readoutRef.current) readoutRef.current.textContent = formatTimestamp(sample);
    draw();
  }, [draw]);

  const seenSeek = useRef(seekNonce);
  useEffect(() => {
    const sought = seekNonce !== seenSeek.current;
    seenSeek.current = seekNonce;
    // A seek is a deliberate "go there", so it overrides a recent manual pan.
    if (sought) manualUntil.current = 0;
    frame(playing || sought);
    if (!playing) return;
    let handle = 0;
    const tick = () => {
      frame(true);
      handle = requestAnimationFrame(tick);
    };
    handle = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(handle);
    // seekNonce, pxPerSecond and contentWidth are the "something moved, paint again"
    // signals for the paused case.
  }, [frame, playing, seekNonce, pxPerSecond, contentWidth, peaks]);

  // ---- viewport, zoom, pan ---------------------------------------------

  useLayoutEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const measure = () => setViewportWidth(scroller.clientWidth);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(scroller);
    return () => observer.disconnect();
  }, []);

  // A zoom decides the new scrollLeft before the content re-renders at its new width;
  // it can only be applied after, so it waits here.
  const pendingScroll = useRef<number | null>(null);
  useLayoutEffect(() => {
    if (pendingScroll.current !== null && scrollerRef.current) {
      scrollerRef.current.scrollLeft = pendingScroll.current;
      pendingScroll.current = null;
    }
  }, [pxPerSecond, contentWidth]);

  const zoomTo = useCallback(
    (next: number, anchorX: number) => {
      const scroller = scrollerRef.current;
      const target = clampZoom(next, fit);
      if (!scroller || target === pxPerSecond) return;
      pendingScroll.current = scrollLeftAfterZoom(scroller.scrollLeft, anchorX, pxPerSecond, target);
      manualUntil.current = performance.now() + FOLLOW_PAUSE_MS;
      setZoom(target);
    },
    [fit, pxPerSecond],
  );

  // Non-passive, so ctrl+wheel can stop the browser zooming the page and a plain wheel
  // can pan instead of scrolling the screen. A React onWheel is passive and could not.
  const zoomToRef = useRef(zoomTo);
  zoomToRef.current = zoomTo;
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const onWheel = (event: WheelEvent) => {
      manualUntil.current = performance.now() + FOLLOW_PAUSE_MS;
      if (event.ctrlKey || event.metaKey) {
        event.preventDefault();
        const rect = scroller.getBoundingClientRect();
        zoomToRef.current(
          live.current.pxPerSecond * Math.exp(-event.deltaY * 0.01),
          event.clientX - rect.left,
        );
      } else if (scroller.scrollWidth > scroller.clientWidth) {
        // Vertical wheel (or shift+wheel) pans; a native horizontal swipe is left alone.
        const delta = Math.abs(event.deltaY) > Math.abs(event.deltaX) ? event.deltaY : 0;
        if (delta !== 0) {
          event.preventDefault();
          scroller.scrollLeft += delta;
        }
      }
    };
    scroller.addEventListener('wheel', onWheel, { passive: false });
    return () => scroller.removeEventListener('wheel', onWheel);
  }, []);

  // ---- pointer -> sample ------------------------------------------------

  // Invariant 4: an integer sample index, never a float. Measured against the content
  // element, whose box already includes the scroll offset. Returns null when it has no
  // measurable width (jsdom, or a container not laid out yet), rather than NaN.
  function sampleAt(clientX: number): number | null {
    const rect = contentRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0) return null;
    const fraction = (clientX - rect.left) / rect.width;
    return Math.round(Math.min(1, Math.max(0, fraction)) * totalSamples);
  }

  // A boundary may not cross its neighbours -- doing so would silently
  // reorder the track list under the user's titles -- and it may not sit on
  // either end of the album. The outer bounds are 1 and totalSamples - 1
  // because Album's own validator rejects a point at 0 or at total_samples
  // (both would mean a zero-length track); allowing them here would turn one
  // ordinary drag-to-the-edge, or a single Home/End press, into a 422 on the
  // autosave PUT.
  function bounds(index: number): [number, number] {
    const previous = splitPoints[index - 1];
    const next = splitPoints[index + 1];
    return [
      previous === undefined ? 1 : previous + 1,
      next === undefined ? totalSamples - 1 : next - 1,
    ];
  }

  function moveTo(index: number, sample: number) {
    const [low, high] = bounds(index);
    onMove(index, Math.min(high, Math.max(low, Math.round(sample))));
  }

  function handleKeyDown(index: number, event: ReactKeyboardEvent<HTMLDivElement>) {
    const current = splitPoints[index];
    if (current === undefined) return;
    const step = event.shiftKey ? COARSE_STEP : FINE_STEP;
    const [low, high] = bounds(index);
    let target: number | null = null;
    if (event.key === 'ArrowRight' || event.key === 'ArrowUp') target = current + step;
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') target = current - step;
    else if (event.key === 'Home') target = low;
    else if (event.key === 'End') target = high;
    if (target === null) return;
    event.preventDefault();
    moveTo(index, target);
  }

  const centre = () => (scrollerRef.current?.clientWidth ?? 0) / 2;

  return (
    <div className={styles.frame}>
      <div className={styles.toolbar}>
        <Button
          aria-label={playing ? 'Pause' : 'Play'}
          aria-pressed={playing}
          onClick={onTogglePlay}
        >
          {playing ? <PauseIcon /> : <PlayIcon />}
        </Button>
        <span className={styles.time}>
          <output ref={readoutRef} aria-label="Playhead position" data-testid="album-time">
            {formatTimestamp(getPlayheadSample())}
          </output>
          {' / '}
          {totalLabel}
        </span>
        <span className={styles.spacer} />
        <span className={styles.zoomLabel}>Zoom</span>
        <Button
          aria-label="Zoom out"
          onClick={() => zoomTo(pxPerSecond / ZOOM_STEP, centre())}
        >
          −
        </Button>
        <span className={styles.zoomValue} data-testid="album-zoom">
          {zoomLabel}
        </span>
        <Button aria-label="Zoom in" onClick={() => zoomTo(pxPerSecond * ZOOM_STEP, centre())}>
          +
        </Button>
        <Button
          onClick={() => {
            if (zoom === null) return;
            pendingScroll.current = 0;
            setZoom(null);
          }}
        >
          Fit
        </Button>
      </div>

      <div
        ref={scrollerRef}
        className={styles.scroller}
        data-testid="album-scroller"
        // Dragging the scrollbar is a manual pan too.
        onPointerDown={() => {
          manualUntil.current = performance.now() + FOLLOW_PAUSE_MS;
        }}
      >
        <div
          ref={contentRef}
          className={styles.content}
          data-testid="album-waveform"
          style={{ width: `${contentWidth}px`, height: `${HEIGHT}px` }}
          // The ruler strip seeks; the waveform below it adds a boundary. Grips and
          // their × stop propagation, so this only ever fires for bare background.
          onClick={(event) => {
            const sample = sampleAt(event.clientX);
            if (sample === null) return;
            const top = event.currentTarget.getBoundingClientRect().top;
            if (event.clientY - top < RULER_H) onScrub(sample);
            else onAdd(sample);
          }}
        >
          <canvas ref={canvasRef} className={styles.canvas} data-testid="album-canvas" />

          <div
            ref={playheadRef}
            className={styles.playhead}
            data-testid="album-playhead"
            style={{ left: `${totalSamples > 0 ? (getPlayheadSample() / totalSamples) * contentWidth : 0}px` }}
          />

          {splitPoints.map((sample, index) => (
            <Fragment key={index}>
              <div
                role="slider"
                tabIndex={0}
                aria-label={`split point ${index + 1}`}
                aria-valuemin={0}
                aria-valuemax={totalSamples}
                aria-valuenow={sample}
                aria-valuetext={formatTimestamp(sample)}
                className={styles.grip}
                style={{ left: percent(sample, totalSamples) }}
                onClick={(event) => event.stopPropagation()}
                onKeyDown={(event) => handleKeyDown(index, event)}
                onPointerDown={(event) => {
                  event.stopPropagation();
                  event.currentTarget.setPointerCapture(event.pointerId);
                }}
                onPointerMove={(event) => {
                  if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
                  // Measured against the content the marker slides along, not its own box.
                  const next = sampleAt(event.clientX);
                  if (next !== null) moveTo(index, next);
                }}
                onPointerUp={(event) => {
                  if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                    event.currentTarget.releasePointerCapture(event.pointerId);
                  }
                }}
              />
              <button
                type="button"
                className={styles.remove}
                aria-label={`Remove split point ${index + 1}`}
                style={{ left: percent(sample, totalSamples) }}
                onClick={(event) => {
                  event.stopPropagation();
                  onRemove(index);
                }}
              >
                ×
              </button>
            </Fragment>
          ))}
        </div>
      </div>
      <p className={styles.hint}>
        Click the waveform to cut · click the ruler to seek · drag a cut to move it · Ctrl+wheel
        zooms · wheel pans
      </p>
    </div>
  );
}
