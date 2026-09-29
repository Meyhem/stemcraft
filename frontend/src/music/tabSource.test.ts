import { describe, expect, it } from 'vitest';

import { DEFAULT_PLAY_ALONG, type Analysis, type Song } from '../api/client';
import { buildGrid } from './grid';
import { chordLabels, chordText, describeBar, noteIndexAt, patternSource } from './tabSource';

const analysis: Analysis = {
  schema_version: 1,
  key_candidates: [
    { tonic: 'G', mode: 'major', confidence: 0.6 },
    { tonic: 'D', mode: 'major', confidence: 0.3 },
  ],
  beat_grid: {
    bpm: 120,
    beats: Array.from({ length: 16 }, (_, i) => i * 24_000),
    downbeats: Array.from({ length: 4 }, (_, i) => i * 96_000),
  },
  chords: ['G', 'C', 'D', 'G'].map((chord, bar) => ({
    bar,
    start_sample: bar * 96_000,
    end_sample: (bar + 1) * 96_000,
    chord,
  })),
};
const grid = buildGrid(analysis.beat_grid)!;

function song(overrides: Partial<Song> = {}): Song {
  return {
    schema_version: 3,
    id: 'abc123',
    title: 'T',
    artist: '',
    source: { kind: 'upload', value: 'original.mp3' },
    created_at: '2026-09-29T00:00:00+00:00',
    last_played_at: null,
    mix: {},
    playback: { tempo: 1, pitch_semitones: 0 },
    loops: [],
    active_loop: null,
    metronome: false,
    count_in_bars: 0,
    play_along: DEFAULT_PLAY_ALONG,
    ...overrides,
  };
}

function ok(result: ReturnType<typeof patternSource.barsFor>) {
  if (!result.ok) throw new Error(result.error);
  return result;
}

describe('patternSource', () => {
  it('generates and places a bar per chord, in the top key by default', () => {
    const { bars, key } = ok(patternSource.barsFor({ song: song(), analysis, grid, loop: null }));
    expect(bars).toHaveLength(4);
    expect(chordText(bars[0]!, key)).toBe('G');
    expect(describeBar(bars[0], key)).toBe('Bar 1, G: G B D B');
  });

  it('transposes the chords and the key to what is heard', () => {
    const shifted = song({ playback: { tempo: 1, pitch_semitones: -2 } });
    const { bars, key } = ok(patternSource.barsFor({ song: shifted, analysis, grid, loop: null }));
    expect(chordText(bars[0]!, key)).toBe('F');
    expect(bars[0]!.notes.map((n) => n.name)).toEqual(['F', 'A', 'C', 'A']);
  });

  it("approaches the loop start from the loop's last bar", () => {
    const chromatic = song({
      play_along: { key: null, pattern: { notes: 'triad_chord', rhythm: 'quarter', approach: 'chromatic' } },
    });
    const { bars, nextOf } = ok(
      patternSource.barsFor({ song: chromatic, analysis, grid, loop: { startBar: 0, endBar: 2 } }),
    );
    expect(nextOf(1)).toBe(0);
    expect(bars[1]!.notes[3]!.midi).toBe(bars[0]!.bassMidi! - 1);
  });

  it('fails loudly when the analysis has no key candidates (N-08)', () => {
    const result = patternSource.barsFor({ song: song(), analysis: { ...analysis, key_candidates: [] }, grid, loop: null });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toMatch(/no key candidates/);
  });
});

describe('text helpers', () => {
  it('fills a gap in the chord chart with N rather than shifting bars', () => {
    const gappy: Analysis = { ...analysis, chords: [analysis.chords[0]!, analysis.chords[2]!] };
    expect(chordLabels(gappy)).toEqual(['G', 'N', 'D']);
  });

  it('names an empty bar for what it is', () => {
    const gappy: Analysis = { ...analysis, chords: [analysis.chords[0]!, { ...analysis.chords[1]!, chord: 'X' }] };
    const { bars, key } = ok(patternSource.barsFor({ song: song(), analysis: gappy, grid, loop: null }));
    expect(describeBar(bars[1], key)).toBe('Bar 2, unclassified');
    expect(describeBar(undefined, key)).toBe('past the end of the chord chart');
  });

  it('finds the note sounding at a beat offset', () => {
    const { bars } = ok(patternSource.barsFor({ song: song(), analysis, grid, loop: null }));
    expect(noteIndexAt(bars[0]!, 0)).toBe(0);
    expect(noteIndexAt(bars[0]!, 2.5)).toBe(2);
    expect(noteIndexAt(bars[0]!, 4)).toBe(-1);
  });
});
