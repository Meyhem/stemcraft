// frontend/src/screens/PlayAlong.test.tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SongScope } from '../session/SongScope';
import { SongScreen } from './SongScreen';
import { PlayAlong } from './PlayAlong';
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
  files: { has_audio: true, has_peaks: true, has_stems: true, has_analysis: true, has_transcription: false },
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

describe('PlayAlong', () => {
  it('shows the neck for the bar under the playhead', async () => {
    renderAt('/songs/abc123/play');
    const neck = await screen.findByTestId('neck-canvas');
    await waitFor(() => expect(neck.getAttribute('aria-label')).toBe('Bar 1, G: G B D B. Next: Bar 2, C: C E G E'));
    expect(screen.getByRole('heading', { name: 'Test Song' })).toBeInTheDocument();
    expect(screen.getByText(/not a transcription/i)).toBeInTheDocument();
  });

  it('shows the guitar neck, a strum lane and the other-stem note in guitar mode', async () => {
    songEntry.song.play_along.instrument = 'guitar';
    try {
      renderAt('/songs/abc123/play');
      const neck = await screen.findByTestId('guitar-neck-canvas');
      await waitFor(() => expect(neck.getAttribute('aria-label')).toBe('Bar 1, G: 320003. Next: Bar 2, C: x32010'));
      expect(screen.getByTestId('strum-lane-canvas')).toBeInTheDocument();
      expect(screen.queryByTestId('neck-canvas')).not.toBeInTheDocument();
      expect(screen.getByText(/shares the other stem/i)).toBeInTheDocument();
      expect(screen.getByRole('group', { name: 'Style' })).toBeInTheDocument();
    } finally {
      songEntry.song.play_along.instrument = 'bass';
    }
  });

  it('saves a pattern change to song.json', async () => {
    renderAt('/songs/abc123/play');
    await userEvent.click(await screen.findByRole('button', { name: 'Octave' }));
    await waitFor(
      () => {
        const put = vi.mocked(fetch).mock.calls.find(([, init]) => init?.method === 'PUT');
        expect(JSON.parse(String(put![1]!.body)).play_along.pattern.notes).toBe('octave_pump');
      },
      { timeout: 3000 },
    );
  });

  it('says the song needs analysis rather than drawing an empty neck', async () => {
    mockFetch(404);
    renderAt('/songs/abc123/play');
    expect(await screen.findByText(/needs analysis/i)).toBeInTheDocument();
    expect(screen.queryByTestId('neck-canvas')).not.toBeInTheDocument();
  });

  it('is one click from the Stems content, and back', async () => {
    renderAt('/songs/abc123');
    await userEvent.click(await screen.findByRole('link', { name: 'Play along' }));
    expect(await screen.findByTestId('neck-canvas')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('link', { name: 'Stems' }));
    expect(await screen.findByTestId('time-axis')).toBeInTheDocument();
  });

  it('toggles playback with the Space key', async () => {
    renderAt('/songs/abc123/play');
    await screen.findByTestId('neck-canvas');
    await userEvent.keyboard(' ');
    await waitFor(() => expect(engine.play).toHaveBeenCalledTimes(1));
    expect(engine.pause).not.toHaveBeenCalled();
  });

  it('plays on Space while a tempo button has focus, without stepping the tempo', async () => {
    renderAt('/songs/abc123/play');
    const tempoUp = await screen.findByRole('button', { name: 'Tempo up' });
    tempoUp.focus();
    await userEvent.keyboard(' ');
    expect(engine.setTempo).not.toHaveBeenCalledWith(expect.closeTo(1.1, 5));
    await waitFor(() => expect(engine.play).toHaveBeenCalledTimes(1));
    expect(engine.pause).not.toHaveBeenCalled();
  });

  it('plays on Space while a button has focus, without firing that button', async () => {
    renderAt('/songs/abc123/play');
    await userEvent.click(await screen.findByRole('button', { name: 'Practice' }));
    const metronome = await screen.findByRole('button', { name: 'Metronome' });
    await userEvent.click(metronome);
    await waitFor(() => expect(metronome).toHaveAttribute('aria-pressed', 'true'));
    expect(metronome).toHaveFocus();
    await userEvent.keyboard(' ');
    await waitFor(() => expect(engine.play).toHaveBeenCalledTimes(1));
    expect(engine.pause).not.toHaveBeenCalled();
    expect(metronome).toHaveAttribute('aria-pressed', 'true');
  });

  it('moves the playhead to a bar clicked in the chord ribbon', async () => {
    renderAt('/songs/abc123/play');
    await userEvent.click(await screen.findByRole('button', { name: /^Bar 3,/ }));
    expect(engine.seek).toHaveBeenCalledWith(192_000);
  });

  it('keeps an armed loop for a click inside it and releases it for a click outside', async () => {
    renderAt('/songs/abc123/play');
    // Bars 2-3 (0-based 1..3), armed.
    fireEvent.click(await screen.findByRole('button', { name: /^Bar 2,/ }), { ctrlKey: true });
    fireEvent.click(screen.getByRole('button', { name: /^Bar 3,/ }), { shiftKey: true });
    const arm = screen.getByRole('button', { name: 'Arm loop' });
    await userEvent.click(arm);
    expect(arm).toHaveAttribute('aria-pressed', 'true');

    await userEvent.click(screen.getByRole('button', { name: /^Bar 3,/ }));
    expect(engine.seek).toHaveBeenLastCalledWith(192_000);
    expect(arm).toHaveAttribute('aria-pressed', 'true');

    await userEvent.click(screen.getByRole('button', { name: /^Bar 4,/ }));
    expect(engine.seek).toHaveBeenLastCalledWith(288_000);
    expect(arm).toHaveAttribute('aria-pressed', 'false');
  });
});
