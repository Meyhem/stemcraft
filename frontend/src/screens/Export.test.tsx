import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, expect, test, vi } from 'vitest';

import { Export } from './Export';

const SONG_ID = '01J9SONGID';

const song = {
  schema_version: 2,
  id: SONG_ID,
  title: 'Tightrope',
  artist: 'Walk the Moon',
  source: { kind: 'upload', value: 'original.mp3' },
  created_at: '2026-01-01T00:00:00Z',
  last_played_at: null,
  mix: {
    vocals: { gain_db: 0, muted: false },
    drums: { gain_db: -6, muted: false },
    bass: { gain_db: 0, muted: true },
    other: { gain_db: 0, muted: false },
  },
  playback: { tempo: 0.82, pitch_semitones: -2 },
  loops: [],
  active_loop: null,
  metronome: false,
  count_in_bars: 0,
};

const entry = {
  dir: `${SONG_ID}-tightrope`,
  song,
  state: 'analyzed',
  unreadable: null,
  files: { has_audio: true, has_peaks: true, has_stems: true, has_analysis: true },
};

interface MockOptions {
  songEntry?: unknown;
  songStatus?: number;
  songBody?: string;
  exports?: unknown[];
  exportsStatus?: number;
  exportsBody?: string;
  jobs?: unknown[];
  queueStatus?: number;
  queueBody?: unknown;
}

const posted: Array<{ url: string; body: unknown }> = [];

