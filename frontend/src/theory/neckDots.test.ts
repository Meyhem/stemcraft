import { expect, test } from 'vitest';

import { scaleNotes } from '../music/spell';
import { DEFAULT_INSTRUMENT } from '../music/tuning';
import { noteDots } from './neckDots';

const amp = scaleNotes('A', 'minor-pentatonic');

test('labels by note, interval and degree; the root is marked', () => {
  const at = (labels: 'note' | 'interval' | 'degree') =>
    noteDots(DEFAULT_INSTRUMENT, amp, { lo: 5, hi: 5, labels }).map((d) => `${d.string}:${d.label}:${d.marker}`);
  expect(at('note')).toEqual(['0:C:tone', '1:G:tone', '2:D:tone', '3:A:root']);
  expect(at('interval')).toEqual(['0:♭3:tone', '1:♭7:tone', '2:4:tone', '3:R:root']);
  expect(at('degree')).toEqual(['0:2:tone', '1:5:tone', '2:3:tone', '3:1:root']);
});

test('dots outside the window are dimmed, not dropped', () => {
  const dots = noteDots(DEFAULT_INSTRUMENT, amp, { lo: 0, hi: 12, labels: 'none', window: { lo: 5, hi: 8 } });
  expect(dots.filter((d) => !d.dim).every((d) => d.fret >= 5 && d.fret <= 8)).toBe(true);
  expect(dots.some((d) => d.dim)).toBe(true);
  expect(dots.every((d) => d.label === '')).toBe(true);
});
