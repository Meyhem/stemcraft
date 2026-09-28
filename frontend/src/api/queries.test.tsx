import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { songMedia } from './client';
import type { Song } from './client';
import { useUpdateSong } from './queries';

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const song = (tempo: number): Song =>
  ({
    schema_version: 2,
    id: 'abc123',
    title: 'T',
    artist: '',
    source: { kind: 'upload', value: 'original.mp3' },
    created_at: '2026-09-28T00:00:00+00:00',
    last_played_at: null,
    mix: {},
    playback: { tempo, pitch_semitones: 0 },
    loops: [],
    active_loop: null,
    metronome: false,
    count_in_bars: 0,
  }) as Song;

describe('songMedia', () => {
  it('builds same-origin relative media paths', () => {
    const media = songMedia('abc123');
    expect(media.stem('bass')).toBe('/api/songs/abc123/stems/bass.opus');
    expect(media.peaks).toBe('/api/songs/abc123/peaks');
  });
});

describe('useUpdateSong', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // @testing-library/dom's `waitFor` only recognizes fake timers via a
    // global `jest`, which Vitest doesn't provide (testing-library/dom#943).
    // Without this shim `waitFor` falls back to a real `setInterval`, which
    // never fires under `vi.useFakeTimers()` and the test hangs to its real
    // 5s timeout instead of failing informatively.
    vi.stubGlobal('jest', { advanceTimersByTime: vi.advanceTimersByTime.bind(vi) });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ song: song(1) }), { status: 200 })),
    );
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('coalesces a burst of edits into one PUT', async () => {
    const { result } = renderHook(() => useUpdateSong('abc123'), { wrapper });

    act(() => {
      result.current.save(song(0.9));
      result.current.save(song(0.8));
      result.current.save(song(0.7));
    });
    expect(fetch).not.toHaveBeenCalled(); // still inside the debounce window

    await act(async () => {
      vi.advanceTimersByTime(700);
    });

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    const [, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
    // The last edit wins -- a dragged slider must not send its whole trail.
    expect(JSON.parse(init.body).playback.tempo).toBe(0.7);
    expect(init.method).toBe('PUT');
  });

  it('flush() sends immediately, for unmount and for navigation away', async () => {
    const { result } = renderHook(() => useUpdateSong('abc123'), { wrapper });
    act(() => {
      result.current.save(song(0.5));
      result.current.flush();
    });
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
  });
});
