// Renders one Theory tool inside the Theory screen with a mocked API, for the
// per-tool tests. `where()` reports the current path + query string.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { vi } from 'vitest';

import { DEFAULT_THEORY, type Analysis, type TheoryDoc } from '../../api/client';
import { Theory } from '../../screens/Theory';
import type { GuessEngine } from '../useGuessSound';

export function renderTool(
  path: string,
  options: { theory?: Partial<TheoryDoc>; analysis?: Analysis; songTitle?: string } = {},
) {
  const theory = { ...DEFAULT_THEORY, ...options.theory };
  const puts: TheoryDoc[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/theory' && init?.method === 'PUT') {
        puts.push(JSON.parse(String(init.body)));
        return new Response(String(init.body));
      }
      if (url === '/api/theory') return new Response(JSON.stringify(theory));
      if (url === '/api/songs') {
        const songs = options.analysis
          ? [{ dir: 'x', song: { id: '01SONG', title: options.songTitle ?? 'Tightrope', last_played_at: null }, state: 'analyzed', unreadable: null, files: { has_audio: true, has_peaks: true, has_stems: true, has_analysis: true, has_transcription: false } }]
          : [];
        return new Response(JSON.stringify({ songs }));
      }
      if (url === '/api/songs/01SONG/analysis' && options.analysis) return new Response(JSON.stringify(options.analysis));
      throw new Error(`unexpected fetch: ${url}`);
    }),
  );
  let location = '';
  function Where() {
    const l = useLocation();
    location = `${l.pathname}${l.search}`;
    return null;
  }
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="theory" element={<Theory />} />
          <Route path="theory/:tool" element={<Theory />} />
        </Routes>
        <Where />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  const dots = () =>
    [...view.container.querySelectorAll('[data-cell]')].map(
      (d) => `${d.getAttribute('data-cell')}:${d.textContent}${d.getAttribute('data-dim') ? ':dim' : ''}`,
    );
  return { ...view, puts, where: () => location, dots };
}

/**
 * The Theory screen on a file that can stop being readable: `unreadable()` makes the next reads fail and refetches
 * now (the tab regained focus while the server is down), `readable()` makes them work again and refetches.
 */
export function renderFlaky(path: string, theory: Partial<TheoryDoc> = {}) {
  const doc = { ...DEFAULT_THEORY, ...theory };
  const puts: TheoryDoc[] = [];
  let reading = true;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/theory' && init?.method === 'PUT') {
        puts.push(JSON.parse(String(init.body)));
        return new Response(String(init.body));
      }
      if (url === '/api/theory') {
        return reading ? new Response(JSON.stringify(doc)) : new Response(JSON.stringify({ detail: 'theory.json: broken' }), { status: 500 });
      }
      if (url === '/api/songs') return new Response(JSON.stringify({ songs: [] }));
      throw new Error(`unexpected fetch: ${url}`);
    }),
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 5000, refetchOnWindowFocus: false } } });
  const view = render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="theory/:tool" element={<Theory />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  const refetch = async () => {
    await act(async () => {
      await client.invalidateQueries({ queryKey: ['theory'] });
    });
  };
  return {
    ...view,
    client,
    puts,
    unreadable: async () => {
      reading = false;
      await refetch();
    },
    readable: async () => {
      reading = true;
      await refetch();
    },
  };
}

/** A GuessEngine that records calls; `end()` fires its ended listener as the worklet would. */
export function fakeEngine() {
  let ended = () => {};
  const e = {
    replaceStems: vi.fn(),
    seek: vi.fn(),
    play: vi.fn(async () => {}),
    pause: vi.fn(),
    onEnded: vi.fn((cb: () => void) => {
      ended = cb;
      return () => {};
    }),
    dispose: vi.fn(async () => {}),
    end: () => ended(),
  };
  return e satisfies GuessEngine & { end(): void };
}
