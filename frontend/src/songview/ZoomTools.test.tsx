import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ZoomTools } from './ZoomTools';

function renderTools(over = {}) {
  const props = {
    zoomLabel: '12 bars in view',
    onZoomIn: vi.fn(),
    onZoomOut: vi.fn(),
    onZoomFit: vi.fn(),
    follow: false,
    onFollowToggle: vi.fn(),
    ...over,
  };
  render(<ZoomTools {...props} />);
  return props;
}

describe('ZoomTools', () => {
  it('offers zoom out / in / Fit with a readout of what is in view', async () => {
    const props = renderTools();
    expect(screen.getByRole('group', { name: 'Zoom' })).toHaveTextContent('12 bars in view');
    await userEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    expect(props.onZoomIn).toHaveBeenCalledOnce();
    await userEvent.click(screen.getByRole('button', { name: 'Zoom out' }));
    expect(props.onZoomOut).toHaveBeenCalledOnce();
    await userEvent.click(screen.getByRole('button', { name: 'Fit' }));
    expect(props.onZoomFit).toHaveBeenCalledOnce();
  });

  it('toggles follow-playhead, reporting its state through aria-pressed', async () => {
    const props = renderTools();
    const follow = screen.getByRole('button', { name: 'Follow playhead' });
    expect(follow).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(follow);
    expect(props.onFollowToggle).toHaveBeenCalledOnce();
  });
});
