import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';

import { instrumentFor } from '../../music/tuning';
import { renderTool } from './testing';
import { triadSets } from './Triads';

// Unmount first: leaving the tab flushes a pending save, which needs the fetch stub still in place.
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const guitar = { instrument: { kind: 'guitar' as const, strings: 6, tuning: ['E2', 'A2', 'D3', 'G3', 'B3', 'E4'], left_handed: false } };

test('triads: C major on the G-B-E strings in 2nd inversion', async () => {
  const { dots } = renderTool('/theory/triads?root=C', { theory: guitar });
  await screen.findByRole('heading', { name: 'Triads & inversions' });
  fireEvent.click(screen.getByRole('button', { name: 'G–B–E' }));
  fireEvent.click(screen.getByRole('button', { name: '2nd inversion' }));
  expect(dots()).toEqual(['s2f0:5', 's1f1:R', 's0f0:3', 's2f12:5', 's1f13:R', 's0f12:3']);
});

// A tuning whose upper strings are far above the lower ones: some three-string sets hold a triad shape, some cannot.
const gapped = { instrument: { ...guitar.instrument, tuning: ['E2', 'A2', 'D3', 'G4', 'B4', 'E5'] } };
const octaves = { instrument: { ...guitar.instrument, tuning: ['E2', 'E3', 'E4', 'E5', 'E6', 'E7'] } };

test('triads: a string set with no shape is disabled with the reason and the rest still draw (N-08)', async () => {
  const { dots } = renderTool('/theory/triads?root=C', { theory: gapped });
  await screen.findByRole('heading', { name: 'Triads & inversions' });
  fireEvent.click(screen.getByRole('button', { name: '1st inversion' }));
  for (const name of ['A–D–G', 'D–G–B']) {
    const b = screen.getByRole('button', { name });
    expect(b).toBeDisabled();
    expect(b).toHaveAttribute('title', `No 1st inversion shape fits within 17 frets on the ${name} strings in this tuning`);
  }
  expect(screen.getByRole('button', { name: 'E–A–D' })).toBeEnabled();
  expect(screen.getByRole('button', { name: 'G–B–E' })).toBeEnabled();
  expect(dots()).toHaveLength(6);
  expect(screen.getByRole('status')).toHaveTextContent('No 1st inversion shape fits within 17 frets on the A–D–G, D–G–B strings in this tuning.');
});

test('triads: a chosen set that loses its shape on changing inversion shows an alert and no dots (N-08)', async () => {
  const { dots } = renderTool('/theory/triads?root=C', { theory: gapped });
  await screen.findByRole('heading', { name: 'Triads & inversions' });
  fireEvent.click(screen.getByRole('button', { name: 'A–D–G' }));
  expect(dots().length).toBeGreaterThan(0);
  fireEvent.click(screen.getByRole('button', { name: '1st inversion' }));
  expect(dots()).toEqual([]);
  expect(screen.getByRole('alert')).toHaveTextContent('No 1st inversion shape fits within 17 frets on the A–D–G strings in this tuning.');
});

test('triads: no set fits at all says so instead of drawing an empty neck (N-08)', async () => {
  const { dots } = renderTool('/theory/triads?root=F%23&q=aug', { theory: octaves });
  await screen.findByRole('heading', { name: 'Triads & inversions' });
  expect(dots()).toEqual([]);
  expect(screen.getByRole('alert')).toHaveTextContent('No root position shape of F♯aug fits within 17 frets on any three adjacent strings in this tuning.');
  for (const b of screen.getByRole('group', { name: 'Strings' }).querySelectorAll('button:not([aria-pressed="true"])')) expect(b).toBeDisabled();
});

test('triadSets: a triad that is not three notes yields unavailable sets, never a crash', () => {
  const sets = triadSets(instrumentFor('guitar6', false), [], 0, 17);
  expect(sets.map((s) => s.unavailable !== null)).toEqual([true, true, true, true]);
});

