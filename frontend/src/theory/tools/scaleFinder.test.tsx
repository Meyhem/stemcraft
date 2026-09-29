import { fireEvent, screen, within } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';

import { renderTool } from './testing';

afterEach(() => vi.unstubAllGlobals());

test('scale finder: root and scale pickers drive the neck and the URL', async () => {
  const { where, dots } = renderTool('/theory/scale-finder');
  await screen.findByRole('heading', { name: 'Scale finder' });
  fireEvent.click(within(screen.getByRole('group', { name: 'Root' })).getByRole('button', { name: 'A' }));
  fireEvent.click(screen.getByRole('button', { name: 'Minor pentatonic' }));
  expect(where()).toBe('/theory/scale-finder?root=A&scale=minor-pentatonic');
  expect(dots()).toContain('s3f5:A');
  expect(dots()).toContain('s0f5:C');
  expect(dots().some((d) => d.includes(':F'))).toBe(false);
  expect(screen.getByText(/Fits over:/).parentElement).toHaveTextContent('Fits over: Am, C.');
  expect(screen.getByText(/Same notes as/).parentElement).toHaveTextContent('Same notes as C major pentatonic.');
});

test('scale finder: labels and one highlighted position', async () => {
  const { dots } = renderTool('/theory/scale-finder?root=A&scale=minor-pentatonic');
  await screen.findByRole('heading', { name: 'Scale finder' });
  fireEvent.click(screen.getByRole('button', { name: 'Interval' }));
  expect(dots()).toContain('s3f5:R');
  fireEvent.click(within(screen.getByRole('group', { name: 'Highlight position' })).getByRole('button', { name: '1' }));
  expect(screen.getByText('frets 5–8')).toBeInTheDocument();
  expect(dots()).toContain('s3f5:R');
  expect(dots()).toContain('s3f3:♭7:dim');
});

test('scale finder: a flat key is spelled with flats', async () => {
  const { dots } = renderTool('/theory/scale-finder?root=Eb');
  await screen.findByRole('heading', { name: 'Scale finder' });
  expect(dots()).toContain('s2f1:B♭');
  expect(dots().some((d) => d.includes('♯'))).toBe(false);
});
