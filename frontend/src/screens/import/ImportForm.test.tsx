import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';

import { ImportForm } from './ImportForm';

function renderForm(fetchImpl: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>) {
  const fetchMock = vi.fn(fetchImpl);
  vi.stubGlobal('fetch', fetchMock);
  const onCreated = vi.fn();
  const onClose = vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ImportForm onCreated={onCreated} onClose={onClose} />
    </QueryClientProvider>,
  );
  return { fetchMock, onCreated, onClose };
}

const created = (id: string, jobId: number, title: string) =>
  new Response(JSON.stringify({ song: { id, title, artist: 'Band' }, job_id: jobId }), { status: 201 });

afterEach(() => vi.unstubAllGlobals());

test('a chosen file uploads as multipart and reports the created song', async () => {
  const { fetchMock, onCreated } = renderForm(async () => created('s1', 1, 'From Tags'));
  const file = new File(['bytes'], 'tightrope.flac', { type: 'audio/flac' });

  await userEvent.upload(screen.getByLabelText(/audio or video file/i), file);
  await userEvent.click(screen.getByRole('button', { name: /import & separate/i }));

  await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/songs/upload', expect.anything()));
  const form = (fetchMock.mock.calls[0]![1] as RequestInit).body as FormData;
  expect(form.get('file')).toBe(file);
  expect(form.get('title')).toBeNull();
  await waitFor(() =>
    expect(onCreated).toHaveBeenCalledWith({ songId: 's1', jobId: 1, title: 'From Tags', artist: 'Band', source: 'tightrope.flac' }),
  );
});

test('a chosen file collapses the zone to a row; Replace brings it back', async () => {
  renderForm(async () => created('s1', 1, 'T'));
  await userEvent.upload(screen.getByLabelText(/audio or video file/i), new File(['b'], 'a.mp3'));
  expect(screen.getByText(/a\.mp3/)).toBeInTheDocument();
  expect(screen.queryByLabelText(/^link$/i)).not.toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: /replace/i }));
  expect(screen.getByLabelText(/audio or video file/i)).toBeInTheDocument();
  expect(screen.getByLabelText(/^link$/i)).toBeInTheDocument();
});

test('a link posts json and needs a title; the file is cleared', async () => {
  const { fetchMock } = renderForm(async () => created('s2', 2, 'URL Song'));
  const submit = screen.getByRole('button', { name: /import & separate/i });

  await userEvent.type(screen.getByLabelText(/^link$/i), 'https://example.com/v');
  expect(submit).toBeDisabled();
  expect(screen.getByLabelText(/^title/i)).toBeRequired();
  expect(screen.getByText(/no tags to read before it's downloaded/i)).toBeInTheDocument();

  await userEvent.type(screen.getByLabelText(/^title/i), 'URL Song');
  await userEvent.type(screen.getByLabelText(/^artist$/i), 'Band');
  await userEvent.click(submit);

  await waitFor(() =>
    expect(fetchMock).toHaveBeenCalledWith('/api/songs/from-url', expect.objectContaining({ method: 'POST' })),
  );
  const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string);
  expect(body).toEqual({ url: 'https://example.com/v', title: 'URL Song', artist: 'Band' });
});

test('choosing a file after typing a link clears the link', async () => {
  renderForm(async () => created('s1', 1, 'T'));
  await userEvent.type(screen.getByLabelText(/^link$/i), 'https://example.com/v');
  await userEvent.upload(screen.getByLabelText(/audio or video file/i), new File(['b'], 'a.mp3'));
  await userEvent.click(screen.getByRole('button', { name: /replace/i }));
  expect(screen.getByLabelText(/^link$/i)).toHaveValue('');
});

test('nothing chosen means nothing to submit', () => {
  renderForm(async () => created('s1', 1, 'T'));
  expect(screen.getByRole('button', { name: /import & separate/i })).toBeDisabled();
});

test("a rejected upload shows the server's real message and stays open", async () => {
  const { onCreated } = renderForm(async () => new Response('ffmpeg: invalid data found', { status: 400 }));
  await userEvent.upload(screen.getByLabelText(/audio or video file/i), new File(['x'], 'bad.mp3'));
  await userEvent.click(screen.getByRole('button', { name: /import & separate/i }));
  expect(await screen.findByText(/ffmpeg: invalid data found/)).toBeInTheDocument();
  expect(onCreated).not.toHaveBeenCalled();
});

test('Cancel closes', async () => {
  const { onClose } = renderForm(async () => created('s1', 1, 'T'));
  await userEvent.click(screen.getByRole('button', { name: /^cancel$/i }));
  expect(onClose).toHaveBeenCalled();
});

test('a later attempt shows its own error, not the earlier one', async () => {
  let n = 0;
  renderForm(async () => new Response(n++ === 0 ? 'error A: bad file' : 'error B: bad link', { status: 400 }));
  await userEvent.upload(screen.getByLabelText(/audio or video file/i), new File(['x'], 'bad.mp3'));
  await userEvent.click(screen.getByRole('button', { name: /import & separate/i }));
  expect(await screen.findByText(/error A: bad file/)).toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: /replace/i }));
  await userEvent.type(screen.getByLabelText(/^link$/i), 'https://example.com/v');
  await userEvent.type(screen.getByLabelText(/^title/i), 'T');
  await userEvent.click(screen.getByRole('button', { name: /import & separate/i }));

  expect(await screen.findByText(/error B: bad link/)).toBeInTheDocument();
  expect(screen.queryByText(/error A: bad file/)).not.toBeInTheDocument();
});

