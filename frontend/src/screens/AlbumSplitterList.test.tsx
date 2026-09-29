import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, expect, test, vi } from 'vitest';

import { AlbumSplitter } from './AlbumSplitter';

// AlbumSplitter.test.tsx mounts the editor route only; this is the list-and-upload page
// at /splitter, which had no coverage.
const album = (id: string, title: string) => ({
  schema_version: 1,
  id,
  title,
  artist: 'Someone',
  source: { kind: 'upload', value: 'original.mp3' },
  created_at: '2026-01-01T00:00:00Z',
  total_samples: 0,
  split_points: [],
  tracks: [{ title: '' }],
});

function renderList(albums: unknown[]) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify({ albums }))),
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/splitter']}>
        <Routes>
          <Route path="splitter" element={<AlbumSplitter />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

test('dropping a file on the zone arms the upload button', async () => {
  renderList([]);

  expect(screen.getByRole('button', { name: /upload album/i })).toBeDisabled();

  const zone = document.querySelector('.drop')!;
  const dropEvent = new Event('drop', { bubbles: true, cancelable: true });
  Object.defineProperty(dropEvent, 'dataTransfer', {
    value: { files: [new File(['b'], 'side-a.flac', { type: 'audio/flac' })] },
  });
  fireEvent(zone, dropEvent);

  expect(await screen.findByText('side-a.flac')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /upload album/i })).toBeEnabled();
});

test('a finished album reads as ok and an uploaded one does not', async () => {
  renderList([
    { dir: 'a-x', state: 'split', unreadable: null, files: null, album: album('a', 'Side A') },
    { dir: 'b-y', state: 'uploaded', unreadable: null, files: null, album: album('b', 'Side B') },
  ]);

  expect(await screen.findByText('split')).toHaveClass('chip', 'ok');
  expect(screen.getByText('uploaded')).toHaveClass('chip');
  expect(screen.getByText('uploaded')).not.toHaveClass('ok');
});

test('an unreadable album shows its real error and the list survives (§9)', async () => {
  renderList([
    { dir: '01BAD-x', state: null, unreadable: 'album.json: invalid UTF-8', files: null, album: null },
    { dir: 'a-x', state: 'ready', unreadable: null, files: null, album: album('a', 'Side A') },
  ]);

  expect(await screen.findByText('album.json: invalid UTF-8')).toBeInTheDocument();
  expect(screen.getByText('Side A')).toBeInTheDocument();
});
