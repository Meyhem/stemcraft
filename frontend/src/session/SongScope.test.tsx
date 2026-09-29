// frontend/src/session/SongScope.test.tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, renderHook, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SongScope } from './SongScope';
import { useSongSession } from './SongSession';

const engine = {
  play: vi.fn(async () => {}),
  pause: vi.fn(),
  seek: vi.fn(),
  setLoop: vi.fn(),
  setTempo: vi.fn(),
  setPitchSemitones: vi.fn(),
  setStemGain: vi.fn(),
  setMetronome: vi.fn(),
  setGrid: vi.fn(),
  countInAndPlay: vi.fn(async () => {}),
  onEnded: vi.fn(() => () => {}),
  getPositionSamples: vi.fn(() => 0),
  dispose: vi.fn(async () => {}),
  durationSamples: 48_000 * 8,
  durationSeconds: 8,
  stemSummaries: [],
};

vi.mock('../engine/EngineController', () => ({
  STEM_ORDER: ['vocals', 'drums', 'bass', 'other'],
  EngineController: { create: vi.fn(async () => engine) },
}));

import { EngineController } from '../engine/EngineController';

const songEntry = {
  dir: 'abc123-test',
  state: 'separated',
  unreadable: null,
  files: { has_audio: true, has_peaks: true, has_stems: true, has_analysis: false },
  song: {
    schema_version: 3,
    id: 'abc123',
    title: 'Test Song',
    artist: '',
    source: { kind: 'upload', value: 'original.mp3' },
    created_at: '2026-09-29T00:00:00+00:00',
    last_played_at: null,
    mix: {},
    playback: { tempo: 1, pitch_semitones: 0 },
    loops: [],
    active_loop: null,
    metronome: false,
    count_in_bars: 0,
    play_along: { key: null, pattern: { notes: 'triad_chord', rhythm: 'quarter', approach: 'none' } },
  },
};

function Probe({ name }: { name: string }) {
  const session = useSongSession();
  return (
    <p>
      {name}: {session.engine ? 'engine ready' : 'no engine'}
    </p>
  );
}

function Nav() {
  const navigate = useNavigate();
  return (
    <>
      <button onClick={() => navigate('/songs/abc123')}>to view</button>
      <button onClick={() => navigate('/songs/abc123/play')}>to play</button>
      <button onClick={() => navigate('/')}>to library</button>
    </>
  );
}

function renderScope(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Nav />
        <Routes>
          <Route path="/" element={<p>library</p>} />
          <Route path="/songs/:songId" element={<SongScope />}>
            <Route index element={<Probe name="view" />} />
            <Route path="play" element={<Probe name="play" />} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) =>
      url.endsWith('/analysis')
        ? new Response('not found', { status: 404 })
        : new Response(JSON.stringify(songEntry), { status: 200 }),
    ),
  );
});
afterEach(() => vi.unstubAllGlobals());

describe('SongScope', () => {
  it('keeps one engine across Song view and Play along, and disposes it on leaving the song', async () => {
    renderScope('/songs/abc123');
    expect(await screen.findByText('view: engine ready')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'to play' }));
    expect(await screen.findByText('play: engine ready')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'to view' }));
    expect(await screen.findByText('view: engine ready')).toBeInTheDocument();

    expect(EngineController.create).toHaveBeenCalledTimes(1);
    expect(engine.dispose).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: 'to library' }));
    await waitFor(() => expect(engine.dispose).toHaveBeenCalledTimes(1));
  });

  it('refuses to be used outside a scope', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => renderHook(() => useSongSession())).toThrow(/SongScope/);
    spy.mockRestore();
  });
});
