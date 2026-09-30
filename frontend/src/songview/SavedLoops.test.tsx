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

describe('SavedLoops', () => {
  it('shows bars 1-based and inclusive, like the loop steppers', () => {
    renderMenu();
    expect(screen.getByRole('button', { name: 'Recall loop Bridge, bars 41–48' })).toBeInTheDocument();
  });

  it('marks the active loop', () => {
    renderMenu();
    expect(screen.getByRole('button', { name: /Recall loop Chorus/ })).toHaveAttribute('aria-current', 'true');
  });

  it('says so when there are none', () => {
    renderMenu({ savedLoops: [] });
    expect(screen.getByText('No saved loops yet.')).toBeInTheDocument();
  });

  it('recalls a saved loop', async () => {
    const props = renderMenu();
    await userEvent.click(screen.getByRole('button', { name: /Recall loop Bridge/ }));
    expect(props.onRecallLoop).toHaveBeenCalledWith({ name: 'Bridge', start_bar: 40, end_bar: 48 });
  });

  it('deletes a saved loop by name, not by row position', async () => {
    const props = renderMenu();
    await userEvent.click(screen.getByRole('button', { name: /Delete loop Bridge/ }));
    expect(props.onDeleteLoop).toHaveBeenCalledWith('Bridge');
  });

  it('saves the active loop under a typed name', async () => {
    const props = renderMenu({ activeLoop: { name: '', start_bar: 4, end_bar: 8 } });
    await userEvent.type(screen.getByRole('textbox', { name: 'Loop name' }), 'Verse 2{Enter}');
    expect(props.onSaveActiveLoop).toHaveBeenCalledWith('Verse 2');
  });

  it('cannot save when there is no active loop', () => {
    renderMenu({ activeLoop: null });
    expect(screen.getByRole('textbox', { name: 'Loop name' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Save loop' })).toBeDisabled();
  });
});
