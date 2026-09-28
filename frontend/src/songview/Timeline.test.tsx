import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { buildGrid } from '../music/grid';
import { sampleIndex, SAMPLE_RATE } from '../engine/types';
import { Timeline } from './Timeline';

function grid8() {
  const beats: number[] = [];
  const downbeats: number[] = [];
  for (let i = 0; i < 32; i++) {
    beats.push(i * 24_000);
    if (i % 4 === 0) downbeats.push(i * 24_000);
  }
  return buildGrid({ bpm: 120, beats, downbeats })!;
}

describe('Timeline', () => {
  it('labels every bar on the ruler', () => {
    render(
      <Timeline
        grid={grid8()}
        durationSamples={sampleIndex(SAMPLE_RATE * 16)}
        loop={null}
        loopArmed={false}
        getPosition={() => sampleIndex(0)}
        playing={false}
        seekNonce={0}
        onScrub={vi.fn()}
      />,
    );
    // Bars are 1-indexed on screen and 0-indexed in the data (UI spec §5).
    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument();
  });

  it('renders the A-B region with its bar labels when a loop is set', () => {
    render(
      <Timeline
        grid={grid8()}
        durationSamples={sampleIndex(SAMPLE_RATE * 16)}
        loop={{ startBar: 2, endBar: 5 }}
        loopArmed
        getPosition={() => sampleIndex(0)}
        playing={false}
        seekNonce={0}
        onScrub={vi.fn()}
      />,
    );
    const region = screen.getByRole('region', { name: /loop/i });
    expect(region).toHaveAttribute('data-armed', 'true');
    expect(region).toHaveTextContent('3');
    expect(region).toHaveTextContent('6');
  });

  it('greys the region when the loop is disarmed (U-06)', () => {
    render(
      <Timeline
        grid={grid8()}
        durationSamples={sampleIndex(SAMPLE_RATE * 16)}
        loop={{ startBar: 2, endBar: 5 }}
        loopArmed={false}
        getPosition={() => sampleIndex(0)}
        playing={false}
        seekNonce={0}
        onScrub={vi.fn()}
      />,
    );
    expect(screen.getByRole('region', { name: /loop/i })).toHaveAttribute('data-armed', 'false');
  });

  it('scrubs to the sample offset of the clicked point', async () => {
    const onScrub = vi.fn();
    render(
      <Timeline
        grid={grid8()}
        durationSamples={sampleIndex(SAMPLE_RATE * 16)}
        loop={null}
        loopArmed={false}
        getPosition={() => sampleIndex(0)}
        playing={false}
        seekNonce={0}
        onScrub={onScrub}
      />,
    );
    const track = screen.getByTestId('timeline-track');
    // jsdom reports zero-size rects, so the component must read the rect once
    // and divide -- the test pins the contract, not the pixel maths.
    vi.spyOn(track, 'getBoundingClientRect').mockReturnValue({
      left: 0, width: 1000, top: 0, height: 40, right: 1000, bottom: 40, x: 0, y: 0,
      toJSON: () => ({}),
    } as DOMRect);
    track.dispatchEvent(new MouseEvent('click', { clientX: 250, bubbles: true }));
    expect(onScrub).toHaveBeenCalledWith(sampleIndex(SAMPLE_RATE * 4));
  });

  it('renders no ruler and says why when there is no grid', () => {
    render(
      <Timeline
        grid={null}
        durationSamples={sampleIndex(SAMPLE_RATE * 16)}
        loop={null}
        loopArmed={false}
        getPosition={() => sampleIndex(0)}
        playing={false}
        seekNonce={0}
        onScrub={vi.fn()}
      />,
    );
    expect(screen.getByText(/no beat grid/i)).toBeInTheDocument();
  });
});
