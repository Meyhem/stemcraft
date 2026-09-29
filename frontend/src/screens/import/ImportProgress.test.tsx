import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { expect, test, vi } from 'vitest';

import { ImportProgress } from './ImportProgress';

const created = { songId: 's1', jobId: 5, title: 'Tightrope', artist: 'Walk the Moon', source: 'tightrope.flac' };

function renderProgress(jobs: unknown[]) {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) =>
    String(input).startsWith('/api/job-kinds')
      ? new Response(JSON.stringify({ kinds: {
          import: [{ id: 'decode', label: 'Decode to 48 kHz', weight: 1 }],
          separate: [{ id: 'separate', label: 'Separate 4 stems', weight: 1 }],
          analyze: [{ id: 'key', label: 'Key', weight: 1 }],
        } }))
      : new Response(JSON.stringify({ jobs })),
  ));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ImportProgress created={created} onClose={() => {}} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const step = (id: string, label: string, state: string) => ({
  id, label, weight: 1, state, progress: state === 'running' ? 0.62 : 0, detail: null, started_at: null, finished_at: null,
});
const base = { song_id: 's1', payload: {}, cancel_requested: false, progress: 0, device: 'cuda', lease_until: null,
  created_at: 1, started_at: 1, finished_at: null, error: null, result: null };

test("shows each job's live steps and the declared steps of one not queued yet", async () => {
  renderProgress([
    { ...base, id: 6, kind: 'separate', state: 'running', steps: [step('separate', 'Separate 4 stems', 'running')] },
    { ...base, id: 5, kind: 'import', state: 'done', steps: [step('decode', 'Decode to 48 kHz', 'done')] },
  ]);
  expect(await screen.findByRole('dialog', { name: 'Tightrope' })).toBeInTheDocument();
  const separate = within(screen.getByRole('region', { name: 'separate job' }));
  expect(await separate.findByRole('listitem', { name: 'Separate 4 stems: running' })).toBeInTheDocument();
  const analyze = within(screen.getByRole('region', { name: 'analyze job' }));
  expect(analyze.getByText(/not queued yet/)).toBeInTheDocument();
  expect(await analyze.findByRole('listitem', { name: 'Key: pending' })).toBeInTheDocument();
  expect(separate.getByText('running · cuda')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /open song/i })).toBeDisabled();
  expect(screen.getByText("Closing won't stop the import")).toBeInTheDocument();
  expect(screen.getByRole('link', { name: /open job queue/i })).toHaveAttribute('href', '/jobs?song=s1');
});

test('a failed import shows its error and says the rest will not run', async () => {
  renderProgress([
    { ...base, id: 5, kind: 'import', state: 'failed', error: 'ERROR: [youtube] Sign in to confirm your age.',
      steps: [step('decode', 'Decode to 48 kHz', 'failed')] },
  ]);
  expect(await screen.findByText(/Sign in to confirm your age/)).toBeInTheDocument();
  expect(screen.getAllByText(/won't run: import failed/)).toHaveLength(2);
});

test('a running job without a device is just "running"', async () => {
  renderProgress([
    { ...base, id: 5, kind: 'import', state: 'running', device: null, steps: [step('decode', 'Decode to 48 kHz', 'running')] },
  ]);
  const imp = within(await screen.findByRole('region', { name: 'import job' }));
  expect(await imp.findByText('running')).toBeInTheDocument();
});

test('Open song is a link once analyze is done', async () => {
  renderProgress([
    { ...base, id: 7, kind: 'analyze', state: 'done', steps: [step('key', 'Key', 'done')] },
    { ...base, id: 6, kind: 'separate', state: 'done', steps: [step('separate', 'Separate 4 stems', 'done')] },
    { ...base, id: 5, kind: 'import', state: 'done', steps: [step('decode', 'Decode to 48 kHz', 'done')] },
  ]);
  expect(await screen.findByRole('link', { name: /open song/i })).toHaveAttribute('href', '/songs/s1');
  expect(screen.queryByText("Closing won't stop the import")).not.toBeInTheDocument();
});
