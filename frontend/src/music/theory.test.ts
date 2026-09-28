import { expect, test } from 'vitest';

import {
  BASS_TUNING,
  GUITAR_TUNING,
  noteAtFret,
  noteName,
  pitchClassOf,
  scaleNoteNames,
  scaleSemitones,
} from './theory';

test('pitchClassOf resolves both sharp and flat spellings to the same class', () => {
  expect(pitchClassOf('G')).toBe(7);
  expect(pitchClassOf('A#')).toBe(10);
  expect(pitchClassOf('Bb')).toBe(10);
});

test('G natural minor is spelled with a flat family (relative major: Bb)', () => {
  expect(scaleNoteNames(pitchClassOf('G'), 'minor')).toEqual([
    'G', 'A', 'Bb', 'C', 'D', 'Eb', 'F',
  ]);
});

test('E natural minor is spelled with a sharp family (relative major: G)', () => {
  expect(scaleNoteNames(pitchClassOf('E'), 'minor')).toEqual([
    'E', 'F#', 'G', 'A', 'B', 'C', 'D',
  ]);
});

test('C major has no accidentals', () => {
  expect(scaleNoteNames(pitchClassOf('C'), 'major')).toEqual([
    'C', 'D', 'E', 'F', 'G', 'A', 'B',
  ]);
});

test('pentatonic scales are a 5-note subset in the same key', () => {
  expect(scaleNoteNames(pitchClassOf('G'), 'minor', true)).toEqual(['G', 'Bb', 'C', 'D', 'F']);
});

test('scaleSemitones: minor pentatonic is root, b3, 4, 5, b7', () => {
  expect(scaleSemitones('minor', true)).toEqual([0, 3, 5, 7, 10]);
});

test('noteAtFret walks up in semitones from the open string', () => {
  const tonic = pitchClassOf('G');
  expect(noteAtFret(pitchClassOf('E'), 0, tonic, 'minor')).toBe('E');
  expect(noteAtFret(pitchClassOf('E'), 3, tonic, 'minor')).toBe('G');
});

test('standard tunings are 4 and 6 strings, low to high', () => {
  expect(BASS_TUNING).toEqual(['E', 'A', 'D', 'G']);
  expect(GUITAR_TUNING).toEqual(['E', 'A', 'D', 'G', 'B', 'E']);
});

test('noteName throws on an unknown name via pitchClassOf', () => {
  expect(() => pitchClassOf('H')).toThrow();
});
