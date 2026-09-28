import { describe, expect, it } from 'vitest';

import type { Album } from '../api/client';
import { slugify, trackSpans } from './spans';

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

// Pins slugify() against packages/stemcraft_lib/src/stemcraft_lib/ids.py's
// slugify, which is authoritative: the server derives the filename it writes
// from that function, this module derives the filename the UI shows before
// the split runs, and if the two ever disagree the UI is showing the user a
// filename the backend will not produce. Every expected value below was
// produced by running the real Python function (see task-7-report.md for the
// interpreter session), not by reasoning about what it should do -- this is a
// cross-language invariant with no other guard, so a "simplification" of
// either regex that quietly breaks the mirror must fail here.
describe('slugify (cross-language mirror of stemcraft_lib.ids.slugify)', () => {
  const cases: [name: string, input: string, expected: string][] = [
    // Non-ASCII that does NOT decompose to ASCII under NFKD (Cyrillic, CJK,
    // emoji): Python's `.encode('ascii', 'ignore')` drops it outright rather
    // than turning it into a separator, so a title that is ENTIRELY such
    // characters reduces to nothing and falls back to 'untitled'.
    ['cyrillic-only vanishes entirely', 'Молчание', 'untitled'],
    ['cjk-only vanishes entirely', '日本語', 'untitled'],
    ['emoji-only vanishes entirely', '😀😀', 'untitled'],
    ['punctuation-only reduces to nothing', '!!!', 'untitled'],
    ['whitespace-only reduces to nothing', '   ', 'untitled'],
    ['empty string reduces to nothing', '', 'untitled'],
    // Accented Latin DOES decompose to ASCII under NFKD (e.g. é -> e +
    // combining acute), so the base letters survive.
    ['accented Latin keeps its base letters', 'Café', 'cafe'],
    ['accented Latin keeps its base letters (2)', 'naïve', 'naive'],
    // Mixed, but whitespace-separated. NOTE: this case does NOT distinguish
    // the fixed implementation from the buggy diacritics-only strip -- under
    // the bug the CJK run survives the strip but is not in [a-z0-9], so the
    // next step collapses it to a hyphen anyway, landing on the same
    // 'cafe-nandu' either way. Kept because it's a realistic title, not
    // because it's load-bearing; see the adjacency cases below for the ones
    // that actually pin the fix.
    ['mixed decomposable and non-decomposable non-ASCII, whitespace-separated', 'Café 日本語 Ñandú', 'cafe-nandu'],
    // Adjacency: non-ASCII glued directly to ASCII with no whitespace or
    // punctuation between them. Confirmed by mutation-testing this exact
    // table (see task-7-report.md): only the MIDDLE case is actually
    // load-bearing. With the bug reinstated (strip combining marks only,
    // leave other non-ASCII to be collapsed to a hyphen by the next step),
    // 'abc日本語def' -> 'abc-def' under the bug vs 'abcdef' fixed -- an
    // interior hyphen the leading/trailing trim can't remove, so this is
    // the one case in the whole table that actually fails when the bug is
    // reinstated. The start/end cases below do NOT distinguish the two
    // implementations: the buggy version's artifact hyphen lands at the
    // string boundary, where `.replace(/^-+|-+$/g, '')` strips it either
    // way, so both implementations converge on 'abc'. They are kept for
    // documentation of that non-obvious behaviour, not as regression guards
    // -- do not rely on them to catch this bug, and do not delete the
    // middle case as "redundant" with them.
    ['non-ASCII glued to ASCII on both sides (middle) -- the load-bearing case', 'abc日本語def', 'abcdef'],
    ['non-ASCII glued to ASCII with nothing before it (start)', '日本語abc', 'abc'],
    ['non-ASCII glued to ASCII with nothing after it (end)', 'abc日本語', 'abc'],
    // 60-char cap.
    ['exactly 60 chars is untouched', 'a'.repeat(60), 'a'.repeat(60)],
    ['over 60 chars is truncated to 60', 'a'.repeat(65), 'a'.repeat(60)],
    // Cap lands exactly on the hyphen produced by collapsing a single
    // separator: the slice exposes a trailing hyphen, which must be
    // re-stripped after slicing, not just before it.
    ['cap lands mid-hyphen-run, trailing hyphen re-stripped', `${'a'.repeat(59)} bbbb`, 'a'.repeat(59)],
    [
      'cap lands one char past a collapsed separator run',
      `${'a'.repeat(58)}   cccccc`,
      `${'a'.repeat(58)}-c`,
    ],
  ];

  it.each(cases)('%s', (_name, input, expected) => {
    expect(slugify(input)).toBe(expected);
  });
});
