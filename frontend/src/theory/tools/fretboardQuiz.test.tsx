import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { StrictMode } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import { DEFAULT_THEORY, type QuizAnswer, type TheoryDoc } from '../../api/client';
import { positionAt, positionsOf, type Cell } from '../../music/positions';
import { DEFAULT_INSTRUMENT, neckFrets, PRESETS } from '../../music/tuning';
import { Theory } from '../../screens/Theory';
import { cellText } from '../QuizStats';
import { forgetUnsavedTheory, TheoryDocProvider, useTheoryDoc } from '../TheoryDoc';
import { TheoryNeck } from '../TheoryNeck';
import { HISTORY_CAP, ROUND, roundStats, seeds, useQuizRound, weakestOfRound, type Result, type Round } from '../useQuizRound';
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
/** Whether closing the page now would be warned about. */
function unloadPrompted(): boolean {
  const event = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}
const progress = () => screen.getByText(/^round \d+ of 20$/).textContent;
const stored = (n: number, item = 's0f0'): QuizAnswer[] =>
  Array.from({ length: n }, (_, i) => ({ quiz: 'fretboard', mode: 'name-note', item: `${item}`, correct: i % 2 === 0, ms: 1000 + i, at: `2026-01-01T00:00:${String(i % 60).padStart(2, '0')}Z` }));

/** Makes the next PUT of theory.json fail with the server's message, and records what it carried. */
function failNextPut(): TheoryDoc[] {
  const real = globalThis.fetch as unknown as (url: string, init?: RequestInit) => Promise<Response>;
  const failed: TheoryDoc[] = [];
  let armed = true;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (armed && url === '/api/theory' && init?.method === 'PUT') {
        armed = false;
        failed.push(JSON.parse(String(init.body)));
        return new Response('disk full', { status: 500 });
      }
      return real(url, init);
    }),
  );
  return failed;
}

// ---------------------------------------------------------------- name the note

test('name the note: a wrong answer is explained and the question stays; only the first try counts', async () => {
  const { container } = renderTool('/theory/fretboard-quiz', { theory: nameNote });
  await screen.findByText('Name this note');
  const pc = questionPc(container);
  fireEvent.click(answers().getByRole('button', { name: KEYS[(pc + 1) % 12]! }));
  expect(screen.getByText(/✕ not/)).toBeInTheDocument();
  expect(progress()).toBe('round 1 of 20');
  fireEvent.click(answers().getByRole('button', { name: KEYS[pc]! }));
  expect(progress()).toBe('round 2 of 20');
  expect(screen.getByText(/first try/)).toHaveTextContent('0/1 first try');
  expect(screen.queryByText(/✕ not/)).toBeNull();
});

test('name the note answers from the keyboard, 1–9 0 - = for C … B', async () => {
  const { container } = renderTool('/theory/fretboard-quiz', { theory: nameNote });
  await screen.findByText('Name this note');
  const pc = questionPc(container);
  fireEvent.keyDown(window, { key: DIGITS[pc] });
  expect(screen.getByText(/first try/)).toHaveTextContent('1/1 first try');
});

test('every one of the twelve keys answers its own note', async () => {
  const { container } = renderTool('/theory/fretboard-quiz', { theory: nameNote });
  await screen.findByText('Name this note');
  for (let i = 0; i < 12; i++) {
    const pc = questionPc(container);
    // The key for another note is wrong; the key for this one is right.
    fireEvent.keyDown(window, { key: DIGITS[(pc + 1) % 12] });
    expect(screen.getByText(/✕ not/)).toBeInTheDocument();
    fireEvent.keyDown(window, { key: DIGITS[pc] });
  }
  expect(progress()).toBe('round 13 of 20');
});

test('keys are ignored with a modifier, when held down, and while typing in a field', async () => {
  const { container } = renderTool('/theory/fretboard-quiz', { theory: nameNote });
  await screen.findByText('Name this note');
  const key = DIGITS[questionPc(container)]!;
  fireEvent.keyDown(window, { key, ctrlKey: true });
  fireEvent.keyDown(window, { key, metaKey: true });
  fireEvent.keyDown(window, { key, altKey: true });
  fireEvent.keyDown(window, { key, repeat: true });
  const field = document.body.appendChild(document.createElement('input'));
  fireEvent.keyDown(field, { key });
  fireEvent.keyDown(screen.getByLabelText('Instrument'), { key });
  expect(screen.getByText(/first try/)).toHaveTextContent('0/0 first try');
  fireEvent.keyDown(window, { key });
  expect(screen.getByText(/first try/)).toHaveTextContent('1/1 first try');
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
  const { container } = renderTool('/theory/fretboard-quiz', { theory: nameNote });
  await screen.findByText('Name this note');
  fireEvent.keyDown(window, { key: DIGITS[questionPc(container)]!, shiftKey: true });
  expect(screen.getByText(/first try/)).toHaveTextContent('1/1 first try');
  fireEvent.keyDown(window, { key: '_', shiftKey: true }); // Shift+- on QWERTY is not the B key
  fireEvent.keyDown(window, { key: '+', shiftKey: true });
  expect(screen.getByText(/first try/)).toHaveTextContent('1/1 first try');
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
  renderTool('/theory/fretboard-quiz', { theory: fb() }); // find-note: digits mean nothing
  await screen.findByText(/^Find every /);
  fireEvent.keyDown(window, { key: '1' });
  expect(screen.getByText(/first try/)).toHaveTextContent('0/0 first try');
});

