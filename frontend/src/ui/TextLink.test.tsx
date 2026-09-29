import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { expect, test } from 'vitest';

import { TextLink } from './TextLink';

test('a TextLink routes and carries the link class', () => {
  render(
    <MemoryRouter>
      <TextLink to="/jobs">the job queue</TextLink>
    </MemoryRouter>,
  );
  const link = screen.getByRole('link', { name: 'the job queue' });
  expect(link).toHaveAttribute('href', '/jobs');
  expect(link).toHaveClass('link');
});

test('a caller className is kept', () => {
  render(
    <MemoryRouter>
      <TextLink to="/" className="mine">home</TextLink>
    </MemoryRouter>,
  );
  expect(screen.getByRole('link')).toHaveClass('link', 'mine');
});
