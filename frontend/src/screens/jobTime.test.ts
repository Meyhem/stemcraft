import { expect, test } from 'vitest';

import { formatJobTime } from './jobTime';

// Built from local components so the expectations hold in any time zone.
const at = (y: number, mo: number, d: number, h: number, mi: number, s = 0) =>
  new Date(y, mo - 1, d, h, mi, s).getTime() / 1000;
const now = new Date(2026, 8, 30, 15, 0, 0);

test('a job from today shows just the clock time', () => {
  expect(formatJobTime(at(2026, 9, 30, 14, 32, 5), now)).toBe('14:32');
});

test('a job from another day adds the date', () => {
  expect(formatJobTime(at(2026, 9, 29, 9, 5), now)).toBe('Sep 29, 09:05');
});

test('a job from another year adds the year', () => {
  expect(formatJobTime(at(2025, 12, 31, 23, 59), now)).toBe('Dec 31 2025, 23:59');
});
