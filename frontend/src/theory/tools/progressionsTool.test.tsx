import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';

import { numeralInKey } from '../../music/harmony';
import { progressionChords, PROGRESSIONS } from '../../music/progressions';
import { chordInfo, pcOf } from '../../music/spell';
import { barLabel, songProblem } from './Progressions';
import { renderTool } from './testing';

// Unmount first: leaving the tab flushes a pending save, which needs the fetch stub still in place.
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const analysisOf = (chords: string[], key = { tonic: 'G', mode: 'minor' as const, confidence: 1 }) => ({
  schema_version: 1,
  key_candidates: [key],
  beat_grid: { bpm: 120, beats: [0], downbeats: [0] },
  chords: chords.map((chord, bar) => ({ bar, start_sample: bar, end_sample: bar + 1, chord })),
});
const songMinor = { theory: { song_id: '01SONG' }, analysis: analysisOf(['G:min', 'C:maj', 'D:7', 'D:sus4']) };

const barsOf = () => within(screen.getByRole('list', { name: 'Bars' })).getAllByRole('button');
const numeralsShown = () => within(screen.getByRole('list', { name: 'Bars' })).getAllByRole('listitem').map((li) => li.querySelector('span')!.textContent);

test('progressions: transposed to the key and stepped through', async () => {
  const { dots } = renderTool('/theory/progressions?root=G');
  await screen.findByRole('heading', { name: 'Progressions' });
  expect(barsOf().map((b) => b.textContent)).toEqual(['IG', 'VD', 'viEm', 'IVC']);
  expect(dots()).toContain('s0f0:R');
  fireEvent.click(screen.getByRole('button', { name: 'Next bar' }));
  expect(barsOf()[1]).toHaveAttribute('aria-pressed', 'true');
  expect(dots()).toContain('s1f0:R');
  expect(dots()).not.toContain('s0f0:R');
});

test('progressions: the neck follows the selected bar, and stepping wraps both ways', async () => {
  const { dots } = renderTool('/theory/progressions?root=G');
  await screen.findByRole('heading', { name: 'Progressions' });
  const first = dots();
  fireEvent.click(screen.getByRole('button', { name: 'Next bar' }));
  fireEvent.click(screen.getByRole('button', { name: 'Next bar' }));
  expect(barsOf()[2]).toHaveAttribute('aria-pressed', 'true'); // Em: its root is the open E string
  expect(dots()).toContain('s3f0:R');
  expect(dots()).not.toEqual(first);
  fireEvent.click(screen.getByRole('button', { name: 'Next bar' }));
  fireEvent.click(screen.getByRole('button', { name: 'Next bar' }));
  expect(barsOf()[0]).toHaveAttribute('aria-pressed', 'true'); // wrapped
  expect(dots()).toEqual(first);
  fireEvent.click(screen.getByRole('button', { name: 'Previous bar' }));
  expect(barsOf()[3]).toHaveAttribute('aria-pressed', 'true'); // wrapped back: C, root on the A string
  expect(dots()).toContain('s2f3:R');
});

test('progressions: every progression is listed, and shows the numerals it defines', async () => {
  renderTool('/theory/progressions?root=A');
  await screen.findByRole('heading', { name: 'Progressions' });
  const row = screen.getByRole('group', { name: 'Progression' });
  expect(within(row).getAllByRole('button')).toHaveLength(PROGRESSIONS.length);
  for (const def of PROGRESSIONS) {
    fireEvent.click(within(row).getByRole('button', { name: def.label }));
    expect(numeralsShown()).toEqual(def.numerals);
  }
});

