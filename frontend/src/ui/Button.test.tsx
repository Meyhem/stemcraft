import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { FormEvent } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { expect, test, vi } from 'vitest';

import { Button, ButtonLink } from './Button';

test('a button carries the base class and no variant class by default', () => {
  render(<Button>Do it</Button>);
  const btn = screen.getByRole('button', { name: 'Do it' });
  expect(btn).toHaveClass('btn');
  expect(btn).not.toHaveClass('primary');
  expect(btn).not.toHaveClass('ghost');
  expect(btn).not.toHaveClass('danger');
});

test.each([
  ['primary', 'primary'],
  ['ghost', 'ghost'],
  ['danger', 'danger'],
] as const)('variant %s maps to class %s', (variant, cls) => {
  render(<Button variant={variant}>X</Button>);
  expect(screen.getByRole('button')).toHaveClass('btn', cls);
});

test('the performance tier adds its class and the setup tier does not', () => {
  const { rerender } = render(<Button tier="perform">X</Button>);
  expect(screen.getByRole('button')).toHaveClass('perform');
  rerender(<Button tier="setup">X</Button>);
  expect(screen.getByRole('button')).not.toHaveClass('perform');
});

test('a button defaults to type=button, so one inside a form does not submit it', async () => {
  // Load-bearing. Library, Export, Import and AlbumSplitter all put non-submitting
  // buttons (Delete, Cancel, Add boundary) inside or near <form>. A bare <button> is
  // type=submit, so the default here is the difference between a Delete button and a
  // Delete button that also submits the form it happens to sit in.
  const onSubmit = vi.fn((e: FormEvent) => e.preventDefault());
  render(
    <form onSubmit={onSubmit}>
      <Button>Not a submit</Button>
    </form>,
  );
  await userEvent.click(screen.getByRole('button'));
  expect(onSubmit).not.toHaveBeenCalled();
});

test('type can still be overridden to submit', () => {
  render(<Button type="submit">Go</Button>);
  expect(screen.getByRole('button')).toHaveAttribute('type', 'submit');
});

test('a ButtonLink is a link that wears the button classes', () => {
  render(
    <MemoryRouter>
      <ButtonLink to="/import" variant="primary">New Song</ButtonLink>
    </MemoryRouter>,
  );
  const link = screen.getByRole('link', { name: 'New Song' });
  expect(link).toHaveAttribute('href', '/import');
  expect(link).toHaveClass('btn', 'primary');
});

test('a caller-supplied className is kept alongside the variant classes', () => {
  render(<Button variant="danger" className="mine">X</Button>);
  expect(screen.getByRole('button')).toHaveClass('btn', 'danger', 'mine');
});
