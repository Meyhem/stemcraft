import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation, type Location } from 'react-router-dom';
import { expect, test } from 'vitest';

import { ImportModal } from './ImportModal';

function Landed() {
  return <p data-testid="path">{useLocation().pathname}</p>;
}

function renderAt(entry: string | { pathname: string; state: unknown }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/jobs', entry]} initialIndex={1}>
        <Routes>
          <Route path="/" element={<Landed />} />
          <Route path="/jobs" element={<Landed />} />
          <Route path="/import" element={<Landed />} />
        </Routes>
        <Routes>
          <Route path="/import" element={<ImportModal />} />
          <Route path="*" element={null} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const background = { pathname: '/jobs', search: '', hash: '', state: null, key: 'k' } as Location;

test('the close button returns to the page it was opened over', async () => {
  renderAt({ pathname: '/import', state: { background } });
  await userEvent.click(screen.getByRole('button', { name: 'Close' }));
  expect(screen.getByTestId('path')).toHaveTextContent('/jobs');
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

test('Esc on a direct visit goes to the library', () => {
  renderAt('/import');
  fireEvent(screen.getByRole('dialog'), new Event('cancel', { cancelable: true }));
  expect(screen.getByTestId('path')).toHaveTextContent('/');
  expect(screen.getByTestId('path')).not.toHaveTextContent('/import');
});

test('Cancel closes too', async () => {
  renderAt({ pathname: '/import', state: { background } });
  await userEvent.click(screen.getByRole('button', { name: /^cancel$/i }));
  expect(screen.getByTestId('path')).toHaveTextContent('/jobs');
});
