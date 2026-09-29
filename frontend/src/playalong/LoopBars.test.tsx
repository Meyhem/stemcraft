import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { LoopBars } from './LoopBars';

describe('LoopBars', () => {
  it('shows the stored loop as 1-based inclusive bars', () => {
    render(<LoopBars loop={{ name: '', start_bar: 4, end_bar: 8 }} barCount={16} onLoopBars={vi.fn()} />);
    expect(screen.getByLabelText('Loop start bar')).toHaveTextContent('5');
    expect(screen.getByLabelText('Loop end bar')).toHaveTextContent('8');
  });

  it('steps the ends, pushing the end along rather than inverting the loop', async () => {
    const onLoopBars = vi.fn();
    render(<LoopBars loop={{ name: '', start_bar: 4, end_bar: 5 }} barCount={16} onLoopBars={onLoopBars} />);
    await userEvent.click(screen.getByRole('button', { name: 'Start bar later' }));
    expect(onLoopBars).toHaveBeenLastCalledWith(5, 6);
    await userEvent.click(screen.getByRole('button', { name: 'End bar later' }));
    expect(onLoopBars).toHaveBeenLastCalledWith(4, 6);
    expect(screen.getByRole('button', { name: 'End bar earlier' })).toBeDisabled();
  });

  it('starts a one-bar loop at bar 1 when there is none', async () => {
    const onLoopBars = vi.fn();
    render(<LoopBars loop={null} barCount={16} onLoopBars={onLoopBars} />);
    await userEvent.click(screen.getByRole('button', { name: 'End bar later' }));
    expect(onLoopBars).toHaveBeenLastCalledWith(0, 2);
  });
});
