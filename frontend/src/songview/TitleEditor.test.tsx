import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { TitleEditor } from './TitleEditor';

function renderEditor() {
  const onRename = vi.fn();
  render(<TitleEditor title="Tightrope" artist="Walk the Moon" onRename={onRename} />);
  return onRename;
}

describe('TitleEditor', () => {
  it('shows the title as the page heading and the artist under it', () => {
    renderEditor();
    expect(screen.getByRole('heading', { name: 'Tightrope' })).toBeInTheDocument();
    expect(screen.getByText('Walk the Moon')).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('renames title and artist on Save', async () => {
    const onRename = renderEditor();
    await userEvent.click(screen.getByRole('button', { name: 'Rename' }));
    const title = screen.getByRole('textbox', { name: 'Title' });
    expect(title).toHaveFocus();
    await userEvent.clear(title);
    await userEvent.type(title, 'Tightrope (live)');
    await userEvent.clear(screen.getByRole('textbox', { name: 'Artist' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Artist' }), 'WTM{Enter}');
    expect(onRename).toHaveBeenCalledWith('Tightrope (live)', 'WTM');
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('refuses a blank title', async () => {
    const onRename = renderEditor();
    await userEvent.click(screen.getByRole('button', { name: 'Rename' }));
    await userEvent.clear(screen.getByRole('textbox', { name: 'Title' }));
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    await userEvent.keyboard('{Enter}');
    expect(onRename).not.toHaveBeenCalled();
  });

  it('Cancel and Escape abandon the edit', async () => {
    const onRename = renderEditor();
    await userEvent.click(screen.getByRole('button', { name: 'Rename' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Title' }), 'x');
    await userEvent.keyboard('{Escape}');
    expect(screen.getByRole('heading', { name: 'Tightrope' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Rename' }));
    expect(screen.getByRole('textbox', { name: 'Title' })).toHaveValue('Tightrope');
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onRename).not.toHaveBeenCalled();
  });
});
