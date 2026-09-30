import { describe, expect, it } from 'vitest';

import { blobsFor } from './blobs';

describe('blobsFor', () => {
  it('draws two glows per audible stem and none for a silenced one', () => {
    const blobs = blobsFor([0.5, 0.5, 0.5, 0.5], [1, 0, 1, 1], 0, 1000);
    expect(blobs.map((b) => b.stem)).toEqual([0, 0, 2, 2, 3, 3]);
  });

  it('a louder stem is wider and brighter', () => {
    const [quiet] = blobsFor([0.1, 0, 0, 0], [1, 0, 0, 0], 0, 1000);
    const [loud] = blobsFor([0.9, 0, 0, 0], [1, 0, 0, 0], 0, 1000);
    expect(loud!.radius).toBeGreaterThan(quiet!.radius);
    expect(loud!.alpha).toBeGreaterThan(quiet!.alpha);
  });

  it('an audible stem glows faintly even in a silent passage', () => {
    const [blob] = blobsFor([0, 0, 0, 0], [1, 0, 0, 0], 0, 1000);
    expect(blob!.alpha).toBeCloseTo(0.25);
    expect(blob!.radius).toBeCloseTo(50);
  });

  it('brightness scales with the stem weight, so a mute fades rather than cuts', () => {
    const [full] = blobsFor([1, 0, 0, 0], [1, 0, 0, 0], 0, 1000);
    const [half] = blobsFor([1, 0, 0, 0], [0.5, 0, 0, 0], 0, 1000);
    expect(half!.alpha).toBeCloseTo(full!.alpha / 2);
  });

  it('glows drift with time and stay inside the bar', () => {
    const at = (t: number) => blobsFor([1, 1, 1, 1], [1, 1, 1, 1], t, 1000);
    expect(at(0)[0]!.center).not.toBeCloseTo(at(5)[0]!.center);
    for (const t of [0, 3, 17, 120]) {
      for (const blob of at(t)) {
        expect(blob.center).toBeGreaterThanOrEqual(80);
        expect(blob.center).toBeLessThanOrEqual(920);
      }
    }
  });
});
