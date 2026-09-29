import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';

import { chordInfo } from '../../music/spell';
import { parseSelection } from '../selection';
import { chordLinkProblem, selectedChord } from './ChordFinder';
import { renderTool } from './testing';

// Unmount first: leaving the tab flushes a pending save, which needs the fetch stub still in place.
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const guitar = { instrument: { kind: 'guitar' as const, strings: 6, tuning: ['E2', 'A2', 'D3', 'G3', 'B3', 'E4'], left_handed: false } };

const analysis = {
  schema_version: 1,
  key_candidates: [{ tonic: 'C', mode: 'major' as const, confidence: 0.9 }],
  beat_grid: { bpm: 120, beats: [0], downbeats: [0] },
  chords: [
    { bar: 0, start_sample: 0, end_sample: 1, chord: 'C:maj/3' },
    { bar: 1, start_sample: 1, end_sample: 2, chord: 'G:minmaj7' },
    { bar: 2, start_sample: 2, end_sample: 3, chord: 'A:min' },
  ],
};

const names = () => within(screen.getByRole('region', { name: 'Chord names' })).getAllByRole('button').map((b) => b.textContent);

test('name that chord: tapped notes, lowest is the bass', async () => {
  renderTool('/theory/name-that-chord');
  await screen.findByRole('heading', { name: 'Name that chord' });
  expect(screen.getByText('Tap at least three different notes.')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'E string, fret 3' })); // G
  fireEvent.click(screen.getByRole('button', { name: 'A string, open' })); // A
  fireEvent.click(screen.getByRole('button', { name: 'D string, fret 10' })); // C
  fireEvent.click(screen.getByRole('button', { name: 'G string, fret 9' })); // E
  expect(names()).toEqual(['Am7/G', 'C6/G']);
});

test('name that chord: the note row, and notes with no name', async () => {
  renderTool('/theory/name-that-chord');
  await screen.findByRole('heading', { name: 'Name that chord' });
  const row = screen.getByRole('group', { name: 'Notes' });
  for (const n of ['C', 'C♯/D♭', 'D']) fireEvent.click(within(row).getByRole('button', { name: n }));
  expect(screen.getByRole('region', { name: 'Chord names' })).toHaveTextContent('No chord name for these notes: C (R), C♯ (♭2), D (2).');
});

test('name that chord: on the note row the first note picked is the bass; picking it again removes it', async () => {
  renderTool('/theory/name-that-chord');
  await screen.findByRole('heading', { name: 'Name that chord' });
  const row = screen.getByRole('group', { name: 'Notes' });
  for (const n of ['E', 'G', 'C']) fireEvent.click(within(row).getByRole('button', { name: n }));
  expect(names()).toEqual(['C/E', 'Em♯5']);
  fireEvent.click(within(row).getByRole('button', { name: 'E' }));
  expect(screen.getByText('Tap at least three different notes.')).toBeInTheDocument();
});

test('name that chord: guitar strings sound one note each', async () => {
  const { dots } = renderTool('/theory/name-that-chord', { theory: guitar });
  await screen.findByRole('heading', { name: 'Name that chord' });
  fireEvent.click(screen.getByRole('button', { name: 'A string, fret 3' }));
  fireEvent.click(screen.getByRole('button', { name: 'A string, fret 5' }));
  expect(dots()).toEqual(['s4f5:D']);
});

test('name that chord: on a bass, one string can be tapped twice; tapping a note again removes it', async () => {
  const { dots } = renderTool('/theory/name-that-chord');
  await screen.findByRole('heading', { name: 'Name that chord' });
  fireEvent.click(screen.getByRole('button', { name: 'A string, fret 3' }));
  fireEvent.click(screen.getByRole('button', { name: 'A string, fret 5' }));
  expect(dots()).toEqual(['s2f3:C', 's2f5:D']);
  fireEvent.click(screen.getByRole('button', { name: 'A string, fret 3' }));
  expect(dots()).toEqual(['s2f5:D']);
});

test('name that chord: the two E strings of a guitar are different buttons', async () => {
  const { dots } = renderTool('/theory/name-that-chord', { theory: guitar });
  await screen.findByRole('heading', { name: 'Name that chord' });
  fireEvent.click(screen.getByRole('button', { name: 'E2 string, fret 3' })); // G2, string row 5
  fireEvent.click(screen.getByRole('button', { name: 'B string, open' })); // B
  fireEvent.click(screen.getByRole('button', { name: 'E4 string, fret 3' })); // G4, string row 0
  fireEvent.click(screen.getByRole('button', { name: 'D string, open' })); // D
  expect(dots().sort()).toEqual(['s0f3:G', 's1f0:B', 's3f0:D', 's5f3:G']);
  expect(names()[0]).toBe('G');
});

