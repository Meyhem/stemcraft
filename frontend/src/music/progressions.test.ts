import { describe, expect, test } from 'vitest';

import { numeralToSymbol, progressionChords, PROGRESSIONS } from './progressions';

describe('progressions', () => {
  test.each([
    ['G', 'vi', 'Em'],
    ['G', 'bVII', 'F'],
    ['C', 'ii7', 'Dm7'],
    ['A', 'iiø7', 'Bm7b5'],
    ['C', 'vii°', 'Bdim'],
    ['E', 'bVI', 'C'],
    ['Eb', 'V7', 'Bb7'],
    ['C', 'IVmaj7', 'Fmaj7'],
  ])('%s: %s -> %s', (tonic, numeral, symbol) => expect(numeralToSymbol(tonic, numeral)).toBe(symbol));

  test('unreadable numerals are null', () => {
    expect(numeralToSymbol('C', 'VIII')).toBeNull();
    expect(numeralToSymbol('C', 'Imaj9')).toBeNull();
  });

  test('fifteen progressions, all readable', () => {
    expect(PROGRESSIONS).toHaveLength(15);
    for (const p of PROGRESSIONS) for (const n of p.numerals) expect(numeralToSymbol('C', n), `${p.id} ${n}`).not.toBeNull();
  });

  test('transposes to the key', () => {
    const pop = PROGRESSIONS.find((p) => p.id === 'pop')!;
    expect(progressionChords(pop, 'G')).toEqual(['G', 'D', 'Em', 'C']);
    const andalusian = PROGRESSIONS.find((p) => p.id === 'andalusian')!;
    expect(progressionChords(andalusian, 'A')).toEqual(['Am', 'G', 'F', 'E']);
  });
});
