import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { Chord, Note } from 'tonal';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import { DEFAULT_THEORY, type QuizAnswer, type TheoryDoc } from '../../api/client';
import * as quiz from '../../music/quiz';
import { Theory } from '../../screens/Theory';
import { forgetUnsavedTheory, TheoryDocProvider, useTheoryDoc } from '../TheoryDoc';
import { explainWrong } from '../../music/quizExplain';
import { ROUND, seeds, useQuizRound, type Round } from '../useQuizRound';
import { renderFlaky, renderTool } from './testing';
import { factText } from './TheoryQuiz';

// The real question generator, with a hook so a test can make it fail or look at its arguments.
vi.mock('../../music/quiz', async (original) => {
  const real = await original<typeof import('../../music/quiz')>();
  return { ...real, nextTheoryQuestion: vi.fn(real.nextTheoryQuestion) };
});
const next = vi.mocked(quiz.nextTheoryQuestion);

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

type Topic = 'keys' | 'chords' | 'intervals';
const tq = (topics: Topic[] = ['keys', 'chords', 'intervals']): Partial<TheoryDoc> => ({
  last_tool: 'theory-quiz', // so opening the tool does not itself queue a save
  quiz: { ...DEFAULT_THEORY.quiz, settings: { ...DEFAULT_THEORY.quiz.settings, theory: { topics } } },
});

const progress = () => screen.queryByText(/^round \d+ of 20$/)?.textContent ?? 'done';
const group = () => within(screen.getByRole('group', { name: 'Answers' }));
const buttons = () => group().getAllByRole('button');
/** What a screen reader calls each option: the option's own text, not its number. */
const options = () =>
  buttons().map((b) => {
    const copy = b.cloneNode(true) as HTMLElement;
    copy.querySelectorAll('[aria-hidden="true"]').forEach((n) => n.remove());
    return copy.textContent!.trim();
  });
const question = () => screen.getByRole('heading', { level: 2 }).textContent!;
const press = (key: string) => fireEvent.keyDown(window, { key });

// ---------------------------------------------------------------- an oracle that does not use quiz.ts

const ascii = (s: string) => s.replaceAll('♯', '#').replaceAll('♭', 'b');
const chroma = (name: string) => Note.chroma(ascii(name));
const SHARPS: Record<string, number> = { C: 0, G: 1, D: 2, A: 3, E: 4, B: 5, 'F#': 6, 'C#': 7 };
const FLATS: Record<string, number> = { F: 1, Bb: 2, Eb: 3, Ab: 4, Db: 5, Gb: 6, Cb: 7 };
const SEMITONES = ['unison', 'minor 2nd', 'major 2nd', 'minor 3rd', 'major 3rd', 'perfect 4th', 'tritone', 'perfect 5th', 'minor 6th', 'major 6th', 'minor 7th', 'major 7th'];

