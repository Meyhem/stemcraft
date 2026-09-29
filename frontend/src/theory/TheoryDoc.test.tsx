import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, expect, test, vi } from 'vitest';

import { DEFAULT_THEORY, type QuizAnswer, type TheoryDoc } from '../api/client';
import { forgetUnsavedTheory, mergeHistory, TheoryDocProvider, useTheoryDoc, type TheoryDocState } from './TheoryDoc';

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

/** Leaves the tab now: its unsaved-changes report is made a moment later, while the console spy is still on. */
async function leaveTab() {
  cleanup();
  await new Promise((r) => setTimeout(r, 0));
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
  await leaveTab();
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
  await leaveTab();
});

test('a flush that fails on unmount is logged and the document is kept in memory, with the browser asked to warn', async () => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  server({ putStatus: 500 });
  const { unmount } = mount();
  await screen.findByText('scale-finder');
  act(() => hook.update(tool('note-finder')));
  unmount();
  await waitFor(() => expect(log).toHaveBeenCalledWith(expect.stringContaining('disk full')));
  expect(log).toHaveBeenCalledWith(expect.stringContaining('unsaved changes, kept in memory'));
  expect(unloadPrompted()).toBe(true);
});

// ---------------------------------------------------------------- leaving with unsaved changes (N-08)

/** Whether closing the page now would be warned about. */
function unloadPrompted(): boolean {
  const event = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}

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
  await waitFor(() => expect(log).toHaveBeenCalledWith(expect.stringContaining('unsaved changes, kept in memory')));
  expect(log).toHaveBeenCalledWith(expect.stringContaining('disk full')); // the reason, from the save that failed

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

test('a kept document is never written over a file that cannot be read, with the same QueryClient across leaving and returning', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  server({ putStatus: 500 });
  const client = appClient(); // the app's one client: the document the first tab read is still cached when the player returns
  const first = mount(client);
  await screen.findByText('scale-finder');
  act(() => hook.update(tool('triads'), { now: true }));
  await waitFor(() => expect(screen.getByTestId('save-error')).toHaveTextContent('disk full'));
  first.unmount();

  const broken = server({ getStatus: 500, putStatus: 200 }); // meanwhile theory.json became unreadable
  mount(client);
  await waitFor(() => expect(screen.getByTestId('load-error')).toHaveTextContent('broken'));
  await waitFor(() => expect(client.isFetching()).toBe(0));
  await act(async () => {
    await new Promise((r) => setTimeout(r, 50));
  });
  expect(broken.puts).toHaveLength(0);
  expect(unloadPrompted()).toBe(true); // still kept, still warned about
});

test('nothing is written while this visit’s GET is still in flight; the kept document is saved once it has read the file', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  server({ putStatus: 500 });
  const client = appClient();
  const first = mount(client);
  await screen.findByText('scale-finder');
  act(() => hook.update(tool('triads'), { now: true }));
  await waitFor(() => expect(screen.getByTestId('save-error')).toHaveTextContent('disk full'));
  first.unmount();

  const puts: TheoryDoc[] = [];
  let answerGet!: () => void;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'PUT') {
        puts.push(JSON.parse(String(init.body)));
        return new Response(String(init.body));
      }
      await new Promise<void>((resolve) => (answerGet = resolve));
      return new Response(JSON.stringify(DEFAULT_THEORY));
    }),
  );
  mount(client);
  await act(async () => {
    await new Promise((r) => setTimeout(r, 50));
  });
  expect(puts).toHaveLength(0); // the cached copy is not a read of the file
  await act(async () => answerGet());
  await waitFor(() => expect(puts.map((p) => p.last_tool)).toEqual(['triads']));
});

const answer = (i: number, at: string, item = `s0f${i}`): QuizAnswer => ({ quiz: 'fretboard', mode: 'name-note', item, correct: true, ms: 100, at });

test('mergeHistory: every answer once, oldest first, the newest 2,000, mixed time formats in time order', () => {
  const a = answer(1, '2026-01-01T00:00:00Z');
  const b = answer(2, '2026-01-01T00:00:00.500Z');
  const c = answer(3, '2026-01-01T00:00:01.000Z');
  expect(mergeHistory([c, a], [b, { ...a }])).toEqual([a, b, c]);
  const many = Array.from({ length: 2005 }, (_, i) => answer(i, new Date(2026, 0, 1, 0, 0, i).toISOString()));
  const merged = mergeHistory(many.slice(0, 1500), many.slice(1000));
  expect(merged).toHaveLength(2000);
  expect(merged.at(-1)).toEqual(many[2004]);
  expect(merged[0]).toEqual(many[5]);
});

