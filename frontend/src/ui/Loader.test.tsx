import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import { Loader } from './Loader';

// jsdom loads no stylesheet, so no token resolves; the real values are held to
// #RRGGBB by paint.test.ts.
vi.mock('./resolveColor', () => ({ resolveColor: () => '#E0A458' }));

let frames: FrameRequestCallback[] = [];
let gradients = 0;
let cancelled = 0;
let reducedMotion = false;
let realGetContext: typeof HTMLCanvasElement.prototype.getContext;

beforeEach(() => {
  frames = [];
  gradients = 0;
  cancelled = 0;
  reducedMotion = false;
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => frames.push(cb));
  vi.stubGlobal('cancelAnimationFrame', () => cancelled++);
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes('reduce') && reducedMotion,
  }));
  realGetContext = HTMLCanvasElement.prototype.getContext;
  const ctx = {
    globalCompositeOperation: '',
    fillStyle: null as unknown,
    clearRect: () => {},
    fillRect: () => {},
    createLinearGradient: () => {
      gradients++;
      return { addColorStop: () => {} };
    },
  };
  HTMLCanvasElement.prototype.getContext = (() => ctx) as unknown as typeof realGetContext;
});

afterEach(() => {
  HTMLCanvasElement.prototype.getContext = realGetContext;
  vi.unstubAllGlobals();
});

test('the label is what assistive tech hears; the bar is decoration', () => {
  render(<Loader label="Loading song…" />);
  const status = screen.getByRole('status');
  expect(status).toHaveTextContent('Loading song…');
  expect(status.querySelector('canvas')).toHaveAttribute('aria-hidden', 'true');
});

test('it pounds: every frame paints two glows per stem and asks for the next', () => {
  render(<Loader label="Loading stems…" />);
  expect(frames).toHaveLength(1);
  frames[0]!(performance.now() + 16);
  expect(gradients).toBe(8);
  expect(frames).toHaveLength(2);
});

test('it stops animating when it goes away', () => {
  const { unmount } = render(<Loader label="Loading album…" size="page" />);
  unmount();
  expect(cancelled).toBe(1);
});

test('under reduced motion it paints one still frame and never animates', () => {
  reducedMotion = true;
  render(<Loader label="Loading song…" size="page" />);
  expect(gradients).toBe(8);
  expect(frames).toHaveLength(0);
  expect(screen.getByRole('status')).toHaveTextContent('Loading song…');
});
