import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';

import { DEFAULT_PRACTICE, type PracticeDoc } from '../api/client';
import { PracticeDocProvider, usePracticeDoc } from './PracticeDoc';

function serve(options: { get?: () => Response; put?: (body: PracticeDoc) => Response } = {}) {
  const puts: PracticeDoc[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url !== '/api/practice') throw new Error(`unexpected fetch: ${url}`);
      if (init?.method === 'PUT') {
        const body = JSON.parse(String(init.body)) as PracticeDoc;
        puts.push(body);
        return options.put ? options.put(body) : new Response(JSON.stringify(body));
      }
      return options.get ? options.get() : new Response(JSON.stringify(DEFAULT_PRACTICE));
    }),
  );
  return puts;
}

let state: ReturnType<typeof usePracticeDoc>;
function Probe() {
  state = usePracticeDoc();
  return <p>{state.doc ? `bpm ${state.doc.bass.bpm}` : (state.loadError ?? 'loading')}</p>;
}

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <PracticeDocProvider>
        <Probe />
      </PracticeDocProvider>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

test('a change shows at once and is PUT once after the debounce', async () => {
  const puts = serve();
  mount();
  await screen.findByText('bpm 100');
  act(() => {
    state.update((d) => ({ ...d, bass: { ...d.bass, bpm: 110 } }));
    state.update((d) => ({ ...d, bass: { ...d.bass, bpm: 120 } }));
  });
  expect(screen.getByText('bpm 120')).toBeInTheDocument();
  await waitFor(() => expect(puts).toHaveLength(1), { timeout: 2000 });
  expect(puts[0]!.bass.bpm).toBe(120);
});

test('a failed save says so, keeps the change, and Retry sends it', async () => {
  let fail = true;
  const puts = serve({
    put: (body) => (fail ? new Response(JSON.stringify({ detail: 'disk full' }), { status: 500 }) : new Response(JSON.stringify(body))),
  });
  mount();
  await screen.findByText('bpm 100');
  act(() => void state.update((d) => ({ ...d, bass: { ...d.bass, bpm: 90 } })));
  await waitFor(() => expect(state.saveError).toContain('disk full'), { timeout: 2000 });
  expect(screen.getByText('bpm 90')).toBeInTheDocument();
  fail = false;
  act(() => state.retry());
  await waitFor(() => expect(state.saveError).toBeNull());
  expect(puts.at(-1)!.bass.bpm).toBe(90);
});

test('an unreadable file is shown verbatim and nothing is written over it', async () => {
  const puts = serve({ get: () => new Response(JSON.stringify({ detail: 'practice.json: invalid JSON at line 1' }), { status: 500 }) });
  mount();
  await screen.findByText(/invalid JSON at line 1/);
  let applied = true;
  act(() => void (applied = state.update((d) => d)));
  expect(applied).toBe(false);
  expect(puts).toHaveLength(0);
});

test('leaving with a pending change saves it at once', async () => {
  const puts = serve();
  const view = mount();
  await screen.findByText('bpm 100');
  act(() => void state.update((d) => ({ ...d, instrument: 'guitar' })));
  view.unmount();
  await waitFor(() => expect(puts).toHaveLength(1));
  expect(puts[0]!.instrument).toBe('guitar');
});
