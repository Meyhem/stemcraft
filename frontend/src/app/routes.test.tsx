import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, expect, test, vi } from 'vitest';

import { AppRoutes } from './routes';

// The Song view builds a real playback engine, which needs Web Audio: jsdom has
// none, and @soundtouchjs' `class SoundTouchNode extends AudioWorkletNode` throws
// on import alone. This is a routing smoke test -- that each path renders its
// screen -- so the engine is replaced with the smallest stub the screen reads.
vi.mock('../engine/EngineController', () => ({
  STEM_ORDER: ['vocals', 'drums', 'bass', 'other'],
  EngineController: {
    create: async () => ({
      play: vi.fn(),
      pause: vi.fn(),
      seek: vi.fn(),
      setLoop: vi.fn(),
      setTempo: vi.fn(),
      setPitchSemitones: vi.fn(),
      setStemGain: vi.fn(),
      setMetronome: vi.fn(),
      setGrid: vi.fn(),
      countInAndPlay: vi.fn(),
      onEnded: () => () => {},
      getPositionSamples: () => 0,
      dispose: vi.fn(),
      durationSamples: 48_000,
      durationSeconds: 1,
      stemSummaries: [],
    }),
  },
}));

// A realistic song entry for the song-scoped routes (/songs/01ABC, .../scale,
// .../export), the same way ScaleSheet.test.tsx and Library.test.tsx mock
// /api/songs -- a generic "same JSON for every URL" mock left the song lookup
// inside those screens resolving to nothing, which masked how they actually
// render with real data.
const song = {
  schema_version: 2,
  id: '01ABC',
  title: 'Tightrope',
  artist: 'Someone',
  source: { kind: 'upload', value: 'original.mp3' },
  created_at: '2026-01-01T00:00:00Z',
  last_played_at: null,
  mix: {},
  playback: { tempo: 1, pitch_semitones: 0 },
  loops: [],
  active_loop: null,
  metronome: false,
  count_in_bars: 0,
};

const songEntry = {
  dir: `${song.id}-tightrope`,
  song,
  state: 'analyzed',
  unreadable: null,
  files: { has_audio: true, has_peaks: true, has_stems: true, has_analysis: true },
};

const health = { deps: [], device: null, fallback_reason: null, sample_rate: 48000 };

function renderAt(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <AppRoutes />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url === '/api/songs') return new Response(JSON.stringify({ songs: [songEntry] }));
      if (url === '/api/songs/01ABC') return new Response(JSON.stringify(songEntry));
      // Not analyzed in this fixture's sense that matters here -- the smoke
      // test only checks that each route renders its screen, not analysis
      // content, so a 404 (the "not analyzed yet" case) is a fine default.
      if (url === '/api/songs/01ABC/analysis') {
        return new Response('song 01ABC has no analysis yet', { status: 404 });
      }
      return new Response(JSON.stringify(health));
    }),
  );
});

test('the library is the index route', async () => {
  renderAt('/');
  expect(await screen.findByRole('heading', { name: /library/i })).toBeInTheDocument();
});

test.each([
  ['/import', /import/i],
  ['/jobs', /job queue/i],
  ['/splitter', /album splitter/i],
  // The Song view's heading is the song's own title (UI spec §6, screen 3).
  ['/songs/01ABC', /tightrope/i],
  ['/songs/01ABC/scale', /scale/i],
  // Exact match: the screen also has an "Exports" h2 for past files (Task 6),
  // which /export/i would ambiguously match too.
  ['/songs/01ABC/export', /^export$/i],
])('%s renders its screen', async (path, heading) => {
  renderAt(path);
  expect(await screen.findByRole('heading', { name: heading })).toBeInTheDocument();
});

test('an unknown path shows a not-found screen rather than a blank page', async () => {
  renderAt('/nope');
  expect(await screen.findByText(/not found/i)).toBeInTheDocument();
});

test('running separation on cpu shows a fallback banner naming the reason', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            deps: [],
            device: 'cpu',
            fallback_reason: 'no cuda device found',
            sample_rate: 48000,
          }),
        ),
    ),
  );
  renderAt('/');
  const banner = await screen.findByText(/running separation on cpu/i);
  expect(banner.textContent).toMatch(/no cuda device found/i);
});
