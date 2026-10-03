import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';

import { DEFAULT_INSTRUMENT_SETTINGS, type InstrumentSettings } from '../api/client';
import { SettingsPanel } from './SettingsPanel';

const show = (instrument: 'bass' | 'guitar', patch: Partial<InstrumentSettings> = {}) => {
  const onChange = vi.fn();
  render(<SettingsPanel instrument={instrument} settings={{ ...DEFAULT_INSTRUMENT_SETTINGS, ...patch }} onChange={onChange} />);
  return onChange;
};

test('the key picker shows both names on the black keys, and picks a pitch class', async () => {
  const onChange = show('bass');
  expect(screen.getByRole('button', { name: 'G', pressed: true })).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'A♯/B♭' }));
  expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ key: 10 }));
});

test('bass groove: notes, rhythm, approach and bars per chord', async () => {
  const onChange = show('bass');
  expect(screen.getByRole('group', { name: 'Notes' })).toBeInTheDocument();
  expect(screen.getByRole('group', { name: 'Approach' })).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: '4' }));
  expect(onChange.mock.calls[0]![0].groove.bars_per_chord).toBe(4);
});

test('guitar groove: shapes, strum, position instead', () => {
  show('guitar');
  expect(screen.getByRole('group', { name: 'Shapes' })).toBeInTheDocument();
  expect(screen.getByRole('group', { name: 'Strum' })).toBeInTheDocument();
  expect(screen.queryByRole('group', { name: 'Approach' })).toBeNull();
});

test('drills have no key, and say so', () => {
  show('bass', { exercise: 'drill' });
  expect(screen.queryByRole('group', { name: 'Key' })).toBeNull();
  expect(screen.getByText('Drills are fret-based: no key.')).toBeInTheDocument();
});

test('scales: a scale menu and a fret stepper', async () => {
  const onChange = show('bass', { exercise: 'scale' });
  await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Scale' }), 'blues');
  expect(onChange.mock.calls[0]![0].scale.scale).toBe('blues');
  await userEvent.click(screen.getByRole('button', { name: 'From fret up' }));
  expect(onChange.mock.calls[1]![0].scale.from_fret).toBe(6);
});
