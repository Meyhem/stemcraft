import { clamp } from '../music/zoom';

export { DRAG_THRESHOLD_PX, scrollLeftAfterZoom, ZOOM_STEP } from '../music/zoom';

// Zoom, ruler and waveform-column maths for the album waveform. Pure functions, so the
// interaction rules (zoom at the pointer, tick spacing, envelope sampling) are testable
// without a layout engine or a canvas.

/**
 * Zoom is px per second. The album envelope holds 10 buckets/s (D8-12), so beyond ~100
 * px/s each bucket is a 10 px block and zooming further shows nothing new; exact
 * placement past that point is what the millisecond fields are for.
 */
export const MAX_PX_PER_SECOND = 100;

export function fitPxPerSecond(viewportWidth: number, totalSeconds: number): number {
  if (viewportWidth <= 0 || totalSeconds <= 0) return MAX_PX_PER_SECOND / 4;
  return viewportWidth / totalSeconds;
}

export function clampZoom(pxPerSecond: number, fit: number): number {
  return clamp(pxPerSecond, fit, MAX_PX_PER_SECOND);
}

const TICK_INTERVALS = [0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800];

/** The smallest "round" interval that keeps ruler labels at least `minGapPx` apart. */
export function tickInterval(pxPerSecond: number, minGapPx = 90): number {
  return TICK_INTERVALS.find((seconds) => seconds * pxPerSecond >= minGapPx) ?? 3600;
}

/** Ruler label: m:ss, h:mm:ss from an hour, with tenths when the interval is sub-second. */
export function tickLabel(seconds: number, interval: number): string {
  const whole = Math.floor(seconds);
  const h = Math.floor(whole / 3600);
  const m = Math.floor(whole / 60) % 60;
  const s = whole % 60;
  const base =
    h > 0
      ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
      : `${m}:${String(s).padStart(2, '0')}`;
  return interval < 1 ? `${base}.${Math.round((seconds - whole) * 10)}` : base;
}

/** How close (px) the pointer must be to a cut to grab it rather than start a gesture. */
export const GRAB_PX = 8;

/**
 * The cuts a press at content x `x` grabs: every cut within GRAB_PX, nearest first. More
 * than one means the cuts overlap on screen (two cuts 2 px apart at whole-album zoom);
 * pickCut resolves that from the direction of the drag.
 */
export function cutsNear(cutXs: number[], x: number, grabPx = GRAB_PX): number[] {
  return cutXs
    .map((cx, index) => ({ index, distance: Math.abs(cx - x) }))
    .filter(({ distance }) => distance <= grabPx)
    .sort((a, b) => a.distance - b.distance || a.index - b.index)
    .map(({ index }) => index);
}

/**
 * Of several grabbed cuts, the one a drag in direction `dx` can actually move: the
 * rightmost when dragging right, the leftmost when dragging left. Taking the nearest
 * instead would pick a cut pinned against its neighbour and nothing would move -- which
 * reads as "the cut is not draggable".
 */
export function pickCut(candidates: number[], dx: number): number {
  if (candidates.length === 1 || dx === 0) return candidates[0]!;
  return dx > 0 ? Math.max(...candidates) : Math.min(...candidates);
}

/** px/s and scrollLeft that fit the samples [from, to] (either order) to the viewport. */
export function zoomToRange(
  from: number,
  to: number,
  sampleRate: number,
  viewportWidth: number,
  fit: number,
): { pxPerSecond: number; scrollLeft: number } {
  const [low, high] = from <= to ? [from, to] : [to, from];
  const seconds = Math.max(1 / sampleRate, (high - low) / sampleRate);
  const pxPerSecond = clampZoom(viewportWidth / seconds, fit);
  // Centre the range: if it was clamped at max zoom it no longer fills the view.
  const centre = ((low + high) / 2 / sampleRate) * pxPerSecond;
  return { pxPerSecond, scrollLeft: Math.max(0, Math.round(centre - viewportWidth / 2)) };
}
