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

test('arpeggios: a box that lacks a chord tone says which, root included', async () => {
  renderTool('/theory/arpeggios?root=A&q=m7');
  await screen.findByRole('heading', { name: 'Arpeggios' });
  expect(screen.queryByRole('status')).toBeNull();
  position('2');
  expect(screen.getByText('frets 8–11')).toBeInTheDocument();
  expect(screen.getByRole('status')).toHaveTextContent('This box has no A (R) — it sits outside frets 8–11.');
  position('4');
  expect(screen.getByRole('status')).toHaveTextContent('This box has no E (5) — it sits outside frets 3–6.');
  position('All');
  expect(screen.queryByRole('status')).toBeNull();
});

test('arpeggios: a box holding every chord tone shows no missing-tone note', async () => {
  // Am7 position 1 (frets 5–8) holds A, C, E and G.
  renderTool('/theory/arpeggios?root=A&q=m7');
  await screen.findByRole('heading', { name: 'Arpeggios' });
  position('1');
  expect(screen.queryByRole('status')).toBeNull();
});

test('arpeggios: a complete guitar box shows no missing-tone note', async () => {
  const guitar = { instrument: { kind: 'guitar' as const, strings: 6 as const, tuning: ['E2', 'A2', 'D3', 'G3', 'B3', 'E4'], left_handed: false } };
  renderTool('/theory/arpeggios?root=C&q=maj', { theory: guitar });
  await screen.findByRole('heading', { name: 'Arpeggios' });
  position('1');
  expect(screen.getByText('frets 8–12')).toBeInTheDocument();
  expect(screen.queryByRole('status')).toBeNull();
});

test('arpeggios: Play order is disabled with a reason until a position is chosen, and off shows intervals', async () => {
  const { dots } = renderTool('/theory/arpeggios?root=A&q=m7');
  await screen.findByRole('heading', { name: 'Arpeggios' });
  const box = screen.getByRole('checkbox', { name: 'Play order' });
  expect(box).toBeDisabled();
  expect(box.closest('label')).toHaveAttribute('title', 'Choose a position to number its notes');
  position('1');
  expect(box).toBeEnabled();
  expect(dots()).toContain('s0f5:6');
  fireEvent.click(box);
  expect(dots()).toContain('s0f5:♭3');
  expect(dots()).toContain('s3f5:R');
  expect(dots().every((d) => ['R', '♭3', '5', '♭7'].includes(d.split(':')[1]!))).toBe(true);
});

test('arpeggios: a slash bass that is not a chord tone is listed and said not to be drawn', async () => {
  renderTool('/theory/arpeggios?chord=C/Bb');
  await screen.findByRole('heading', { name: 'Arpeggios' });
  const chips = within(screen.getByRole('list', { name: 'Notes' })).getAllByRole('listitem');
  expect(chips.map((c) => c.textContent)).toEqual(['CR', 'E3', 'G5', 'B♭♭7']);
  expect(screen.getByText(/The slash bass B♭ is not a chord tone and is not drawn on the neck\./)).toBeInTheDocument();
});

test('arpeggios: a chosen position is dropped when the quality changes', async () => {
  renderTool('/theory/arpeggios?root=A&q=m7');
  await screen.findByRole('heading', { name: 'Arpeggios' });
  position('1');
  expect(screen.getByText('frets 5–8')).toBeInTheDocument();
  fireEvent.click(within(screen.getByRole('group', { name: 'Quality' })).getAllByRole('button')[0]!);
  expect(within(screen.getByRole('group', { name: 'Position' })).getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.queryByText(/^frets /)).toBeNull();
});
