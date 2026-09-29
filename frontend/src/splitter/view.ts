// Zoom, ruler and waveform-column maths for the album waveform. Pure functions, so the
// interaction rules (zoom at the pointer, tick spacing, envelope sampling) are testable
// without a layout engine or a canvas.

/**
 * Zoom is px per second. The album envelope holds 10 buckets/s (D8-12), so beyond ~100
 * px/s each bucket is a 10 px block and zooming further shows nothing new; exact
 * placement past that point is what the millisecond fields are for.
 */
export const MAX_PX_PER_SECOND = 100;
// 2x per press: fit-to-max is ~500x on an 80-minute album, which is 9 presses rather than 15.
export const ZOOM_STEP = 2;

export function fitPxPerSecond(viewportWidth: number, totalSeconds: number): number {
  if (viewportWidth <= 0 || totalSeconds <= 0) return MAX_PX_PER_SECOND / 4;
  return viewportWidth / totalSeconds;
}

export function clampZoom(pxPerSecond: number, fit: number): number {
  return Math.min(MAX_PX_PER_SECOND, Math.max(Math.min(fit, MAX_PX_PER_SECOND), pxPerSecond));
}

/**
 * scrollLeft that keeps the moment under `anchorX` (an x inside the viewport) under it
 * after the zoom changes -- zoom at the pointer, not at the left edge.
 */
export function scrollLeftAfterZoom(
  scrollLeft: number,
  anchorX: number,
  oldPxPerSecond: number,
  newPxPerSecond: number,
): number {
  const seconds = (scrollLeft + anchorX) / oldPxPerSecond;
  return Math.max(0, Math.round(seconds * newPxPerSecond - anchorX));
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

/**
 * Bar heights (0..1) for `columns` pixel columns starting at content x `startX`. Each
 * column is the max of the envelope buckets it covers, so a narrow peak survives being
 * zoomed out; when zoomed in past one bucket per pixel a column repeats the bucket under
 * it. Normalised by the envelope's own maximum: peaks.json is raw amplitude and a quiet
 * master would otherwise draw as a thin line.
 */
export function columnHeights(
  envelope: number[],
  totalSeconds: number,
  pxPerSecond: number,
  startX: number,
  columns: number,
): Float32Array {
  const out = new Float32Array(columns);
  if (envelope.length === 0 || totalSeconds <= 0) return out;
  let peak = 0;
  for (const value of envelope) if (value > peak) peak = value;
  if (peak <= 0) return out;
  const bucketsPerPx = envelope.length / (totalSeconds * pxPerSecond);
  for (let i = 0; i < columns; i++) {
    const from = (startX + i) * bucketsPerPx;
    const first = Math.min(envelope.length - 1, Math.max(0, Math.floor(from)));
    const last = Math.min(envelope.length - 1, Math.max(first, Math.ceil(from + bucketsPerPx) - 1));
    let max = 0;
    for (let b = first; b <= last; b++) if (envelope[b]! > max) max = envelope[b]!;
    out[i] = max / peak;
  }
  return out;
}