// ---------------------------------------------------------------- the other modes

test('find the note: wrong taps are marked, every target must be found', async () => {
  const { container } = renderTool('/theory/fretboard-quiz', { theory: fb() });
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
  expect(progress()).toBe('round 2 of 20');
  expect(screen.getByText(/first try/)).toHaveTextContent('0/1 first try');
});

test('find the note: found notes count up, and tapping one again does nothing', async () => {
  const { container } = renderTool('/theory/fretboard-quiz', { theory: fb() });
  const prompt = await screen.findByText(/^Find every /);
  const pc = KEYS.findIndex((k) => k.split('/').some((n) => prompt.textContent === `Find every ${n}`));
  const targets = positionsOf(DEFAULT_INSTRUMENT, new Set([pc]), 0, 12);
  tapCell(targets[0]!);
  tapCell(targets[0]!);
  expect(container.querySelectorAll('[data-marker="ok"]')).toHaveLength(1);
  expect(screen.getByText(`1 found · ${targets.length - 1} to go · tap the neck`)).toBeInTheDocument();
  expect(container.querySelector('[data-marker="wrong"]')).toBeNull();
  for (const t of targets.slice(1)) tapCell(t);
  expect(progress()).toBe('round 2 of 20');
  expect(screen.getByText(/first try/)).toHaveTextContent('1/1 first try');
});