test('coming back after another browser tab added answers: both sets are kept, deduplicated, and the kept document decides the rest', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const mine = [answer(1, '2026-03-01T00:00:10.000Z'), answer(2, '2026-03-01T00:00:20.000Z'), answer(3, '2026-03-01T00:00:30.000Z')];
  server({ putStatus: 500 });
  const first = mount(appClient());
  await screen.findByText('scale-finder');
  act(() => hook.update((d) => ({ ...d, quiz: { ...d.quiz, history: mine } }), { now: true }));
  await waitFor(() => expect(screen.getByTestId('save-error')).toHaveTextContent('disk full'));
  first.unmount();

  const theirs = Array.from({ length: 40 }, (_, i) => answer(100 + i, `2026-03-01T00:00:${String(15 + (i % 30)).padStart(2, '0')}.${String(i).padStart(3, '0')}Z`));
  const other: TheoryDoc = { ...DEFAULT_THEORY, instrument: { ...DEFAULT_THEORY.instrument, left_handed: true }, quiz: { ...DEFAULT_THEORY.quiz, history: [...theirs, { ...mine[0]! }] } };
  const s = server({ putStatus: 200 });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'PUT') {
        s.puts.push(JSON.parse(String(init.body)));
        return new Response(String(init.body));
      }
      return new Response(JSON.stringify(other));
    }),
  );
  mount(appClient());
  await waitFor(() => expect(s.puts).toHaveLength(1));
  const sent = s.puts[0]!;
  expect(sent.quiz.history).toHaveLength(43);
  expect(new Set(sent.quiz.history.map((a) => `${a.item}|${a.at}`)).size).toBe(43);
  const times = sent.quiz.history.map((a) => Date.parse(a.at));
  expect(times).toEqual([...times].sort((x, y) => x - y));
  expect(sent.instrument.left_handed).toBe(false); // the kept document's own fields win
});

test('the browser is asked to warn while a kept document exists after leaving, until a save succeeds', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  server({ putStatus: 500 });
  const first = mount(appClient());
  await screen.findByText('scale-finder');
  expect(unloadPrompted()).toBe(false);
  act(() => hook.update(tool('triads'), { now: true }));
  await waitFor(() => expect(screen.getByTestId('save-error')).toHaveTextContent('disk full'));
  first.unmount();
  expect(unloadPrompted()).toBe(true); // nobody is left on the page to hold it but the kept document
  const ok = server({ putStatus: 200 });
  mount(appClient());
  await waitFor(() => expect(ok.puts).toHaveLength(1));
  await waitFor(() => expect(unloadPrompted()).toBe(false));
});

test('the unload guard is taken again after StrictMode’s simulated unmount', async () => {
  const s = server({ putStatus: 200 });
  render(
    <QueryClientProvider client={appClient()}>
      <StrictMode>
        <TheoryDocProvider>
          <Probe />
        </TheoryDocProvider>
      </StrictMode>
    </QueryClientProvider>,
  );
  await screen.findByText('scale-finder');
  act(() => hook.update(tool('triads')));
  expect(unloadPrompted()).toBe(true);
  await waitFor(() => expect(s.puts).toHaveLength(1));
  await waitFor(() => expect(unloadPrompted()).toBe(false));
});

// ---------------------------------------------------------------- returning while the GET is slow (Probes K, E2)

