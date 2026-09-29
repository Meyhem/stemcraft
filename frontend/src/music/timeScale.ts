// The one place sample <-> pixel arithmetic lives for the Song view's scrolling
// time axis. The ruler, the chord row, the loop/playhead overlay, the scrub and
// the stem waveforms all lay out against the same TimeScale, so a chord's left
// edge, its bar line and the waveform under it land on the same pixel.
//
// The mapping is *linear in samples*, not "N px per bar" bar-by-bar: wavesurfer
// draws each stem linearly in time, so a piecewise bar mapping would drift the
// bar lines off the audio wherever the analysed tempo wanders. Zoom picks the
// slope -- a nominal px-per-bar measured against the grid's median bar length
// (grid.ts) -- and every position is `sample * pxPerSample`. Positions stay
// integer sample indices until this last step (D-03).
import type { SampleIndex } from '../engine/types';
import { sampleIndex } from '../engine/types';
import type { Grid } from './grid';

export type Zoom = 'fit' | '1x' | '2x';

/** Width of the sticky label/controls column every row of the axis starts with. */
export const LANE_HEAD_PX = 200;

const PX_PER_BAR: Record<Exclude<Zoom, 'fit'>, number> = { '1x': 56, '2x': 112 };

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

export function timeScale({ durationSamples, grid, zoom, viewportWidth }: TimeScaleInput): TimeScale {
  const barSamples = grid && grid.medianBarSamples > 0 ? grid.medianBarSamples : NOMINAL_BAR_SAMPLES;
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
  const pxPerBar = PX_PER_BAR[zoom === 'fit' ? '1x' : zoom];
  const pxPerSample = pxPerBar / barSamples;
  return { pxPerSample, pxPerBar, contentWidth: Math.round(duration * pxPerSample) };
}

/** Content-space x of a sample position. */
export function xOf(scale: TimeScale, position: number): number {
  return position * scale.pxPerSample;
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
