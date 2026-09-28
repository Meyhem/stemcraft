import { expect, test } from 'vitest';

import { proposeExportName } from './exportName';

const RECIPE = { tempo: 0.82, pitchSemitones: -2 };
const NEUTRAL = { tempo: 1, pitchSemitones: 0 };

test('all four stems at original tempo is just the title', () => {
  expect(proposeExportName('Tightrope', ['vocals', 'drums', 'bass', 'other'], NEUTRAL)).toBe(
    'tightrope',
  );
});

test('one stem excluded reads as "no-<stem>"', () => {
  // The mockup's own example name.
  expect(proposeExportName('Tightrope', ['vocals', 'drums', 'other'], RECIPE)).toBe(
    'tightrope-no-bass-82-2st',
  );
});

test('a single stem reads as "<stem>-only"', () => {
  expect(proposeExportName('Tightrope', ['bass'], NEUTRAL)).toBe('tightrope-bass-only');
});

test('two stems are listed in canonical order, whatever order they were ticked', () => {
  expect(proposeExportName('Tightrope', ['other', 'vocals'], NEUTRAL)).toBe(
    'tightrope-vocals-other',
  );
});

test('tempo appears as a percentage and only when it is not 100', () => {
  expect(proposeExportName('Tightrope', ['bass'], { tempo: 0.7, pitchSemitones: 0 })).toBe(
    'tightrope-bass-only-70',
  );
  expect(proposeExportName('Tightrope', ['bass'], { tempo: 1, pitchSemitones: 0 })).toBe(
    'tightrope-bass-only',
  );
});

test('an upward pitch shift is signed', () => {
  expect(proposeExportName('Tightrope', ['bass'], { tempo: 1, pitchSemitones: 3 })).toBe(
    'tightrope-bass-only-plus3st',
  );
});

test('a title that slugifies to nothing still yields a usable name', () => {
  expect(proposeExportName('   ///   ', ['bass'], NEUTRAL)).toBe('export-bass-only');
});

test('accents and punctuation are reduced to the slug alphabet the API accepts', () => {
  expect(proposeExportName('Dvořák — Symphony No. 9', ['other'], NEUTRAL)).toBe(
    'dvorak-symphony-no-9-other-only',
  );
});
