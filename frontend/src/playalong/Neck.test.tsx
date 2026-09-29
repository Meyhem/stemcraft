import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { DEFAULT_PLAY_ALONG, type Analysis, type Song } from '../api/client';
import { sampleIndex } from '../engine/types';
import { buildGrid } from '../music/grid';
import { patternSource } from '../music/tabSource';
import { Neck } from './Neck';

const analysis: Analysis = {
  schema_version: 1,
  key_candidates: [{ tonic: 'G', mode: 'major', confidence: 1 }],
  beat_grid: { bpm: 120, beats: Array.from({ length: 12 }, (_, i) => i * 24_000), downbeats: [0, 96_000, 192_000] },
  chords: ['G', 'C', 'D'].map((chord, bar) => ({ bar, start_sample: bar * 96_000, end_sample: (bar + 1) * 96_000, chord })),
};
const grid = buildGrid(analysis.beat_grid)!;
const song = {
  schema_version: 3, id: 'x', title: 't', artist: '', source: { kind: 'upload', value: 'o' },
  created_at: '', last_played_at: null, mix: {}, playback: { tempo: 1, pitch_semitones: 0 },
  loops: [], active_loop: null, metronome: false, count_in_bars: 0, play_along: DEFAULT_PLAY_ALONG,
} as Song;

describe('Neck', () => {
  it('describes the bar under the playhead and the next one, for screen readers', () => {
    const result = patternSource.barsFor({ song, analysis, grid, loop: null });
    if (!result.ok) throw new Error(result.error);
    render(
      <Neck
        bars={result.bars}
        nextOf={result.nextOf}
        songKey={result.key}
        grid={grid}
        // Bar 2 (index 1), beat 3.
        getPosition={() => sampleIndex(96_000 + 2 * 24_000)}
        playing={false}
        seekNonce={0}
      />,
    );
    const canvas = screen.getByTestId('neck-canvas');
    expect(canvas.tagName).toBe('CANVAS');
    expect(canvas).toHaveAttribute('role', 'img');
    expect(canvas.getAttribute('aria-label')).toBe('Bar 2, C: C E G E. Next: Bar 3, D: D F♯ A F♯');
  });
});
