import { describe, expect, it } from 'vitest';

import { DEFAULT_PLAY_ALONG, type Analysis, type PlayAlongGuitar, type Song } from '../api/client';
import { buildGrid } from './grid';
import { describeGuitarBar, guitarBars, guitarEmptyText, guitarSource, guitarSummaries, strokeIndexAt } from './guitarSource';
import type { LoopBars } from './tabSource';

function analysisOf(chords: string[]): Analysis {
  return {
    schema_version: 1,
    key_candidates: [{ tonic: 'G', mode: 'major', confidence: 0.8 }],
    beat_grid: {
      bpm: 120,
      beats: Array.from({ length: chords.length * 4 }, (_, i) => i * 24_000),
      downbeats: Array.from({ length: chords.length }, (_, i) => i * 96_000),
    },
    chords: chords.map((chord, bar) => ({ bar, start_sample: bar * 96_000, end_sample: (bar + 1) * 96_000, chord })),
  };
}

function songWith(guitar: Partial<PlayAlongGuitar>): Song {
  return {
    schema_version: 4, id: 'abc123', title: 'T', artist: '',
    source: { kind: 'upload', value: 'original.mp3' }, created_at: '2026-10-01T00:00:00+00:00',
    last_played_at: null, mix: {}, playback: { tempo: 1, pitch_semitones: 0 }, loops: [],
    active_loop: null, metronome: false, count_in_bars: 0,
    play_along: { ...DEFAULT_PLAY_ALONG, instrument: 'guitar', guitar: { ...DEFAULT_PLAY_ALONG.guitar, ...guitar } },
  };
}

function bars(chords: string[], guitar: Partial<PlayAlongGuitar> = {}, loop: LoopBars | null = null) {
  const analysis = analysisOf(chords);
  const result = guitarSource.barsFor({ song: songWith(guitar), analysis, grid: buildGrid(analysis.beat_grid)!, loop });
  if (!result.ok) throw new Error(result.error);
  return result.bars;
}

const tabs = (b: ReturnType<typeof bars>) => b.map((x) => x.shape?.tab ?? x.empty);
const strokes = (b: ReturnType<typeof bars>[number]) =>
  b.strokes.map((s) => `${s.beat}${s.dir === 'down' ? 'D' : 'U'}${s.early ? '!' : ''}`).join(' ');

