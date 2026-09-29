import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';

import { renderTool } from './testing';

// Unmount first: leaving the tab flushes a pending save, which needs the fetch stub still in place.
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const position = (name: string) => fireEvent.click(within(screen.getByRole('group', { name: 'Position' })).getByRole('button', { name }));

test('arpeggios: a highlighted position numbers its notes low to high', async () => {
  const { dots } = renderTool('/theory/arpeggios?root=A&q=m7');
  await screen.findByRole('heading', { name: 'Arpeggios' });
  position('1');
  expect(screen.getByText('frets 5–8')).toBeInTheDocument();
  const lit = dots().filter((d) => !d.endsWith(':dim'));
  expect(lit[0]).toBe('s0f5:6');
  expect(lit).toContain('s3f5:1');
});

test('arpeggios: with no position chosen every dot shows its interval', async () => {
  const { dots } = renderTool('/theory/arpeggios?root=A&q=m7');
  await screen.findByRole('heading', { name: 'Arpeggios' });
  expect(dots().some((d) => d.endsWith(':dim'))).toBe(false);
  expect(dots()).toContain('s3f5:R');
});

test('arpeggios: the position buttons are labelled with the numbers the caption uses', async () => {
  renderTool('/theory/arpeggios?root=A&q=m7');
  await screen.findByRole('heading', { name: 'Arpeggios' });
  const names = within(screen.getByRole('group', { name: 'Position' })).getAllByRole('button').map((b) => b.textContent);
  expect(names).toEqual(['All', '1', '2', '3', '4']);
});

test('arpeggios: the same pitch on two strings is numbered lower string first', async () => {
  // Two unison low strings: the same note sits on rows 3 and 2 in every window.
  const unison = { instrument: { kind: 'bass' as const, strings: 4 as const, tuning: ['E1', 'E1', 'A1', 'D2'], left_handed: false } };
  const { dots } = renderTool('/theory/arpeggios?root=E&q=maj', { theory: unison });
  await screen.findByRole('heading', { name: 'Arpeggios' });
  position('1');
  const lit = dots().filter((d) => !d.endsWith(':dim'));
  const numberAt = (cell: string) => Number(lit.find((d) => d.startsWith(`${cell}:`))!.split(':')[1]);
  const low = numberAt('s3f12');
  const high = numberAt('s2f12');
  expect(high).toBe(low + 1);
});

test('arpeggios: an unreadable chord in the link is an alert, not a silent default (N-08)', async () => {
  renderTool('/theory/arpeggios?chord=Xyz');
  await screen.findByRole('heading', { name: 'Arpeggios' });
  expect(screen.getByRole('alert')).toHaveTextContent(/The link's chord was ignored; showing .* instead\./);
});

test('arpeggios: a readable chord in the link raises no alert', async () => {
  renderTool('/theory/arpeggios?root=A&chord=Am7');
  await screen.findByRole('heading', { name: 'Arpeggios' });
  expect(screen.queryByRole('alert')).toBeNull();
});
