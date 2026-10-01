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

describe('dense passages (still one readable chip per note)', () => {
  const paint = (notes: TabNote[]) => {
    const r = recording();
    paintStaff(r.ctx, { width: 800, scrollLeft: 0, scale, notes, hot: -1, bars: [], beats: [], colors });
    return r.texts;
  };

  it('draws every fret number even when notes are closer than a full chip', () => {
    // 1600 samples apart = 16 px at this scale: half a full chip.
    const texts = paint([note(0, 3), note(1600, 3), note(3200, 5), note(4800, 3)]);
    expect(texts.filter(([s]) => /^\d+$/.test(s)).map(([s]) => s)).toEqual(['3', '3', '5', '3']);
  });

  it('centres each label inside its own narrowed chip, left to right', () => {
    const xs = paint([note(0, 3), note(1600, 3), note(3200, 3)]).map(([, x]) => x);
    // 16 px apart: each chip is 14 px (a 2 px gap before the next), label at its centre.
    expect(xs[0]).toBe(7);
    expect(xs[1]).toBe(23);
    expect(xs[2]).toBe(47); // the last has the room it needs: a full 30 px chip
  });

  it("drops the unsure '?' before the fret when a chip is narrowed, but keeps the fret", () => {
    const texts = paint([note(0, 12, { unsure: true }), note(2000, 3)]);
    expect(texts.map(([s]) => s)).toContain('12');
  });

  it('keeps the full label where there is room', () => {
    const texts = paint([note(0, 3, { unsure: true }), note(9600, 3)]);
    expect(texts.map(([s]) => s)).toContain('3?');
  });

  it('notes on different strings do not narrow each other', () => {
    const r = recording();
    const a = note(0, 3);
    const b = { ...note(1000, 5), position: { string: 2, fret: 5 } };
    paintStaff(r.ctx, { width: 800, scrollLeft: 0, scale, notes: [a, b], hot: -1, bars: [], beats: [], colors });
    expect(r.texts.find(([s]) => s === '3')![1]).toBe(15); // full 30 px chip, centred
  });
});

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
