import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { WaveformMarkers } from './WaveformMarkers';

// Copied verbatim from src/songview/StemLane.test.tsx: wavesurfer needs a real
// canvas and ResizeObserver, and jsdom has neither. `create` is a spyable
// vi.fn() so the invariant-7 test below can pin exactly what it was
// constructed with.
const { createWaveSurfer } = vi.hoisted(() => ({
  createWaveSurfer: vi.fn((_options: Record<string, unknown>) => ({
    destroy: vi.fn(),
    setOptions: vi.fn(),
    on: () => () => {},
  })),
}));
vi.mock('wavesurfer.js', () => ({
  default: { create: createWaveSurfer },
}));

const props = {
  peaks: [0, 0.5, 1, 0.5, 0],
  totalSamples: 480000, // 10 s at 48 kHz
  splitPoints: [240000], // one boundary at 5 s
  playheadSample: null,
  onMove: vi.fn(),
  onAdd: vi.fn(),
  onRemove: vi.fn(),
  onScrub: vi.fn(),
};

describe('WaveformMarkers', () => {
  beforeEach(() => {
    createWaveSurfer.mockClear();
    props.onMove.mockClear();
    props.onAdd.mockClear();
    props.onRemove.mockClear();
    props.onScrub.mockClear();
  });

  it('constructs wavesurfer from precomputed peaks, never a URL or media element (invariant 7 / D-07)', () => {
    render(<WaveformMarkers {...props} />);
    const options = createWaveSurfer.mock.calls.at(-1)![0];
    expect(options.peaks).toBeDefined();
    expect(options.url).toBeUndefined();
    expect(options.media).toBeUndefined();
    expect(options.interact).toBe(false);
    // An explicit duration is the other half of "it cannot play": with peaks
    // and a duration there is nothing left for it to fetch.
    expect(options.duration).toBe(10);
    expect(options.cursorWidth).toBe(0);
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
      fireEvent.click(screen.getByTestId('album-waveform'), { clientX: 3 });
      const [sample] = props.onAdd.mock.calls.at(-1)!;
      expect(Number.isInteger(sample)).toBe(true);
      expect(sample).toBe(205714);
    } finally {
      rect.mockRestore();
    }
  });

  it('seeks the preview from the scrub strip, in samples', () => {
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
      fireEvent.click(screen.getByRole('button', { name: /scrub/i }), { clientX: 25 });
      expect(props.onScrub).toHaveBeenCalledWith(120000);
      expect(props.onAdd).not.toHaveBeenCalled();
    } finally {
      rect.mockRestore();
    }
  });

  it('measures the scrub strip against its own box, not the waveform\'s', () => {
    // The scrub strip is a SIBLING of the waveform, not a child of it. They
    // happen to be the same width today, so reading the waveform's box from
    // the scrub handler is invisible -- until either grows a padding or a
    // margin, at which point every seek lands in the wrong place.
    //
    // The other tests in this file mock getBoundingClientRect on
    // Element.prototype with a single fixed rect, which makes both elements
    // report the same box and so cannot tell the two apart. This one gives
    // the scrub strip a box offset from the waveform's, which is what makes
    // the difference observable.
    const rect = vi
      .spyOn(Element.prototype, 'getBoundingClientRect')
      .mockImplementation(function (this: Element) {
        const scrub = this.getAttribute('aria-label') === 'Scrub the preview';
        return {
          left: scrub ? 40 : 0,
          width: 100,
          right: scrub ? 140 : 100,
          top: 0,
          bottom: 0,
          height: 0,
          x: scrub ? 40 : 0,
          y: 0,
          toJSON: () => ({}),
        } as DOMRect;
      });
    try {
      render(<WaveformMarkers {...props} />);
      fireEvent.click(screen.getByRole('button', { name: /scrub/i }), { clientX: 65 });
      // 25 % into the scrub strip's own box. Measured against the waveform's
      // box instead it would be 65 %, i.e. 312000.
      expect(props.onScrub).toHaveBeenCalledWith(120000);
    } finally {
      rect.mockRestore();
    }
  });

  it('draws its own playhead from the prop, since wavesurfer\'s cursor is off', () => {
    render(<WaveformMarkers {...props} playheadSample={120000} />);
    expect(screen.getByTestId('album-playhead').style.left).toBe('25%');
  });

  it('draws no playhead when the preview has no position', () => {
    render(<WaveformMarkers {...props} />);
    expect(screen.queryByTestId('album-playhead')).toBeNull();
  });
});
