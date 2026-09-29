import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';

import { renderTool } from './testing';

// Unmount first: leaving the tab flushes a pending save, which needs the fetch stub still in place.
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const scaleButtons = (list: HTMLElement) => within(list).getAllByRole('button').map((b) => b.textContent);

test('scales over a chord: safest first, chord tones full strength', async () => {
  const { dots } = renderTool('/theory/scales-over-chord?root=A&q=m7');
  const list = await screen.findByRole('list', { name: 'Scales over Am7' });
  expect(scaleButtons(list)).toEqual([
    '1. A minor pentatonic', '2. A blues', '3. A minor', '4. A dorian', '5. A phrygian',
  ]);
  expect(dots()).toContain('s3f5:R');
  expect(dots()).toContain('s2f5:4:dim');
  expect(within(list).getAllByRole('link')[0]).toHaveAttribute('href', '/theory/scale-finder?root=A&scale=minor-pentatonic&q=m7');
});

test('scales over a chord: picking a scale redraws the neck with it, chord tones still full strength', async () => {
  const { dots } = renderTool('/theory/scales-over-chord?root=A&q=m7');
  const list = await screen.findByRole('list', { name: 'Scales over Am7' });
  fireEvent.click(within(list).getByRole('button', { name: '4. A dorian' }));
  expect(within(list).getByRole('button', { name: '4. A dorian' })).toHaveAttribute('aria-pressed', 'true');
  expect(within(list).getByRole('button', { name: '1. A minor pentatonic' })).toHaveAttribute('aria-pressed', 'false');
  // Dorian has the 6th (F#) that minor pentatonic lacks; the chord's own notes stay lit.
  expect(dots()).toContain('s3f2:6:dim');
  expect(dots()).toContain('s3f5:R');
  expect(dots().some((d) => d.startsWith('s2f5:4') && d.endsWith(':dim'))).toBe(true);
  expect(screen.getByRole('group', { name: 'A dorian over Am7' })).toBeInTheDocument();
});

test('scales over a chord: the Scale finder link carries the fitted scale, and its mode', async () => {
  renderTool('/theory/scales-over-chord?root=G&q=7');
  const list = await screen.findByRole('list', { name: 'Scales over G7' });
  expect(within(list).getByRole('link')).toHaveAttribute('href', '/theory/scale-finder?root=G&scale=mixolydian&q=7');
});

test('scales over a chord: a chosen scale is dropped when the chord changes, never pointing at another', async () => {
  const { dots } = renderTool('/theory/scales-over-chord?root=A&q=m7');
  const list = await screen.findByRole('list', { name: 'Scales over Am7' });
  fireEvent.click(within(list).getByRole('button', { name: '4. A dorian' }));
  // Am (quality m) is also held by A dorian, but the choice belonged to Am7: back to the safest.
  fireEvent.click(within(screen.getByRole('group', { name: 'Quality' })).getByRole('button', { name: 'm' }));
  const next = await screen.findByRole('list', { name: 'Scales over Am' });
  expect(within(next).getByRole('button', { name: '1. A minor pentatonic' })).toHaveAttribute('aria-pressed', 'true');
  expect(within(next).getByRole('button', { name: /A dorian/ })).toHaveAttribute('aria-pressed', 'false');
  expect(dots()).toContain('s2f5:4:dim');
  // A different root: nothing carries over either.
  fireEvent.click(within(next).getByRole('button', { name: /A blues/ }));
  fireEvent.click(within(screen.getByRole('group', { name: 'Root' })).getByRole('button', { name: 'E' }));
  const other = await screen.findByRole('list', { name: 'Scales over Em' });
  expect(within(other).getByRole('button', { name: '1. E minor pentatonic' })).toHaveAttribute('aria-pressed', 'true');
});

test('scales over a chord: a chord no listed scale holds says so instead of showing an empty list', async () => {
  const { dots } = renderTool('/theory/scales-over-chord?chord=C7%239b13');
  await screen.findByRole('heading', { name: 'Scales over a chord' });
  expect(screen.getByRole('status')).toHaveTextContent(/No scale in the list holds every note of C7♯9♭13/);
  expect(screen.queryByRole('list', { name: /Scales over/ })).toBeNull();
  expect(dots()).toEqual([]);
});

test('scales over a chord: an unreadable chord in the link is an alert, not a silent default (N-08)', async () => {
  renderTool('/theory/scales-over-chord?chord=Xyz');
  await screen.findByRole('heading', { name: 'Scales over a chord' });
  expect(screen.getByRole('alert')).toHaveTextContent(/The link's chord was ignored; showing .* instead\./);
});

test('scales over a chord: a readable chord in the link raises no alert', async () => {
  renderTool('/theory/scales-over-chord?root=A&chord=Am7');
  await screen.findByRole('list', { name: 'Scales over Am7' });
  expect(screen.queryByRole('alert')).toBeNull();
});

test('scales over a chord: a slash bass that is not a chord tone is said not to be part of the choice', async () => {
  renderTool('/theory/scales-over-chord?chord=C/Bb');
  await screen.findByRole('list', { name: 'Scales over C/B♭' });
  expect(screen.getByText(/The slash bass B♭ is not a chord tone/)).toBeInTheDocument();
});
