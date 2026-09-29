import { render, screen } from '@testing-library/react';
import { expect, test } from 'vitest';

import { Chip, jobStateTone } from './Chip';

test('a neutral chip has the base class and no tone class', () => {
  render(<Chip>queued</Chip>);
  const chip = screen.getByText('queued');
  expect(chip).toHaveClass('chip');
  expect(chip).not.toHaveClass('ok', 'warn', 'error', 'run');
});

test.each([
  ['ok', 'ok'],
  ['warn', 'warn'],
  ['error', 'error'],
  ['run', 'run'],
] as const)('tone %s maps to class %s', (tone, cls) => {
  render(<Chip tone={tone}>x</Chip>);
  expect(screen.getByText('x')).toHaveClass('chip', cls);
});

test('a dot chip renders a decorative dot', () => {
  const { container } = render(<Chip tone="ok" dot>done</Chip>);
  // aria-hidden: the dot repeats the tone, which the text already carries.
  expect(container.querySelector('.dot')).toHaveAttribute('aria-hidden', 'true');
});

test.each([
  ['queued', 'neutral'],
  ['running', 'run'],
  ['done', 'ok'],
  ['failed', 'error'],
  ['cancelled', 'neutral'],
  ['something-new', 'neutral'],
] as const)('job state %s is tone %s', (state, tone) => {
  // Load-bearing: the point of this map is that 'failed' and 'done' can never collide.
  // A default that returned 'ok' would make an unknown state read as success.
  expect(jobStateTone(state)).toBe(tone);
});
