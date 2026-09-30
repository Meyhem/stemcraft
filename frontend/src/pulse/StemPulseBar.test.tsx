import { render } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import { PulseSlotContext } from '../app/pulseSlot';
import type { StemSummary } from '../engine/stemPeaks';
import { SongSessionContext, type SongSession } from '../session/SongSession';
import { StemPulseBar } from './StemPulseBar';

// SongSession imports the real engine, whose SoundTouch dependency needs AudioWorkletNode at
// import time; the bar only ever sees a fake engine here.
vi.mock('../engine/EngineController', () => ({
  STEM_ORDER: ['vocals', 'drums', 'bass', 'other'],
  EngineController: {},
}));

// jsdom loads no stylesheet, so no token resolves; the real values are held to
// #RRGGBB by paint.test.ts.
vi.mock('../ui/resolveColor', () => ({ resolveColor: () => '#E0A458' }));

const loud = (name: StemSummary['name']): StemSummary => ({
  name,
  envelope: new Float32Array(100).fill(0.5),
  peak: 0.5,
  nearSilent: false,
});

function fakeEngine(gains: Record<string, number>) {
  return {
    getPositionSamples: () => 0,
    getStemGain: (name: string) => gains[name] ?? 1,
    stemSummaries: (['vocals', 'drums', 'bass', 'other'] as const).map(loud),
  };
}

let frames: FrameRequestCallback[] = [];
let gradients = 0;
let realGetContext: typeof HTMLCanvasElement.prototype.getContext;

beforeEach(() => {
  frames = [];
  gradients = 0;
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => frames.push(cb));
  vi.stubGlobal('cancelAnimationFrame', () => {});
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

function renderBar(session: Partial<SongSession>, slot: HTMLElement | null) {
  return render(
    <PulseSlotContext.Provider value={slot}>
      <SongSessionContext.Provider value={session as SongSession}>
        <StemPulseBar />
      </SongSessionContext.Provider>
    </PulseSlotContext.Provider>,
  );
}

function makeSlot() {
  const slot = document.createElement('div');
  Object.defineProperty(slot, 'clientWidth', { get: () => 800 });
  document.body.appendChild(slot);
  return slot;
}

test('while playing it paints two glows for each audible stem and none for a muted one', () => {
  const slot = makeSlot();
  const engine = fakeEngine({ drums: 0 });
  renderBar({ engine: engine as unknown as SongSession['engine'], playing: true }, slot);

  expect(slot.querySelector('canvas')).not.toBeNull();
  expect(frames).toHaveLength(1);
  frames[0]!(performance.now() + 50);

  expect(gradients).toBe(6);
  // And it keeps going: the frame asked for the next one.
  expect(frames).toHaveLength(2);
});

test('while paused it does not animate', () => {
  const slot = makeSlot();
  renderBar({ engine: fakeEngine({}) as unknown as SongSession['engine'], playing: false }, slot);
  expect(frames).toHaveLength(0);
  expect(gradients).toBe(0);
});

test('it is decoration: hidden from assistive tech', () => {
  const slot = makeSlot();
  renderBar({ engine: null, playing: false }, slot);
  expect(slot.querySelector('canvas')).toHaveAttribute('aria-hidden', 'true');
});

test('with no navbar slot it renders nothing', () => {
  const { container } = renderBar({ engine: null, playing: false }, null);
  expect(container).toBeEmptyDOMElement();
  expect(document.querySelector('canvas')).toBeNull();
});
