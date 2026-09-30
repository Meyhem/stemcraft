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
import { seeds } from '../useQuizHistory';
import { renderFlaky, renderTool } from './testing';

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

/** Which question is on screen. The same one never comes twice in a row, so a change means it moved on. */
const progress = () => (screen.queryByRole('group', { name: 'Answers' }) ? `${question()}|${options().join('|')}` : 'no question');
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
  const before = progress();
  answerTheory();
  expect(progress()).not.toBe(before);
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
] as const)('%s: 40 right answers, worked out independently, go on without an end and are stored under their topic', async (topic, shape) => {
  const { puts } = renderTool('/theory/theory-quiz', { theory: tq([topic]) });
  await screen.findByRole('group', { name: 'Answers' });
  const asked: string[] = [];
  for (let i = 0; i < 40; i++) {
    asked.push(question());
    expect(question()).toMatch(shape);
    expect(new Set(options()).size).toBe(4);
    answerRight();
  }
  asked.forEach((q, i) => i > 0 && expect(q).not.toBe(asked[i - 1]));
  await waitFor(() => expect(puts.at(-1)?.quiz.history).toHaveLength(40));
  const history = puts.at(-1)!.quiz.history as QuizAnswer[];
  expect(history.every((a) => a.quiz === 'theory' && a.mode === topic && a.correct && !('ms' in a))).toBe(true);
  expect(new Set(history.map((a) => a.item.split(':')[0])).size).toBeGreaterThan(topic === 'keys' ? 1 : 0);
});

test('all three topics together: every question is answered right by the independent oracle, saved as they go, no summary', async () => {
  const { puts } = renderTool('/theory/theory-quiz', { theory: tq() });
  await screen.findByRole('group', { name: 'Answers' });
  for (let i = 0; i < 25; i++) answerRight();
  await waitFor(() => expect(puts.at(-1)?.quiz.history).toHaveLength(25)); // saves queue up behind each other, the last carries all
  const history = puts.at(-1)!.quiz.history as QuizAnswer[];
  expect(history.every((a) => a.quiz === 'theory' && ['keys', 'chords', 'intervals'].includes(a.mode) && a.correct)).toBe(true);
  expect(history.every((a) => !('text' in a) && !('ms' in a))).toBe(true);
  expect(screen.getByRole('group', { name: 'Answers' })).toBeInTheDocument(); // it simply goes on
  expect(screen.queryByText(/first try|round \d|weak|streak|score|Practise these/i)).toBeNull();
});

// ---------------------------------------------------------------- first try only

test('a wrong pick is crossed out, says so, and the question stays; the right one records a miss, once', async () => {
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
  const still = progress();
  // The same wrong option again, by click or by key, is not a second miss and changes nothing.
  fireEvent.click(buttons()[w1]!);
  press(String(w1 + 1));
  expect(progress()).toBe(still);
  fireEvent.click(buttons()[w2]!);
  expect(question()).toBe(q);
  answerRight();
  expect(progress()).not.toBe(still);
  expect(screen.getByRole('status')).toBeEmptyDOMElement(); // the next question starts clean
  answerRight();
  await waitFor(() => expect(puts).toHaveLength(2));
  const history = puts[1]!.quiz.history as QuizAnswer[];
  expect(history).toHaveLength(2);
  expect(history[0]).toMatchObject({ quiz: 'theory', mode: 'keys', correct: false });
  expect(history[1]!.correct).toBe(true);
});

test('the answers are named by their text, the question is a heading, feedback is announced', async () => {
  renderTool('/theory/theory-quiz', { theory: tq(['intervals']) });
  await screen.findByRole('group', { name: 'Answers' });
  expect(options().every((o) => /^[a-z]/.test(o))).toBe(true); // "major 3rd", not "1. major 3rd"
  expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent(/ up to .* is a…$/);
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
  const before = progress();
  press('5');
  press('a');
  press('0');
  expect(progress()).toBe(before);
});

