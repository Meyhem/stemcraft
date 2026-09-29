import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';

import { Segmented } from './Segmented';

const OPTIONS = [
  { value: 'bass', label: 'Bass · 4 string' },
  { value: 'guitar', label: 'Guitar · 6 string' },
] as const;

test('the selected option is the pressed one and the others are not', () => {
  render(<Segmented label="Instrument" value="bass" options={OPTIONS} onChange={vi.fn()} />);
  expect(screen.getByRole('button', { name: /bass/i })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByRole('button', { name: /guitar/i })).toHaveAttribute('aria-pressed', 'false');
});

test('clicking an option reports its value', async () => {
  const onChange = vi.fn();
  render(<Segmented label="Instrument" value="bass" options={OPTIONS} onChange={onChange} />);
  await userEvent.click(screen.getByRole('button', { name: /guitar/i }));
  expect(onChange).toHaveBeenCalledWith('guitar');
});

test('the group carries its accessible name', () => {
  render(<Segmented label="Instrument" value="bass" options={OPTIONS} onChange={vi.fn()} />);
  expect(screen.getByRole('group', { name: 'Instrument' })).toBeInTheDocument();
});

test('the options are type=button so a segmented control inside a form cannot submit it', () => {
  render(<Segmented label="Format" value="bass" options={OPTIONS} onChange={vi.fn()} />);
  for (const button of screen.getAllByRole('button')) {
    expect(button).toHaveAttribute('type', 'button');
  }
});
