// A mirror of stemcraft_lib.album.track_spans, so the track table can label and
// time rows as the user drags a marker without a round trip per pixel. The
// server remains authoritative: this computes what the server WILL compute from
// the same album.json, and the filenames it produces are asserted against the
// Python rule in that module's tests.
import type { Album } from '../api/client';

// D-03: the one sample rate, restated here because sample indices are the unit
// every split point is stored in.
const SAMPLE_RATE = 48000;

export interface ClientSpan {
  number: number;
  title: string;
  startSample: number;
  endSample: number;
  startSeconds: number;
  durationSeconds: number;
  filename: string;
}

// Mirrors stemcraft_lib.ids.slugify. Python builds `ascii_only` by NFKD
// normalizing and then `.encode('ascii', 'ignore')`, which drops EVERY
// non-ASCII code point outright (not just combining accents left over from
// decomposition) -- a Cyrillic or CJK character disappears rather than
// becoming a separator. `\x00-\x7F` is the direct mirror of that ignore-encode
// step. After that, everything outside [a-z0-9] collapses to a single hyphen,
// leading/trailing hyphens are trimmed, and the result is capped at 60 chars
// (re-trimmed, since slicing can expose a fresh trailing hyphen).
export function slugify(text: string): string {
  const ascii = text.normalize('NFKD').replace(/[^\x00-\x7F]/g, '');
  const slug = ascii
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug.slice(0, 60).replace(/-+$/, '') || 'untitled';
}

export function trackSpans(album: Album): ClientSpan[] {
  if (album.total_samples <= 0) return [];
  const edges = [0, ...album.split_points, album.total_samples];
  return album.tracks.map((track, index) => {
    const number = index + 1;
    // Safe by construction: `edges` has one more entry than `tracks`, so
    // every index and index+1 used here is in bounds.
    const startSample = edges[index]!;
    const endSample = edges[index + 1]!;
    const slug = track.title.trim() ? slugify(track.title) : `track-${number}`;
    return {
      number,
      title: track.title,
      startSample,
      endSample,
      startSeconds: startSample / SAMPLE_RATE,
      durationSeconds: (endSample - startSample) / SAMPLE_RATE,
      filename: `${String(number).padStart(2, '0')}-${slug}.mp3`,
    };
  });
}
