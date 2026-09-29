import { describe, expect, test } from 'vitest';

import { nameChord } from './identify';
import { chordInfo, pcOf, QUALITIES, rootName } from './spell';

describe('naming chords', () => {
  test('root position beats a slash name; common beats rare', () => {
    expect(nameChord(['A', 'C', 'E', 'G'])[0]).toBe('Am7');
    expect(nameChord(['C', 'E', 'G', 'A'])).toEqual(['C6', 'Am7/C']);
    expect(nameChord(['G', 'A', 'C', 'E'])).toEqual(['Am7/G', 'C6/G']);
    expect(nameChord(['E', 'G', 'C'])[0]).toBe('C/E');
    expect(nameChord(['C', 'E', 'G'])[0]).toBe('C');
  });

  test('duplicates collapse and fewer than three notes is no chord', () => {
    expect(nameChord(['C', 'E', 'G', 'C'])[0]).toBe('C');
    expect(nameChord(['C', 'E'])).toEqual([]);
    expect(nameChord(['C', 'C', 'E'])).toEqual([]);
  });

  test('the same pitch class spelled two ways is one note', () => {
    expect(nameChord(['C#', 'E#', 'G#', 'Db'])[0]).toBe('Db');
  });

  test('every root and quality: the chord played root first is named by its own symbol', () => {
    for (let pc = 0; pc < 12; pc++) {
      for (const q of QUALITIES) {
        const symbol = `${rootName(pc, 'major')}${q.suffix}`;
        const info = chordInfo(symbol);
        if (!info.ok) throw new Error(`fixture: ${symbol} unreadable`);
        const names = nameChord(info.chord.notes.map((n) => n.name));
        // Symmetrical chords (aug, dim7) have several roots but the bass still decides: root position first.
        // The root may be respelled (Dbm is named C#m), so compare the chord, not the letters.
        const first = chordInfo(names[0] ?? '');
        const why = `${symbol} from ${info.chord.notes.map((n) => n.name).join(' ')} -> ${names.join(', ')}`;
        expect(first.ok, why).toBe(true);
        if (!first.ok) continue;
        expect(first.chord.bass, why).toBeNull();
        expect(first.chord.notes.map((n) => [n.pc, n.interval]), why).toEqual(info.chord.notes.map((n) => [n.pc, n.interval]));
        expect(names[0]!.replace(/^[A-G][#b]?/, ''), why).toBe(q.suffix);
      }
    }
  });

  test('every name says exactly the notes given, with the lowest as its bass', () => {
    const pcs = Array.from({ length: 12 }, (_, i) => i);
    const subsets = (size: number, from = 0, acc: number[] = []): number[][] =>
      acc.length === size ? [acc] : pcs.slice(from).flatMap((p) => subsets(size, p + 1, [...acc, p]));
    const SHARPS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    let named = 0;
    for (const size of [3, 4, 5]) {
      for (const set of subsets(size)) {
        for (const bass of set) {
          const order = [bass, ...set.filter((p) => p !== bass)];
          const names = nameChord(order.map((p) => SHARPS[p]!));
          for (const name of names) {
            const info = chordInfo(name);
            if (!info.ok) throw new Error(`${name} for ${order.join(',')} cannot be read back`);
            const got = new Set(info.chord.notes.map((n) => n.pc));
            if (info.chord.extraBass) got.add(info.chord.extraBass.pc);
            expect([...got].sort((a, b) => a - b), `${name} for ${order.join(',')}`).toEqual([...set].sort((a, b) => a - b));
            expect(pcOf(info.chord.bass ?? info.chord.root), `${name} bass`).toBe(bass);
          }
          if (names.length > 0) named++;
        }
      }
    }
    expect(named).toBeGreaterThan(500);
  });

  test('ranking does not depend on the order tonal lists names in', () => {
    // Same three notes over the same bass: the augmented chord has three roots, all common, all slash but one.
    expect(nameChord(['C', 'E', 'G#'])).toEqual(['Caug', 'Eaug/C', 'Abaug/C']);
    expect(nameChord(['C', 'E', 'G#'])).toEqual(nameChord(['C', 'E', 'Ab']));
  });

  test("a name tonal makes up for other notes is dropped, not shown (N-08)", () => {
    // Chord.detect answers 'Cb9sus' for C C# F G A#, which is B E F# A C#: a different chord.
    const names = nameChord(['C', 'C#', 'F', 'G', 'A#']);
    expect(names.some((n) => /^(B|Cb)9sus/.test(n))).toBe(false);
  });

  test('names are spelled the way a player writes them', () => {
    expect(nameChord(['A#', 'D', 'F'])[0]).toBe('Bb');
    expect(nameChord(['A#', 'C#', 'F'])[0]).toBe('Bbm');
    expect(nameChord(['F#', 'A#', 'C#'])[0]).toBe('F#');
    expect(nameChord(['D#', 'G', 'A#'])[0]).toBe('Eb');
  });
});
