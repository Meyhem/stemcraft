import { describe, expect, it } from 'vitest';

import tokens from '../styles/tokens.css?source';
import { paintBlobs, parseHex } from './paint';

describe('parseHex', () => {
  it('reads #RRGGBB', () => {
    expect(parseHex('#E0A458')).toEqual([224, 164, 88]);
  });

  it('refuses anything else rather than guessing', () => {
    expect(parseHex('var(--ds-vocals)')).toBeNull();
    expect(parseHex('#fff')).toBeNull();
  });

  it('can read every stem token as tokens.css defines it', () => {
    for (const name of ['vocals', 'drums', 'bass', 'other']) {
      const value = new RegExp(`--ds-${name}:\\s*([^;]+);`).exec(tokens)?.[1] ?? '';
      expect(parseHex(value.trim()), `--ds-${name}`).not.toBeNull();
    }
  });
});

describe('paintBlobs', () => {
  it('clears, then adds each glow as a transparent-to-colour-to-transparent gradient', () => {
    const calls: string[] = [];
    const stops: [number, string][] = [];
    const ctx = {
      globalCompositeOperation: '',
      fillStyle: null as unknown,
      clearRect: () => calls.push(`clear:${ctx.globalCompositeOperation}`),
      createLinearGradient: (x0: number, _y0: number, x1: number) => {
        calls.push(`gradient:${x0}:${x1}`);
        return { addColorStop: (at: number, color: string) => stops.push([at, color]) };
      },
      fillRect: (x: number, _y: number, w: number, h: number) =>
        calls.push(`fill:${x}:${w}:${h}:${ctx.globalCompositeOperation}`),
    };
    paintBlobs(
      ctx as unknown as CanvasRenderingContext2D,
      [{ stem: 1, center: 100, radius: 40, alpha: 0.5 }],
      [[1, 2, 3], [217, 96, 95]],
      800,
      3,
    );
    expect(calls).toEqual(['clear:source-over', 'gradient:60:140', 'fill:60:80:3:lighter']);
    expect(stops).toEqual([
      [0, 'rgba(217,96,95,0)'],
      [0.5, 'rgba(217,96,95,0.500)'],
      [1, 'rgba(217,96,95,0)'],
    ]);
  });
});