/** The index of the right option for the question on screen, worked out from the prompt with tonal alone. */
function rightOption(prompt: string, opts: string[]): number {
  let m: RegExpExecArray | null;
  if ((m = /^What's the V chord in (.+) major\?$/.exec(prompt))) {
    const pc = chroma(Note.transpose(ascii(m[1]!), '5P'));
    return opts.findIndex((o) => Chord.get(ascii(o)).quality === 'Major' && chroma(Chord.get(ascii(o)).tonic!) === pc);
  }
  if ((m = /^Relative minor of (.+) major\?$/.exec(prompt))) {
    const pc = chroma(Note.transpose(ascii(m[1]!), '6M'));
    return opts.findIndex((o) => o.endsWith(' minor') && chroma(o.replace(' minor', '')) === pc);
  }
  if ((m = /^Key signature of (.+) major\?$/.exec(prompt))) {
    const key = ascii(m[1]!);
    const want = key in SHARPS ? (SHARPS[key] === 0 ? 'no sharps or flats' : `${SHARPS[key]} ${SHARPS[key] === 1 ? 'sharp' : 'sharps'}`) : `${FLATS[key]} ${FLATS[key] === 1 ? 'flat' : 'flats'}`;
    return opts.indexOf(want);
  }
  if ((m = /^Notes of (.+)\?$/.exec(prompt))) {
    const want = Chord.get(ascii(m[1]!)).notes.map(chroma).join();
    return opts.findIndex((o) => o.split(' ').map(chroma).join() === want);
  }
  if ((m = /^Which chord is (.+)\?$/.exec(prompt))) {
    const want = m[1]!.split(' ').map(chroma).join();
    return opts.findIndex((o) => Chord.get(ascii(o)).notes.map(chroma).join() === want);
  }
  if ((m = /^(.+) up to (.+) is a…$/.exec(prompt))) {
    return opts.indexOf(SEMITONES[(chroma(m[2]!) - chroma(m[1]!) + 12) % 12]!);
  }
  throw new Error(`the oracle does not know "${prompt}"`);
}

const answerRight = () => {
  const i = rightOption(question(), options());
  expect(i).toBeGreaterThanOrEqual(0);
  fireEvent.click(buttons()[i]!);
};
const wrongIndexes = () => {
  const right = rightOption(question(), options());
  return [0, 1, 2, 3].filter((i) => i !== right);
};

/** Clicks options in order until the question changes; returns how many were wrong. */
function answerTheory(): number {
  const before = progress();
  for (let i = 0; i < 4; i++) {
    fireEvent.click(buttons()[i]!);
    if (progress() !== before) return i;
  }
  throw new Error('no option advanced the question');
}

// ---------------------------------------------------------------- the brief's tests

test('theory quiz: a wrong pick is crossed out and the question stays', async () => {
  renderTool('/theory/theory-quiz', { theory: tq() });
  await screen.findByRole('group', { name: 'Answers' });
  const wrong = answerTheory();
  expect(screen.getByText(/^round \d+ of 20$/)).toHaveTextContent('round 2 of 20');
  expect(screen.getByText(/first try/)).toHaveTextContent(`${wrong === 0 ? 1 : 0}/1 first try`);
});

test('theory quiz: topics are saved; a round of 20 is one PUT', async () => {
  const { puts } = renderTool('/theory/theory-quiz', { theory: tq() });
  await screen.findByRole('group', { name: 'Answers' });
  fireEvent.click(screen.getByRole('button', { name: 'Keys' }));
  fireEvent.click(screen.getByRole('button', { name: 'Chords' }));
  // The last topic can't be switched off.
  fireEvent.click(screen.getByRole('button', { name: 'Intervals' }));
  expect(screen.getByRole('button', { name: 'Intervals' })).toHaveAttribute('aria-pressed', 'true');
  for (let i = 0; i < 20; i++) answerTheory();
  expect(await screen.findByText(/ \/ 20 first try/)).toBeInTheDocument();
  await waitFor(() => expect(puts.some((p) => p.quiz.history.length === 20)).toBe(true));
  const saved = puts.find((p) => p.quiz.history.length === 20)!;
  expect(saved.quiz.settings.theory.topics).toEqual(['intervals']);
  expect(saved.quiz.history.every((a: QuizAnswer) => a.quiz === 'theory' && a.mode === 'intervals')).toBe(true);
});

// ---------------------------------------------------------------- the questions are right

test('the oracle knows the brief’s example: the V of E♭ is B♭', () => {
  expect(rightOption("What's the V chord in E♭ major?", ['E♭', 'A♭m', 'B♭', 'F'])).toBe(2);
});

test('every fact the quiz can ask has its marked answer confirmed by the independent oracle, whatever the option order', () => {
  const items = quiz.theoryItems(['keys', 'chords', 'intervals']);
  expect(items.length).toBeGreaterThan(200);
  for (const item of items) {
    for (const seed of [1, 2, 3]) {
      const q = quiz.theoryQuestion(item, quiz.mulberry32(seed));
      expect(rightOption(q.prompt, q.options), `${item} (seed ${seed}): ${q.prompt} ${q.options.join(' | ')}`).toBe(q.answer);
    }
  }
});

test.each([
  ['keys', /^(What's the V chord|Relative minor|Key signature)/],
  ['chords', /^(Notes of|Which chord is)/],
  ['intervals', / up to .* is a…$/],
] as const)('%s: two rounds of every right answer, worked out independently, are 20/20 and stored under their topic', async (topic, shape) => {
  const { puts } = renderTool('/theory/theory-quiz', { theory: tq([topic]) });
  await screen.findByRole('group', { name: 'Answers' });
  const asked: string[] = [];
  for (let round = 0; round < 2; round++) {
    for (let i = 0; i < ROUND; i++) {
      asked.push(question());
      expect(question()).toMatch(shape);
      expect(new Set(options()).size).toBe(4);
      answerRight();
    }
    expect(await screen.findByText('20 / 20 first try')).toBeInTheDocument();
    if (round === 0) press('Enter');
  }
  asked.forEach((q, i) => i > 0 && expect(q).not.toBe(asked[i - 1]));
  await waitFor(() => expect(puts.at(-1)?.quiz.history).toHaveLength(40));
  const history = puts.at(-1)!.quiz.history as QuizAnswer[];
  expect(history.every((a) => a.quiz === 'theory' && a.mode === topic && a.correct)).toBe(true);
  expect(new Set(history.map((a) => a.item.split(':')[0])).size).toBeGreaterThan(topic === 'keys' ? 1 : 0);
});

test('all three topics in one round: every question is answered right by the independent oracle', async () => {
  const { puts } = renderTool('/theory/theory-quiz', { theory: tq() });
  await screen.findByRole('group', { name: 'Answers' });
  for (let i = 0; i < ROUND; i++) answerRight();
  expect(await screen.findByText('20 / 20 first try')).toBeInTheDocument();
  await waitFor(() => expect(puts).toHaveLength(1));
  const history = puts[0]!.quiz.history as QuizAnswer[];
  expect(history).toHaveLength(20);
  expect(history.every((a) => a.quiz === 'theory' && ['keys', 'chords', 'intervals'].includes(a.mode) && a.correct && a.ms >= 0)).toBe(true);
  expect(history.every((a) => !('text' in a))).toBe(true);
});

// ---------------------------------------------------------------- first try only

test('a wrong pick is crossed out, says so, and the question stays; the right one scores a miss, once', async () => {
  const { puts } = renderTool('/theory/theory-quiz', { theory: tq(['keys']) });
  await screen.findByRole('group', { name: 'Answers' });
  const q = question();
  const [w1, w2] = wrongIndexes() as [number, number];
  const picked = options()[w1]!;
  fireEvent.click(buttons()[w1]!);
  expect(buttons()[w1]).toBeDisabled();
  expect(screen.getByRole('status')).toHaveTextContent(`${picked}`);
  expect(screen.getByRole('status')).toHaveTextContent('✕');
  expect(question()).toBe(q);
  expect(progress()).toBe('round 1 of 20');
  // The same wrong option again, by click or by key, is not a second miss and changes nothing.
  fireEvent.click(buttons()[w1]!);
  press(String(w1 + 1));
  expect(progress()).toBe('round 1 of 20');
  fireEvent.click(buttons()[w2]!);
  expect(question()).toBe(q);
  answerRight();
  expect(progress()).toBe('round 2 of 20');
  expect(screen.getByText(/first try/)).toHaveTextContent('0/1 first try');
  expect(screen.getByRole('status')).toBeEmptyDOMElement(); // the next question starts clean
  for (let i = 0; i < 19; i++) answerRight();
  await waitFor(() => expect(puts).toHaveLength(1));
  const history = puts[0]!.quiz.history as QuizAnswer[];
  expect(history).toHaveLength(20);
  expect(history[0]).toMatchObject({ quiz: 'theory', mode: 'keys', correct: false });
  expect(history.slice(1).every((a) => a.correct)).toBe(true);
  expect(await screen.findByText('19 / 20 first try')).toBeInTheDocument();
});

test('the answers are named by their text, the question is a heading, progress and feedback are announced', async () => {
  renderTool('/theory/theory-quiz', { theory: tq(['intervals']) });
  await screen.findByRole('group', { name: 'Answers' });
  expect(options().every((o) => /^[a-z]/.test(o))).toBe(true); // "major 3rd", not "1. major 3rd"
  expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent(/ up to .* is a…$/);
  expect(screen.getByText('round 1 of 20')).toBeInTheDocument();
  expect(screen.getByRole('status')).toBeInTheDocument();
});

// ---------------------------------------------------------------- keys

test('keys 1–4 choose the options in order', async () => {
  renderTool('/theory/theory-quiz', { theory: tq() });
  await screen.findByRole('group', { name: 'Answers' });
  for (let i = 0; i < 6; i++) {
    const right = rightOption(question(), options());
    press(String(right + 1));
  }
  expect(progress()).toBe('round 7 of 20');
  expect(screen.getByText(/first try/)).toHaveTextContent('6/6 first try');
  press('5');
  press('a');
  press('0');
  expect(progress()).toBe('round 7 of 20');
});

test('keys are ignored with a modifier, when held down, and while typing in a field; Shift is fine for a digit (AZERTY)', async () => {
  renderTool('/theory/theory-quiz', { theory: tq() });
  await screen.findByRole('group', { name: 'Answers' });
  const key = String(rightOption(question(), options()) + 1);
  fireEvent.keyDown(window, { key, ctrlKey: true });
  fireEvent.keyDown(window, { key, metaKey: true });
  fireEvent.keyDown(window, { key, altKey: true });
  fireEvent.keyDown(window, { key, repeat: true });
  const field = document.body.appendChild(document.createElement('input'));
  fireEvent.keyDown(field, { key });
  fireEvent.keyDown(screen.getByLabelText('Instrument'), { key });
  expect(screen.getByText(/first try/)).toHaveTextContent('0/0 first try');
  fireEvent.keyDown(window, { key, shiftKey: true }); // the digit row of an AZERTY keyboard types digits with Shift
  expect(screen.getByText(/first try/)).toHaveTextContent('1/1 first try');
  field.remove();
});

test('the keyboard listener is removed when the quiz goes away', async () => {
  const add = vi.spyOn(window, 'addEventListener');
  const remove = vi.spyOn(window, 'removeEventListener');
  const { unmount, puts } = renderTool('/theory/theory-quiz', { theory: tq() });
  await screen.findByRole('group', { name: 'Answers' });
  const added = add.mock.calls.filter((c) => c[0] === 'keydown').map((c) => c[1]);
  expect(added.length).toBeGreaterThan(0);
  unmount();
  for (const listener of added) expect(remove.mock.calls.some((c) => c[0] === 'keydown' && c[1] === listener)).toBe(true);
  press('1');
  expect(puts).toHaveLength(0);
});

// ---------------------------------------------------------------- rounds

test('a round is exactly 20: the 20th answer draws no question, and late or double key events record nothing more', async () => {
  const { puts } = renderTool('/theory/theory-quiz', { theory: tq() });
  await screen.findByRole('group', { name: 'Answers' });
  for (let i = 0; i < 19; i++) answerRight();
  expect(progress()).toBe('round 20 of 20');
  expect(puts).toHaveLength(0); // nothing is sent while the round is on
  const calls = next.mock.calls.length;
  const right = String(rightOption(question(), options()) + 1);
  // Two events before React has drawn anything: the second must not record a 21st answer.
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: right }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: right }));
  });
  expect(await screen.findByText('20 / 20 first try')).toBeInTheDocument();
  expect(next.mock.calls.length).toBe(calls); // no question was drawn after the 20th answer
  for (const key of ['1', '2', '3', '4']) press(key);
  await waitFor(() => expect(puts).toHaveLength(1));
  expect(puts[0]!.quiz.history).toHaveLength(20);
  expect(screen.getByText('20 / 20 first try')).toBeInTheDocument();
});

