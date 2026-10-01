import { describe, expect, it } from 'vitest';

import { CHORD_QUALITIES, parseChord, type ChordTones } from './chordTones';
import { guitarChord, simplify } from './guitarChords';
import type { ResolvedKey } from './patterns';

const G_MAJOR: ResolvedKey = { tonicPc: 7, mode: 'major' };
const F_MAJOR: ResolvedKey = { tonicPc: 5, mode: 'major' };

function tones(label: string, transpose = 0): ChordTones {
  const parsed = parseChord(label, transpose);
  if (parsed.kind !== 'chord') throw new Error(`${label}: ${parsed.kind}`);
  return parsed.tones;
}

describe('simplify', () => {
  it.each([
    ['C:maj7', 'maj'], ['C:7', 'maj'], ['C:maj6', 'maj'],
    ['C:min7', 'min'], ['C:min6', 'min'], ['C:minmaj7', 'min'],
    ['C:hdim7', 'dim'], ['C:dim7', 'dim'],
    ['C', 'maj'], ['C:min', 'min'], ['C:dim', 'dim'], ['C:aug', 'aug'], ['C:sus2', 'sus2'], ['C:sus4', 'sus4'],
  ])('%s becomes %s', (label, quality) => {
    const t = simplify(tones(label));
    expect(t.quality).toBe(quality);
    expect(t.seventh).toBeNull();
    expect(t.rootPc).toBe(0);
  });

  it('keeps a slash bass', () => {
    expect(simplify(tones('C:maj7/3')).bassPc).toBe(4);
  });
});

describe('guitarChord', () => {
  it.each(CHORD_QUALITIES)('reads quality %s into a chord with the same pitch classes', (quality) => {
    const t = tones(`D:${quality}`);
    const read = guitarChord(t, G_MAJOR);
    if (!read.ok) throw new Error(read.reason);
    const expected = new Set([t.rootPc, (t.rootPc + t.third) % 12, (t.rootPc + t.fifth) % 12]);
    if (t.seventh !== null) expected.add((t.rootPc + t.seventh) % 12);
    for (const pc of expected) expect(read.chord.info.notes.map((n) => n.pc)).toContain(pc);
  });

  it('spells the root and slash bass for the key, transposed to what is heard', () => {
    const read = guitarChord(tones('A:min7', 1), F_MAJOR); // A + 1 = B♭
    if (!read.ok) throw new Error(read.reason);
    expect(read.chord.info.root).toBe('Bb');
    const slash = guitarChord(tones('C/3'), G_MAJOR);
    if (!slash.ok) throw new Error(slash.reason);
    expect(slash.chord.info.bass).toBe('E');
  });
});
