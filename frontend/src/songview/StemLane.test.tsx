import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { StemSummary } from '../engine/stemPeaks';
import { StemLane } from './StemLane';

// wavesurfer needs a real canvas and ResizeObserver; jsdom has neither, and the
// waveform pixels are not what these tests are about. The lane's controls,
// labels and states are.
vi.mock('wavesurfer.js', () => ({
  default: { create: () => ({ destroy: vi.fn(), setOptions: vi.fn(), on: () => () => {} }) },
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
    muted: false,
    soloed: false,
    gainDb: 0,
    anySoloed: false,
    onMuteToggle: vi.fn(),
    onSoloToggle: vi.fn(),
    onGainChange: vi.fn(),
    ...over,
  };
  render(<StemLane {...props} />);
  return props;
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

  it('emits gain changes in dB', async () => {
    const props = renderLane();
    const slider = screen.getByRole('slider', { name: /bass gain/i });
    // user-event's `clear` only works on text-like inputs, not input[type=range];
    // drive the change with fireEvent instead (controller ruling, Task 9 brief).
    fireEvent.change(slider, { target: { value: '-12' } });
    expect(props.onGainChange).toHaveBeenCalledWith(-12);
  });
});
