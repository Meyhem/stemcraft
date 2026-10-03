import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import { DEFAULT_PRACTICE, type PracticeDoc } from '../api/client';
import { sampleIndex } from '../engine/types';
import type { PracticeEngine } from '../practice/usePracticeSession';
import { Practice } from './Practice';

let puts: PracticeDoc[];
function serve(doc: PracticeDoc = DEFAULT_PRACTICE) {
  puts = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url !== '/api/practice') throw new Error(`unexpected fetch: ${url}`);
      if (init?.method === 'PUT') {
        puts.push(JSON.parse(String(init.body)));
        return new Response(String(init.body));
      }
      return new Response(JSON.stringify(doc));
    }),
  );
}

const engine = (): PracticeEngine => ({
  replaceStems: vi.fn(), setGrid: vi.fn(), setLoop: vi.fn(), seek: vi.fn(), play: vi.fn(async () => {}),
  pause: vi.fn(), countInAndPlay: vi.fn(async () => {}), setStemGain: vi.fn(), setMetronome: vi.fn(),
  setMetronomeLevel: vi.fn(), setTempo: vi.fn(), getPositionSamples: () => sampleIndex(0), dispose: vi.fn(async () => {}),
});

function mount(createEngine = async () => engine()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <Practice createEngine={createEngine} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', () => 0);
  vi.stubGlobal('cancelAnimationFrame', () => {});
});
afterEach(() => vi.unstubAllGlobals());

test('opens on the saved exercise, ready to play', async () => {
  serve();
  mount();
  await screen.findByRole('button', { name: 'Play' });
  await waitFor(() => expect(screen.getByRole('button', { name: 'Play' })).toBeEnabled());
  expect(screen.getByRole('img', { name: 'Tab, 4 bars, looping' })).toBeInTheDocument();
  expect(screen.getByText(/approach note falls on the last beat/)).toBeInTheDocument();
});

test('switching to guitar keeps each instrument’s settings and shows the strum', async () => {
  serve();
  mount();
  await userEvent.click(await screen.findByRole('button', { name: 'Guitar' }));
  expect(screen.getByRole('group', { name: 'Strum' })).toBeInTheDocument();
  await waitFor(() => expect(puts.at(-1)?.instrument).toBe('guitar'), { timeout: 2000 });
  expect(puts.at(-1)!.bass).toEqual(DEFAULT_PRACTICE.bass);
});

test('an exercise that does not fit says why, offers fixes, and nothing plays', async () => {
  serve({ ...DEFAULT_PRACTICE, bass: { ...DEFAULT_PRACTICE.bass, exercise: 'scale', key: 2, scale: { ...DEFAULT_PRACTICE.bass.scale, scale: 'blues', shape: 'two_octaves', from_fret: 9 } } });
  mount();
  expect(await screen.findByText(/Two octaves of D Blues do not fit from fret 9/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Play' })).toBeDisabled();
  // The segmented control has a 'One position' too; the fix is the one in the banner.
  await userEvent.click(within(screen.getByRole('alert')).getByRole('button', { name: 'One position' }));
  await waitFor(() => expect(screen.queryByText(/do not fit/)).toBeNull());
});

test('an engine that cannot start is shown with its message', async () => {
  serve();
  mount(async () => {
    throw new Error('The browser’s audio runs at 44100 Hz');
  });
  expect(await screen.findByText('The browser’s audio runs at 44100 Hz')).toBeInTheDocument();
});

test('Space plays and pauses', async () => {
  serve();
  const e = engine();
  mount(async () => e);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Play' })).toBeEnabled());
  await userEvent.keyboard(' ');
  expect(e.countInAndPlay).toHaveBeenCalled();
});
