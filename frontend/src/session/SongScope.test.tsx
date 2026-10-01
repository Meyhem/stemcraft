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
  files: { has_audio: true, has_peaks: true, has_stems: true, has_analysis: false, has_transcription: false },
  song: {
    schema_version: 4,
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
    play_along: {
      key: null,
      instrument: 'bass',
      pattern: { notes: 'triad_chord', rhythm: 'quarter', approach: 'none' },
      guitar: { style: 'open', strum: 'folk', position: 'auto', simplify: false },
    },
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

function PlayProbe({ name }: { name: string }) {
  const session = useSongSession();
  return (
    <>
      <p>
        {name}: {session.playing ? 'playing' : 'paused'}
      </p>
      <p>{session.engine ? 'engine ready' : 'no engine'}</p>
      <button onClick={() => session.onPlayPause()}>toggle</button>
    </>
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

  it('keeps playback alive across screen switches', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/songs/abc123']}>
          <Nav />
          <Routes>
            <Route path="/songs/:songId" element={<SongScope />}>
              <Route index element={<PlayProbe name="view" />} />
              <Route path="play" element={<PlayProbe name="play" />} />
            </Route>
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    // The click is a silent no-op until the engine exists.
    await screen.findByText('engine ready');
    // Start playback on the view screen
    await userEvent.click(await screen.findByRole('button', { name: 'toggle' }));
    expect(await screen.findByText('view: playing')).toBeInTheDocument();

    // Navigate to play screen
    await userEvent.click(screen.getByRole('button', { name: 'to play' }));
    expect(await screen.findByText('play: playing')).toBeInTheDocument();

    // Verify pause was not called during navigation
    expect(engine.pause).not.toHaveBeenCalled();
  });
});

function Controls() {
  const session = useSongSession();
  return (
    <>
      <p>loop: {session.song?.active_loop ? `${session.song.active_loop.start_bar}-${session.song.active_loop.end_bar}` : 'none'}</p>
      <p>{session.song && session.engine ? 'controls ready' : 'controls loading'}</p>
      <p>notes: {session.song?.play_along.pattern.notes}</p>
      <button onClick={() => session.onLoopBars(4, 8)}>loop 5 to 8</button>
      <button onClick={() => session.onLoopBars(8, 8)}>empty loop</button>
      <button
        onClick={() =>
          session.song &&
          session.onPlayAlongChange({ ...session.song.play_along, pattern: { ...session.song.play_along.pattern, notes: 'root' } })
        }
      >
        roots
      </button>
    </>
  );
}

describe('play-along session handlers', () => {
  function renderControls() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/songs/abc123/play']}>
          <Routes>
            <Route path="/songs/:songId" element={<SongScope />}>
              <Route path="play" element={<Controls />} />
            </Route>
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
  }

  it('sets the loop by bars and saves it, and ignores an empty range', async () => {
    renderControls();
    await screen.findByText('controls ready');
    await userEvent.click(screen.getByRole('button', { name: 'loop 5 to 8' }));
    expect(await screen.findByText('loop: 4-8')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'empty loop' }));
    expect(screen.getByText('loop: 4-8')).toBeInTheDocument();
    await waitFor(
      () => {
        const put = vi.mocked(fetch).mock.calls.find(([, init]) => init?.method === 'PUT');
        expect(JSON.parse(String(put![1]!.body)).active_loop).toEqual({ name: '', start_bar: 4, end_bar: 8 });
      },
      { timeout: 3000 },
    );
  });

  it('replaces the play_along recipe', async () => {
    renderControls();
    await screen.findByText('controls ready');
    await userEvent.click(screen.getByRole('button', { name: 'roots' }));
    expect(await screen.findByText('notes: root')).toBeInTheDocument();
  });
});
