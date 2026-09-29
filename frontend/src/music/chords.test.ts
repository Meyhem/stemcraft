import { describe, expect, it } from 'vitest';

import { sampleIndex } from '../engine/types';
import { chordIndexAt, chordLabelFits, displayChord, mergeChords } from './chords';

const seg = (bar: number, chord: string) => ({
  bar,
  start_sample: bar * 96_000,
  end_sample: (bar + 1) * 96_000,
  chord,
});

describe('mergeChords', () => {
  it('merges runs of the same chord into one segment spanning them', () => {
    const merged = mergeChords([seg(0, 'G:maj'), seg(1, 'G:maj'), seg(2, 'G:maj'), seg(3, 'G:maj'), seg(4, 'C:maj'), seg(5, 'G:maj')]);
    expect(merged).toEqual([
      { bar: 0, start_sample: 0, end_sample: 4 * 96_000, chord: 'G:maj' },
      { bar: 4, start_sample: 4 * 96_000, end_sample: 5 * 96_000, chord: 'C:maj' },
      { bar: 5, start_sample: 5 * 96_000, end_sample: 6 * 96_000, chord: 'G:maj' },
    ]);
  });

  it('merges no-chord runs too, and never merges different spellings', () => {
    const merged = mergeChords([seg(0, 'N'), seg(1, 'N'), seg(2, 'E:min'), seg(3, 'E:min7')]);
    expect(merged.map((s) => s.chord)).toEqual(['N', 'E:min', 'E:min7']);
  });

  it('does not mutate its input', () => {
    const input = [seg(0, 'A:maj'), seg(1, 'A:maj')];
    mergeChords(input);
    expect(input[0]!.end_sample).toBe(96_000);
  });

  it('is empty for no chords', () => {
    expect(mergeChords([])).toEqual([]);
  });
});

describe('displayChord', () => {
  it('spells flats with ♭ for display', () => {
    expect(displayChord('Bb:maj').text).toBe('B♭');
    expect(displayChord('Eb:min').text).toBe('E♭m');
    expect(displayChord('Ab:maj7').text).toBe('A♭maj7');
    expect(displayChord('Bb:maj').label).toBe('B♭ major');
  });

  it('leaves naturals, sharps and quality text alone', () => {
    expect(displayChord('G:maj').text).toBe('G');
    expect(displayChord('F#:min').text).toBe('F#m');
    expect(displayChord('C:7(b9)').text).toBe('C7(b9)');
  });

  it('keeps the no-chord and unclassified marks', () => {
    expect(displayChord('N')).toEqual({ text: '–', label: 'no chord' });
    expect(displayChord('X')).toEqual({ text: '?', label: 'unclassified' });
  });
});

describe('chordLabelFits', () => {
  it('fits a short label in a wide segment and hides it in a narrow one', () => {
    expect(chordLabelFits('G', 56, 24)).toBe(true);
    expect(chordLabelFits('Cmaj7', 56, 24)).toBe(false);
    expect(chordLabelFits('Cmaj7', 112, 24)).toBe(true);
    expect(chordLabelFits('G', 12, 15)).toBe(false);
  });
});

describe('chordIndexAt', () => {
  const merged = mergeChords([seg(1, 'G:maj'), seg(2, 'G:maj'), seg(3, 'C:maj'), seg(4, 'D:maj')]);

  it('finds the segment under a position', () => {
    expect(chordIndexAt(merged, sampleIndex(96_000))).toBe(0);
    expect(chordIndexAt(merged, sampleIndex(3 * 96_000 - 1))).toBe(0);
    expect(chordIndexAt(merged, sampleIndex(3 * 96_000))).toBe(1);
    expect(chordIndexAt(merged, sampleIndex(10 * 96_000))).toBe(2);
  });

  it('is -1 before the first chord or with no chords', () => {
    expect(chordIndexAt(merged, sampleIndex(0))).toBe(-1);
    expect(chordIndexAt([], sampleIndex(50))).toBe(-1);
  });
});