test('find the note: the right note outside the practised strings is refused with the reason', async () => {
  renderTool('/theory/fretboard-quiz', { theory: fb({ strings: [3, 2] }) }); // E and A only
  const prompt = await screen.findByText(/^Find every /);
  const pc = KEYS.findIndex((k) => k.split('/').some((n) => prompt.textContent === `Find every ${n}`));
  tapCell(positionsOf(DEFAULT_INSTRUMENT, new Set([pc]), 0, 12).find((p) => p.string === 0)!); // a G-string cell
  expect(screen.getByText(/but not in the strings and frets you're practising/)).toBeInTheDocument();
  expect(progress()).toBe('round 1 of 20');
});

const INTERVAL = { 'minor 3rd': 3, 'major 3rd': 4, '4th': 5, '5th': 7, '♭7': 10, octave: 0 } as const;

test('find the interval: any octave of the answer counts, the start note is marked as such, a wrong tap says what it was', async () => {
  const { container } = renderTool('/theory/fretboard-quiz', { theory: fb({ mode: 'find-interval' }) });
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
  expect(progress()).toBe('round 1 of 20');

  // Any cell holding the answer, not just the nearest, finishes it.
  const answer = positionsOf(DEFAULT_INSTRUMENT, new Set([answerPc]), 0, 12).filter((p) => p.string !== origin.string || p.fret !== origin.fret);
  tapCell(answer[answer.length - 1]!);
  expect(progress()).toBe('round 2 of 20');
  expect(screen.getByText(/first try/)).toHaveTextContent('0/1 first try');
  expect(screen.getByText(/Any octave counts/)).toBeInTheDocument();
});

test('find the interval: the answer in a string the player is not practising is refused, not accepted', async () => {
  const { container } = renderTool('/theory/fretboard-quiz', { theory: fb({ mode: 'find-interval', strings: [3, 2] }) });
  const prompt = await screen.findByText(/^Tap the .* above this note$/);
  const label = /^Tap the (.*) above this note$/.exec(prompt.textContent!)![1] as keyof typeof INTERVAL;
  const origin = cellOf(container, 'accent');
  const answerPc = (positionAt(DEFAULT_INSTRUMENT, origin).pc + INTERVAL[label]) % 12;
  tapCell(positionsOf(DEFAULT_INSTRUMENT, new Set([answerPc]), 0, 12).find((p) => p.string === 0)!);
  expect(screen.getByText(/but not in the strings and frets you're practising/)).toBeInTheDocument();
  expect(progress()).toBe('round 1 of 20');
});

const CHORD_TONES: Record<string, number[]> = {
  C: [0, 4, 7], Cm: [0, 3, 7], D: [2, 6, 9], Dm: [2, 5, 9], E: [4, 8, 11], Em: [4, 7, 11], F: [5, 9, 0], Fm: [5, 8, 0],
  G: [7, 11, 2], Gm: [7, 10, 2], A: [9, 1, 4], Am: [9, 0, 4], B: [11, 3, 6], Bm: [11, 2, 6],
};

test('spell the chord: only tones inside the outlined window count; a tone outside is refused with the reason', async () => {
  renderTool('/theory/fretboard-quiz', { theory: fb({ mode: 'spell-chord' }) });
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
  expect(progress()).toBe('round 1 of 20');
  for (const t of inside) tapCell(t);
  expect(progress()).toBe('round 2 of 20');
  expect(screen.getByText(/first try/)).toHaveTextContent('0/1 first try');
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

test('a round of 20 ends in a summary and one PUT with all 20 answers', async () => {
  const { container, puts } = renderTool('/theory/fretboard-quiz', { theory: nameNote });
  await screen.findByText('Name this note');
  for (let i = 0; i < 19; i++) answerRight(container);
  expect(progress()).toBe('round 20 of 20');
  expect(puts).toHaveLength(0); // nothing is sent while the round is on
  answerRight(container);
  expect(await screen.findByText('20 / 20 first try')).toBeInTheDocument();
  await waitFor(() => expect(puts).toHaveLength(1));
  expect(puts[0]!.quiz.history).toHaveLength(20);
  expect(puts[0]!.quiz.history.every((a: QuizAnswer) => a.quiz === 'fretboard' && a.mode === 'name-note' && a.correct)).toBe(true);
  expect(puts[0]!.quiz.history.every((a: QuizAnswer) => !('text' in a))).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Practise these' }));
  expect(progress()).toBe('round 1 of 20');
  expect(puts).toHaveLength(1); // starting the next round has nothing new to save
});

test('a round is exactly 20 questions: a late key press after the summary records nothing', async () => {
  const { container, puts } = renderTool('/theory/fretboard-quiz', { theory: nameNote });
  await screen.findByText('Name this note');
  for (let i = 0; i < ROUND; i++) answerRight(container);
  await screen.findByText('20 / 20 first try');
  for (const key of DIGITS) fireEvent.keyDown(window, { key });
  await waitFor(() => expect(puts).toHaveLength(1));
  expect(puts[0]!.quiz.history).toHaveLength(20);
  expect(screen.getByText('20 / 20 first try')).toBeInTheDocument();
});

test('only the first try is stored: a wrong tap then the right one is a miss', async () => {
  const { container, puts } = renderTool('/theory/fretboard-quiz', { theory: nameNote });
  await screen.findByText('Name this note');
  answerWrong(container);
  answerRight(container);
  for (let i = 0; i < 19; i++) answerRight(container);
  await waitFor(() => expect(puts).toHaveLength(1));
  const history = puts[0]!.quiz.history;
  expect(history).toHaveLength(20);
  expect(history[0]!.correct).toBe(false);
  expect(history.slice(1).every((a: QuizAnswer) => a.correct)).toBe(true);
  expect(await screen.findByText('19 / 20 first try')).toBeInTheDocument();
});

test('the same question never comes twice in a row, not even from one round into the next', async () => {
  const { container } = renderTool('/theory/fretboard-quiz', { theory: nameNote });
  await screen.findByText('Name this note');
  const asked: string[] = [];
  for (let i = 0; i < ROUND; i++) {
    asked.push(questionCell(container));
    answerRight(container);
  }
  await screen.findByText('20 / 20 first try');
  fireEvent.keyDown(window, { key: 'Enter' });
  asked.push(questionCell(container));
  asked.forEach((cell, i) => i > 0 && expect(cell).not.toBe(asked[i - 1]));
});

test('Enter starts the next round from the summary, but not when it is pressing a button', async () => {
  const { container } = renderTool('/theory/fretboard-quiz', { theory: nameNote });
  await screen.findByText('Name this note');
  for (let i = 0; i < ROUND; i++) answerRight(container);
  await screen.findByText('20 / 20 first try');
  fireEvent.keyDown(screen.getByRole('button', { name: 'Practise these' }), { key: 'Enter' });
  expect(screen.getByText('20 / 20 first try')).toBeInTheDocument();
  fireEvent.keyDown(window, { key: 'Enter', repeat: true });
  expect(screen.getByText('20 / 20 first try')).toBeInTheDocument();
  fireEvent.keyDown(window, { key: 'Enter' });
  expect(progress()).toBe('round 1 of 20');
});

test('Enter on the summary starts the next round while a setting button outside it has the focus', async () => {
  const { container } = renderTool('/theory/fretboard-quiz', { theory: nameNote });
  await screen.findByText('Name this note');
  for (let i = 0; i < ROUND; i++) answerRight(container);
  await screen.findByText('20 / 20 first try');
  const setting = screen.getByRole('button', { name: 'Frets 0–5' });
  setting.focus();
  fireEvent.keyDown(setting, { key: 'Enter' });
  expect(progress()).toBe('round 1 of 20');
});

test('the file becomes unreadable mid-round (name the note): the alert is the whole screen, no key answers a hidden question, and the round goes on and is saved once when it reads again', async () => {
  const page = renderFlaky('/theory/fretboard-quiz', nameNote);
  await screen.findByText('Name this note');
  for (let i = 0; i < 3; i++) answerRight(page.container);
  expect(progress()).toBe('round 4 of 20');
  await page.unreadable();
  await screen.findByText(/The quiz needs theory.json/);
  expect(screen.queryByText('Name this note')).toBeNull();
  for (const key of DIGITS) for (let i = 0; i < 3; i++) fireEvent.keyDown(window, { key });
  await page.readable();
  await screen.findByText('Name this note');
  expect(progress()).toBe('round 4 of 20');
  expect(screen.getByText(/first try/)).toHaveTextContent('3/3 first try');
  expect(page.puts).toHaveLength(0);
  for (let i = 0; i < 17; i++) answerRight(page.container);
  expect(await screen.findByText('20 / 20 first try')).toBeInTheDocument();
  await waitFor(() => expect(page.puts).toHaveLength(1));
  expect(page.puts[0]!.quiz.history).toHaveLength(20);
});

test('the file becomes unreadable mid-round (find the note): taps are not answers either', async () => {
  const page = renderFlaky('/theory/fretboard-quiz', fb());
  await screen.findByText(/^Find every /);
  await page.unreadable();
  await screen.findByText(/The quiz needs theory.json/);
  expect(screen.queryByRole('button', { name: 'G string, open' })).toBeNull(); // no neck to tap on
  await page.readable();
  await screen.findByText(/^Find every /);
  expect(screen.getByText(/first try/)).toHaveTextContent('0/0 first try');
});

test('leaving mid-round for another tool saves what was answered, once', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  const { container, puts } = renderTool('/theory/fretboard-quiz', { theory: nameNote });
  await screen.findByText('Name this note');
  answerWrong(container);
  answerRight(container);
  answerRight(container);
  answerRight(container);
  expect(puts).toHaveLength(0);
  fireEvent.click(screen.getByRole('link', { name: 'Scale finder' }));
  await screen.findByRole('heading', { name: 'Scale finder' });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1200);
  });
  expect(puts.length).toBeGreaterThan(0);
  expect(puts[0]!.quiz.history).toHaveLength(3);
  expect(puts[0]!.quiz.history.map((a: QuizAnswer) => a.correct)).toEqual([false, true, true]);
  expect(puts.every((p) => p.quiz.history.length === 3)).toBe(true); // never 6
});

test('leaving the Theory tab mid-round saves what was answered', async () => {
  const { container, puts, unmount } = renderTool('/theory/fretboard-quiz', { theory: nameNote });
  await screen.findByText('Name this note');
  answerRight(container);
  answerRight(container);
  unmount();
  await waitFor(() => expect(puts).toHaveLength(1));
  expect(puts[0]!.quiz.history).toHaveLength(2);
});

test('a failed save keeps the answers and says so; Retry sends them once, not twice', async () => {
  const { container, puts } = renderTool('/theory/fretboard-quiz', { theory: nameNote });
  await screen.findByText('Name this note');
  const failed = failNextPut();
  for (let i = 0; i < ROUND; i++) answerRight(container);
  expect(await screen.findByText("Couldn't save")).toBeInTheDocument();
  expect(screen.getByText(/disk full/)).toBeInTheDocument();
  expect(screen.getByText('20 / 20 first try')).toBeInTheDocument(); // the summary is still there
  expect(failed[0]!.quiz.history).toHaveLength(20);
  expect(puts).toHaveLength(0);
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  await waitFor(() => expect(puts).toHaveLength(1));
  expect(puts[0]!.quiz.history).toHaveLength(20);
  await waitFor(() => expect(screen.queryByText("Couldn't save")).toBeNull());
  // Another round after a recovered save appends to those 20, not to 40.
  fireEvent.keyDown(window, { key: 'Enter' });
  for (let i = 0; i < ROUND; i++) answerRight(container);
  await waitFor(() => expect(puts).toHaveLength(2));
  expect(puts[1]!.quiz.history).toHaveLength(40);
});

test('a failed save while leaving mid-round still keeps the answers for the banner, and Retry does not double them', async () => {
  const { container, puts } = renderTool('/theory/fretboard-quiz', { theory: nameNote });
  await screen.findByText('Name this note');
  answerRight(container);
  answerRight(container);
  const failed = failNextPut();
  fireEvent.click(screen.getByRole('button', { name: 'Frets 0–5' })); // restarts the round, which saves its 2 answers now
  expect(await screen.findByText("Couldn't save")).toBeInTheDocument();
  expect(failed).toHaveLength(1);
  expect(failed[0]!.quiz.history).toHaveLength(2);
  expect(failed[0]!.quiz.settings.fretboard.frets).toEqual([0, 5]);
  expect(progress()).toBe('round 1 of 20');
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  await waitFor(() => expect(puts).toHaveLength(1));
  expect(puts[0]!.quiz.history).toHaveLength(2);
});

test('restarting mid-round by changing the focus saves the answers so far once, with the setting, and none are duplicated later', async () => {
  const { container, puts } = renderTool('/theory/fretboard-quiz', { theory: nameNote });
  await screen.findByText('Name this note');
  answerRight(container);
  answerRight(container);
  answerRight(container);
  fireEvent.click(screen.getByRole('button', { name: 'Frets 0–5' }));
  await waitFor(() => expect(puts).toHaveLength(1));
  expect(puts[0]!.quiz.history).toHaveLength(3);
  expect(puts[0]!.quiz.settings.fretboard.frets).toEqual([0, 5]);
  expect(progress()).toBe('round 1 of 20');
  expect(screen.getByText(/first try/)).toHaveTextContent('0/0 first try');
  answerRight(container);
  answerRight(container);
  fireEvent.click(screen.getByRole('link', { name: 'Scale finder' }));
  await waitFor(() => expect(puts.at(-1)!.quiz.history).toHaveLength(5));
  expect(puts.every((p) => p.quiz.history.length === 3 || p.quiz.history.length === 5)).toBe(true);
});

test('never more than the server keeps: the oldest answers are trimmed before sending', async () => {
  const history = stored(HISTORY_CAP - 5, 's0f1').map((a, i) => ({ ...a, item: `s0f${i % 13}`, ms: i }));
  const { container, puts } = renderTool('/theory/fretboard-quiz', { theory: fb({ mode: 'name-note' }, { history }) });
  await screen.findByText('Name this note');
  for (let i = 0; i < ROUND; i++) answerRight(container);
  await waitFor(() => expect(puts).toHaveLength(1));
  const sent = puts[0]!.quiz.history;
  expect(sent).toHaveLength(HISTORY_CAP);
  expect(sent[0]).toEqual(history[15]); // the 15 oldest went
  expect(sent.slice(-ROUND).every((a: QuizAnswer) => a.mode === 'name-note' && a.correct)).toBe(true);
});

// ---------------------------------------------------------------- settings

test('focus settings are saved and restart the round', async () => {
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

test('a practise list that no longer matches says so, and a normal round is one click away', async () => {
  const guitar = { kind: 'guitar' as const, strings: 6, tuning: ['E2', 'A2', 'D3', 'G3', 'B3', 'E4'], left_handed: false };
  const { container } = renderTool('/theory/fretboard-quiz', { theory: { ...fb({ mode: 'name-note' }), instrument: guitar } });
  await screen.findByText('Name this note');
  const noteButton = (pc: number) => within(screen.getByRole('group', { name: 'Answer' })).getByRole('button', { name: KEYS[pc]! });
  const pcOf = () => {
    const [, s, f] = /^s(\d+)f(\d+)$/.exec(questionCell(container))!;
    return { row: Number(s), pc: positionAt(guitar, { string: Number(s), fret: Number(f) }).pc };
  };
  // Miss every question on the two lowest strings, which a 4-string bass does not have.
  for (let i = 0; i < ROUND; i++) {
    const { row, pc } = pcOf();
    if (row >= 4) fireEvent.click(noteButton((pc + 1) % 12));
    fireEvent.click(noteButton(pc));
  }
  await screen.findByText(/first try/);
  expect(screen.getByText(/Weakest this round/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Practise these' }));
  expect(screen.getByText(/practising the 3 weakest/)).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Instrument'), { target: { value: 'bass4' } });
  expect(await screen.findByRole('alert')).toHaveTextContent(/None of the items you chose to practise are in this focus or topic any more/);
  fireEvent.click(screen.getByRole('button', { name: 'Start a normal round' }));
  await screen.findByText('Name this note');
  expect(progress()).toBe('round 1 of 20');
  expect(screen.queryByText(/practising the/)).toBeNull();
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

test('weak spots come from the history; reset asks first', async () => {
  const at = '2026-09-29T00:00:00Z';
  const history = [
    { quiz: 'fretboard' as const, mode: 'name-note', item: 'E1-A1-D2-G2/s2f7', correct: false, ms: 6000, at },
    { quiz: 'fretboard' as const, mode: 'name-note', item: 'E1-A1-D2-G2/s3f3', correct: true, ms: 500, at },
  ];
  const { container, puts } = renderTool('/theory/fretboard-quiz', { theory: fb({}, { history }) });
  await screen.findByText(/^Find every /);
  expect(container.querySelector('[data-heat="s2f7"]')).toHaveClass('heatWeak');
  expect(container.querySelector('[data-heat="s3f3"]')).toHaveClass('heatStrong');
  expect(screen.getByText(/Weakest:/)).toHaveTextContent('Weakest: A string, fret 7.');
  expect(screen.getByText(/Shown in red/)).toBeInTheDocument();
  const ask = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
  fireEvent.click(screen.getByRole('button', { name: 'Reset history…' }));
  expect(ask).toHaveBeenCalledTimes(1);
  expect(puts).toHaveLength(0);
  fireEvent.click(screen.getByRole('button', { name: 'Reset history…' }));
  await waitFor(() => expect(puts.at(-1)?.quiz.history).toEqual([]));
});

test('weak spots belong to the tuning they were asked in: drop D does not show standard-tuning answers', async () => {
  const at = '2026-09-29T00:00:00Z';
  const wrong = (item: string) => ({ quiz: 'fretboard' as const, mode: 'name-note', item, correct: false, ms: 6000, at });
  const dropD = { kind: 'bass' as const, strings: 4, tuning: ['D1', 'A1', 'D2', 'G2'], left_handed: false };
  const history = [wrong('E1-A1-D2-G2/s3f3'), wrong('s3f5'), wrong('D1-A1-D2-G2/s2f7')];
  const { container } = renderTool('/theory/fretboard-quiz', { theory: { ...fb({}, { history }), instrument: dropD } });
  await screen.findByText(/^Find every /);
  expect([...container.querySelectorAll('[data-heat]')].map((e) => e.getAttribute('data-heat'))).toEqual(['s2f7']);
  expect(screen.getByText(/Weakest:/)).toHaveTextContent('Weakest: A string, fret 7.');
});

test('the heat overlay only draws positions this neck has', async () => {
  const at = '2026-09-29T00:00:00Z';
  const wrong = (item: string) => ({ quiz: 'fretboard' as const, mode: 'name-note', item, correct: false, ms: 6000, at });
  const { container } = renderTool('/theory/fretboard-quiz', { theory: fb({}, { history: [wrong('E1-A1-D2-G2/s5f3'), wrong(`E1-A1-D2-G2/s2f${MAX_FRET + 1}`), wrong('E1-A1-D2-G2/s2f7'), wrong('E1-A1-D2-G2/s0f0')] }) });
  await screen.findByText(/^Find every /);
  expect([...container.querySelectorAll('[data-heat]')].map((e) => e.getAttribute('data-heat')).sort()).toEqual(['s0f0', 's2f7']);
  expect(screen.getByText(/Weakest:/).textContent).not.toMatch(/s5f3|fret 16/);
});

test('this round’s unsaved answers already colour the weak spots', async () => {
  const { container } = renderTool('/theory/fretboard-quiz', { theory: nameNote });
  await screen.findByText('Name this note');
  const cell = questionCell(container);
  answerWrong(container);
  answerRight(container);
  expect(container.querySelector(`[data-heat="${cell}"]`)).toHaveClass('heatWeak');
});

test('resetting the history mid-round also drops this round’s answers so far, and the rest of the round is saved after', async () => {
  const { container, puts } = renderTool('/theory/fretboard-quiz', { theory: fb({ mode: 'name-note' }, { history: stored(3) }) });
  await screen.findByText('Name this note');
  answerRight(container);
  answerRight(container);
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  fireEvent.click(screen.getByRole('button', { name: 'Reset history…' }));
  await waitFor(() => expect(puts.at(-1)?.quiz.history).toEqual([]));
  expect(container.querySelector('[data-heat]')).toBeNull();
  for (let i = 0; i < ROUND - 2; i++) answerRight(container);
  await waitFor(() => expect(puts.at(-1)?.quiz.history).toHaveLength(ROUND - 2));
});

test('cellText names every position of every tuning preset exactly as the neck names its click targets', () => {
  for (const p of PRESETS) {
    const inst = { kind: p.kind, strings: p.notes.length, tuning: p.notes, left_handed: false };
    const view = render(<TheoryNeck instrument={inst} frets={neckFrets(inst)} dots={[]} onPick={() => {}} label="neck" />);
    const fromNeck = view.getAllByRole('button').map((b) => b.getAttribute('aria-label')!);
    const cells = Array.from({ length: p.notes.length }, (_, s) => Array.from({ length: neckFrets(inst) + 1 }, (_, f) => cellText(inst, `s${s}f${f}`))).flat();
    expect([...cells].sort(), p.id).toEqual([...fromNeck].sort());
    expect(new Set(cells).size, `${p.id} has no two positions that read alike`).toBe(cells.length);
    view.unmount();
  }
});

test('cellText reads a repeated note letter with its octave, and a key that is not a cell as it is', () => {
  const dropD = { kind: 'bass' as const, strings: 4, tuning: ['D1', 'A1', 'D2', 'G2'], left_handed: false };
  expect(cellText(dropD, 's1f2')).toBe('D2 string, fret 2');
  expect(cellText(dropD, 's3f0')).toBe('D1 string, open');
  expect(cellText(DEFAULT_INSTRUMENT, 's2f7')).toBe('A string, fret 7');
  expect(cellText(DEFAULT_INSTRUMENT, 's9f7')).toBe('s9f7');
  expect(cellText(DEFAULT_INSTRUMENT, 'n7')).toBe('n7');
  // A cell item is named in its own tuning; one from another tuning is not a position of this one.
  expect(cellText(dropD, 'D1-A1-D2-G2/s3f0')).toBe('D1 string, open');
  expect(cellText(DEFAULT_INSTRUMENT, 'E1-A1-D2-G2/s2f7')).toBe('A string, fret 7');
  expect(cellText(dropD, 'E1-A1-D2-G2/s3f0')).toBe('E1-A1-D2-G2/s3f0');
});

// ---------------------------------------------------------------- rounds without the screen

const result = (item: string, correct: boolean, ms: number): Result => ({ quiz: 'fretboard', mode: 'name-note', item, correct, ms, at: 'x', text: item });

test('round stats: score only', () => {
  expect(roundStats([])).toEqual({ correct: 0, answered: 0 });
  expect(roundStats([result('a', true, 1000), result('b', false, 2000), result('c', true, 3000), result('d', true, 4000)])).toEqual({ correct: 3, answered: 4 });
});

test('the weakest of a round: wrong first, one entry per item', () => {
  const weak = weakestOfRound([result('a', true, 9000), result('b', false, 1000), result('b', true, 100), result('c', false, 5000), result('d', true, 300), result('e', true, 8000)]);
  expect(weak.map((r) => r.item)).toEqual(['b', 'c', 'a']);
  expect(weakestOfRound([result('x', true, 1), result('x', true, 1)])).toHaveLength(1);
});

let round!: Round;
function Probe() {
  round = useQuizRound();
  return null;
}
function Ready({ children }: { children: React.ReactNode }) {
  return useTheoryDoc().doc ? <>{children}</> : null;
}
function harness(theory: TheoryDoc = DEFAULT_THEORY) {
  const puts: TheoryDoc[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'PUT') {
        puts.push(JSON.parse(String(init.body)));
        return new Response(String(init.body));
      }
      return new Response(JSON.stringify(theory));
    }),
  );
  const view = render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <TheoryDocProvider>
        <Ready>
          <Probe />
          <p>ready</p>
        </Ready>
      </TheoryDocProvider>
    </QueryClientProvider>,
  );
  return { puts, ...view };
}
const record = (i: number, correct = true) => {
  act(() => {
    round.record({ quiz: 'fretboard', mode: 'name-note', item: `s0f${i}`, correct, ms: 100, text: `cell ${i}` });
  });
};

test('the round’s history is the stored history plus its unsaved answers, and the save appends them once', async () => {
  const { puts } = harness({ ...DEFAULT_THEORY, quiz: { ...DEFAULT_THEORY.quiz, history: stored(4) } });
  await screen.findByText('ready');
  expect(round.history).toHaveLength(4);
  record(1);
  record(2);
  expect(round.history).toHaveLength(6);
  expect(round.number).toBe(3);
  act(() => round.restart());
  await waitFor(() => expect(puts).toHaveLength(1));
  expect(puts[0]!.quiz.history).toHaveLength(6);
  expect(round.history).toHaveLength(6); // saved, not counted twice
  expect(round.results).toHaveLength(0);
  for (let i = 0; i < ROUND; i++) record(i);
  expect(round.done).toBe(true);
  expect(round.history).toHaveLength(26);
  expect(round.record({ quiz: 'fretboard', mode: 'name-note', item: 'late', correct: true, ms: 1, text: 'late' })).toBeNull();
  await waitFor(() => expect(puts).toHaveLength(2));
  expect(puts[1]!.quiz.history).toHaveLength(26);
});

test('restart keeps "practise these" as a list of distinct items, and nothing for an empty list', async () => {
  harness();
  await screen.findByText('ready');
  act(() => round.restart(['s0f1', 's0f1', 's1f2']));
  expect(round.only).toEqual(['s0f1', 's1f2']);
  act(() => round.restart([]));
  expect(round.only).toBeUndefined();
});

test('leaving the whole tab with answers pending saves them', async () => {
  const { puts, unmount } = harness();
  await screen.findByText('ready');
  record(1);
  record(2);
  unmount();
  await waitFor(() => expect(puts).toHaveLength(1));
  expect(puts[0]!.quiz.history).toHaveLength(2);
});

test('leaving the whole tab when that save fails is reported, and the answers are parked for the next visit (N-08)', async () => {
  const error = vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => (init?.method === 'PUT' ? new Response('disk full', { status: 500 }) : new Response(JSON.stringify(DEFAULT_THEORY)))));
  const view = render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <TheoryDocProvider>
        <Ready>
          <Probe />
          <p>ready</p>
        </Ready>
      </TheoryDocProvider>
    </QueryClientProvider>,
  );
  await screen.findByText('ready');
  record(1);
  view.unmount();
  await waitFor(() => expect(error).toHaveBeenCalledWith(expect.stringContaining('disk full')));
  expect(error).toHaveBeenCalledWith(expect.stringContaining('unsaved changes, kept in memory'));
  expect(unloadPrompted()).toBe(true); // and the browser warns, since the kept answers live nowhere else
});

// ---------------------------------------------------------------- coming back to the tab

async function playFailedRound() {
  const view = renderTool('/theory/fretboard-quiz', { theory: nameNote });
  await screen.findByText('Name this note');
  failNextPut();
  for (let i = 0; i < ROUND; i++) answerRight(view.container);
  await screen.findByText("Couldn't save");
  return view;
}

test('a round whose save failed is not lost by leaving the tab: coming back shows it and saves it again, once', async () => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  const first = await playFailedRound();
  first.unmount(); // no Retry pressed
  await waitFor(() => expect(log).toHaveBeenCalledWith(expect.stringContaining('unsaved changes, kept in memory')));

  // The server still has the old document (no answers), and it is what the new tab fetches.
  const back = renderTool('/theory/fretboard-quiz', { theory: nameNote });
  await waitFor(() => expect(back.container.querySelector('[data-heat]')).not.toBeNull());
  await waitFor(() => expect(back.puts).toHaveLength(1));
  expect(back.puts[0]!.quiz.history).toHaveLength(ROUND);
  await waitFor(() => expect(screen.queryByText("Couldn't save")).toBeNull());
  back.unmount();

  const third = renderTool('/theory/fretboard-quiz', { theory: nameNote });
  await screen.findByText('Name this note');
  expect(third.container.querySelector('[data-heat]')).toBeNull(); // the server's document, as saved
  expect(third.puts).toHaveLength(0);
});

