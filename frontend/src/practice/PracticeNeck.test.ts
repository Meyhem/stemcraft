import { expect, test } from 'vitest';

import { DEFAULT_INSTRUMENT_SETTINGS } from '../api/client';
import { generate } from '../music/practice/generate';
import { hotIndex, neckBarsOf } from './PracticeNeck';

test('one neck bar per loop bar, notes in order; drills show the finger', () => {
  const groove = generate('bass', DEFAULT_INSTRUMENT_SETTINGS);
  if (!groove.ok) throw new Error(groove.error);
  const bars = neckBarsOf(groove.loop);
  expect(bars).toHaveLength(4);
  // The fourth note is the approach into D: from below or above, as the seed's coin fell.
  expect(bars[0]!.notes.slice(0, 3).map((n) => n.name)).toEqual(['G', 'D', 'G']);
  expect(bars[0]!.notes[3]!.approach).toBe(true);
  expect(hotIndex(groove.loop, 0, 2.5)).toBe(2);
  expect(hotIndex(groove.loop, 1, 4.0)).toBe(0);

  const drill = generate('bass', { ...DEFAULT_INSTRUMENT_SETTINGS, exercise: 'drill' });
  if (!drill.ok) throw new Error(drill.error);
  expect(neckBarsOf(drill.loop)[0]!.notes.map((n) => n.name)).toEqual(['1', '2', '3', '4', '1', '2', '3', '4']);
});