test('two key events before a redraw cannot both answer one question: exactly one answer is recorded', async () => {
  vi.useFakeTimers({ toFake: ['Date'] }); // frozen clock: the same questions, in the same option order, on every visit
  vi.setSystemTime(new Date('2026-09-29T12:00:00Z'));
  // A first visit only to learn where the right answer of question 2 sits (a fixed seed makes it the same next time).
  renderTool('/theory/theory-quiz', { theory: tq() });
  await screen.findByRole('group', { name: 'Answers' });
  const first = rightOption(question(), options());
  answerRight();
  const second = rightOption(question(), options());
  cleanup();
  expect(second).not.toBe(first);

  renderTool('/theory/theory-quiz', { theory: tq() });
  await screen.findByRole('group', { name: 'Answers' });
  expect(rightOption(question(), options())).toBe(first);
  // The second event repeats the first key. Answering question 1 twice would record two answers; aimed at
  // question 2, where that key is a wrong pick, it records none.
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: String(first + 1) }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: String(first + 1) }));
  });
  expect(progress()).toBe('round 2 of 20');
  expect(screen.getByText(/first try/)).toHaveTextContent('1/1 first try');
  expect(screen.getByRole('status')).toHaveTextContent('✕'); // the repeat was a wrong pick on question 2
});

