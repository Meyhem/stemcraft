import { fireEvent, screen, within } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';

import { renderTool } from './testing';

afterEach(() => vi.unstubAllGlobals());

const analysis = {
  schema_version: 1,
  key_candidates: [{ tonic: 'G', mode: 'minor' as const, confidence: 0.9 }],
  beat_grid: { bpm: 120, beats: [0], downbeats: [0] },
  chords: [
    { bar: 0, start_sample: 0, end_sample: 1, chord: 'G:min' },
    { bar: 1, start_sample: 1, end_sample: 2, chord: 'A#:hdim7' },
    { bar: 2, start_sample: 2, end_sample: 3, chord: 'G:min' },
  ],
};

test('chord finder: root + quality, notes, intervals and where it is diatonic', async () => {
  const { dots, where } = renderTool('/theory/chord-finder?root=A&q=m7');
  await screen.findByRole('heading', { name: 'Chord finder' });
  expect(screen.getByText('A minor seventh')).toBeInTheDocument();
  expect(dots()).toContain('s3f5:R');
  expect(dots()).toContain('s3f3:♭7');
  expect(screen.getByText(/It is the/)).toHaveTextContent('vi7 in C major, iii7 in F major, ii7 in G major');
  fireEvent.click(screen.getByRole('button', { name: 'maj7' }));
  expect(where()).toBe('/theory/chord-finder?root=A&q=maj7');
});

test('chord finder: a typed chord is shown; an unreadable one is refused and the last stays', async () => {
  const { where } = renderTool('/theory/chord-finder');
  await screen.findByRole('heading', { name: 'Chord finder' });
  fireEvent.change(screen.getByRole('textbox', { name: 'Type a chord' }), { target: { value: 'f♯m7♭5' } });
  fireEvent.click(screen.getByRole('button', { name: 'Show' }));
  expect(where()).toBe('/theory/chord-finder?root=F%23&chord=F%23m7b5');
  expect(screen.getAllByText('F♯m7♭5').length).toBeGreaterThan(0);
  fireEvent.change(screen.getByRole('textbox', { name: 'Type a chord' }), { target: { value: 'Cmaj13#11b9' } });
  fireEvent.click(screen.getByRole('button', { name: 'Show' }));
  expect(screen.getByRole('alert')).toHaveTextContent('Don\'t know "Cmaj13#11b9"');
  expect(where()).toBe('/theory/chord-finder?root=F%23&chord=F%23m7b5');
});

test("chord finder: the chosen song's chords are chips", async () => {
  const { where } = renderTool('/theory/chord-finder', { theory: { song_id: '01SONG' }, analysis });
  const row = await screen.findByRole('group', { name: 'In Tightrope' });
  expect(within(row).getAllByRole('button').map((b) => b.textContent)).toEqual(['Gm', 'B♭m7♭5']);
  fireEvent.click(within(row).getByRole('button', { name: 'B♭m7♭5' }));
  expect(where()).toBe('/theory/chord-finder?chord=Bbm7b5');
});
