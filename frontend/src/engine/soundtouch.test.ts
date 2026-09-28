import { expect, test } from 'vitest';

import { computeSoundTouchParams } from './soundtouch';

test('computeSoundTouchParams with tempo change and no pitch shift', () => {
  const result = computeSoundTouchParams(0.7, 0);
  expect(result).toEqual({
    playbackRate: 0.7,
    pitch: 1.0,
    pitchSemitones: 0,
  });
});

test('computeSoundTouchParams with pitch shift and no tempo change', () => {
  const result = computeSoundTouchParams(1.0, -3);
  expect(result).toEqual({
    playbackRate: 1.0,
    pitch: 1.0,
    pitchSemitones: -3,
  });
});
