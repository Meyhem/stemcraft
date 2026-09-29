import { describe, expect, it } from 'vitest';

import { sampleIndex, SAMPLE_RATE } from '../engine/types';
import { barAt, barStart, beatPosition, buildGrid, snapToBar } from './grid';
import type { BeatGrid } from '../api/client';

/** 120 BPM, 4/4: a beat every 0.5 s, a bar every 2 s, at 48 kHz. */
function fourFour(bars: number): BeatGrid {
  const beatSamples = SAMPLE_RATE / 2;
  const beats: number[] = [];
  const downbeats: number[] = [];
  for (let i = 0; i < bars * 4; i++) {
    const at = i * beatSamples;
    beats.push(at);
    if (i % 4 === 0) downbeats.push(at);
  }
  return { bpm: 120, beats, downbeats };
}

describe('buildGrid', () => {
  it('derives beats per bar from the downbeat spacing', () => {
    const grid = buildGrid(fourFour(8))!;
    expect(grid.beatsPerBar).toBe(4);
    expect(grid.barCount).toBe(8);
    expect(grid.bpm).toBe(120);
  });

  it('handles 3/4 without being told the time signature', () => {
    const beats: number[] = [];
    const downbeats: number[] = [];
    for (let i = 0; i < 12; i++) {
      beats.push(i * 24_000);
      if (i % 3 === 0) downbeats.push(i * 24_000);
    }
    const grid = buildGrid({ bpm: 120, beats, downbeats })!;
    expect(grid.beatsPerBar).toBe(3);
  });

  it('returns null when there are not two downbeats to measure a bar with', () => {
    expect(buildGrid({ bpm: 0, beats: [], downbeats: [] })).toBeNull();
    expect(buildGrid({ bpm: 120, beats: [0], downbeats: [0] })).toBeNull();
  });
});

describe('bar round trip', () => {
  it('maps every bar number to a sample offset and back exactly', () => {
    // Phase 5's exit criterion, asserted from the consumer side: the grid
    // round-trips bar numbers to sample offsets exactly.
    const grid = buildGrid(fourFour(16))!;
    for (let bar = 0; bar < grid.barCount; bar++) {
      expect(barAt(grid, barStart(grid, bar))).toBe(bar);
    }
  });

  it('bar starts are exactly the downbeats, with no float drift', () => {
    const grid = buildGrid(fourFour(16))!;
    expect(barStart(grid, 0)).toBe(0);
    expect(barStart(grid, 1)).toBe(SAMPLE_RATE * 2);
    expect(barStart(grid, 7)).toBe(SAMPLE_RATE * 14);
    expect(Number.isInteger(barStart(grid, 5))).toBe(true);
  });

  it('extrapolates past the last downbeat by the median bar length', () => {
    const grid = buildGrid(fourFour(4))!; // bars 0..3, last downbeat at 6 s
    expect(barStart(grid, 4)).toBe(SAMPLE_RATE * 8);
    expect(barStart(grid, 6)).toBe(SAMPLE_RATE * 12);
  });

  it('clamps a negative bar to zero', () => {
    const grid = buildGrid(fourFour(4))!;
    expect(barStart(grid, -3)).toBe(0);
  });
});

describe('barAt', () => {
  it('reports the bar containing a position, not the nearest one', () => {
    const grid = buildGrid(fourFour(8))!;
    expect(barAt(grid, sampleIndex(SAMPLE_RATE * 2 + 1))).toBe(1);
    expect(barAt(grid, sampleIndex(SAMPLE_RATE * 4 - 1))).toBe(1);
  });

  it('is -1 before the first downbeat', () => {
    const beats = [48_000, 72_000, 96_000, 120_000, 144_000];
    const grid = buildGrid({ bpm: 120, beats, downbeats: [48_000, 144_000] })!;
    expect(barAt(grid, sampleIndex(0))).toBe(-1);
  });
});

describe('snapToBar', () => {
  it('snaps to the nearest bar line, not the preceding one', () => {
    const grid = buildGrid(fourFour(8))!;
    expect(snapToBar(grid, sampleIndex(SAMPLE_RATE * 2 - 1000))).toBe(1);
    expect(snapToBar(grid, sampleIndex(SAMPLE_RATE * 2 + 1000))).toBe(1);
    expect(snapToBar(grid, sampleIndex(SAMPLE_RATE * 3 + 100))).toBe(2);
  });
});

describe('beatPosition', () => {
  // 120 bpm at 48 kHz: a beat is 24 000 samples, a 4/4 bar 96 000.
  const grid = buildGrid({
    bpm: 120,
    beats: Array.from({ length: 16 }, (_, i) => i * 24_000),
    downbeats: Array.from({ length: 4 }, (_, i) => i * 96_000),
  })!;

  it('finds the bar, the beat and how far through the bar the cursor is', () => {
    expect(beatPosition(grid, sampleIndex(0))).toEqual({ bar: 0, beat: 0, frac: 0 });
    expect(beatPosition(grid, sampleIndex(96_000 + 60_000))).toEqual({ bar: 1, beat: 2, frac: 0.625 });
  });

  it('is null before the first downbeat', () => {
    const late = buildGrid({ bpm: 120, beats: [48_000, 72_000], downbeats: [48_000, 144_000] })!;
    expect(beatPosition(late, sampleIndex(0))).toBeNull();
  });

  it('keeps counting past the analysed bars', () => {
    expect(beatPosition(grid, sampleIndex(5 * 96_000))?.bar).toBe(5);
  });
});
