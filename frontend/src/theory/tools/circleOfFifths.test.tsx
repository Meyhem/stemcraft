import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';

import { renderTool } from './testing';

// Unmount first: leaving the tab flushes a pending save, which needs the fetch stub still in place.
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

// Independent of the app's spelling code: a note name's pitch class from letter + accidentals.
const LETTER = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 } as const;
function pc(name: string): number {
  const base = LETTER[name[0] as keyof typeof LETTER];
  const acc = [...name.slice(1)].reduce((n, ch) => n + (ch === '#' ? 1 : -1), 0);
  return (base + acc + 120) % 12;
}
const rootOf = (href: string) => new URL(href, 'http://x').searchParams.get('root') ?? 'C';

const url = (root: string, mode: 'major' | 'minor') => `/theory/circle-of-fifths?root=${encodeURIComponent(root)}&scale=${mode}`;

test('circle of fifths: key signature, relative key and neighbours', async () => {
  const { where } = renderTool('/theory/circle-of-fifths?root=D');
  await screen.findByRole('heading', { name: 'Circle of fifths' });
  expect(screen.getByText(/Key signature/)).toHaveTextContent('2 sharps · F♯ C♯');
  expect(screen.getByRole('link', { name: 'B minor' })).toHaveAttribute('href', '/theory/chords-in-key?root=B&scale=minor');
  fireEvent.click(within(screen.getByRole('group', { name: 'Circle of fifths' })).getByRole('button', { name: 'A major' }));
  expect(where()).toBe('/theory/circle-of-fifths?root=A');
});

test.each([
  ['A', 'minor', 'no sharps or flats', 'C major'],
  ['E', 'minor', '1 sharp · F♯', 'G major'],
  ['D', 'minor', '1 flat · B♭', 'F major'],
  ['F#', 'major', '6 sharps · F♯ C♯ G♯ D♯ A♯ E♯', 'D♯ minor'],
  ['Gb', 'major', '6 flats · B♭ E♭ A♭ D♭ G♭ C♭', 'E♭ minor'],
  ['C#', 'major', '7 sharps', 'A♯ minor'],
  ['C#', 'minor', '4 sharps · F♯ C♯ G♯ D♯', 'E major'],
] as const)('%s %s: signature "%s", relative %s', async (root, mode, signature, relative) => {
  renderTool(url(root, mode));
  await screen.findByRole('heading', { name: 'Circle of fifths' });
  expect(screen.getByText(/Key signature/)).toHaveTextContent(signature);
  expect(screen.getByText(/^Relative/)).toHaveTextContent(relative);
});

const SPELLINGS = ['C', 'C#', 'Db', 'D', 'D#', 'Eb', 'E', 'E#', 'Fb', 'F', 'F#', 'Gb', 'G', 'G#', 'Ab', 'A', 'A#', 'Bb', 'B', 'B#', 'Cb'];

// Every spelling a URL or a song's key can carry, in both modes: two neighbours a fifth away either
// side, the circle lights the same key, and the relative link is the relative key (N-08).
describe.each(['major', 'minor'] as const)('%s', (mode) => {
  test.each(SPELLINGS)('%s: neighbours, highlight and relative agree', async (root) => {
    const { where } = renderTool(url(root, mode));
    await screen.findByRole('heading', { name: 'Circle of fifths' });
    const circle = within(screen.getByRole('group', { name: 'Circle of fifths' }));

    // The circle lights exactly one key: the one the URL names, whatever its spelling.
    const lit = circle.getAllByRole('button', { pressed: true });
    expect(lit).toHaveLength(1);
    expect(lit[0]!.getAttribute('aria-label')).toMatch(new RegExp(` ${mode}$`));

    const rel = screen.getByRole('link', { name: new RegExp(`^[A-G][♯♭𝄪𝄫]* ${mode === 'major' ? 'minor' : 'major'}$`) });
    const relRoot = rootOf(rel.getAttribute('href')!);
    expect((pc(relRoot) - pc(root) + 12) % 12).toBe(mode === 'major' ? 9 : 3);

    const found = screen.getAllByRole('button', { name: /a fifth (up|down)$/ });
    expect(found.map((b) => b.getAttribute('aria-label')?.match(/(up|down)$/)![1])).toEqual(['down', 'up']);
    expect(found).toHaveLength(2);
    cleanup();

    // Click each in a fresh render; the key lands a fifth down (5 semitones) or up (7), same mode.
    for (const [n, semitones] of [[0, 5], [1, 7]] as const) {
      const { where } = renderTool(url(root, mode));
      await screen.findByRole('heading', { name: 'Circle of fifths' });
      fireEvent.click(screen.getAllByRole('button', { name: /a fifth (up|down)$/ })[n]!);
      const next = new URL(where(), 'http://x');
      expect((pc(next.searchParams.get('root') ?? 'C') - pc(root) + 12) % 12).toBe(semitones);
      // The mode is kept: neighbours of A minor are minor keys.
      expect(next.searchParams.get('scale') ?? 'major').toBe(mode);
      cleanup();
    }
  });
});

