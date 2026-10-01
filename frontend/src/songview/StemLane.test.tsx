import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { StemSummary } from '../engine/stemPeaks';
import { MAX_CANVAS_PX } from '../music/timeScale';
import { StemLane } from './StemLane';

// jsdom has no canvas: a recording 2d context stands in, so the tests can see what
// was painted, in what colour and how wide.
interface Rect {
  x: number;
  h: number;
  style: unknown;
}
const rects: Rect[] = [];
let realGetContext: typeof HTMLCanvasElement.prototype.getContext;
beforeEach(() => {
  rects.length = 0;
  realGetContext = HTMLCanvasElement.prototype.getContext;
  const ctx = {
    fillStyle: '' as unknown,
    setTransform: () => {},
    clearRect: () => void (rects.length = 0),
    fillRect(x: number, _y: number, _w: number, h: number) {
      rects.push({ x, h, style: this.fillStyle });
    },
  };
  HTMLCanvasElement.prototype.getContext = (() => ctx) as unknown as typeof realGetContext;
});
afterEach(() => {
  HTMLCanvasElement.prototype.getContext = realGetContext;
});

// A stand-in scroller: the visible content is `clientWidth - 200` (the sticky head).
function fakeScroller(clientWidth: number, scrollLeft = 0) {
  const el = document.createElement('div');
  Object.defineProperty(el, 'clientWidth', { configurable: true, get: () => clientWidth });
  el.scrollLeft = scrollLeft;
  return el;
}

const summary = (over: Partial<StemSummary> = {}): StemSummary => ({
  name: 'bass',
  envelope: Float32Array.from([0.4, 0.6, 0.2]),
  peak: 0.6,
  nearSilent: false,
  ...over,
});

function renderLane(over: Partial<Parameters<typeof StemLane>[0]> = {}) {
  const props = {
    summary: summary(),
    width: 896,
    scroller: null as HTMLElement | null,
    muted: false,
    soloed: false,
    gainDb: 0,
    anySoloed: false,
    onMuteToggle: vi.fn(),
    onSoloToggle: vi.fn(),
    onGainChange: vi.fn(),
    ...over,
  };
  const utils = render(<StemLane {...props} />);
  return { ...props, ...utils, props };
}

describe('StemLane', () => {
  it('always names the stem in text, never by colour alone', () => {
    renderLane();
    expect(screen.getByText('bass')).toBeInTheDocument();
  });

  it('reports mute state through aria-pressed, not just styling', async () => {
    const props = renderLane({ muted: true });
    const mute = screen.getByRole('button', { name: /mute bass/i });
    expect(mute).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(mute);
    expect(props.onMuteToggle).toHaveBeenCalledOnce();
  });

  it('marks a near-silent lane and makes M/S inert (U-10)', () => {
    renderLane({ summary: summary({ nearSilent: true }) });
    expect(screen.getByText(/near-silent/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /mute bass/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /solo bass/i })).toBeDisabled();
  });

  it('mirrors the gain slider as a mono readout (UI spec §5)', () => {
    renderLane({ gainDb: -6 });
    expect(screen.getByText('-6.0 dB')).toBeInTheDocument();
  });

  it('reports itself as silenced-by-solo when another lane is soloed', () => {
    renderLane({ anySoloed: true, soloed: false });
    expect(screen.getByRole('group', { name: /bass/i })).toHaveAttribute('data-silenced', 'true');
  });

  it('paints the waveform with the stem\'s concrete colour, never a var() string', () => {
    // A canvas cannot resolve CSS variables: handed 'var(--ds-bass)' it ignores the colour
    // and fills black on a near-black lane. Load-bearing: the test defines the token, so
    // passing the literal string through fails on the string, and resolving the wrong
    // token fails on the value.
    document.documentElement.style.setProperty('--ds-bass', '#4FC3B0');
    document.documentElement.style.setProperty('--ds-text-2', '#9BA3AE');
    try {
      renderLane();
      expect(rects.length).toBeGreaterThan(0);
      expect(new Set(rects.map((r) => r.style))).toEqual(new Set(['#4FC3B0']));
    } finally {
      document.documentElement.style.removeProperty('--ds-bass');
      document.documentElement.style.removeProperty('--ds-text-2');
    }
  });

  it('falls back to a legible colour, not black, when the stem token is undefined', () => {
    document.documentElement.style.setProperty('--ds-text-2', '#9BA3AE');
    try {
      renderLane();
      expect(rects[0]!.style).toBe('#9BA3AE');
    } finally {
      document.documentElement.style.removeProperty('--ds-text-2');
    }
  });

  it('cannot play: it renders no media element, only a canvas (invariant #7)', () => {
    const { container } = renderLane();
    expect(container.querySelector('audio, video')).toBeNull();
    expect(screen.getByTestId('bass-canvas').tagName).toBe('CANVAS');
  });

  it('makes the lane exactly the time axis content width, so it aligns with the bars', () => {
    renderLane({ width: 896 });
    expect(screen.getByTestId('bass-wave').style.width).toBe('896px');
  });

  it('paints only the visible slice, however wide the zoomed lane is', () => {
    // 100 000 px of lane, 700 px of viewport (900 minus the 200 px head).
    renderLane({ width: 100_000, scroller: fakeScroller(900) });
    expect(rects).toHaveLength(700);
    expect(screen.getByTestId('bass-canvas').style.width).toBe('700px');
  });

  it('never allocates a canvas wider than browsers allow, even before the scroller is measured', () => {
    // Firefox throws on a canvas over 32 767 px; with no scroller yet the lane is all there is.
    renderLane({ width: 100_000 });
    const canvas = screen.getByTestId('bass-canvas') as HTMLCanvasElement;
    expect(canvas.width).toBeGreaterThan(0);
    expect(canvas.width).toBeLessThanOrEqual(MAX_CANVAS_PX);
  });

  it('repaints the new slice when the axis is scrolled', async () => {
    // Envelope: quiet first half, loud second half; the lane is 1000 px, 500 visible.
    const envelope = Float32Array.from([...Array(50).fill(0.1), ...Array(50).fill(0.9)]);
    const scroller = fakeScroller(700, 0);
    renderLane({ width: 1000, scroller, summary: summary({ envelope }) });
    const quiet = Math.max(...rects.map((r) => r.h));
    scroller.scrollLeft = 500;
    scroller.dispatchEvent(new Event('scroll'));
    await act(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
    expect(Math.min(...rects.map((r) => r.h))).toBeGreaterThan(quiet);
  });

  it('draws a near-silent stem at its real, small amplitude rather than normalising it up (U-10)', () => {
    renderLane({ summary: summary({ envelope: Float32Array.from([0.01, 0.01, 0.01]), nearSilent: true }) });
    expect(Math.max(...rects.map((r) => r.h))).toBeLessThan(2);
  });

  it('emits gain changes in dB', async () => {
    const props = renderLane();
    const slider = screen.getByRole('slider', { name: /bass gain/i });
    // user-event's `clear` only works on text-like inputs, not input[type=range];
    // drive the change with fireEvent instead (controller ruling, Task 9 brief).
    fireEvent.change(slider, { target: { value: '-12' } });
    expect(props.onGainChange).toHaveBeenCalledWith(-12);
  });
});
