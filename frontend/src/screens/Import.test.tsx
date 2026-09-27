import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, expect, test, vi } from 'vitest';

import { Import } from './Import';

function Landed() {
  return <p>Landed on library</p>;
}

function renderImport(fetchImpl: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>) {
  const fetchMock = vi.fn(fetchImpl);
  vi.stubGlobal('fetch', fetchMock);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/import']}>
        <Routes>
          <Route path="/import" element={<Import />} />
          <Route path="/" element={<Landed />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

test('submitting the file form posts a multipart upload with the typed fields', async () => {
  const fetchMock = renderImport(async () =>
    new Response(JSON.stringify({ song: { id: 's1' }, job_id: 1 }), { status: 201 }),
  );
  const file = new File(['bytes'], 'song.mp3', { type: 'audio/mpeg' });

  await userEvent.upload(screen.getByLabelText(/audio or video file/i), file);
  await userEvent.type(screen.getAllByLabelText(/^title$/i)[0]!, 'My Song');
  await userEvent.click(screen.getByRole('button', { name: /import file/i }));

  await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/songs/upload', expect.anything()));
  const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
  expect(init.method).toBe('POST');
  const form = init.body as FormData;
  expect(form.get('file')).toBe(file);
  expect(form.get('title')).toBe('My Song');

  expect(await screen.findByText('Landed on library')).toBeInTheDocument();
});

test('submitting the url form posts json with url, title and artist', async () => {
  const fetchMock = renderImport(async () =>
    new Response(JSON.stringify({ song: { id: 's2' }, job_id: 2 }), { status: 201 }),
  );

  await userEvent.type(screen.getByLabelText(/^url$/i), 'https://example.com/video');
  await userEvent.type(screen.getAllByLabelText(/^title$/i)[1]!, 'URL Song');
  await userEvent.type(screen.getAllByLabelText(/^artist$/i)[1]!, 'Band');
  await userEvent.click(screen.getByRole('button', { name: /import from url/i }));

  await waitFor(() =>
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/songs/from-url',
      expect.objectContaining({ method: 'POST' }),
    ),
  );
  const call = fetchMock.mock.calls.find(([path]) => path === '/api/songs/from-url');
  const body = JSON.parse((call?.[1] as RequestInit).body as string);
  expect(body).toEqual({ url: 'https://example.com/video', title: 'URL Song', artist: 'Band' });

  expect(await screen.findByText('Landed on library')).toBeInTheDocument();
});

test('a rejected upload shows the real server error and does not navigate away', async () => {
  renderImport(async () => new Response('ffmpeg: invalid data found', { status: 400 }));
  const file = new File(['garbage'], 'bad.mp3', { type: 'audio/mpeg' });

  await userEvent.upload(screen.getByLabelText(/audio or video file/i), file);
  await userEvent.click(screen.getByRole('button', { name: /import file/i }));

  expect(await screen.findByText(/ffmpeg: invalid data found/)).toBeInTheDocument();
  expect(screen.queryByText('Landed on library')).not.toBeInTheDocument();
});

// Guards against a state bug where typing in one form's fields leaks into the other's.
test('typing in the url form does not affect the upload form state', async () => {
  renderImport(async () => new Response('{}', { status: 201 }));
  await userEvent.type(screen.getAllByLabelText(/^title$/i)[1]!, 'Only URL Title');
  expect((screen.getAllByLabelText(/^title$/i)[0]! as HTMLInputElement).value).toBe('');
});
