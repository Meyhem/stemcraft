import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';

import { DEFAULT_THEORY, type TheoryDoc } from '../api/client';
import { TheoryDocProvider, useTheoryDoc, type TheoryDocState } from './TheoryDoc';

let hook!: TheoryDocState;
function Probe() {
  hook = useTheoryDoc();
  return (
    <>
      <p data-testid="tool">{hook.doc ? hook.doc.last_tool : 'loading'}</p>
      <p data-testid="save-error">{hook.saveError ?? ''}</p>
      <p data-testid="load-error">{hook.loadError ?? ''}</p>
    </>
  );
}

const tool = (last_tool: TheoryDoc['last_tool']): ((d: TheoryDoc) => TheoryDoc) => (d) => ({ ...d, last_tool });

/** A server whose PUTs the test settles by hand, in the order they arrive. */
function server(options: { getStatus?: number; putStatus?: number } = {}) {
  const puts: TheoryDoc[] = [];
  const settle: ((status: number) => void)[] = [];
  let inFlight = 0;
  let maxInFlight = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url !== '/api/theory') throw new Error(`unexpected fetch: ${url}`);
      if (init?.method === 'PUT') {
        const body = JSON.parse(String(init.body)) as TheoryDoc;
        puts.push(body);
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        const status = options.putStatus ?? (await new Promise<number>((resolve) => settle.push(resolve)));
        inFlight -= 1;
        return status === 200 ? new Response(JSON.stringify(body)) : new Response('disk full', { status });
      }
      return options.getStatus
        ? new Response(JSON.stringify({ detail: 'theory.json: broken' }), { status: options.getStatus })
        : new Response(JSON.stringify(DEFAULT_THEORY));
    }),
  );
  return { puts, settle, maxInFlight: () => maxInFlight };
}

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={client}>
      <TheoryDocProvider>
        <Probe />
      </TheoryDocProvider>
    </QueryClientProvider>,
  );
  return { client, ...view };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

test('several changes within 500 ms are one PUT with the final document', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  const { puts } = server({ putStatus: 200 });
  mount();
  await screen.findByText('scale-finder');
  act(() => {
    hook.update(tool('note-finder'));
    hook.update(tool('chord-finder'));
    hook.update(tool('triads'));
  });
  expect(puts).toHaveLength(0);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(600);
  });
  expect(puts.map((p) => p.last_tool)).toEqual(['triads']);
});

test('a debounced change still saves when the tab is left', async () => {
  const { puts } = server({ putStatus: 200 });
  const { unmount } = mount();
  await screen.findByText('scale-finder');
  act(() => hook.update(tool('note-finder')));
  unmount();
  await waitFor(() => expect(puts.map((p) => p.last_tool)).toEqual(['note-finder']));
});

test('a save requested during a save waits, then sends the newest document, never two PUTs at once', async () => {
  const s = server();
  mount();
  await screen.findByText('scale-finder');
  act(() => hook.update(tool('note-finder'), { now: true }));
  await waitFor(() => expect(s.puts).toHaveLength(1));
  act(() => hook.update(tool('chord-finder'), { now: true }));
  act(() => hook.update(tool('triads'), { now: true }));
  await act(async () => {
    await new Promise((r) => setTimeout(r, 20));
  });
  expect(s.puts).toHaveLength(1);
  await act(async () => s.settle[0]!(200));
  await waitFor(() => expect(s.puts).toHaveLength(2));
  await act(async () => s.settle[1]!(200));
  await waitFor(() => expect(screen.getByTestId('save-error')).toHaveTextContent(''));
  expect(s.puts.map((p) => p.last_tool)).toEqual(['note-finder', 'triads']);
  expect(s.maxInFlight()).toBe(1);
});

test('a slow older success does not clear a newer failure', async () => {
  const s = server();
  mount();
  await screen.findByText('scale-finder');
  act(() => hook.update(tool('note-finder'), { now: true }));
  await waitFor(() => expect(s.puts).toHaveLength(1));
  act(() => hook.update(tool('triads'), { now: true }));
  await act(async () => s.settle[0]!(200));
  await waitFor(() => expect(s.puts).toHaveLength(2));
  await act(async () => s.settle[1]!(500));
  await waitFor(() => expect(screen.getByTestId('save-error')).toHaveTextContent('disk full'));
  expect(screen.getByTestId('tool')).toHaveTextContent('triads');
});

test('a failed reset keeps the error banner and the defaults visible', async () => {
  server({ getStatus: 500, putStatus: 500 });
  mount();
  await waitFor(() => expect(screen.getByTestId('load-error')).toHaveTextContent('theory.json: broken'));
  await act(async () => {
    await hook.resetToDefaults();
  });
  expect(screen.getByTestId('save-error')).toHaveTextContent('disk full');
  expect(hook.doc).toEqual(DEFAULT_THEORY);
});

test('a flush that fails on unmount is logged and the document is kept in the query cache', async () => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  server({ putStatus: 500 });
  const { client, unmount } = mount();
  await screen.findByText('scale-finder');
  act(() => hook.update(tool('note-finder')));
  unmount();
  await waitFor(() => expect(log).toHaveBeenCalledWith(expect.stringContaining('disk full')));
  expect((client.getQueryData(['theory']) as TheoryDoc).last_tool).toBe('note-finder');
});
