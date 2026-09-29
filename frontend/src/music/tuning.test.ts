import { describe, expect, test } from 'vitest';

import {
  DEFAULT_INSTRUMENT,
  instrumentFor,
  neckFrets,
  openMidi,
  parseTuning,
  presetOf,
  presetsFor,
  tuningLabel,
} from './tuning';

const bass4 = DEFAULT_INSTRUMENT;
const bass5 = instrumentFor('bass5', false);
const guitar = instrumentFor('guitar6', false);
const dropD = { ...guitar, tuning: ['D2', 'A2', 'D3', 'G3', 'B3', 'E4'] };

describe('tuning', () => {
  test('open strings, low first', () => {
    expect(openMidi(bass4)).toEqual([28, 33, 38, 43]);
    expect(openMidi(bass5)).toEqual([23, 28, 33, 38, 43]);
    expect(openMidi(guitar)).toEqual([40, 45, 50, 55, 59, 64]);
  });

  test('labels and presets', () => {
    expect(tuningLabel(bass4)).toBe('E A D G');
    expect(presetOf(dropD)?.label).toBe('Drop D');
    expect(presetOf({ ...bass4, tuning: ['F1', 'A1', 'D2', 'G2'] })).toBeNull();
    expect(presetsFor(bass4).map((p) => p.label)).toEqual(['Standard', 'Drop D', 'Half-step down', 'D standard']);
    expect(presetsFor(bass5).map((p) => p.label)).toEqual(['Standard']);
    expect(neckFrets(bass4)).toBe(15);
    expect(neckFrets(guitar)).toBe(17);
  });

  test('custom tunings are validated, never guessed', () => {
    expect(parseTuning('d1 A1 D2 G2', 4)).toEqual({ ok: true, notes: ['D1', 'A1', 'D2', 'G2'] });
    expect(parseTuning('E A D G', 4)).toEqual({ ok: false, reason: '"E" is not a note with an octave, like E1 or F#2' });
    expect(parseTuning('E1 A1 D2', 4).ok).toBe(false);
    expect(parseTuning('E###1 A1 D2 G2', 4)).toEqual({ ok: false, reason: '"E###1" is not a note with an octave, like E1 or F#2' });
    expect(parseTuning('G2 D2 A1 E1', 4)).toEqual({ ok: false, reason: 'Each string must be higher than the one before it' });
  });

  test("the wrong-count hint uses the instrument's own example", () => {
    const hint = (strings: number) => {
      const r = parseTuning('E1', strings);
      return r.ok ? '' : r.reason;
    };
    expect(hint(6)).toContain('"E2 A2 D3 G3 B3 E4"');
    expect(hint(5)).toContain('"B0 E1 A1 D2 G2"');
    expect(hint(4)).toContain('"E1 A1 D2 G2"');
  });
});
