import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { expect, it } from 'vitest';

import { Breadcrumbs } from './Breadcrumbs';

it('links the ancestors and marks the last crumb as the current page', () => {
  render(
    <MemoryRouter>
      <Breadcrumbs crumbs={[{ label: 'Library', to: '/' }, { label: 'Song', to: '/songs/a' }, { label: 'Export' }]} />
    </MemoryRouter>,
  );
  const nav = screen.getByRole('navigation', { name: 'Breadcrumb' });
  expect(nav).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Library' })).toHaveAttribute('href', '/');
  expect(screen.getByRole('link', { name: 'Song' })).toHaveAttribute('href', '/songs/a');
  expect(screen.queryByRole('link', { name: 'Export' })).toBeNull();
  expect(screen.getByText('Export')).toHaveAttribute('aria-current', 'page');
});
