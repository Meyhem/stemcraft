import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AlbumSplitter } from './AlbumSplitter';

// Copied from src/songview/StemLane.test.tsx: jsdom has no canvas and no
// ResizeObserver, and `create` being a spy is what lets invariant 7 be
// asserted from the screen's own render.
const { createWaveSurfer } = vi.hoisted(() => ({
  createWaveSurfer: vi.fn((_options: Record<string, unknown>) => ({
    destroy: vi.fn(),
    setOptions: vi.fn(),
    on: () => () => {},
  })),
}));
vi.mock('wavesurfer.js', () => ({
  default: { create: createWaveSurfer },
}));

const SR = 48000;
const ALBUM_ID = '01J0';

const readyAlbum = {
  dir: '01J0-test',
  album: {
    schema_version: 1,
    id: ALBUM_ID,
    title: 'Test Album',
    artist: 'Tester',
    source_value: 'original.flac',
    created_at: '2026-09-28T00:00:00+00:00',
    total_samples: SR * 600,
    split_points: [SR * 300],
    tracks: [{ title: 'One' }, { title: 'Two' }],
  },
  state: 'ready',
  files: {
    has_audio: true,
    has_peaks: true,
    has_proposals: true,
    has_tracks: false,
    has_zip: false,
  },
  unreadable: null,
};

// A tiny two-bucket peaks doc: the waveform pixels are not what these tests
// are about, but the component will not render markers without one.
const peaks = {
  version: 1,
  sample_rate: SR,
  length: SR * 600,
  channels: 1,
  buckets_per_second: 100,
  peaks: [[-0.4, 0.6, -0.2, 0.3]],
};

interface Extras {
  proposals?: unknown;
  proposalsStatus?: number;
  jobs?: unknown[];
  tracks?: unknown[];
}

const puts: unknown[] = [];

function putBody(): {
  total_samples: number;
  split_points: number[];
  tracks: { title: string }[];
  title: string;
  artist: string;
} {
  const last = puts.at(-1);
  if (last === undefined) throw new Error('no PUT /api/albums/:id was sent');
  return last as ReturnType<typeof putBody>;
}

