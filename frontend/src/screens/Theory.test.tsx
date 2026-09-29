import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, expect, test, vi } from 'vitest';

import { DEFAULT_THEORY, type TheoryDoc } from '../api/client';
import { forgetUnsavedTheory } from '../theory/TheoryDoc';
import { Theory } from './Theory';

const songEntry = (id: string, title: string, hasAnalysis: boolean, lastPlayed: string | null) => ({
  dir: `${id}-x`,
  song: { id, title, last_played_at: lastPlayed },
  state: hasAnalysis ? 'analyzed' : 'separated',
  unreadable: null,
  files: { has_audio: true, has_peaks: true, has_stems: true, has_analysis: hasAnalysis },
});

const analysis = {
  schema_version: 1,
  key_candidates: [
    { tonic: 'G', mode: 'minor', confidence: 0.72 },
    { tonic: 'A#', mode: 'major', confidence: 0.18 },
  ],
  beat_grid: { bpm: 120, beats: [0], downbeats: [0] },
  chords: [
    { bar: 0, start_sample: 0, end_sample: 1, chord: 'G:min' },
    { bar: 1, start_sample: 1, end_sample: 2, chord: 'G:min' },
    { bar: 2, start_sample: 2, end_sample: 3, chord: 'D#:maj' },
    { bar: 3, start_sample: 3, end_sample: 4, chord: 'N' },
    { bar: 4, start_sample: 4, end_sample: 5, chord: 'D:7' },
  ],
};

interface Server {
  theory?: TheoryDoc | { status: number; detail: string };
  putStatus?: number;
  songsStatus?: number;
  songsMessage?: string;
}

