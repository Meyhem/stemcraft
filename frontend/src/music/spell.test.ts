import { describe, expect, test } from 'vitest';

import {
  analysisChordSymbol,
  ascii,
  chordHomes,
  chordInfo,
  chordSymbol,
  fitsOver,
  intervalLabel,
  keyChords,
  keyAccidentalCount,
  keySignature,
  namer,
  pretty,
  relativeKey,
  rootName,
  sameNotes,
  scaleNotes,
  SCALES,
} from './spell';

const names = (xs: { name: string }[]) => xs.map((x) => x.name);
const ivls = (xs: { interval: string }[]) => xs.map((x) => x.interval);

describe('display', () => {
  test.each([
    ['Bb', 'B♭'],
    ['F#', 'F♯'],
    ['Bbb', 'B𝄫'],
    ['F##', 'F𝄪'],
    ['Bbm7b5', 'B♭m7♭5'],
    ['C7#9', 'C7♯9'],
    ['Cadd9', 'Cadd9'],
  ])('pretty(%s) = %s', (input, out) => expect(pretty(input)).toBe(out));

  test.each([
    ['B♭m7♭5', 'Bbm7b5'],
    ['  c♯m ', 'C#m'],
    ['am7', 'Am7'],
  ])('ascii(%s) = %s', (input, out) => expect(ascii(input)).toBe(out));

  test.each([
    ['1P', 'R'],
    ['3m', '♭3'],
    ['3M', '3'],
    ['5d', '♭5'],
    ['5A', '♯5'],
    ['7d', '𝄫7'],
    ['7m', '♭7'],
    ['4A', '♯4'],
    ['9M', '9'],
    ['8P', 'R'],
  ])('intervalLabel(%s) = %s', (input, out) => expect(intervalLabel(input)).toBe(out));

  test('rootName picks the spelling with fewer accidentals per mode', () => {
    expect(rootName(1, 'major')).toBe('Db');
    expect(rootName(1, 'minor')).toBe('C#');
    expect(rootName(6, 'major')).toBe('F#');
    expect(rootName(8, 'minor')).toBe('G#');
    expect(rootName(10, 'minor')).toBe('Bb');
  });

  test('namer reuses the context spelling and falls back by accidental family', () => {
    const inF = namer(['F', 'G', 'A', 'Bb', 'C', 'D', 'E']);
    expect(inF(10)).toBe('Bb');
    expect(inF(1)).toBe('Db');
    const inG = namer(['G', 'A', 'B', 'C', 'D', 'E', 'F#']);
    expect(inG(6)).toBe('F#');
    expect(inG(1)).toBe('C#');
  });
});

describe('scales', () => {
  test('every scale in SCALES resolves to notes', () => {
    for (const s of SCALES) expect(scaleNotes('C', s.id).length, s.id).toBeGreaterThanOrEqual(5);
  });

  test('letter-correct spelling', () => {
    expect(names(scaleNotes('D', 'harmonic-minor'))).toEqual(['D', 'E', 'F', 'G', 'A', 'Bb', 'C#']);
    expect(names(scaleNotes('E', 'major'))).toEqual(['E', 'F#', 'G#', 'A', 'B', 'C#', 'D#']);
    expect(names(scaleNotes('A', 'minor-pentatonic'))).toEqual(['A', 'C', 'D', 'E', 'G']);
  });

  test('intervals relative to the root', () => {
    expect(ivls(scaleNotes('A', 'minor-pentatonic'))).toEqual(['R', '♭3', '4', '5', '♭7']);
    expect(ivls(scaleNotes('C', 'blues'))).toEqual(['R', '♭3', '4', '♭5', '5', '♭7']);
  });

  test('fitsOver lists only triads wholly inside the scale', () => {
    expect(fitsOver('A', 'minor-pentatonic')).toEqual(['Am', 'C']);
    expect(fitsOver('A', 'minor')).toEqual(['Am', 'Bdim', 'C', 'Dm', 'Em', 'F', 'G']);
  });

  test('sameNotes finds relatives and modes with the same notes', () => {
    expect(sameNotes('A', 'minor-pentatonic')).toEqual(['C major pentatonic']);
    expect(sameNotes('A', 'minor')).toEqual([
      'C major',
      'D dorian',
      'E phrygian',
      'F lydian',
      'G mixolydian',
      'B locrian',
    ]);
  });
});

