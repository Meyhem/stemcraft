import { describe, expect, it, vi } from 'vitest';

import type { PlacedBar } from '../music/fingering';
import type { BarPlan } from '../music/patterns';
import { paintBeatLane } from './beatLanePainter';
import type { PlayAlongColors } from './colors';

const colors = new Proxy({}, { get: (_t, p) => String(p) }) as PlayAlongColors;

function recording() {
  const texts: string[] = [];
  const lines: number[] = [];
  const ctx = new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === 'fillText') return (t: string) => texts.push(t);
        if (prop === 'moveTo') return (x: number) => lines.push(x);
        return vi.fn();
      },
      set: () => true,
    },
  ) as unknown as CanvasRenderingContext2D;
  return { ctx, texts, lines };
}

const plan: BarPlan = { bar: 0, label: 'G', empty: null, reason: null, tones: null, bassPc: 7, slots: [], substitution: null };
const note = (name: string, beat: number) => ({
  midi: 0, name, beat, beats: 1, approach: false, position: { string: 1, fret: 2 },
});
const gBar: PlacedBar = { plan, bassMidi: 31, anchor: 1, notes: ['G', 'B', 'D', 'B'].map((n, i) => note(n, i)) };
const cBar: PlacedBar = {
  plan: { ...plan, bar: 1, label: 'C', bassPc: 0 }, bassMidi: 36, anchor: 2,
  notes: ['C', 'E', 'G', 'E'].map((n, i) => note(n, i)),
};

describe('paintBeatLane', () => {
  it('draws numbered chips for this bar, plain ones for the next, and the cursor', () => {
    const { ctx, texts, lines } = recording();
    paintBeatLane(
      ctx, 1020, colors,
      { bar: gBar, title: 'Bar 1 · G' },
      { bar: cBar, title: 'Next · bar 2 · C' },
      4, 0.3, 1,
    );
    expect(texts).toEqual(
      expect.arrayContaining(['Bar 1 · G', 'Next · bar 2 · C', '1 · G', '2 · B', '3 · D', '4 · B', 'C', 'E']),
    );
    // The cursor is 30% through the current bar's box: x = 10 + 0.3 * (1020 - 20) / 2.
    // (Beat lines sit at 135, 260 and 385, so 160 can only be the cursor.)
    expect(lines).toContain(160);
  });
});