test('Enter starts the next round from the summary, but not when it is pressing a button; the same question never comes twice in a row, even across rounds', async () => {
  next.mockClear();
  renderTool('/theory/theory-quiz', { theory: tq() });
  await screen.findByRole('group', { name: 'Answers' });
  const asked: string[] = [];
  for (let i = 0; i < ROUND; i++) {
    asked.push(question());
    answerRight();
  }
  await screen.findByText('20 / 20 first try');
  fireEvent.keyDown(screen.getByRole('button', { name: 'Practise these' }), { key: 'Enter' });
  expect(screen.getByText('20 / 20 first try')).toBeInTheDocument();
  fireEvent.keyDown(window, { key: 'Enter', repeat: true });
  fireEvent.keyDown(window, { key: 'Enter', ctrlKey: true });
  expect(screen.getByText('20 / 20 first try')).toBeInTheDocument();
  press('Enter');
  expect(progress()).toBe('round 1 of 20');
  asked.push(question());
  asked.forEach((q, i) => i > 0 && expect(q).not.toBe(asked[i - 1]));
  // Not luck: every draw was told the item before it, including the first one of the new round.
  const calls = next.mock.calls;
  expect(calls.length).toBeGreaterThanOrEqual(21);
  calls.forEach((c, i) => i > 0 && expect(c[3]).toBe(next.mock.results[i - 1]!.value.item));
});

test('Enter on the summary starts the next round even while a topic chip has the focus; it only yields to the summary\'s own buttons', async () => {
  renderTool('/theory/theory-quiz', { theory: tq() });
  await screen.findByRole('group', { name: 'Answers' });
  for (let i = 0; i < ROUND; i++) answerRight();
  await screen.findByText('20 / 20 first try');
  const chip = screen.getByRole('button', { name: 'Keys' });
  chip.focus();
  fireEvent.keyDown(chip, { key: 'Enter' });
  expect(progress()).toBe('round 1 of 20'); // the chip did not flip and the round started
  expect(chip).toHaveAttribute('aria-pressed', 'true');
});

test('the weighting sees the answer just given, and a practise list limits the next round', async () => {
  renderTool('/theory/theory-quiz', { theory: tq() });
  await screen.findByRole('group', { name: 'Answers' });
  next.mockClear();
  fireEvent.click(buttons()[wrongIndexes()[0]!]!); // a wrong pick is not an answer yet
  answerRight();
  const [, history] = next.mock.calls.at(-1)!;
  expect(history).toHaveLength(1);
  expect(history[0]).toMatchObject({ quiz: 'theory', correct: false });
  for (let i = 0; i < 19; i++) answerRight();
  await screen.findByText(/first try/);
  fireEvent.click(screen.getByRole('button', { name: 'Practise these' }));
  expect(screen.getByText(/practising the 3 weakest/)).toBeInTheDocument();
  expect(next.mock.calls.at(-1)![4]).toHaveLength(3); // `only`: the three weakest items
});

test('Result text reads well in the summary: "V of E♭", chord names, intervals', () => {
  expect(factText('v:Eb')).toBe('V of E♭');
  expect(factText('rel:F')).toBe('relative minor of F');
  expect(factText('sig:D')).toBe('key signature of D');
  expect(factText('notes:Bm7')).toBe('notes of Bm7');
  expect(factText('name:Bbm7')).toBe('B♭m7 from its notes');
  expect(factText('ivl:C:6M')).toBe('C up to A');
});

test('the weakest of a round is listed in words', async () => {
  renderTool('/theory/theory-quiz', { theory: tq(['keys']) });
  await screen.findByRole('group', { name: 'Answers' });
  for (let i = 0; i < ROUND; i++) {
    fireEvent.click(buttons()[wrongIndexes()[0]!]!);
    answerRight();
  }
  const weakest = await screen.findByText(/Weakest this round/);
  expect(weakest.textContent).toMatch(/(V of|relative minor of|key signature of) /);
});

// ---------------------------------------------------------------- topics

test('topics are saved in a fixed order, and a burst of switches is exactly one PUT', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  const { puts } = renderTool('/theory/theory-quiz', { theory: tq() });
  await screen.findByRole('group', { name: 'Answers' });
  fireEvent.click(screen.getByRole('button', { name: 'Chords' }));
  fireEvent.click(screen.getByRole('button', { name: 'Keys' }));
  fireEvent.click(screen.getByRole('button', { name: 'Chords' }));
  expect(progress()).toBe('round 1 of 20');
  await act(async () => {
    await vi.advanceTimersByTimeAsync(2000);
  });
  expect(puts).toHaveLength(1);
  expect(puts[0]!.quiz.settings.theory.topics).toEqual(['chords', 'intervals']);
});

test('switching a topic mid-round saves the answers so far together with the setting, none twice', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  const { puts } = renderTool('/theory/theory-quiz', { theory: tq() });
  await screen.findByRole('group', { name: 'Answers' });
  answerRight();
  answerRight();
  fireEvent.click(screen.getByRole('button', { name: 'Chords' }));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(2000);
  });
  expect(puts).toHaveLength(1);
  expect(puts[0]!.quiz.history).toHaveLength(2);
  expect(puts[0]!.quiz.settings.theory.topics).toEqual(['keys', 'intervals']);
});