test('a second submit while the first is in flight sends nothing', async () => {
  const { fetchMock } = renderForm(() => new Promise<Response>(() => {}));
  await userEvent.upload(screen.getByLabelText(/audio or video file/i), new File(['x'], 'a.mp3'));
  // The footer button is disabled while pending, so a second attempt can only
  // arrive as a form submit (Enter in a field): the handler itself must refuse it.
  const form = screen.getByLabelText(/^title/i).closest('form')!;
  fireEvent.submit(form);
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  await screen.findByRole('button', { name: /importing/i });
  fireEvent.submit(form);
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

// user-event does not implement implicit submission for a submit button tied to the
// form by the form= attribute (browsers do), so Enter is exercised as its effect: the
// form's own submit event, which is the single submit path.
test('the form submit event, which Enter fires, submits a ready form', async () => {
  const { fetchMock } = renderForm(async () => created('s1', 1, 'T'));
  await userEvent.upload(screen.getByLabelText(/audio or video file/i), new File(['x'], 'a.mp3'));
  expect(screen.getByRole('button', { name: /import & separate/i })).toHaveAttribute('form', 'import-form');
  fireEvent.submit(screen.getByLabelText(/^title/i).closest('form')!);
  await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/songs/upload', expect.anything()));
});

test('title and artist are trimmed before they are sent', async () => {
  const { fetchMock } = renderForm(async () => created('s1', 1, 'My Song'));
  await userEvent.upload(screen.getByLabelText(/audio or video file/i), new File(['b'], 'a.mp3'));
  await userEvent.type(screen.getByLabelText(/^title/i), '  My Song  ');
  await userEvent.type(screen.getByLabelText(/^artist/i), '   ');
  await userEvent.click(screen.getByRole('button', { name: /import & separate/i }));
  await waitFor(() => expect(fetchMock).toHaveBeenCalled());
  const form = (fetchMock.mock.calls[0]![1] as RequestInit).body as FormData;
  expect(form.get('title')).toBe('My Song');
  expect(form.get('artist')).toBeNull();
});

test('a link posts trimmed title and artist too', async () => {
  const { fetchMock } = renderForm(async () => created('s1', 1, 'My Song'));
  await userEvent.type(screen.getByLabelText(/^link$/i), 'https://example.com/a.mp3');
  await userEvent.type(screen.getByLabelText(/^title/i), '  My Song ');
  await userEvent.type(screen.getByLabelText(/^artist/i), ' Band  ');
  await userEvent.click(screen.getByRole('button', { name: /import & separate/i }));
  await waitFor(() => expect(fetchMock).toHaveBeenCalled());
  expect(JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string)).toEqual({
    url: 'https://example.com/a.mp3',
    title: 'My Song',
    artist: 'Band',
  });
});
