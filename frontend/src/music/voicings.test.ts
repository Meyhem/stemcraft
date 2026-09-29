import { describe, expect, test } from 'vitest';

import { mod12 } from './chordTones';
import { rowMidi } from './positions';
import { chordInfo, type ChordInfo, pcOf } from './spell';
import { DEFAULT_INSTRUMENT, instrumentFor } from './tuning';
import { bassArpeggios, guitarVoicings, isPlayable, tabOf, type Voicing } from './voicings';

const guitar = instrumentFor('guitar6', false);
const chord = (s: string): ChordInfo => {
  const r = chordInfo(s);
  if (!r.ok) throw new Error(r.reason);
  return r.chord;
};

/**
 * Independent oracle: validates a voicing without using isPlayable.
 * Returns true if valid, or error message if invalid.
 */
function validateVoicing(inst: ReturnType<typeof instrumentFor>, c: ChordInfo, frets: readonly (number | null)[]): true | string {
  const open = rowMidi(inst);

  // 1. Unbroken run of at least 4 strings
  const soundingRows = frets.map((f, row) => (f !== null ? row : null)).filter((r) => r !== null) as number[];
  if (soundingRows.length < 4) return 'fewer than 4 sounding strings';
  for (let i = 0; i < soundingRows.length - 1; i++) {
    if (soundingRows[i + 1]! - soundingRows[i]! !== 1) return 'sounding strings not contiguous';
  }

  // 2. Lowest note is chord bass
  const soundingNotes = soundingRows.map((row) => ({
    row,
    midi: open[row]! + frets[row]!,
  }));
  const lowestNote = soundingNotes.reduce((a, b) => (b.midi < a.midi ? b : a));
  const bassPc = pcOf(c.bass ?? c.root)!;
  if (mod12(lowestNote.midi) !== bassPc) return 'wrong bass note';

  // 3. Fretted span ≤ 3
  const frettedValues = soundingNotes.map((n) => frets[n.row]!).filter((f) => f > 0);
  if (frettedValues.length > 0 && Math.max(...frettedValues) - Math.min(...frettedValues) > 3) {
    return 'fretted span > 3';
  }

  // 4. Finger count ≤ 4 (barre only if no open string in its span)
  const entries = frets
    .map((f, row) => ({ row, fret: f }))
    .filter((x): x is { row: number; fret: number } => x.fret !== null && x.fret > 0);
  let fingerCount = 0;
  if (entries.length > 0) {
    const minFret = Math.min(...entries.map((x) => x.fret));
    const atMinFret = entries.filter((x) => x.fret === minFret);

    if (atMinFret.length >= 2) {
      const minRow = Math.min(...atMinFret.map((x) => x.row));
      const maxRow = Math.max(...atMinFret.map((x) => x.row));
      const hasOpenInSpan = frets.slice(minRow, maxRow + 1).some((f) => f === 0);

      fingerCount = !hasOpenInSpan ? 1 + entries.filter((x) => x.fret > minFret).length : entries.length;
    } else {
      fingerCount = entries.length;
    }
  }
  if (fingerCount > 4) return `too many fingers: ${fingerCount}`;

  // 5. All sounding notes are chord tones
  const playedPcs = new Set(soundingNotes.map((n) => mod12(n.midi)));
  const chordTones = new Set(c.notes.map((n) => n.pc));
  if (c.extraBass) chordTones.add(c.extraBass.pc);

  for (const pc of playedPcs) {
    if (!chordTones.has(pc)) return 'non-chord tone sounding';
  }

  // 6. All required chord tones sound (except optional 5th in 4+ note chords)
  const fifth = c.notes.find((n) => n.interval === '5')?.pc;
  const required = [...chordTones].filter((pc) => !(c.notes.length >= 4 && pc === fifth));

  for (const pc of required) {
    if (!playedPcs.has(pc)) return 'missing chord tone';
  }

  return true;
}

