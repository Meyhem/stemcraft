import { describe, expect, it } from 'vitest';

import {
  clampZoom,
  cutsNear,
  pickCut,
  zoomToRange,
  fitPxPerSecond,
  MAX_PX_PER_SECOND,
  scrollLeftAfterZoom,
  tickInterval,
  tickLabel,
} from './view';

describe('zoom', () => {
  it('fit is the whole album across the viewport', () => {
    expect(fitPxPerSecond(1000, 500)).toBe(2);
  });
  it('never zooms out past fit or in past the envelope resolution', () => {
    expect(clampZoom(0.1, 2)).toBe(2);
    expect(clampZoom(9999, 2)).toBe(MAX_PX_PER_SECOND);
  });
  it('a short album that already exceeds the max at fit stays at the max', () => {
    expect(clampZoom(500, 500)).toBe(MAX_PX_PER_SECOND);
  });
  it('keeps the moment under the pointer under the pointer', () => {
    // 10 px/s, scrolled 500 px, pointer 200 px in: pointer is over 70 s.
    const next = scrollLeftAfterZoom(500, 200, 10, 40);
    expect(next).toBe(70 * 40 - 200);
  });
  it('never scrolls to a negative offset', () => {
    expect(scrollLeftAfterZoom(0, 300, 40, 10)).toBe(0);
  });
});

describe('ruler', () => {
  it('picks the smallest round interval with readable spacing', () => {
    expect(tickInterval(100)).toBe(1); // 1 s = 100 px
    expect(tickInterval(1)).toBe(120); // 90 s of room needed -> 2 min
  });
  it('labels as m:ss and h:mm:ss, with tenths only for sub-second ticks', () => {
    expect(tickLabel(125, 5)).toBe('2:05');
    expect(tickLabel(3725, 5)).toBe('1:02:05');
    expect(tickLabel(1.5, 0.5)).toBe('0:01.5');
  });
});

describe('grabbing cuts', () => {
  it('grabs the nearest cut within reach, and nothing out of reach', () => {
    expect(cutsNear([100, 300], 105)).toEqual([0]);
    expect(cutsNear([100, 300], 200)).toEqual([]);
  });
  it('returns every overlapping cut, nearest first', () => {
    expect(cutsNear([100, 102, 300], 103)).toEqual([1, 0]);
  });
  it('resolves overlapping cuts by the drag direction', () => {
    expect(pickCut([1, 0], 5)).toBe(1);
    expect(pickCut([1, 0], -5)).toBe(0);
    expect(pickCut([1, 0], 0)).toBe(1); // no movement yet: nearest
    expect(pickCut([4], -5)).toBe(4);
  });
});

describe('zoomToRange', () => {
  it('fits the selected range to the viewport', () => {
    // 60 s selected (120..180 s) across 600 px -> 10 px/s, starting at 1200 px.
    const z = zoomToRange(180 * 48000, 120 * 48000, 48000, 600, 0.1);
    expect(z.pxPerSecond).toBe(10);
    expect(z.scrollLeft).toBe(1200);
  });
  it('caps at max zoom and centres a range too short to fill the view', () => {
    // 1 s at 600 px would be 600 px/s; capped to 100, centred on 150.5 s.
    const z = zoomToRange(150 * 48000, 151 * 48000, 48000, 600, 0.1);
    expect(z.pxPerSecond).toBe(MAX_PX_PER_SECOND);
    expect(z.scrollLeft).toBe(Math.round(150.5 * 100 - 300));
  });
});
