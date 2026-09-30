import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { Popover } from './Popover';

const setup = (open: boolean) => {
  const onClose = vi.fn();
  render(
    <div>
      <button>elsewhere</button>
      <Popover open={open} onClose={onClose} label="Practice" trigger={<button>Practice</button>}>
        <p>inside</p>
      </Popover>
    </div>,
  );
  return onClose;
};

describe('Popover', () => {
  it('renders nothing but the trigger while closed', () => {
    setup(false);
    expect(screen.getByRole('button', { name: 'Practice' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('shows a named dialog while open', () => {
    setup(true);
    expect(screen.getByRole('dialog', { name: 'Practice' })).toHaveTextContent('inside');
  });

  it('closes on Escape', async () => {
    const onClose = setup(true);
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('closes on a press outside, not on a press inside', async () => {
    const onClose = setup(true);
    await userEvent.click(screen.getByText('inside'));
    expect(onClose).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'elsewhere' }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('does not listen while closed', async () => {
    const onClose = setup(false);
    await userEvent.keyboard('{Escape}');
    expect(onClose).not.toHaveBeenCalled();
  });
});
