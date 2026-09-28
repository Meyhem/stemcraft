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

  it('will not push a boundary past the end of the album', () => {
    render(<WaveformMarkers {...props} splitPoints={[479000]} />);
    const marker = screen.getByRole('slider', { name: /split point/i });
    fireEvent.keyDown(marker, { key: 'ArrowRight', shiftKey: true });
    expect(props.onMove).toHaveBeenCalledWith(0, 480000);
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

  it('draws its own playhead from the prop, since wavesurfer\'s cursor is off', () => {
    render(<WaveformMarkers {...props} playheadSample={120000} />);
    expect(screen.getByTestId('album-playhead').style.left).toBe('25%');
  });

  it('draws no playhead when the preview has no position', () => {
    render(<WaveformMarkers {...props} />);
    expect(screen.queryByTestId('album-playhead')).toBeNull();
  });
});
