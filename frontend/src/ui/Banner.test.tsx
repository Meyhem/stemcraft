import { render, screen } from '@testing-library/react';
import { expect, test } from 'vitest';

import { Banner } from './Banner';

test('an error banner is an alert and a warn banner is a status', () => {
  const { rerender } = render(<Banner tone="error">boom</Banner>);
  expect(screen.getByRole('alert')).toHaveClass('banner', 'error');
  rerender(<Banner tone="warn">careful</Banner>);
  expect(screen.getByRole('status')).toHaveClass('banner', 'warn');
});

test('the role can be overridden', () => {
  render(<Banner tone="error" role="status">quiet</Banner>);
  expect(screen.getByRole('status')).toBeInTheDocument();
});

test('the trace is rendered verbatim, whitespace and all', () => {
  // U-09 is the whole point of this component: ffmpeg stderr, yt-dlp stderr and Python
  // tracebacks are only actionable if their line breaks and indentation survive.
  // Load-bearing: this asserts on textContent of the <pre>, not on a normalised
  // string, because getByText collapses whitespace and would pass against a component
  // that rendered the trace into a <p>.
  const trace = 'Traceback (most recent call last):\n  File "x.py", line 3\n    boom\nRuntimeError: no';
  const { container } = render(<Banner tone="error" title="Separation failed" trace={trace} />);
  const pre = container.querySelector('pre');
  expect(pre).not.toBeNull();
  expect(pre!.textContent).toBe(trace);
});

test('no trace element is rendered when there is no trace', () => {
  const { container } = render(<Banner tone="warn">just a note</Banner>);
  expect(container.querySelector('pre')).toBeNull();
});

test('the title renders alongside the body', () => {
  render(<Banner tone="error" title="Import failed">check the URL</Banner>);
  expect(screen.getByText('Import failed')).toBeInTheDocument();
  expect(screen.getByText('check the URL')).toBeInTheDocument();
});
