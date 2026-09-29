import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { StemSummary } from '../engine/stemPeaks';
import { StemLane } from './StemLane';

// wavesurfer needs a real canvas and ResizeObserver; jsdom has neither, and the
// waveform pixels are not what these tests are about. The lane's controls,
// labels and states are. `create` is a spyable vi.fn() (not just an inert
// arrow function) so a regression test below can pin exactly what it was
// constructed with -- invariant #7 ("wavesurfer.js never plays audio") is a
// non-negotiable project rule, and nothing else here would catch a future
// edit that passed `url`/`media` instead of precomputed `peaks`.
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
    durationSeconds: 120,
    width: 896,
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
  beforeEach(() => {
    createWaveSurfer.mockClear();
  });

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
    // wavesurfer draws on a canvas, which cannot resolve CSS variables: handed
    // 'var(--ds-bass)' it ignores the colour and fills black on a near-black lane.
    // Load-bearing: the test defines the token, so a component that passed the literal
    // string through would fail on the string, and one that resolved the wrong token
    // would fail on the value.
    document.documentElement.style.setProperty('--ds-bass', '#4FC3B0');
    document.documentElement.style.setProperty('--ds-text-2', '#9BA3AE');
    try {
      renderLane();
      const options = createWaveSurfer.mock.calls[0]![0];
      expect(options.waveColor).toBe('#4FC3B0');
      expect(options.progressColor).toBe('#4FC3B0');
    } finally {
      document.documentElement.style.removeProperty('--ds-bass');
      document.documentElement.style.removeProperty('--ds-text-2');
    }
  });

  it('falls back to a legible colour, not black, when the stem token is undefined', () => {
    document.documentElement.style.setProperty('--ds-text-2', '#9BA3AE');
    try {
      renderLane();
      const options = createWaveSurfer.mock.calls[0]![0];
      expect(options.waveColor).toBe('#9BA3AE');
    } finally {
      document.documentElement.style.removeProperty('--ds-text-2');
    }
  });

  it('constructs wavesurfer from precomputed peaks and duration, never a URL or media element (invariant #7)', () => {
    renderLane({ durationSeconds: 42.5 });
    expect(createWaveSurfer).toHaveBeenCalledOnce();
    const options = createWaveSurfer.mock.calls[0]![0];
    expect(options).toMatchObject({ peaks: [expect.any(Float32Array)], duration: 42.5, cursorWidth: 0 });
    expect(typeof options.duration).toBe('number');
    expect(options).not.toHaveProperty('url');
    expect(options).not.toHaveProperty('media');
  });

  it('makes the waveform exactly the time axis content width, so it aligns with the bars', () => {
    renderLane({ width: 896 });
    expect(createWaveSurfer.mock.calls[0]![0]).toMatchObject({ width: 896, interact: false });
    expect(screen.getByTestId('bass-wave').style.width).toBe('896px');
  });

  it('resizes the waveform on a zoom change in place, without rebuilding it', () => {
    const { rerender, props } = renderLane({ width: 896 });
    const instance = createWaveSurfer.mock.results[0]!.value as { setOptions: ReturnType<typeof vi.fn> };
    rerender(<StemLane {...props} width={1792} />);
    expect(createWaveSurfer).toHaveBeenCalledOnce();
    expect(instance.setOptions).toHaveBeenLastCalledWith({ width: 1792 });
    expect(screen.getByTestId('bass-wave').style.width).toBe('1792px');
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
