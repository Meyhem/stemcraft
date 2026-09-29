// Renders one Theory tool inside the Theory screen with a mocked API, for the
// per-tool tests. `where()` reports the current path + query string.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { vi } from 'vitest';

import { DEFAULT_THEORY, type Analysis, type TheoryDoc } from '../../api/client';
import { Theory } from '../../screens/Theory';

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
          ? [{ dir: 'x', song: { id: '01SONG', title: options.songTitle ?? 'Tightrope', last_played_at: null }, state: 'analyzed', unreadable: null, files: { has_audio: true, has_peaks: true, has_stems: true, has_analysis: true } }]
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
