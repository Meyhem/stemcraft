import { describe, expect, it } from 'vitest';

import { clamp, columnHeights, scrollLeftAfterZoom, wheelZoom } from './zoom';

describe('clamp', () => {
  it('clamps into range, and a range whose min exceeds its max collapses to the max', () => {
    expect(clamp(5, 1, 10)).toBe(5);
    expect(clamp(0, 1, 10)).toBe(1);
    expect(clamp(50, 1, 10)).toBe(10);
    expect(clamp(3, 20, 10)).toBe(10);
  });
});

describe('zoom at a point', () => {
  it('keeps the moment under the pointer under the pointer', () => {
    // 10 px/unit, scrolled 500 px, pointer 200 px in: pointer is over unit 70.
    expect(scrollLeftAfterZoom(500, 200, 10, 40)).toBe(70 * 40 - 200);
  });
  it('never scrolls to a negative offset', () => {
    expect(scrollLeftAfterZoom(0, 300, 40, 10)).toBe(0);
  });
  it('wheel up zooms in, wheel down zooms out, symmetrically', () => {
    const zin = wheelZoom(10, -100);
    expect(zin).toBeGreaterThan(10);
    expect(wheelZoom(zin, 100)).toBeCloseTo(10);
  });
});

describe('columnHeights', () => {
  const env = [0, 1, 0, 0.5];
  it('takes the max of the buckets a column covers, so a narrow peak survives zoom-out', () => {
    // 4 buckets over 2 px -> 2 buckets per column.
    expect([...columnHeights(env, 2, 0, 2, false)]).toEqual([1, 0.5]);
  });
  it('repeats a bucket across the columns it spans when zoomed in', () => {
    expect([...columnHeights(env, 8, 0, 8, false)]).toEqual([0, 0, 1, 1, 0, 0, 0.5, 0.5]);
  });
  it('starts at the scrolled offset', () => {
    expect([...columnHeights(env, 8, 2, 2, false)]).toEqual([1, 1]);
  });
  it('never reads a bucket past a column\'s right edge through float noise', () => {
    // 100 buckets over 1000 px: column 499 covers bucket 49 only, and bucket 50 is loud.
    const envelope = [...Array(50).fill(0.1), ...Array(50).fill(0.9)];
    const h = columnHeights(envelope, 1000, 0, 500, false);
    expect(Math.max(...h)).toBeCloseTo(0.1);
  });

  it('normalises by the envelope maximum only when asked', () => {
    expect([...columnHeights([0.1, 0.2], 2, 0, 2, true)]).toEqual([0.5, 1]);
    const raw = columnHeights([0.1, 0.2], 2, 0, 2, false);
    expect(raw[0]).toBeCloseTo(0.1);
    expect(raw[1]).toBeCloseTo(0.2);
  });
  it('is all zero for a silent or empty envelope, not NaN', () => {
    expect([...columnHeights([0, 0], 2, 0, 2, true)]).toEqual([0, 0]);
    expect([...columnHeights([], 2, 0, 2, false)]).toEqual([0, 0]);
  });
});
