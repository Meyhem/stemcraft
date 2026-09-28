import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { buildGrid } from '../music/grid';
import { sampleIndex } from '../engine/types';
import { ChordStrip } from './ChordStrip';

const grid = buildGrid({
  bpm: 120,
  beats: Array.from({ length: 16 }, (_, i) => i * 24_000),
  downbeats: [0, 96_000, 192_000, 288_000],
})!;

const chords = [
  { bar: 0, start_sample: 0, end_sample: 96_000, chord: 'G:maj' },
  { bar: 1, start_sample: 96_000, end_sample: 192_000, chord: 'E:min' },
  { bar: 2, start_sample: 192_000, end_sample: 288_000, chord: 'N' },
  { bar: 3, start_sample: 288_000, end_sample: 384_000, chord: 'X' },
];

describe('ChordStrip', () => {
  it('renders chords in a readable spelling, not the wire format', () => {
    render(
      <ChordStrip chords={chords} grid={grid} durationSamples={sampleIndex(384_000)} getPosition={() => sampleIndex(0)} playing={false} seekNonce={0} />,
    );
    expect(screen.getByText('G')).toBeInTheDocument();
    expect(screen.getByText('Em')).toBeInTheDocument();
  });

  it('shows no-chord and unclassifiable segments honestly rather than blank', () => {
    render(
      <ChordStrip chords={chords} grid={grid} durationSamples={sampleIndex(384_000)} getPosition={() => sampleIndex(0)} playing={false} seekNonce={0} />,
    );
    expect(screen.getByLabelText(/no chord/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/unclassified/i)).toBeInTheDocument();
  });

  it('says so when there are no chords rather than rendering an empty strip', () => {
    render(
      <ChordStrip chords={[]} grid={grid} durationSamples={sampleIndex(384_000)} getPosition={() => sampleIndex(0)} playing={false} seekNonce={0} />,
    );
    expect(screen.getByText(/no chord chart/i)).toBeInTheDocument();
  });

  it('marks the chord under the playhead as current', () => {
    render(
      <ChordStrip chords={chords} grid={grid} durationSamples={sampleIndex(384_000)} getPosition={() => sampleIndex(100_000)} playing={false} seekNonce={0} />,
    );
    expect(screen.getByText('Em').closest('[data-current]')).toHaveAttribute('data-current', 'true');
  });
});
