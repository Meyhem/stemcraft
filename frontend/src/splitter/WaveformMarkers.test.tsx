import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { WaveformMarkers } from './WaveformMarkers';

const props = {
  peaks: [0, 0.5, 1, 0.5, 0],
  totalSamples: 480000, // 10 s at 48 kHz
  splitPoints: [240000], // one boundary at 5 s
  getPlayheadSample: () => 0,
  playing: false,
  seekNonce: 0,
  onTogglePlay: vi.fn(),
  onMove: vi.fn(),
  onAdd: vi.fn(),
  onRemove: vi.fn(),
  onScrub: vi.fn(),
};

// jsdom has no layout: a fixed box for the waveform content, and a viewport width.
function boxAt(left: number, width: number) {
  return vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
    left,
    width,
    right: left + width,
    top: 0,
    bottom: 0,
    height: 0,
    x: left,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect);
}

describe('WaveformMarkers', () => {
  beforeEach(() => {
    props.onTogglePlay.mockClear();
    props.onMove.mockClear();
    props.onAdd.mockClear();
    props.onRemove.mockClear();
    props.onScrub.mockClear();
  });

  it('renders one marker per split point', () => {
    render(<WaveformMarkers {...props} />);
    expect(screen.getAllByRole('slider', { name: /split point/i })).toHaveLength(1);
  });

  it('positions a marker by its fraction of the album, not by seconds', () => {
    render(<WaveformMarkers {...props} />);
    const marker = screen.getByRole('slider', { name: /split point/i });
    expect(marker.style.left).toBe('50%');
  });

  it('exposes the boundary in samples through aria, so it is readable by a screen reader', () => {
    render(<WaveformMarkers {...props} />);
    const marker = screen.getByRole('slider', { name: /split point/i });
    expect(marker).toHaveAttribute('aria-valuenow', '240000');
    expect(marker).toHaveAttribute('aria-valuemin', '0');
    expect(marker).toHaveAttribute('aria-valuemax', '480000');
  });

  it('removes a marker when its remove control is pressed', () => {
    render(<WaveformMarkers {...props} />);
    fireEvent.click(screen.getByRole('button', { name: /remove split point 1/i }));
    expect(props.onRemove).toHaveBeenCalledWith(0);
  });

  it('moves a marker with the arrow keys, so a boundary is placeable without a mouse (U-02)', () => {
    render(<WaveformMarkers {...props} />);
    const marker = screen.getByRole('slider', { name: /split point/i });
    fireEvent.keyDown(marker, { key: 'ArrowRight' });
    // One step is 0.1 s = 4800 samples at 48 kHz.
    expect(props.onMove).toHaveBeenCalledWith(0, 244800);
  });

  it('moves a marker a whole second with shift held', () => {
    render(<WaveformMarkers {...props} />);
    const marker = screen.getByRole('slider', { name: /split point/i });
    fireEvent.keyDown(marker, { key: 'ArrowLeft', shiftKey: true });
    expect(props.onMove).toHaveBeenCalledWith(0, 192000);
  });

  // Album's validator rejects a point at 0 or at total_samples: both describe a
  // zero-length track. The screen autosaves every move, so a boundary allowed
  // to reach either end is a 422 on an ordinary drag to the edge.
  it('will not push a boundary onto the end of the album, which the server rejects', () => {
    render(<WaveformMarkers {...props} splitPoints={[479000]} />);
    const marker = screen.getByRole('slider', { name: /split point/i });
    fireEvent.keyDown(marker, { key: 'ArrowRight', shiftKey: true });
    expect(props.onMove).toHaveBeenCalledWith(0, 479999);
  });

  it('will not push a boundary onto the start of the album, which the server rejects', () => {
    render(<WaveformMarkers {...props} splitPoints={[1000]} />);
    const marker = screen.getByRole('slider', { name: /split point/i });
    fireEvent.keyDown(marker, { key: 'ArrowLeft', shiftKey: true });
    expect(props.onMove).toHaveBeenCalledWith(0, 1);
  });

  it('keeps End and Home inside the album too, not only the arrow keys', () => {
    render(<WaveformMarkers {...props} />);
    const marker = screen.getByRole('slider', { name: /split point/i });
    fireEvent.keyDown(marker, { key: 'End' });
    expect(props.onMove).toHaveBeenCalledWith(0, 479999);
    fireEvent.keyDown(marker, { key: 'Home' });
    expect(props.onMove).toHaveBeenCalledWith(0, 1);
  });

  it('clamps a drag to the edge inside the album', () => {
    // jsdom implements no part of the pointer-capture API, so the two calls
    // the drag makes have to exist before the real handler can run at all.
    const captured = new Set<number>();
    const element = Element.prototype as unknown as {
      setPointerCapture?: (id: number) => void;
      hasPointerCapture?: (id: number) => boolean;
      releasePointerCapture?: (id: number) => void;
    };
    element.setPointerCapture = (id) => void captured.add(id);
    element.hasPointerCapture = (id) => captured.has(id);
    element.releasePointerCapture = (id) => void captured.delete(id);

    const rect = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      width: 100,
      right: 100,
      top: 0,
      bottom: 0,
      height: 0,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect);
    try {
      render(<WaveformMarkers {...props} />);
      const marker = screen.getByRole('slider', { name: /split point/i });
      // jsdom has no PointerEvent, and the Event testing-library synthesises
      // for one drops clientX. A MouseEvent named `pointermove` is what React
      // is listening for and carries the coordinate.
      fireEvent(marker, new MouseEvent('pointerdown', { bubbles: true, clientX: 50 }));
      // Dragged off the left edge of the container entirely.
      fireEvent(marker, new MouseEvent('pointermove', { bubbles: true, clientX: -400 }));
      expect(props.onMove).toHaveBeenCalledWith(0, 1);
    } finally {
      rect.mockRestore();
      delete element.setPointerCapture;
      delete element.hasPointerCapture;
      delete element.releasePointerCapture;
    }
  });

  it('will not drag a boundary across its neighbour', () => {
    render(<WaveformMarkers {...props} splitPoints={[240000, 242000]} />);
    const first = screen.getByRole('slider', { name: /split point 1/i });
    fireEvent.keyDown(first, { key: 'ArrowRight', shiftKey: true });
    // 240000 + 48000 would land past the second boundary at 242000.
    expect(props.onMove).toHaveBeenCalledWith(0, 241999);
  });

  it('reports sample indices, never seconds, to every callback (invariant 4)', () => {
    render(<WaveformMarkers {...props} />);
    const marker = screen.getByRole('slider', { name: /split point/i });
    fireEvent.keyDown(marker, { key: 'ArrowRight' });
    const [, sample] = props.onMove.mock.calls.at(-1)!;
    expect(Number.isInteger(sample)).toBe(true);
  });

  it('rounds a pointer position to a whole sample before reporting it (invariant 4)', () => {
    // A width that does not divide the album evenly: 3/7 of 480000 is
    // 205714.2857…, so an unrounded implementation would hand on a float.
    const rect = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      width: 7,
      right: 7,
      top: 0,
      bottom: 0,
      height: 0,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect);
    try {
      render(<WaveformMarkers {...props} />);
      fireEvent.click(screen.getByTestId('album-waveform'), { clientX: 3, clientY: 60 });
      const [sample] = props.onAdd.mock.calls.at(-1)!;
      expect(Number.isInteger(sample)).toBe(true);
      expect(sample).toBe(205714);
    } finally {
      rect.mockRestore();
    }
  });

  it('seeks when the ruler is clicked, and adds a cut when the waveform below it is', () => {
    const rect = boxAt(0, 100);
    try {
      render(<WaveformMarkers {...props} />);
      const content = screen.getByTestId('album-waveform');
      fireEvent.click(content, { clientX: 25, clientY: 10 });
      expect(props.onScrub).toHaveBeenCalledWith(120000);
      expect(props.onAdd).not.toHaveBeenCalled();
      fireEvent.click(content, { clientX: 25, clientY: 80 });
      expect(props.onAdd).toHaveBeenCalledWith(120000);
      expect(props.onScrub).toHaveBeenCalledTimes(1);
    } finally {
      rect.mockRestore();
    }
  });

  it('places the playhead in px from the audio clock', () => {
    // No layout in jsdom: 25 px/s fit fallback -> 10 s is 250 px, 2.5 s is 62.5 px.
    render(<WaveformMarkers {...props} getPlayheadSample={() => 120000} />);
    expect(screen.getByTestId('album-playhead').style.left).toBe('62.5px');
  });

  it('reads the time from the same clock, to the millisecond', () => {
    render(<WaveformMarkers {...props} getPlayheadSample={() => 34_769_136} />);
    expect(screen.getByTestId('album-time')).toHaveTextContent('12:04.357');
    expect(screen.getByText(/0:10\.000/)).toBeInTheDocument(); // the album length
  });

  it('play button reflects and toggles playback', () => {
    const { rerender } = render(<WaveformMarkers {...props} />);
    fireEvent.click(screen.getByRole('button', { name: 'Play' }));
    expect(props.onTogglePlay).toHaveBeenCalledTimes(1);
    rerender(<WaveformMarkers {...props} playing />);
    expect(screen.getByRole('button', { name: 'Pause' })).toHaveAttribute('aria-pressed', 'true');
  });
});