test('name that chord: changing the tuning clears the tapped notes and says so (N-08)', async () => {
  const { dots } = renderTool('/theory/name-that-chord');
  await screen.findByRole('heading', { name: 'Name that chord' });
  fireEvent.click(screen.getByRole('button', { name: 'A string, open' }));
  fireEvent.click(screen.getByRole('button', { name: 'D string, open' }));
  fireEvent.click(screen.getByRole('button', { name: 'G string, open' }));
  expect(dots()).toHaveLength(3);
  expect(screen.queryByRole('status')).toBeNull();
  fireEvent.change(screen.getByRole('combobox', { name: 'Tuning' }), { target: { value: 'bass4-drop-d' } });
  await waitFor(() => expect(dots()).toEqual([]));
  expect(screen.getByRole('status')).toHaveTextContent('Tapped notes were cleared because the instrument or tuning changed.');
  fireEvent.click(screen.getByRole('button', { name: 'A string, open' }));
  expect(dots()).toEqual(['s2f0:A']);
  expect(screen.queryByRole('status')).toBeNull();
});

test('name that chord: notes picked on the note row survive a tuning change', async () => {
  renderTool('/theory/name-that-chord');
  await screen.findByRole('heading', { name: 'Name that chord' });
  const row = screen.getByRole('group', { name: 'Notes' });
  for (const n of ['C', 'E', 'G']) fireEvent.click(within(row).getByRole('button', { name: n }));
  fireEvent.change(screen.getByRole('combobox', { name: 'Tuning' }), { target: { value: 'bass4-drop-d' } });
  await waitFor(() => expect(screen.getByRole('combobox', { name: 'Tuning' })).toHaveValue('bass4-drop-d'));
  expect(names()[0]).toBe('C');
  expect(screen.queryByRole('status')).toBeNull();
});

test("name that chord: the chosen song's chords load into the note row, slash bass first", async () => {
  renderTool('/theory/name-that-chord', { theory: { song_id: '01SONG' }, analysis });
  const chips = await screen.findByRole('group', { name: 'In Tightrope' });
  fireEvent.click(within(chips).getByRole('button', { name: 'C/E' }));
  expect(names()[0]).toBe('C/E');
  const row = screen.getByRole('group', { name: 'Notes' });
  expect(within(row).getAllByRole('button', { pressed: true }).map((b) => b.textContent)).toEqual(['C', 'E', 'G']);
});

test('name that chord: a song chord with a rarer quality loads and is named', async () => {
  renderTool('/theory/name-that-chord', { theory: { song_id: '01SONG' }, analysis });
  const chips = await screen.findByRole('group', { name: 'In Tightrope' });
  fireEvent.click(within(chips).getByRole('button', { name: 'GmMaj7' }));
  expect(screen.queryByRole('alert')).toBeNull();
  expect(names()[0]).toBe('GmMaj7');
});

test('name that chord: a name is a link that Chord finder reads back, with no alert', async () => {
  const { where } = renderTool('/theory/name-that-chord');
  await screen.findByRole('heading', { name: 'Name that chord' });
  const row = screen.getByRole('group', { name: 'Notes' });
  for (const n of ['E', 'G', 'C']) fireEvent.click(within(row).getByRole('button', { name: n }));
  const first = within(screen.getByRole('region', { name: 'Chord names' })).getAllByRole('button')[0]!;
  expect(first).toHaveAttribute('aria-pressed', 'false');
  fireEvent.click(first);
  expect(where()).toBe('/theory/name-that-chord?chord=C%2FE');
  expect(within(screen.getByRole('region', { name: 'Chord names' })).getAllByRole('button')[0]).toHaveAttribute('aria-pressed', 'true');
  // What Chord finder does with that URL:
  const sel = parseSelection(new URLSearchParams(where().split('?')[1]));
  expect(chordLinkProblem(sel)).toBeNull();
  expect(selectedChord(sel).symbol).toBe('C/E');
  fireEvent.click(screen.getByRole('link', { name: 'Chord finder' }));
  await screen.findByRole('heading', { name: 'Chord finder' });
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.getAllByText('C/E').length).toBeGreaterThan(0);
});

test('name that chord: every name it offers is readable by Chord finder', async () => {
  renderTool('/theory/name-that-chord');
  await screen.findByRole('heading', { name: 'Name that chord' });
  const row = screen.getByRole('group', { name: 'Notes' });
  for (const n of ['B♭', 'D', 'F', 'A']) fireEvent.click(within(row).getByRole('button', { name: n }));
  const shown = names();
  expect(shown.length).toBeGreaterThan(0);
  for (const n of shown) expect(chordInfo(n!.replace(/♭/g, 'b').replace(/♯/g, '#')).ok, n!).toBe(true);
  expect(shown[0]).toBe('B♭maj7');
});
