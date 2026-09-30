import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { DEFAULT_PLAY_ALONG, type Analysis, type Song } from '../api/client';
import { sampleIndex } from '../engine/types';
import { buildGrid } from '../music/grid';
import { patternSource } from '../music/tabSource';
import { ChordRibbon } from './ChordRibbon';

const analysis: Analysis = {
  schema_version: 1,
  key_candidates: [{ tonic: 'G', mode: 'major', confidence: 1 }],
  beat_grid: { bpm: 120, beats: Array.from({ length: 16 }, (_, i) => i * 24_000), downbeats: [0, 96_000, 192_000, 288_000] },
  chords: ['G', 'C', 'D', 'G'].map((chord, bar) => ({ bar, start_sample: bar * 96_000, end_sample: (bar + 1) * 96_000, chord })),
};
const grid = buildGrid(analysis.beat_grid)!;
const song = {
  schema_version: 3, id: 'x', title: 't', artist: '', source: { kind: 'upload', value: 'o' },
  created_at: '', last_played_at: null, mix: {}, playback: { tempo: 1, pitch_semitones: 0 },
  loops: [], active_loop: null, metronome: false, count_in_bars: 0, play_along: DEFAULT_PLAY_ALONG,
} as Song;

function renderRibbon(loop = { name: '', start_bar: 1, end_bar: 3 }) {
  const onLoopBars = vi.fn();
  const onSeekBar = vi.fn();
  const result = patternSource.barsFor({ song, analysis, grid, loop: null });
  if (!result.ok) throw new Error(result.error);
  render(
    <ChordRibbon
      bars={result.bars}
      songKey={result.key}
      loop={loop}
      grid={grid}
      getPosition={() => sampleIndex(96_000 + 10)}
      playing={false}
      seekNonce={0}
      onLoopBars={onLoopBars}
      onSeekBar={onSeekBar}
    />,
  );
  return { onLoopBars, onSeekBar };
}

describe('ChordRibbon', () => {
  it('lists every bar with its chord, lights the current one and tints the loop', () => {
    renderRibbon();
    const cells = screen.getAllByRole('button');
    expect(cells.map((c) => c.textContent)).toEqual(['1G', '2C', '3D', '4G']);
    expect(cells[1]).toHaveAttribute('data-current', 'true');
    expect(cells[1]).toHaveAttribute('data-in-loop', 'true');
    expect(cells[3]).toHaveAttribute('data-in-loop', 'false');
  });

  it('click moves the playhead to the bar and leaves the loop alone', () => {
    const { onLoopBars, onSeekBar } = renderRibbon();
    fireEvent.click(screen.getByRole('button', { name: /Bar 4/ }));
    expect(onSeekBar).toHaveBeenCalledWith(3);
    expect(onLoopBars).not.toHaveBeenCalled();
  });

  it('ctrl-click sets the loop start, shift-click the end, and neither seeks', () => {
    const { onLoopBars, onSeekBar } = renderRibbon();
    fireEvent.click(screen.getByRole('button', { name: /Bar 4/ }), { ctrlKey: true });
    // A start past the current end pushes the end along: at least one bar.
    expect(onLoopBars).toHaveBeenLastCalledWith(3, 4);
    fireEvent.click(screen.getByRole('button', { name: /Bar 4/ }), { shiftKey: true });
    expect(onLoopBars).toHaveBeenLastCalledWith(1, 4);
    // Shift-click before the start is not an end of anything.
    onLoopBars.mockClear();
    fireEvent.click(screen.getByRole('button', { name: /Bar 1/ }), { shiftKey: true });
    expect(onLoopBars).not.toHaveBeenCalled();
    expect(onSeekBar).not.toHaveBeenCalled();
  });
});
