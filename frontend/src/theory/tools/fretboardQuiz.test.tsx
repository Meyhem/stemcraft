import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import { DEFAULT_THEORY, type QuizAnswer, type TheoryDoc } from '../../api/client';
import { positionAt, positionsOf, type Cell } from '../../music/positions';
import { DEFAULT_INSTRUMENT, neckFrets } from '../../music/tuning';
import { Theory } from '../../screens/Theory';
import { forgetUnsavedTheory } from '../TheoryDoc';
import { HISTORY_CAP, seeds } from '../useQuizHistory';
import { renderFlaky, renderTool } from './testing';

// Unmount first: leaving the tab flushes a pending save, which needs the fetch stub still in place.
afterEach(() => {
  cleanup();
  forgetUnsavedTheory(); // a tab left with an unsaved document keeps it for the next one; no test may leak it
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// The same questions every run: nothing here depends on luck.
beforeEach(() => {
  vi.spyOn(seeds, 'next').mockReturnValue(20260929);
});

const KEYS = ['C', 'C♯/D♭', 'D', 'E♭', 'E', 'F', 'F♯/G♭', 'G', 'A♭', 'A', 'B♭', 'B'];
const DIGITS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '-', '='];
const STRING = ['G', 'D', 'A', 'E']; // rows of the default bass, highest first
const MAX_FRET = neckFrets(DEFAULT_INSTRUMENT);

const fb = (settings: Partial<TheoryDoc['quiz']['settings']['fretboard']> = {}, extra: Partial<TheoryDoc['quiz']> = {}): Partial<TheoryDoc> => ({
  last_tool: 'fretboard-quiz', // so opening the tool does not itself queue a save
  quiz: { ...DEFAULT_THEORY.quiz, ...extra, settings: { ...DEFAULT_THEORY.quiz.settings, fretboard: { ...DEFAULT_THEORY.quiz.settings.fretboard, ...settings } } },
});
const nameNote = fb({ mode: 'name-note' });

function cellOf(container: HTMLElement, marker: string): Cell {
  const [, s, f] = /^s(\d+)f(\d+)$/.exec(container.querySelector(`[data-marker="${marker}"]`)!.getAttribute('data-cell')!)!;
  return { string: Number(s), fret: Number(f) };
}
const questionPc = (container: HTMLElement) => positionAt(DEFAULT_INSTRUMENT, cellOf(container, 'question')).pc;
const questionCell = (container: HTMLElement) => container.querySelector('[data-marker="question"]')!.getAttribute('data-cell')!;
const answers = () => within(screen.getByRole('group', { name: 'Answer' }));
const answerRight = (container: HTMLElement) => fireEvent.click(answers().getByRole('button', { name: KEYS[questionPc(container)]! }));
const answerWrong = (container: HTMLElement) => fireEvent.click(answers().getByRole('button', { name: KEYS[(questionPc(container) + 1) % 12]! }));
const tapCell = (c: Cell) => fireEvent.click(screen.getByRole('button', { name: `${STRING[c.string]} string, ${c.fret === 0 ? 'open' : `fret ${c.fret}`}` }));
/** How many answers theory.json has been sent: each answer is its own save. */
const saved = (puts: TheoryDoc[]) => puts.at(-1)?.quiz.history.length ?? 0;
const stored = (n: number, item = 's0f0'): QuizAnswer[] =>
  Array.from({ length: n }, (_, i) => ({ quiz: 'fretboard', mode: 'name-note', item: `${item}`, correct: i % 2 === 0, at: `2026-01-01T00:00:${String(i % 60).padStart(2, '0')}Z` }));

// ---------------------------------------------------------------- name the note

test('name the note: a wrong answer is explained and the question stays', async () => {
  const { container, puts } = renderTool('/theory/fretboard-quiz', { theory: nameNote });
  await screen.findByText('Name this note');
  const pc = questionPc(container);
  fireEvent.click(answers().getByRole('button', { name: KEYS[(pc + 1) % 12]! }));
  expect(screen.getByText(/✕ not/)).toBeInTheDocument();
  fireEvent.click(answers().getByRole('button', { name: KEYS[pc]! }));
  expect(screen.queryByText(/✕ not/)).toBeNull();
});

test('name the note answers from the keyboard, 1–9 0 - = for C … B', async () => {
  const { container, puts } = renderTool('/theory/fretboard-quiz', { theory: nameNote });
  await screen.findByText('Name this note');
  const pc = questionPc(container);
  fireEvent.keyDown(window, { key: DIGITS[pc] });
  await waitFor(() => expect(saved(puts)).toBe(1));
});

test('every one of the twelve keys answers its own note', async () => {
  const { container, puts } = renderTool('/theory/fretboard-quiz', { theory: nameNote });
  await screen.findByText('Name this note');
  for (let i = 0; i < 12; i++) {
    const pc = questionPc(container);
    // The key for another note is wrong; the key for this one is right.
    fireEvent.keyDown(window, { key: DIGITS[(pc + 1) % 12] });
    expect(screen.getByText(/✕ not/)).toBeInTheDocument();
    fireEvent.keyDown(window, { key: DIGITS[pc] });
  }
  await waitFor(() => expect(saved(puts)).toBe(12));
});

test('keys are ignored with a modifier, when held down, and while typing in a field', async () => {
  const { container, puts } = renderTool('/theory/fretboard-quiz', { theory: nameNote });
  await screen.findByText('Name this note');
  const key = DIGITS[questionPc(container)]!;
  fireEvent.keyDown(window, { key, ctrlKey: true });
  fireEvent.keyDown(window, { key, metaKey: true });
  fireEvent.keyDown(window, { key, altKey: true });
  fireEvent.keyDown(window, { key, repeat: true });
  const field = document.body.appendChild(document.createElement('input'));
  fireEvent.keyDown(field, { key });
  fireEvent.keyDown(screen.getByLabelText('Instrument'), { key });
  expect(saved(puts)).toBe(0);
  fireEvent.keyDown(window, { key });
  await waitFor(() => expect(saved(puts)).toBe(1));
  field.remove();
});

test('a wrong tap next to the note says how far off it is in words', async () => {
  renderTool('/theory/fretboard-quiz', { theory: fb({ strings: [3], frets: [0, 5] }) }); // E string: E F G A at 0 1 3 5
  const prompt = await screen.findByText(/^Find every /);
  const fret = { E: 0, F: 1, G: 3, A: 5 }[prompt.textContent!.replace('Find every ', '') as 'E' | 'F' | 'G' | 'A'];
  const up = fret + 1 <= 5;
  tapCell({ string: 3, fret: up ? fret + 1 : fret - 1 });
  expect(screen.getByRole('status')).toHaveTextContent(`one fret too ${up ? 'high' : 'low'}`);
});

test('a digit typed with Shift answers too: AZERTY and Czech/Slovak keyboards type digits that way', async () => {
  const { container, puts } = renderTool('/theory/fretboard-quiz', { theory: nameNote });
  await screen.findByText('Name this note');
  fireEvent.keyDown(window, { key: DIGITS[questionPc(container)]!, shiftKey: true });
  await waitFor(() => expect(saved(puts)).toBe(1));
  fireEvent.keyDown(window, { key: '_', shiftKey: true }); // Shift+- on QWERTY is not the B key
  fireEvent.keyDown(window, { key: '+', shiftKey: true });
  await waitFor(() => expect(saved(puts)).toBe(1));
});

test('the keyboard listener is removed when the quiz goes away, and stays off in other modes', async () => {
  const add = vi.spyOn(window, 'addEventListener');
  const remove = vi.spyOn(window, 'removeEventListener');
  const { unmount, puts } = renderTool('/theory/fretboard-quiz', { theory: nameNote });
  await screen.findByText('Name this note');
  const added = add.mock.calls.filter((c) => c[0] === 'keydown').map((c) => c[1]);
  expect(added.length).toBeGreaterThan(0);
  unmount();
  for (const listener of added) expect(remove.mock.calls.some((c) => c[0] === 'keydown' && c[1] === listener)).toBe(true);
  fireEvent.keyDown(window, { key: '1' });
  expect(puts).toHaveLength(0);

  add.mockClear();
  const findNote = renderTool('/theory/fretboard-quiz', { theory: fb() }); // find-note: digits mean nothing
  await screen.findByText(/^Find every /);
  fireEvent.keyDown(window, { key: '1' });
  expect(saved(findNote.puts)).toBe(0);
});

// ---------------------------------------------------------------- the other modes

test('find the note: wrong taps are marked, every target must be found', async () => {
  const { container, puts } = renderTool('/theory/fretboard-quiz', { theory: fb() });
  const prompt = await screen.findByText(/^Find every /);
  const pc = KEYS.findIndex((k) => k.split('/').some((n) => prompt.textContent === `Find every ${n}`));
  const targets = positionsOf(DEFAULT_INSTRUMENT, new Set([pc]), 0, 12);
  const wrongCell = positionsOf(DEFAULT_INSTRUMENT, new Set([(pc + 2) % 12]), 0, 12)[0]!;
  tapCell(wrongCell);
  expect(container.querySelector('[data-marker="wrong"]')).not.toBeNull();
  expect(screen.getByText(/✕ that's/)).toBeInTheDocument();
  tapCell(wrongCell); // the same wrong cell twice is still one mark
  expect(container.querySelectorAll('[data-marker="wrong"]')).toHaveLength(1);
  for (const t of targets) tapCell(t);
  await waitFor(() => expect(saved(puts)).toBe(1));
});

test('find the note: found notes count up, and tapping one again does nothing', async () => {
  const { container, puts } = renderTool('/theory/fretboard-quiz', { theory: fb() });
  const prompt = await screen.findByText(/^Find every /);
  const pc = KEYS.findIndex((k) => k.split('/').some((n) => prompt.textContent === `Find every ${n}`));
  const targets = positionsOf(DEFAULT_INSTRUMENT, new Set([pc]), 0, 12);
  tapCell(targets[0]!);
  tapCell(targets[0]!);
  expect(container.querySelectorAll('[data-marker="ok"]')).toHaveLength(1);
  expect(screen.getByText(`1 found · ${targets.length - 1} to go · tap the neck`)).toBeInTheDocument();
  expect(container.querySelector('[data-marker="wrong"]')).toBeNull();
  for (const t of targets.slice(1)) tapCell(t);
  await waitFor(() => expect(saved(puts)).toBe(1));
});

test('find the note: the right note outside the practised strings is refused with the reason', async () => {
  const { puts } = renderTool('/theory/fretboard-quiz', { theory: fb({ strings: [3, 2] }) }); // E and A only
  const prompt = await screen.findByText(/^Find every /);
  const pc = KEYS.findIndex((k) => k.split('/').some((n) => prompt.textContent === `Find every ${n}`));
  tapCell(positionsOf(DEFAULT_INSTRUMENT, new Set([pc]), 0, 12).find((p) => p.string === 0)!); // a G-string cell
  expect(screen.getByText(/but not in the strings and frets you're practising/)).toBeInTheDocument();
  expect(saved(puts)).toBe(0);
});

const INTERVAL = { 'minor 3rd': 3, 'major 3rd': 4, '4th': 5, '5th': 7, '♭7': 10, octave: 0 } as const;

test('find the interval: any octave of the answer counts, the start note is marked as such, a wrong tap says what it was', async () => {
  const { container, puts } = renderTool('/theory/fretboard-quiz', { theory: fb({ mode: 'find-interval' }) });
  const prompt = await screen.findByText(/^Tap the .* above this note$/);
  const label = /^Tap the (.*) above this note$/.exec(prompt.textContent!)![1] as keyof typeof INTERVAL;
  const origin = cellOf(container, 'accent');
  const startPc = positionAt(DEFAULT_INSTRUMENT, origin).pc;
  const answerPc = (startPc + INTERVAL[label]) % 12;
  expect(screen.getByText('tap the neck · any octave counts')).toBeInTheDocument();

  // Tapping the start note is a miss without a second marker on top of it.
  tapCell(origin);
  expect(screen.getByText("✕ that's the note you started from")).toBeInTheDocument();
  expect(container.querySelectorAll(`[data-cell="s${origin.string}f${origin.fret}"]`)).toHaveLength(1);

  const wrong = positionsOf(DEFAULT_INSTRUMENT, new Set([(answerPc + 1) % 12]), 0, 12).find((p) => p.pc !== startPc)!;
  tapCell(wrong);
  expect(screen.getByText(/^✕ that's .*, an? .* above$/)).toBeInTheDocument();
  expect(container.querySelectorAll('[data-marker="wrong"]')).toHaveLength(1);
  expect(saved(puts)).toBe(0);

  // Any cell holding the answer, not just the nearest, finishes it.
  const answer = positionsOf(DEFAULT_INSTRUMENT, new Set([answerPc]), 0, 12).filter((p) => p.string !== origin.string || p.fret !== origin.fret);
  tapCell(answer[answer.length - 1]!);
  await waitFor(() => expect(saved(puts)).toBe(1));
  expect(screen.getByText(/Any octave counts/)).toBeInTheDocument();
});

test('find the interval: the answer in a string the player is not practising is refused, not accepted', async () => {
  const { container, puts } = renderTool('/theory/fretboard-quiz', { theory: fb({ mode: 'find-interval', strings: [3, 2] }) });
  const prompt = await screen.findByText(/^Tap the .* above this note$/);
  const label = /^Tap the (.*) above this note$/.exec(prompt.textContent!)![1] as keyof typeof INTERVAL;
  const origin = cellOf(container, 'accent');
  const answerPc = (positionAt(DEFAULT_INSTRUMENT, origin).pc + INTERVAL[label]) % 12;
  tapCell(positionsOf(DEFAULT_INSTRUMENT, new Set([answerPc]), 0, 12).find((p) => p.string === 0)!);
  expect(screen.getByText(/but not in the strings and frets you're practising/)).toBeInTheDocument();
  expect(saved(puts)).toBe(0);
});

const CHORD_TONES: Record<string, number[]> = {
  C: [0, 4, 7], Cm: [0, 3, 7], D: [2, 6, 9], Dm: [2, 5, 9], E: [4, 8, 11], Em: [4, 7, 11], F: [5, 9, 0], Fm: [5, 8, 0],
  G: [7, 11, 2], Gm: [7, 10, 2], A: [9, 1, 4], Am: [9, 0, 4], B: [11, 3, 6], Bm: [11, 2, 6],
};

test('spell the chord: only tones inside the outlined window count; a tone outside is refused with the reason', async () => {
  const { puts } = renderTool('/theory/fretboard-quiz', { theory: fb({ mode: 'spell-chord' }) });
  const prompt = await screen.findByText(/^Tap the notes of /);
  const [, symbol, one, lo, hi] = /^Tap the notes of ([A-G]m?) in (?:fret (\d+)|frets (\d+)–(\d+))$/.exec(prompt.textContent!)!;
  const [from, to] = one ? [Number(one), Number(one)] : [Number(lo), Number(hi)];
  const tones = new Set(CHORD_TONES[symbol!]);
  const inside = positionsOf(DEFAULT_INSTRUMENT, tones, from, to);
  const notTone = positionsOf(DEFAULT_INSTRUMENT, new Set([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].filter((p) => !tones.has(p))), from, to)[0]!;
  const outside = positionsOf(DEFAULT_INSTRUMENT, tones, 0, 12).find((p) => p.fret < from || p.fret > to)!;

  tapCell(notTone);
  expect(screen.getByText(new RegExp(`is not in ${symbol}`))).toBeInTheDocument();
  tapCell(outside); // a Dm tone at a practised fret, but outside the outline
  expect(screen.getByText(new RegExp(`is in ${symbol}, but outside the outlined frets$`))).toBeInTheDocument();
  expect(saved(puts)).toBe(0);
  for (const t of inside) tapCell(t);
  await waitFor(() => expect(saved(puts)).toBe(1));
});

test('spell the chord: a tone on a string that is not practised is refused as such, not as "outlined"', async () => {
  renderTool('/theory/fretboard-quiz', { theory: fb({ mode: 'spell-chord', frets: [0, 5], strings: [3, 2] }) }); // E and A strings, frets 0–5
  const prompt = await screen.findByText(/^Tap the notes of /);
  const [, symbol] = /^Tap the notes of ([A-G]m?) in /.exec(prompt.textContent!)!;
  const tones = new Set(CHORD_TONES[symbol!]);
  tapCell(positionsOf(DEFAULT_INSTRUMENT, tones, 0, 5).find((p) => p.string < 2)!); // in the frets, on a string not practised
  expect(screen.getByText(/but not in the strings and frets you're practising$/)).toBeInTheDocument();
  expect(screen.queryByText(/outside the outlined/)).toBeNull();
});

// ---------------------------------------------------------------- rounds

test('each answer is saved as it is given, first try only, with no timing', async () => {
  const { container, puts } = renderTool('/theory/fretboard-quiz', { theory: nameNote });
  await screen.findByText('Name this note');
  answerWrong(container);
  answerRight(container);
  await waitFor(() => expect(puts).toHaveLength(1));
  answerRight(container);
  await waitFor(() => expect(puts).toHaveLength(2));
  const history = puts[1]!.quiz.history;
  expect(history.map((a: QuizAnswer) => a.correct)).toEqual([false, true]);
  expect(history.every((a: QuizAnswer) => !('ms' in a) && !('text' in a))).toBe(true);
});

test('there is no score, round counter, summary or weak-spot panel', async () => {
  const { container, puts } = renderTool('/theory/fretboard-quiz', { theory: nameNote });
  await screen.findByText('Name this note');
  for (let i = 0; i < 25; i++) answerRight(container);
  expect(screen.getByText('Name this note')).toBeInTheDocument(); // it simply goes on
  expect(screen.queryByText(/first try|round \d|weak|streak|score|Practise these/i)).toBeNull();
  expect(container.querySelector('[data-heat]')).toBeNull();
});

test('Start fresh asks first, then forgets what was practised', async () => {
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
  const { puts } = renderTool('/theory/fretboard-quiz', { theory: fb({ mode: 'name-note' }, { history: stored(3) }) });
  await screen.findByText('Name this note');
  fireEvent.click(screen.getByRole('button', { name: /start fresh/i }));
  expect(confirm).toHaveBeenCalledTimes(1);
  expect(puts).toHaveLength(0);
  confirm.mockReturnValue(true);
  fireEvent.click(screen.getByRole('button', { name: /start fresh/i }));
  await waitFor(() => expect(puts.at(-1)?.quiz.history).toEqual([]));
});

test('never more than the server keeps: the oldest answers are trimmed before sending', async () => {
  const { container, puts } = renderTool('/theory/fretboard-quiz', { theory: fb({ mode: 'name-note' }, { history: stored(HISTORY_CAP) }) });
  await screen.findByText('Name this note');
  answerRight(container);
  await waitFor(() => expect(puts).toHaveLength(1));
  expect(puts[0]!.quiz.history).toHaveLength(HISTORY_CAP);
  expect(puts[0]!.quiz.history.at(-1)!.correct).toBe(true);
});

test('the same question never comes twice in a row', async () => {
  const { container, puts } = renderTool('/theory/fretboard-quiz', { theory: nameNote });
  await screen.findByText('Name this note');
  const asked: string[] = [];
  for (let i = 0; i < 30; i++) {
    asked.push(questionCell(container));
    answerRight(container);
  }
  asked.forEach((cell, i) => i > 0 && expect(cell).not.toBe(asked[i - 1]));
});

test('the file becomes unreadable mid-practice (find the note): taps are not answers either', async () => {
  const page = renderFlaky('/theory/fretboard-quiz', fb());
  await screen.findByText(/^Find every /);
  await page.unreadable();
  await screen.findByText(/The quiz needs theory.json/);
  expect(screen.queryByRole('button', { name: 'G string, open' })).toBeNull(); // no neck to tap on
  await page.readable();
  await screen.findByText(/^Find every /);
});

// ---------------------------------------------------------------- settings

test('focus settings are saved', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  const { puts } = renderTool('/theory/fretboard-quiz', { theory: fb() });
  await screen.findByText(/^Find every /);
  fireEvent.click(screen.getByRole('button', { name: 'Frets 0–5' }));
  fireEvent.click(screen.getByRole('button', { name: 'E + A only' }));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(600);
  });
  expect(puts.at(-1)?.quiz.settings.fretboard).toEqual({ mode: 'find-note', strings: [3, 2], frets: [0, 5], accidentals: false });
});

test('several setting changes in a row are one PUT, and a setting already chosen is not a change', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  const { puts } = renderTool('/theory/fretboard-quiz', { theory: fb() });
  await screen.findByText(/^Find every /);
  fireEvent.click(screen.getByRole('button', { name: 'Name the note' }));
  fireEvent.click(screen.getByRole('button', { name: 'Frets 0–5' }));
  fireEvent.click(screen.getByRole('button', { name: 'E + A only' }));
  fireEvent.click(screen.getByRole('button', { name: '+ sharps/flats' }));
  fireEvent.click(screen.getByRole('button', { name: '+ sharps/flats' }));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(2000);
  });
  expect(puts).toHaveLength(1);
  expect(puts[0]!.quiz.settings.fretboard).toEqual({ mode: 'name-note', strings: [3, 2], frets: [0, 5], accidentals: true });
});

test('settings survive a reload: what was PUT is what the next visit shows', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  const first = renderTool('/theory/fretboard-quiz', { theory: fb() });
  await screen.findByText(/^Find every /);
  fireEvent.click(screen.getByRole('button', { name: 'Spell the chord' }));
  fireEvent.click(screen.getByRole('button', { name: 'Frets 0–5' }));
  fireEvent.click(screen.getByRole('button', { name: 'E + A only' }));
  fireEvent.click(screen.getByRole('button', { name: '+ sharps/flats' }));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(600);
  });
  const saved = first.puts.at(-1)!;
  first.unmount();
  renderTool('/theory/fretboard-quiz', { theory: saved });
  await screen.findByText(/^Tap the notes of /);
  const pressed = (name: string) => screen.getByRole('button', { name }).getAttribute('aria-pressed');
  expect(['Spell the chord', 'Frets 0–5', 'E + A only', '+ sharps/flats'].map(pressed)).toEqual(['true', 'true', 'true', 'true']);
  expect(['Name the note', 'All strings', 'Frets 0–12', 'Naturals'].map(pressed)).toEqual(['false', 'false', 'false', 'false']);
});

test('a strings setting that is neither preset shows neither as chosen', async () => {
  renderTool('/theory/fretboard-quiz', { theory: fb({ strings: [0, 1, 2] }) });
  await screen.findByText(/^Find every /);
  expect(screen.getByRole('button', { name: 'All strings' })).toHaveAttribute('aria-pressed', 'false');
  expect(screen.getByRole('button', { name: 'E + A only' })).toHaveAttribute('aria-pressed', 'false');
});

test('the low-two-strings setting follows a change of instrument: E + A on bass is E + A on guitar, not D + G', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  const { puts } = renderTool('/theory/fretboard-quiz', { theory: fb({ strings: [3, 2] }) });
  await screen.findByText(/^Find every /);
  expect(screen.getByRole('button', { name: 'E + A only' })).toHaveAttribute('aria-pressed', 'true');
  fireEvent.change(screen.getByRole('combobox', { name: 'Instrument' }), { target: { value: 'guitar6' } });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(600);
  });
  expect(puts.at(-1)?.quiz.settings.fretboard.strings).toEqual([5, 4]);
  expect(screen.getByRole('button', { name: 'E + A only' })).toHaveAttribute('aria-pressed', 'true');
});