/** The app's client (staleTime 5 s) and fake time, so that the cached document is stale a few seconds after leaving. */
function slowGetWorld() {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 5000, refetchOnWindowFocus: false } } });
  const puts: TheoryDoc[] = [];
  let held: ((status: number) => void) | null = null;
  let heldSince = 0; // how many GETs have been asked for
  let answered = 0;
  let putStatus = 200;
  let fileText: TheoryDoc = DEFAULT_THEORY;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'PUT') {
        puts.push(JSON.parse(String(init.body)));
        return putStatus === 200 ? new Response(String(init.body)) : new Response('disk full', { status: putStatus });
      }
      const status = await new Promise<number>((resolve) => {
        held = resolve;
        heldSince += 1;
      });
      return status === 200 ? new Response(JSON.stringify(fileText)) : new Response(JSON.stringify({ detail: 'theory.json: broken' }), { status });
    }),
  );
  return {
    client,
    puts,
    setPutStatus: (n: number) => (putStatus = n),
    setFile: (doc: TheoryDoc) => (fileText = doc),
    /** Answers the GET being held. */
    answerGet: async (status = 200) => {
      const before = answered;
      await waitFor(() => expect(heldSince).toBeGreaterThan(before));
      answered = heldSince;
      await act(async () => held!(status));
    },
    pastStale: () => vi.setSystemTime(Date.now() + 6000),
    wait: (ms: number) => act(async () => vi.advanceTimersByTimeAsync(ms)),
  };
}

const three = [answer(1, '2026-03-01T00:00:10.000Z'), answer(2, '2026-03-01T00:00:20.000Z'), answer(3, '2026-03-01T00:00:30.000Z')];
const withAnswers = (list: QuizAnswer[]) => (d: TheoryDoc): TheoryDoc => ({ ...d, quiz: { ...d.quiz, history: [...d.quiz.history, ...list] } });

/** A first visit whose save of `three` failed, then left. */
async function leaveWithKeptRound(w: ReturnType<typeof slowGetWorld>) {
  w.setPutStatus(500);
  const first = mount(w.client);
  await w.wait(0);
  await w.answerGet();
  await screen.findByText('scale-finder');
  act(() => hook.update(withAnswers(three), { now: true }));
  await waitFor(() => expect(screen.getByTestId('save-error')).toHaveTextContent('disk full'));
  first.unmount();
  await w.wait(0);
  w.puts.length = 0;
  w.setPutStatus(200);
  w.pastStale();
}

test('Probe K: a save from the stale cached document does not clear the kept answers; they go out with the edits, once the GET answers', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const w = slowGetWorld();
  await leaveWithKeptRound(w);
  mount(w.client); // the GET is slow: the cached document is on screen meanwhile
  await screen.findByText('scale-finder');
  act(() => hook.update(tool('triads'))); // the player moves on to another tool
  await w.wait(1500);
  expect(w.puts).toHaveLength(0); // nothing is written from the cached document
  expect(unloadPrompted()).toBe(true);
  await w.answerGet();
  await waitFor(() => expect(w.puts).toHaveLength(1));
  expect(w.puts[0]!.quiz.history).toHaveLength(3);
  expect(w.puts[0]!.last_tool).toBe('triads'); // the edit made during the wait is not lost
  await waitFor(() => expect(unloadPrompted()).toBe(false));
});

test('Probe K: a setting changed during the wait survives the kept document being applied', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const w = slowGetWorld();
  await leaveWithKeptRound(w);
  mount(w.client);
  await screen.findByText('scale-finder');
  act(() => hook.update((d) => ({ ...d, instrument: { ...d.instrument, left_handed: true } })));
  act(() => hook.update(tool('note-finder'), { now: true }));
  await w.answerGet();
  await waitFor(() => expect(w.puts).toHaveLength(1));
  expect(w.puts[0]!.instrument.left_handed).toBe(true);
  expect(w.puts[0]!.last_tool).toBe('note-finder');
  expect(w.puts[0]!.quiz.history).toHaveLength(3);
});

test('Probe E2: the file became unreadable while away: no PUT from the cached document, a round played on it included, and the kept answers stay kept', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const w = slowGetWorld();
  await leaveWithKeptRound(w);
  mount(w.client);
  await screen.findByText('scale-finder');
  act(() => hook.update(withAnswers([answer(9, '2026-03-02T00:00:00.000Z')]), { now: true })); // a round's save
  await w.wait(1500);
  expect(w.puts).toHaveLength(0);
  await w.answerGet(500); // the GET fails: theory.json can't be read
  await waitFor(() => expect(screen.getByTestId('load-error')).toHaveTextContent('broken'));
  expect(hook.doc).toBeNull();
  await w.wait(1500);
  expect(w.puts).toHaveLength(0);
  expect(unloadPrompted()).toBe(true);

  // The file is readable again on the next visit: the kept answers, and the ones played meanwhile, all go out.
  cleanup();
  await w.wait(0);
  w.pastStale();
  mount(w.client);
  await w.wait(0);
  await w.answerGet();
  await waitFor(() => expect(w.puts).toHaveLength(1));
  expect(w.puts[0]!.quiz.history).toHaveLength(4);
});

