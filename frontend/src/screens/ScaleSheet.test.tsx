import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, expect, test, vi } from 'vitest';

import { ScaleSheet } from './ScaleSheet';

const songEntry = {
  dir: '01SONG-tightrope',
  song: {
    schema_version: 1, id: '01SONG', title: 'Tightrope', artist: 'Someone',
    source: { kind: 'upload', value: 'original.mp3' }, created_at: '2026-01-01T00:00:00Z',
    last_played_at: null, mix: {}, playback: { tempo: 1, pitch_semitones: 0 }, loops: [],
  },
  state: 'analyzed',
  unreadable: null,
  files: { has_audio: true, has_peaks: true, has_stems: true, has_analysis: true },
};

const analysis = {
  schema_version: 1,
  key_candidates: [
    { tonic: 'G', mode: 'minor', confidence: 0.72 },
    { tonic: 'A#', mode: 'major', confidence: 0.18 },
    { tonic: 'D', mode: 'minor', confidence: 0.1 },
  ],
  beat_grid: { bpm: 120, beats: [1920], downbeats: [1920] },
  chords: [{ bar: 0, start_sample: 1920, end_sample: 48000, chord: 'G:min' }],
};

afterEach(() => vi.unstubAllGlobals());

function renderScaleSheet(options?: { analysisResponse?: () => Response | Promise<Response> }) {
  const fetchMock = vi.fn(async (url: string) => {
    if (url === '/api/songs') return new Response(JSON.stringify({ songs: [songEntry] }));
    if (url === '/api/songs/01SONG/analysis') {
      return options?.analysisResponse
        ? options.analysisResponse()
        : new Response(JSON.stringify(analysis));
    }
    throw new Error(`unexpected fetch: ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/songs/01SONG/scale']}>
        <Routes>
          <Route path="songs/:songId/scale" element={<ScaleSheet />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

test('shows key candidates with confidence percentages', async () => {
  renderScaleSheet();
  expect(await screen.findByText(/72%/)).toBeInTheDocument();
  expect(screen.getByText(/18%/)).toBeInTheDocument();
  expect(screen.getByText(/10%/)).toBeInTheDocument();
});

test('defaults to the top candidate and shows its correctly-spelled notes', async () => {
  renderScaleSheet();
  await screen.findByText(/72%/);
  // G natural minor: G, A, Bb, C, D, Eb, F. Scope to the note-list <b> tags:
  // the fretboard SVG below renders the same pitch classes as <text>, so an
  // unscoped query matches both.
  expect(screen.getByText('Bb', { selector: 'b' })).toBeInTheDocument();
  expect(screen.getByText('Eb', { selector: 'b' })).toBeInTheDocument();
});

test('switching candidates re-renders the fretboard for the new key', async () => {
  renderScaleSheet();
  await screen.findByText(/72%/);
  await userEvent.click(screen.getByRole('button', { name: /A# major/i }));
  expect(screen.getByRole('img', { name: /A# major fretboard/i })).toBeInTheDocument();
});

test('pentatonic toggle shrinks the note list', async () => {
  renderScaleSheet();
  await screen.findByText(/72%/);
  const fullCount = screen.getAllByText(/^(G|A|Bb|C|D|Eb|F)$/).length;
  await userEvent.click(screen.getByRole('button', { name: /pentatonic/i }));
  const pentaCount = screen.getAllByText(/^(G|Bb|C|D|F)$/).length;
  expect(pentaCount).toBeLessThan(fullCount);
});

test('shows a loading state while analysis is being fetched', async () => {
  let resolveAnalysis: (r: Response) => void = () => {};
  const pending = new Promise<Response>((resolve) => {
    resolveAnalysis = resolve;
  });
  renderScaleSheet({ analysisResponse: () => pending });

  expect(await screen.findByText(/loading analysis/i)).toBeInTheDocument();

  resolveAnalysis(new Response(JSON.stringify(analysis)));
  await screen.findByText(/72%/);
});

test('a 404 (not analyzed yet) shows a calm empty state, not an alert with raw HTTP text', async () => {
  renderScaleSheet({
    analysisResponse: () =>
      new Response('song 01SONG has no analysis yet', { status: 404 }),
  });

  expect(await screen.findByText(/hasn't been analyzed yet/i)).toBeInTheDocument();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(screen.queryByText(/404/)).not.toBeInTheDocument();
});

test('a real analysis error (not a 404) keeps the loud N-08 alert with the real message', async () => {
  renderScaleSheet({
    analysisResponse: () => new Response('database is on fire', { status: 500 }),
  });

  const alert = await screen.findByRole('alert');
  expect(alert.textContent).toMatch(/500/);
  expect(alert.textContent).toMatch(/database is on fire/);
});
