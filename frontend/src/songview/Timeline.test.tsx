import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { buildGrid } from '../music/grid';
import { timeScale, type TimeScale } from '../music/timeScale';
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

const DURATION = sampleIndex(SAMPLE_RATE * 16); // 8 bars of 2 s
// 1x: 56 px per bar, so the 8-bar song is 448 px wide.
const oneX = timeScale({ durationSamples: DURATION, grid: grid8(), zoom: '1x', viewportWidth: 0 });
const atPxPerBar = (pxPerBar: number): TimeScale => ({
  pxPerBar,
  pxPerSample: pxPerBar / 96_000,
  contentWidth: 8 * pxPerBar,
});

function renderTimeline(over: Partial<Parameters<typeof Timeline>[0]> = {}) {
  const props = {
    grid: grid8(),
    durationSamples: DURATION,
    scale: oneX,
    loop: null,
    loopArmed: false,
    getPosition: () => sampleIndex(0),
    playing: false,
    seekNonce: 0,
    onScrub: vi.fn(),
    scroller: null,
    follow: false,
    ...over,
  };
  const utils = render(<Timeline {...props} />);
  return { props, ...utils };
}

/** A stand-in for the scroll container: jsdom has no layout or scrolling. */
function fakeScroller(clientWidth: number, scrollLeft = 0) {
  return { clientWidth, scrollLeft } as HTMLElement;
}

const labels = () =>
  Array.from(document.querySelectorAll('[data-testid="timeline-track"] b')).map((b) => b.textContent);

describe('Timeline', () => {
  it('labels every bar on the ruler at 1x', () => {
    renderTimeline();
    // Bars are 1-indexed on screen and 0-indexed in the data (UI spec §5).
    expect(labels()).toEqual(['1', '2', '3', '4', '5', '6', '7', '8']);
  });

  it('thins the labels as bars get narrow, so numbers never collide', () => {
    const { unmount } = renderTimeline({ scale: atPxPerBar(30) });
    expect(labels()).toEqual(['1', '3', '5', '7']);
    unmount();
    renderTimeline({ scale: atPxPerBar(20) });
    expect(labels()).toEqual(['1', '5']);
  });

  it('brightens every 4th bar label, the phrase downbeat', () => {
    renderTimeline();
    expect(screen.getByText('1')).toHaveAttribute('data-phrase', 'true');
    expect(screen.getByText('2')).toHaveAttribute('data-phrase', 'false');
    expect(screen.getByText('5')).toHaveAttribute('data-phrase', 'true');
  });

  it('positions bar lines in px on the shared scale', () => {
    renderTimeline();
    const bars = document.querySelectorAll<HTMLElement>('[data-line="bar"], [data-line="phrase"]');
    expect(bars).toHaveLength(8);
    expect(bars[2]!.style.left).toBe('112px');
    expect(bars[4]).toHaveAttribute('data-line', 'phrase');
  });

  it('draws faint beat lines only when a bar is wide enough to subdivide', () => {
    const { unmount } = renderTimeline();
    expect(document.querySelectorAll('[data-line="beat"]').length).toBe(32);
    unmount();
    renderTimeline({ scale: atPxPerBar(30) });
    expect(document.querySelectorAll('[data-line="beat"]').length).toBe(0);
  });

  it('renders the A-B region with its bar labels when a loop is set', () => {
    renderTimeline({ loop: { startBar: 2, endBar: 5 }, loopArmed: true });
    const region = screen.getByRole('region', { name: /loop/i });
    expect(region).toHaveAttribute('data-armed', 'true');
    expect(region).toHaveTextContent('3');
    expect(region).toHaveTextContent('6');
    expect(region.style.left).toBe('112px');
    expect(region.style.width).toBe('168px');
  });

  it('greys the region when the loop is disarmed (U-06)', () => {
    renderTimeline({ loop: { startBar: 2, endBar: 5 }, loopArmed: false });
    expect(screen.getByRole('region', { name: /loop/i })).toHaveAttribute('data-armed', 'false');
  });

  it('scrubs to the sample under the clicked pixel of the scrolled content', () => {
    const { props } = renderTimeline();
    const track = screen.getByTestId('timeline-track');
    // jsdom reports zero-size rects. The rect's left is where the content
    // starts on screen -- already shifted by any scroll -- so the click's
    // offset from it is a content-space x.
    vi.spyOn(track, 'getBoundingClientRect').mockReturnValue({
      left: -300, width: 448, top: 0, height: 28, right: 148, bottom: 28, x: -300, y: 0,
      toJSON: () => ({}),
    } as DOMRect);
    // x = 412 px into the content: bar 8 at 56 px/bar is 392, +20 px = 1/2.8 of a bar.
    track.dispatchEvent(new MouseEvent('click', { clientX: 112, bubbles: true }));
    expect(props.onScrub).toHaveBeenCalledWith(sampleIndex((412 / 56) * 96_000));
  });

  it('paints the playhead in px from the engine clock', () => {
    renderTimeline({ getPosition: () => sampleIndex(96_000 * 3) });
    expect(screen.getByTestId('playhead').style.left).toBe('168px');
  });

  it('says why when there is no grid, and still takes a scrub', () => {
    const { props } = renderTimeline({ grid: null });
    expect(screen.getByText('Bars need analysis to have run')).toBeInTheDocument();
    const track = screen.getByTestId('timeline-track');
    vi.spyOn(track, 'getBoundingClientRect').mockReturnValue({
      left: 0, width: 448, top: 0, height: 28, right: 448, bottom: 28, x: 0, y: 0,
      toJSON: () => ({}),
    } as DOMRect);
    track.dispatchEvent(new MouseEvent('click', { clientX: 56, bubbles: true }));
    expect(props.onScrub).toHaveBeenCalledWith(sampleIndex(96_000));
  });

  describe('follow playhead', () => {
    // A 500 px scroller: 200 px of sticky heads, 300 px of visible content.
    it('brings an off-screen playhead back to a third of the view', () => {
      const scroller = fakeScroller(500, 0);
      renderTimeline({ getPosition: () => sampleIndex(96_000 * 7), scroller, follow: true });
      // x = 392; 392 - 300/3 = 292.
      expect(scroller.scrollLeft).toBe(292);
    });

    it('leaves the view alone when follow is off', () => {
      const scroller = fakeScroller(500, 0);
      renderTimeline({ getPosition: () => sampleIndex(96_000 * 7), scroller, follow: false });
      expect(scroller.scrollLeft).toBe(0);
    });

    it('re-centres on the playhead when the zoom changes, follow or not', () => {
      const scroller = fakeScroller(500, 0);
      const position = () => sampleIndex(96_000 * 4);
      const { rerender, props } = renderTimeline({ getPosition: position, scroller, follow: false });
      expect(scroller.scrollLeft).toBe(0);
      const twoX = timeScale({ durationSamples: DURATION, grid: grid8(), zoom: '2x', viewportWidth: 0 });
      rerender(<Timeline {...props} scale={twoX} />);
      // x = 4 * 112 = 448; 448 - 100 = 348.
      expect(scroller.scrollLeft).toBe(348);
    });
  });
});
