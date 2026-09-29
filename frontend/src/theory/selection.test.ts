import { expect, test } from 'vitest';

import { DEFAULT_SELECTION, parseSelection, selectionParams } from './selection';

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