describe('WaveformMarkers zoom', () => {
  const width = () => Number.parseFloat(screen.getByTestId('album-waveform').style.width);

  it('starts fitted, zooms in and out with the buttons, and Fit returns', () => {
    render(<WaveformMarkers {...props} />);
    expect(screen.getByTestId('album-zoom')).toHaveTextContent('Whole album');
    const fitted = width();
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    expect(width()).toBeGreaterThan(fitted);
    expect(screen.getByTestId('album-zoom')).toHaveTextContent('px/s');
    fireEvent.click(screen.getByRole('button', { name: 'Fit' }));
    expect(width()).toBe(fitted);
    expect(screen.getByTestId('album-zoom')).toHaveTextContent('Whole album');
  });

  it('cannot zoom out past fit', () => {
    render(<WaveformMarkers {...props} />);
    const fitted = width();
    fireEvent.click(screen.getByRole('button', { name: 'Zoom out' }));
    expect(width()).toBe(fitted);
  });

  it('cannot zoom in past the envelope resolution', () => {
    render(<WaveformMarkers {...props} />);
    for (let i = 0; i < 30; i++) fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    expect(width()).toBe(10 * 100); // 10 s at 100 px/s
  });

  it('ctrl+wheel zooms, and the page is not zoomed with it', () => {
    render(<WaveformMarkers {...props} />);
    const before = width();
    const event = new WheelEvent('wheel', { ctrlKey: true, deltaY: -100, cancelable: true, bubbles: true });
    act(() => {
      screen.getByTestId('album-scroller').dispatchEvent(event);
    });
    expect(event.defaultPrevented).toBe(true);
    expect(width()).toBeGreaterThan(before);
  });

  it('a plain wheel is left to the browser when there is nothing to pan', () => {
    render(<WaveformMarkers {...props} />);
    const event = new WheelEvent('wheel', { deltaY: 100, cancelable: true, bubbles: true });
    screen.getByTestId('album-scroller').dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });
});

