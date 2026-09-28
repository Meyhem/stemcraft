import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { TrackTable } from './TrackTable';

const spans = [
  {
    number: 1,
    title: 'So What',
    startSample: 0,
    endSample: 240000,
    startSeconds: 0,
    durationSeconds: 5,
    filename: '01-so-what.mp3',
  },
  {
    number: 2,
    title: '',
    startSample: 240000,
    endSample: 480000,
    startSeconds: 5,
    durationSeconds: 5,
    filename: '02-track-2.mp3',
  },
];

describe('TrackTable', () => {
  it('shows automatic track numbers', () => {
    render(<TrackTable spans={spans} onTitleChange={vi.fn()} />);
    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('shows the filename each track will be written as, before the split runs', () => {
    render(<TrackTable spans={spans} onTitleChange={vi.fn()} />);
    expect(screen.getByText('02-track-2.mp3')).toBeInTheDocument();
  });

  it('shows each track duration as minutes and seconds, not raw samples', () => {
    render(<TrackTable spans={spans} onTitleChange={vi.fn()} />);
    expect(screen.getAllByText('0:05')).toHaveLength(2);
  });

  it('reports a title edit by row index', () => {
    const onTitleChange = vi.fn();
    render(<TrackTable spans={spans} onTitleChange={onTitleChange} />);
    fireEvent.change(screen.getAllByRole('textbox')[1]!, { target: { value: 'Blue in Green' } });
    expect(onTitleChange).toHaveBeenCalledWith(1, 'Blue in Green');
  });

  it('names each title field for its row, so a screen reader can tell them apart', () => {
    render(<TrackTable spans={spans} onTitleChange={vi.fn()} />);
    expect(screen.getByRole('textbox', { name: /track title 1/i })).toHaveValue('So What');
    expect(screen.getByRole('textbox', { name: /track title 2/i })).toHaveValue('');
  });

  it('renders nothing but the header when the album has no measured length yet', () => {
    render(<TrackTable spans={[]} onTitleChange={vi.fn()} />);
    expect(screen.queryAllByRole('textbox')).toHaveLength(0);
  });
});
