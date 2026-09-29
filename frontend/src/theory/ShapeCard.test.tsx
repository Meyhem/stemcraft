import { expect, test } from 'vitest';

import { cardStart } from './ShapeCard';

const SPAN = 5;
const holds = (frets: number[]) => {
  const start = cardStart(frets);
  for (const f of frets.filter((n) => n > 0)) {
    expect(f).toBeGreaterThanOrEqual(start);
    expect(f).toBeLessThanOrEqual(start + SPAN - 1);
  }
  return start;
};

test('a shape spanning all five columns is not clipped', () => {
  expect(holds([7, 8, 9, 10, 11])).toBe(7);
  expect(holds([8, 11, 9, 7, 10])).toBe(7);
  expect(holds([3, 6, 4, 2, 5])).toBe(2);
});

test('near the nut the window starts at 1, so open strings are drawn', () => {
  expect(holds([0, 2, 2, 1, 0])).toBe(1);
  expect(holds([0, 0, 0])).toBe(1);
  expect(holds([1, 2, 3, 4, 5])).toBe(1);
});

test('a compact shape higher up starts where it needs and every note fits', () => {
  expect(holds([5, 7, 7, 5, 5, 5])).toBe(3);
  expect(holds([12, 14])).toBe(10);
});
