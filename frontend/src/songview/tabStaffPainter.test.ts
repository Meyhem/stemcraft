import { describe, expect, it, vi } from 'vitest';

import type { TabNote } from '../music/bassTab';
import type { PlayAlongColors } from '../playalong/colors';
import { chipLabel, paintStaff, staffStringY } from './tabStaffPainter';

const colors: PlayAlongColors = {
  note: 'teal', other: 'v', hot: 'blue', approach: 'orange', next: 'grey', string: 's', fret: 'f', nut: 'n',
  label: 'l', board: 'b', onNote: 'black', raised: 'r', ground: 'g', text: 't', textDim: 'td',
};

function recording() {
  const texts: [string, number, number][] = [];
  const fills: string[] = [];
  let fillStyle = '';
  const ctx = new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === 'fillText') return (s: string, x: number, y: number) => texts.push([s, x, y]);
        if (prop === 'fill' || prop === 'fillRect') return () => fills.push(fillStyle);
        if (prop === 'fillStyle') return fillStyle;
        if (typeof prop === 'string') return vi.fn();
        return undefined;
      },
      set(_t, prop, value) {
        if (prop === 'fillStyle') fillStyle = value as string;
        return true;
      },
    },
  ) as unknown as CanvasRenderingContext2D;
  return { ctx, texts, fills };
}

const note = (start: number, fret: number, extra: Partial<TabNote> = {}): TabNote => ({
  start, end: start + 9600, midi: 28 + fret, name: 'X', octave: 0, unsure: false,
  position: { string: 0, fret }, ...extra,
});
const scale = { pxPerSample: 0.01, pxPerBar: 960, contentWidth: 10000 };

describe('tab staff painter', () => {
  it('draws the low E at the bottom', () => {
    expect(staffStringY(0)).toBeGreaterThan(staffStringY(3));
  });

  it('labels an unsure fret with a question mark', () => {
    expect(chipLabel(note(0, 3))).toBe('3');
    expect(chipLabel(note(0, 3, { unsure: true }))).toBe('3?');
  });

  it('places a chip with its left edge at the onset, minus the scroll', () => {
    const { ctx, texts } = recording();
    paintStaff(ctx, { width: 500, scrollLeft: 100, scale, notes: [note(20000, 5)], hot: -1, bars: [], beats: [], colors });
    const [, x] = texts.find(([s]) => s === '5')!;
    // onset x 200 - scroll 100 = 100; the label sits at the centre of a 30 px chip.
    expect(x).toBe(115);
  });

  it('skips notes outside the visible slice', () => {
    const { ctx, texts } = recording();
    paintStaff(ctx, { width: 500, scrollLeft: 0, scale, notes: [note(900000, 7)], hot: -1, bars: [], beats: [], colors });
    expect(texts.some(([s]) => s === '7')).toBe(false);
  });

  it('lights the sounding note and marks a shifted one', () => {
    const { ctx, texts, fills } = recording();
    paintStaff(ctx, {
      width: 800, scrollLeft: 0, scale,
      notes: [note(0, 3), note(20000, 5, { octave: 1 }), note(40000, 2, { octave: -1 })],
      hot: 0, bars: [], beats: [], colors,
    });
    expect(fills).toContain('blue');
    expect(texts.some(([s]) => s === '↑8')).toBe(true);
    expect(texts.some(([s]) => s === '↓8')).toBe(true);
  });
});