test('when saving the kept round fails again, the banner and Retry are there and the answers are kept', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const first = await playFailedRound();
  first.unmount();
  const back = renderTool('/theory/fretboard-quiz', { theory: nameNote });
  const failed = failNextPut(); // installed before the fetched document arrives, so it catches the re-save
  expect(await screen.findByText("Couldn't save")).toBeInTheDocument();
  expect(failed[0]!.quiz.history).toHaveLength(ROUND);
  expect(back.container.querySelector('[data-heat]')).not.toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  await waitFor(() => expect(back.puts).toHaveLength(1));
  expect(back.puts[0]!.quiz.history).toHaveLength(ROUND);
});

test('closing the page mid-round is warned about while answers are unsaved, and not once the round is saved', async () => {
  const { container, puts } = renderTool('/theory/fretboard-quiz', { theory: nameNote });
  await screen.findByText('Name this note');
  expect(unloadPrompted()).toBe(false);
  for (let i = 0; i < 3; i++) answerRight(container);
  expect(unloadPrompted()).toBe(true);
  for (let i = 0; i < ROUND - 3; i++) answerRight(container);
  await waitFor(() => expect(puts).toHaveLength(1));
  await waitFor(() => expect(unloadPrompted()).toBe(false));
});

test('the mid-round warning goes away when the quiz is left (its answers are then saved)', async () => {
  const { container, puts, unmount } = renderTool('/theory/fretboard-quiz', { theory: nameNote });
  await screen.findByText('Name this note');
  answerRight(container);
  expect(unloadPrompted()).toBe(true);
  unmount();
  await waitFor(() => expect(puts).toHaveLength(1));
  await waitFor(() => expect(unloadPrompted()).toBe(false));
});

