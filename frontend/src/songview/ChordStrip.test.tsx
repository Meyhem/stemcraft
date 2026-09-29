import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { ChordSegment } from '../api/client';
import { buildGrid } from '../music/grid';
import { timeScale } from '../music/timeScale';
import { sampleIndex } from '../engine/types';
import { ChordStrip } from './ChordStrip';

const grid = buildGrid({
  bpm: 120,
  beats: Array.from({ length: 16 }, (_, i) => i * 24_000),
  downbeats: [0, 96_000, 192_000, 288_000],
})!;

// 1x: 56 px per 96 000-sample bar.
const oneX = timeScale({ durationSamples: 384_000, grid, zoom: '1x', viewportWidth: 0 });

const bar = (i: number, chord: string, len = 1): ChordSegment => ({
  bar: i,
  start_sample: i * 96_000,
  end_sample: (i + len) * 96_000,
  chord,
});

const chords = [bar(0, 'G:maj'), bar(1, 'E:min'), bar(2, 'N'), bar(3, 'X')];

function renderStrip(over: Partial<Parameters<typeof ChordStrip>[0]> = {}) {
  return render(
    <ChordStrip
      chords={chords}
      scale={oneX}
      compact={false}
      getPosition={() => sampleIndex(0)}
      playing={false}
      seekNonce={0}
      {...over}
    />,
  );
}

describe('ChordStrip', () => {
  it('renders chords in a readable spelling, not the wire format', () => {
    renderStrip();
    expect(screen.getByText('G')).toBeInTheDocument();
    expect(screen.getByText('Em')).toBeInTheDocument();
  });

  it('shows no-chord and unclassifiable segments honestly rather than blank', () => {
    renderStrip();
    expect(screen.getByLabelText(/no chord/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/unclassified/i)).toBeInTheDocument();
  });

  it('keeps the row and says so when there are no chords rather than rendering an empty strip', () => {
    renderStrip({ chords: [] });
    expect(
      screen.getByText('No chord chart for this song yet — it appears after analysis.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Chords')).toBeInTheDocument();
  });

  it('marks the chord under the playhead as current', () => {
    renderStrip({ getPosition: () => sampleIndex(100_000) });
    expect(screen.getByText('Em').closest('[data-current]')).toHaveAttribute('data-current', 'true');
    expect(screen.getByText('G').closest('[data-current]')).toHaveAttribute('data-current', 'false');
  });

  it('merges a run of the same chord into one segment spanning its bars', () => {
    renderStrip({ chords: [bar(0, 'G:maj'), bar(1, 'G:maj'), bar(2, 'G:maj'), bar(3, 'C:maj')] });
    expect(screen.getAllByText('G')).toHaveLength(1);
    const g = screen.getByLabelText('G major');
    expect(g.style.left).toBe('0px');
    expect(g.style.width).toBe('168px');
    expect(screen.getByLabelText('C major').style.left).toBe('168px');
  });

  it('hides a label that does not fit, keeping its full name as aria-label and title', () => {
    renderStrip({ chords: [bar(0, 'C:maj7'), bar(1, 'G:maj')] });
    expect(screen.queryByText('Cmaj7')).not.toBeInTheDocument();
    const segment = screen.getByLabelText('C maj7');
    expect(segment).toHaveAttribute('title', 'C maj7');
    // Given room (2x), the same label shows.
    const twoX = timeScale({ durationSamples: 384_000, grid, zoom: '2x', viewportWidth: 0 });
    renderStrip({ chords: [bar(0, 'C:maj7')], scale: twoX });
    expect(screen.getByText('Cmaj7')).toBeInTheDocument();
  });

  it('sizes the fit test to the smaller Fit-zoom type', () => {
    // 40 px per bar: "Em" does not fit at 24 px type, and does at 15 px.
    const tight = { ...oneX, pxPerSample: 40 / 96_000, pxPerBar: 40 };
    const { unmount } = renderStrip({ chords: [bar(0, 'E:min')], scale: tight, compact: false });
    expect(screen.queryByText('Em')).not.toBeInTheDocument();
    unmount();
    renderStrip({ chords: [bar(0, 'E:min')], scale: tight, compact: true });
    expect(screen.getByText('Em')).toBeInTheDocument();
  });

  it('spells flats with ♭', () => {
    renderStrip({ chords: [bar(0, 'Bb:maj'), bar(1, 'Eb:min', 2)] });
    expect(screen.getByText('B♭')).toBeInTheDocument();
    expect(screen.getByText('E♭m')).toBeInTheDocument();
  });

  it('marks no-chord and unclassified segments as quiet', () => {
    renderStrip();
    expect(screen.getByLabelText(/no chord/i)).toHaveAttribute('data-quiet', 'true');
    expect(screen.getByLabelText('G major')).toHaveAttribute('data-quiet', 'false');
  });
});
