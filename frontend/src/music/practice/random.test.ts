import { expect, test } from 'vitest';

import { rng } from './random';

test('the same seed gives the same sequence, in [0, 1)', () => {
  const a = rng(42);
  const b = rng(42);
  const xs = Array.from({ length: 50 }, () => a());
  expect(Array.from({ length: 50 }, () => b())).toEqual(xs);
  expect(xs.every((x) => x >= 0 && x < 1)).toBe(true);
  expect(rng(43)()).not.toBe(xs[0]);
});