test('the last topic cannot be switched off: it is disabled with the reason, and nothing restarts or is saved', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  const { puts } = renderTool('/theory/theory-quiz', { theory: tq(['chords']) });
  await screen.findByRole('group', { name: 'Answers' });
  answerRight();
  const last = screen.getByRole('button', { name: 'Chords' });
  expect(last).toBeDisabled();
  expect(last).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByText(/at least one topic/i)).toBeInTheDocument();
  fireEvent.click(last);
  expect(progress()).toBe('round 2 of 20');
  await act(async () => {
    await vi.advanceTimersByTimeAsync(2000);
  });
  expect(puts).toHaveLength(0);
  // With two on, neither is locked and the reason is gone.
  fireEvent.click(screen.getByRole('button', { name: 'Keys' }));
  expect(screen.getByRole('button', { name: 'Chords' })).toBeEnabled();
  expect(screen.queryByText(/at least one topic/i)).toBeNull();
});

test('switching a topic on offers its questions, in the order the topics are listed', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  const { puts } = renderTool('/theory/theory-quiz', { theory: tq(['intervals']) });
  await screen.findByRole('group', { name: 'Answers' });
  fireEvent.click(screen.getByRole('button', { name: 'Keys' }));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(2000);
  });
  expect(puts.at(-1)!.quiz.settings.theory.topics).toEqual(['keys', 'intervals']);
  expect(next.mock.calls.at(-1)![0]).toEqual(['keys', 'intervals']);
});

// ---------------------------------------------------------------- when there is no question (N-08)

