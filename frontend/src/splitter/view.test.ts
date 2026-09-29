import { describe, expect, it } from 'vitest';

import {
  clampZoom,
  columnHeights,
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

describe('columnHeights', () => {
  const env = [0, 1, 0, 0.5];
  it('takes the max of the buckets a column covers, so a narrow peak survives zoom-out', () => {
    // 4 buckets over 4 s; 0.5 px/s -> 2 px wide -> 2 buckets per column.
    const h = columnHeights(env, 4, 0.5, 0, 2);
    expect([...h]).toEqual([1, 0.5]);
  });
  it('repeats a bucket across the columns it spans when zoomed in', () => {
    const h = columnHeights(env, 4, 2, 0, 8); // 2 px per bucket
    expect([...h]).toEqual([0, 0, 1, 1, 0, 0, 0.5, 0.5]);
  });
  it('normalises by the envelope maximum', () => {
    const h = columnHeights([0.1, 0.2], 2, 1, 0, 2);
    expect([...h]).toEqual([0.5, 1]);
  });
  it('is all zero for a silent or empty envelope, not NaN', () => {
    expect([...columnHeights([0, 0], 2, 1, 0, 2)]).toEqual([0, 0]);
    expect([...columnHeights([], 2, 1, 0, 2)]).toEqual([0, 0]);
  });
});
