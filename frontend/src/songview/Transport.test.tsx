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
    countInBars: 0,
    loop: null as { name: string; start_bar: number; end_bar: number } | null,
    loopArmed: false,
    savedLoops: [],
    onPlayPause: vi.fn(),
    onTempoChange: vi.fn(),
    onPitchChange: vi.fn(),
    onMetronomeToggle: vi.fn(),
    onCountInChange: vi.fn(),
    onLoopArmToggle: vi.fn(),
    onLoopBars: vi.fn(),
    onSetLoopStart: vi.fn(),
    onSetLoopEnd: vi.fn(),
    onRecallLoop: vi.fn(),
    onSaveActiveLoop: vi.fn(),
    onDeleteLoop: vi.fn(),
    onNudgeBars: vi.fn(),
    onMuteLane: vi.fn(),
    chords: [],
    ...over,
  };
  render(<Transport {...props} />);
  return props;
}

const LOOP = { name: '', start_bar: 4, end_bar: 6 };

describe('Transport', () => {
  it('shows tempo as a percentage and pitch in semitones, both mono', () => {
    renderTransport({ tempo: 0.75, pitchSemitones: -2 });
    expect(screen.getByText('75%')).toBeInTheDocument();
    expect(screen.getByText('-2 st')).toBeInTheDocument();
  });

  it('offers N-04’s 50-150% tempo range, with 100% marked', () => {
    renderTransport();
    const slider = screen.getByRole('slider', { name: /tempo/i }) as HTMLInputElement;
    expect(slider.min).toBe('50');
    expect(slider.max).toBe('150');
    expect(document.querySelector('datalist#tempo-ticks option')).toHaveAttribute('value', '100');
  });

  it('steps tempo past 100% with the arrow keys, and stops at 150%', async () => {
    const props = renderTransport({ tempo: 1.45 });
    await userEvent.keyboard('{ArrowUp}');
    expect(props.onTempoChange).toHaveBeenLastCalledWith(1.5);
    await userEvent.keyboard('{ArrowUp}');
    expect(props.onTempoChange).toHaveBeenLastCalledWith(1.5);
  });

  it('shows the bar number, 1-indexed', () => {
    renderTransport({ getPosition: () => sampleIndex(24_000 * 4) });
    expect(screen.getByTestId('bar-readout')).toHaveTextContent('2');
  });

  it('maps every performance key from UI spec §7', async () => {
    const props = renderTransport({ loop: LOOP });
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

  it('Space still plays and pauses after a slider has been used', async () => {
    // Load-bearing: the key handler used to ignore every <input>, and a range slider is an
    // <input> -- so after nudging tempo, pitch or a lane gain, focus stayed on the slider
    // and Space silently did nothing. The user noticed. Space is not text entry on a
    // slider, so it must reach play/pause.
    const props = renderTransport();
    const tempo = screen.getByRole('slider', { name: /tempo/i });
    tempo.focus();
    await userEvent.keyboard(' ');
    expect(props.onPlayPause).toHaveBeenCalledOnce();
  });

  it('a slider keeps its own arrow keys: they move the slider, not the song', async () => {
    const props = renderTransport({ tempo: 0.8 });
    screen.getByRole('slider', { name: /pitch/i }).focus();
    await userEvent.keyboard('{ArrowRight}{ArrowUp}');
    expect(props.onNudgeBars).not.toHaveBeenCalled();
    expect(props.onTempoChange).not.toHaveBeenCalled();
  });

  it('Space still types a space in a text field (naming a loop)', async () => {
    const props = renderTransport();
    render(<input aria-label="loop name" />);
    await userEvent.click(screen.getByLabelText('loop name'));
    await userEvent.keyboard('Verse 2');
    expect(props.onPlayPause).not.toHaveBeenCalled();
    expect(screen.getByLabelText('loop name')).toHaveValue('Verse 2');
  });

  it('does not hijack a modifier chord (Ctrl/Cmd+A) meant for the OS/browser', () => {
    const props = renderTransport({ loop: LOOP });
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
    const props = renderTransport({ loop: null });
    await userEvent.keyboard('l');
    expect(props.onLoopArmToggle).not.toHaveBeenCalled();
  });

  it('loops by bar numbers: there are no Set A / Set B buttons', async () => {
    const props = renderTransport({ loop: LOOP });
    expect(screen.queryByRole('button', { name: /set a/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /set b/i })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Loop start bar')).toHaveTextContent('5');
    expect(screen.getByLabelText('Loop end bar')).toHaveTextContent('6');
    await userEvent.click(screen.getByRole('button', { name: 'End bar later' }));
    expect(props.onLoopBars).toHaveBeenCalledWith(4, 7);
  });

  it('never steps a loop end past the last bar', () => {
    // grid8 has 8 bars.
    renderTransport({ loop: { name: '', start_bar: 6, end_bar: 8 } });
    expect(screen.getByRole('button', { name: 'End bar later' })).toBeDisabled();
  });

  it('without a grid there are no bars: no steppers, no A/B keys, and the Loop button says why', async () => {
    const props = renderTransport({ grid: null });
    expect(screen.queryByLabelText('Loop start bar')).not.toBeInTheDocument();
    const arm = screen.getByRole('button', { name: 'Arm loop' });
    expect(arm).toBeDisabled();
    expect(arm).toHaveAttribute('title', expect.stringMatching(/analysis/i));
    await userEvent.keyboard('a');
    expect(props.onSetLoopStart).not.toHaveBeenCalled();
  });

  it('the B key waits for a loop to end; the A key starts one', async () => {
    const props = renderTransport({ loop: null });
    await userEvent.keyboard('b');
    expect(props.onSetLoopEnd).not.toHaveBeenCalled();
    await userEvent.keyboard('a');
    expect(props.onSetLoopStart).toHaveBeenCalledOnce();
  });

  it('sets the count-in', async () => {
    const props = renderTransport({ countInBars: 1 });
    expect(screen.getByRole('group', { name: 'Count-in' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '2 bars' }));
    expect(props.onCountInChange).toHaveBeenCalledWith(2);
  });

  it('carries the saved loops menu', async () => {
    const props = renderTransport({ loop: LOOP, savedLoops: [{ name: 'Chorus', start_bar: 16, end_bar: 24 }] });
    await userEvent.click(screen.getByRole('button', { name: 'Saved loops' }));
    await userEvent.click(screen.getByRole('button', { name: /Recall loop Chorus/ }));
    expect(props.onRecallLoop).toHaveBeenCalledWith({ name: 'Chorus', start_bar: 16, end_bar: 24 });
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
