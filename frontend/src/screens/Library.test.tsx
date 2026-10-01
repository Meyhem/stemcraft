import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, test, vi } from 'vitest';

import { Library } from './Library';

const song = {
  schema_version: 1,
  id: '01J9SONGID',
  title: 'My Song',
  artist: 'Someone',
  source: { kind: 'upload', value: 'original.mp3' },
  created_at: '2026-01-01T00:00:00Z',
  last_played_at: null,
  mix: {},
  playback: { tempo: 1, pitch_semitones: 0 },
  loops: [],
};

const entry = {
  dir: `${song.id}-my-song`,
  song,
  state: 'imported',
  unreadable: null,
  files: { has_audio: true, has_peaks: true, has_stems: false, has_analysis: false, has_transcription: false },
};

afterEach(() => {
  vi.unstubAllGlobals();
});

function renderLibrary(songs: unknown[]) {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({ songs })));
  vi.stubGlobal('fetch', fetchMock);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <Library />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return fetchMock;
}

test('renders a card per song with its state', async () => {
  renderLibrary([entry]);
  expect(await screen.findByText('My Song')).toBeInTheDocument();
  expect(screen.getByText('Someone')).toBeInTheDocument();
  expect(screen.getByText('imported')).toBeInTheDocument();
});

test('the card title links to the Song view', async () => {
  renderLibrary([entry]);
  // The Song view is the screen the product exists for, so it is reachable in
  // one click from the card -- including for an imported-but-not-separated
  // song, which SongView itself explains rather than the Library hiding.
  const link = await screen.findByRole('link', { name: 'My Song' });
  expect(link).toHaveAttribute('href', `/songs/${song.id}`);
});

test('an unreadable entry shows its error instead of a title', async () => {
  renderLibrary([
    { dir: '01BROKEN-bad', song: null, state: null, unreadable: 'invalid JSON', files: null },
  ]);
  expect(await screen.findByText('01BROKEN-bad')).toBeInTheDocument();
  expect(screen.getByText('invalid JSON')).toBeInTheDocument();
});

test('an empty library says so', async () => {
  renderLibrary([]);
  expect(await screen.findByText(/no songs yet/i)).toBeInTheDocument();
});

test('delete only fires after the confirm is accepted', async () => {
  vi.spyOn(window, 'confirm').mockReturnValue(false);
  const fetchMock = renderLibrary([entry]);
  await screen.findByText('My Song');

  await userEvent.click(screen.getByRole('button', { name: /delete/i }));
  expect(window.confirm).toHaveBeenCalled();
  expect(fetchMock).not.toHaveBeenCalledWith(
    expect.stringContaining('/api/songs/'),
    expect.objectContaining({ method: 'DELETE' }),
  );
});

test('delete calls the API when confirmed and the list refetches', async () => {
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  const fetchMock = renderLibrary([entry]);
  await screen.findByText('My Song');

  await userEvent.click(screen.getByRole('button', { name: /delete/i }));
  await waitFor(() =>
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/songs/${song.id}`,
      expect.objectContaining({ method: 'DELETE' }),
    ),
  );
  // Invalidated -> refetched.
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
});

test('an analyzed song shows an ok-toned state chip and a separated one does not', async () => {
  // Load-bearing on the tone, not just the text: before the chip existed the state was
  // plain uppercase text, so a test asserting only on the word "analyzed" would have
  // passed against the old markup and proved nothing about this change.
  renderLibrary([
    { ...entry, dir: 'a-x', state: 'analyzed', song: { ...song, id: 'a', title: 'Done' } },
    { ...entry, dir: 'b-y', state: 'separated', song: { ...song, id: 'b', title: 'Partway' } },
  ]);

  expect(await screen.findByText('analyzed')).toHaveClass('chip', 'ok');
  expect(screen.getByText('separated')).toHaveClass('chip');
  expect(screen.getByText('separated')).not.toHaveClass('ok');
});
