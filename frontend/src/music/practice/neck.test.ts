import { describe, expect, test } from 'vitest';

import { lowestMidiOf, placeLine, positionsOn, sharpName, TUNINGS } from './neck';

describe('positionsOn', () => {
  test('lists every string a pitch can be played on, low string first', () => {
    expect(positionsOn(33, 'bass')).toEqual([
      { string: 0, fret: 5 },
      { string: 1, fret: 0 },
    ]);
    expect(positionsOn(27, 'bass')).toEqual([]);
    expect(positionsOn(64, 'guitar').map((p) => p.string)).toEqual([3, 4, 5]);
  });
});

describe('placeLine', () => {
  test('keeps a fifth-fret A minor pentatonic box in place', () => {
    const placed = placeLine([33, 36, 38, 40, 43, 45, 48, 50], 'bass', 5);
    expect(placed.ok && placed.frets).toEqual([
      { string: 0, fret: 5 }, { string: 0, fret: 8 },
      { string: 1, fret: 5 }, { string: 1, fret: 7 },
      { string: 2, fret: 5 }, { string: 2, fret: 7 },
      { string: 3, fret: 5 }, { string: 3, fret: 7 },
    ]);
  });

  test('moves the hand when a note leaves the window, and says where it ended', () => {
    const placed = placeLine([28, 52], 'bass', 0);
    expect(placed.ok).toBe(true);
    if (!placed.ok) return;
    expect(placed.frets[1]).toEqual({ string: 3, fret: 9 });
    expect(placed.anchor).toBe(6);
  });

  test('names the first pitch that is off the neck', () => {
    expect(placeLine([33, 57], 'bass', 5)).toEqual({ ok: false, midi: 57 });
  });
});

test('sharpName and lowestMidiOf', () => {
  expect(sharpName(1)).toBe('C♯');
  expect(sharpName(10)).toBe('A♯');
  expect(lowestMidiOf(9, 'bass')).toBe(33);
  expect(lowestMidiOf(4, 'bass')).toBe(28);
  expect(lowestMidiOf(4, 'guitar')).toBe(40);
  expect(TUNINGS.guitar).toEqual([40, 45, 50, 55, 59, 64]);
});