describe('guitarSource', () => {
  it('plays G D Em C as the open chords, folk strum by default', () => {
    const b = bars(['G', 'D', 'E:min', 'C']);
    expect(tabs(b)).toEqual(['320003', 'xx0232', '022000', 'x32010']);
    expect(b[0]!.degrees).toEqual(['R', '3', 'R', '5', '3', 'R']);
    expect(strokes(b[0]!)).toBe('0D 1D 1.5U 2.5U 3D 3.5U');
    expect(b.every((x) => x.substitutions.length === 0)).toBe(true);
  });

  it('is deterministic and keeps the hand still: barre G D Em C does not jump between frets 3 and 10', () => {
    const a = tabs(bars(['G', 'D', 'E:min', 'C'], { style: 'barre' }));
    expect(a).toEqual(tabs(bars(['G', 'D', 'E:min', 'C'], { style: 'barre' })));
    const anchors = bars(['G', 'D', 'E:min', 'C'], { style: 'barre' }).map((x) => x.shape!.anchor);
    for (let i = 1; i < anchors.length; i++) expect(Math.abs(anchors[i]! - anchors[i - 1]!)).toBeLessThanOrEqual(3);
  });

  it('says so when a style has no shape for a chord, and uses the next style', () => {
    const b = bars(['C', 'F', 'G', 'C']);
    expect(b[1]!.shape!.tab).toBe('133211');
    expect(b[1]!.substitutions).toEqual(['no open F, using barre']);
    const p = bars(['G', 'B:dim', 'C'], { style: 'power' });
    expect(p[1]!.substitutions).toEqual(['no power Bdim, using triad']);
  });

  it('keeps shapes inside the position window, and says when one cannot be', () => {
    const low = bars(['G', 'D', 'E:min', 'C'], { style: 'barre', position: 'low' });
    expect(tabs(low)).toEqual(['355433', 'x57775', 'x79987', 'x35553']);
    expect(low[1]!.substitutions).toEqual(['no low-position D, fret 5']);
    const mid = bars(['G', 'D'], { style: 'barre', position: 'mid' });
    expect(mid[1]!.substitutions).toEqual([]);
    expect(mid[0]!.substitutions).toEqual(['no mid-position G, fret 3']);
  });

  it('ignores the position window for open chords', () => {
    expect(tabs(bars(['G', 'C'], { position: 'mid' }))).toEqual(['320003', 'x32010']);
  });

  it('simplifies 7ths and 6ths to triads, and says so', () => {
    const b = bars(['G', 'E:min7', 'C:maj7', 'D:7'], { simplify: true });
    expect(tabs(b)).toEqual(['320003', '022000', 'x32010', 'xx0232']);
    expect(b.map((x) => x.substitutions)).toEqual([[], ['Emin7 → Em'], ['Cmaj7 → C'], ['D7 → D']]);
    const summary = guitarSummaries(b)[1]!;
    expect(summary).toEqual({ bar: 1, text: 'Em', cell: 'Emin7', sub: '→ Em', note: 'Emin7 → Em' });
  });

  it('says a triad drops the 7th', () => {
    expect(bars(['C:7', 'G'], { style: 'triad' })[0]!.substitutions).toEqual(['C7 as a C triad']);
  });

  it('pushes the last up-stroke into the next chord and ties over its downbeat', () => {
    const b = bars(['G', 'C', 'N', 'G'], { strum: 'push' });
    expect(strokes(b[0]!)).toBe('0D 1D 1.5U 2.5U 3D 3.5U!');
    expect(b[0]!.pushChord).toBe('C');
    expect(strokes(b[1]!)).toBe('1D 1.5U 2.5U 3D 3.5U');
    expect(b[1]!.substitutions).toEqual(['no push into an empty bar']);
    expect(b[2]!.empty).toBe('no_chord');
    expect(b[2]!.strokes).toEqual([]);
    expect(b[3]!.substitutions).toEqual(['no push past the last bar']);
  });

  it('pushes from the loop end into the loop start', () => {
    const b = bars(['G', 'C', 'D', 'G'], { strum: 'push' }, { startBar: 0, endBar: 2 });
    expect(b[1]!.pushChord).toBe('G');
    expect(strokes(b[0]!)).toBe('1D 1.5U 2.5U 3D 3.5U!');
  });

  it('shows a chord no style can play as an empty neck that says so', () => {
    const [bar] = bars(['C/b7', 'G'], { style: 'triad' });
    expect(bar!.empty).toBe('no_shape');
    expect(guitarEmptyText(bar!)).toMatch(/^no playable shape for C\//);
    expect(describeGuitarBar(bar)).toMatch(/^Bar 1, C\//);
  });

  it('describes a bar and finds the stroke under the playhead', () => {
    const [bar] = bars(['G', 'C']);
    expect(describeGuitarBar(bar)).toBe('Bar 1, G: 320003');
    expect(strokeIndexAt(bar!, 0.2)).toBe(0);
    expect(strokeIndexAt(bar!, 0.7)).toBe(-1);
    expect(strokeIndexAt(bar!, 1.6)).toBe(2);
  });

  it('summarises empty bars for the ribbon', () => {
    const s = guitarSummaries(bars(['N', 'X', 'G']));
    expect(s.map((x) => [x.text, x.cell])).toEqual([['no chord', '–'], ['unclassified', '?'], ['G', 'G']]);
  });
});

test('guitarBars runs the D-20 pipeline over bare labels', () => {
  const key = { tonicPc: 7, mode: 'major' as const };
  const bars = guitarBars(
    ['G', 'D', 'E:min', 'C'],
    key,
    { style: 'open', strum: 'folk', position: 'auto', simplify: false },
    4,
    0,
    (bar) => (bar + 1) % 4,
  );
  expect(bars.map((b) => b.chord)).toEqual(['G', 'D', 'Em', 'C']);
  expect(bars.every((b) => b.shape !== null && b.strokes.length === 6)).toBe(true);
});
