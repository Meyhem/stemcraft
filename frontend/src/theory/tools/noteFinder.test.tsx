import { fireEvent, screen, within } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';

import { renderTool } from './testing';

afterEach(() => vi.unstubAllGlobals());

test('note finder: every E and G with octaves', async () => {
  const { dots, where } = renderTool('/theory/note-finder');
  await screen.findByRole('heading', { name: 'Note finder' });
  expect(screen.getByText(/Pick one or more notes/)).toBeInTheDocument();
  const picker = screen.getByRole('group', { name: 'Notes' });
  fireEvent.click(within(picker).getByRole('button', { name: 'E' }));
  fireEvent.click(within(picker).getByRole('button', { name: 'G' }));
  expect(where()).toBe('/theory/note-finder?notes=4%2C7');
  expect(dots()).toEqual(expect.arrayContaining(['s3f0:E1', 's3f12:E2', 's0f0:G2', 's3f3:G1']));
  fireEvent.click(within(picker).getByRole('button', { name: 'E' }));
  expect(dots().some((d) => d.includes('E'))).toBe(false);
});
