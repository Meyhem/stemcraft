// frontend/src/screens/TabView.test.tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Job, JobStep, Transcription } from '../api/client';
import { SongScope } from '../session/SongScope';
import { PlayAlong } from './PlayAlong';
import { SongScreen } from './SongScreen';
import { SongView } from './SongView';
import { TabView } from './TabView';

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

const step = (id: string, label: string, state: JobStep['state'], progress = 0): JobStep => ({
  id, label, weight: 0.25, state, progress, detail: null,
  started_at: state === 'pending' ? null : 1, finished_at: state === 'done' || state === 'failed' ? 2 : null,
});

function job(state: Job['state'], steps: JobStep[], error: string | null = null): Job {
  return {
    id: 7, song_id: 'abc123', kind: 'transcribe', payload: { song_id: 'abc123' }, state,
    cancel_requested: false, progress: 0.3, device: 'cuda', lease_until: null, created_at: 1,
    started_at: 1, finished_at: state === 'failed' ? 2 : null, error, result: null, steps,
  };
}

const running = job('running', [
  step('load', 'Load bass stem', 'done'),
  step('track', 'Track pitch', 'running', 0.26),
  step('notes', 'Find notes', 'pending'),
  step('write', 'Write tab', 'pending'),
]);
const failed = job(
  'failed',
  [step('load', 'Load bass stem', 'done'), step('track', 'Track pitch', 'failed'), step('notes', 'Find notes', 'pending'), step('write', 'Write tab', 'pending')],
  'Traceback (most recent call last):\ntorch.OutOfMemoryError: CUDA out of memory.',
);

const params = { fmin_hz: 32, fmax_hz: 400, hop_samples: 480, voiced_min: 0.5, gate_db: -45, jump_semitones: 0.6, min_note_samples: 2880 };
const tab = (notes: Transcription['notes']): Transcription => ({
  schema_version: 1, source: 'bass', model: 'crepe-full', device: 'cuda', params, notes, written_at: '2026-10-01T12:32:00+00:00',
});

interface Scenario {
  hasTab?: boolean;
  jobs?: Job[];
  transcription?: Transcription;
}

function mockFetch({ hasTab = false, jobs = [], transcription }: Scenario) {
  const entry = { ...songEntry, files: { ...songEntry.files, has_transcription: hasTab } };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'PUT') return new Response(String(init.body), { status: 200 });
      if (init?.method === 'POST' && url.endsWith('/transcribe')) {
        return new Response(JSON.stringify({ job_id: 8 }), { status: 201 });
      }
      if (url.endsWith('/analysis')) return new Response(JSON.stringify(analysis), { status: 200 });
      if (url.endsWith('/transcription')) {
        return transcription
          ? new Response(JSON.stringify(transcription), { status: 200 })
          : new Response('no tab', { status: 404 });
      }
      if (url.startsWith('/api/jobs')) return new Response(JSON.stringify({ jobs }), { status: 200 });
      return new Response(JSON.stringify(entry), { status: 200 });
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
              <Route path="tab" element={<TabView />} />
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
});
afterEach(() => vi.unstubAllGlobals());

describe('TabView', () => {
  it('offers to extract when there is no tab, and starts the job', async () => {
    mockFetch({});
    renderAt('/songs/abc123/tab');
    expect(await screen.findByText('No tab for this song yet')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Extract bass tab' }));
    await waitFor(() => {
      const post = vi.mocked(fetch).mock.calls.find(([, init]) => init?.method === 'POST');
      expect(post?.[0]).toBe('/api/songs/abc123/transcribe');
    });
  });

  it('warns when the bass stem is near-silent, and still offers to extract', async () => {
    engine.stemSummaries[2]!.nearSilent = true;
    try {
      mockFetch({});
      renderAt('/songs/abc123/tab');
      expect(await screen.findByText('The bass stem is near-silent')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Extract bass tab' })).toBeEnabled();
    } finally {
      engine.stemSummaries[2]!.nearSilent = false;
    }
  });

  it("shows the running job's own steps", async () => {
    mockFetch({ jobs: [running] });
    renderAt('/songs/abc123/tab');
    expect(await screen.findByText('Extracting the bass tab')).toBeInTheDocument();
    expect(screen.getByText('Load bass stem')).toBeInTheDocument();
    expect(screen.getByText('Track pitch')).toBeInTheDocument();
    expect(screen.getByText('running · cuda')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Extract bass tab' })).not.toBeInTheDocument();
  });

  it('shows a failed job with its real error and a Retry', async () => {
    mockFetch({ jobs: [failed] });
    renderAt('/songs/abc123/tab');
    expect(await screen.findByText(/CUDA out of memory/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('says so when the tab has no notes, rather than drawing an empty staff', async () => {
    mockFetch({ hasTab: true, transcription: tab([]) });
    renderAt('/songs/abc123/tab');
    expect(await screen.findByText('No notes found in the bass stem')).toBeInTheDocument();
    expect(screen.queryByTestId('tab-staff-canvas')).not.toBeInTheDocument();
  });

  it('draws the staff and the neck, and counts what is unsure', async () => {
    mockFetch({
      hasTab: true,
      transcription: tab([
        { start: 0, end: 20_000, midi: 31, cents: 0, confidence: 0.9 },
        { start: 24_000, end: 40_000, midi: 35, cents: 0, confidence: 0.5 },
      ]),
    });
    renderAt('/songs/abc123/tab');
    expect(await screen.findByTestId('tab-staff-canvas')).toBeInTheDocument();
    const neck = screen.getByTestId('tab-neck-canvas');
    await waitFor(() => expect(neck.getAttribute('aria-label')).toBe('Bar 1: G B?. Next: Bar 2, no notes'));
    expect(screen.getByText('Transcribed from the bass stem: a starting point, not a checked tab')).toBeInTheDocument();
    expect(screen.getByText(/2 notes, 1 unsure, 0 moved an octave/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Re-extract' })).toBeInTheDocument();
  });

  it('follows the pitch shift: a note pushed below the open E moves up an octave', async () => {
    songEntry.song.playback.pitch_semitones = -2;
    try {
      mockFetch({ hasTab: true, transcription: tab([{ start: 0, end: 20_000, midi: 28, cents: 0, confidence: 0.9 }]) });
      renderAt('/songs/abc123/tab');
      expect(await screen.findByText(/1 notes, 0 unsure, 1 moved an octave/)).toBeInTheDocument();
    } finally {
      songEntry.song.playback.pitch_semitones = 0;
    }
  });

  it('is one of three views under the same transport', async () => {
    mockFetch({});
    renderAt('/songs/abc123');
    await userEvent.click(await screen.findByRole('link', { name: 'Tab' }));
    expect(await screen.findByText('No tab for this song yet')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Play along' })).toHaveAttribute('href', '/songs/abc123/play');
    expect(screen.getByRole('link', { name: 'Stems' })).toHaveAttribute('href', '/songs/abc123');
  });
});
