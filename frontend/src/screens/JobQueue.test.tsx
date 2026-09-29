import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';

import { JobQueue } from './JobQueue';

const job = {
  id: 7,
  song_id: null,
  kind: 'probe',
  payload: {},
  state: 'running',
  cancel_requested: false,
  progress: 0.42,
  device: 'cpu',
  lease_until: null,
  created_at: 1,
  started_at: 2,
  finished_at: null,
  error: null,
  result: null,
};

function renderQueue(jobs: unknown[]) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) =>
    String(input).includes('/api/jobs/stats')
      ? new Response(JSON.stringify({ passed: 0, failed: 0, durations: [] }))
      : new Response(JSON.stringify({ jobs })),
  );
  vi.stubGlobal('fetch', fetchMock);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <JobQueue />
    </QueryClientProvider>,
  );
  return fetchMock;
}

test('renders kind, state, device and progress', async () => {
  renderQueue([job]);
  expect(await screen.findByText('probe')).toBeInTheDocument();
  expect(screen.getByText('running')).toBeInTheDocument();
  expect(screen.getByText('cpu')).toBeInTheDocument();
  expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '42');
});

test('shows the all-time stats below the queue', async () => {
  renderQueue([job]);
  expect(await screen.findByTestId('job-stats')).toBeInTheDocument();
});

test('shows the real error text for a failed job', async () => {
  renderQueue([{ ...job, state: 'failed', error: 'Traceback...\nRuntimeError: boom' }]);
  // N-08: the traceback is the point of the screen, not a detail to hide.
  expect(await screen.findByText(/RuntimeError: boom/)).toBeInTheDocument();
});

test('cancel posts to the job endpoint', async () => {
  const fetchMock = renderQueue([job]);
  await screen.findByText('probe');
  await userEvent.click(screen.getByRole('button', { name: /cancel/i }));
  await waitFor(() =>
    expect(fetchMock).toHaveBeenCalledWith('/api/jobs/7/cancel', expect.objectContaining({ method: 'POST' })),
  );
});

test('an empty queue says so instead of rendering an empty table', async () => {
  renderQueue([]);
  expect(await screen.findByText(/no jobs yet/i)).toBeInTheDocument();
});

test('a failed job and a done job never share a chip tone', async () => {
  // U-01's whole reason for splitting the palette by saturation is that "drums red"
  // and "failed red" must not collide. The weaker version of this test -- asserting
  // the words "failed" and "done" are on screen -- passed against the old bare-text
  // markup and would pass against a queue that painted both green.
  renderQueue([
    { ...job, id: 1, kind: 'separate', state: 'failed', progress: 1, error: 'boom' },
    { ...job, id: 2, kind: 'analyze', state: 'done', progress: 1 },
  ]);

  // The stats row also carries a "failed" label, so scope the lookup to the table.
  const table = within(await screen.findByRole('table'));
  expect(table.getByText('failed')).toHaveClass('chip', 'error');
  expect(table.getByText('done')).toHaveClass('chip', 'ok');
});

test('a job with no recorded device shows a dash, not an empty chip', async () => {
  renderQueue([{ ...job, device: null }]);
  await screen.findByText('probe');
  expect(screen.queryByText('cpu')).toBeNull();
  expect(screen.getAllByText('—').length).toBeGreaterThan(0);
});
