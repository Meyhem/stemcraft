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
    render(<PatternPanel candidates={candidates} value={DEFAULT_PLAY_ALONG} onChange={vi.fn()} />);
    const keys = screen.getByRole('group', { name: 'Key' });
    expect(keys.querySelector('[aria-pressed="true"]')).toHaveTextContent('G major 40%');
    expect(screen.getByRole('button', { name: 'Triad' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Quarter' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'None' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('reports each choice as a whole new recipe', async () => {
    const onChange = vi.fn();
    render(<PatternPanel candidates={candidates} value={DEFAULT_PLAY_ALONG} onChange={onChange} />);
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
});