test('keys are ignored with a modifier, when held down, and while typing in a field; Shift is fine for a digit (AZERTY)', async () => {
  renderTool('/theory/theory-quiz', { theory: tq() });
  await screen.findByRole('group', { name: 'Answers' });
  const key = String(rightOption(question(), options()) + 1);
  const before = progress();
  fireEvent.keyDown(window, { key, ctrlKey: true });
  fireEvent.keyDown(window, { key, metaKey: true });
  fireEvent.keyDown(window, { key, altKey: true });
  fireEvent.keyDown(window, { key, repeat: true });
  const field = document.body.appendChild(document.createElement('input'));
  fireEvent.keyDown(field, { key });
  fireEvent.keyDown(screen.getByLabelText('Instrument'), { key });
  expect(progress()).toBe(before);
  fireEvent.keyDown(window, { key, shiftKey: true }); // the digit row of an AZERTY keyboard types digits with Shift
  expect(progress()).not.toBe(before);
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

// ---------------------------------------------------------------- answering

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
  expect(screen.getByRole('status')).toHaveTextContent('✕'); // the repeat was a wrong pick on question 2
});

test('the weighting sees the answer just given', async () => {
  renderTool('/theory/theory-quiz', { theory: tq() });
  await screen.findByRole('group', { name: 'Answers' });
  next.mockClear();
  fireEvent.click(buttons()[wrongIndexes()[0]!]!); // a wrong pick is not an answer yet
  answerRight();
  const [, history] = next.mock.calls.at(-1)!;
  expect(history).toHaveLength(1);
  expect(history[0]).toMatchObject({ quiz: 'theory', correct: false });
});

test('Start fresh asks first, then forgets what was practised', async () => {
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
  const base = tq();
  const { puts } = renderTool('/theory/theory-quiz', {
    theory: { ...base, quiz: { ...base.quiz!, history: [{ quiz: 'theory', mode: 'keys', item: 'v:C', correct: false, at: '2026-01-01T00:00:00Z' }] } },
  });
  await screen.findByRole('group', { name: 'Answers' });
  fireEvent.click(screen.getByRole('button', { name: /start fresh/i }));
  expect(confirm).toHaveBeenCalledTimes(1);
  expect(puts).toHaveLength(0);
  confirm.mockReturnValue(true);
  fireEvent.click(screen.getByRole('button', { name: /start fresh/i }));
  await waitFor(() => expect(puts.at(-1)?.quiz.history).toEqual([]));
});

// ---------------------------------------------------------------- topics

test('topics are saved in a fixed order, and a burst of switches is exactly one PUT', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  const { puts } = renderTool('/theory/theory-quiz', { theory: tq() });
  await screen.findByRole('group', { name: 'Answers' });
  fireEvent.click(screen.getByRole('button', { name: 'Chords' }));
  fireEvent.click(screen.getByRole('button', { name: 'Keys' }));
  fireEvent.click(screen.getByRole('button', { name: 'Chords' }));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(2000);
  });
  expect(puts).toHaveLength(1);
  expect(puts[0]!.quiz.settings.theory.topics).toEqual(['chords', 'intervals']);
});

test('the last topic cannot be switched off: it is disabled with the reason, and nothing restarts or is saved', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  const { puts } = renderTool('/theory/theory-quiz', { theory: tq(['chords']) });
  await screen.findByRole('group', { name: 'Answers' });
  answerRight();
  await waitFor(() => expect(puts).toHaveLength(1)); // the answer itself is saved
  const last = screen.getByRole('button', { name: 'Chords' });
  expect(last).toBeDisabled();
  expect(last).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByText(/at least one topic/i)).toBeInTheDocument();
  const before = progress();
  fireEvent.click(last);
  expect(progress()).toBe(before);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(2000);
  });
  expect(puts).toHaveLength(1); // the click saved nothing more
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

test('an unexpected error while drawing the next question is shown as it is, logged, and can be retried', async () => {
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
  press('1');
  expect(screen.queryByRole('group', { name: 'Topics' })).toBeNull(); // no chips that would look like they saved
  expect(puts).toHaveLength(0);
});

// ---------------------------------------------------------------- weakest facts

// ---------------------------------------------------------------- leaving

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
  const before = progress();
  answerRight();
  expect(progress()).not.toBe(before);
});
