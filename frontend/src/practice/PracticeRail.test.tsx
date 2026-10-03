import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';

import { DEFAULT_INSTRUMENT_SETTINGS, DEFAULT_PRACTICE, type PracticeDoc } from '../api/client';
import { PracticeRail } from './PracticeRail';

const doc: PracticeDoc = {
  ...DEFAULT_PRACTICE,
  presets: [{ name: 'Blues warm-up', instrument: 'bass', settings: DEFAULT_INSTRUMENT_SETTINGS }],
};
afterEach(() => vi.restoreAllMocks());

function mount() {
  const handlers = { onInstrument: vi.fn(), onExercise: vi.fn(), onLoadPreset: vi.fn(), onSavePreset: vi.fn() };
  render(<PracticeRail doc={doc} {...handlers} />);
  return handlers;
}

test('instrument and exercise', async () => {
  const h = mount();
  await userEvent.click(screen.getByRole('button', { name: 'Guitar' }));
  expect(h.onInstrument).toHaveBeenCalledWith('guitar');
  expect(screen.getByRole('button', { name: /Groove over chords/ })).toHaveAttribute('aria-current', 'page');
  await userEvent.click(screen.getByRole('button', { name: /Technique drills/ }));
  expect(h.onExercise).toHaveBeenCalledWith('drill');
});

test('this instrument’s presets load; saving under an existing name asks first', async () => {
  const h = mount();
  await userEvent.click(screen.getByRole('button', { name: /Blues warm-up/ }));
  expect(h.onLoadPreset).toHaveBeenCalledWith(doc.presets[0]);
  await userEvent.click(screen.getByRole('button', { name: 'Save as preset…' }));
  await userEvent.type(screen.getByLabelText('Preset name'), 'blues WARM-UP');
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
  await userEvent.click(screen.getByRole('button', { name: 'Save preset' }));
  expect(confirm).toHaveBeenCalledWith('Replace the preset "Blues warm-up"?');
  expect(h.onSavePreset).not.toHaveBeenCalled();
});
