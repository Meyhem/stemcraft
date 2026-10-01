import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { DEFAULT_PLAY_ALONG } from '../api/client';
import { PatternPanel } from './PatternPanel';

const candidates = [
  { tonic: 'G', mode: 'major' as const, confidence: 0.4 },
  { tonic: 'D', mode: 'major' as const, confidence: 0.32 },
];

describe('PatternPanel', () => {
  it('shows the top candidate as the key when none is chosen', () => {
    render(<PatternPanel candidates={candidates} value={DEFAULT_PLAY_ALONG} onChange={vi.fn()} pitchSemitones={0} />);
    const keys = screen.getByRole('group', { name: 'Key' });
    expect(keys.querySelector('[aria-pressed="true"]')).toHaveTextContent('G major 40%');
    expect(screen.getByRole('button', { name: 'Triad' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Quarter' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'None' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('reports each choice as a whole new recipe', async () => {
    const onChange = vi.fn();
    render(<PatternPanel candidates={candidates} value={DEFAULT_PLAY_ALONG} onChange={onChange} pitchSemitones={0} />);
    await userEvent.click(screen.getByRole('button', { name: /D major/ }));
    expect(onChange).toHaveBeenLastCalledWith({ ...DEFAULT_PLAY_ALONG, key: { tonic: 'D', mode: 'major' } });
    await userEvent.click(screen.getByRole('button', { name: 'Octave' }));
    expect(onChange).toHaveBeenLastCalledWith({
      ...DEFAULT_PLAY_ALONG,
      pattern: { ...DEFAULT_PLAY_ALONG.pattern, notes: 'octave_pump' },
    });
    await userEvent.click(screen.getByRole('button', { name: 'Eighth' }));
    expect(onChange.mock.lastCall![0].pattern.rhythm).toBe('eighth');
    await userEvent.click(screen.getByRole('button', { name: 'Chromatic' }));
    expect(onChange.mock.lastCall![0].pattern.approach).toBe('chromatic');
  });

  it('labels each key as heard after transposing, but stores it untransposed', async () => {
    const onChange = vi.fn();
    render(<PatternPanel candidates={candidates} value={DEFAULT_PLAY_ALONG} onChange={onChange} pitchSemitones={2} />);
    const keys = screen.getByRole('group', { name: 'Key' });
    expect(keys.querySelector('[aria-pressed="true"]')).toHaveTextContent('A major 40%');
    await userEvent.click(screen.getByRole('button', { name: /E major/ }));
    expect(onChange).toHaveBeenLastCalledWith({ ...DEFAULT_PLAY_ALONG, key: { tonic: 'D', mode: 'major' } });
  });

  it('swaps the bass rows for the guitar rows, and keeps each instrument\'s settings', async () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <PatternPanel candidates={candidates} value={DEFAULT_PLAY_ALONG} onChange={onChange} pitchSemitones={0} />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Guitar' }));
    const guitar = onChange.mock.lastCall![0];
    expect(guitar).toEqual({ ...DEFAULT_PLAY_ALONG, instrument: 'guitar' });

    rerender(<PatternPanel candidates={candidates} value={guitar} onChange={onChange} pitchSemitones={0} />);
    expect(screen.queryByRole('group', { name: 'Notes' })).not.toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Style' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Barre' }));
    expect(onChange).toHaveBeenLastCalledWith({ ...guitar, guitar: { ...guitar.guitar, style: 'barre' } });
    await userEvent.click(screen.getByRole('button', { name: 'Push' }));
    expect(onChange.mock.lastCall![0].guitar.strum).toBe('push');
    await userEvent.click(screen.getByRole('checkbox', { name: /triads/ }));
    expect(onChange.mock.lastCall![0].guitar.simplify).toBe(true);
    // The bass pattern rides along untouched.
    expect(onChange.mock.lastCall![0].pattern).toEqual(DEFAULT_PLAY_ALONG.pattern);
  });

  it('greys Position out for open chords and says why, keeping its value', () => {
    const guitar = { ...DEFAULT_PLAY_ALONG, instrument: 'guitar' as const, guitar: { ...DEFAULT_PLAY_ALONG.guitar, position: 'mid' as const } };
    const { rerender } = render(<PatternPanel candidates={candidates} value={guitar} onChange={vi.fn()} pitchSemitones={0} />);
    expect(screen.getByRole('button', { name: 'Mid' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Mid' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('open shapes sit at frets 0–4')).toBeInTheDocument();
    const barre = { ...guitar, guitar: { ...guitar.guitar, style: 'barre' as const } };
    rerender(<PatternPanel candidates={candidates} value={barre} onChange={vi.fn()} pitchSemitones={0} />);
    expect(screen.getByRole('button', { name: 'Mid' })).toBeEnabled();
    expect(screen.queryByText('open shapes sit at frets 0–4')).not.toBeInTheDocument();
  });
});

