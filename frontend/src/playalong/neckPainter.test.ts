import { describe, expect, it, vi } from 'vitest';

import type { PlacedBar } from '../music/fingering';
import type { BarPlan } from '../music/patterns';
import type { PlayAlongColors } from './colors';
import { GUITAR_LINE_LAYOUT, neckGeometry, noteX, paintNeck, stringY } from './neckPainter';

const colors: PlayAlongColors = {
  note: 'teal', other: 'violet', hot: 'blue', approach: 'orange', next: 'grey', string: 's', fret: 'f', nut: 'n',
  label: 'l', board: 'b', onNote: 'black', raised: 'r', ground: 'g', text: 't', textDim: 'td',
};

function recordingContext() {
  const calls: { fillText: [string, number, number][]; arc: number[] } = { fillText: [], arc: [] };
  const ctx = new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === 'fillText') return (text: string, x: number, y: number) => calls.fillText.push([text, x, y]);
        if (prop === 'arc') return (_x: number, _y: number, r: number) => calls.arc.push(r);
        if (typeof prop === 'string' && ['setLineDash', 'beginPath', 'moveTo', 'lineTo', 'stroke', 'fill', 'fillRect', 'clearRect', 'save', 'restore', 'strokeRect', 'roundRect'].includes(prop)) {
          return vi.fn();
        }
        return undefined;
      },
      set: () => true,
    },
  ) as unknown as CanvasRenderingContext2D;
  return { ctx, calls };
}

// Hand-built bars, so these tests pin what gets drawn rather than which
// positions the fingering search happens to choose.
const plan: BarPlan = { bar: 0, label: 'G', empty: null, reason: null, tones: null, bassPc: 7, slots: [], substitution: null };
const note = (name: string, string: number, fret: number, beat: number) => ({
  midi: 0, name, beat, beats: 1, approach: false, position: { string, fret },
});
const gBar: PlacedBar = {
  plan, bassMidi: 31, anchor: 1,
  notes: [note('G', 0, 3, 0), note('B', 1, 2, 1), note('D', 1, 5, 2), note('B', 1, 2, 3)],
};
const cBar: PlacedBar = {
  plan: { ...plan, bar: 1, label: 'C', bassPc: 0 }, bassMidi: 36, anchor: 2,
  notes: [note('C', 1, 3, 0), note('E', 2, 2, 1), note('G', 2, 5, 2), note('E', 2, 2, 3)],
};

describe('neck geometry', () => {
  it('puts low E at the bottom and fret n between wires n-1 and n', () => {
    expect(stringY(0)).toBeGreaterThan(stringY(3));
    const g = neckGeometry(1000);
    expect(noteX(g, 3)).toBeCloseTo(g.nutX + g.fretW * 2.5);
    expect(noteX(g, 0)).toBeLessThan(g.nutX);
  });
});

describe('paintNeck', () => {
  it("labels this bar's notes with their names and play order, a repeated note once", () => {
    const { ctx, calls } = recordingContext();
    paintNeck(ctx, 1000, colors, gBar, cBar, 2);
    const texts = calls.fillText.map(([t]) => t);
    expect(texts).toEqual(expect.arrayContaining(['G', 'B', 'D', '1', '2·4', '3']));
    // B at beat 2 and beat 4 is one dot, not two.
    expect(texts.filter((t) => t === 'B')).toHaveLength(1);
  });

  it('draws nothing but the neck for an empty bar', () => {
    const { ctx, calls } = recordingContext();
    paintNeck(ctx, 1000, colors, null, null, -1);
    // Fret numbers 1..12 and string names only.
    expect(calls.fillText.map(([t]) => t)).toEqual([
      '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', 'E', 'A', 'D', 'G',
    ]);
  });

  it('keeps the desktop dot sizes at 1400 px and shrinks them with the frets on a phone', () => {
    const wide = recordingContext();
    paintNeck(wide.ctx, 1400, colors, gBar, cBar, 0);
    expect(wide.calls.arc).toEqual(expect.arrayContaining([21, 30, 18]));

    const narrow = recordingContext();
    paintNeck(narrow.ctx, 375, colors, gBar, cBar, 0);
    const g = neckGeometry(375);
    const dots = narrow.calls.arc.filter((r) => r > 5);
    expect(Math.max(...dots)).toBeLessThan(21 * 1.43);
    expect(Math.max(...dots)).toBeLessThanOrEqual(g.fretW * 0.48 * (30 / 21) + 1e-9);
    expect(narrow.calls.arc).toContain(g.fretW * 0.48);
  });
});

describe('neck marks for a transcription (U-16)', () => {
  it('badges an unsure note with a question mark', () => {
    const { ctx, calls } = recordingContext();
    paintNeck(ctx, 1000, colors, { notes: [{ ...note('B♭', 1, 1, 0), unsure: true }] }, null, -1);
    expect(calls.fillText.some(([t]) => t === '?')).toBe(true);
  });

  it('draws no badge on a sure note', () => {
    const { ctx, calls } = recordingContext();
    paintNeck(ctx, 1000, colors, { notes: [note('G', 0, 3, 0)] }, null, -1);
    expect(calls.fillText.some(([t]) => t === '?')).toBe(false);
  });
});

describe('play-order label', () => {
  it('counts the plays instead of listing them when one fret is played more than three times', () => {
    const { ctx, calls } = recordingContext();
    const notes = Array.from({ length: 8 }, (_, i) => note('G', 0, 3, i));
    paintNeck(ctx, 1000, colors, { notes }, null, -1);
    expect(calls.fillText.some(([t]) => t === '8×')).toBe(true);
    expect(calls.fillText.some(([t]) => t.includes('·'))).toBe(false);
  });

  it('still lists up to three plays', () => {
    const { ctx, calls } = recordingContext();
    paintNeck(ctx, 1000, colors, { notes: [note('G', 0, 3, 0), note('G', 0, 3, 2)] }, null, -1);
    expect(calls.fillText.some(([t]) => t === '1·2')).toBe(true);
  });
});


describe('a six-string layout', () => {
  it('names six strings and keeps dots inside the narrower gap', () => {
    const { ctx, calls } = recordingContext();
    const bar = { notes: [{ name: 'A', position: { string: 5, fret: 5 } }] };
    paintNeck(ctx, 1200, colors, bar, null, -1, GUITAR_LINE_LAYOUT);
    // The string names are painted before the notes, so they are the first six single letters.
    const names = calls.fillText.map(([t]) => t).filter((t) => /^[EADGBe]$/.test(t)).slice(0, 6);
    expect(names).toEqual(['E', 'A', 'D', 'G', 'B', 'e']);
    expect(Math.max(...calls.arc)).toBeLessThanOrEqual(GUITAR_LINE_LAYOUT.gap * 0.48 + 1e-9);
  });
});