test('a key that would need more than seven sharps or flats is shown by its usual spelling, and says so', async () => {
  renderTool(url('D#', 'major'));
  await screen.findByRole('heading', { name: 'Circle of fifths' });
  expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('E♭ major');
  expect(screen.getByText(/Key signature/)).toHaveTextContent('3 flats · B♭ E♭ A♭');
  expect(screen.getByText(/D♯ major would need 9 sharps/)).toHaveTextContent('shown as E♭ major');
  expect(screen.getByRole('link', { name: 'C minor' })).toBeInTheDocument();
  const circle = within(screen.getByRole('group', { name: 'Circle of fifths' }));
  expect(circle.getByRole('button', { name: 'E♭ major' })).toHaveAttribute('aria-pressed', 'true');
});

test('a real key keeps the spelling it was given, with no note', async () => {
  renderTool(url('C#', 'major'));
  await screen.findByRole('heading', { name: 'Circle of fifths' });
  expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('C♯ major');
  expect(screen.queryByText(/would need/)).toBeNull();
});

test('the chords are the key\'s own seven, natural minor for a minor key, and none is called borrowed', async () => {
  renderTool(url('A', 'minor'));
  await screen.findByRole('heading', { name: 'Circle of fifths' });
  const line = screen.getByText(/^Chords:/);
  expect(line).toHaveTextContent('i Am · ii° Bdim · III C · iv Dm · v Em · VI F · VII G');
  expect(line.textContent).not.toMatch(/borrowed/i);
  expect(within(line).getByRole('link', { name: 'open in Chords in a key' })).toHaveAttribute(
    'href',
    '/theory/chords-in-key?root=A&scale=minor',
  );
});

test('all 24 keys are buttons with their own name, and the neighbours do not repeat one', async () => {
  renderTool('/theory/circle-of-fifths?root=G');
  await screen.findByRole('heading', { name: 'Circle of fifths' });
  const circle = within(screen.getByRole('group', { name: 'Circle of fifths' }));
  const names = circle.getAllByRole('button').map((b) => b.getAttribute('aria-label'));
  expect(names).toHaveLength(24);
  expect(new Set(names).size).toBe(24);
  // A global lookup finds one button per key, so a neighbour chip does not shadow the circle's key.
  expect(screen.getAllByRole('button', { name: 'D major' })).toHaveLength(1);
  expect(screen.getAllByRole('button', { name: 'C major' })).toHaveLength(1);
});

test('the circle is keyboard operable', async () => {
  const { where } = renderTool('/theory/circle-of-fifths?root=C');
  await screen.findByRole('heading', { name: 'Circle of fifths' });
  fireEvent.keyDown(within(screen.getByRole('group', { name: 'Circle of fifths' })).getByRole('button', { name: 'E♭ major' }), { key: 'Enter' });
  expect(where()).toBe('/theory/circle-of-fifths?root=Eb');
});