describe('WaveformMarkers painting', () => {
  interface Rect {
    x: number;
    y: number;
    w: number;
    h: number;
    style: unknown;
  }
  const rects: Rect[] = [];
  let realGetContext: typeof HTMLCanvasElement.prototype.getContext;
  let clientWidth: PropertyDescriptor | undefined;

  beforeEach(() => {
    rects.length = 0;
    realGetContext = HTMLCanvasElement.prototype.getContext;
    const ctx = {
      fillStyle: '' as unknown,
      font: '',
      textBaseline: '',
      setTransform: () => {},
      // Each paint starts with a clear, so `rects` is always the latest frame.
      clearRect: () => void (rects.length = 0),
      fillText: () => {},
      fillRect(x: number, y: number, w: number, h: number) {
        rects.push({ x, y, w, h, style: this.fillStyle });
      },
    };
    HTMLCanvasElement.prototype.getContext = (() => ctx) as unknown as typeof realGetContext;
    clientWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 200 });
  });

  afterEach(() => {
    HTMLCanvasElement.prototype.getContext = realGetContext;
    if (clientWidth) Object.defineProperty(HTMLElement.prototype, 'clientWidth', clientWidth);
    else delete (HTMLElement.prototype as { clientWidth?: number }).clientWidth;
  });

  // The waveform bars sit below the 24 px ruler strip.
  const bars = () => rects.filter((r) => r.y >= 24);

  it('paints the played part and the rest in different colours, split at the playhead', () => {
    // Viewport 200 px, 10 s -> 20 px/s; the playhead at 2.5 s is x = 50.
    render(<WaveformMarkers {...props} getPlayheadSample={() => 120000} />);
    const before = bars().filter((r) => r.x < 50);
    const after = bars().filter((r) => r.x >= 50);
    expect(before.length).toBeGreaterThan(0);
    expect(after.length).toBeGreaterThan(0);
    const played = new Set(before.map((r) => r.style));
    const rest = new Set(after.map((r) => r.style));
    expect(played.size).toBe(1);
    expect(rest.size).toBe(1);
    expect([...played][0]).not.toBe([...rest][0]);
  });

  it('never fills black: an unresolvable token falls back to a legible colour', () => {
    render(<WaveformMarkers {...props} />);
    for (const r of rects) expect(String(r.style).toLowerCase()).not.toMatch(/^(#000|black|#000000)$/);
  });

  it('draws silence as a hairline rather than dropping the column', () => {
    render(<WaveformMarkers {...props} peaks={[0, 0, 1, 0, 0]} />);
    const columns = bars();
    expect(columns).toHaveLength(200); // one bar per pixel column, none skipped
    expect(Math.min(...columns.map((r) => r.h))).toBeGreaterThanOrEqual(2); // 1 px each side of centre
  });
});
