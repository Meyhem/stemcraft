import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { useContext, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, expect, test, vi } from 'vitest';

import type { Health } from '../api/client';
import { AppShell } from './AppShell';
import { PulseSlotContext } from './pulseSlot';

// The job stream opens a WebSocket, which jsdom does not provide and this test is not
// about.
vi.mock('../api/useJobStream', () => ({ useJobStream: () => {} }));

function renderShell(health: Health, body: ReactNode = <p>page body</p>) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify(health), { status: 200 })),
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <Routes>
          <Route element={<AppShell />}>
            <Route index element={body} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

const healthy: Health = { deps: [], device: 'cuda', fallback_reason: null, sample_rate: 48000 };

test('a broken dependency is an alert naming it and quoting the real error (N-08)', async () => {
  renderShell({
    ...healthy,
    deps: [
      { name: 'ffmpeg', ok: false, detail: 'ffmpeg: command not found on PATH' },
      { name: 'yt-dlp', ok: true, detail: '2026.09.01' },
    ],
  });

  const alert = await screen.findByRole('alert');
  expect(alert).toHaveTextContent('ffmpeg');
  // The real message, verbatim -- not a paraphrase.
  expect(alert).toHaveTextContent('ffmpeg: command not found on PATH');
  // A healthy dependency is not reported as broken.
  expect(alert).not.toHaveTextContent('yt-dlp');
});

test('running on the CPU is a visible status that says why (N-08)', async () => {
  renderShell({ ...healthy, device: 'cpu', fallback_reason: 'CUDA kernel probe failed' });

  const status = await screen.findByRole('status');
  expect(status).toHaveTextContent('Running separation on CPU');
  expect(status).toHaveTextContent('CUDA kernel probe failed');
});

test('a healthy system shows no banner at all', async () => {
  renderShell(healthy);
  await screen.findByText('page body');
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.queryByRole('status')).toBeNull();
});

test('a broken dependency suppresses the CPU notice rather than stacking on it', async () => {
  renderShell({
    ...healthy,
    device: 'cpu',
    fallback_reason: 'no CUDA',
    deps: [{ name: 'ffmpeg', ok: false, detail: 'missing' }],
  });
  await screen.findByRole('alert');
  expect(screen.queryByRole('status')).toBeNull();
});

test('a page can draw into a decorative slot on the navbar', async () => {
  function IntoSlot() {
    const slot = useContext(PulseSlotContext);
    return slot ? createPortal(<span>pulse</span>, slot) : null;
  }
  renderShell(healthy, <IntoSlot />);

  const drawn = await screen.findByText('pulse');
  const slot = drawn.parentElement!;
  expect(slot.parentElement).toBe(screen.getByRole('navigation'));
  // Decoration only: it must not be announced or reachable.
  expect(slot).toHaveAttribute('aria-hidden', 'true');
});
