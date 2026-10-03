import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';

import { DEFAULT_INSTRUMENT_SETTINGS } from '../api/client';
import { SoundPanel } from './SoundPanel';

const { levels, backing } = DEFAULT_INSTRUMENT_SETTINGS;

function mount(instrument: 'bass' | 'guitar', hasHarmony = true) {
  const onChange = vi.fn();
  const onBacking = vi.fn();
  render(<SoundPanel instrument={instrument} levels={levels} backing={backing} hasHarmony={hasHarmony} onChange={onChange} onBacking={onBacking} />);
  return { onChange, onBacking };
}

test('bass: chords with pad or keys, drums with a groove, each mutable', async () => {
  const { onChange, onBacking } = mount('bass');
  await userEvent.click(screen.getByRole('button', { name: 'Keys' }));
  expect(onBacking).toHaveBeenCalledWith({ ...backing, chord_sound: 'keys' });
  await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Drum groove' }), 'shuffle');
  expect(onBacking).toHaveBeenLastCalledWith({ ...backing, drum_groove: 'shuffle' });
  await userEvent.click(screen.getByRole('button', { name: 'Mute Drums' }));
  expect(onChange).toHaveBeenCalledWith({ ...levels, drums_muted: true });
  expect(screen.queryByText('Phase B')).toBeNull();
});

test('guitar: no chord part (the reference guitar is the chords); drums yes', () => {
  mount('guitar');
  expect(screen.queryByRole('slider', { name: 'Chords level' })).toBeNull();
  expect(screen.getByRole('slider', { name: 'Drums level' })).toBeInTheDocument();
});

test('a loop with no harmony says why the chords are silent', () => {
  mount('bass', false);
  expect(screen.getByText('Drills have no chords.')).toBeInTheDocument();
});
