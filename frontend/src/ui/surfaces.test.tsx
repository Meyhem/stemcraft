import { render, screen } from '@testing-library/react';
import { expect, test } from 'vitest';

import { EmptyState, Panel, ProgressBar, Table } from './index';

test('a panel wraps its children', () => {
  render(<Panel>inside</Panel>);
  expect(screen.getByText('inside')).toBeInTheDocument();
});

test('a progress bar reports its percentage to assistive tech', () => {
  render(<ProgressBar value={0.42} label="Separation" />);
  const bar = screen.getByRole('progressbar', { name: 'Separation' });
  expect(bar).toHaveAttribute('aria-valuenow', '42');
  expect(bar).toHaveAttribute('aria-valuemin', '0');
  expect(bar).toHaveAttribute('aria-valuemax', '100');
});

test.each([
  [-0.5, '0'],
  [1.5, '100'],
])('a progress value of %s clamps to %s', (value, expected) => {
  // Load-bearing: job progress arrives from the worker and can land slightly over 1.0
  // on a finishing job. Unclamped, the fill overflows its rounded container. Clamping
  // is asserted here rather than assumed.
  render(<ProgressBar value={value} label="Job" />);
  expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', expected);
});

test.each([
  ['ok', 'ok'],
  ['error', 'error'],
] as const)('progress tone %s maps to class %s', (tone, cls) => {
  render(<ProgressBar value={1} label="Job" tone={tone} />);
  expect(screen.getByRole('progressbar')).toHaveClass('bar', cls);
});

test('an empty state renders a title and an optional action', () => {
  render(<EmptyState title="No songs yet"><span>import one</span></EmptyState>);
  expect(screen.getByText('No songs yet')).toBeInTheDocument();
  expect(screen.getByText('import one')).toBeInTheDocument();
});

test('a table renders as a table', () => {
  render(
    <Table>
      <tbody><tr><td>cell</td></tr></tbody>
    </Table>,
  );
  expect(screen.getByRole('table')).toHaveClass('tbl');
});
