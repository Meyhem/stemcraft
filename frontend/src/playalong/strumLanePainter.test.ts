import { describe, expect, it, vi } from 'vitest';

import type { GuitarBar } from '../music/guitarSource';
import { strumStrokes } from '../music/strums';
import type { PlayAlongColors } from './colors';
import { paintStrumLane } from './strumLanePainter';

const colors = new Proxy({}, { get: (_t, p) => String(p) }) as PlayAlongColors;

function recordingContext() {
  const fills: string[] = [];
  const texts: string[] = [];
  const strokes: string[] = [];
  let fillStyle = '';
  let strokeStyle = '';
  const ctx = new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === 'fillText') return (text: string) => texts.push(text);
        if (prop === 'fill') return () => fills.push(fillStyle);
        if (prop === 'stroke') return () => strokes.push(strokeStyle);
        if (typeof prop === 'string' && ['setLineDash', 'beginPath', 'moveTo', 'lineTo', 'fillRect', 'clearRect', 'strokeRect', 'roundRect'].includes(prop)) {
          return vi.fn();
        }
        return undefined;
      },
      set(_target, prop, value) {
        if (prop === 'fillStyle') fillStyle = value;
        if (prop === 'strokeStyle') strokeStyle = value;
        return true;
      },
    },
  ) as unknown as CanvasRenderingContext2D;
  return { ctx, fills, texts, strokes };
}

const bar = (over: Partial<GuitarBar>): GuitarBar => ({
  bar: 0, label: 'G', empty: null, reason: null, heard: 'G', chord: 'G', shape: null, degrees: [],
  strokes: strumStrokes('push', 4), pushChord: 'C', substitutions: [], ...over,
});

describe('paintStrumLane', () => {
  it('draws a chip per stroke, the one to play now lit', () => {
    const { ctx, fills, texts } = recordingContext();
    paintStrumLane(ctx, 1400, colors, { bar: bar({}), title: 'Bar 1 · G' }, null, 4, 0.3, 2);
    expect(fills.filter((f) => f === 'hot')).toHaveLength(1);
    expect(fills.filter((f) => f === 'other')).toHaveLength(5);
    expect(texts.filter((t) => t === '↓')).toHaveLength(3);
  });

  it('rings a push stroke and names the chord it plays', () => {
    const { ctx, texts, strokes } = recordingContext();
    paintStrumLane(ctx, 1400, colors, { bar: bar({}), title: 'Bar 1 · G' }, null, 4, 0, -1);
    expect(texts).toContain('↑ C');
    expect(strokes).toContain('approach');
  });

  it("draws the next bar's strokes as plain arrows", () => {
    const { ctx, texts } = recordingContext();
    paintStrumLane(ctx, 1400, colors, null, { bar: bar({}), title: 'Next · bar 2 · C' }, 4, 0, -1);
    expect(texts).not.toContain('↑ C');
    expect(texts.filter((t) => t === '↑')).toHaveLength(3);
  });
});
