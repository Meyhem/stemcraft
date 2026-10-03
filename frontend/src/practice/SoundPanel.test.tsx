import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';

import { DEFAULT_INSTRUMENT_SETTINGS } from '../api/client';
import { SoundPanel } from './SoundPanel';

const levels = DEFAULT_INSTRUMENT_SETTINGS.levels;

test('bass: click and reference bass; chords and drums wait for Phase B', async () => {
  const onChange = vi.fn();
  render(<SoundPanel instrument="bass" levels={levels} onChange={onChange} />);
  await userEvent.click(screen.getByRole('button', { name: 'Mute Ref. bass' }));
  expect(onChange).toHaveBeenCalledWith({ ...levels, ref_muted: true });
  fireEvent.change(screen.getByRole('slider', { name: 'Click level' }), { target: { value: '0.3' } });
  expect(onChange).toHaveBeenLastCalledWith({ ...levels, click: 0.3 });
  expect(screen.getAllByText('Phase B')).toHaveLength(2);
  expect(screen.queryByRole('slider', { name: 'Backing bass level' })).toBeNull();
});

test('guitar: reference guitar and a backing bass', () => {
  render(<SoundPanel instrument="guitar" levels={levels} onChange={vi.fn()} />);
  expect(screen.getByRole('slider', { name: 'Ref. guitar level' })).toBeInTheDocument();
  expect(screen.getByRole('slider', { name: 'Backing bass level' })).toBeInTheDocument();
  expect(screen.getAllByText('Phase B')).toHaveLength(1);
});