// Semitones above the tonic and chord tones, written out here so the check does not lean on progressions.ts.
const DEGREE: Record<string, number> = { I: 0, II: 2, III: 4, IV: 5, V: 7, VI: 9, VII: 11 };
const TONES: Record<string, number[]> = { '': [0, 4, 7], m: [0, 3, 7], '7': [0, 4, 7, 10], m7: [0, 3, 7, 10], maj7: [0, 4, 7, 11], m7b5: [0, 3, 6, 10] };
function expected(numeral: string): { offset: number; tones: number[] } {
  const m = /^(b|#)?([ivIV]+)(ø7|maj7|7)?$/.exec(numeral)!;
  const roman = m[2]!;
  const upper = roman === roman.toUpperCase();
  const offset = DEGREE[roman.toUpperCase()]! + (m[1] === 'b' ? -1 : m[1] === '#' ? 1 : 0);
  const quality = m[3] === 'ø7' ? 'm7b5' : m[3] === 'maj7' ? 'maj7' : m[3] === '7' ? (upper ? '7' : 'm7') : upper ? '' : 'm';
  return { offset, tones: TONES[quality]! };
}

test('progressions: 15 progressions in all 12 keys land on the right roots and chord tones', () => {
  expect(PROGRESSIONS).toHaveLength(15);
  for (const def of PROGRESSIONS) {
    for (let tonicPc = 0; tonicPc < 12; tonicPc++) {
      const tonic = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'][tonicPc]!;
      const chords = progressionChords(def, tonic);
      expect(chords).toHaveLength(def.numerals.length);
      chords.forEach((symbol, i) => {
        const info = chordInfo(symbol);
        if (!info.ok) throw new Error(`${def.id} in ${tonic}: ${info.reason}`);
        const want = expected(def.numerals[i]!);
        const rootPc = (tonicPc + want.offset + 12) % 12;
        expect(pcOf(info.chord.root), `${def.id} ${def.numerals[i]} in ${tonic}: ${symbol}`).toBe(rootPc);
        expect(info.chord.notes.map((n) => n.pc).sort((a, b) => a - b)).toEqual(want.tones.map((t) => (rootPc + t) % 12).sort((a, b) => a - b));
      });
    }
  }
});

test("progressions: this song's chart with numerals, borrowed chords labelled, sus chords read", async () => {
  renderTool('/theory/progressions?root=G&scale=minor', songMinor);
  fireEvent.click(await screen.findByRole('button', { name: 'This song · Tightrope' }));
  expect(barsOf().map((b) => b.textContent)).toEqual(['iGm', 'borrowedC', 'VD7', 'vsus4Dsus4']);
  expect(screen.getByRole('button', { name: 'This song · Tightrope' })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByText(/outside the key/)).toBeInTheDocument();
});

test('progressions: picking a key while "This song" is active keeps the mode and recomputes the numerals', async () => {
  const { where } = renderTool('/theory/progressions?root=G&scale=minor', songMinor);
  fireEvent.click(await screen.findByRole('button', { name: 'This song · Tightrope' }));
  fireEvent.click(within(screen.getByRole('group', { name: 'Key' })).getByRole('button', { name: 'D' }));
  expect(where()).toContain('root=D');
  expect(where()).toContain('scale=minor');
  expect(where()).not.toContain('mode=major');
  expect(screen.getByRole('button', { name: 'This song · Tightrope' })).toHaveAttribute('aria-pressed', 'true');
  // Gm is iv in D minor, C major is its VII, D7 (a major tonic chord with a seventh) is outside the key, Dsus4 is isus4.
  expect(numeralsShown()).toEqual(['iv', 'VII', 'borrowed', 'isus4']);
});

test('progressions: a song with one chord has nothing to step to', async () => {
  renderTool('/theory/progressions?root=G&scale=minor', { theory: { song_id: '01SONG' }, analysis: analysisOf(['G:min', 'G:min']) });
  fireEvent.click(await screen.findByRole('button', { name: 'This song · Tightrope' }));
  expect(barsOf()).toHaveLength(1);
  expect(screen.getByRole('button', { name: 'Next bar' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Previous bar' })).toBeDisabled();
});

test('progressions: "This song" stays pressed and says why when the song goes away', async () => {
  renderTool('/theory/progressions?root=G&scale=minor', songMinor);
  fireEvent.click(await screen.findByRole('button', { name: 'This song · Tightrope' }));
  fireEvent.change(screen.getByRole('combobox', { name: 'Song' }), { target: { value: '' } });
  expect(await screen.findByRole('status')).toHaveTextContent('No song is chosen');
  expect(screen.getByRole('button', { name: 'This song' })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.queryByRole('list', { name: 'Bars' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Next bar' })).not.toBeInTheDocument();
  expect(screen.queryByRole('img')).not.toBeInTheDocument();
  // Another progression brings the chart back.
  fireEvent.click(screen.getByRole('button', { name: 'I–V–vi–IV' }));
  expect(barsOf()).toHaveLength(4);
});

test('songProblem: every state that cannot show a chart says so', () => {
  expect(songProblem({ state: 'none' })).toMatchObject({ alert: false, text: expect.stringContaining('No song is chosen') });
  expect(songProblem({ state: 'missing', songId: 'x' })).toMatchObject({ alert: true, text: expect.stringContaining('no longer exists') });
  expect(songProblem({ state: 'unanalysed', title: 'T' })).toMatchObject({ alert: true, text: expect.stringContaining('no analysis') });
  expect(songProblem({ state: 'error', title: 'T', message: 'boom' })).toEqual({ alert: true, text: 'boom' });
  expect(songProblem({ state: 'loading', title: 'T' })).toMatchObject({ alert: false, text: expect.stringContaining('Loading') });
  expect(songProblem({ state: 'ready', title: 'T', candidates: [], sequence: [], distinct: [] })).toMatchObject({ text: expect.stringContaining('No chords were found') });
  expect(songProblem({ state: 'ready', title: 'T', candidates: [], sequence: ['C'], distinct: ['C'] })).toBeNull();
});

test('barLabel: a numeral, borrowed (outside the key), or unreadable with its reason; never borrowed for what cannot be read', () => {
  expect(barLabel('G', 'minor', 'Gm')).toEqual({ kind: 'numeral', text: 'i' });
  expect(barLabel('G', 'minor', 'D7')).toEqual({ kind: 'numeral', text: 'V' });
  expect(barLabel('G', 'minor', 'Dsus4')).toEqual({ kind: 'numeral', text: 'vsus4' });
  expect(barLabel('G', 'minor', 'C')).toEqual({ kind: 'borrowed', text: 'borrowed' });
  expect(numeralInKey('G', 'minor', 'C')).toBeNull();
  expect(barLabel('G', 'minor', 'Xyz')).toEqual({ kind: 'unreadable', text: 'unreadable', reason: expect.stringContaining('Xyz') });
});