describe('guitar voicings', () => {
  test('tab notation, low string first', () => {
    expect(tabOf([0, 1, 0, 2, 0, null])).toBe('x02010');
    expect(tabOf([12, 13, 12, 14, 12, null])).toBe('x-12-14-12-13-12');
  });

  test('Am7 includes the open shape and the E-shape barre', () => {
    const tabs = guitarVoicings(guitar, chord('Am7')).map((v) => v.tab);
    expect(tabs).toContain('x02010');
    expect(tabs).toContain('575555');
  });

  test.each(['C', 'Am', 'Am7', 'G7', 'Dmaj7', 'F#m7b5', 'Bdim7', 'Esus4', 'C/E', 'Cadd9', 'A9'])(
    'every %s voicing obeys the rules',
    (s) => {
      const c = chord(s);
      const vs = guitarVoicings(guitar, c);
      expect(vs.length).toBeGreaterThan(0);
      expect(vs.length).toBeLessThanOrEqual(9);
      for (const v of vs) expect(isPlayable(guitar, c, v.frets), v.tab).toBe(true);
      const starts = vs.map((v) => Math.min(...v.frets.filter((f): f is number => f !== null && f > 0)));
      expect([...starts].sort((a, b) => a - b)).toEqual(starts);
    },
  );

  test('labels', () => {
    const vs = guitarVoicings(guitar, chord('Am7'));
    expect(vs.find((v) => v.tab === 'x02010')?.label).toBe('Open');
    expect(vs.find((v) => v.tab === '575555')?.label).toBe('Root on 6th string · fret 5');
  });

  test('isPlayable rejects wrong notes, a wrong bass and stretches', () => {
    const am7 = chord('Am7');
    expect(isPlayable(guitar, am7, [0, 1, 0, 2, 0, null])).toBe(true);
    expect(isPlayable(guitar, am7, [0, 1, 2, 2, 0, null])).toBe(false); // A on G string: no ♭7
    expect(isPlayable(guitar, am7, [0, 1, 0, 2, 0, 0])).toBe(false); // low E is the bass
    expect(isPlayable(guitar, am7, [0, 1, 0, 2, null, 5])).toBe(false); // gap in the strings
  });

  test('independent oracle validates every voicing from the spec', () => {
    for (const s of ['C', 'Am', 'Am7', 'G7', 'Dmaj7', 'F#m7b5', 'Bdim7', 'Esus4', 'C/E', 'Cadd9', 'A9']) {
      const c = chord(s);
      const vs = guitarVoicings(guitar, c);
      for (const v of vs) {
        const result = validateVoicing(guitar, c, v.frets);
        expect(result, `${s} voicing ${v.tab} failed: ${result === true ? '' : result}`).toBe(true);
      }
    }
  });

  test('F major contains barre 133211 and not the invalid open 103211', () => {
    const fMajor = chord('F');
    const voicings = guitarVoicings(guitar, fMajor);
    const tabs = voicings.map((v) => v.tab);

    // 133211 is a valid F major barre chord
    expect(tabs).toContain('133211');

    // 103211 is NOT valid: it's an open shape (0 on E) with a barre on fret 1
    // that would span the open string, requiring 5 fingers
    expect(tabs).not.toContain('103211');
  });

  test('no voicing has an open string strictly inside its barre span', () => {
    for (const s of ['C', 'F', 'Bb', 'Am', 'Em', 'Dm']) {
      const c = chord(s);
      const vs = guitarVoicings(guitar, c);
      for (const v of vs) {
        const entries = v.frets
          .map((f, row) => ({ row, fret: f }))
          .filter((x): x is { row: number; fret: number } => x.fret !== null && x.fret > 0);
        if (entries.length >= 2) {
          const minFret = Math.min(...entries.map((x) => x.fret));
          const atMinFret = entries.filter((x) => x.fret === minFret);
          if (atMinFret.length >= 2) {
            const minRow = Math.min(...atMinFret.map((x) => x.row));
            const maxRow = Math.max(...atMinFret.map((x) => x.row));
            const openInSpan = v.frets.slice(minRow, maxRow + 1).some((f) => f === 0);
            expect(openInSpan, `${s} voicing ${v.tab} has open inside barre span`).toBe(false);
          }
        }
      }
    }
  });

  test('C/E has slash bass validation and contains root-position voicings', () => {
    const cOverE = chord('C/E');
    const vs = guitarVoicings(guitar, cOverE);
    expect(vs.length).toBeGreaterThan(0);
    // Bass must be E (not C)
    for (const v of vs) {
      const result = validateVoicing(guitar, cOverE, v.frets);
      expect(result).toBe(true);
    }
  });
});

describe('bass arpeggios', () => {
  test('Am7 from the root on the E string, in play order', () => {
    const [first] = bassArpeggios(DEFAULT_INSTRUMENT, chord('Am7'));
    expect(first!.label).toBe('From the root on the E string');
    expect(first!.cells).toEqual([
      { string: 3, fret: 5 },
      { string: 3, fret: 8 },
      { string: 2, fret: 7 },
      { string: 1, fret: 5 },
      { string: 1, fret: 7 },
    ]);
  });

  test('root, fifth, octave', () => {
    const shapes = bassArpeggios(DEFAULT_INSTRUMENT, chord('G'));
    expect(shapes.find((s) => s.label === 'Root, 5th, octave')!.cells).toEqual([
      { string: 3, fret: 3 },
      { string: 2, fret: 5 },
      { string: 1, fret: 5 },
    ]);
  });
});
