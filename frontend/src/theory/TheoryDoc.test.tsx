import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';

import { DEFAULT_THEORY, type TheoryDoc } from '../api/client';
import { forgetUnsavedTheory, TheoryDocProvider, useTheoryDoc, type TheoryDocState } from './TheoryDoc';

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

function mount(client = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
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
  cleanup(); // leaving the tab with an unsaved document keeps it for the next tab; none may leak into the next test
  forgetUnsavedTheory();
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
  vi.spyOn(console, 'error').mockImplementation(() => {});
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
  vi.spyOn(console, 'error').mockImplementation(() => {});
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

// ---------------------------------------------------------------- leaving with unsaved changes (N-08)

/** The app's own query defaults, but with staleness reproduced: coming back refetches the file as the server has it. */
const appClient = () => new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 0, refetchOnWindowFocus: false } } });

test('a failed save left unsaved is logged on leaving, and the next tab shows it, saves it again, and stops once that works', async () => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  server({ putStatus: 500 });
  const client = appClient();
  const first = mount(client);
  await screen.findByText('scale-finder');
  act(() => hook.update(tool('note-finder'), { now: true }));
  await waitFor(() => expect(screen.getByTestId('save-error')).toHaveTextContent('disk full'));
  first.unmount(); // no Retry pressed
  expect(log).toHaveBeenCalledWith(expect.stringContaining('leaving the tab'));

  // Back on the tab: the server still has the old document, and it is refetched.
  const back = server({ putStatus: 200 });
  const second = mount(client);
  await waitFor(() => expect(screen.getByTestId('tool')).toHaveTextContent('note-finder'));
  await waitFor(() => expect(back.puts.map((p) => p.last_tool)).toEqual(['note-finder']));
  await waitFor(() => expect(client.isFetching()).toBe(0));
  expect(screen.getByTestId('tool')).toHaveTextContent('note-finder'); // the refetch did not overwrite it
  expect(screen.getByTestId('save-error')).toHaveTextContent('');
  second.unmount();

  // A third visit has nothing to save again and shows the server's document.
  const third = server({ putStatus: 200 });
  mount(client);
  await waitFor(() => expect(screen.getByTestId('tool')).toHaveTextContent('scale-finder'));
  await waitFor(() => expect(client.isFetching()).toBe(0));
  expect(third.puts).toHaveLength(0);
});

test('when saving it again fails too, the next tab shows the Couldn’t-save state with the change kept, and Retry works', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  server({ putStatus: 500 });
  const first = mount(appClient());
  await screen.findByText('scale-finder');
  act(() => hook.update(tool('triads'), { now: true }));
  await waitFor(() => expect(screen.getByTestId('save-error')).toHaveTextContent('disk full'));
  first.unmount();

  server({ putStatus: 500 });
  const second = mount(appClient());
  await waitFor(() => expect(screen.getByTestId('save-error')).toHaveTextContent('disk full'));
  expect(screen.getByTestId('tool')).toHaveTextContent('triads');
  second.unmount(); // still unsaved: kept for one more visit

  const ok = server({ putStatus: 200 });
  mount(appClient());
  await waitFor(() => expect(ok.puts.map((p) => p.last_tool)).toEqual(['triads']));
  expect(screen.getByTestId('tool')).toHaveTextContent('triads');
});

test('Retry after coming back sends the kept document', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  server({ putStatus: 500 });
  const first = mount(appClient());
  await screen.findByText('scale-finder');
  act(() => hook.update(tool('triads'), { now: true }));
  await waitFor(() => expect(screen.getByTestId('save-error')).toHaveTextContent('disk full'));
  first.unmount();
  let ok = false;
  const puts: TheoryDoc[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method !== 'PUT') return new Response(JSON.stringify(DEFAULT_THEORY));
      puts.push(JSON.parse(String(init.body)));
      return ok ? new Response(String(init.body)) : new Response('disk full', { status: 500 });
    }),
  );
  mount(appClient());
  await waitFor(() => expect(screen.getByTestId('save-error')).toHaveTextContent('disk full'));
  ok = true;
  await act(async () => hook.retry());
  await waitFor(() => expect(screen.getByTestId('save-error')).toHaveTextContent(''));
  expect(puts.map((p) => p.last_tool)).toEqual(['triads', 'triads']);
});

