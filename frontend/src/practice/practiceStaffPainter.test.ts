import { describe, expect, test, vi } from 'vitest';

import { DEFAULT_INSTRUMENT_SETTINGS } from '../api/client';
import { sampleIndex } from '../engine/types';
import { generate } from '../music/practice/generate';
import type { PlayAlongColors } from '../playalong/colors';
import { renderPractice } from './audio/render';
import { beatAt, chordNameAt, paintPracticeStaff, staffWindow } from './practiceStaffPainter';

const colors: PlayAlongColors = {
  note: 'teal', other: 'violet', hot: 'blue', approach: 'orange', next: 'grey', string: 's', fret: 'f', nut: 'n',
  label: 'l', board: 'b', onNote: 'black', raised: 'r', ground: 'g', text: 't', textDim: 'td',
};

function recording() {
  const texts: string[] = [];
  const fills: string[] = [];
  let fillStyle = '';
  const ctx = new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === 'fillText') return (s: string) => texts.push(s);
        if (prop === 'fillRect') return () => fills.push(fillStyle);
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

const loopWith = (bars_per_chord: 1 | 4) => {
  const r = generate('bass', { ...DEFAULT_INSTRUMENT_SETTINGS, groove: { ...DEFAULT_INSTRUMENT_SETTINGS.groove, bars_per_chord } });
  if (!r.ok) throw new Error(r.error);
  return r.loop;
};

test('staffWindow: whole loop up to 8 bars; past that, 8 bars with the playhead a third in', () => {
  expect(staffWindow(16, 3)).toEqual({ from: 0, to: 16, tiled: false });
  expect(staffWindow(32, null)).toEqual({ from: 0, to: 32, tiled: false });
  const glide = staffWindow(64, 20);
  expect(glide.from).toBeCloseTo(20 - 32 / 3, 9);
  expect(glide.to).toBeCloseTo(20 + 64 / 3, 9);
  expect(glide.tiled).toBe(true);
});

test('beatAt: null in the lead-in, beats into the loop after', () => {
  const r = renderPractice(loopWith(1), 120);
  expect(beatAt(r.display, sampleIndex(0))).toBeNull();
  expect(beatAt(r.display, r.loopStart)).toBe(0);
  expect(beatAt(r.display, sampleIndex(r.loopStart + 36_000))).toBe(1.5);
});

test('chordNameAt looks back past repeats', () => {
  const loop = loopWith(4);
  expect(chordNameAt(loop, 6)).toBe('D');
  expect(chordNameAt(loop, -1)).toBe('C');
});

describe('paintPracticeStaff', () => {
  test('a 4-bar loop: every chord and every fret, nothing lit before the first bar', () => {
    const { ctx, texts, fills } = recording();
    paintPracticeStaff(ctx, { width: 1000, loop: loopWith(1), beat: null, colors });
    expect(texts.filter((t) => /^[A-G]/.test(t))).toEqual(['G', 'D', 'Em', 'C']);
    expect(texts.filter((t) => /^\d+$/.test(t))).toHaveLength(16);
    expect(fills).not.toContain('blue');
  });

  test('the sounding note is lit', () => {
    const { ctx, fills } = recording();
    paintPracticeStaff(ctx, { width: 1000, loop: loopWith(1), beat: 4.5, colors });
    // One for the current bar's tint in the chord row, one for the sounding chip.
    expect(fills.filter((f) => f === 'blue')).toHaveLength(2);
  });

  test('a 16-bar loop glides: repeats drawn %, but the first visible bar names its chord', () => {
    const { ctx, texts } = recording();
    paintPracticeStaff(ctx, { width: 1000, loop: loopWith(4), beat: 4 * 6 + 1, colors });
    const labels = texts.filter((t) => t === '%' || /^[A-G]/.test(t));
    expect(labels[0]).toBe('G');
    expect(labels).toContain('%');
    expect(labels).toContain('D');
    expect(labels).toContain('Em');
  });

  test('at the wrap the next pass is already drawn on the right', () => {
    const { ctx, texts } = recording();
    const loop = loopWith(4);
    paintPracticeStaff(ctx, { width: 1000, loop, beat: 63, colors });
    const labels = texts.filter((t) => t === '%' || /^[A-G]/.test(t));
    expect(labels).toContain('G'); // bar 1 of the next pass
  });
});
