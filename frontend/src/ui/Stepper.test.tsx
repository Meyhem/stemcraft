import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { Stepper } from './Stepper';

function setup(over: Partial<Parameters<typeof Stepper>[0]> = {}) {
  const props = {
    label: 'Tempo',
    value: 100,
    min: 50,
    max: 150,
    step: 10,
    format: (v: number) => `${v}%`,
    onChange: vi.fn(),
    ...over,
  };
  render(<Stepper {...props} />);
  return props;
}

describe('Stepper', () => {
  it('shows the formatted value under the label', () => {
    setup({ value: 90 });
    expect(screen.getByLabelText('Tempo')).toHaveTextContent('90%');
  });

  it('steps by `step` in either direction', async () => {
    const props = setup({ value: 85 });
    await userEvent.click(screen.getByRole('button', { name: 'Tempo up' }));
    expect(props.onChange).toHaveBeenLastCalledWith(95);
    await userEvent.click(screen.getByRole('button', { name: 'Tempo down' }));
    expect(props.onChange).toHaveBeenLastCalledWith(75);
  });

  it('clamps a step that would overshoot', async () => {
    const props = setup({ value: 145 });
    await userEvent.click(screen.getByRole('button', { name: 'Tempo up' }));
    expect(props.onChange).toHaveBeenLastCalledWith(150);
  });

  it('disables a button at its range end rather than silently clamping', () => {
    setup({ value: 150 });
    expect(screen.getByRole('button', { name: 'Tempo up' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Tempo down' })).toBeEnabled();
  });

  it('marks a default value so it can render muted', () => {
    setup({ atDefault: true });
    expect(screen.getByLabelText('Tempo')).toHaveAttribute('data-default', 'true');
  });

  it('takes custom button names (the loop bar steppers)', () => {
    setup({ label: 'Loop start bar', downLabel: 'Start bar earlier', upLabel: 'Start bar later' });
    expect(screen.getByRole('button', { name: 'Start bar earlier' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start bar later' })).toBeInTheDocument();
  });
});
