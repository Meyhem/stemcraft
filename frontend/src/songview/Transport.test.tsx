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
const openLoop = () => userEvent.click(screen.getByRole('button', { name: 'Edit loop' }));
const openPractice = () => userEvent.click(screen.getByRole('button', { name: 'Practice' }));

describe('Transport', () => {
  it('shows tempo as a percentage and pitch in semitones, both mono', () => {
    renderTransport({ tempo: 0.75, pitchSemitones: -2 });
    expect(screen.getByLabelText('Tempo')).toHaveTextContent('75%');
    expect(screen.getByLabelText('Pitch')).toHaveTextContent('-2 st');
  });

  it('steps tempo 10% with the buttons', async () => {
    const props = renderTransport({ tempo: 1 });
    await userEvent.click(screen.getByRole('button', { name: 'Tempo up' }));
    expect(props.onTempoChange).toHaveBeenLastCalledWith(1.1);
    await userEvent.click(screen.getByRole('button', { name: 'Tempo down' }));
    expect(props.onTempoChange).toHaveBeenLastCalledWith(0.9);
  });

  it('keeps the buttons inside N-04’s 50-150% range', () => {
    renderTransport({ tempo: 1.5 });
    expect(screen.getByRole('button', { name: 'Tempo up' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Tempo down' })).toBeEnabled();
  });

  it('steps pitch a semitone at a time within ±12', async () => {
    const props = renderTransport({ pitchSemitones: 12 });
    expect(screen.getByRole('button', { name: 'Pitch up' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Pitch down' }));
    expect(props.onPitchChange).toHaveBeenLastCalledWith(11);
  });

  it('mutes the tempo and pitch values at their defaults, and only then', () => {
    renderTransport({ tempo: 1, pitchSemitones: 0 });
    expect(screen.getByLabelText('Tempo')).toHaveAttribute('data-default', 'true');
    expect(screen.getByLabelText('Pitch')).toHaveAttribute('data-default', 'true');
  });

  it('lights a moved tempo', () => {
    renderTransport({ tempo: 0.9 });
    expect(screen.getByLabelText('Tempo')).toHaveAttribute('data-default', 'false');
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

  it('Space still plays and pauses after a stepper button has been used', async () => {
    // Load-bearing: a control keeps focus after it is used, and Space on a focused
    // button would click it again. It must reach play/pause instead, without firing
    // the button.
    const props = renderTransport();
    screen.getByRole('button', { name: 'Tempo up' }).focus();
    await userEvent.keyboard(' ');
    expect(props.onPlayPause).toHaveBeenCalledOnce();
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
    await openLoop();
    expect(screen.queryByRole('button', { name: /set a/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /set b/i })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Loop start bar')).toHaveTextContent('5');
    expect(screen.getByLabelText('Loop end bar')).toHaveTextContent('6');
    await userEvent.click(screen.getByRole('button', { name: 'End bar later' }));
    expect(props.onLoopBars).toHaveBeenCalledWith(4, 7);
  });

  it('never steps a loop end past the last bar', async () => {
    // grid8 has 8 bars.
    renderTransport({ loop: { name: '', start_bar: 6, end_bar: 8 } });
    await openLoop();
    expect(screen.getByRole('button', { name: 'End bar later' })).toBeDisabled();
  });

  it('without a grid there are no bars: no steppers, no A/B keys, and the Loop button says why', async () => {
    const props = renderTransport({ grid: null });
    expect(screen.queryByLabelText('Loop start bar')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit loop' })).toBeDisabled();
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
    await openPractice();
    expect(screen.getByRole('group', { name: 'Count-in' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '2 bars' }));
    expect(props.onCountInChange).toHaveBeenCalledWith(2);
  });

  it('carries the saved loops menu', async () => {
    const props = renderTransport({ loop: LOOP, savedLoops: [{ name: 'Chorus', start_bar: 16, end_bar: 24 }] });
    await openLoop();
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

  it('names the loop bars on the Loop button, 1-based inclusive', () => {
    renderTransport({ loop: LOOP });
    expect(screen.getByRole('button', { name: 'Arm loop' })).toHaveTextContent('5–6');
  });

  it('arms from the button body and opens the editor from the chevron, separately', async () => {
    const props = renderTransport({ loop: LOOP });
    await userEvent.click(screen.getByRole('button', { name: 'Arm loop' }));
    expect(props.onLoopArmToggle).toHaveBeenCalledOnce();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await openLoop();
    expect(screen.getByRole('dialog', { name: 'Loop' })).toBeInTheDocument();
  });

  it('keeps the metronome behind Practice; the M key still works', async () => {
    const props = renderTransport();
    expect(screen.queryByRole('button', { name: 'Metronome' })).not.toBeInTheDocument();
    await userEvent.keyboard('m');
    expect(props.onMetronomeToggle).toHaveBeenCalledOnce();
    await openPractice();
    await userEvent.click(screen.getByRole('button', { name: 'Metronome' }));
    expect(props.onMetronomeToggle).toHaveBeenCalledTimes(2);
  });

  it('opens only one popover at a time', async () => {
    renderTransport({ loop: LOOP });
    await openLoop();
    await openPractice();
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(screen.getByRole('dialog', { name: 'Practice' })).toBeInTheDocument();
  });
});
