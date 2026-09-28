import { describe, expect, it } from 'vitest';

import type { Album } from '../api/client';
import { trackSpans } from './spans';

const SAMPLE_RATE = 48000;

function album(overrides: Partial<Album> = {}): Album {
  return {
    schema_version: 1,
    id: '01J0',
    title: 'Kind of Blue',
    artist: 'Miles Davis',
    source_value: 'original.flac',
    created_at: '2026-09-28T00:00:00+00:00',
    total_samples: SAMPLE_RATE * 10,
    split_points: [],
    tracks: [{ title: '' }],
    ...overrides,
  };
}

describe('trackSpans', () => {
  it('is contiguous and covers the whole album (D8-02)', () => {
    const spans = trackSpans(
      album({ split_points: [SAMPLE_RATE * 4], tracks: [{ title: 'A' }, { title: 'B' }] }),
    );
    expect(spans.map((s) => [s.startSample, s.endSample])).toEqual([
      [0, SAMPLE_RATE * 4],
      [SAMPLE_RATE * 4, SAMPLE_RATE * 10],
    ]);
  });

  it('derives numbers from position', () => {
    const spans = trackSpans(
      album({ split_points: [SAMPLE_RATE * 4], tracks: [{ title: 'A' }, { title: 'B' }] }),
    );
    expect(spans.map((s) => s.number)).toEqual([1, 2]);
  });

  it('produces the same filenames the server will (so the UI can show them before the split)', () => {
    const spans = trackSpans(
      album({ split_points: [SAMPLE_RATE * 4], tracks: [{ title: 'So What' }, { title: '' }] }),
    );
    expect(spans.map((s) => s.filename)).toEqual(['01-so-what.mp3', '02-track-2.mp3']);
  });

  it('is empty before the import job has measured the file', () => {
    expect(trackSpans(album({ total_samples: 0 }))).toEqual([]);
  });
});
