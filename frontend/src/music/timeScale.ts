// The one place sample <-> pixel arithmetic lives for the Song view's scrolling
// time axis. The ruler, the chord row, the loop/playhead overlay, the scrub and
// the stem waveforms all lay out against the same TimeScale, so a chord's left
// edge, its bar line and the waveform under it land on the same pixel.
//
// The mapping is *linear in samples*, not "N px per bar" bar-by-bar: the lanes
// draw each stem linearly in time, so a piecewise bar mapping would drift the
// bar lines off the audio wherever the analysed tempo wanders. Zoom picks the
// slope -- a nominal px-per-bar measured against the grid's median bar length
// (grid.ts) -- and every position is `sample * pxPerSample`. Positions stay
// integer sample indices until this last step (D-03).
import type { SampleIndex } from '../engine/types';
import { sampleIndex } from '../engine/types';
import type { Grid } from './grid';

/**
 * 'fit' is the whole song across the visible width; a number is a nominal px per bar
 * (px across the grid's median bar), set continuously by the wheel, the zoom buttons
 * and drag-to-zoom. DEFAULT_PX_PER_BAR is where a song opens.
 */
export type Zoom = 'fit' | number;

export const DEFAULT_PX_PER_BAR = 56;

/**
 * The closest zoom. Stem peaks hold 100 buckets/s, so 200 px/s is 2 px per bucket --
 * fine enough to put a loop on a beat. The lanes paint only their visible slice, so the
 * cost of zooming in does not grow with the song's width.
 */
export const MAX_PX_PER_SECOND = 200;
const SAMPLE_RATE = 48_000;

/** Width of the sticky label/controls column every row of the axis starts with. */
export const LANE_HEAD_PX = 200;


/**
 * Without a beat grid (analysis not run) there are no bars to measure, but the
 * waveforms still need a width: a 2 s bar -- 4/4 at 120 bpm -- stands in, which
 * makes 1x read as 28 px per second.
 */
const NOMINAL_BAR_SAMPLES = 96_000;

export interface TimeScale {
  pxPerSample: number;
  /** Nominal: the median bar's width. Drives label density and grid detail. */
  pxPerBar: number;
  /** The whole song's width in px -- every lane's waveform is exactly this wide. */
  contentWidth: number;
}

export interface TimeScaleInput {
  durationSamples: SampleIndex | number;
  grid: Grid | null;
  zoom: Zoom;
  /** Visible content width: the scroller's client width minus LANE_HEAD_PX. */
  viewportWidth: number;
}

function barSamplesOf(grid: Grid | null): number {
  return grid && grid.medianBarSamples > 0 ? grid.medianBarSamples : NOMINAL_BAR_SAMPLES;
}

/**
 * The px-per-bar range a numeric zoom may take: from the whole song fitted to the
 * viewport (when it has been measured) to MAX_PX_PER_SECOND. The zoom controls clamp
 * against this, so pressing + at the limit is a no-op rather than a stored zoom the
 * screen cannot show.
 */
export function zoomBounds({
  durationSamples,
  grid,
  viewportWidth,
}: Omit<TimeScaleInput, 'zoom'>): { min: number; max: number } {
  const barSamples = barSamplesOf(grid);
  const max = (MAX_PX_PER_SECOND / SAMPLE_RATE) * barSamples;
  const duration = Math.max(1, durationSamples);
  const min = viewportWidth > 0 ? Math.min(max, (viewportWidth / duration) * barSamples) : 1;
  return { min, max };
}

export function timeScale({ durationSamples, grid, zoom, viewportWidth }: TimeScaleInput): TimeScale {
  const barSamples = barSamplesOf(grid);
  const duration = Math.max(1, durationSamples);
  // Fit needs a measured viewport; before the first measurement (and in jsdom,
  // which has no layout) it renders at 1x rather than collapsing to zero width.
  if (zoom === 'fit' && viewportWidth > 0) {
    const pxPerSample = viewportWidth / duration;
    return {
      pxPerSample,
      pxPerBar: pxPerSample * barSamples,
      // Floored so Fit never overflows by a rounding pixel.
      contentWidth: Math.floor(viewportWidth),
    };
  }
  const { min, max } = zoomBounds({ durationSamples, grid, viewportWidth });
  const pxPerBar = zoom === 'fit' ? DEFAULT_PX_PER_BAR : Math.min(max, Math.max(min, zoom));
  const pxPerSample = pxPerBar / barSamples;
  return { pxPerSample, pxPerBar, contentWidth: Math.round(duration * pxPerSample) };
}

/**
 * Content-space x of a sample position, to 1/100 px: sub-pixel enough for
 * alignment, and free of float noise ("112.00000000000001px") in the DOM.
 */
export function xOf(scale: TimeScale, position: number): number {
  return Math.round(position * scale.pxPerSample * 100) / 100;
}

/** The sample under content-space x, clamped to the song. */
export function sampleAtX(scale: TimeScale, x: number, durationSamples: number): SampleIndex {
  if (scale.pxPerSample <= 0) return sampleIndex(0);
  return sampleIndex(Math.min(durationSamples, Math.max(0, x / scale.pxPerSample)));
}

/** Label every bar, every 2nd or every 4th, so numbers never collide. */
export function rulerLabelEvery(pxPerBar: number): 1 | 2 | 4 {
  if (pxPerBar >= 40) return 1;
  if (pxPerBar >= 24) return 2;
  return 4;
}

/** Faint beat lines only when a beat is wide enough to read as a subdivision. */
export function showBeatLines(pxPerBar: number): boolean {
  return pxPerBar >= 40;
}

/** scrollLeft that puts content x at a third of the visible width. */
export function recentreScrollLeft(x: number, visibleWidth: number): number {
  return Math.max(0, Math.round(x - visibleWidth / 3));
}

/**
 * Follow-playhead paging. Returns the new scrollLeft, or null to leave the view
 * alone. While playing, the playhead may travel to 2/3 of the view before the
 * view pages to put it back at 1/3 -- a page turn, not a continuous crawl,
 * because text that slides every frame cannot be read from a music stand.
 * While paused only an off-screen playhead moves the view: clicking the ruler
 * near the right edge must not yank the bar the user just clicked away.
 */
export function followScrollLeft(
  x: number,
  scrollLeft: number,
  visibleWidth: number,
  playing: boolean,
): number | null {
  if (visibleWidth <= 0) return null;
  const edge = scrollLeft + visibleWidth * (playing ? 2 / 3 : 1);
  if (x >= scrollLeft && x <= edge) return null;
  const next = recentreScrollLeft(x, visibleWidth);
  return next === scrollLeft ? null : next;
}
