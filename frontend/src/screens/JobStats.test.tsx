import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import { expect, test, vi } from 'vitest';

import { formatAverage, JobStats } from './JobStats';

function renderStats(body: unknown, status = 200) {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status })));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <JobStats />
    </QueryClientProvider>,
  );
}

test('formats averages the way the mockup does', () => {
  expect(formatAverage(2.84)).toBe('2.8 s');
  expect(formatAverage(21.44)).toBe('21.4 s');
  expect(formatAverage(59.96)).toBe('1 m 00 s');
  expect(formatAverage(192)).toBe('3 m 12 s');
  expect(formatAverage(3725)).toBe('1 h 02 m');
});

test('shows passed and failed counts and one card per kind and device', async () => {
  renderStats({
    passed: 312,
    failed: 9,
    durations: [
      { kind: 'separate', device: 'cuda', count: 300, avg_seconds: 21.4 },
      { kind: 'separate', device: 'cpu', count: 2, avg_seconds: 192 },
    ],
  });
  const row = await screen.findByTestId('job-stats');
  expect(within(row).getByText('312')).toBeInTheDocument();
  expect(within(row).getByText('passed')).toBeInTheDocument();
  expect(within(row).getByText('9')).toBeInTheDocument();
  expect(within(row).getByText('avg separate · cuda')).toBeInTheDocument();
  expect(within(row).getByText('21.4 s')).toBeInTheDocument();
  expect(within(row).getByText('3 m 12 s')).toBeInTheDocument();
});

test('a job with no recorded device is labelled with a dash, never as cpu (N-08)', async () => {
  renderStats({
    passed: 1,
    failed: 0,
    durations: [{ kind: 'probe', device: null, count: 1, avg_seconds: 4 }],
  });
  expect(await screen.findByText('avg probe · —')).toBeInTheDocument();
});

test('says so when there is no finished job to average yet', async () => {
  renderStats({ passed: 0, failed: 0, durations: [] });
  expect(await screen.findByText(/no finished jobs yet/i)).toBeInTheDocument();
});

test('shows the real error when the stats cannot be read', async () => {
  renderStats({ detail: 'database is locked' }, 500);
  expect(await screen.findByText(/stats could not be read/i)).toBeInTheDocument();
  expect(screen.getByText(/database is locked/)).toBeInTheDocument();
});