test('strings the new instrument lacks become all strings, not a focus with no such string', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  const guitar = { kind: 'guitar' as const, strings: 6, tuning: ['E2', 'A2', 'D3', 'G3', 'B3', 'E4'], left_handed: false };
  const { puts } = renderTool('/theory/fretboard-quiz', { theory: { ...fb({ strings: [5, 0] }), instrument: guitar } });
  await screen.findByText(/^Find every /);
  fireEvent.change(screen.getByRole('combobox', { name: 'Instrument' }), { target: { value: 'bass4' } });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(600);
  });
  expect(puts.at(-1)?.quiz.settings.fretboard.strings).toEqual([]);
  expect(screen.getByRole('button', { name: 'All strings' })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.queryByRole('alert')).toBeNull();
});

test('a fret range that reaches past this neck reads as its every-fret chip', async () => {
  renderTool('/theory/fretboard-quiz', { theory: fb({ frets: [0, 17] }) }); // saved on a guitar; this is a bass
  await screen.findByText(/^Find every /);
  expect(screen.getByRole('button', { name: `Frets 0–${MAX_FRET}` })).toHaveAttribute('aria-pressed', 'true');
});

// ---------------------------------------------------------------- when there is nothing to ask (N-08)

test('a focus with no such string says so and offers to widen it', async () => {
  const { puts } = renderTool('/theory/fretboard-quiz', { theory: fb({ mode: 'name-note', strings: [9] }) });
  expect(await screen.findByRole('alert')).toHaveTextContent(/No such string/);
  expect(screen.queryByText(/^round \d+ of 20$/)).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Widen the focus' }));
  await screen.findByText('Name this note');
  await waitFor(() => expect(puts.at(-1)?.quiz.settings.fretboard).toEqual({ mode: 'name-note', strings: [], frets: [0, MAX_FRET], accidentals: true }));
});

