import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { Chord, Note } from 'tonal';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import { DEFAULT_THEORY, type QuizAnswer, type TheoryDoc } from '../../api/client';
import * as quiz from '../../music/quiz';
import { Theory } from '../../screens/Theory';
import { forgetUnsavedTheory } from '../TheoryDoc';
import { ROUND, seeds } from '../useQuizRound';
import { renderTool } from './testing';
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

test('two key events before a redraw cannot both answer one question', async () => {
  renderTool('/theory/theory-quiz', { theory: tq() });
  await screen.findByRole('group', { name: 'Answers' });
  const right = String(rightOption(question(), options()) + 1);
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: right }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: right }));
  });
  // The first answered question 1; the second was aimed at question 2 and can score at most that one.
  const stats = screen.getByText(/first try/).textContent!;
  expect(stats).toMatch(/^[01]\/2 first try$|^[01]\/1 first try$/);
  expect(Number(/round (\d+)/.exec(progress())![1])).toBeLessThanOrEqual(3);
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

test('topics are saved once, in a fixed order, and switching one restarts the round', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  const { puts } = renderTool('/theory/theory-quiz', { theory: tq() });
  await screen.findByRole('group', { name: 'Answers' });
  answerRight();
  expect(progress()).toBe('round 2 of 20');
  fireEvent.click(screen.getByRole('button', { name: 'Chords' }));
  fireEvent.click(screen.getByRole('button', { name: 'Keys' }));
  fireEvent.click(screen.getByRole('button', { name: 'Chords' }));
  expect(progress()).toBe('round 1 of 20');
  await act(async () => {
    await vi.advanceTimersByTimeAsync(2000);
  });
  const last = puts.at(-1)!;
  expect(last.quiz.settings.theory.topics).toEqual(['chords', 'intervals']);
  // One PUT for the answer given before the change (the round was left) and one for the settings burst.
  expect(puts.length).toBeLessThanOrEqual(2);
  expect(puts.filter((p) => p.quiz.history.length === 1)).not.toHaveLength(0);
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
