import { describe, expect, test } from 'vitest';

import { parseChord } from '../chordTones';
import { progressionBars, toBtcLabel } from './chords';

describe('toBtcLabel', () => {
  test('writes chord symbols the way parseChord reads them', () => {
    expect(toBtcLabel('G')).toBe('G');
    expect(toBtcLabel('Em')).toBe('E:min');
    expect(toBtcLabel('F#m7')).toBe('Gb:min7');
    expect(toBtcLabel('Bbmaj7')).toBe('Bb:maj7');
    expect(toBtcLabel('Bm7b5')).toBe('B:hdim7');
    expect(toBtcLabel('Cb')).toBe('B');
    for (const s of ['G', 'Em', 'F#m7', 'Bbmaj7', 'Bm7b5', 'D7', 'Cdim']) {
      expect(parseChord(toBtcLabel(s), 0).kind).toBe('chord');
    }
  });

  test('refuses a quality it has no BTC name for', () => {
    expect(() => toBtcLabel('Csus4add9')).toThrow('no chord quality for "Csus4add9"');
  });
});

describe('progressionBars', () => {
  test('I–V–vi–IV in G, one bar each, every bar a change', () => {
    const { bars, mode, tonic } = progressionBars('pop', 7, 1);
    expect(mode).toBe('major');
    expect(tonic).toBe('G');
    expect(bars.map((b) => b.symbol)).toEqual(['G', 'D', 'Em', 'C']);
    expect(bars.every((b) => b.changes && !b.repeat)).toBe(true);
  });

  test('two bars per chord: the repeat is marked and only the last bar changes', () => {
    const { bars } = progressionBars('pop', 7, 2);
    expect(bars.map((b) => [b.symbol, b.repeat, b.changes])).toEqual([
      ['G', false, false], ['G', true, true],
      ['D', false, false], ['D', true, true],
      ['Em', false, false], ['Em', true, true],
      ['C', false, false], ['C', true, true],
    ]);
  });

  test('the 12-bar blues repeats its own chords, and the loop wraps into bar 1', () => {
    const { bars } = progressionBars('twelve-bar', 9, 1);
    expect(bars).toHaveLength(12);
    expect(bars[1]!.repeat).toBe(true);
    expect(bars[0]!.changes).toBe(false);
    expect(bars[3]!.changes).toBe(true);
    expect(bars[11]!.changes).toBe(true); // E7 -> A7 at the wrap
  });

  test('keys use the conventional root spelling', () => {
    expect(progressionBars('pop', 1, 1).tonic).toBe('Db');
    expect(progressionBars('minor-blues', 1, 1).tonic).toBe('C#');
  });
});
