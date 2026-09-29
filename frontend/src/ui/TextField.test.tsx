import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';

import { TextField } from './TextField';

test('the label is bound to the input, so getByLabelText finds it', () => {
  // Load-bearing: Import.test, Export.test and AlbumSplitter.test all reach their
  // inputs through getByLabelText. A field that renders the label as a sibling <span>
  // instead of a bound <label> looks identical and breaks every one of them.
  render(<TextField id="title" label="Title" />);
  expect(screen.getByLabelText('Title')).toHaveClass('input');
});

test('typing reaches the change handler', async () => {
  const onChange = vi.fn();
  render(<TextField id="artist" label="Artist" value="" onChange={onChange} />);
  await userEvent.type(screen.getByLabelText('Artist'), 'CCR');
  expect(onChange).toHaveBeenCalled();
});

test('input attributes pass through', () => {
  render(<TextField id="u" label="URL" type="url" required placeholder="https://…" />);
  const input = screen.getByLabelText('URL');
  expect(input).toHaveAttribute('type', 'url');
  expect(input).toBeRequired();
  expect(input).toHaveAttribute('placeholder', 'https://…');
});

test('a hint renders and is described by the input', () => {
  render(<TextField id="t" label="Title" hint="From the file's tags, if present" />);
  expect(screen.getByLabelText('Title')).toHaveAccessibleDescription(
    "From the file's tags, if present",
  );
});

test('no hint element exists when there is no hint', () => {
  render(<TextField id="t" label="Title" />);
  expect(screen.getByLabelText('Title')).not.toHaveAttribute('aria-describedby');
});