function renderWith(entry: unknown, extras: Extras = {}) {
  puts.length = 0;
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'PUT') {
      const body = JSON.parse(String(init.body));
      puts.push(body);
      return new Response(JSON.stringify({ ...(entry as object), album: body }));
    }
    if (init?.method === 'POST') {
      return new Response(JSON.stringify({ job_id: 9, tracks: 2 }), { status: 201 });
    }
    if (url.startsWith('/api/jobs')) {
      return new Response(JSON.stringify({ jobs: extras.jobs ?? [] }));
    }
    if (url.endsWith('/proposals')) {
      if (extras.proposals === undefined) {
        return new Response('no proposals yet', { status: extras.proposalsStatus ?? 404 });
      }
      return new Response(JSON.stringify(extras.proposals));
    }
    if (url.endsWith('/peaks')) return new Response(JSON.stringify(peaks));
    if (url.endsWith('/tracks')) {
      return new Response(JSON.stringify({ tracks: extras.tracks ?? [] }));
    }
    return new Response(JSON.stringify(entry));
  });
  vi.stubGlobal('fetch', fetchMock);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/splitter/${ALBUM_ID}`]}>
        <Routes>
          <Route path="splitter/:albumId" element={<AlbumSplitter />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return fetchMock;
}

beforeEach(() => {
  createWaveSurfer.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('AlbumSplitter', () => {
  it('stamps total_samples from the proposals when the album has not been measured', async () => {
    const unmeasured = {
      ...readyAlbum,
      album: { ...readyAlbum.album, total_samples: 0, split_points: [], tracks: [{ title: '' }] },
    };
    renderWith(unmeasured, { proposals: { total_samples: SR * 600, split_points: [SR * 300] } });
    // The length is adopted; the boundaries are NOT (D8-04).
    await waitFor(() =>
      expect(putBody()).toMatchObject({ total_samples: SR * 600, split_points: [] }),
    );
  });

  it('does not stamp a length the worker has not measured yet', async () => {
    const unmeasured = {
      ...readyAlbum,
      album: { ...readyAlbum.album, total_samples: 0, split_points: [], tracks: [{ title: '' }] },
      files: { ...readyAlbum.files, has_proposals: false },
    };
    renderWith(unmeasured);
    await screen.findByLabelText(/album title/i);
    await new Promise((resolve) => setTimeout(resolve, 800));
    expect(puts).toHaveLength(0);
  });

  it('disables the split button until the album has decoded audio, and says why', async () => {
    renderWith({
      ...readyAlbum,
      state: 'uploaded',
      files: { ...readyAlbum.files, has_audio: false },
    });
    const button = await screen.findByRole('button', { name: /split/i });
    expect(button).toBeDisabled();
    expect(button).toHaveAccessibleDescription(/import/i);
  });

  it('applies the proposals only when asked, and grows the track list to match', async () => {
    renderWith(readyAlbum, {
      proposals: { total_samples: SR * 600, split_points: [SR * 200, SR * 400] },
    });
    fireEvent.click(await screen.findByRole('button', { name: /use proposed/i }));
    await waitFor(() => {
      const body = putBody();
      expect(body.split_points).toEqual([SR * 200, SR * 400]);
      // N points must produce exactly N+1 tracks, or the PUT is a 422 (D8-02).
      expect(body.tracks).toHaveLength(3);
    });
  });

  it('leaves dragged boundaries alone until the user applies proposals again (D8-04)', async () => {
    renderWith(readyAlbum, { proposals: { total_samples: SR * 600, split_points: [SR * 200] } });
    const marker = await screen.findByRole('slider', { name: /split point 1/i });
    // The album's own boundary survives the proposals merely being available.
    expect(marker).toHaveAttribute('aria-valuenow', String(SR * 300));
  });

  it('keeps the track count consistent when a boundary is removed', async () => {
    renderWith(readyAlbum);
    fireEvent.click(await screen.findByRole('button', { name: /remove split point 1/i }));
    await waitFor(() => {
      const body = putBody();
      expect(body.split_points).toEqual([]);
      expect(body.tracks).toHaveLength(1);
      // The track AFTER the boundary is the one that goes: merging tracks 1
      // and 2 keeps the first one's title, not the second one's.
      expect(body.tracks.map((track) => track.title)).toEqual(['One']);
    });
  });

  it('inserts the new track directly after a new boundary, not at the end of the list', async () => {
    // The count alone cannot catch this: padding the list at the end would
    // also produce N+1 tracks, but would leave "Two" labelling the first half
    // of what used to be track one. Only the titles show where it went.
    const rect = vi
      .spyOn(Element.prototype, 'getBoundingClientRect')
      .mockReturnValue({ left: 0, width: 1000, right: 1000, top: 0, bottom: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) } as DOMRect);
    try {
      renderWith(readyAlbum);
      await screen.findByRole('slider', { name: /split point 1/i });
      // A quarter of the way in — before the existing boundary at half.
      fireEvent.click(screen.getByTestId('album-waveform'), { clientX: 250 });
      await waitFor(() => expect(putBody().split_points).toEqual([SR * 150, SR * 300]));
      expect(putBody().tracks.map((track) => track.title)).toEqual(['One', '', 'Two']);
    } finally {
      rect.mockRestore();
    }
  });

  it('autosaves a track title edit', async () => {
    renderWith(readyAlbum);
    const titleInputs = await screen.findAllByRole('textbox', { name: /track title/i });
    fireEvent.change(titleInputs[0]!, { target: { value: 'So What' } });
    await waitFor(() => expect(putBody().tracks[0]!.title).toBe('So What'));
  });

  it('autosaves the album title, which every track inherits by construction', async () => {
    renderWith(readyAlbum);
    const title = await screen.findByLabelText(/album title/i);
    fireEvent.change(title, { target: { value: 'Kind of Blue' } });
    await waitFor(() => expect(putBody().title).toBe('Kind of Blue'));
    // Still balanced: an unrelated field edit must not disturb D8-02.
    expect(putBody().tracks).toHaveLength(putBody().split_points.length + 1);
  });

  it('offers the zip only once the split has finished, from derived state', async () => {
    renderWith({
      ...readyAlbum,
      state: 'split',
      files: { ...readyAlbum.files, has_tracks: true, has_zip: true },
    });
    // files.has_zip gates it -- never a local "I clicked split" flag.
    expect(await screen.findByRole('link', { name: /download/i })).toHaveAttribute(
      'href',
      '/api/albums/01J0/album.zip',
    );
  });

  it('does not offer the zip before a split has run', async () => {
    renderWith(readyAlbum);
    await screen.findByRole('slider', { name: /split point 1/i });
    expect(screen.queryByRole('link', { name: /download/i })).toBeNull();
  });

  it('shows the real error text when a split job fails (N-08)', async () => {
    renderWith(readyAlbum, {
      jobs: [
        {
          id: 7,
          kind: 'split_album',
          song_id: null,
          payload: { album_id: ALBUM_ID },
          state: 'failed',
          progress: 0,
          error: 'ffmpeg: Invalid data found',
          result: null,
        },
      ],
    });
    expect(await screen.findByText(/Invalid data found/)).toBeInTheDocument();
  });

  it('never constructs a wavesurfer that can play (invariant 7 / D-07)', async () => {
    renderWith(readyAlbum);
    await screen.findByRole('slider', { name: /split point 1/i });
    const options = createWaveSurfer.mock.calls.at(-1)![0];
    expect(options.url).toBeUndefined();
    expect(options.media).toBeUndefined();
    expect(options.peaks).toBeDefined();
  });

  it('previews the album with a plain audio element on the decoded master (D8-11)', async () => {
    renderWith(readyAlbum);
    await screen.findByRole('slider', { name: /split point 1/i });
    const audio = document.querySelector('audio');
    expect(audio).not.toBeNull();
    expect(audio!.getAttribute('src')).toBe(`/api/albums/${ALBUM_ID}/audio.wav`);
  });

  it('shows the real fetch error rather than an invented diagnosis', async () => {
    const fetchMock = vi.fn(async () => new Response('no album with id 01J0', { status: 404 }));
    vi.stubGlobal('fetch', fetchMock);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[`/splitter/${ALBUM_ID}`]}>
          <Routes>
            <Route path="splitter/:albumId" element={<AlbumSplitter />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(await screen.findByText(/no album with id 01J0/)).toBeInTheDocument();
  });
});
