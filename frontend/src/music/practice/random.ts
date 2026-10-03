// Seeded randomness for Regenerate (D-22): mulberry32. The seed is saved with the
// settings, so reopening the tab reproduces the loop you left.
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A fresh seed for Regenerate, within practice.py's 0..2^31-1. */
export function newSeed(): number {
  return Math.floor(Math.random() * 2 ** 31);
}
