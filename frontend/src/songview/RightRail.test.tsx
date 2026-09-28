import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

import { RightRail } from './RightRail';

function renderRail(over = {}) {
  const props = {
    songId: 'abc123',
    candidates: [
      { tonic: 'G', mode: 'major' as const, confidence: 0.62 },
      { tonic: 'E', mode: 'minor' as const, confidence: 0.38 },
    ],
    savedLoops: [{ name: 'Chorus', start_bar: 16, end_bar: 24 }],
    activeLoop: { name: 'A-B', start_bar: 4, end_bar: 8 },
    countInBars: 1,
    onRecallLoop: vi.fn(),
    onSaveActiveLoop: vi.fn(),
    onDeleteLoop: vi.fn(),
    onCountInChange: vi.fn(),
    ...over,
  };
  render(
    <MemoryRouter>
      <RightRail {...props} />
    </MemoryRouter>,
  );
  return props;
}

describe('RightRail', () => {
  it('shows every key candidate with its confidence, never one answer as fact (R-05)', () => {
    renderRail();
    expect(screen.getByText(/62%/)).toBeInTheDocument();
    expect(screen.getByText(/38%/)).toBeInTheDocument();
  });

  it('links to the scale sheet for the song', () => {
    renderRail();
    expect(screen.getByRole('link', { name: /scale/i })).toHaveAttribute(
      'href',
      '/songs/abc123/scale',
    );
  });

  it('recalls a saved loop', async () => {
    const props = renderRail();
    // Anchored: the delete button for the same loop is also named "Delete
    // loop Chorus, bars …" (R-05-adjacent -- it must name the loop it would
    // delete), so an unanchored /Chorus/ would match both. The recall
    // button's accessible name starts with the loop's own name; the delete
    // button's does not.
    await userEvent.click(screen.getByRole('button', { name: /^Chorus/ }));
    expect(props.onRecallLoop).toHaveBeenCalledWith({ name: 'Chorus', start_bar: 16, end_bar: 24 });
  });

  it('deletes a saved loop by name, not by row position', async () => {
    const props = renderRail({
      savedLoops: [
        { name: 'Chorus', start_bar: 16, end_bar: 24 },
        { name: 'Verse', start_bar: 0, end_bar: 8 },
      ],
    });
    await userEvent.click(screen.getByRole('button', { name: /^Delete loop Verse/i }));
    expect(props.onDeleteLoop).toHaveBeenCalledWith('Verse');
    expect(props.onDeleteLoop).not.toHaveBeenCalledWith('Chorus');
  });

  it('saves the active loop under a typed name', async () => {
    const props = renderRail();
    await userEvent.type(screen.getByLabelText(/loop name/i), 'Bridge');
    await userEvent.click(screen.getByRole('button', { name: /save loop/i }));
    expect(props.onSaveActiveLoop).toHaveBeenCalledWith('Bridge');
  });

  it('cannot save a loop when there is no active loop', () => {
    renderRail({ activeLoop: null });
    expect(screen.getByRole('button', { name: /save loop/i })).toBeDisabled();
  });

  it('changes the count-in length', async () => {
    const props = renderRail();
    await userEvent.click(screen.getByRole('button', { name: /2 bars/i }));
    expect(props.onCountInChange).toHaveBeenCalledWith(2);
  });
});