test('a refetch that fails takes the document away and blocks every save until a reset or a read that works (U-09)', async () => {
  const w = slowGetWorld();
  mount(w.client);
  await w.answerGet();
  await screen.findByText('scale-finder');
  act(() => void w.client.invalidateQueries({ queryKey: ['theory'] }));
  await w.wait(0);
  await w.answerGet(500);
  await waitFor(() => expect(screen.getByTestId('load-error')).toHaveTextContent('broken'));
  expect(hook.doc).toBeNull();
  act(() => hook.update(tool('triads'), { now: true }));
  await w.wait(1500);
  expect(w.puts).toHaveLength(0);

  let reset!: Promise<void>;
  act(() => {
    reset = hook.resetToDefaults(); // the confirmed reset is still allowed; it re-reads the file afterwards
  });
  await waitFor(() => expect(w.puts).toHaveLength(1));
  expect(w.puts[0]).toEqual(DEFAULT_THEORY);
  await w.answerGet();
  await act(async () => reset);
  expect(hook.doc).toEqual(DEFAULT_THEORY);
});

test('a refetch that fails while this tab has unsaved changes keeps them in memory, and they go out after a read that works', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const w = slowGetWorld();
  w.setPutStatus(500);
  mount(w.client);
  await w.answerGet();
  await screen.findByText('scale-finder');
  act(() => hook.update(tool('triads'), { now: true }));
  await waitFor(() => expect(screen.getByTestId('save-error')).toHaveTextContent('disk full'));
  act(() => void w.client.invalidateQueries({ queryKey: ['theory'] }));
  await w.wait(0);
  await w.answerGet(500);
  await waitFor(() => expect(hook.doc).toBeNull());
  expect(unloadPrompted()).toBe(true);
  w.setPutStatus(200);
  act(() => void w.client.invalidateQueries({ queryKey: ['theory'] }));
  await w.wait(0);
  await w.answerGet();
  await waitFor(() => expect(w.puts.at(-1)?.last_tool).toBe('triads'));
  await waitFor(() => expect(hook.doc?.last_tool).toBe('triads'));
});

// ---------------------------------------------------------------- a failed read can be tried again (I1)

test('a failed read can be tried again: the document is shown and a kept document is applied and saved once', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  server({ putStatus: 500 });
  const first = mount(appClient());
  await screen.findByText('scale-finder');
  act(() => hook.update(tool('triads'), { now: true }));
  await waitFor(() => expect(screen.getByTestId('save-error')).toHaveTextContent('disk full'));
  first.unmount();

  // Back while the API restarts: the proxy answers 502 with no body. Then it is up again.
  let up = false;
  const puts: TheoryDoc[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'PUT') {
        puts.push(JSON.parse(String(init.body)));
        return new Response(String(init.body));
      }
      return up ? new Response(JSON.stringify(DEFAULT_THEORY)) : new Response('', { status: 502 });
    }),
  );
  mount(appClient());
  await waitFor(() => expect(screen.getByTestId('load-error')).toHaveTextContent('502'));
  expect(hook.fileUnreadable).toBe(false); // not the file's fault: nothing says it cannot be read
  up = true;
  act(() => hook.reload());
  await waitFor(() => expect(screen.getByTestId('tool')).toHaveTextContent('triads'));
  await waitFor(() => expect(puts.map((p) => p.last_tool)).toEqual(['triads']));
  await act(async () => {
    await new Promise((r) => setTimeout(r, 50));
  });
  expect(puts).toHaveLength(1);
  expect(screen.getByTestId('load-error')).toHaveTextContent('');
});

test('the server saying the file is unreadable is told apart from a failure to reach it', async () => {
  server({ getStatus: 500 });
  mount(appClient());
  await waitFor(() => expect(screen.getByTestId('load-error')).toHaveTextContent('broken'));
  expect(hook.fileUnreadable).toBe(true);
});
