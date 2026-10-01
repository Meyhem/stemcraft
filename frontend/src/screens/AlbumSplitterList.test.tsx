import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

function renderList(albums: unknown[], upload?: () => Promise<Response>) {
  const fetchMock = vi.fn(async (url: string, _init?: RequestInit) =>
    url === '/api/albums/upload' && upload ? upload() : new Response(JSON.stringify({ albums })),
  );
  vi.stubGlobal('fetch', fetchMock);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/splitter']}>
        <Routes>
          <Route path="splitter" element={<AlbumSplitter />} />
          <Route path="splitter/:albumId" element={<p>editor for new1</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

function drop(file: File) {
  const dropEvent = new Event('drop', { bubbles: true, cancelable: true });
  Object.defineProperty(dropEvent, 'dataTransfer', { value: { files: [file] } });
  fireEvent(document.querySelector('.drop')!, dropEvent);
}

test('the upload form is not on the page until Add album is pressed', async () => {
  renderList([]);
  expect(screen.queryByLabelText('Album title')).not.toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Album splitter' })).toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: 'Add album' }));
  expect(screen.getByRole('dialog', { name: 'Add album' })).toBeInTheDocument();
  expect(screen.getByLabelText('Album title')).toBeInTheDocument();
});

test('dropping a file on the zone arms the upload button', async () => {
  renderList([]);
  await userEvent.click(screen.getByRole('button', { name: 'Add album' }));

  expect(screen.getByRole('button', { name: 'Upload album' })).toBeDisabled();
  drop(new File(['b'], 'side-a.flac', { type: 'audio/flac' }));

  expect(await screen.findByText('side-a.flac')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Upload album' })).toBeEnabled();
});

test('Cancel closes the modal and a reopened one starts empty', async () => {
  renderList([]);
  await userEvent.click(screen.getByRole('button', { name: 'Add album' }));
  await userEvent.type(screen.getByLabelText('Album title'), 'Half typed');
  await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: 'Add album' }));
  expect(screen.getByLabelText('Album title')).toHaveValue('');
});

test('a failed upload shows the server message and keeps the form', async () => {
  renderList([], async () => new Response(JSON.stringify({ detail: 'ffmpeg could not decode that' }), { status: 422 }));
  await userEvent.click(screen.getByRole('button', { name: 'Add album' }));
  drop(new File(['b'], 'bad.bin'));
  await userEvent.type(screen.getByLabelText('Album title'), 'Keep me');
  await userEvent.click(screen.getByRole('button', { name: 'Upload album' }));

  expect(await screen.findByText(/ffmpeg could not decode that/)).toBeInTheDocument();
  expect(screen.getByRole('dialog')).toBeInTheDocument();
  expect(screen.getByLabelText('Album title')).toHaveValue('Keep me');
});

test('a successful upload sends the file and opens the new album', async () => {
  const fetchMock = renderList([], async () =>
    new Response(JSON.stringify({ album: album('new1', 'Fresh'), job_id: 7 }), { status: 201 }),
  );
  await userEvent.click(screen.getByRole('button', { name: 'Add album' }));
  drop(new File(['b'], 'side-a.flac'));
  await userEvent.type(screen.getByLabelText('Album title'), 'Fresh');
  await userEvent.click(screen.getByRole('button', { name: 'Upload album' }));

  expect(await screen.findByText('editor for new1')).toBeInTheDocument();
  const call = fetchMock.mock.calls.find(([url]) => url === '/api/albums/upload')!;
  const form = call[1]!.body as FormData;
  expect((form.get('file') as File).name).toBe('side-a.flac');
  expect(form.get('title')).toBe('Fresh');
  expect(form.has('artist')).toBe(false);
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
