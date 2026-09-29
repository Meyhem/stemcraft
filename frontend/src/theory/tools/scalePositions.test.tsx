import { cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';

import { DEFAULT_THEORY } from '../../api/client';
import { scaleNotes } from '../../music/spell';
import { systems } from './ScalePositions';
import { renderTool } from './testing';

// Unmount first: leaving the tab flushes a pending save, which needs the fetch stub still in place.
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const guitar = { instrument: { kind: 'guitar' as const, strings: 6, tuning: ['E2', 'A2', 'D3', 'G3', 'B3', 'E4'], left_handed: false } };

test('scale positions: pentatonic box 1 on guitar, then the next box', async () => {
  const { dots } = renderTool('/theory/scale-positions?root=A&scale=minor-pentatonic', { theory: guitar });
  await screen.findByRole('heading', { name: 'Scale positions' });
  expect(screen.getByRole('button', { name: 'Pentatonic boxes' })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByText('Box 1')).toBeInTheDocument();
  const lit = dots().filter((d) => !d.endsWith(':dim'));
  expect(lit).toHaveLength(12);
  expect(lit).toContain('s5f5:R');
  fireEvent.click(screen.getByRole('button', { name: 'Next shape' }));
  expect(screen.getByText('Box 2')).toBeInTheDocument();
});

test('scale positions: CAGED is disabled with the reason in a drop tuning', async () => {
  renderTool('/theory/scale-positions?root=G', {
    theory: { instrument: { ...guitar.instrument, tuning: ['D2', 'A2', 'D3', 'G3', 'B3', 'E4'] } },
  });
  await screen.findByRole('heading', { name: 'Scale positions' });
  const caged = screen.getByRole('button', { name: 'CAGED' });
  expect(caged).toBeDisabled();
  expect(caged).toHaveAttribute('title', 'CAGED shapes assume standard guitar tuning (E A D G B E)');
  expect(screen.getByRole('button', { name: '3 notes per string' })).toHaveAttribute('aria-pressed', 'true');
});

test('scale positions: bass gets one-finger-per-fret boxes and play order numbers', async () => {
  const { dots } = renderTool('/theory/scale-positions?root=G');
  await screen.findByRole('heading', { name: 'Scale positions' });
  expect(screen.getByRole('button', { name: '1 finger per fret' })).toHaveAttribute('aria-pressed', 'true');
  fireEvent.click(screen.getByRole('checkbox', { name: 'Play order' }));
  expect(dots()).toContain('s3f3:1');
});

test('systems: a system with no shape that fits the neck is unavailable and says why, never an empty step list', () => {
  const bass = DEFAULT_THEORY.instrument;
  const notes = scaleNotes('A', 'minor-pentatonic');
  // Two notes on each of four strings never fit inside two frets, so every box is dropped.
  const boxes = systems(bass, notes, 2).find((d) => d.id === 'boxes')!;
  expect(boxes.unavailable).toBe('No pentatonic box fits within 2 frets in this tuning');
  expect(boxes.steps()).toEqual([]);
  // The systems that do fit stay available.
  expect(systems(bass, notes, 2).find((d) => d.id === 'positions')!.unavailable).toBeNull();
});

test('systems: a shape dropped for not fitting keeps its number, and steps index into what is left', () => {
  const bass = DEFAULT_THEORY.instrument;
  const boxes = systems(bass, scaleNotes('A', 'minor-pentatonic'), 3).find((d) => d.id === 'boxes')!;
  expect(boxes.unavailable).toBeNull();
  // Only the fourth box fits in three frets: it is the one and only step, still called Box 4.
  expect(boxes.steps().map((s) => s.label)).toEqual(['Box 4']);
});
