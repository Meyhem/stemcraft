// Zoom, pan and waveform-column maths shared by every scrolling time axis (the Song view
// and the Album splitter). Unit-agnostic where it can be: a zoom level is "px per
// something" and the anchor maths only needs the ratio between two levels.

/** One zoom-button press, and the factor a Fit-to-max zoom is measured in. */
export const ZOOM_STEP = 2;
/** Pointer travel (px) that turns a press into a drag. */
export const DRAG_THRESHOLD_PX = 4;
/** Wheel sensitivity: ~1.3x per mouse-wheel notch (deltaY ~100). */
export const WHEEL_ZOOM_RATE = 0.0025;

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(Math.min(min, max), value));
}

/** The zoom a wheel event asks for, from the current one. */
export function wheelZoom(current: number, deltaY: number): number {
  return current * Math.exp(-deltaY * WHEEL_ZOOM_RATE);
}

/**
 * scrollLeft that keeps the moment under `anchorX` (an x inside the visible content)
 * under it after the zoom changes -- zoom at the pointer, not at the left edge. The two
 * zooms may be in any unit, as long as it is the same one.
 */
export function scrollLeftAfterZoom(
  scrollLeft: number,
  anchorX: number,
  oldZoom: number,
  newZoom: number,
): number {
  const moment = (scrollLeft + anchorX) / oldZoom;
  return Math.max(0, Math.round(moment * newZoom - anchorX));
}

/**
 * Bar heights (0..1) for `columns` pixel columns starting at content x `startX`, over an
 * envelope laid out across `contentWidth` px. Each column is the max of the buckets it
 * covers, so a narrow peak survives being zoomed out; zoomed in past one bucket per pixel
 * a column repeats the bucket under it.
 *
 * `normalize` scales by the envelope's own peak. Right for a whole master (a quiet one
 * would otherwise draw as a line); wrong for a stem, where it would blow a near-silent
 * stem's noise floor up to full height and hide that it is near-silent.
 */
export function columnHeights(
  envelope: ArrayLike<number>,
  contentWidth: number,
  startX: number,
  columns: number,
  normalize: boolean,
): Float32Array {
  const out = new Float32Array(Math.max(0, columns));
  if (envelope.length === 0 || contentWidth <= 0) return out;
  let scale = 1;
  if (normalize) {
    let peak = 0;
    for (let i = 0; i < envelope.length; i++) if (envelope[i]! > peak) peak = envelope[i]!;
    if (peak <= 0) return out;
    scale = 1 / peak;
  }
  const bucketsPerPx = envelope.length / contentWidth;
  const last = envelope.length - 1;
  for (let i = 0; i < out.length; i++) {
    const from = (startX + i) * bucketsPerPx;
    const first = Math.min(last, Math.max(0, Math.floor(from)));
    // The epsilon keeps float noise (499 * 0.1 + 0.1 = 50.000...01) from reaching one
    // bucket past the column's right edge -- which paints the next slice's loudness here.
    const end = Math.min(last, Math.max(first, Math.ceil(from + bucketsPerPx - 1e-9) - 1));
    let max = 0;
    for (let b = first; b <= end; b++) if (envelope[b]! > max) max = envelope[b]!;
    out[i] = Math.min(1, max * scale);
  }
  return out;
}
