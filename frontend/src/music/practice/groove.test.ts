import { describe, expect, test } from 'vitest';

import { DEFAULT_INSTRUMENT_SETTINGS, type InstrumentSettings } from '../../api/client';
import { bassGroove, guitarGroove } from './groove';

const withGroove = (patch: Partial<InstrumentSettings['groove']>, rest: Partial<InstrumentSettings> = {}): InstrumentSettings => ({
  ...DEFAULT_INSTRUMENT_SETTINGS,
  ...rest,
  groove: { ...DEFAULT_INSTRUMENT_SETTINGS.groove, ...patch },
});

function loopOrThrow(r: ReturnType<typeof bassGroove>) {
  if (!r.ok) throw new Error(r.error);
  return r.loop;
}

describe('bassGroove', () => {
  test('I–V–vi–IV in G, 1–5–8 in quarters with a chromatic approach before every change', () => {
    const loop = loopOrThrow(bassGroove(withGroove({})));
    expect(loop.bars.map((b) => b.label)).toEqual(['G', 'D', 'Em', 'C']);
    expect(loop.notes).toHaveLength(16);
    const approaches = loop.notes.filter((n) => n.kind === 'approach');
    expect(approaches.map((n) => n.start)).toEqual([3, 7, 11, 15]);
    expect(loop.notes[0]).toMatchObject({ start: 0, dur: 1, midi: 31, name: 'G', string: 0, fret: 3 });
  });

  test('with two bars per chord the approach comes only before a chord change', () => {
    const loop = loopOrThrow(bassGroove(withGroove({ bars_per_chord: 2 })));
    expect(loop.bars).toHaveLength(8);
    expect(loop.bars.map((b) => b.repeat)).toEqual([false, true, false, true, false, true, false, true]);
    expect(loop.notes.filter((n) => n.kind === 'approach').map((n) => n.start)).toEqual([7, 15, 23, 31]);
  });

  test('the same seed gives the same loop; seeds only ever change approach notes', () => {
    const a = loopOrThrow(bassGroove(withGroove({}, { seed: 7 })));
    expect(loopOrThrow(bassGroove(withGroove({}, { seed: 7 })))).toEqual(a);
    const outcomes = new Set<string>();
    for (let seed = 1; seed <= 12; seed++) {
      const loop = loopOrThrow(bassGroove(withGroove({}, { seed })));
      expect(loop.notes.filter((n) => n.kind === 'tone')).toEqual(a.notes.filter((n) => n.kind === 'tone'));
      outcomes.add(loop.notes.filter((n) => n.kind === 'approach').map((n) => n.midi).join(','));
    }
    expect(outcomes.size).toBeGreaterThan(1);
  });

  test('no approach: every note is a chord tone', () => {
    const loop = loopOrThrow(bassGroove(withGroove({ approach: 'none' })));
    expect(loop.notes.every((n) => n.kind === 'tone')).toBe(true);
  });

  test('every note is on the neck', () => {
    for (const progression of ['pop', 'twelve-bar', 'minor-two-five-one', 'canon'] as const) {
      for (let key = 0; key < 12; key++) {
        const loop = loopOrThrow(bassGroove(withGroove({ progression, rhythm: 'eighth' }, { key })));
        expect(loop.notes.every((n) => n.fret >= 0 && n.fret <= 12 && n.string >= 0 && n.string < 4)).toBe(true);
      }
    }
  });
});

describe('guitarGroove', () => {
  test('folk strum over open shapes: each strum is one group of strings, with a direction', () => {
    const loop = loopOrThrow(guitarGroove(withGroove({})));
    expect(loop.strings).toBe(6);
    expect(loop.guitarBars).toHaveLength(4);
    const firstStrum = loop.notes.filter((n) => n.group === 0);
    expect(firstStrum.map((n) => n.string)).toEqual([0, 1, 2, 3, 4, 5]); // G: 320003
    expect(firstStrum.every((n) => n.stroke === 'down' && n.start === 0)).toBe(true);
    const groups = new Set(loop.notes.map((n) => n.group));
    expect(groups.size).toBe(24); // 6 strokes × 4 bars
  });

  test('a backing bass plays root and fifth in quarters under every bar', () => {
    const loop = loopOrThrow(guitarGroove(withGroove({})));
    expect(loop.backing).toHaveLength(16);
    expect(loop.backing.slice(0, 4).map((n) => n.midi)).toEqual([31, 38, 31, 38]); // G1 D2
  });

  test('a strum rings until the next one', () => {
    const loop = loopOrThrow(guitarGroove(withGroove({ strum: 'quarters' })));
    expect(loop.notes.filter((n) => n.group === 0).every((n) => n.dur === 1)).toBe(true);
  });
});
