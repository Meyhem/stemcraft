import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { buildGrid } from '../music/grid';
import { sampleIndex } from '../engine/types';
import { Transport } from './Transport';

function grid8() {
  const beats: number[] = [];
  const downbeats: number[] = [];
  for (let i = 0; i < 32; i++) {
    beats.push(i * 24_000);
    if (i % 4 === 0) downbeats.push(i * 24_000);
  }
  return buildGrid({ bpm: 120, beats, downbeats })!;
}

function renderTransport(over: Partial<Parameters<typeof Transport>[0]> = {}) {
  const props = {
    playing: false,
    grid: grid8(),
    getPosition: () => sampleIndex(0),
    seekNonce: 0,
    tempo: 1,
    pitchSemitones: 0,
    metronome: false,
    loopArmed: false,
    hasLoop: false,
    onPlayPause: vi.fn(),
    onTempoChange: vi.fn(),
    onPitchChange: vi.fn(),
    onMetronomeToggle: vi.fn(),
    onLoopArmToggle: vi.fn(),
    onSetLoopStart: vi.fn(),
    onSetLoopEnd: vi.fn(),
    onNudgeBars: vi.fn(),
    onMuteLane: vi.fn(),
    chords: [],
    zoom: '1x' as const,
    onZoomChange: vi.fn(),
    follow: true,
    onFollowToggle: vi.fn(),
    ...over,
  };
  render(<Transport {...props} />);
  return props;
}

describe('Transport', () => {
  it('shows tempo as a percentage and pitch in semitones, both mono', () => {
    renderTransport({ tempo: 0.75, pitchSemitones: -2 });
    expect(screen.getByText('75%')).toBeInTheDocument();
    expect(screen.getByText('-2 st')).toBeInTheDocument();
  });

  it('clamps tempo to N-04’s 50-100% range', () => {
    renderTransport();
    const slider = screen.getByRole('slider', { name: /tempo/i }) as HTMLInputElement;
    expect(slider.min).toBe('50');
    expect(slider.max).toBe('100');
  });

  it('shows the bar number, 1-indexed', () => {
    renderTransport({ getPosition: () => sampleIndex(24_000 * 4) });
    expect(screen.getByTestId('bar-readout')).toHaveTextContent('2');
  });

  it('maps every performance key from UI spec §7', async () => {
    const props = renderTransport({ hasLoop: true });
    await userEvent.keyboard(' ');
    expect(props.onPlayPause).toHaveBeenCalledOnce();
    await userEvent.keyboard('l');
    expect(props.onLoopArmToggle).toHaveBeenCalledOnce();
    await userEvent.keyboard('a');
    expect(props.onSetLoopStart).toHaveBeenCalledOnce();
    await userEvent.keyboard('b');
    expect(props.onSetLoopEnd).toHaveBeenCalledOnce();
    await userEvent.keyboard('m');
    expect(props.onMetronomeToggle).toHaveBeenCalledOnce();
    await userEvent.keyboard('3');
    expect(props.onMuteLane).toHaveBeenCalledWith(2);
    await userEvent.keyboard('{ArrowRight}');
    expect(props.onNudgeBars).toHaveBeenCalledWith(1);
    await userEvent.keyboard('{ArrowLeft}');
    expect(props.onNudgeBars).toHaveBeenCalledWith(-1);
  });

  it('steps tempo by 5% with the arrow keys', async () => {
    const props = renderTransport({ tempo: 0.8 });
    await userEvent.keyboard('{ArrowUp}');
    expect(props.onTempoChange).toHaveBeenCalledWith(0.85);
    await userEvent.keyboard('{ArrowDown}');
    expect(props.onTempoChange).toHaveBeenCalledWith(0.75);
  });

  it('does not steal keys while the user is typing in a field', async () => {
    const props = renderTransport();
    render(<input aria-label="somewhere else" />);
    await userEvent.click(screen.getByLabelText('somewhere else'));
    await userEvent.keyboard('a');
    expect(props.onSetLoopStart).not.toHaveBeenCalled();
  });

  it('does not hijack a modifier chord (Ctrl/Cmd+A) meant for the OS/browser', () => {
    const props = renderTransport({ hasLoop: true });
    const event = new KeyboardEvent('keydown', {
      key: 'a',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(event);
    expect(props.onSetLoopStart).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it('does not arm the loop from the keyboard when there is no loop to arm', async () => {
    const props = renderTransport({ hasLoop: false });
    await userEvent.keyboard('l');
    expect(props.onLoopArmToggle).not.toHaveBeenCalled();
  });

  it('withholds Set A/Set B when there is no grid to snap them to', async () => {
    const props = renderTransport({ grid: null });
    const setA = screen.getByRole('button', { name: /set a/i });
    expect(setA).toBeDisabled();
    expect(setA).toHaveAttribute('title', expect.stringMatching(/analysis/i));
    expect(screen.getByRole('button', { name: /set b/i })).toBeDisabled();
    await userEvent.keyboard('a');
    expect(props.onSetLoopStart).not.toHaveBeenCalled();
  });

  it('withholds Set B until there is an A behind it', async () => {
    const props = renderTransport({ hasLoop: false });
    const setB = screen.getByRole('button', { name: /set b/i });
    expect(setB).toBeDisabled();
    expect(setB).toHaveAttribute('title', 'Set A first');
    // Set A is what creates the loop, so it stays live.
    expect(screen.getByRole('button', { name: /set a/i })).toBeEnabled();
    await userEvent.keyboard('b');
    expect(props.onSetLoopEnd).not.toHaveBeenCalled();
  });

  it('offers Fit / 1× / 2× zoom, showing the current one pressed', async () => {
    const props = renderTransport({ zoom: '1x' });
    const zoom = screen.getByRole('group', { name: 'Zoom' });
    expect(zoom).toHaveTextContent('Fit1×2×');
    expect(screen.getByRole('button', { name: '1×' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Fit' })).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(screen.getByRole('button', { name: 'Fit' }));
    expect(props.onZoomChange).toHaveBeenCalledWith('fit');
    await userEvent.click(screen.getByRole('button', { name: '2×' }));
    expect(props.onZoomChange).toHaveBeenCalledWith('2x');
  });

  it('toggles follow-playhead, reporting its state through aria-pressed', async () => {
    const props = renderTransport({ follow: false });
    const follow = screen.getByRole('button', { name: 'Follow playhead' });
    expect(follow).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(follow);
    expect(props.onFollowToggle).toHaveBeenCalledOnce();
  });

  it('reads out the current chord and the next change, merged and spelled for display', () => {
    const at = (bar: number, chord: string) => ({
      bar,
      start_sample: bar * 96_000,
      end_sample: (bar + 1) * 96_000,
      chord,
    });
    renderTransport({
      chords: [at(0, 'G:min'), at(1, 'G:min'), at(2, 'Bb:maj'), at(3, 'F:maj')],
      getPosition: () => sampleIndex(50_000),
    });
    // Bar 2 is Gm again: the next *change* is B♭, not the repeated Gm.
    expect(screen.getByTestId('chord-readout')).toHaveTextContent('Gm');
    expect(screen.getByTestId('chord-next')).toHaveTextContent('→ B♭');
  });

  it('reads out a dash with no chord chart', () => {
    renderTransport({ chords: [] });
    expect(screen.getByTestId('chord-readout')).toHaveTextContent('--');
    expect(screen.getByTestId('chord-next')).toBeEmptyDOMElement();
  });
});