test('a practise list that matches nothing is said in words with a way out; a normal round starts the round again', async () => {
  renderTool('/theory/theory-quiz', { theory: tq() });
  await screen.findByRole('group', { name: 'Answers' });
  for (let i = 0; i < ROUND; i++) answerRight();
  await screen.findByText('20 / 20 first try');
  next.mockImplementationOnce(() => {
    throw new quiz.NothingToPractise();
  });
  fireEvent.click(screen.getByRole('button', { name: 'Practise these' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(/None of the items you chose to practise/);
  expect(screen.queryByRole('group', { name: 'Answers' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Start a normal round' }));
  await screen.findByRole('group', { name: 'Answers' });
  expect(progress()).toBe('round 1 of 20');
  expect(screen.queryByRole('alert')).toBeNull();
});

test('an unexpected error while drawing the next question is shown as it is, logged, and can be retried without losing the round', async () => {
  const error = vi.spyOn(console, 'error').mockImplementation(() => {});
  renderTool('/theory/theory-quiz', { theory: tq() });
  await screen.findByRole('group', { name: 'Answers' });
  answerRight();
  next.mockImplementationOnce(() => {
    throw new Error('No quiz items for topics []');
  });
  answerRight();
  expect(await screen.findByRole('alert')).toHaveTextContent('No quiz items for topics []');
  expect(error).toHaveBeenCalled();
  press('1'); // nothing to answer: the key does nothing
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  await screen.findByRole('group', { name: 'Answers' });
  expect(progress()).toBe('round 3 of 20'); // two answers were given and are still counted
  expect(screen.getByText(/first try/)).toHaveTextContent('2/2 first try');
});

test('a focus error from the generator is shown the same way', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  next.mockImplementationOnce(() => {
    throw new quiz.QuizFocusError('strings');
  });
  renderTool('/theory/theory-quiz', { theory: tq() });
  expect(await screen.findByRole('alert')).toHaveTextContent(/No such string/);
  expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
});

test('the topics stay on screen while there is no question, so the way out can be a topic change', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  next.mockImplementationOnce(() => {
    throw new Error('boom');
  });
  renderTool('/theory/theory-quiz', { theory: tq(['keys', 'chords']) });
  await screen.findByRole('alert');
  fireEvent.click(screen.getByRole('button', { name: 'Chords' }));
  await screen.findByRole('group', { name: 'Answers' });
  expect(screen.queryByRole('alert')).toBeNull();
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
      <MemoryRouter initialEntries={['/theory/theory-quiz']}>
        <Routes>
          <Route path="theory/:tool" element={<Theory />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  expect(await screen.findByText(/The quiz needs theory.json/)).toBeInTheDocument();
  expect(screen.getAllByRole('alert')).toHaveLength(2); // the screen's banner and the quiz's own
  expect(screen.queryByRole('group', { name: 'Answers' })).toBeNull();
  expect(screen.queryByText(/^round \d+ of 20$/)).toBeNull();
  press('1');
  expect(screen.queryByRole('group', { name: 'Topics' })).toBeNull(); // no chips that would look like they saved
  expect(puts).toHaveLength(0);
});

// ---------------------------------------------------------------- weakest facts

test('weakest facts come from the history and read as questions; reset asks first, then deletes everything in one PUT', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  const at = '2026-09-29T00:00:00Z';
  const history: QuizAnswer[] = [
    { quiz: 'theory', mode: 'keys', item: 'v:Eb', correct: false, ms: 9000, at },
    { quiz: 'theory', mode: 'keys', item: 'v:Eb', correct: false, ms: 9000, at },
    { quiz: 'theory', mode: 'intervals', item: 'ivl:C:6M', correct: true, ms: 500, at },
  ];
  const { puts } = renderTool('/theory/theory-quiz', { theory: { ...tq(), quiz: { ...tq().quiz!, history } } });
  await screen.findByRole('group', { name: 'Answers' });
  const list = screen.getByRole('list');
  expect(within(list).getAllByRole('listitem')[0]).toHaveTextContent("What's the V chord in E♭ major?");
  vi.spyOn(window, 'confirm').mockReturnValueOnce(false);
  fireEvent.click(screen.getByRole('button', { name: /Reset history/ }));
  expect(puts).toHaveLength(0);
  vi.spyOn(window, 'confirm').mockReturnValueOnce(true);
  fireEvent.click(screen.getByRole('button', { name: /Reset history/ }));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(2000);
  });
  expect(puts).toHaveLength(1);
  expect(puts[0]!.quiz.history).toEqual([]);
  expect(await screen.findByText(/No answers yet/)).toBeInTheDocument();
});

test('this round’s unsaved answers already colour the weakest facts', async () => {
  renderTool('/theory/theory-quiz', { theory: tq(['keys']) });
  await screen.findByRole('group', { name: 'Answers' });
  expect(screen.getByText(/No answers yet/)).toBeInTheDocument();
  const q = question();
  fireEvent.click(buttons()[wrongIndexes()[0]!]!);
  answerRight();
  expect(within(screen.getByRole('list')).getAllByRole('listitem')[0]).toHaveTextContent(q);
});

// ---------------------------------------------------------------- leaving

test('leaving mid-round for another tool saves what was answered, once', async () => {
  const { puts, unmount } = renderTool('/theory/theory-quiz', { theory: tq() });
  await screen.findByRole('group', { name: 'Answers' });
  for (let i = 0; i < 3; i++) answerRight();
  expect(puts).toHaveLength(0);
  unmount();
  await waitFor(() => expect(puts).toHaveLength(1));
  expect(puts[0]!.quiz.history).toHaveLength(3);
});

// ---------------------------------------------------------------- what a wrong pick is (explained, never revealed)

/** Independent oracle for the explanation of a wrong option: each claim in the sentence is checked with tonal. */
function checkExplanation(item: string, picked: string, text: string) {
  const [kind, a = '', b = ''] = item.split(':');
  const key = a;
  let m: RegExpExecArray | null;
  const why = `${item} / ${picked} => ${text}`;
  if (kind === 'v') {
    if ((m = /^(.+) is the (\S+) of (.+) major, not the V\.$/.exec(text))) {
      // A chord of the key's own scale, named with the right numeral.
      const scale = ['I', 'ii', 'iii', 'IV', 'V', 'vi', 'vii°'];
      const degree = scale.indexOf(m[2]!);
      expect(degree, why).toBeGreaterThanOrEqual(0);
      const root = chroma(key) + [0, 2, 4, 5, 7, 9, 11][degree]!;
      expect(chroma(Chord.get(ascii(m[1]!)).tonic!), why).toBe(root % 12);
      expect(m[3], why).toBe(pretty(key));
      expect(m[1], why).toBe(picked);
    } else if ((m = /^(.+) is the V of (.+) major, not of (.+) major\.$/.exec(text))) {
      expect(chroma(m[1]!), why).toBe((chroma(m[2]!) + 7) % 12);
      expect(Chord.get(ascii(m[1]!)).quality, why).toBe('Major');
      expect(m[3], why).toBe(pretty(key));
      expect(m[1], why).toBe(picked);
      expect(chroma(m[2]!), why).not.toBe(chroma(key));
    } else throw new Error(why);
  } else if (kind === 'rel') {
    m = /^(.+) minor is the relative minor of (.+) major, not of (.+) major\.$/.exec(text);
    expect(m, why).not.toBeNull();
    expect(`${m![1]} minor`, why).toBe(picked);
    expect((chroma(m![1]!) + 3) % 12, why).toBe(chroma(m![2]!));
    expect(m![3], why).toBe(pretty(key));
    expect(chroma(m![2]!), why).not.toBe(chroma(key));
  } else if (kind === 'sig') {
    m = /^(.+) major has (.+), not (.+) major\.$/.exec(text);
    expect(m, why).not.toBeNull();
    expect(m![2], why).toBe(picked);
    const claimed = ascii(m![1]!);
    const table = { ...SHARPS, ...FLATS };
    const n = picked === 'no sharps or flats' ? 0 : Number(picked.split(' ')[0]);
    const sharp = picked.includes('sharp');
    expect(table[claimed] ?? 0, why).toBe(n);
    if (n > 0) expect(claimed in SHARPS, why).toBe(sharp);
    expect(m![3], why).toBe(pretty(key));
  } else if (kind === 'notes') {
    m = /^(.+) is (.+), not (.+)\.$/.exec(text);
    expect(m, why).not.toBeNull();
    expect(m![1], why).toBe(picked);
    expect(Chord.get(ascii(m![2]!)).notes.map(chroma).join(), why).toBe(picked.split(' ').map(chroma).join());
    expect(Chord.get(ascii(m![2]!)).tonic, why).toBe(Chord.get(ascii(a)).tonic);
    expect(m![3], why).toBe(pretty(a));
  } else if (kind === 'name') {
    m = /^(.+) is (.+), not (.+)\.$/.exec(text);
    expect(m, why).not.toBeNull();
    expect(m![1], why).toBe(picked);
    expect(Chord.get(ascii(picked)).notes.map(chroma).join(), why).toBe(m![2]!.split(' ').map(chroma).join());
    expect(m![3]!.split(' ').map(chroma).join(), why).toBe(Chord.get(ascii(a)).notes.map(chroma).join());
  } else {
    m = /^A (.+) above (.+) is (.+), not (.+)\.$/.exec(text);
    expect(m, why).not.toBeNull();
    expect(m![1], why).toBe(picked);
    expect(m![2], why).toBe(pretty(a));
    expect(chroma(m![3]!), why).toBe((chroma(a) + SEMITONES.indexOf(picked)) % 12);
    expect(chroma(m![4]!), why).toBe((chroma(a) + SEMITONES.indexOf(SEMITONES[(chroma(Note.transpose(a, b)) - chroma(a) + 12) % 12]!)) % 12);
  }
}

const pretty = (s: string) => s.replaceAll('#', '♯').replace(/([A-G])b/g, '$1♭');

test('every wrong option of every fact is explained with a sentence whose claims an independent oracle confirms, and never names the right answer', () => {
  let explained = 0;
  for (const item of quiz.theoryItems(['keys', 'chords', 'intervals'])) {
    const q = quiz.theoryQuestion(item, quiz.mulberry32(7));
    q.options.forEach((option, i) => {
      if (i === q.answer) return;
      const text = explainWrong(item, option);
      expect(text, `${item} / ${option}`).not.toMatch(/is not the answer/); // every kind here can be computed
      checkExplanation(item, option, text);
      explained += 1;
    });
  }
  expect(explained).toBeGreaterThan(600);
});

test('the wording, one example of each kind', () => {
  expect(explainWrong('v:Eb', 'F♯')).toBe('F♯ is the V of B major, not of E♭ major.');
  expect(explainWrong('v:Eb', 'A♭')).toBe('A♭ is the IV of E♭ major, not the V.');
  expect(explainWrong('rel:F', 'D♯ minor')).toBe('D♯ minor is the relative minor of F♯ major, not of F major.');
  expect(explainWrong('sig:D', '3 flats')).toBe('E♭ major has 3 flats, not D major.');
  expect(explainWrong('sig:C', '1 sharp')).toBe('G major has 1 sharp, not C major.');
  expect(explainWrong('notes:Bm7', 'B D♯ F♯ A')).toBe('B D♯ F♯ A is B7, not Bm7.');
  expect(explainWrong('name:Bm', 'B')).toBe('B is B D♯ F♯, not B D F♯.');
  expect(explainWrong('ivl:C:6M', 'minor 6th')).toBe('A minor 6th above C is A♭, not A.');
});

test('an option it cannot explain is said so plainly, not explained wrongly', () => {
  expect(explainWrong('v:Eb', 'purple')).toBe('purple is not the answer.');
  expect(explainWrong('sig:D', 'lots')).toBe('lots is not the answer.');
  expect(explainWrong('ivl:C:6M', 'a fifth-ish')).toBe('a fifth-ish is not the answer.');
  expect(explainWrong('mystery:x', 'y')).toBe('y is not the answer.');
});

test('the chip on the screen explains the mistake, keeps the ✕ out of the reading, and does not reveal the answer', async () => {
  renderTool('/theory/theory-quiz', { theory: tq() });
  await screen.findByRole('group', { name: 'Answers' });
  const q = question();
  const right = options()[rightOption(q, options())]!;
  const wrong = wrongIndexes()[0]!;
  const picked = options()[wrong]!;
  fireEvent.click(buttons()[wrong]!);
  const status = screen.getByRole('status');
  expect(status).toHaveTextContent(/Try again\.$/);
  expect(status.querySelector('[aria-hidden="true"]')).toHaveTextContent('✕');
  expect(status.textContent).toContain(picked);
  expect(status.textContent).not.toMatch(/is not the answer/);
  // The right option is still the only one that advances.
  expect(status.textContent!.replace(picked, '')).not.toContain(` ${right},`);
  answerRight();
  expect(progress()).toBe('round 2 of 20');
});

// ---------------------------------------------------------------- the file becomes unreadable mid-round

test('the file becomes unreadable mid-round: no question, no key answers anything, and when it reads again the round goes on and every answer is saved once', async () => {
  const page = renderFlaky('/theory/theory-quiz', tq());
  await screen.findByRole('group', { name: 'Answers' });
  for (let i = 0; i < 3; i++) answerRight();
  expect(progress()).toBe('round 4 of 20');

  await page.unreadable();
  await screen.findByText(/The quiz needs theory.json/);
  expect(screen.queryByRole('group', { name: 'Answers' })).toBeNull();
  expect(screen.queryByText(/^round \d+ of 20$/)).toBeNull();
  for (let i = 0; i < 3; i++) for (const key of ['1', '2', '3', '4']) press(key); // blind key presses: nothing to answer
  await page.readable();
  await screen.findByRole('group', { name: 'Answers' });
  // Not one blind answer was recorded, and the three before the failure are still counted.
  expect(progress()).toBe('round 4 of 20');
  expect(screen.getByText(/first try/)).toHaveTextContent('3/3 first try');
  expect(screen.queryByRole('alert')).toBeNull();
  expect(page.puts).toHaveLength(0);

  for (let i = 0; i < 17; i++) answerRight();
  expect(await screen.findByText('20 / 20 first try')).toBeInTheDocument();
  await waitFor(() => expect(page.puts).toHaveLength(1));
  expect(page.puts[0]!.quiz.history).toHaveLength(20);
});

test('the round is not lost when the tab is left while the file is unreadable: the answers are kept, logged, guarded, and saved after the next good read', async () => {
  const error = vi.spyOn(console, 'error').mockImplementation(() => {});
  const page = renderFlaky('/theory/theory-quiz', tq());
  await screen.findByRole('group', { name: 'Answers' });
  for (let i = 0; i < 3; i++) answerRight();
  await page.unreadable();
  await screen.findByText(/The quiz needs theory.json/);
  page.unmount();
  await waitFor(() => expect(error).toHaveBeenCalledWith(expect.stringContaining('cannot be read')));
  expect(page.puts).toHaveLength(0);
  const closing = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(closing);
  expect(closing.defaultPrevented).toBe(true); // the answers live nowhere else

  const back = renderFlaky('/theory/theory-quiz', tq());
  await screen.findByRole('group', { name: 'Answers' });
  await waitFor(() => expect(back.puts).toHaveLength(1));
  expect(back.puts[0]!.quiz.history).toHaveLength(3);
  expect(within(screen.getByRole('list')).getAllByRole('listitem').length).toBeGreaterThan(0); // and they show in the weak facts
});

let round!: Round;
function Probe() {
  round = useQuizRound();
  return <p>{useTheoryDoc().doc ? 'ready' : 'no document'}</p>;
}
function hookPage() {
  const puts: TheoryDoc[] = [];
  let reading = true;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'PUT') {
        puts.push(JSON.parse(String(init.body)));
        return new Response(String(init.body));
      }
      return reading ? new Response(JSON.stringify({ ...DEFAULT_THEORY, last_tool: 'theory-quiz' })) : new Response(JSON.stringify({ detail: 'theory.json: broken' }), { status: 500 });
    }),
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 5000, refetchOnWindowFocus: false } } });
  const view = render(
    <QueryClientProvider client={client}>
      <TheoryDocProvider>
        <Probe />
      </TheoryDocProvider>
    </QueryClientProvider>,
  );
  const refetch = () => act(async () => void (await client.invalidateQueries({ queryKey: ['theory'] })));
  return {
    ...view,
    puts,
    unreadable: async () => {
      reading = false;
      await refetch();
    },
    readable: async () => {
      reading = true;
      await refetch();
    },
  };
}
const record = (i: number) =>
  act(() => {
    round.record({ quiz: 'theory', mode: 'keys', item: `q${i}`, correct: true, ms: 100 + i, text: `fact ${i}` });
  });

