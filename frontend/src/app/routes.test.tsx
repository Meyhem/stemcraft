import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, expect, test, vi } from 'vitest';

import { AppRoutes } from './routes';

function renderAt(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <AppRoutes />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify({ deps: [], device: null, sample_rate: 48000 }))),
  );
});

test('the library is the index route', async () => {
  renderAt('/');
  expect(await screen.findByRole('heading', { name: /library/i })).toBeInTheDocument();
});

test.each([
  ['/import', /import/i],
  ['/jobs', /job queue/i],
  ['/splitter', /album splitter/i],
  ['/songs/01ABC', /song/i],
  ['/songs/01ABC/scale', /scale/i],
  ['/songs/01ABC/export', /export/i],
])('%s renders its screen', async (path, heading) => {
  renderAt(path);
  expect(await screen.findByRole('heading', { name: heading })).toBeInTheDocument();
});

test('an unknown path shows a not-found screen rather than a blank page', async () => {
  renderAt('/nope');
  expect(await screen.findByText(/not found/i)).toBeInTheDocument();
});
