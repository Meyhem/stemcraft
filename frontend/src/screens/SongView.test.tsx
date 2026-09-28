import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SongView } from './SongView';

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
  durationSamples: 48_000 * 32,
  durationSeconds: 32,
  stemSummaries: ['vocals', 'drums', 'bass', 'other'].map((name) => ({
    name,
    envelope: Float32Array.from([0.3, 0.5]),
    peak: 0.5,
    nearSilent: false,
  })),
};

vi.mock('../engine/EngineController', () => ({
  STEM_ORDER: ['vocals', 'drums', 'bass', 'other'],
  EngineController: { create: vi.fn(async () => engine) },
}));
vi.mock('wavesurfer.js', () => ({
  default: { create: () => ({ destroy: vi.fn(), setOptions: vi.fn(), on: () => () => {} }) },
}));

const songEntry = {
  dir: 'abc123-test',
  state: 'analyzed',
  unreadable: null,
  files: { has_audio: true, has_peaks: true, has_stems: true, has_analysis: true },
  song: {
    schema_version: 2,
    id: 'abc123',
    title: 'Test Song',
    artist: 'Someone',
    source: { kind: 'upload', value: 'original.mp3' },
    created_at: '2026-09-28T00:00:00+00:00',
    last_played_at: null,
    mix: {
      vocals: { gain_db: 0, muted: false },
      drums: { gain_db: 0, muted: false },
      bass: { gain_db: 0, muted: true },
      other: { gain_db: 0, muted: false },
    },
    playback: { tempo: 0.8, pitch_semitones: -1 },
    loops: [],
    active_loop: null,
    metronome: false,
    count_in_bars: 0,
  },
};

const analysis = {
  schema_version: 1,
  key_candidates: [{ tonic: 'G', mode: 'major', confidence: 1 }],
  beat_grid: {
    bpm: 120,
    beats: Array.from({ length: 64 }, (_, i) => i * 24_000),
    downbeats: Array.from({ length: 16 }, (_, i) => i * 96_000),
  },
  chords: [{ bar: 0, start_sample: 0, end_sample: 96_000, chord: 'G:maj' }],
};

function mockFetch(overrides: Record<string, unknown> = {}) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const body =
        overrides[url] ??
        (url.endsWith('/analysis') ? analysis : url.includes('/api/songs/abc123') ? songEntry : {});
      if (body === 404) return new Response('not found', { status: 404 });
      return new Response(JSON.stringify(body), { status: init?.method === 'PUT' ? 200 : 200 });
    }),
  );
}

function renderSongView() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/songs/abc123']}>
        <Routes>
          <Route path="/songs/:songId" element={<SongView />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => mockFetch());
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('SongView', () => {
  it('shows the song title and four stem lanes once loaded', async () => {
    renderSongView();
    expect(await screen.findByRole('heading', { name: /Test Song/ })).toBeInTheDocument();
    for (const name of ['vocals', 'drums', 'bass', 'other']) {
      expect(await screen.findByRole('group', { name: `${name} stem` })).toBeInTheDocument();
    }
  });

  it('restores the saved recipe into the engine on load', async () => {
    renderSongView();
    await waitFor(() => expect(engine.setTempo).toHaveBeenCalledWith(0.8));
    expect(engine.setPitchSemitones).toHaveBeenCalledWith(-1);
    // bass was muted in song.json: it must come back muted, not at unity.
    expect(engine.setStemGain).toHaveBeenCalledWith('bass', 0);
  });

  it('autosaves a mix change back to song.json', async () => {
    renderSongView();
    const mute = await screen.findByRole('button', { name: /mute vocals/i });
    await userEvent.click(mute);
    await waitFor(() => {
      const put = (fetch as ReturnType<typeof vi.fn>).mock.calls.find(
        ([, init]) => init?.method === 'PUT',
      );
      expect(put).toBeDefined();
      expect(JSON.parse(put![1].body).mix.vocals.muted).toBe(true);
    });
  });

  it('disarms the loop when the user scrubs, visibly (U-06)', async () => {
    renderSongView();
    await screen.findByRole('heading', { name: /Test Song/ });
    await userEvent.click(await screen.findByRole('button', { name: /set a/i }));
    await userEvent.click(await screen.findByRole('button', { name: /set b/i }));
    await userEvent.click(await screen.findByRole('button', { name: /arm loop/i }));
    expect(screen.getByRole('button', { name: /arm loop/i })).toHaveAttribute('aria-pressed', 'true');

    const track = screen.getByTestId('timeline-track');
    vi.spyOn(track, 'getBoundingClientRect').mockReturnValue({
      left: 0, width: 1000, top: 0, height: 40, right: 1000, bottom: 40, x: 0, y: 0,
      toJSON: () => ({}),
    } as DOMRect);
    // Wrapped in act() only so React flushes the resulting state update inside
    // the test's own tick: a raw dispatchEvent is how the stubbed rect above is
    // made to matter, and what is asserted below is unchanged.
    act(() => {
      track.dispatchEvent(new MouseEvent('click', { clientX: 500, bubbles: true }));
    });

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /arm loop/i })).toHaveAttribute(
        'aria-pressed',
        'false',
      ),
    );
    // D-06: the loop is released at the engine before the cursor is moved.
    expect(engine.setLoop).toHaveBeenLastCalledWith(null);
    expect(engine.seek).toHaveBeenCalled();
  });

  it('refuses to build an engine for a song with no stems, and says why', async () => {
    mockFetch({
      '/api/songs/abc123': { ...songEntry, state: 'imported', files: { ...songEntry.files, has_stems: false } },
    });
    renderSongView();
    expect(await screen.findByText(/not been separated/i)).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: /bass stem/ })).not.toBeInTheDocument();
  });

  it('plays without a beat grid, but says bars are unavailable', async () => {
    mockFetch({ '/api/songs/abc123/analysis': 404 });
    renderSongView();
    expect(await screen.findByRole('button', { name: /^play$/i })).toBeInTheDocument();
    expect(screen.getByText(/no beat grid/i)).toBeInTheDocument();
  });

  it('surfaces an engine construction failure verbatim (N-08)', async () => {
    const { EngineController } = await import('../engine/EngineController');
    vi.mocked(EngineController.create).mockRejectedValueOnce(
      new Error('DOMException: Unable to decode audio data'),
    );
    renderSongView();
    expect(await screen.findByRole('alert')).toHaveTextContent('Unable to decode audio data');
  });
});