test('the 20th answer arriving while the file is unreadable is kept, not dropped, and goes out once after the next good read', async () => {
  const error = vi.spyOn(console, 'error').mockImplementation(() => {});
  const page = hookPage();
  await screen.findByText('ready');
  for (let i = 0; i < 3; i++) record(i);
  await page.unreadable();
  await screen.findByText('no document');
  for (let i = 3; i < ROUND; i++) record(i);
  expect(round.done).toBe(true);
  expect(page.puts).toHaveLength(0); // nothing is written over an unreadable file
  expect(error).toHaveBeenCalledWith(expect.stringContaining('cannot be read'));
  await page.readable();
  await screen.findByText('ready');
  await waitFor(() => expect(page.puts).toHaveLength(1));
  expect(page.puts[0]!.quiz.history).toHaveLength(20);
  expect(round.history).toHaveLength(20); // once, not twice
  expect(round.results).toHaveLength(20);
});

test('answers the hook could not hand over stay with it (and say so), instead of being let go of', async () => {
  const error = vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ detail: 'theory.json: broken' }), { status: 500 })));
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <TheoryDocProvider>
        <Probe />
      </TheoryDocProvider>
    </QueryClientProvider>,
  );
  await screen.findByText('no document'); // the file was never read: there is no document to add answers to
  record(1);
  act(() => round.restart());
  expect(error).toHaveBeenCalledWith(expect.stringContaining('could not be saved'));
  expect(round.history).toHaveLength(1); // still held by the hook, not dropped
  expect(round.results).toHaveLength(0);
});

