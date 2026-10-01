import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SongScope } from '../session/SongScope';
import { PlayAlong } from './PlayAlong';
import { SongScreen } from './SongScreen';
import { SongView } from './SongView';

let cursor = 0;
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
  getPositionSamples: vi.fn(() => cursor),
  dispose: vi.fn(async () => {}),
  durationSamples: 48_000 * 8,
  durationSeconds: 8,
  stemSummaries: ['vocals', 'drums', 'bass', 'other'].map((name) => ({
    name,
    envelope: Float32Array.from([0.3]),
    peak: 0.3,
    nearSilent: false,
  })),
};

vi.mock('../engine/EngineController', () => ({
  STEM_ORDER: ['vocals', 'drums', 'bass', 'other'],
  EngineController: { create: vi.fn(async () => engine) },
}));

const songEntry = {
  dir: 'abc123-test',
  state: 'analyzed',
  unreadable: null,
  files: { has_audio: true, has_peaks: true, has_stems: true, has_analysis: true },
  song: {
    schema_version: 4,
    id: 'abc123',
    title: 'Test Song',
    artist: 'Someone',
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

const analysis = {
  schema_version: 1,
  key_candidates: [{ tonic: 'G', mode: 'major', confidence: 0.6 }],
  beat_grid: {
    bpm: 120,
    beats: Array.from({ length: 16 }, (_, i) => i * 24_000),
    downbeats: Array.from({ length: 4 }, (_, i) => i * 96_000),
  },
  chords: ['G', 'C', 'D', 'G'].map((chord, bar) => ({ bar, start_sample: bar * 96_000, end_sample: (bar + 1) * 96_000, chord })),
};

function mockFetch(analysisBody: unknown = analysis) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'PUT') return new Response(String(init.body), { status: 200 });
      if (url.endsWith('/analysis')) {
        return analysisBody === 404
          ? new Response('not found', { status: 404 })
          : new Response(JSON.stringify(analysisBody), { status: 200 });
      }
      return new Response(JSON.stringify(songEntry), { status: 200 });
    }),
  );
}

function renderAt(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/songs/:songId" element={<SongScope />}>
            <Route element={<SongScreen />}>
              <Route index element={<SongView />} />
              <Route path="play" element={<PlayAlong />} />
            </Route>
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  cursor = 0;
  mockFetch();
});
afterEach(() => vi.unstubAllGlobals());

describe('SongScreen', () => {
  it('swaps Stems and Tabs content under the same transport', async () => {
    renderAt('/songs/abc123');
    expect(await screen.findByTestId('time-axis')).toBeInTheDocument();
    const play = screen.getByRole('button', { name: 'Play' });
    expect(screen.getByRole('link', { name: 'Stems' })).toHaveAttribute('aria-current', 'page');

    await userEvent.click(screen.getByRole('link', { name: 'Tabs' }));
    expect(await screen.findByTestId('neck-canvas')).toBeInTheDocument();
    expect(screen.queryByTestId('time-axis')).not.toBeInTheDocument();
    // The very same button element: the transport did not remount.
    expect(screen.getByRole('button', { name: 'Play' })).toBe(play);
    expect(screen.getByRole('link', { name: 'Tabs' })).toHaveAttribute('aria-current', 'page');

    await userEvent.click(screen.getByRole('link', { name: 'Stems' }));
    expect(await screen.findByTestId('time-axis')).toBeInTheDocument();
  });

  it('hides the Stems/Tabs switch while the stems are still loading', async () => {
    let finish: (value: typeof engine) => void = () => {};
    const { EngineController } = await import('../engine/EngineController');
    vi.mocked(EngineController.create).mockImplementationOnce(
      () => new Promise((resolve) => { finish = resolve as typeof finish; }) as never,
    );
    renderAt('/songs/abc123');
    expect(await screen.findByText('Loading stems…')).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'View' })).not.toBeInTheDocument();

    finish(engine);
    expect(await screen.findByRole('navigation', { name: 'View' })).toBeInTheDocument();
  });

  it('shows each view’s own tools beside the switch', async () => {
    renderAt('/songs/abc123');
    expect(await screen.findByRole('button', { name: 'Follow playhead' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('link', { name: 'Tabs' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Follow playhead' })).not.toBeInTheDocument());
  });

  it('has the full transport in the Tabs view: tempo, pitch, loop and practice', async () => {
    renderAt('/songs/abc123/play');
    expect(await screen.findByLabelText('Pitch')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit loop' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Practice' })).toBeInTheDocument();
    // One of each: the Tabs view no longer brings a transport of its own.
    expect(screen.getAllByLabelText('Tempo')).toHaveLength(1);
  });

  it('keeps the transport when the Tabs content has nothing to show', async () => {
    mockFetch(404);
    renderAt('/songs/abc123/play');
    expect(await screen.findByText(/needs analysis/i)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Play' })).toBeInTheDocument());
  });

  it('renames from either view', async () => {
    renderAt('/songs/abc123/play');
    await userEvent.click(await screen.findByRole('button', { name: 'Rename' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Title' }), ' 2{Enter}');
    expect(await screen.findByRole('heading', { name: 'Test Song 2' })).toBeInTheDocument();
  });
});
