import { describe, expect, it, vi } from 'vitest';

import type { GuitarBar } from '../music/guitarSource';
import { shapeOf } from '../music/guitarShapes';
import type { PlayAlongColors } from './colors';
import { guitarGeometry, paintGuitarNeck, rowY } from './guitarNeckPainter';
import { noteX } from './neckPainter';

const colors = new Proxy({}, { get: (_t, p) => String(p) }) as PlayAlongColors;

function recordingContext() {
  const calls = { fillText: [] as [string, number, number][], arc: [] as [number, number, number][], roundRect: 0 };
  const ctx = new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === 'fillText') return (text: string, x: number, y: number) => calls.fillText.push([text, x, y]);
        if (prop === 'arc') return (x: number, y: number, r: number) => calls.arc.push([x, y, r]);
        if (prop === 'roundRect') return () => calls.roundRect++;
        if (typeof prop === 'string' && ['setLineDash', 'beginPath', 'moveTo', 'lineTo', 'stroke', 'fill', 'fillRect', 'clearRect', 'strokeRect'].includes(prop)) {
          return vi.fn();
        }
        return undefined;
      },
      set: () => true,
    },
  ) as unknown as CanvasRenderingContext2D;
  return { ctx, calls };
}

const bar = (over: Partial<GuitarBar>): GuitarBar => ({
  bar: 0, label: 'G', empty: null, reason: null, heard: 'G', chord: 'G', shape: null, degrees: [],
  strokes: [], pushChord: null, substitutions: [], ...over,
});
// G, 320003, and D, xx0232 (row 0 = high e).
const gBar = bar({ shape: shapeOf([3, 0, 0, 0, 2, 3]), degrees: ['R', '3', 'R', '5', '3', 'R'] });
const dBar = bar({ bar: 1, chord: 'D', heard: 'D', shape: shapeOf([2, 3, 2, 0, null, null]), degrees: ['3', 'R', '5', 'R', null, null] });
const fBar = bar({ chord: 'F', heard: 'F', shape: shapeOf([1, 1, 2, 3, 3, 1]), degrees: ['R', '5', '3', 'R', '5', 'R'] });

describe('paintGuitarNeck', () => {
  it('labels every sounding string with its degree and marks muted strings', () => {
    const { ctx, calls } = recordingContext();
    paintGuitarNeck(ctx, 1400, colors, dBar, null, false);
    const texts = calls.fillText.map(([t]) => t);
    expect(texts.filter((t) => t === '✕')).toHaveLength(2);
    expect(texts).toEqual(expect.arrayContaining(['3', 'R', '5']));
  });

  it("draws the next bar's shape as rings where its notes are", () => {
    const { ctx, calls } = recordingContext();
    paintGuitarNeck(ctx, 1400, colors, gBar, dBar, false);
    const g = guitarGeometry(1400);
    // D's B-string note: row 1, fret 3.
    expect(calls.arc).toContainEqual([noteX(g, 3), rowY(1), 16]);
  });

  it('halos every string on a stroke, and nothing between strokes', () => {
    const lit = recordingContext();
    paintGuitarNeck(lit.ctx, 1400, colors, gBar, null, true);
    expect(lit.calls.arc.filter(([, , r]) => r === 16 * 1.45)).toHaveLength(6);
    const still = recordingContext();
    paintGuitarNeck(still.ctx, 1400, colors, gBar, null, false);
    expect(still.calls.arc.filter(([, , r]) => r === 16 * 1.45)).toHaveLength(0);
  });

  it('draws a barre as one bar across its strings', () => {
    const { ctx, calls } = recordingContext();
    paintGuitarNeck(ctx, 1400, colors, fBar, null, false);
    expect(calls.roundRect).toBe(1);
  });

  it('says why the neck is empty', () => {
    const { ctx, calls } = recordingContext();
    paintGuitarNeck(ctx, 1400, colors, bar({ chord: 'C/A♯', empty: 'no_shape' }), null, false);
    expect(calls.fillText.map(([t]) => t)).toContain('no playable shape for C/A♯');
    const none = recordingContext();
    paintGuitarNeck(none.ctx, 1400, colors, bar({ chord: null, heard: null, empty: 'no_chord' }), null, false);
    expect(none.calls.fillText.map(([t]) => t)).toContain('no chord');
  });
});
