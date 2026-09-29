import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TrackTable, type TrackTableProps } from './TrackTable';

// Three tracks, cuts at 5 s (240000) and 8 s (384000), album length 10 s (480000).
const span = (number: number, title: string, start: number, end: number) => ({
  number,
  title,
  startSample: start,
  endSample: end,
  startSeconds: start / 48000,
  durationSeconds: (end - start) / 48000,
  filename: `${String(number).padStart(2, '0')}-${title ? title.toLowerCase().replace(/ /g, '-') : `track-${number}`}.mp3`,
});
const spans = [
  span(1, 'So What', 0, 240000),
  span(2, '', 240000, 384000),
  span(3, 'Flamenco Sketches', 384000, 480000),
];

const handlers = {
  onTitleChange: vi.fn(),
  onCutChange: vi.fn(),
  onPlay: vi.fn(),
  onRemoveCut: vi.fn(),
};

function renderTable(overrides: Partial<TrackTableProps> = {}) {
  return render(<TrackTable spans={spans} {...handlers} {...overrides} />);
}

describe('TrackTable', () => {
  beforeEach(() => Object.values(handlers).forEach((fn) => fn.mockClear()));

  it('shows automatic track numbers', () => {
    renderTable();
    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('shows the filename each track will be written as, before the split runs', () => {
    renderTable();
    expect(screen.getByText('02-track-2.mp3')).toBeInTheDocument();
  });

  it('shows each track duration as minutes and seconds', () => {
    renderTable();
    expect(screen.getByText('0:05')).toBeInTheDocument();
    expect(screen.getByText('0:03')).toBeInTheDocument();
  });

  it('reports a title edit by row index, and names each title field for its row', () => {
    renderTable();
    expect(screen.getByRole('textbox', { name: 'Track title 1' })).toHaveValue('So What');
    fireEvent.change(screen.getByRole('textbox', { name: 'Track title 2' }), {
      target: { value: 'Blue in Green' },
    });
    expect(handlers.onTitleChange).toHaveBeenCalledWith(1, 'Blue in Green');
  });

  it('renders no rows when the album has no measured length yet', () => {
    renderTable({ spans: [] });
    expect(screen.queryAllByRole('textbox')).toHaveLength(0);
  });
});

describe('TrackTable times', () => {
  beforeEach(() => Object.values(handlers).forEach((fn) => fn.mockClear()));

  it('shows start and end to the millisecond', () => {
    renderTable();
    expect(screen.getByRole('textbox', { name: 'Track 1 end' })).toHaveValue('0:05.000');
    expect(screen.getByRole('textbox', { name: 'Track 2 start' })).toHaveValue('0:05.000');
    expect(screen.getByRole('textbox', { name: 'Track 2 end' })).toHaveValue('0:08.000');
  });

  it('shows the album edges as plain text, not fields: they are not cuts', () => {
    renderTable();
    expect(screen.queryByRole('textbox', { name: 'Track 1 start' })).toBeNull();
    expect(screen.queryByRole('textbox', { name: 'Track 3 end' })).toBeNull();
    expect(screen.getByText('0:00.000')).toBeInTheDocument();
    expect(screen.getByText('0:10.000')).toBeInTheDocument();
  });

  it('moves the cut a track ends on when its End is edited', () => {
    renderTable();
    const end = screen.getByRole('textbox', { name: 'Track 1 end' });
    fireEvent.change(end, { target: { value: '0:04.250' } });
    fireEvent.blur(end);
    // Cut index 0, 4.25 s = 204000 samples.
    expect(handlers.onCutChange).toHaveBeenCalledWith(0, 204000);
  });

  it('moves the SAME cut when the next track\'s Start is edited', () => {
    renderTable();
    const start = screen.getByRole('textbox', { name: 'Track 2 start' });
    fireEvent.change(start, { target: { value: '4.25' } });
    fireEvent.keyDown(start, { key: 'Enter' });
    expect(handlers.onCutChange).toHaveBeenCalledWith(0, 204000);
  });

  it('does not treat re-committing an unchanged display as an edit', () => {
    // A cut placed at sample precision displays rounded to the millisecond; blurring
    // the field without typing must not snap it to that rounded value.
    renderTable({
      spans: [span(1, '', 0, 240017), span(2, '', 240017, 480000)],
    });
    const end = screen.getByRole('textbox', { name: 'Track 1 end' });
    fireEvent.change(end, { target: { value: '0:05.000' } }); // what it already shows
    fireEvent.blur(end);
    expect(handlers.onCutChange).not.toHaveBeenCalled();
  });

  it('refuses a time that crosses the next cut, says why, and does not move anything', () => {
    renderTable();
    const end = screen.getByRole('textbox', { name: 'Track 1 end' });
    // Track 2 ends at 8 s; a cut at 9 s would cross it.
    fireEvent.change(end, { target: { value: '0:09.000' } });
    fireEvent.blur(end);
    expect(handlers.onCutChange).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('Must be between 0:00.001 and 0:07.999');
    expect(end).toHaveAttribute('aria-invalid', 'true');
  });

  it('refuses text that is not a time', () => {
    renderTable();
    const end = screen.getByRole('textbox', { name: 'Track 1 end' });
    fireEvent.change(end, { target: { value: 'soon' } });
    fireEvent.blur(end);
    expect(handlers.onCutChange).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('Not a time');
  });

  it('Escape abandons an edit and shows the real value again', () => {
    renderTable();
    const end = screen.getByRole('textbox', { name: 'Track 1 end' });
    fireEvent.change(end, { target: { value: 'soon' } });
    fireEvent.keyDown(end, { key: 'Escape' });
    expect(end).toHaveValue('0:05.000');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('clears the error as soon as the text is edited again', () => {
    renderTable();
    const end = screen.getByRole('textbox', { name: 'Track 1 end' });
    fireEvent.change(end, { target: { value: 'soon' } });
    fireEvent.blur(end);
    fireEvent.change(end, { target: { value: '0:04' } });
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('TrackTable actions', () => {
  beforeEach(() => Object.values(handlers).forEach((fn) => fn.mockClear()));

  it('plays a track from its start', () => {
    renderTable();
    fireEvent.click(screen.getByRole('button', { name: /play track 2 from its start/i }));
    expect(handlers.onPlay).toHaveBeenCalledWith(1);
  });

  it('removes the cut after a track, merging it with the next', () => {
    renderTable();
    fireEvent.click(screen.getByRole('button', { name: /remove the cut after track 2/i }));
    expect(handlers.onRemoveCut).toHaveBeenCalledWith(1);
  });

  it('has no remove control on the last track: it has no cut after it', () => {
    renderTable();
    expect(screen.queryByRole('button', { name: /after track 3/i })).toBeNull();
    const row = screen.getByRole('textbox', { name: 'Track title 3' }).closest('tr')!;
    expect(within(row).queryByRole('button', { name: /remove/i })).toBeNull();
  });
});
