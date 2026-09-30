import { afterEach, describe, expect, it, vi } from 'vitest';

import { sendTrackToLibrary } from './toLibrary';

afterEach(() => vi.unstubAllGlobals());

describe('sendTrackToLibrary', () => {
  it('downloads the rendered track and uploads it as a Song, leaving title and artist to the tags', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        return new Response(JSON.stringify({ song: { id: 's1' }, job_id: 7 }), { status: 201 });
      }
      return new Response(new Uint8Array([1, 2, 3]));
    });
    vi.stubGlobal('fetch', fetchMock);

    const created = await sendTrackToLibrary('01J0', '01-so-what.mp3');

    expect(created.job_id).toBe(7);
    expect(fetchMock.mock.calls[0]![0]).toBe('/api/albums/01J0/tracks/01-so-what.mp3');
    const [url, init] = fetchMock.mock.calls[1]!;
    expect(url).toBe('/api/songs/upload');
    const form = init!.body as FormData;
    const file = form.get('file') as File;
    expect(file.name).toBe('01-so-what.mp3');
    expect(file.size).toBe(3);
    // Blank on purpose: the upload route fills them from the ID3 tags the split wrote.
    expect(form.has('title')).toBe(false);
    expect(form.has('artist')).toBe(false);
  });

  it('fails with the server message and uploads nothing when the track is gone (N-08)', async () => {
    const fetchMock = vi.fn(async () => new Response('album 01J0 has no track', { status: 404 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(sendTrackToLibrary('01J0', '01-so-what.mp3')).rejects.toThrow(
      'GET /api/albums/01J0/tracks/01-so-what.mp3 → 404: album 01J0 has no track',
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
