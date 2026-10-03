import { act, renderHook } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';

import type { StemChannels } from '../engine/loopCursor';
import { fakeEngine } from './tools/testing';
import { guessEngine, useGuessSound } from './useGuessSound';

afterEach(() => vi.restoreAllMocks());

const stems = (n = 4): StemChannels[] => Array.from({ length: 4 }, () => ({ left: new Float32Array(n), right: new Float32Array(n) }));

test('the first play creates the engine with those stems; later plays swap stems into the same engine', async () => {
  const e = fakeEngine();
  const create = vi.spyOn(guessEngine, 'create').mockResolvedValue(e);
  const { result } = renderHook(() => useGuessSound());
  const first = stems(1);
  await act(() => result.current.play(first));
  expect(create).toHaveBeenCalledWith(first);
  expect(e.replaceStems).not.toHaveBeenCalled();
  expect(e.play).toHaveBeenCalledTimes(1);
  expect(result.current.playing).toBe(true);
  const second = stems(2);
  await act(() => result.current.play(second));
  expect(create).toHaveBeenCalledTimes(1);
  expect(e.replaceStems).toHaveBeenCalledWith(second);
  expect(e.play).toHaveBeenCalledTimes(2);
});

test('the engine ending stops "playing"; replay plays the same stems from the top', async () => {
  const e = fakeEngine();
  vi.spyOn(guessEngine, 'create').mockResolvedValue(e);
  const { result } = renderHook(() => useGuessSound());
  await act(() => result.current.play(stems()));
  act(() => e.end());
  expect(result.current.playing).toBe(false);
  await act(() => result.current.replay());
  expect(e.seek).toHaveBeenLastCalledWith(0);
  expect(e.replaceStems).not.toHaveBeenCalled();
  expect(result.current.playing).toBe(true);
});

test('an engine that cannot start is the error, word for word, and a later play tries again', async () => {
  vi.spyOn(guessEngine, 'create').mockRejectedValueOnce(new Error("The browser's audio runs at 44100 Hz"));
  const { result } = renderHook(() => useGuessSound());
  await act(() => result.current.play(stems()));
  expect(result.current.error).toBe("The browser's audio runs at 44100 Hz");
  expect(result.current.playing).toBe(false);
  const e = fakeEngine();
  vi.spyOn(guessEngine, 'create').mockResolvedValue(e);
  await act(() => result.current.play(stems()));
  expect(result.current.error).toBeNull();
});

test('leaving the tool disposes the engine', async () => {
  const e = fakeEngine();
  vi.spyOn(guessEngine, 'create').mockResolvedValue(e);
  const { result, unmount } = renderHook(() => useGuessSound());
  await act(() => result.current.play(stems()));
  unmount();
  expect(e.dispose).toHaveBeenCalled();
});
