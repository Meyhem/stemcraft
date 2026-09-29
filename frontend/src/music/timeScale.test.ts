import { describe, expect, it } from 'vitest';

import { sampleIndex } from '../engine/types';
import { buildGrid } from './grid';
import {
  followScrollLeft,
  recentreScrollLeft,
  rulerLabelEvery,
  sampleAtX,
  MAX_PX_PER_SECOND,
  timeScale,
  xOf,
  zoomBounds,
} from './timeScale';

// 16 bars of exactly 96 000 samples (2 s at 48 kHz, 120 bpm 4/4).
const grid = buildGrid({
  bpm: 120,
  beats: Array.from({ length: 64 }, (_, i) => i * 24_000),
  downbeats: Array.from({ length: 16 }, (_, i) => i * 96_000),
})!;
const duration = sampleIndex(16 * 96_000);

describe('timeScale', () => {
  it('a numeric zoom is px per bar, from the grid’s bar length', () => {
    const one = timeScale({ durationSamples: duration, grid, zoom: 56, viewportWidth: 400 });
    expect(one.pxPerBar).toBe(56);
    expect(one.contentWidth).toBe(16 * 56);
    const two = timeScale({ durationSamples: duration, grid, zoom: 112, viewportWidth: 400 });
    expect(two.pxPerBar).toBe(112);
    expect(two.contentWidth).toBe(16 * 112);
  });

  it('clamps a numeric zoom between fit and the max, so the axis never shows a zoom it cannot hold', () => {
    // 96 000-sample bars are 2 s; 200 px/s max is 400 px per bar.
    const { min, max } = zoomBounds({ durationSamples: duration, grid, viewportWidth: 800 });
    expect(max).toBe(400);
    expect(min).toBe(50); // 16 bars into 800 px
    expect(timeScale({ durationSamples: duration, grid, zoom: 9999, viewportWidth: 800 }).pxPerBar).toBe(400);
    expect(timeScale({ durationSamples: duration, grid, zoom: 1, viewportWidth: 800 }).pxPerBar).toBe(50);
    expect(max / 2).toBe(MAX_PX_PER_SECOND);
  });

  it('Fit makes the whole song exactly the visible width', () => {
    const fit = timeScale({ durationSamples: duration, grid, zoom: 'fit', viewportWidth: 800 });
    expect(fit.contentWidth).toBe(800);
    expect(fit.pxPerBar).toBe(50);
  });

  it('Fit never overflows by a rounding pixel', () => {
    const fit = timeScale({ durationSamples: sampleIndex(1_000_001), grid, zoom: 'fit', viewportWidth: 777 });
    expect(fit.contentWidth).toBeLessThanOrEqual(777);
    expect(xOf(fit, 1_000_001)).toBeLessThanOrEqual(777);
  });

  it('Fit with an unmeasured viewport (jsdom, first paint) falls back to 1x rather than zero width', () => {
    const fit = timeScale({ durationSamples: duration, grid, zoom: 'fit', viewportWidth: 0 });
    expect(fit.pxPerBar).toBe(56);
  });

  it('without a grid still renders: a nominal 2 s bar stands in, so waveforms have a width', () => {
    const one = timeScale({ durationSamples: duration, grid: null, zoom: 56, viewportWidth: 400 });
    expect(one.contentWidth).toBe(16 * 56);
    const fit = timeScale({ durationSamples: duration, grid: null, zoom: 'fit', viewportWidth: 900 });
    expect(fit.contentWidth).toBe(900);
  });

  it('is linear in samples, so a bar line and the waveform agree on every pixel', () => {
    const one = timeScale({ durationSamples: duration, grid, zoom: 56, viewportWidth: 400 });
    expect(xOf(one, 96_000 * 3)).toBeCloseTo(168, 9);
    expect(xOf(one, 48_000)).toBeCloseTo(28, 9);
  });
});

describe('sampleAtX', () => {
  const one = timeScale({ durationSamples: duration, grid, zoom: 56, viewportWidth: 400 });

  it('inverts xOf', () => {
    expect(sampleAtX(one, 112, duration)).toBe(192_000);
  });

  it('clamps to the song', () => {
    expect(sampleAtX(one, -40, duration)).toBe(0);
    expect(sampleAtX(one, 99_999, duration)).toBe(duration);
  });
});

describe('rulerLabelEvery', () => {
  it('labels every bar when there is room, every 2nd when tight, every 4th when dense', () => {
    expect(rulerLabelEvery(56)).toBe(1);
    expect(rulerLabelEvery(40)).toBe(1);
    expect(rulerLabelEvery(39.9)).toBe(2);
    expect(rulerLabelEvery(24)).toBe(2);
    expect(rulerLabelEvery(23.9)).toBe(4);
    expect(rulerLabelEvery(8)).toBe(4);
  });
});

describe('followScrollLeft', () => {
  // A 900 px visible window scrolled to 1000: content x 1000..1900 is on screen.
  it('leaves the view alone while the playhead is in the reading zone', () => {
    expect(followScrollLeft(1000, 1000, 900, true)).toBeNull();
    expect(followScrollLeft(1500, 1000, 900, true)).toBeNull();
    expect(followScrollLeft(1600, 1000, 900, true)).toBeNull();
  });

  it('pages when a playing playhead passes 2/3, landing it at 1/3', () => {
    expect(followScrollLeft(1601, 1000, 900, true)).toBe(1301);
  });

  it('pages when the playhead is off-screen either side', () => {
    expect(followScrollLeft(400, 1000, 900, true)).toBe(100);
    expect(followScrollLeft(5000, 1000, 900, false)).toBe(4700);
    expect(followScrollLeft(999, 1000, 900, false)).toBe(699);
  });

  it('while paused, only an off-screen playhead moves the view (a click must not jump it)', () => {
    expect(followScrollLeft(1800, 1000, 900, false)).toBeNull();
  });

  it('never scrolls before the start', () => {
    expect(followScrollLeft(100, 1000, 900, true)).toBe(0);
  });

  it('does nothing with no measured viewport', () => {
    expect(followScrollLeft(5000, 0, 0, true)).toBeNull();
  });
});

describe('recentreScrollLeft', () => {
  it('puts the playhead at 1/3 of the visible width', () => {
    expect(recentreScrollLeft(2000, 900)).toBe(1700);
    expect(recentreScrollLeft(100, 900)).toBe(0);
  });
});