describe('chords', () => {
  test('spells and labels chord tones', () => {
    const r = chordInfo('F#m7b5');
    expect(r.ok && names(r.chord.notes)).toEqual(['F#', 'A', 'C', 'E']);
    expect(r.ok && ivls(r.chord.notes)).toEqual(['R', '♭3', '♭5', '♭7']);
    const d = chordInfo('Cdim7');
    expect(d.ok && names(d.chord.notes)).toEqual(['C', 'Eb', 'Gb', 'Bbb']);
    expect(d.ok && ivls(d.chord.notes)).toEqual(['R', '♭3', '♭5', '𝄫7']);
  });

  test('accepts pretty and lowercase input', () => {
    const r = chordInfo('b♭maj7');
    expect(r.ok && r.chord.symbol).toBe('Bbmaj7');
    expect(r.ok && names(r.chord.notes)).toEqual(['Bb', 'D', 'F', 'A']);
  });

  test('slash chords keep the bass; a bass outside the chord is extra', () => {
    const ce = chordInfo('C/E');
    expect(ce.ok && ce.chord.bass).toBe('E');
    expect(ce.ok && ce.chord.extraBass).toBeNull();
    const cbb = chordInfo('C/Bb');
    expect(cbb.ok && cbb.chord.extraBass?.name).toBe('Bb');
    expect(cbb.ok && cbb.chord.extraBass?.interval).toBe('♭7');
  });

  test('never guesses', () => {
    expect(chordInfo('Cmaj13#11b9')).toEqual({ ok: false, reason: 'Don\'t know "Cmaj13#11b9"' });
    expect(chordInfo('Hm7').ok).toBe(false);
    expect(chordInfo('C/X').ok).toBe(false);
    expect(chordInfo('').ok).toBe(false);
  });

  test('chordSymbol builds from root, quality and bass', () => {
    expect(chordSymbol('A', 'm7')).toBe('Am7');
    expect(chordSymbol('C', 'maj', 'E')).toBe('C/E');
    expect(chordSymbol('F#', 'm7b5')).toBe('F#m7b5');
  });

  test('analysis labels become symbols spelled by the context', () => {
    const flat = namer(['Bb']);
    expect(analysisChordSymbol('A#:hdim7', flat)).toBe('Bbm7b5');
    expect(analysisChordSymbol('G:min', flat)).toBe('Gm');
    expect(analysisChordSymbol('C', flat)).toBe('C');
    expect(analysisChordSymbol('C:maj/3', flat)).toBe('C/E');
    expect(analysisChordSymbol('N', flat)).toBeNull();
    expect(analysisChordSymbol('X', flat)).toBeNull();
    expect(analysisChordSymbol('C:weird', flat)).toBeNull();
  });

  test.each([
    ['C:minmaj7', 'CmMaj7'],
    ['C:min6', 'Cm6'],
    ['C:maj6', 'C6'],
    ['C:aug', 'Caug'],
    ['C:sus2', 'Csus2'],
    ['C:sus4', 'Csus4'],
  ])('analysis quality %s is spelled %s', (label, symbol) => {
    expect(analysisChordSymbol(label, namer(['C']))).toBe(symbol);
  });

  test('chordHomes names the major keys a chord is diatonic to', () => {
    const r = chordInfo('Am7');
    expect(r.ok && chordHomes(r.chord)).toEqual(['vi7 in C major', 'iii7 in F major', 'ii7 in G major']);
    const d = chordInfo('D');
    expect(d.ok && chordHomes(d.chord)).toEqual(['I in D major', 'V in G major', 'IV in A major']);
  });
});

describe('keys', () => {
  test('major key chords with numerals and function', () => {
    expect(keyChords('G', 'major', 'triads')).toEqual([
      { numeral: 'I', symbol: 'G', fn: 'home' },
      { numeral: 'ii', symbol: 'Am', fn: 'sub' },
      { numeral: 'iii', symbol: 'Bm', fn: 'home' },
      { numeral: 'IV', symbol: 'C', fn: 'sub' },
      { numeral: 'V', symbol: 'D', fn: 'tension' },
      { numeral: 'vi', symbol: 'Em', fn: 'home' },
      { numeral: 'vii°', symbol: 'F#dim', fn: 'tension' },
    ]);
    expect(keyChords('G', 'major', 'sevenths').map((c) => c.symbol)).toEqual([
      'Gmaj7', 'Am7', 'Bm7', 'Cmaj7', 'D7', 'Em7', 'F#m7b5',
    ]);
  });

  test('minor key chords', () => {
    expect(keyChords('E', 'minor', 'triads').map((c) => `${c.numeral}:${c.symbol}`)).toEqual([
      'i:Em', 'ii°:F#dim', 'III:G', 'iv:Am', 'v:Bm', 'VI:C', 'VII:D',
    ]);
  });

  test('key signatures and relatives', () => {
    expect(keySignature('G', 'major')).toEqual({ accidentals: ['F#'], sharps: true });
    expect(keySignature('A', 'minor')).toEqual({ accidentals: [], sharps: false });
    expect(keySignature('Eb', 'major')).toEqual({ accidentals: ['Bb', 'Eb', 'Ab'], sharps: false });
    expect(keySignature('G', 'minor').accidentals).toEqual(['Bb', 'Eb']);
    expect(relativeKey('G', 'major')).toEqual({ root: 'E', mode: 'minor' });
    expect(relativeKey('E', 'minor')).toEqual({ root: 'G', mode: 'major' });
  });

  test('the accidental count is not capped at seven', () => {
    expect(keyAccidentalCount('C', 'major')).toBe(0);
    expect(keyAccidentalCount('C#', 'major')).toBe(7);
    expect(keyAccidentalCount('D#', 'major')).toBe(9);
    expect(keyAccidentalCount('Gb', 'minor')).toBe(9);
    expect(keyAccidentalCount('D#', 'minor')).toBe(6);
  });
});