test('the unsaved-answers warning survives StrictMode', async () => {
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => (init?.method === 'PUT' ? new Response(String(init.body)) : new Response(JSON.stringify(DEFAULT_THEORY)))));
  const view = render(
    <StrictMode>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <TheoryDocProvider>
          <Ready>
            <Probe />
            <p>ready</p>
          </Ready>
        </TheoryDocProvider>
      </QueryClientProvider>
    </StrictMode>,
  );
  await screen.findByText('ready');
  record(1);
  expect(unloadPrompted()).toBe(true);
  view.unmount();
  await waitFor(() => expect(unloadPrompted()).toBe(false));
});

test('after leaving with a kept round the warning stays until it is saved, then goes', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const first = await playFailedRound();
  first.unmount();
  expect(unloadPrompted()).toBe(true);
  const back = renderTool('/theory/fretboard-quiz', { theory: nameNote });
  await waitFor(() => expect(back.puts).toHaveLength(1));
  await waitFor(() => expect(unloadPrompted()).toBe(false));
});

test('Probe E2: a round played on the cached document while the file cannot be read is not saved over it, and the kept round stays kept', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.useFakeTimers({ shouldAdvanceTime: true });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 5000, refetchOnWindowFocus: false } } });
  const puts: TheoryDoc[] = [];
  let putStatus = 500;
  let getStatus = 200;
  let asked = 0;
  let answer!: () => void;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'PUT') {
        puts.push(JSON.parse(String(init.body)));
        return putStatus === 200 ? new Response(String(init.body)) : new Response('disk full', { status: putStatus });
      }
      asked += 1;
      if (asked > 1) await new Promise<void>((resolve) => (answer = resolve)); // the second visit's GET is slow
      return getStatus === 200 ? new Response(JSON.stringify(DEFAULT_THEORY)) : new Response(JSON.stringify({ detail: 'theory.json: broken' }), { status: getStatus });
    }),
  );
  const mountRound = () =>
    render(
      <QueryClientProvider client={client}>
        <TheoryDocProvider>
          <Ready>
            <Probe />
            <p>ready</p>
          </Ready>
        </TheoryDocProvider>
      </QueryClientProvider>,
    );
  const firstVisit = mountRound();
  await screen.findByText('ready');
  for (let i = 0; i < ROUND; i++) record(i);
  await screen.findByText('ready');
  await waitFor(() => expect(puts).toHaveLength(1)); // the failed save
  firstVisit.unmount();
  puts.length = 0;
  vi.setSystemTime(Date.now() + 6000);

  putStatus = 200;
  getStatus = 500; // and the file became unreadable while the player was away
  mountRound();
  await screen.findByText('ready'); // the cached document, while the GET is slow
  for (let i = 0; i < ROUND; i++) record(i);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1500);
  });
  expect(puts).toHaveLength(0);
  await waitFor(() => expect(asked).toBe(2));
  await act(async () => answer());
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1500);
  });
  expect(puts).toHaveLength(0);
  expect(unloadPrompted()).toBe(true);
});
