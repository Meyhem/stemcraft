import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { SavedLoops } from './SavedLoops';

function renderMenu(over = {}) {
  const props = {
    savedLoops: [
      { name: 'Chorus', start_bar: 16, end_bar: 24 },
      { name: 'Bridge', start_bar: 40, end_bar: 48 },
    ],
    activeLoop: { name: 'Chorus', start_bar: 16, end_bar: 24 },
    onRecallLoop: vi.fn(),
    onSaveActiveLoop: vi.fn(),
    onDeleteLoop: vi.fn(),
    ...over,
  };
  render(<SavedLoops {...props} />);
  return props;
}

const open = () => userEvent.click(screen.getByRole('button', { name: /saved loops/i }));

describe('SavedLoops', () => {
  it('is closed until asked, and names the active loop on its button', () => {
    renderMenu();
    const button = screen.getByRole('button', { name: /saved loops/i });
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(button).toHaveTextContent('Chorus');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('shows bars 1-based and inclusive, like the loop steppers', async () => {
    renderMenu();
    await open();
    expect(screen.getByRole('button', { name: 'Recall loop Bridge, bars 41–48' })).toBeInTheDocument();
  });

  it('recalls a saved loop and closes', async () => {
    const props = renderMenu();
    await open();
    await userEvent.click(screen.getByRole('button', { name: /Recall loop Bridge/ }));
    expect(props.onRecallLoop).toHaveBeenCalledWith({ name: 'Bridge', start_bar: 40, end_bar: 48 });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('deletes a saved loop by name, not by row position', async () => {
    const props = renderMenu();
    await open();
    await userEvent.click(screen.getByRole('button', { name: /Delete loop Bridge/ }));
    expect(props.onDeleteLoop).toHaveBeenCalledWith('Bridge');
  });

  it('saves the active loop under a typed name', async () => {
    const props = renderMenu({ activeLoop: { name: '', start_bar: 4, end_bar: 8 } });
    await open();
    await userEvent.type(screen.getByRole('textbox', { name: 'Loop name' }), 'Verse 2{Enter}');
    expect(props.onSaveActiveLoop).toHaveBeenCalledWith('Verse 2');
  });

  it('cannot save when there is no active loop', async () => {
    renderMenu({ activeLoop: null });
    await open();
    expect(screen.getByRole('textbox', { name: 'Loop name' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Save loop' })).toBeDisabled();
  });

  it('closes on Escape', async () => {
    renderMenu();
    await open();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