test('triads: bass shows arpeggio shapes on the low and high three strings', async () => {
  const { dots } = renderTool('/theory/triads?root=E');
  await screen.findByRole('heading', { name: 'Triads & inversions' });
  expect(screen.getByRole('button', { name: 'E–A–D' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'A–D–G' })).toBeInTheDocument();
  expect(dots().length).toBeGreaterThan(0);
});

const pressed = (group: string) =>
  within(screen.getByRole('group', { name: group }))
    .getAllByRole('button')
    .filter((b) => b.getAttribute('aria-pressed') === 'true')
    .map((b) => b.textContent);

test('triads: a typed chord is the triad shown, not the quality chip left in the link (N-08)', async () => {
  const { dots } = renderTool('/theory/triads?root=F%23&chord=F%23m', { theory: guitar });
  await screen.findByRole('heading', { name: 'Triads & inversions' });
  expect(pressed('Triad')).toEqual(['m']);
  expect(screen.getByText('F♯m', { selector: 'b' })).toBeInTheDocument();
  const labels = new Set(dots().map((d) => d.split(':')[1]));
  expect(labels).toEqual(new Set(['R', '♭3', '5'])); // F♯ A C♯, not F♯ A♯ C♯
  expect(dots()).toContain('s4f12:♭3'); // A on the A string
  expect(screen.queryByText(/inside/)).not.toBeInTheDocument(); // F♯m is itself a triad
});

test('triads: a four-note chord shows the triad inside it and says so', async () => {
  renderTool('/theory/triads?root=C&q=m7', { theory: guitar });
  await screen.findByRole('heading', { name: 'Triads & inversions' });
  expect(pressed('Triad')).toEqual(['m']);
  expect(screen.getByText('Cm', { selector: 'b' })).toBeInTheDocument();
  expect(screen.getByText('Showing the Cm triad inside Cm7.')).toBeInTheDocument();
});

test('triads: a chord with no triad in it (sus, power chord) says so and draws nothing (N-08)', async () => {
  const { dots } = renderTool('/theory/triads?root=C&q=sus4', { theory: guitar });
  await screen.findByRole('heading', { name: 'Triads & inversions' });
  expect(screen.getByRole('alert')).toHaveTextContent('Csus4 holds no major, minor, diminished or augmented triad (it has no 3rd), so none is shown. Pick a triad above.');
  expect(pressed('Triad')).toEqual([]);
  expect(dots()).toEqual([]);
  fireEvent.click(within(screen.getByRole('group', { name: 'Triad' })).getByRole('button', { name: 'maj' }));
  await waitFor(() => expect(dots().length).toBeGreaterThan(0));
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

test('triads: an unreadable chord in the link is an error naming what is shown instead (N-08)', async () => {
  renderTool('/theory/triads?root=D&chord=Xyz', { theory: guitar });
  await screen.findByRole('heading', { name: 'Triads & inversions' });
  expect(screen.getByRole('alert')).toHaveTextContent('Don\'t know "Xyz". The link\'s chord was ignored; showing D instead.');
  expect(pressed('Triad')).toEqual(['maj']);
});

test('triads: a chosen string set belongs to the tuning it was picked on; another instrument reads it as All', async () => {
  renderTool('/theory/triads?root=C');
  await screen.findByRole('heading', { name: 'Triads & inversions' });
  fireEvent.click(screen.getByRole('button', { name: 'A–D–G' })); // bass rows 2-1-0
  expect(pressed('Strings')).toEqual(['A–D–G']);
  const instrument = screen.getByRole('combobox', { name: 'Instrument' });
  fireEvent.change(instrument, { target: { value: 'guitar6' } }); // rows 2-1-0 are now G–B–E
  await waitFor(() => expect(screen.getByRole('button', { name: 'G–B–E' })).toBeInTheDocument());
  expect(pressed('Strings')).toEqual(['All']);
});
