import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { sampleIndex } from '../engine/types';
import { MAX_CANVAS_PX } from '../music/timeScale';
import { TabStaff } from './TabStaff';

// jsdom has no canvas: a context whose every method is a no-op stands in for the painter.
let realGetContext: typeof HTMLCanvasElement.prototype.getContext;
beforeEach(() => {
  realGetContext = HTMLCanvasElement.prototype.getContext;
  const ctx = new Proxy({}, { get: (_target, key) => (key === 'measureText' ? () => ({ width: 0 }) : () => {}) });
  HTMLCanvasElement.prototype.getContext = (() => ctx) as unknown as typeof realGetContext;
});
afterEach(() => {
  HTMLCanvasElement.prototype.getContext = realGetContext;
});

describe('TabStaff', () => {
  it('never allocates a canvas wider than browsers allow, even before the scroller is measured', () => {
    // An 8.6 min song at 280 px per bar: ~84 000 px of staff. Firefox throws on a
    // canvas over 32 767 px, which unmounted the whole song screen.
    render(
      <TabStaff
        notes={[]}
        scale={{ pxPerSample: 84_000 / 24_804_000, pxPerBar: 280, contentWidth: 84_000 }}
        scroller={null}
        grid={null}
        getPosition={() => sampleIndex(0)}
        playing={false}
        seekNonce={0}
      />,
    );
    const canvas = screen.getByTestId('tab-staff-canvas') as HTMLCanvasElement;
    expect(canvas.width).toBeGreaterThan(0);
    expect(canvas.width).toBeLessThanOrEqual(MAX_CANVAS_PX);
  });
});