test('nothing is kept when nothing was unsaved, and a saved change is not kept either', async () => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  const first = server({ putStatus: 200 });
  const a = mount(appClient());
  await screen.findByText('scale-finder');
  a.unmount();
  const b = mount(appClient());
  await screen.findByText('scale-finder');
  act(() => hook.update(tool('triads'), { now: true }));
  await waitFor(() => expect(first.puts).toHaveLength(1));
  await waitFor(() => expect(screen.getByTestId('save-error')).toHaveTextContent(''));
  b.unmount();
  expect(log).not.toHaveBeenCalled();
  const later = server({ putStatus: 200 });
  mount(appClient());
  await screen.findByText('scale-finder'); // the server's document; nothing of ours was carried over
  expect(later.puts).toHaveLength(0);
});

test('an unloaded document is never kept or saved: no theory.json to read, nothing to overwrite it with', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const s = server({ getStatus: 500, putStatus: 200 });
  const a = mount(appClient());
  await waitFor(() => expect(screen.getByTestId('load-error')).toHaveTextContent('broken'));
  act(() => hook.update(tool('triads'), { now: true })); // no document: nothing happens
  a.unmount();
  server({ putStatus: 200 });
  mount(appClient());
  await screen.findByText('scale-finder');
  expect(s.puts).toHaveLength(0);
});

test('a kept document is not applied over a file that cannot be read', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  server({ putStatus: 500 });
  const a = mount(appClient());
  await screen.findByText('scale-finder');
  act(() => hook.update(tool('triads'), { now: true }));
  await waitFor(() => expect(screen.getByTestId('save-error')).toHaveTextContent('disk full'));
  a.unmount();
  const broken = server({ getStatus: 500, putStatus: 200 });
  mount(appClient());
  await waitFor(() => expect(screen.getByTestId('load-error')).toHaveTextContent('broken'));
  expect(broken.puts).toHaveLength(0);
});

test('reset to defaults forgets a kept document', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  server({ putStatus: 500 });
  const a = mount(appClient());
  await screen.findByText('scale-finder');
  act(() => hook.update(tool('triads'), { now: true }));
  await waitFor(() => expect(screen.getByTestId('save-error')).toHaveTextContent('disk full'));
  a.unmount();
  server({ getStatus: 500, putStatus: 200 });
  const b = mount(appClient());
  await waitFor(() => expect(screen.getByTestId('load-error')).toHaveTextContent('broken'));
  await act(async () => {
    await hook.resetToDefaults();
  });
  b.unmount();
  const c = server({ putStatus: 200 });
  mount(appClient());
  await screen.findByText('scale-finder');
  expect(c.puts).toHaveLength(0);
});

test('the browser is asked to warn before unload only while something is unsaved', async () => {
  const add = vi.spyOn(window, 'addEventListener');
  const remove = vi.spyOn(window, 'removeEventListener');
  const listeners = () => add.mock.calls.filter((c) => c[0] === 'beforeunload').length - remove.mock.calls.filter((c) => c[0] === 'beforeunload').length;
  const s = server();
  const view = mount(appClient());
  await screen.findByText('scale-finder');
  expect(listeners()).toBe(0);
  act(() => hook.update(tool('note-finder'), { now: true }));
  await waitFor(() => expect(s.puts).toHaveLength(1));
  expect(listeners()).toBe(1);
  // A change made while that save is in flight is not covered by it: still unsaved when it succeeds.
  act(() => hook.update(tool('triads')));
  await act(async () => s.settle[0]!(200));
  expect(listeners()).toBe(1);
  await waitFor(() => expect(s.puts).toHaveLength(2)); // the debounce or the queued save sends the newer one
  await act(async () => s.settle[1]!(200));
  await waitFor(() => expect(listeners()).toBe(0));
  const event = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(false); // clean: no prompt

  act(() => hook.update(tool('chord-finder')));
  expect(listeners()).toBe(1);
  const prompt = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(prompt);
  expect(prompt.defaultPrevented).toBe(true);
  vi.spyOn(console, 'error').mockImplementation(() => {});
  view.unmount();
  await waitFor(() => expect(s.puts).toHaveLength(3));
  await act(async () => s.settle[2]!(200));
  expect(listeners()).toBe(0);
});