test('a reversed fret range and an interval with no partner in the focus are each said in words', async () => {
  renderTool('/theory/fretboard-quiz', { theory: fb({ frets: [8, 3] }) });
  expect(await screen.findByRole('alert')).toHaveTextContent(/empty or reversed/);
  cleanup();
  renderTool('/theory/fretboard-quiz', { theory: fb({ mode: 'find-interval', strings: [3], frets: [0, 0] }) });
  expect(await screen.findByRole('alert')).toHaveTextContent(/No interval can be asked inside this focus/);
  expect(screen.getByRole('button', { name: 'Widen the focus' })).toBeInTheDocument();
});

test('theory.json unreadable: the quiz says it cannot save instead of asking questions it would drop', async () => {
  const puts: unknown[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/theory' && init?.method === 'PUT') puts.push(init.body);
      if (url === '/api/theory') return new Response(JSON.stringify({ detail: 'theory.json: broken' }), { status: 500 });
      if (url === '/api/songs') return new Response(JSON.stringify({ songs: [] }));
      throw new Error(`unexpected fetch: ${url}`);
    }),
  );
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={['/theory/fretboard-quiz']}>
        <Routes>
          <Route path="theory/:tool" element={<Theory />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  expect(await screen.findByText(/The quiz needs theory.json/)).toBeInTheDocument();
  expect(screen.queryByText(/^round \d+ of 20$/)).toBeNull();
  expect(screen.queryByRole('group', { name: 'Quiz' })).toBeNull(); // no mode switch that could not do anything
  fireEvent.keyDown(window, { key: '1' });
  expect(puts).toHaveLength(0);
});

// ---------------------------------------------------------------- weak spots