function renderExport(options: MockOptions = {}) {
  posted.length = 0;
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'POST') {
      posted.push({ url, body: JSON.parse(String(init.body)) });
      return new Response(JSON.stringify(options.queueBody ?? { job_id: 7, name: 'x', file: 'exports/x.mp3' }), {
        status: options.queueStatus ?? 201,
      });
    }
    if (url.endsWith('/exports')) {
      if (options.exportsStatus) {
        return new Response(options.exportsBody ?? 'exports listing failed', {
          status: options.exportsStatus,
        });
      }
      return new Response(JSON.stringify({ exports: options.exports ?? [] }));
    }
    if (url.startsWith('/api/jobs')) {
      return new Response(JSON.stringify({ jobs: options.jobs ?? [] }));
    }
    if (options.songStatus) {
      return new Response(options.songBody ?? 'song not found', { status: options.songStatus });
    }
    return new Response(JSON.stringify(options.songEntry ?? entry));
  });
  vi.stubGlobal('fetch', fetchMock);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/songs/${SONG_ID}/export`]}>
        <Routes>
          <Route path="songs/:songId/export" element={<Export />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

test('the stem picker is prefilled from the current mix', async () => {
  renderExport();
  // Muted in song.json means unticked here -- "matches your current mix".
  expect(await screen.findByRole('checkbox', { name: /vocals/ })).toBeChecked();
  expect(screen.getByRole('checkbox', { name: /drums/ })).toBeChecked();
  expect(screen.getByRole('checkbox', { name: /bass/ })).not.toBeChecked();
  expect(screen.getByRole('checkbox', { name: /other/ })).toBeChecked();
});

test('the file name is proposed from the title, the picker and the recipe', async () => {
  renderExport();
  const name = await screen.findByLabelText(/file name/i);
  expect(name).toHaveValue('tightrope-no-bass-82-2st');
});

test('the D-10 banner states that the export will not match the preview', async () => {
  renderExport();
  const banner = await screen.findByRole('status', { name: /quality/i });
  expect(banner).toHaveTextContent(/not sound identical to the preview/i);
  expect(banner).toHaveTextContent(/better/i);
});

test('the as-practiced choice names the actual numbers', async () => {
  renderExport();
  expect(await screen.findByRole('radio', { name: /as practiced — 82%, −2 st/i })).toBeChecked();
  expect(screen.getByRole('radio', { name: /original — 100%, 0 st/i })).not.toBeChecked();
});

test('queueing posts the ticked stems and apply_recipe true', async () => {
  renderExport();
  await screen.findByRole('checkbox', { name: /vocals/ });
  await userEvent.click(screen.getByRole('button', { name: /queue export/i }));

  await waitFor(() => expect(posted).toHaveLength(1));
  expect(posted[0]!.url).toBe(`/api/songs/${SONG_ID}/export`);
  expect(posted[0]!.body).toEqual({
    stems: ['vocals', 'drums', 'other'],
    apply_recipe: true,
    name: 'tightrope-no-bass-82-2st',
  });
});

test('choosing original posts apply_recipe false and renames the proposal', async () => {
  renderExport();
  await userEvent.click(await screen.findByRole('radio', { name: /original/i }));
  expect(screen.getByLabelText(/file name/i)).toHaveValue('tightrope-no-bass');

  await userEvent.click(screen.getByRole('button', { name: /queue export/i }));
  await waitFor(() => expect(posted).toHaveLength(1));
  expect(posted[0]!.body).toMatchObject({ apply_recipe: false });
});

test('ticking a stem updates the proposed name', async () => {
  renderExport();
  await userEvent.click(await screen.findByRole('checkbox', { name: /bass/ }));
  expect(screen.getByLabelText(/file name/i)).toHaveValue('tightrope-82-2st');
});

test('a name the user edited is not overwritten by later picker changes', async () => {
  renderExport();
  const name = await screen.findByLabelText(/file name/i);
  await userEvent.clear(name);
  await userEvent.type(name, 'my-own-name');
  await userEvent.click(screen.getByRole('checkbox', { name: /bass/ }));
  expect(name).toHaveValue('my-own-name');
});

test('no stems ticked disables the button and says why', async () => {
  renderExport();
  for (const stem of ['vocals', 'drums', 'other']) {
    await userEvent.click(await screen.findByRole('checkbox', { name: new RegExp(stem) }));
  }
  expect(screen.getByRole('button', { name: /queue export/i })).toBeDisabled();
  expect(screen.getByText(/at least one stem/i)).toBeInTheDocument();
});

test('a genuine fetch failure shows the real error, not a fabricated "not separated" message', async () => {
  renderExport({ songStatus: 404, songBody: 'song not found' });
  expect(await screen.findByText(/song not found/)).toBeInTheDocument();
  expect(screen.queryByText(/not been separated/i)).not.toBeInTheDocument();
});

test('a song without stems cannot be exported and says so', async () => {
  renderExport({
    songEntry: { ...entry, state: 'imported', files: { ...entry.files, has_stems: false } },
  });
  expect(await screen.findByText(/not been separated/i)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /queue export/i })).toBeDisabled();
});

test('a running export shows its progress from the job row', async () => {
  renderExport({
    jobs: [{ id: 7, kind: 'export', song_id: SONG_ID, state: 'running', progress: 0.42,
             error: null, result: null }],
    queueBody: { job_id: 7, name: 'tightrope-no-bass-82-2st', file: 'exports/x.mp3' },
  });
  await screen.findByRole('checkbox', { name: /vocals/ });
  await userEvent.click(screen.getByRole('button', { name: /queue export/i }));

  expect(await screen.findByRole('progressbar')).toHaveAttribute('aria-valuenow', '42');
});

test('a failed export shows the server error verbatim', async () => {
  renderExport({
    jobs: [{ id: 7, kind: 'export', song_id: SONG_ID, state: 'failed', progress: 0,
             error: 'FfmpegError: export render of x.mp3 failed: Invalid argument',
             result: null }],
    queueBody: { job_id: 7, name: 'x', file: 'exports/x.mp3' },
  });
  await screen.findByRole('checkbox', { name: /vocals/ });
  await userEvent.click(screen.getByRole('button', { name: /queue export/i }));

  expect(await screen.findByText(/Invalid argument/)).toBeInTheDocument();
});

test('an existing export is listed with a download link and its own duration', async () => {
  renderExport({
    exports: [
      { name: 'tightrope-no-bass-82', file: 'exports/tightrope-no-bass-82.mp3',
        bytes: 5_600_000, modified_at: 1_700_000_000 },
    ],
  });
  const link = await screen.findByRole('link', { name: /tightrope-no-bass-82/ });
  expect(link).toHaveAttribute(
    'href',
    `/api/songs/${SONG_ID}/exports/tightrope-no-bass-82.mp3`,
  );
  expect(screen.getByText(/5\.6 MB/)).toBeInTheDocument();
});

test('a rejected queue shows the API message, not a generic failure', async () => {
  renderExport({ queueStatus: 409, queueBody: { detail: 'no separated stems to export yet' } });
  await screen.findByRole('checkbox', { name: /vocals/ });
  await userEvent.click(screen.getByRole('button', { name: /queue export/i }));

  expect(await screen.findByText(/no separated stems to export yet/)).toBeInTheDocument();
});

test('a failed exports listing shows the real error under the Exports heading', async () => {
  renderExport({ exportsStatus: 500, exportsBody: 'exports listing failed' });
  expect(await screen.findByText(/exports listing failed/)).toBeInTheDocument();
});

test('a successful queue adopts the server-slugified name, not the typed text', async () => {
  renderExport({ queueBody: { job_id: 7, name: 'my-mix', file: 'exports/my-mix.mp3' } });
  const name = await screen.findByLabelText(/file name/i);
  await userEvent.clear(name);
  await userEvent.type(name, 'My Mix!');

  await userEvent.click(screen.getByRole('button', { name: /queue export/i }));
  await waitFor(() => expect(posted).toHaveLength(1));

  expect(name).toHaveValue('my-mix');
});

test('a successful queue while still on the proposal keeps following later picker changes', async () => {
  // Regression guard: adopting queued.name unconditionally would flip
  // typedName out of null and freeze the field, so a second export after
  // changing the selection would silently overwrite the first instead of
  // proposing a new name.
  renderExport({ queueBody: { job_id: 7, name: 'some-other-name', file: 'exports/x.mp3' } });
  const name = await screen.findByLabelText(/file name/i);
  expect(name).toHaveValue('tightrope-no-bass-82-2st');

  await userEvent.click(screen.getByRole('button', { name: /queue export/i }));
  await waitFor(() => expect(posted).toHaveLength(1));
  expect(name).toHaveValue('tightrope-no-bass-82-2st');

  await userEvent.click(await screen.findByRole('checkbox', { name: /drums/ }));
  expect(name).toHaveValue('tightrope-vocals-other-82-2st');
});
