import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
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
  steps: [],
};

let served: unknown[] = [];
let lastClient: QueryClient;

async function refetchWith(jobs: unknown[]) {
  served = jobs;
  await lastClient.invalidateQueries({ queryKey: ['jobs'] });
}

function renderQueue(jobs: unknown[], path = '/jobs') {
  served = jobs;
  const fetchMock = vi.fn(async (input: RequestInfo | URL) =>
    String(input).includes('/api/jobs/stats')
      ? new Response(JSON.stringify({ passed: 0, failed: 0, durations: [] }))
      : new Response(JSON.stringify({ jobs: served })),
  );
  vi.stubGlobal('fetch', fetchMock);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  lastClient = client;
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <JobQueue />
      </MemoryRouter>
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
  const table = within(await screen.findByRole('list', { name: 'Jobs' }));
  expect(table.getByText('failed')).toHaveClass('chip', 'error');
  expect(table.getByText('done')).toHaveClass('chip', 'ok');
});

test('a job with no recorded device shows a dash, not an empty chip', async () => {
  renderQueue([{ ...job, device: null }]);
  await screen.findByText('probe');
  expect(screen.queryByText('cpu')).toBeNull();
  expect(screen.getAllByText('—').length).toBeGreaterThan(0);
});

const running = {
  ...job,
  kind: 'separate',
  steps: [
    { id: 'load', label: 'Load audio', weight: 0.02, state: 'done', progress: 1, detail: null, started_at: 2, finished_at: 2.4 },
    { id: 'separate', label: 'Separate 4 stems', weight: 0.9, state: 'running', progress: 0.62, detail: null, started_at: 2.4, finished_at: null },
    { id: 'write', label: 'Write stems', weight: 0.08, state: 'pending', progress: 0, detail: null, started_at: null, finished_at: null },
  ],
};

test('the running job opens on its steps; a queued one is collapsed with a strip', async () => {
  renderQueue([running, { ...running, id: 8, state: 'queued', steps: running.steps.map((s) => ({ ...s, state: 'pending' })) }]);
  const open = await screen.findByRole('button', { name: 'Steps of separate job 7' });
  expect(open).toHaveAttribute('aria-expanded', 'true');
  expect(screen.getByRole('listitem', { name: 'Separate 4 stems: running' })).toBeInTheDocument();
  expect(screen.getByText(/step 2 of 3/)).toBeInTheDocument();

  const closed = screen.getByRole('button', { name: 'Steps of separate job 8' });
  expect(closed).toHaveAttribute('aria-expanded', 'false');
  expect(screen.getByRole('img', { name: '0 of 3 steps done' })).toBeInTheDocument();

  await userEvent.click(closed);
  expect(closed).toHaveAttribute('aria-expanded', 'true');
});

test("a failed job opens with its traceback under the failed step", async () => {
  renderQueue([{
    ...job, id: 9, kind: 'analyze', state: 'failed', error: 'Traceback...\nRuntimeError: frame too short',
    steps: [{ id: 'key', label: 'Key', weight: 0.3, state: 'failed', progress: 0, detail: null, started_at: 1, finished_at: 1.6 }],
  }]);
  const step = await screen.findByRole('listitem', { name: 'Key: failed' });
  expect(within(step).getByText(/RuntimeError: frame too short/)).toBeInTheDocument();
  expect(screen.getByText(/failed at step 1 of 1 · Key/)).toBeInTheDocument();
});

test('a job from before step tracking says so when opened', async () => {
  renderQueue([{ ...job, state: 'done', progress: 1 }]);
  await userEvent.click(await screen.findByRole('button', { name: 'Steps of probe job 7' }));
  expect(screen.getByText(/no step record/i)).toBeInTheDocument();
});

test('?song= lists only that song and links back to every job', async () => {
  const fetchMock = renderQueue([running], '/jobs?song=s1');
  expect(await screen.findByRole('link', { name: /show all jobs/i })).toHaveAttribute('href', '/jobs');
  expect(fetchMock).toHaveBeenCalledWith('/api/jobs?song_id=s1', expect.anything());
});

test('a queued row that then fails opens by itself, traceback visible without a click', async () => {
  renderQueue([{ ...running, state: 'queued' }]);
  const button = await screen.findByRole('button', { name: 'Steps of separate job 7' });
  expect(button).toHaveAttribute('aria-expanded', 'false');

  await refetchWith([{
    ...running, state: 'failed', error: 'Traceback...\nRuntimeError: late failure',
    steps: running.steps.map((s) => (s.state === 'running' ? { ...s, state: 'failed' } : s)),
  }]);
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Steps of separate job 7' })).toHaveAttribute('aria-expanded', 'true'),
  );
  expect(screen.getByText(/RuntimeError: late failure/)).toBeInTheDocument();
});

test("a user's choice survives a refetch", async () => {
  renderQueue([running]);
  const button = await screen.findByRole('button', { name: 'Steps of separate job 7' });
  expect(button).toHaveAttribute('aria-expanded', 'true');
  await userEvent.click(button);
  expect(button).toHaveAttribute('aria-expanded', 'false');

  await refetchWith([{ ...running, progress: 0.5 }]);
  await waitFor(() => expect(screen.getByText(/50% overall/)).toBeInTheDocument());
  expect(screen.getByRole('button', { name: 'Steps of separate job 7' })).toHaveAttribute('aria-expanded', 'false');
});

test('?song= expands every row', async () => {
  renderQueue([running, { ...running, id: 8, state: 'done', progress: 1 }], '/jobs?song=s1');
  const buttons = await screen.findAllByRole('button', { name: /^Steps of/ });
  expect(buttons).toHaveLength(2);
  for (const b of buttons) expect(b).toHaveAttribute('aria-expanded', 'true');
});