function setup(path: string, server: Server = {}) {
  const puts: TheoryDoc[] = [];
  let stored: TheoryDoc | { status: number; detail: string } = server.theory ?? DEFAULT_THEORY;
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/theory' && init?.method === 'PUT') {
      const body = JSON.parse(String(init.body)) as TheoryDoc;
      puts.push(body);
      if (server.putStatus) return new Response('disk full', { status: server.putStatus });
      stored = body;
      return new Response(JSON.stringify(body));
    }
    if (url === '/api/theory') {
      return 'status' in stored
        ? new Response(JSON.stringify({ detail: stored.detail }), { status: stored.status })
        : new Response(JSON.stringify(stored));
    }
    if (url === '/api/songs') {
      if (server.songsStatus) {
        return new Response(JSON.stringify({ detail: server.songsMessage ?? 'song list unavailable' }), { status: server.songsStatus });
      }
      return new Response(
        JSON.stringify({
          songs: [
            songEntry('01OLD', 'Old Song', true, '2026-01-01T00:00:00Z'),
            songEntry('01TIGHT', 'Tightrope', true, '2026-09-01T00:00:00Z'),
            songEntry('01RAW', 'Raw Song', false, null),
          ],
        }),
      );
    }
    if (url === '/api/songs/01TIGHT/analysis') return new Response(JSON.stringify(analysis));
    throw new Error(`unexpected fetch: ${init?.method ?? 'GET'} ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  let location = '';
  function Where() {
    const l = useLocation();
    location = `${l.pathname}${l.search}`;
    return null;
  }
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="theory" element={<Theory />} />
          <Route path="theory/:tool" element={<Theory />} />
        </Routes>
        <Where />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { puts, fetchMock, where: () => location };
}

afterEach(() => {
  cleanup(); // leaving the tab with a failed save keeps the document for the next tab; no test leaves one behind
  forgetUnsavedTheory();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

test('the rail lists the registered tools and marks the open one', async () => {
  setup('/theory/scale-finder');
  const rail = await screen.findByRole('navigation', { name: 'Theory tools' });
  expect(within(rail).getByRole('link', { name: 'Scale finder' })).toHaveAttribute('aria-current', 'page');
  expect(within(rail).getByRole('link', { name: 'Scale finder' })).toHaveAttribute('href', '/theory/scale-finder');
});

test('opening a tool saves it as the last tool', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  const { puts } = setup('/theory/scale-finder', { theory: { ...DEFAULT_THEORY, last_tool: 'note-finder' } });
  await screen.findByRole('heading', { name: 'Scale finder' });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(600);
  });
  expect(puts.at(-1)?.last_tool).toBe('scale-finder');
});

test('an unknown tool says so', async () => {
  setup('/theory/tab-reader');
  expect(await screen.findByText(/There is no tool called “tab-reader”/)).toBeInTheDocument();
});

test('an unreadable theory.json is an error with the real reason and a confirmed reset', async () => {
  const { puts } = setup('/theory/scale-finder', {
    theory: { status: 500, detail: 'data/theory.json: 1 invalid field(s): quiz.history.0.ms' },
  });
  const alert = await screen.findByRole('alert');
  expect(alert).toHaveTextContent("theory.json can't be read");
  expect(alert).toHaveTextContent('quiz.history.0.ms');
  vi.spyOn(window, 'confirm').mockReturnValueOnce(false);
  fireEvent.click(within(alert).getByRole('button', { name: 'Reset to defaults…' }));
  expect(puts).toHaveLength(0);
  vi.spyOn(window, 'confirm').mockReturnValueOnce(true);
  fireEvent.click(within(alert).getByRole('button', { name: 'Reset to defaults…' }));
  await waitFor(() => expect(puts).toEqual([DEFAULT_THEORY]));
});

test('a failed save keeps the change and offers Retry', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {}); // the tab is left with the failed save still unsaved
  const { puts } = setup('/theory/scale-finder', { putStatus: 500 });
  const instrument = await screen.findByRole('combobox', { name: 'Instrument' });
  await waitFor(() => expect(instrument).toBeEnabled());
  fireEvent.change(instrument, { target: { value: 'guitar6' } });
  const warning = await screen.findByText("Couldn't save", {}, { timeout: 2000 });
  expect(screen.getByRole('combobox', { name: 'Instrument' })).toHaveValue('guitar6');
  expect(warning.closest('[role="status"]')).toHaveTextContent('disk full');
  const before = puts.length;
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  await waitFor(() => expect(puts.length).toBe(before + 1));
  expect(puts.at(-1)?.instrument.kind).toBe('guitar');
  cleanup(); // leaves the tab with the change unsaved; its report is made a moment later, while the console spy is on
  await new Promise((r) => setTimeout(r, 0));
});

test('instrument footer: guitar, drop D, custom tuning and left-handed', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  const { puts } = setup('/theory/scale-finder');
  const instrument = await screen.findByRole('combobox', { name: 'Instrument' });
  await waitFor(() => expect(instrument).toBeEnabled());
  fireEvent.change(instrument, { target: { value: 'guitar6' } });
  fireEvent.change(screen.getByRole('combobox', { name: 'Tuning' }), { target: { value: 'guitar-drop-d' } });
  fireEvent.click(screen.getByRole('checkbox', { name: 'Left-handed' }));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(600);
  });
  expect(puts.at(-1)?.instrument).toEqual({
    kind: 'guitar',
    strings: 6,
    tuning: ['D2', 'A2', 'D3', 'G3', 'B3', 'E4'],
    left_handed: true,
  });

  fireEvent.change(screen.getByRole('combobox', { name: 'Tuning' }), { target: { value: 'custom' } });
  const field = screen.getByRole('textbox', { name: 'Custom tuning, low string first' });
  fireEvent.change(field, { target: { value: 'D A D G B E' } });
  fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
  expect(screen.getByRole('alert')).toHaveTextContent('"D" is not a note with an octave');
  fireEvent.change(field, { target: { value: 'C2 G2 C3 G3 C4 E4' } });
  fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(600);
  });
  expect(puts.at(-1)?.instrument.tuning).toEqual(['C2', 'G2', 'C3', 'G3', 'C4', 'E4']);
});

test('song card: analysed songs newest first, key candidates load the key', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  const { where } = setup('/theory/scale-finder', { theory: { ...DEFAULT_THEORY, song_id: '01TIGHT' } });
  const picker = await screen.findByRole('combobox', { name: 'Song' });
  await waitFor(() => expect(within(picker).getAllByRole('option').map((o) => o.textContent)).toEqual([
    'Pick an analysed song',
    'Tightrope',
    'Old Song',
  ]));
  fireEvent.click(await screen.findByRole('button', { name: 'B♭ major 18%' }));
  expect(where()).toBe('/theory/scale-finder?root=Bb');
  fireEvent.click(screen.getByRole('button', { name: 'G minor 72%' }));
  expect(where()).toBe('/theory/scale-finder?root=G&scale=minor');
});

test('song card: an unanalysed or missing song says so', async () => {
  setup('/theory/scale-finder', { theory: { ...DEFAULT_THEORY, song_id: '01RAW' } });
  expect(await screen.findByText(/Raw Song has no analysis yet/)).toBeInTheDocument();
});

test('song card: a deleted song says so', async () => {
  setup('/theory/scale-finder', { theory: { ...DEFAULT_THEORY, song_id: '01GONE' } });
  expect(await screen.findByText('That song no longer exists. Pick another.')).toBeInTheDocument();
});

test('song card: a failed song list shows the real error, not "no longer exists" (N-08)', async () => {
  setup('/theory/scale-finder', {
    theory: { ...DEFAULT_THEORY, song_id: '01TIGHT' },
    songsStatus: 500,
    songsMessage: 'database connection failed',
  });
  const alert = await screen.findByText(/GET \/api\/songs → 500/);
  expect(alert).toBeInTheDocument();
  expect(screen.queryByText('That song no longer exists')).not.toBeInTheDocument();
});
