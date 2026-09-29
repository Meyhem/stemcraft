import { expect, test } from 'vitest';

import { DEFAULT_SELECTION, parseSelection, patchSelection, selectionParams } from './selection';

test('empty query string is the default selection', () => {
  expect(parseSelection(new URLSearchParams())).toEqual(DEFAULT_SELECTION);
});

test('round trip writes only what differs from the defaults', () => {
  const sel = { ...DEFAULT_SELECTION, root: 'A', scale: 'minor-pentatonic' as const, mode: 'minor' as const };
  const params = selectionParams(sel);
  expect(params.toString()).toBe('root=A&scale=minor-pentatonic');
  expect(parseSelection(params)).toEqual(sel);
});

test("mode defaults to the scale's own and is written only when it differs", () => {
  expect(parseSelection(new URLSearchParams('scale=dorian')).mode).toBe('minor');
  const sel = { ...DEFAULT_SELECTION, mode: 'minor' as const };
  expect(selectionParams(sel).toString()).toBe('mode=minor');
});

test('chord, bass and notes', () => {
  const sel = parseSelection(new URLSearchParams('chord=Am7%2FG&bass=G&notes=4,7,7,13'));
  expect(sel.chord).toBe('Am7/G');
  expect(sel.bass).toBe('G');
  expect(sel.notes).toEqual([4, 7]);
});

test('values no tool knows read as defaults', () => {
  const sel = parseSelection(new URLSearchParams('root=H&scale=bebop&q=13&mode=lydian'));
  expect(sel.root).toBe('C');
  expect(sel.scale).toBe('major');
  expect(sel.quality).toBe('maj');
  expect(sel.mode).toBe('major');
});

test('a new root drops a chord and bass the patch does not set; the same pitch or a chord of its own keeps them', () => {
  const am7 = { ...DEFAULT_SELECTION, root: 'A', chord: 'Am7', bass: 'G' };
  expect(patchSelection(am7, { root: 'E' })).toMatchObject({ root: 'E', chord: null, bass: null });
  expect(patchSelection(am7, { root: 'A', scale: 'minor' })).toMatchObject({ root: 'A', chord: 'Am7', bass: 'G' });
  expect(patchSelection({ ...am7, root: 'A#', chord: 'A#m7' }, { root: 'Bb' })).toMatchObject({ root: 'Bb', chord: 'A#m7' });
  expect(patchSelection(am7, { root: 'E', chord: 'Em' })).toMatchObject({ root: 'E', chord: 'Em', bass: null });
  expect(patchSelection(am7, { root: 'E', bass: 'B' })).toMatchObject({ root: 'E', chord: null, bass: 'B' });
  expect(patchSelection(am7, { scale: 'dorian' })).toMatchObject({ root: 'A', chord: 'Am7', bass: 'G' });
});
