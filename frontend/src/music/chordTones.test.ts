import { describe, expect, it } from 'vitest';

import { CHORD_QUALITIES, mod12, parseChord } from './chordTones';

function tones(label: string, transpose = 0) {
  const parsed = parseChord(label, transpose);
  if (parsed.kind !== 'chord') throw new Error(`expected a chord, got ${parsed.kind}`);
  return parsed.tones;
}

describe('parseChord', () => {
  it('reads a bare root as major, the way recognize.py emits it', () => {
    expect(tones('G')).toEqual({ rootPc: 7, bassPc: 7, third: 4, fifth: 7, seventh: null, quality: 'maj' });
  });

  it('reads each quality into its third, fifth and seventh', () => {
    expect(tones('E:min')).toMatchObject({ rootPc: 4, third: 3, fifth: 7, seventh: null });
    expect(tones('D:min7')).toMatchObject({ third: 3, fifth: 7, seventh: 10 });
    expect(tones('C:maj7')).toMatchObject({ third: 4, fifth: 7, seventh: 11 });
    expect(tones('A:7')).toMatchObject({ third: 4, fifth: 7, seventh: 10 });
    expect(tones('B:hdim7')).toMatchObject({ third: 3, fifth: 6, seventh: 10 });
    expect(tones('B:dim7')).toMatchObject({ third: 3, fifth: 6, seventh: 9 });
    expect(tones('F:aug')).toMatchObject({ third: 4, fifth: 8 });
    expect(tones('C:sus4')).toMatchObject({ third: 5, fifth: 7 });
    expect(tones('C:sus2')).toMatchObject({ third: 2, fifth: 7 });
  });

  it('understands every quality the chord model can emit', () => {
    for (const quality of CHORD_QUALITIES) {
      expect(parseChord(`C:${quality}`, 0).kind).toBe('chord');
    }
    expect(CHORD_QUALITIES).toHaveLength(14);
  });

  it('transposes the root and bass by the pitch shift', () => {
    expect(tones('C', 3).rootPc).toBe(3);
    expect(tones('C', -1).rootPc).toBe(11);
    expect(tones('G', -2)).toMatchObject({ rootPc: 5, bassPc: 5 });
  });

  it('puts a slash degree in the bass', () => {
    expect(tones('C:maj/3')).toMatchObject({ rootPc: 0, bassPc: 4 });
    expect(tones('C:maj/b7')).toMatchObject({ bassPc: 10 });
  });

  it('keeps N and X apart from a chord, never guessing one', () => {
    expect(parseChord('N', 0)).toEqual({ kind: 'no_chord' });
    expect(parseChord('X', 0)).toEqual({ kind: 'unclassified' });
  });

  it('refuses an unknown root, quality or bass degree with the label in the reason (N-08)', () => {
    const root = parseChord('H:maj', 0);
    expect(root.kind).toBe('unparsed');
    expect(root.kind === 'unparsed' && root.reason).toContain('H:maj');
    const quality = parseChord('C:add9', 0);
    expect(quality.kind === 'unparsed' && quality.reason).toContain('add9');
    const degree = parseChord('C:maj/9', 0);
    expect(degree.kind === 'unparsed' && degree.reason).toContain('9');
  });
});

describe('mod12', () => {
  it('wraps negatives into 0..11', () => {
    expect(mod12(-1)).toBe(11);
    expect(mod12(24)).toBe(0);
  });
});
