import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_PLAY_ALONG, songMedia } from './client';
import type { Song, SongEntry } from './client';
import { useUpdateSong } from './queries';

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const song = (tempo: number, id = 'abc123'): Song =>
  ({
    schema_version: 3,
    id,
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
    play_along: DEFAULT_PLAY_ALONG,
  }) as Song;

const songEntry = (s: Song): SongEntry =>
  ({
    dir: s.id,
    song: s,
    state: 'analyzed',
    unreadable: null,
    files: { has_audio: true, has_peaks: true, has_stems: true, has_analysis: true, has_transcription: false },
  }) as SongEntry;

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

  it('flushes a queued edit on unmount, without an explicit flush() call', async () => {
    const { result, unmount } = renderHook(() => useUpdateSong('abc123'), { wrapper });
    act(() => {
      result.current.save(song(0.42));
    });
    expect(fetch).not.toHaveBeenCalled(); // still inside the debounce window

    unmount();

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    const [, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(JSON.parse(init.body).playback.tempo).toBe(0.42);
    expect(init.method).toBe('PUT');
  });

  it("does not let a slow response for one song overwrite another song's cache row", async () => {
    // The server always echoes back whichever song it actually received --
    // this stands in for that, so the response's id tracks the queued edit.
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        const sent = JSON.parse(init.body as string) as Song;
        return new Response(JSON.stringify(songEntry(sent)), { status: 200 });
      }),
    );

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    function clientWrapper({ children }: { children: ReactNode }) {
      return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    }
    // Song B's row already exists in the cache, as it would after visiting it.
    client.setQueryData(['song', 'songB'], songEntry(song(2, 'songB')));

    const { result, rerender } = renderHook(
      ({ songId }: { songId: string }) => useUpdateSong(songId),
      { wrapper: clientWrapper, initialProps: { songId: 'songA' } },
    );

    act(() => {
      result.current.save(song(0.9, 'songA'));
    });

    // Navigate to song B before the debounce fires: the route component
    // re-renders under the new songId instead of unmounting.
    rerender({ songId: 'songB' });

    await act(async () => {
      vi.advanceTimersByTime(700);
    });

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    const [, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
    // The queued document was still song A's, sent to song A's endpoint.
    expect(JSON.parse(init.body).id).toBe('songA');

    // Song B's cache row must be untouched by A's response.
    const cachedB = client.getQueryData(['song', 'songB']) as SongEntry;
    expect(cachedB.song?.playback.tempo).toBe(2);
    const cachedA = client.getQueryData(['song', 'songA']) as SongEntry;
    expect(cachedA.song?.playback.tempo).toBe(0.9);
  });
});