// ---------------------------------------------------------------- a kept round, then a failing read, then more answers

test('answers kept from an earlier visit are not replaced by a later keep: 5 kept, 2 more while the return GET fails, one PUT of all 7 after the next good read', async () => {
  const error = vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-09-29T12:00:00Z'));
  const puts: TheoryDoc[] = [];
  let putOk = true;
  let getHeld: ((ok: boolean) => void) | null = null;
  let hold = false;
  const stored: TheoryDoc = { ...DEFAULT_THEORY, ...tq() } as TheoryDoc;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/theory' && init?.method === 'PUT') {
        if (!putOk) return new Response('disk full', { status: 500 });
        puts.push(JSON.parse(String(init.body)));
        return new Response(String(init.body));
      }
      if (url === '/api/theory') {
        const ok = hold ? await new Promise<boolean>((resolve) => (getHeld = resolve)) : true;
        return ok ? new Response(JSON.stringify(stored)) : new Response(JSON.stringify({ detail: 'theory.json: broken' }), { status: 500 });
      }
      if (url === '/api/songs') return new Response(JSON.stringify({ songs: [] }));
      throw new Error(`unexpected fetch: ${url}`);
    }),
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const visit = () =>
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/theory/theory-quiz']}>
          <Routes>
            <Route path="theory/:tool" element={<Theory />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
  const answerAt = () => {
    vi.setSystemTime(Date.now() + 1000); // every answer has its own time
    answerRight();
  };

  // 1. A round of 5 whose save fails: the tab is left holding them.
  const first = visit();
  await screen.findByRole('group', { name: 'Answers' });
  for (let i = 0; i < 5; i++) answerAt();
  putOk = false;
  first.unmount();
  await waitFor(() => expect(error).toHaveBeenCalledWith(expect.stringContaining('unsaved changes, kept in memory')));
  putOk = true;

  // 2. Back on the tab: the cached document shows while the GET is pending; two more answers.
  hold = true;
  const second = visit();
  await screen.findByRole('group', { name: 'Answers' });
  answerAt();
  answerAt();

  // 3. The GET fails: the file is unreadable. 4. The tab is left.
  await act(async () => getHeld!(false));
  await screen.findByText(/The quiz needs theory.json/);
  second.unmount();
  await waitFor(() => expect(error).toHaveBeenCalledWith(expect.stringContaining('cannot be read')));
  expect(puts).toHaveLength(0);

  // 5. The next read works: one PUT, with all seven answers, each once.
  hold = false;
  visit();
  await screen.findByRole('group', { name: 'Answers' });
  await waitFor(() => expect(puts).toHaveLength(1));
  const history = puts[0]!.quiz.history as QuizAnswer[];
  expect(history).toHaveLength(7);
  expect(new Set(history.map((a) => `${a.item}|${a.at}`)).size).toBe(7);
  expect(history.map((a) => a.at)).toEqual([...history.map((a) => a.at)].sort());
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(puts).toHaveLength(1);
});
