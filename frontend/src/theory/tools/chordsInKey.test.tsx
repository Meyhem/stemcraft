import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';

import { renderTool } from './testing';

// Unmount first: leaving the tab flushes a pending save, which needs the fetch stub still in place.
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

test('/theory opens the tool used last, keeping the selection', async () => {
  const { where } = renderTool('/theory?root=A', { theory: { last_tool: 'chords-in-key' } });
  expect(await screen.findByRole('heading', { name: 'Chords in a key' })).toBeInTheDocument();
  expect(where()).toBe('/theory/chords-in-key?root=A');
});

test('the selection carries from one tool to the next', async () => {
  const { where } = renderTool('/theory/scale-finder?root=A&scale=minor-pentatonic');
  const rail = await screen.findByRole('navigation', { name: 'Theory tools' });
  fireEvent.click(within(rail).getByRole('link', { name: 'Chords in a key' }));
  expect(await screen.findByRole('heading', { name: 'Chords in a key' })).toBeInTheDocument();
  expect(where()).toBe('/theory/chords-in-key?root=A&scale=minor-pentatonic');
  // A minor pentatonic is a minor scale, so the key tools open on A minor.
  expect(screen.getByRole('button', { name: 'A minor' })).toHaveAttribute('aria-pressed', 'true');
});

test('chords in a key: seven chords with numerals and function, one on the neck', async () => {
  const { dots } = renderTool('/theory/chords-in-key?root=G');
  const cards = await screen.findByRole('group', { name: 'Chords' });
  expect(within(cards).getAllByRole('button').map((b) => b.textContent)).toEqual([
    'IGhome', 'iiAmsub', 'iiiBmhome', 'IVCsub', 'VDtension', 'viEmhome', 'vii°F♯dimtension',
  ]);
  fireEvent.click(within(cards).getByRole('button', { name: /IV/ }));
  expect(screen.getByText('IV · C major')).toBeInTheDocument();
  expect(dots()).toContain('s2f3:R');
  expect(screen.getByText(/Relative minor/)).toHaveTextContent('E minor');
  expect(screen.getByText(/Common progressions in G major/)).toHaveTextContent('I–V–vi–IV G D Em C');
});

test('chords in a key: 7th chords, minor mode and the circle of fifths', async () => {
  const { where } = renderTool('/theory/chords-in-key?root=G');
  await screen.findByRole('group', { name: 'Chords' });
  fireEvent.click(screen.getByRole('button', { name: '7th chords' }));
  expect(within(screen.getByRole('group', { name: 'Chords' })).getAllByRole('button')[4]).toHaveTextContent('D7');
  fireEvent.click(within(screen.getByRole('group', { name: 'Mode' })).getByRole('button', { name: 'Minor' }));
  expect(where()).toBe('/theory/chords-in-key?root=G&scale=minor');
  fireEvent.click(screen.getByRole('button', { name: 'E♭ major' }));
  await waitFor(() => expect(where()).toBe('/theory/chords-in-key?root=Eb'));
  expect(screen.getByRole('button', { name: 'E♭ major' })).toHaveAttribute('aria-pressed', 'true');
});
